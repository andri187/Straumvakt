# Core billing — 30 issue-ready work packages

**2026-08-11.** Each package is sized to one pull request, names the files it
touches, states the test that proves it, and says what it must not do. Ordered by
wave; within a wave, order does not matter.

Effort: **S** ≈ half a day, **M** ≈ 1–2 days, **L** ≈ 3+ days or needs a decision
first.

---

## Wave 0 — nothing depends on the schema, and one of these is bleeding

### WP-01 · Fix the 100× aurar defect on driver money endpoints · **S** · blocker
`repositories/driver-sessions.ts:93-98`, `:137`, `:270`;
`repositories/driver-invoices.ts:66-68`.
Both render `Number(minorUnits)` as krónur. A 649.88 kr session shows as
**64,988 kr**. Import `formatIsk` / `roundAurarToIsk` from
`@straumvakt/commercial` instead.
**Test:** `driver-sessions.test.ts:216/246` currently asserts `costIsk: 64988`
— it *pins the bug*. Change the expectation; do not assume you broke it.
**Do not:** change what is stored. `costIskMinor` in aurar is correct.

### WP-02 · Make the billing-line writer atomic · **M** · blocker
`lib/agreement/persist.ts:359-401`. Count-then-`createMany`, outside a
transaction, against a table with no unique constraint. Two concurrent ticks both
observe zero and both insert.
**Fix:** add `@@unique([sessionId, factorCode, kind])` to
`agreements.billing_lines` (after a duplicate sweep) and use
`createMany({ skipDuplicates: true })` inside `$transaction`. `dispatcher.ts:54-71`
is the correct pattern already in this codebase.
**Test:** two overlapping calls produce one set of lines.

### WP-03 · Scope the Zaptec CDR driver resolution by org · **M** · blocker
`repositories/zaptec-session-sync.ts:186-189`. `idToken.findFirst` on
vendor-supplied strings with **no `orgId` filter**; a token collision across
tenants bills a foreign driver. The adjacent station lookup (:149-152) is
likewise unfiltered.
**Do not:** silently reattribute existing rows. Land the filter, then report what
would have changed before touching history.

### WP-04 · Correct three lying file headers · **S**
`billing-summary.ts:5-6` (claims an `orgId` parameter that does not exist),
`session-ledger.ts:16-18` (names the route as enforcer; the route names it back),
`commercial.prisma:338` (names three tables dropped on 2026-08-07).

### WP-05 · Give `check:work-view` something to compare · **S**
Red on every branch since `5f810a9` deleted `src/app/(app)/admin/work/page.tsx`.
Either restore the generated page or remove the check from `check-all.mjs`. A
check that is always red trains people to ignore the summary.

### WP-06 · Fix the dead vitest glob and the stale CI comment · **S**
`vitest.config.ts:21`'s `src/**/*.test.ts` matches zero files. `.github/workflows/check.yml:72`
claims "50 files, 686 tests"; it is 68 and 1185. Gateway's five test files run
under no root or CI command at all.

---

## Wave 1 — schema lands (migration `0002`, unapplied)

### WP-07 · Apply `0002` to test, then staging · **M**
Purely additive: 11 `CREATE TYPE`, 11 `CREATE TABLE`, 26 `CREATE INDEX`, no
`ALTER`, no `DROP`. Follow the preflight checklist in the operations pack.
**Do not:** run `drizzle-kit push`. Generate, read, apply.

### WP-08 · Dedupe and unique-index `agreements.rate_references` · **M** · decision
`UNIQUE (cost_factor_id, code, effective_from)`. Deliberately not in `0002`
because `CREATE UNIQUE INDEX` fails on existing duplicates. Run the duplicate
query first; a human decides which row was in force.
**Test:** a retried rate POST 409s instead of staging a second version.

