# Commercial harvest + invoice ledger + the flat-fee line — DESIGN

**Status: DESIGN ONLY. Rule 5 stop. Nothing implemented, nothing moved.**
2026-08-08 · branch `dev/commercial-harvest`

Billing math, tariff resolution and cost computation are stop-and-summarise
work. This states **what changes, what breaks, and why it is correct**, and
then stops. No resolution logic is written or moved until this is approved.

---

## 0. The correctness that is not in the source

Read [`2026-08-07-first-priced-session.md`](./2026-08-07-first-priced-session.md)
before touching anything. The resolver looks unremarkable. It is not — it is
code that took three stacked bugs to get right, none of which are visible by
reading it:

1. **Attribution.** 8 of 1,619 completed sessions carried a `user_id`. The
   tick's predicate matched, the recency window did not.
2. **Every clause failed validation.** `allocation_json` says
   `"bearer_type": "USR"`; the enum and `BEARER_CODES` are lowercase. ADR 0019
   documents the JSON uppercase and the seeder followed it. JSONB is
   unconstrained, so **the resolver rejected every clause in the database for
   three months** and the failure mode was silence.
3. **Both suppliers were wrong.** `VEITUR-AD1` had a NULL `supplier_org_id`;
   the retailer rate pointed at N1 ehf (the site host) rather than N1 Rafmagn
   (the retailer). Distribution revenue credited nobody, energy revenue
   credited the landlord.

**A rewrite reintroduces all three.** That is the entire argument for harvest
over rebuild, and it is why the parity harness comes before the move.

---

## 1. What actually prices today

| file | lines | role |
|---|---:|---|
| `lib/agreement/types.ts` | 186 | vocabulary + the zod allocation schemas. **The case-folding fix lives here.** |
| `lib/agreement/resolve.ts` | 294 | pure functions: `buildLadder`, `pickActiveRate`, `resolveFactor`, `computeBillingLines`, `multiplyMinorByDecimal`, `halfUpDiv`. **No I/O.** |
| `lib/agreement/persist.ts` | 433 | `loadAgreementContext` (9 reads) + `resolveAndPersistForSession` (1 write) |
| `lib/agreement/billing-tick.ts` | 140 | `runAgreementsBillingTick` — candidate selection + batch driver |

**Callers:** `index.ts` (cron), `routes/admin/agreements-debug.ts`,
`routes/admin/agreements-resolve.ts`, `scripts/run-billing-tick.ts`,
`scripts/shadow-compare-resolvers.ts`.

The shape that matters: **`resolve.ts` is pure**. That is what makes parity
testable without a database, and it is why the harvest is tractable.

---

## 2. Harvest plan

### What copies

```
apps/api/src/lib/agreement/types.ts        →  packages/commercial/src/agreement/types.ts
apps/api/src/lib/agreement/resolve.ts      →  packages/commercial/src/agreement/resolve.ts
apps/api/src/lib/agreement/resolve.test.ts →  packages/commercial/src/agreement/resolve.test.ts
apps/api/src/lib/agreement/types.test.ts   →  packages/commercial/src/agreement/types.test.ts
```

**Phase 1 moves ONLY the pure core.** `resolve.ts` and `types.ts` have no I/O,
no ORM, no client. They copy byte-for-byte and their 566 lines of existing
tests copy with them.

**`persist.ts` and `billing-tick.ts` do NOT move in phase 1.** They carry 10
Prisma calls and the candidate-selection predicate. They move in phase 2,
after parity, and the port lands them on **Drizzle** — the tick is a
once-a-minute batch over tens of rows, which is control-plane, not hot path.

### Copy-then-re-export

`apps/api/src/lib/agreement/{types,resolve}.ts` become re-export shims:

```ts
export * from "@straumvakt/commercial/agreement/resolve";
export type * from "@straumvakt/commercial/agreement/resolve";
```

**The old path keeps running unchanged.** `persist.ts` imports the shim, gets
the harvested functions, and nothing else in the tree knows the difference.
Nothing is deleted. When the last caller imports commercial directly, the
shims go — and not before.

### What breaks

**Nothing, if the shim is right.** The risk is exactly one thing: `types.ts`
exports zod schemas (runtime values), so the shim needs both `export *` and
`export type *`. Getting that wrong is a compile error, not a silent
mis-price.

`packages/commercial` will depend on `@straumvakt/contracts` and `zod`. It
must **not** depend on `apps/api` — dependency-cruiser will enforce that, and
the direction is already correct because `resolve.ts` imports nothing but
`types.ts`.

---

## 3. The parity harness — designed before the move

**This is built and green BEFORE any file copies.** It is the whole point.

### `test/parity/commercial-resolver-parity.test.ts`

