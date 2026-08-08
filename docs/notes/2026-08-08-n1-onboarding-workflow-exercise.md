# N1 onboarding workflow exercise — findings

**Date:** 2026-08-08
**Where:** Neon scratch branch `scratch-n1-onboarding-2026-08-08` /
`br-still-butterfly-abmg0zmz` (forked from `test`), project
`spring-leaf-73019190`. Nothing was run against `test`, `staging` or
`production`. No billing tick was run.

**What this was:** produce clean test data by exercising the real onboarding
surfaces rather than seeding ad hoc, and find out where those surfaces
actually break. It is a workflow exercise, not a billing test.

---

## 1. N1 already existed — this was reconciliation, not onboarding

`N1 ehf` (`b9f6a897-2401-45a3-9cde-b89d32fdb326`) has existed since
2026-05-02, and **both** charger sites were already parented to it:
Dalvegur 10-14 (30 stations) and Reykjavík HQ (1 station, `ZPR074002`).
All 31 stations carry `org_id = N1 ehf`. There was no second linkage to
create and no duplicate org to reconcile.

`N1 Rafmagn ehf.` (`e8c0d219…`, role `retailer`) is a **separate legal
entity**, not a duplicate. Leave it alone.

Reconciled through the real API (`PATCH /api/admin/orgs/:orgId`, HTTP 200):
postal + legal address set to Dalvegur 10-14, 201 Kópavogur;
`main_contact_user_id` → `host@n1.is`; `notes` marks the org as test data
with no signed commercial agreement.

---

## 2. The driver-invite loop cannot be completed by the person invited

Confirmed at runtime, not inferred from reading. Every step below is a real
HTTP call against the real routers.

| Step | Result |
|---|---|
| `POST /api/admin/orgs/:orgId/driver-invites` as `host_admin` | **201** — invite minted, code returned |
| Placeholder user created by the invite | `audience=driver`, `status=active`, **0 credentials, 0 id_tokens** |
| `POST /api/driver/redeem-invite` with no session | **401** `unauthenticated` |
| `POST /api/driver/login` as the invitee | **401** `auth_failed` |
| `POST /api/public/register` with the invited email | **409** `email_taken` |

**The deadlock:** `createDriverInvite` find-or-creates the invitee as a
passwordless placeholder and sends no email. `POST /api/driver/redeem-invite`
is gated by `requireDriver`, so redemption needs a driver session the invitee
cannot obtain — they have no credential — and they cannot self-register their
way to one, because the placeholder already owns their email address. Minting
the invite is precisely what locks the invitee out.

The host-facing half works: the group list, the mint, the pending-invite list
and the tenant guards are all real and correct. The break is entirely on the
redemption side.

**Second finding, same run — the invite code is bearer-only.** A *different*
self-registered driver redeemed the code minted for the invitee and got
**HTTP 200**: `redeem-invite` grants the group membership to whoever presents
the code, never checking it against `UserToken.userId`. So the invite is
transferable to anyone it is forwarded to, and it burns (`used_at` set) on
that redemption — the intended invitee is left with nothing.

Neither is patched. Both are findings.

---

## 3. `createDriver` is unwired, and that is not the whole problem

`createDriver` (`apps/api/src/repositories/create-driver.ts`) is dead code —
nothing imports it; it sits in `.unused-exports-known.json`. It was written to
be the single definition of what a driver *is*, and no caller adopted it.

What that leaves, measured on this branch:

| Path | Credential | idToken minted |
|---|---|---|
| `registerDriver` (self-registration) | yes | `virtual_rfid` — via its own duplicate copy of `virtualRfidValueFromUserId` |
| `createUser` (`POST /api/admin/users`) | no | `rfid` (a card UID) — **no `virtual_rfid`** |
| `createDriverInvite` (host invite) | no | **none at all** |

**(a) This is a second, independent cause of thin attribution**, alongside the
auth-enforcement gap. Three paths, three different notions of driver identity,
and one that mints no token whatsoever. A driver with no `virtual_rfid` has no
idTag to present at a charge point, so their sessions cannot be attributed
back to them regardless of what the OCPP side does. Fixing enforcement alone
will not fix attribution while two of the three creation paths leave the
driver without the credential attribution depends on.

Un-parking `createDriver` is therefore not just tidying: it is one of the two
things standing between the host↔driver line and working attribution.

---

## 4. There is no agreement-creation surface — flat fee has nowhere to be set

The agreements API is read-only: `GET /`, `GET /:id`, `POST /debug-resolve`,
`GET /debug-options`, `POST /sessions/:id/resolve`. No create or update for
agreements, clauses, cost factors or rate references; the console `/agreements`
pages issue no mutations. Every agreement row in the database was written by
`apps/api/scripts/migrate-to-agreements.ts`.

No row was inserted and no surface was built — building one is a separate,
Rule-5-gated decision.

**Exclusion from billing, for the record:** `status='draft'` is the mechanism
and it is real. `loadAgreementContext` in
`apps/api/src/lib/agreement/persist.ts` hard-filters `status: 'active'` on
both the installation and workplace lookups, and *both* pricing entry points —
the per-minute cron `runAgreementsBillingTick` and the manual
`POST /sessions/:id/resolve` — load through that one function. A draft
agreement is structurally invisible to every pricing path. It is a status
flag, not an environment scope.

**(b) The correct home for the eventual flat fee already exists and is already
the right shape.** `N1 ehf — Straumvakt CPO services`
(`8c36643d-5b6d-4d87-b35b-22ed79fb01c0`, `agreement_type='service_cpo'`,
`status='active'`, **zero clauses**) is exactly the Straumvakt→host,
Straumvakt-as-principal line FOCUS rule 3 describes, and a flat connector fee
is a degenerate agreement on it: one cost factor, one rate reference. Nothing
to build now. Worth knowing it is already there, correctly shaped, and does
not need to be modelled again.

---

## 5. Test-data convention used

- **Email domain `@test.straumvakt.invalid`** — `.invalid` is an RFC 2606
  reserved TLD, so it can never resolve, never route to a real mailbox, and
  can never be confused with a customer address. This is the convention that
  `driver@n1.is` lacked, which is what made that record ambiguous.
- **`users.notes`** on every created row, naming the exercise, the date and
  the branch, and saying plainly: not a real person, do not bill, do not
  contact.
- **No schema flag was added.** `prisma/schema.prisma` is Rule 4 and was not
  touched.

Records created on the scratch branch: `n1.driver.test.01` through `.04`
`@test.straumvakt.invalid` (`.01`/`.02` from the first probe run, `.03`/`.04`
from the captured re-run).

---

## 6. Reproducing

The probe drove the real routers via the parity harness — only `makePrisma`
and `makeDrizzle` were mocked, and only because the Worker's Cloudflare/WASM
Prisma client cannot be instantiated under Node (see
`apps/api/test/parity/_harness.ts`). Auth was **not** mocked: sessions came
from the real login endpoints, so `requireAdmin`, `requirePermission` and
`requireDriver` all ran for real.

The probe file was deliberately **not** kept in `test/parity/` — it writes,
and a writing test with a branch guard would fail that suite for everyone
else.

`host@n1.is` and `driver@n1.is` were given the demo password by
`apps/api/scripts/set-demo-passwords.ts`, which hardcodes both addresses —
scratch branch only.
