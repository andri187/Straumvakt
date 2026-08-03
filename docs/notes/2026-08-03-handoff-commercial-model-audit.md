# Handoff — 2026-08-03

Written at the end of a long session, for whoever picks this up next.
Ordered by urgency, not by interest.

---

## 1. Deadline — partitions run out 2026-08-09

`protocol_log` and its 7 partitions are **live on staging**
(`br-tiny-river-abgpqq37`). Three things are unfinished and one has a
date on it.

- **`prisma/schema.prisma` and `apps/api/prisma/schema.prisma` are
  uncommitted** (+206 / −8). They hold the `ProtocolLogEntry` model.
  Already-committed routing code **does not build without them**.
  Last modified 2026-08-02 21:51 and static since — earlier notes called
  them "entangled with concurrent work", which is no longer true. They
  are simply uncommitted. This is the blocking item.
- **Deploy gateway BEFORE `apps/api`.** Reversed, the old gateway stamps
  `raw_protocol` on every OCPP frame and OCMF billing evidence lands in
  the 7-day table.
- **R2 retention backfill is not written.** The Postgres reclassification
  does NOT make R2 safe — retention class is baked into the object key
  (ADR 0037), so existing objects still carry the old classification.
- **Open question:** ADR 0040 D1 encodes a 3-day heartbeat window; the
  operator said "no reason to keep heartbeats more than 7 days". 3 is
  under the ceiling but was never explicitly confirmed, and it changes
  the partition schedule.

---

## 2. The main brief — audit the commercial model

**This is the highest-value work left.** It decides how money is
calculated, which is the one failure customers see.

Listing the commercial models in `prisma/schema.prisma` shows what look
like **three generations coexisting**:

| Layer | Models |
|---|---|
| Oldest | `Tariff` (1880), `BillingTransaction`, `Invoice`, `InvoiceLine` |
| Contract family | `CostFactor` (2819), `TariffDefinition`, `CostCenter`, `Contract`, `ContractFactorAssignment`, `DriverContract`, `DriverContractFactorOverride`, `ContractPeriodAccumulator`, `BillingLine` (3054), `BillingPeriodSummary` |
| Agreement family | `Agreement` (3359), `AgreementClause`, `AgreementCostFactor` (3305), `RateReference` (3326), `AgreementBillingLine` (3626) |

The same concept appears to be modelled twice:
`BillingLine` / `AgreementBillingLine`, `CostFactor` /
`AgreementCostFactor`, `Tariff` / `TariffDefinition`.

**This is inference from model names only. Nobody has read these files.**
`Contract` and `Agreement` may be legitimately different — a host
contract versus an inter-org commercial agreement. But duplicated cost
factors and duplicated billing lines are hard to explain benignly.

### The questions the audit must answer

1. Which generation is **live**, which is **dead**, which is
   **half-migrated**? Find the readers, not just the models.
2. Is `Contract` vs `Agreement` a real distinction or a migration that
   stalled?
3. **DSOs and electric retailers have no entity at all.** Veitur ohf (the
   DSO, deliberately kept during the org cleanup despite 0 chargers) is
   an `Organization`. So "who is the DSO for this site" and "which
   retailer supplies this property" are answered by convention, not
   structure — in the chain ADR 0031 must produce a defensible invoice
   from.
4. Can the full cost chain be expressed end to end without dead ends:
   DSO → retailer → host → driver?

**Rule 5 throughout.** This is tariff resolution and billing math.
Stop-and-summarise before any code.

---

## 3. Schema hardening — the analysis is done, nothing is applied

[`2026-08-03-prisma-schema-audit.md`](./2026-08-03-prisma-schema-audit.md)
— 10 findings, **none applied**.

The unifying insight, which arrived late in the session and is the real
organising principle:

> **Shape belongs in the schema; ceremony belongs in one function.**
>
> Once a rule is a constraint, it stops mattering how many code paths
> exist — they cannot disagree. Findings 2, 3, 4, 5 are all the same
> disease: the rule lives in code or nowhere, so every path picks
> differently and none of them is wrong.
>
> Most of the chaos is shape, not ceremony. Shape is enforceable and
> permanent; ceremony depends on discipline.

