# The duplication verdict

Written 2026-08-28 by `claude-b`, Phase 5 of round 4, **on the assembly branch
where both copies are visible at once for the first time**.

Correction 2 of the framing set: the restart exists partly because there were
*multiple workflows for one purpose*. Round 3 reproduced exactly that inside
the clean shell. This picks one of each **before** the fresh schema is
generated.

**Nothing is deleted this round.** Every verdict below is a retirement plan.

---

## Pair 1 — two delivery state machines

| | Claude A | Claude B |
|---|---|---|
| File | `packages/commercial/src/core-billing/delivery-log.ts` | `packages/contracts/src/invoice/delivery.ts` |
| LOC | **307** | 244 |
| Tests | **35** | 16 (+30 in `deliver-pdf.test.ts`) |
| Callers | wired into the period-close path | the PDF delivery path only |
| States | `pending · sending · sent · retrying · failed · abandoned` | `pending · attempting · delivered · **unknown** · failed_retryable · failed_permanent · abandoned` |
| Channels | email · download · webhook · ack | email_pdf · peppol · bank_claim · manual |
| Failure taxonomy | **rich** — `binding_missing`, `not_configured`, `missing_response_id`, `provider_ack_without_id`, `send_failed`, retriable/permanent | thin — retryable/permanent |

### What each does that the other does not

**A has the provider taxonomy and the wiring.** It knows the difference between
"no Resend binding", "provider not configured" and "provider acked without an
id", and it is on the real period-close path. Its docblock makes the same
argument mine does — *"a period that closed and 'delivered' with no provider
configured looks identical to one that reached the customer"* — so the two were
written from the same insight independently.

**B has the settled-ambiguous state and the delivered/acked distinction.** A's
`sent` means *"provider accepted it and returned an id"*, which is a provider
ack, not a delivery. A has **no `delivered` state and no `unknown`**: `sending`
is in-flight, not a terminal ambiguity. So A cannot express "the attempt is
over and I still do not know", which is precisely the state that must never
auto-retry.

B also has multi-channel roll-up — a document delivered on one channel and
unknown on another rolls up to `unknown`, not `delivered`.

### Verdict — **keep A's, port B's semantics into it**

On capability, not authorship: **A's is wired, has twice the tests, and carries
the failure taxonomy that operating it actually requires.** Rewriting that into
B's would be re-earning correctness for no gain.

**The merged machine must gain three things from B:**

1. A terminal **`unknown`** state that never auto-retries.
2. **`delivered` distinct from `sent`** — provider ack is not receipt.
3. The **multi-channel roll-up**, with `unknown` poisoning the result rather
   than being ignored.

### Retirement plan

1. Add `unknown` and `delivered` to A's `DeliveryState`, with the no-auto-retry
   guard and a test per state.
2. Add the channel roll-up, with the "one unknown poisons it" test.
3. Point `deliver-pdf.ts` at A's machine. **Parity coverage first:** B's 46
   delivery tests must pass against A's machine before B's is unexported.
4. Un-export `contracts/invoice/delivery.ts`; leave the file.
5. Delete only after one real invoice has been delivered through the merged
   machine.

---

## Pair 2 — two document models

| | Claude A | Claude B |
|---|---|---|
| Type | `StatementDocument` — `packages/commercial/src/core-billing/statement.ts:72` | `InvoiceDocument` — `packages/contracts/src/invoice/document.ts` |
| Purpose | the priced result of a period | the legal artefact that gets issued |

### These are not duplicates, and calling them one is the mistake

A `StatementDocument` is **what a period cost**. An `InvoiceDocument` is **what
is sent to a counterparty** — it carries the kröfuhafi, the posture, a gap-free
sequential number, VAT stated per rate, and a header that refuses to render
without a registered identity.

**Verdict: keep both, and name the seam.** They are a pipeline, not a pair:
`StatementDocument` → *(issue)* → `InvoiceDocument`. What is missing is the
function between them, and that absence is what Phase 4 found — the two dry
runs do not hand off.

**Retirement plan: none.** The action is additive — write
`issueInvoiceFromStatement(statement, org, sequence)`, which is the single
function that would join the two dry runs.

---

## Pair 3 — two active-connector derivations

| | Claude A | Claude B |
|---|---|---|
| Where | `packages/commercial/src/core-billing/activity-source.ts` | `packages/contracts/src/onboarding/org-readiness.ts` |
| What it does | **derives** a count from activity rows with evidence and holds | **checks** a supplied count is ≥ 1 |