### WP-09 · `mutation_receipts` purge job · **S** · ships **with** WP-14
A `DELETE FROM billing.mutation_receipts WHERE expires_at < now()` on the
existing cron. Without it this table reproduces the exact defect its design
criticises in `events.idempotency_keys`.

### WP-10 · Enforce the TTL that `events.idempotency_keys` already writes · **S**
`events-repository.ts:103-113` and `db/raw.ts:264-269` match on the key alone.
Add `AND expires_at > now()`. Today an expired row suppresses a replay
permanently.

### WP-11 · Add plug-time columns and stop deleting the inputs · **M**
`charging.sessions` gains `plugged_in_at`, `unplugged_at`, `charging_ended_at`.
`zaptec-state-event.ts:141-154` writes them **before** `liveSession.delete()`.
Map the vendor's `ConnectedDateTime` / `DisconnectedDateTime`
(`zaptec.ts:372-373`), which are declared and never read.

### WP-12 · Repository layer for settlements · **M**
`repositories/session-settlements.ts`. Mandatory positional `orgId`, following
`bill-objects.ts`. Upsert on `session_id`. Writes components and holds in the
same transaction.
**Do not:** accept an `OrgScope` here. Scope resolution belongs at the route.

### WP-13 · Repository layer for periods and statements · **M**
Same shape. `billing_periods` upsert on `(org_id, year, month)`; `statements`
upsert on `(period_id, recipient_kind, recipient_id)`.

---

## Wave 2 — routes, one per contract

Each of WP-14..WP-21 implements one row of `CORE_BILLING_ROUTE_CONTRACTS`
(`lib/billing/statement-zod.ts`). Every one: `orgIdParam: "orgId"` except the
driver route, request DTO validated by the exported schema, an
`audit.actions` row on every mutation, and an idempotency check against
`mutation_receipts` before doing work.

| | Package | Route | Effort |
|---|---|---|---|
| **WP-14** | Period preflight | `GET /api/admin/orgs/:orgId/billing/periods/:year/:month/preflight` | M |
| **WP-15** | Close period | `POST .../close` — must honour `expectedBlockerCount` and refuse if the count moved | M |
| **WP-16** | Resolve hold | `POST .../settlements/:sessionId/hold` — `note` required, non-empty | S |
| **WP-17** | List statements | `GET .../statements` — page cap 50 | S |
| **WP-18** | Deliver statement | `POST .../statements/:statementId/deliver` — atomic claim, `dispatcher.ts` pattern | M |
| **WP-19** | Export | `GET .../statements/export` — first caller of `billing.export` | M |
| **WP-20** | Driver billing material | `GET /api/driver/billing-material` — **no `orgId` parameter**, identity from the token | S |
| **WP-21** | Rate book write | `PUT /api/admin/orgs/:orgId/billing/rates/:code` — first caller of `tariff.write`; refuses a backdate with no reason | M |

### WP-22 · The settlement writer · **L**
Where `buildSettlementSnapshot` is finally called in production. Reads the
session, meter values, CDR, and the rate rows in force **at `startedAt`**; maps
via `buildSettlementRows`; writes.
**Do not:** call `resolve-tariff-chain.ts`. It has no timestamp parameter and
reads the current binding at stop — it is the thing this replaces.

### WP-23 · Monthly activity job · **M** · decision
Writes `driver_activity_month` and `connector_activity_month` once per month.
Blocked on WP-27.

---

## Wave 3 — tenant scoping, sequenced by exposure

### WP-24 · Scope the four accidental-global reads · **M**
`billing-tariff-detail.ts:29`, `billing-dso.ts:36`, `billing-electricity.ts:21`,
`billing-summary.ts` (all five functions). Each reads a national catalogue and
then joins to per-tenant rows. Use the `resolveOrgScope` + `orgInScope` pair as
`GET /tariffs` and (now) the by-id session reads do.