**Method:** import the OLD resolver from `apps/api/src/lib/agreement/resolve`
and the NEW one from `packages/commercial/src/agreement/resolve`, run both
over identical inputs, assert byte-identical output.

Not "similar" — **identical**. These are pure functions over integers and
decimal strings; there is no legitimate reason for them to differ, so any
difference is a bug rather than a judgement call.

### The known-good rows it checks

| corpus | where | what it proves |
|---|---|---|
| **64 sessions / 128 lines / 19,264.97 ISK** | test branch `br-withered-hat-abtc5gzi`, `agreements.billing_lines` | The only rows the agreements engine has ever produced. Re-resolve each session's inputs through both resolvers; both must reproduce the stored line exactly — amount, VAT, basis quantity, bearer, recipient, rate ref. |
| **1,621 rows** | staging `reports.session_ledger` | The legacy generation's output — the only priced record of real sessions. This is **CO-3** (ADR 0048 step 2), still unrun. It is a *shadow comparison*, not an equality assertion: legacy and agreements are different models and are expected to differ. What it must produce is an explained delta per row, not a match. |
| **the three trap cases** | fixtures | Uppercase `"USR"` in `allocation_json` still resolves; a NULL `supplier_org_id` still yields a line with no recipient rather than throwing; a rate whose `effective_from` is after the session end is not selected. |

### Vacuity guard

The harness asserts a **non-zero comparison count** and fails if it is zero. A
parity test that silently compares nothing is worse than no test — that
mistake has already been made twice in this repo's parity suite and both times
the guard caught it.

### Exit criterion for the harvest

Old path retires only when: parity green over all 128 known lines, CO-3 run
with its delta explained, and `runAgreementsBillingTick` producing identical
output through the harvested resolver for one full cron cycle on the test
branch.

---

## 4. Invoice ledger design

### The shape already fits

**`agreements.billing_lines.session_id` is already nullable, and
`billable_event_type` already exists defaulting to `"session"`.** The ledger
does not need reshaping to carry a non-session line. That is lucky rather than
foresighted, and it is worth not squandering.

### What is missing: the money-line tag

Today a line carries `bearer_type` / `bearer_ref` (who pays) and
`recipient_org_id` / `recipient_user_id` (who is paid). That is *nearly* the
money-line shape from `@straumvakt/contracts/money/lines` — but **posture is
absent**, and it must not be derived.

The tempting derivation is "recipient == Straumvakt ⇒ principal." It is wrong:
ADR 0031's amendment makes posture a property of the **agreement**, not of the
parties. Straumvakt can be agent on one line and principal on another with the
same two parties.

**Proposed addition (additive, nullable, no backfill required):**

| column | type | why |
|---|---|---|
| `posture` | enum `agent`\|`principal` | The legal artefact depends on it. Never inferred. |
| `whose_money_kind` | enum `org`\|`user`\|`platform` | Mirrors `PartyRef` so a platform line needs no sentinel org row. |

`whose_money_ref` is the existing `recipient_org_id` / `recipient_user_id`.
`counterparty` is the existing `bearer_*`. So the tag is **two new columns**,
not a new table.

### Invoice generation

**There is no invoice table.** The `invoices` / `invoice_lines` / `statements`
scaffold was dropped on 2026-08-07 — 0 rows, 0 writers, and money-line-blind.
Re-creating it is part of this work, and this time the header is derived from
the line's posture rather than assumed.

**Grouping rule — this is the correctness that matters:**

> An invoice groups ledger lines by **(claim holder, counterparty, period)**.
> **Lines with different postures may never share an invoice.**

Because the header differs:

| posture | header | who is kröfuhafi |
|---|---|---|
| `principal` | Straumvakt's own invoice | Straumvakt |
| `agent` | "Straumvakt f.h. \<host\>" | the host |

A single document mixing both would misstate who is owed the money — and in
Iceland the kröfuhafi on a claim is a legal fact, not a display string.

`claimHolder(line)` in contracts is already derived rather than stored, so the
grouping key and the header cannot disagree.

---

## 5. The flat-fee principal line

### Shape

| | |
|---|---|
| agreement | Straumvakt ↔ host, `agreement_type = service_cpo` |
| factor | one platform-fee cost factor |
| rate reference | one, per-connector, time-boxed |
| basis | **connector count**, not energy and not time |
| cadence | monthly |
| money line | `{ whoseMoney: platform, posture: principal, counterparty: org }` |
| CDR | **none** |
| attribution | **none** |

### Why it needs no CDR

The fee is *per connector, per month*. Its basis is a **count of rows in
`assets.connectors` scoped to the org**, not a sum over sessions. That is why
it ships first: it does not need `user_id` on a session, which is the gap that
blocked billing for three months.

### `basis_type` — the one open question

`RATE_BASES` is `per_kwh | per_minute | per_day | per_session`. **A
per-connector basis is not in the enum.**

