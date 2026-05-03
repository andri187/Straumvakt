# Sprint 9 — Outbound Command Hardening + Load Test Harness · Task List

**Status:** FUTURE — entry condition: Sprint 8 exit met.
**Branch:** `dev/sprint-09-outbound-and-loadtest`.

> Rescoped per [ADR 0017](../adr/0017-prepilot-rescope-for-4k-charger-target.md).
> Absorbs gbtNotes S6 + S7. **THE sprint that proves the architecture.**
> Outbound commands get state-machine semantics; the load-test
> simulator hammers staging from 100 → 4000 chargers. Exit criteria
> include "4000-charger sim, 30s MeterValues, 1h, zero DLQ growth."
> If Sprint 9 surfaces architecture changes, Sprints 10 + 11 absorb
> the fix and pilot Go-Live slips by the same amount.

---

## Track A — Outbound command hardening

> Operators today have no idea whether a "remote start" command
> reached the charger. 4k chargers means 4k chances for the answer
> to be "no but we're not sure." State machine + timeout +
> result-event correlation closes the loop.

### Milestone 9.1 — Outbox state machine

- [ ] States: `pending → dispatched → sent → (accepted | rejected |
      timed_out | failed)`. Terminal states: accepted, rejected,
      timed_out, failed.
- [ ] Schema: `outbox.commands` extended with `state`, `state_changed_at`,
      `dispatch_attempts`, `last_error`, `timeout_at` (computed from
      command type — `RemoteStartTransaction` 30s, `Reset` 60s, etc.).
      Operator-instructed Rule 4 + Rule 5 schema migration.
- [ ] Transitions logged to `audit.command_state_log`
      (append-only, every transition).
- [ ] Retry limits per state — `pending → dispatched` 3 attempts,
      `dispatched → sent` 1 attempt (gateway backpressure?), etc.
- [ ] Tests: every transition path. Replay-safe (idempotent on
      duplicate state events).

### Milestone 9.2 — Gateway command-result event ingest

> Result events (CALLRESULT to a CALL we sent) flow back through
> Sprint 5's inbound queue + idempotent consumer. Hot-path raw SQL
> per Sprint 7 + ADR 0018.

- [ ] Gateway DO recognizes the OCPP `MessageId` of a CALLRESULT,
      looks up the originating command, emits a
      `command-result` event to the queue.
- [ ] Queue consumer correlates result back to `outbox.commands`,
      transitions `sent → accepted | rejected` based on result
      payload.
- [ ] Timeout sweeper cron `apps/api/src/crons/command-timeout.ts`
      runs every 30s; rows with `state IN (pending, dispatched, sent)
      AND now() > timeout_at` → `timed_out`.
- [ ] Tests: success path, timeout path, rejected path, gateway-
      down path (sweep catches stuck).

### Milestone 9.3 — Operator command-history UI

- [ ] `/chargers/[id]/commands` page reads from `outbox.commands` +
      `audit.command_state_log` for that charger. Filter by state,
      by time range.
- [ ] Drill-down: click a command → state-transition timeline,
      result payload.
- [ ] Permissions: `charger.command.read`.
- [ ] Test: 10 commands across all states render correctly.

---

## Track B — Load test harness

> The deliverable that proves the architecture. Without it none of
> Sprints 5–8 is verified at the 4k target.

### Milestone 9.4 — Simulator design + framework pick

- [ ] Build vs adopt: evaluate `node-ocpp-charger-simulator`,
      open-source SteVe simulators, k6 + custom OCPP plugin, or
      build-our-own with `ws` library on Node.
- [ ] **Decision** captured in `docs/notes/<date>-load-sim-pick.md`.
- [ ] Recommend: build-our-own, lightweight WS clients in Node,
      runnable from a single Linux box at 4000 connections
      (well within `ulimit` and Node fd capacity).
- [ ] Package shape: `tools/load-sim/` with `npm run sim:100`,
      `sim:1000`, `sim:4000`, `sim:reconnect-storm`, etc.

### Milestone 9.5 — Simulator scenarios

- [ ] **Scenario A (warmup):** 100 chargers, 30s MeterValues, 1h.
- [ ] **Scenario B (mid-scale):** 500 chargers, 30s MeterValues,
      1h. Stagger boot 0–60s.
- [ ] **Scenario C (target):** 1000 chargers, 30s MeterValues, 1h.
- [ ] **Scenario D (full target):** 4000 chargers, 30s MeterValues,
      1h. Stagger boot 0–300s.
- [ ] **Scenario E (reconnect storm):** 4000 chargers boot
      simultaneously after a "gateway restart" event.
- [ ] **Scenario F (DB latency injection):** 4000 chargers + Neon
      held under load (stalled queries) — verify queue absorbs
      backpressure.
- [ ] **Scenario G (API Worker unavailable):** 4000 chargers, API
      Worker drops responses for 60s — DLQ counts, recovery.
- [ ] **Scenario H (concurrent reports):** Scenario D + 10 monthly
      session CSV exports + 10 billing XLSX + 5 charger uptime
      reports + 1 raw evidence export simultaneously. Verify
      ingest lag stays ≤ p99 < 5s.
- [ ] All scenarios scripted, committable, reproducible.

### Milestone 9.6 — Capture metrics + write up results

- [ ] Per scenario, capture: queue depth, ingest lag p50/p99,
      DLQ count, DB write latency p50/p99, batch flush latency,
      command round-trip latency, partition growth, R2 archive
      throughput, R2 archive failure rate.
- [ ] Results in `docs/runbooks/sprint-09-load-test-results.md`.
      Include the raw graphs, not just summaries.
- [ ] **Exit criterion:** Scenario D survives 1 hour with zero
      DLQ growth (idempotent retries OK; permanent DLQ entries
      = fail) AND ingest lag p99 < 5s.

### Milestone 9.7 — A/B persistence test (conditional)

- [ ] **If Sprint 6 chose Timescale:** re-run Scenario D against
      a Neon-with-partitioning branch to confirm the Timescale
      pick was right.
- [ ] **If Sprint 6 chose Neon:** Scenario D results stand as the
      reference. Document the Neon ceiling (where it would have
      forced a switch — useful for post-pilot scale beyond 4k).
- [ ] Either way: `docs/architecture/PERSISTENCE_AB_RESULTS.md`
      with the pick + the alternative's measured ceiling.

---

**Risks.**
- **Surprises in the 4k sim.** This is the highest-variance sprint.
  Findings might require Sprint 10 + 11 to absorb fixes.
  Mitigation: budget Sprint 10 + 11 with float; if 9 slips, pilot
  Go-Live slips by the same amount.
- **Simulator framework lock-in.** Whichever framework wins becomes
  load-bearing for ongoing capacity testing. Don't pick something
  abandoned.
- **R2 archive backpressure under load.** If R2 throughput is the
  ceiling at 4k chargers, Sprint 7's per-day partition strategy
  needs revision (per-hour? per-org-per-day?). Spike fix in this
  sprint or escalate to ADR 0018 revision.
- **Rule 5 territory in 9.1.** Command-state semantics interact
  with `charger.command.*` permissions; stop-and-summarize before
  the state machine code lands.

**Out of scope (Sprint 10+).**
- Production dashboards (these sprint findings feed Sprint 10's
  dashboards).
- Alert thresholds (Sprint 10).
- Multi-tenant white-label re-skin → post-pilot per ADR 0017.
- OCPP 2.0.1 adapter → Sprint 14+ with OCPI Foundation.
- Issue Engine → post-pilot per ADR 0006 (tag D).