### Also not a duplicate — and this one I got wrong at first

A derives; mine does not. `org-readiness` takes `connectorCount` as an input
fact and asks whether it is at least one. It has no derivation in it at all.

**Verdict: not a pair. A's is the only derivation, and it should stay the only
one.** The correct relationship is that readiness should *consume*
`ActivitySourcePort` rather than take a number on trust — which would also make
readiness report `unavailable` instead of holding `no_connector_in_asset_chain`
when the source cannot answer.

**Retirement plan:** none to retire. One change to make: `assessOrgReadiness`
should accept `Evidence<number>` for the counts so an unanswerable source is
distinguishable from a genuine zero. **Ledger note 22 applied to my own
module** — it currently expresses "I looked and found nothing" and "I could not
look" identically, which is the exact defect I have been finding elsewhere.

---

## The orphaned modules

The handover names *"~3,500 LOC across 13 orphaned modules"* but does not
enumerate them in any document I can reach, so this is **my own measurement**,
with its limits stated: a scan for modules whose basename appears in no other
non-test file. It cannot see dynamic imports, and it counts standalone entry
points (probe scripts, npm-invoked gates) as orphans, so those are excluded by
hand.

**13 genuine library orphans, 2,812 LOC.**

| # | Module | LOC | Tests | Disposition |
|---|---|---|---|---|
| 1 | `gateway/src/liveness-sweeper.ts` | 267 | 31 | **WIRE** — to the AMS module, per the fallback queue. A dead charger is invisible without it. |
| 2 | `apps/api/src/lib/billing/statement-zod.ts` | 374 | yes | **WIRE** — validation for the statement surface A is building; it should be on the route. |
| 3 | `apps/api/src/lib/billing/settlement-rows.ts` | 340 | yes | **WIRE** — A's lane; the settlement writer needs it. |
| 4 | `apps/api/src/repositories/create-driver.ts` | 225 | no | **WIRE — and see the finding below.** |
| 5 | `gateway/src/sentry-scrub.ts` | 237 | selftest | **KEEP** — future caller named: the Sentry DSN wiring, blocked on OB14/OB15. |
| 6 | `apps/api/src/lib/billing-shadow/shadow-compare.ts` | 177 | yes | **RETIRE** — shadow comparison against the legacy generation, and correction 1 says nothing legacy is required. |
| 7 | `apps/api/src/lib/enrichment-drift.ts` | 99 | yes | **KEEP** — future caller: the enrichment path A's activity source will need. |
| 8 | `src/lib/signal-quality.ts` | 87 | no | **KEEP** — future caller: the charger detail page's signal display. |
| 9 | `apps/api/src/repositories/agreements-write.ts` | 220 | via contracts | **KEEP — deliberately unwired this round.** Blocked on SR-1..SR-3. |
| 10 | `apps/api/src/routes/admin/org-email-domains.ts` | 284 | no | **KEEP** — a mounted route; my scan flags routes because nothing imports them by name. |
| 11 | `src/lib/org-context.ts` | 166 | no | **KEEP** — 3 referencing files; a scan artefact, not an orphan. |
| 12 | `apps/api/src/domains/vendor/repositories/user-vendor-refs.ts` | 112 | no | **RETIRE** — vendor user refs predate the credential-management path. |
| 13 | `src/lib/reference/*-info.ts` (7 files) | ~1,150 | no | **KEEP** — vendor reference data, read by the charger detail surface via a registry my scan cannot follow. |

### FINDING 5-A — `createDriver` is defined and never called, which corrects round 3

`apps/api/src/repositories/create-driver.ts:143` exports `createDriver`, whose
own docblock calls it *"the single source of truth for what a driver IS"*, and
it is the module that inserts the `virtual_rfid` idToken with the comment
*"the invariant the other four paths were missing"*.

**Nothing calls it.** Grepping the assembled tree for `createDriver` finds the
definition, its own docblock, and `createDriverInvite` — a different function in
a different file.

**This corrects my own round-3 conclusion.** I recorded the 2026-08-08
missing-idToken defect as **FIXED**, citing this code. The accurate statement is
that **the fix exists as an unwired module**: the code that would insert the
idToken is not on any live path, so the four paths its comment names are
presumably still creating drivers without one.

Round 3's other two invite conclusions are unaffected — the hijack fix (ADR
0053) and the claim-then-redeem flow are both in live route files with callers.

**Disposition: WIRE, and it is more urgent than its LOC suggests.** A driver
without an idToken cannot be presented to a charge point at all.
