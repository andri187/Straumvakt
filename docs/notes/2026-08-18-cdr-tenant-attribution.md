# Cross-tenant CDR attribution — the trace, the schema truth, and the guard

**2026-08-18 · Claude A · branch `dev/core-billing-integration`**

Phase 3 of the 2026-08-18 Claude A prompt. No token value in this document, in
any test fixture, or in any log line is real.

---

## 1. The call path, file:symbol

Input to money, step by step. The line numbers are as of `7ff2414`.

| # | file | symbol | what it does |
|---|---|---|---|
| 1 | `apps/api/src/lib/zaptec-sync-cron.ts` | `ROLLING_WINDOW_MS` sweep | 26 h rolling window, scheduled |
| 1b | `apps/api/src/routes/internal/zaptec-trigger-sync.ts` | trigger handler | the manual entry to the same importer |
| 2 | `apps/api/src/repositories/zaptec-session-sync.ts` | `syncZaptecSessions` `:74` | fetches vendor history, loops CDRs, one transaction each |
| 3 | `apps/api/src/lib/zaptec.ts` | `listZaptecChargeHistory` | the vendor read |
| 4 | `apps/api/src/repositories/zaptec-session-sync.ts` | `importOne` `:135` | per-CDR body, inside `db.$transaction` |
| 5 | " | `tx.importedCdrRef.findUnique` `:140` | idempotency probe on `(sourceKind, sourceCdrId)` |
| 6 | " | `tx.ocppIdentity.findFirst` `:149` | Zaptec `ChargerId` → **`identity.orgId`**, `chargingStationId` |
| 7 | " | `tx.siteAsset.findUnique` `:156` | station → `siteId` |
| 8 | " | `tx.eVSE.findFirst` `:165` | first EVSE under the station |
| **9** | " | **driver resolution** `:172` | **← the hole. See §2.** |
| 10 | `apps/api/src/lib/tariff/resolve-tariff-chain.ts` | `resolveTariffChainWithIdsForSession` | DSO + retailer chain |
| 11 | `apps/api/src/lib/tariff/compute-session-cost.ts` | `computeSessionCost` | aurar breakdown |
| 12 | `apps/api/src/repositories/zaptec-session-sync.ts` | `tx.chargeSession.findFirst` `:256` | ±60 s reconciliation against an OCPP-created row |
| 13 | " | `tx.chargeSession.update` `:306` / `.create` `:338` | writes **`userId: driverUserId`** |
| 14 | " | `tx.importedCdrRef.create` `:426` | imprints the vendor pointer |
| 15 | " | `tx.sessionLedger.upsert` `:446` | writes **`driverUserId`** and `costIskMinor` — **this row is what an invoice is built from** |

**Step 6 is where `orgId` enters scope. Step 9 is where the driver is chosen.
Steps 13 and 15 are where the money lands on a person.** All three of token
value, charger/site/org ownership and `orgId` are simultaneously in scope at
step 9 — nothing had to be fetched to fix this.

---

## 2. What was there

```ts
const candidates = [z.UserId, z.TokenName, z.UserUserName, z.UserEmail]
  .filter((v): v is string => Boolean(v));
let driverUserId: string | null = null;
if (candidates.length > 0) {
  const idToken = await tx.idToken.findFirst({
    where: { value: { in: candidates }, status: "active" },
    select: { userId: true },
  });
  driverUserId = idToken?.userId ?? null;
}
```

Three defects in nine lines:

1. **No org term, and no membership check.** Any active token anywhere in the
   database matched at any charger.
2. **`findFirst` over `value IN (...)`** — with two candidates matching two
   different users, Postgres returns whichever row it reaches first. The same
   import could attribute the same session differently on a re-run.
3. **Two of the four candidates are free-text vendor profile fields.**
   `UserUserName` and `UserEmail` are matched against a column that holds OCPP
   idTags. An e-mail address that happens to equal somebody's idTag is a match.

---

## 3. A correction to the 2026-08-11 census

The census recorded this as *"a token collision across tenants bills a foreign
driver."* Measured against the schema on 2026-08-18, that specific mechanism is
**not reachable**:

- `identity.id_tokens.value` is declared `@unique` (`apps/api/prisma/schema/identity.prisma:220`), so two orgs cannot hold the same token value.
- The table has **no `org_id` column at all**. Its only narrowing column is the optional `scope_installation_id`.