Two options, and I recommend the first:

- **(a) Add `per_connector` to `RATE_BASES`.** Honest, one enum value, and the
  resolver's basis switch gets one arm. The line then says what it is.
- (b) Reuse `per_day` with quantity = connector-days. Requires no enum change
  but makes every invoice line lie about its unit, and someone will read it.

**(a).** The enum exists to describe reality; adding a real basis to it is
cheaper than a permanent misstatement.

### Re-priceable at renewal

First-comer pricing is a **rate reference with an `effective_until`**, not a
number in code. Renewal is a new rate reference on the same agreement with a
later `effective_from`. `pickActiveRate` already selects by time window and is
already tested — this needs no new mechanism, which is the point of using the
real engine.

### VAT

Straumvakt is principal, so this is **Straumvakt's own output VAT** — not
presented on anyone's behalf. The existing `vat_rate_pct` /
`vat_amount_minor` / `amount_inc_vat_minor` columns carry it, and
`finalizeLine`'s half-up rounding already has hand-computed test coverage.

---

## 6. Correctness test plan for the flat-fee line

Separate from parity — parity proves *unchanged*, these prove *correct*.

| what | test |
|---|---|
| **amount** | 3 connectors × rate = expected minor units, hand-computed, no `toBeCloseTo`. Zero connectors ⇒ **no line at all**, not a zero-amount line. |
| **VAT** | 24% half-up on the ex-VAT amount; `ex + vat == inc` exactly, asserted as integers. |
| **posture** | the emitted line carries `posture = principal`, `whoseMoney = platform`. Asserted, never inferred. |
| **header** | an invoice built from these lines names Straumvakt as kröfuhafi; a fixture agent line in the same period produces a **separate** invoice. This is the grouping rule's test. |
| **time-boxing** | a rate whose `effective_until` has passed is not selected; a renewal rate takes over at its `effective_from` with no gap and no overlap. |
| **idempotency** | running the monthly job twice produces one set of lines. `resolveAndPersistForSession` already has this property for sessions; the flat-fee job needs its own key — proposed: unique on `(agreement_id, billable_event_type, period)`. |

All of it runs against real Postgres in a rolled-back transaction, per the
pattern the parity suite already uses.

---

## 7. The metered CDR feeder — shaped for, not built

**One ledger, N feeders, no reshape.** The seam:

```
   ┌─ flat-fee job (monthly, per-connector)  ──┐
   │                                           │
   ├─ session resolver (per CDR)  ─────────────┤──►  agreements.billing_lines
   │   [live, proven, harvested]               │      (money-line tagged)
   │                                           │              │
   └─ future: reservation / idle / access  ────┘              ▼
                                                     invoice grouping
                                                  (claim holder, counterparty, period)
```

A feeder's only contract is: **emit a money-line-tagged ledger line.** It does
not know about invoices, and the invoice layer does not know which feeder
produced a line.

When attribution un-parks — immediately after the first invoice, per FOCUS.md
— the host↔driver line arrives as **`posture: agent`** through the *same*
resolver that already works, into the *same* ledger. The only new thing is
that the invoice grouping starts producing a second document with a different
header. **That is a data change, not a reshape.**

What must be true now for that to hold, and is:

- `session_id` nullable ✅ (already)
- `billable_event_type` present ✅ (already)
- posture on the line ⬅ **the one addition this design proposes**
- grouping by claim holder, not by "the host invoice" ⬅ **design, not code**

---

## 8. Summary — what changes, what breaks, why correct

**Changes:** four pure files copy to `packages/commercial` behind re-export
shims; two nullable columns are added to `agreements.billing_lines`; one enum
value is added to `RATE_BASES`; an invoice layer is designed (not built).

**Breaks:** nothing, if the shims carry both value and type exports. The old
path runs unchanged throughout. No existing row is rewritten — both new
columns are nullable and no backfill is required.

**Why correct:** the resolver's earned correctness is preserved by copying
rather than rewriting, and proved by a parity harness that must be green
before the copy is trusted. The flat fee uses the real engine with a real
agreement, so there is no second billing path and no fourth generation.
Posture is stored rather than inferred, so the invoice header — the legal
artefact — cannot be derived wrong.

**Sequencing, gated:**

1. Build the parity harness. Green over 128 known lines. *(no move yet)*
2. Run CO-3; explain the delta. *(operator, Rule 5)*
3. Copy the four pure files; shims in place; parity still green.
4. Add the two columns + the enum value. *(schema, needs approval)*
5. Build the flat-fee job and the invoice layer with the tests in §6.
6. Port `persist.ts` + `billing-tick.ts` to Drizzle and move them. Retire the
   shims.

**Not in this design:** attribution, the agent line's mechanics, driver-facing
invoices, remittance, DSO-by-address, retailer choice. All parked, all
un-parked by the first invoice.

