# Review: first-charger integrity increment

**Scope:** targeted review of start/removal, historical terms and late evidence in the uncommitted checkout. This is not a complete release review. `E:\Claude\Straumvakt`, branch `fix/drizzle-unique-constraints-2026-10-26`, HEAD `15c036f7de0d7b8c948d6cc64fef757b7d79935f`. Existing work preserved; no database, cloud or hardware action.

## P1: refused start can make an active session non-gating

**Verified with a local memory-store reproduction, not on PostgreSQL.** In `src/lib/ocpp-engine/transactions.ts`, after `startGate` refuses a new start during removal, the code still marks every open transaction on the connector `superseded_by_new_start` before recording the refused request. `src/lib/lifecycle/drizzle-store.ts` excludes that flag from the open count and `src/lib/lifecycle/plan.ts` excludes superseded sessions from stop actions. Therefore a blocked or invalid StartTransaction can change an actually open authorized session into a non-gating held session; progress could subsequently close the placement without sending or confirming a stop for that original session. This conflicts with the user's active-session removal requirement. The original session must not be treated as safely superseded simply because a refused request was received; preserve evidence for the refused request independently and verify an actual stop or explicit safe reconciliation path.

Reproduction: `src/lib/ocpp-engine/review-refused-start.test.ts` starts an authorized session, enables the removal block, issues another start, verifies the response is `Blocked`, and asserts that the first session remains unflagged. The test **fails**: the first session's flag is `superseded_by_new_start`. The proposed downstream impact is inferred from the production planner/count predicates; an integrated PostgreSQL test is still needed. Similar handling of other rejected/invalid starts also needs review.

## P1: unresolved-session removal and late stop need a complete recovery contract

The planner lets an unconfirmed superseded session stop gating and completes removal with a held settlement; admission refuses a closed identity and there is no post-close recovery path or operator reconciliation route. An already-open socket may report a late stop, but reconnect after identity closure cannot deliver it through normal admission; the completed request's planner also short-circuits. A held label does not establish that a physical session ended or that the driver will be settled. Review this against the user requirement and make the resulting state and recovery operational before controlled use. No claim that the physical charger continues charging is made without hardware evidence.

## P2: stale status revalidation race

`src/lib/ocpp-engine/drizzle-tx-store.ts` `applyStatus` checks that a placement is open before taking the installation lock. A concurrent closure can commit while status waits for the installation lock; after it obtains that lock the method does not recheck the placement and can update the operational state for the closed placement. This is an inferred READ COMMITTED interleaving requiring a two-connection PostgreSQL test and a lock/recheck fix; the static model's stated no-deadlock coverage does not prove this state is correct.

## Terms and verification

The new start-time snapshot is an improvement and costing uses it rather than later term-table reads. `loadAgreementFacts` makes multiple queries before the start transaction; concurrent edits while facts are being captured may produce a mixed snapshot unless a consistent read is established. This is an inferred risk; verify database isolation and authoring behavior rather than claiming the hash guarantees temporal consistency. Missing captured terms remain unresolved. The immutability trigger and placement locks have not run on PostgreSQL.

Focused checks: existing lifecycle, costing and transaction tests, 5 files / 115 passed using workspace TEMP/TMP; `node scripts/check-adopted-schema.mjs` passed, eight migrations (generation check only); new review reproduction fails as documented. No full suite or build repeated. Sonnet's reported broader pass count remains its own result.

## ChatGPT Review Handoff

Objective: independently review Sonnet's first-charger integrity work. The initial review added a failing regression reproduction and this report; the follow-up below records subsequent fixes. HEAD unchanged, prior dirty state preserved. Do not deploy, operate hardware, or mark the active-session lifecycle accepted until the remaining recovery boundary is addressed and real PostgreSQL/Workers tests are completed.

## Follow-up fix — 2026-10-30

- `transactions.ts` now marks earlier sessions superseded only when the incoming start was authorized. Refused starts still receive and retain their own unauthorized transaction and decision evidence. The original regression now passes; an additional invalid-token case also passes. This does **not** resolve whether even an accepted new start is sufficient evidence to make the earlier session non-gating, nor the missing-stop recovery contract.
- `drizzle-tx-store.ts` now checks placement openness after acquiring the installation lock used by closure, closing the identified stale-status check/lock window under the assumed READ COMMITTED protocol. The actual SQL concurrency behavior remains unverified; a two-connection test is still required.
- Focused `npx vitest run src/lib/ocpp-engine src/lib/lifecycle src/lib/costing`: 10 files, 174 tests passed. Root `npx tsc --noEmit`: passed. Existing local work preserved; HEAD remains `15c036f7de0d7b8c948d6cc64fef757b7d79935f`. No PostgreSQL, cloud, hardware, deployment or Git publication. The terms snapshot consistency risk and unconfirmed-session recovery are unresolved; this is not release acceptance.

## Follow-up: fail closed for missing stop — 2026-10-30

The lifecycle no longer considers a superseded-but-unstopped session safe to close. It attempts to stop current non-superseded sessions, then keeps the request `needs_attention` with the older transaction and held settlement visible; the placement and identity stay open. A later real stop can advance the same request to costing and completion. Without a stop binding an open session still makes removal unavailable. The database open-count and final closure guard now include all unstopped sessions; the ordinary editor-save detach guard does too, and takes a placement `FOR UPDATE` before counting so a concurrent start must complete first. Locking and SQL remain unverified against PostgreSQL, including the editor-save interleaving and lock order. No audited operator reconciliation route or physical shutdown verification is built, so a missing stop may require manual attention indefinitely rather than being silently cleared.

Local checks after these changes: `npx vitest run src/lib/lifecycle src/lib/ocpp-engine src/lib/costing src/lib/installations`: 14 files / 236 tests passed; root `npx tsc --noEmit` passed. Tests use doubles; no PostgreSQL, Workers or physical charger run. Terms capture consistency and the first-journey dependencies remain open. HEAD unchanged; work remains local and uncommitted.