So there was no org-scoped lookup available to write, and the framing "add the
missing org filter" does not describe an available fix.

**The reachable failure is worse, because it requires no coincidence:** the
lookup never asked whether the driver had *any* relationship with the host. A
driver of org B, charging at org A's charger — the ordinary visitor case, and
the exact case the parked "unaffiliated driver" work exists to handle — was
attributed to org B's driver on org A's ledger row. No collision needed. Just a
token and a charger that had never been introduced.

---

## 4. The guard

`apps/api/src/lib/billing/cdr-driver-resolution.ts` — pure, no I/O.

A CDR is attributed only when **all** of:

1. every candidate identifier that matches resolves to the **same** user;
2. that user's token is usable — `status === "active"` **and** not past `expires_at`;
3. that user is a **member of the org that owns the charger**.

Otherwise the session is recorded unattributed with a named reason:

| reason | meaning |
|---|---|
| `no_candidates` | vendor sent no identifier — the pre-Authorize historical case (ADR 0049 amendment). **Not an error.** |
| `no_matching_token` | identifiers present, none is a token we hold |
| `token_not_usable` | revoked, blocked, or expired |
| `ambiguous_candidates` | two identifiers, two different users. Never pick one. |
| `driver_outside_charger_org` | real driver, real token, no relationship with this host |

`chargerOrgId` being empty **throws**. That is the one case that fails loudly,
because it means the repository is broken rather than the session being
unattributable, and those two must not look alike in an operator's report.

The reason is carried out through `ZaptecSyncImported.driverAttribution`, so an
operator can tell "nobody charged under a token" from "we refused to name
someone" — only the second is actionable.

`status` and `expires_at` are independent columns with nothing keeping them in
step, so a token can read `active` and be long expired. Both are checked.

### A bug my own test caught

The first implementation keyed matched tokens into a `Map<string, CdrTokenRow>`.
Two rows sharing a value collapse — the later silently overwrote the earlier —
so the ambiguity check could never fire on the very case it was written for. It
is now `Map<string, CdrTokenRow[]>`. `value` being `UNIQUE` today would have
hidden this in production indefinitely; it is a property of the current schema,
not an invariant this decision may lean on.

---

## 5. Tests

`apps/api/src/lib/billing/cdr-driver-resolution.test.ts` — 16 tests:
attributed happy path; driver in another org; driver with memberships elsewhere
but not here; one value → two users; two fields → two users; unknown token;
revoked token; expired-but-active token; pre-Authorize (no candidates); missing
charger org throws; order-independence; strongest-field reporting; empty
membership list is not permission; plus three on candidate construction.

`apps/api/src/repositories/zaptec-session-sync.test.ts` — 6 added, exercising
the real query shapes through the fake Prisma client: attribution succeeds for a
member; a foreign-org token still **imports and prices** the session but leaves
`session_ledger.driver_user_id` null; ambiguous identifiers refuse; a
pre-Authorize CDR lands in `imported` and not in `errors`; a revoked token
refuses; and a `userId` already pinned by the OCPP path is not overwritten.

The fake's `idToken.findFirst` now **throws**, so a regression to the old
single-row unscoped lookup fails loudly instead of quietly returning null.

### Fool tests

| # | sabotage | result |
|---|---|---|
| 2 | drop the `orgId` term from the resolver's membership check | **2 resolver tests failed.** Restored. |
| 3 | drop `orgId` from the importer's `membership.findMany` query | **All 19 importer tests still passed.** |

Fool test 3 is the informative one. The SQL narrowing is **not** the guard — the
pure resolver re-checks membership against `chargerOrgId`, so removing the SQL
term changes how many rows are fetched, not who gets billed. That is the
intended shape: the decision lives in a layer that cannot be forgotten by
someone editing a query. The term stays in the query anyway, because FOCUS rule
5 says `org_id` in every query and because fetching another tenant's membership
rows to then discard them is not something to do on purpose.

---

## 6. What this does not decide

**Whether a visiting driver should be billable at all.** The guard's answer is
"not silently" — an unaffiliated driver's session is recorded, priced, and left
unattributed for a human. When the parked attribution work
(`FOCUS.md` → *Parked*, un-parked by the first invoice) lands, the rule that
replaces this one has to say explicitly what relationship other than membership
makes a driver billable at a host. Until then, refusing is the only answer that
cannot put a stranger on an invoice.