Recommended order (the audit's own ranking):

- **F2** — `tap_intents` has zero FKs and its migration is *NOT YET
  APPLIED*. Three FKs cost nothing today, a data-repair migration
  tomorrow. Cheapest high-value fix in the audit.
- **F3** — no unique on `OcppIdentity(vendor, vendorResourceId)` while
  four call sites treat it as canonical, with no `orgId` filter.
  Cross-tenant correctness *and* a hot-path index gap.
- **F1** — flagged *exploitable now*. ADR 0031 §18's conditional-kennitala
  rule is unenforced; `group_owner_user_id` does not exist (zero grep
  hits). A NULL-kennitala user with no group binding is insertable and
  nobody owns their invoice.

---

## 4. `createDriver` — written, compiles, **dead code**

[`apps/api/src/repositories/create-driver.ts`](../../apps/api/src/repositories/create-driver.ts)
exists and `tsc --noEmit` on `apps/api` is clean. **Nothing imports it.**
All five original creation paths are intact and in use, so the count
went from five to six.

| Path | vRFID today |
|---|---|
| `registration.ts:157` — self-enrollment | **yes**, the only one |
| `users.ts:187` — admin create | no |
| `invites.ts:97` — invite consume | no |
| `host-invites.ts:180` — host invite consume | no |
| `admin-bootstrap.ts:61` — first-run | no |

### Calibration — this is a defect with zero current impact

The vRFID on `driver@n1.is` was created **by hand during this session**,
not issued by code. Nobody has self-registered, so no driver has ever
received one organically. There are essentially no real drivers.

So it is not a live bug — it is a defect that becomes real the moment
customers arrive via invite or host-invite. That argues for fixing it now
because it is **cheap**, not because it is urgent: today it is a code
change; after launch it is a code change plus a backfill plus support
tickets from drivers whose app will not start a charge.

### Remaining work

1. Rewire **`registration.ts` first** — it is the only path with tests
   asserting vRFID creation. If those tests pass unchanged, that proves
   `createDriver` reproduces known-good behaviour before it carries the
   four untested paths.
2. Rewire `users.ts`, `invites.ts`, `host-invites.ts`.
3. **`admin-bootstrap.ts` needs a decision** — it creates an *operator*,
   not a driver. It probably should not call `createDriver` at all. This
   is what surfaced the `createUser` question below.
4. Delete `virtualRfidValueFromUserId` from `registration.ts` — it is
   **duplicated in both files right now**, which is a small instance of
   the exact problem this was meant to fix. Harmless while the new one is
   unreachable; must not survive the rewiring.
5. Persist `source` — declared in the input type, never written. `User.metadata`
   is the obvious home; the shape was not guessed on a blind write.

### Design decisions already made, do not relitigate

- **The vRFID derivation was deliberately NOT changed.** It still follows
  ADR 0022 (first 20 hex chars of `User.id`, uppercased, hyphens
  stripped). The operator prefers a random unique value and that is the
  better design — but consolidating and changing the rule at once would
  make a failure impossible to attribute. It is now a one-line change in
  one function instead of a five-file one, which was the point.
- **`source` is metadata, never control flow.** The moment an
  `if (source === ...)` appears in `createDriver`, it is five paths again
  wearing one name.
- **Branch on what is created, not who creates it.**
  `if (audience === 'driver')` is a legitimate type discriminator;
  `if (source === 'admin')` is the poison.
- **`createDriver` takes `PrismaClient | Prisma.TransactionClient`** and
  does not open its own transaction, so it composes inside a caller's.
  Same convention as `createUserToken` in `user-tokens.ts`.
- **No generic `createEntity` parent.** A universal factory can only hold
  what entities share — a row with an id — and the invariants are the
  whole point. A `createUser` base underneath `createDriver` /
  `createOperator` is real and probably right, but **extract it after the
  rewiring**, from two working implementations rather than one.

---

## 5. Token kinds — smaller than previously described

`app_jwt` and `magic_link` sit in `IdTokenKind` alongside charge-point
credentials. Earlier in the session this was described as a live
vulnerability requiring a `kind` filter on the Authorize path. **That was
overstated**, and the correction matters:

`registration.ts:203-208` shows the email-verify token is written via
**`UserTokenKind`** — the `user_tokens` table, correctly — merely
labelled `magic_link` with `metadata.purpose='email_verify'` because the
regenerated enum lagged and lacked `email_verify`.

So `magic_link` and `app_jwt` in `IdTokenKind` appear to have **zero
writers**: pure enum debt, deletable with no data migration. **Verify the
row count in `id_tokens` before deleting** — the claim is from grep, not
from the database.

Doing so makes `id_tokens` structurally incapable of holding a login
credential, which removes the need for a `kind` filter entirely — a
guard you must remember at every call site becomes a property of the
table.

`user_tokens` is well built: per-token TTL, plaintext returned once and
never persisted, 160 bits of entropy, 32 chars. That last detail is a
useful property — an OCPP `idTag` is capped at 20, so a token from that
table physically cannot be presented to a charger.

---

## 6. Duplicated creation workflows — surveyed, not investigated

Counting creation sites per model across `apps/api/src`:

- **Charger provisioning — 4 paths, 4 entities deep.**
  `chargingStation`, `ocppIdentity`, `connector`, `eVSE` each have
  exactly 4 creation sites, and for the two traced it is the same four
  files: `chargers.ts`, `credential-management.ts`,
  `onboarding-chains.ts`, `zaptec-import.ts`. Structurally worse than the
  driver case — four entities that must stay mutually consistent.
- **Sessions — 3 paths:** `projections.ts` (OCPP live),
  `zaptec-session-sync.ts` (poll), `webhooks/zaptec.ts` (push).
  **Probably legitimate** — the `ocpp_energy_kwh` / `cdr_energy_kwh` /
  `amqp_energy_kwh` columns exist precisely because three sources report
  the same session and get reconciled. Verify before touching.
- **Circuits — 3 paths**, none able to express a parent. Relevant to
  ADR 0045: when `parent_circuit_id` lands it has three sites to be
  forgotten in.
- `userCredential` 4, `userToken` 4, `idToken` 4 — same shape, security
  surface.

**Raw counts are not proof of duplication.** An `upsert` in a vendor sync
and a `create` behind an admin form are legitimately different. The
signal worth trusting is the *identical count across related entities*.

---

## 7. Also open

- **`sessions.id_token_id`** (ADR 0044 D6) — one nullable FK,
  `ON DELETE RESTRICT`, plus backfill, both Prisma schemas, and capture
  in `projections.ts` (Rule 5). Resolve the token at **StartTransaction**.
  Note it would need capturing in **three** session-creation sites, not
  one — a concrete cost of the duplication above.
- **ADR number collision** — two files numbered 0044
  (`driver-side-capabilities…` and `local-charger-control-over-ble`).
  One needs renumbering.
- **UI payload / query cost** — never measured. The hypothesis: growth
  hurts `COUNT(*)`, aggregates and deep `OFFSET`, not indexed bounded
  list queries. If so the fix is caching/precomputation (ADR 0038's
  serving tier), not archiving — archiving a slow unbounded query hides a
  missing `LIMIT` rather than fixing it. **Measure before designing.**
- **ADRs 0037 / 0039 / 0040 / 0042 / 0043 / 0044 / 0045 are all still
  `Proposed`.** Three of them are running in staging on operator
  authorisation, but nobody has said the design is right.
- **Azure/AMQP bus is completely parked** — spend no effort on it.

---

## 8. Heartbeats — parked at 3 days, but the better answer is known

**Operator, 2026-08-03:** heartbeat retention stays at ADR 0040's 3 days
for now. Explicitly parked as a low-priority detail, not decided against.

The better model, raised and deferred in the same breath: **do not log
heartbeats at all.** A heartbeat carries one bit — *this charger is alive
now* — which is a timestamp on a row, not a row of its own. At 1000
chargers, writing 1.44M rows/day records the same fact 1,440 times per
charger per day.

What matters is the **gap**:

- heartbeat arrives → `UPDATE last_seen_at`, no row written
- expected and absent → one event: charger offline
- returns → one event: charger recovered

Better information from far less data — "downtime last month" becomes a
handful of queryable rows instead of an unqueryable firehose.

**Implementation catch:** absence is not an event. A heartbeat that does
not arrive generates nothing by itself; something must notice. Either the
Durable Object sets an alarm when its window lapses (cleaner — it already
holds the connection) or a sweeper scans `last_seen_at` on a schedule.

**If adopted this would:** make the 3-vs-7-day question moot, render
~347k current `raw_protocol` rows deletable, largely remove the partition
pressure behind the 2026-08-09 date, and require amending ADR 0040 §D1.