---

# Addendum — bearer / circuit schema discovery (2026-08-08)

**Read-only. No schema change, no resolver change.** Informs Phase 2 design.

## B6 — can an arbitrary third-party org be the bearer?

**Partly. There is a dedicated code for it, the plumbing carries it, and one
path collapses it.**

### What exists

`BEARER_CODES = ["org", "usr", "wrk", "trd"]` — **`trd` is "third party"**, a
first-class bearer code, not an afterthought. The Postgres enum
`agreements."BearerType"` carries `["org", "usr", "trd"]`.

**The enums differ, deliberately.** TypeScript has four codes; the database
has three. `persist.ts:403` maps on the way in:

```
storageBearerType = l.bearerType === "wrk" ? "org" : l.bearerType
storageBearerRef  = l.bearerType === "wrk" ? workplaceOrgId : l.bearerRef
```

So `wrk` (workplace) is stored as `org` + the workplace's org id. `trd`
passes through unmapped. **A third-party org bearer is representable today**:
`bearer_type = 'trd'` with `bearer_ref` = that org's uuid.

`bearer_ref` is a nullable uuid on both `agreements.bearer_rules` and
`agreements.billing_lines`, and the resolver carries it from
`allocation_json.passthrough.splits[].bearer_ref` (`resolve.ts:170`) or the
clause default (`:53`). Nothing constrains it to the host.

### Where "org" IS implicitly the host

**`resolveRecipientOrgId` (`resolve.ts:273`) — the MARKUP recipient only:**

```ts
if (recipient === "org") return ctx.cpoOrgId;      // ← the agreement's CPO
if (recipient === "wrk") return ctx.driverGroup?.ownerOrgId ?? null;
return null;
```

Markup can only be *received* by the CPO or the workplace. `allocationMarkupSchema`
enforces it at the type level too: `recipient_type: z.enum(["org", "wrk"])` —
**`trd` is not a permitted markup recipient.**

By contrast the **passthrough** recipient is `rate.supplierOrgId` — genuinely
arbitrary, which is how Veitur and N1 Rafmagn get credited.

### So, precisely

| | third-party org supported? |
|---|---|
| bearer (who **pays**) | **Yes** — `trd` + `bearer_ref` |
| passthrough recipient (who is **paid**) | **Yes** — `rate.supplier_org_id`, any org |
| markup recipient | **No** — CPO or workplace only, enforced by the zod enum |

### Admin/UI surface

**There is effectively none.** Every file touching bearer assignment:

- `src/app/(app)/agreements/debug/debug-form.tsx` — a **debug** form
- `src/app/(app)/agreements/[id]/page.tsx` — read/display
- `apps/api/src/routes/admin/agreements-debug.ts` — the debug endpoint

No operator surface creates or edits a `bearer_rule`. `agreements.bearer_rules`
has **0 rows**, which is consistent: the capability exists in schema and
resolver and has never been exercised, because nothing can author one.

*No fix proposed, per the brief.*

## B7 — can a bearer or cost-center attach at Circuit level?

**Yes. It already exists, and the resolver already walks it.**

- `RULE_SCOPES = ["site", "installation", "circuit", "charger"]` and the
  Postgres enum `agreements."RuleScopeType"` carries the same four.
- `billing."CostFactorAnchor"` carries `circuit` among seven anchors.
- `SessionContext.circuitId` is populated by `loadAgreementContext`.
- `buildLadder` (`resolve.ts:96`) filters
  `if (r.scopeType === "circuit" && r.scopeId !== ctx.circuitId) continue;`
  and ranks it at **scopeTier 2** — more specific than installation (3) and
  site (4), less than charger (1).

So a bearer rule scoped to a circuit resolves correctly today, ahead of an
installation-scoped rule and behind a charger-scoped one. **No new hook is
needed.**

The gap is the same as B6: **nothing can author such a rule.** The capability
is real, tested by the resolver's own suite, and unreachable from any
operator surface.

*Note for ADR 0045: `properties.circuits.parent_circuit_id` remains
unpopulated by decision, so the graph is currently flat. Circuit-scoped rules
match a circuit exactly — they do not walk upward to a parent. If topology is
ever populated, whether a rule on a root circuit should apply to its children
is an open question this pass does not answer.*

## What this means for Phase 2

1. The bearer model is **more capable than the surface** — `trd` and
   circuit-scope both work and neither is reachable.
2. The one real constraint is **markup recipients**, capped at CPO/workplace
   by a zod enum. Widening that is a Rule 5 change to money flow, not a
   schema tweak, and ADR 0031 deliberately set it that way.
3. Neither finding blocks the flat-fee line, which is `org`-bearer,
   `principal`-posture, and uses no markup at all.