### WP-25 · Validate the scope `GET /sessions` is handed · **M** · blast radius
`scopeFromQuery` (`billing.ts:57-67`) trusts raw query params and falls through
to no filter. Validate the requested scope against `resolveOrgScope` before use.
An operator passing an out-of-scope `?orgId=` starts getting empty results —
which is correct, and is a visible change.

### WP-26 · Move `orgId` out of the tariff-management body · **M** · URL change
`billing-tariff-mgmt.ts:44` takes `orgId` from the request body under a gate with
no `orgIdParam`, so a priced tariff can be authored into any organisation. Move
it into the path. The console must move with it.

### WP-27 · Decide the support-context story · **L** · decision only
Three shadow implementations, zero enforcement, warnings to `console` rather than
`audit.actions`, and `platform.impersonate` / `platform.support.action` gate
nothing. Build `support_contexts` and enforce it, **or** delete
`SUPPORT_CONTEXT_REQUIRED` and the two warns. Shipping neither is the status quo
and it reads as a control that exists.

### WP-28 · Give the seven mixed-convention verbs one convention · **M**
`billing.read`, `billing.write`, `charger.read`, `member.read`, `member.write`,
`property.read`, `site.read` each appear both with and without `orgIdParam`. The
same permission means "your org" at one call site and "every org" at another.
Pick per verb, then shrink the `check:orgid-param` allowlist by exactly that many
entries — the guard fails if you don't.

### WP-29 · Audit rows on billing mutations · **M**
No rate change, CDR sync trigger, period close or statement send writes an
`audit.actions` row. `bill-objects.ts:107/185` is the only Core-billing write
that audits at all, and is the template.
**Also:** `audit.actions.org_id` carries `onDelete: Cascade`, so deleting an org
destroys its audit trail. Decide whether that is intended.

### WP-30 · An audit read surface · **S**
`audit.read` is in the catalogue and gates nothing; the table has exactly one
reader in the tree and no export route. A write-only log is not an audit trail.

---

## Rate-authoring handoff — API and UX

For whoever builds the rate-book screen. The contract is
`rateBookUpdateRequestSchema` + `classifyRateWrite` in `lib/billing/statement-zod.ts`;
both are tested.

**The shape.** `PUT /api/admin/orgs/:orgId/billing/rates/:code`, gated on
`tariff.write`, `orgIdParam: "orgId"`, idempotency key required.

**Three rules the UI must surface, because the API enforces them:**

1. **A backdate needs a reason.** `classifyRateWrite(effectiveFrom, now, reason)`
   returns `{ backdated, allowed, reason }` and refuses when `effectiveFrom` is
   in the past and no reason was given — the message is "restates history". So
   the form needs a reason field that appears **conditionally**, when the chosen
   date is in the past, with the consequence spelled out: *this changes what
   already-priced sessions would compute to.* Do not make it always-visible; an
   always-visible field trains people to type "update".
2. **An inverted window is rejected at the schema level.** `effectiveUntil`
   before `effectiveFrom` fails validation. Validate client-side too, so the user
   is not told by a 400.
3. **Prices are aurar, as a string.** `pricePerKwhMinor: "864"` means 8.64 kr/kWh.
   Never send a JSON number: aurar exceed 2^53 in aggregate, and the whole
   `money.ts` contract depends on BigInt. The input should take krónur with two
   decimals and convert; the API should never see a decimal.

**What the UI must not imply.** Publishing a rate does **not** re-price existing
sessions, and must not appear to. Once WP-22 lands, a settled session carries its
own price and the new rate applies from its effective date forward. Until then,
editing a `TariffDefinition` *does* silently restate every session priced against
it — so **the rate screen must stay read-only until WP-22**, not merely
discouraged.

**The ambiguity to warn about.** Until WP-08, `rate_references` has no uniqueness
on `(cost_factor_id, code, effective_from)`. A double-submitted create leaves two
rows valid at the same instant. The form must disable its submit button on first
click; that is a mitigation, not a fix.
