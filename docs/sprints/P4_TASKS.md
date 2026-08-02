# P4 — Production Hardening · Task List

**Status:** ACTIVE TRACK — depends on P0 only; runs **parallel** to
Track E (P1–P3). Expanded 2026-08-02.
**Branch convention:** `dev/p4-<sub-track>-<topic>`.

> Phase detail for **P4** in
> [GOING_PUBLIC_CRITICAL_PATH.md](../architecture/GOING_PUBLIC_CRITICAL_PATH.md),
> expanded by
> [ADR 0035](../adr/0035-multi-operator-scale-readiness-roadmap.md).
>
> P4 was originally scoped as "observability + security" because that is
> what the pilot-era Sprint 10 contained. The 2026-08-02 code review
> found nine defects on the ingest and command paths, a missing
> load-test harness that **P5.5 already depends on**, and no
> current-state projection. P4 absorbs all of it.
>
> **P4 depends only on P0 and runs parallel to P1–P3, so nothing here
> moves the launch date.** It does mean P4 is now the larger half of the
> plan, not background work.

---

## Sub-tracks

| Sub-track | Milestones | Detail |
|---|---|---|
| **P4-A** Observability | P4.1–P4.4 | [SPRINT_10_TASKS.md](./SPRINT_10_TASKS.md) Track A (10.1–10.4) |
| **P4-B** Security & tenancy | P4.5–P4.11, P4.23–P4.27 | 10.5–10.11 below + new tenancy depth |
| **P4-C** Ingest & command integrity | P4.12–P4.18 | **New — detailed below. Start here.** |
| **P4-D** Measurement | P4.19–P4.22 | New — sketch below |
| **P4-E** Operational read models | P4.28–P4.31 | New — sketch below |

**Execution order.** P4-C before P4-D — a load test exists to find
*unknowns*, and spending one to rediscover documented defects wastes the
run. P4-A's alert thresholds (P4.3) are better set from P4-D's measured
numbers than from guesses, so P4-A's dashboards can start any time but
its thresholds should follow P4-D. P4-B and P4-E are independent.

**Ratified milestones P4.1–P4.11 are unchanged** and keep their existing
task detail in [SPRINT_10_TASKS.md](./SPRINT_10_TASKS.md), whose `10.x`
IDs they absorb. Nothing below renumbers them.

---

# P4-C — Ingest and command integrity

> **In one line:** fix the nine known defects in the event and command
> path, so nothing is silently broken before we measure anything.
>
> Ships no customer-visible feature. Its value is that P4-D then
> measures a system with no known defects.

## Status — 2026-08-02

| Milestone | State |
|---|---|
| P4.C0 baseline | ✅ done — tree clean, 13 commits, duplicate ADR 0021 resolved |
| P4.12 batch write path | ✅ done — partitioned, not homogenised. MeterValues deliberately excluded (see Rule 5 note) |
| P4.13 archive fanout | ✅ done — `sendBatch`, driven by returned identities |
| P4.14 pooling + cadence | ⛔ **Rule 4** — needs an explicit instruction naming `apps/api/wrangler.jsonc` |
| P4.15 partition retention | ⛔ **blocked on [ADR 0037](../adr/0037-r2-key-scheme-retention-class-segment.md)** |
| P4.16 command durability | ✅ done — DO storage, claim-by-delete, close + error + alarm sweeps |
| P4.17 subprotocol echo | ✅ done — RFC 6455 negotiation; entry Worker was dropping the offer |
| P4.18 Authorize caching | ⏳ **Rule 5 gate** — not started |

Test state: `apps/api` 579/579, `gateway` 54/54, both typecheck clean.

### Findings that came out of the work

- **F3 was not a defect.** "New pg pool per batch" is *required* —
  Workers I/O isolation forbids reusing pg connections across requests
  ([raw.ts header](../../apps/api/src/lib/db/raw.ts)). `max: 1` keeps it
  to one Hyperdrive-routed connection. P4.14's "genuinely open question"
  is answered: don't change it.

- **`npx tsc --noEmit` at the repo root verifies about a third of the
  codebase.** Root `tsconfig.json` excludes `apps/**`, `gateway/**` and
  `packages/**`. CLAUDE.md Rules 9 and 10 name that command as the
  verification bar, and it silently skips the API Worker and the OCPP
  gateway. Vitest transpiles without typechecking, so tests don't catch
  it either — four type errors shipped in the P4.12 commit before this
  was noticed. **Rules 9/10 need a per-workspace typecheck**, or a root
  script that runs all three.

- **`virtual-cp.ts` needed no change for P4.17** — the workaround this
  task list described (from the 2026-05-12 note) was already gone. The
  simulator has therefore most likely been failing 1006 against the
  gateway since Sprint 7.0.

- **The outbox projection collapses terminal states.**
  [`onCommandResult`](../../apps/api/src/lib/ocpp/projections.ts#L277)
  only recognises `accepted` | `rejected` and silently returns on
  anything else. P4.16's timeout and disconnect sweeps therefore emit
  `rejected` with the real cause in `result.reason`. It drives the row
  to `failed` and keeps the detail, but a timed-out command and a
  charger-rejected command are indistinguishable in the console without
  opening the JSON. ADR 0017's Sprint 9 Track A spec named `timed_out`
  as a distinct state. **Follow-up: teach the projection the extra
  outcomes** — small, `apps/api`-side, and it was outside the boundary
  the work was done under.

- **Six pre-existing test failures fixed**, all test bugs. Two of them
  had stopped testing what they claimed: the Zaptec webhook fail-open
  posture and the org-email-domain tenant-isolation guard. Both now
  genuinely assert their invariant.

## Findings closed here

| # | Finding | Location | Milestone |
|---|---|---|---|
| F1 | Fast path covers heartbeats only; ~99% of batches mixed at 1000 chargers → per-event Prisma | `queues/ocpp-events.ts:98` | P4.12 |
| F2 | `slice(0, result.fresh)` archives the wrong events on a batch with replays | `ocpp-events.ts:146` | P4.12/13 |
| F2b | Archive fanout sequential, one `await send()` per event | `ocpp-events.ts:145` | P4.13 |
| F3 | New pg pool created and destroyed per batch | `ocpp-events.ts:108,179` | P4.14 |
| F4 | `max_batch_timeout: 1` — 2026-05-12 batching change not live | `apps/api/wrangler.jsonc` | P4.14 |
| F5 | Partition detach/drop never implemented | `lib/db/partition-cron.ts:8` | P4.15 |
| F6 | `pendingOutbound` in-memory on a hibernating DO | `gateway/src/identity-do.ts:90` | P4.16 |
| F7 | `transactions` map declared, never written | `identity-do.ts:88` | P4.16 |
| F8 | WS upgrade doesn't echo `Sec-WebSocket-Protocol: ocpp1.6` | `identity-do.ts:140` | P4.17 |
| F9 | Authorize sidecar awaits Postgres on the charger hot path | `identity-do.ts:256` | P4.18 |

## Milestone P4.C0 — Baseline (blocking)

> CLAUDE.md Rule 9. As of 2026-08-02 the tree carries ~70 untracked
> files and 6 modified — probe scripts, ADRs, reference docs, new route
> folders, a driver-self-onboarding migration. P4-C cannot start from
> this.

- [ ] Triage the untracked set: commit what belongs (probes, ADRs, docs,
      reference pages, the `20260531200000_driver_self_onboarding`
      migration) in their own logical commits per Rule 8; delete scratch.
- [ ] Resolve the duplicate ADR 0021 — renumber one (F20).
- [ ] Refresh `driver-app-api/README.md`: Phases 2 and 3 shipped; only
      Phase 4 (polling → SSE → push) remains, and that is P6.2.
- [ ] `git status` clean; on a `dev/p4-c-*` branch, not `master`.
- [ ] Baseline `npx tsc --noEmit` and `npx prisma validate` both green.
      If either is already red, fix before any P4-C code.

## Milestone P4.12 — Generalised batch write path

> ADR 0017 named per-event Prisma writes for MeterValues as the ingest
> ceiling. Sprint 7 built a fast path but gated it on *every message in
> the batch being a heartbeat* — a condition that stops occurring as
> soon as sessions run. At ~250 concurrent sessions the batch window
> almost always contains a MeterValue, so the optimisation is tuned for
> a scale you are leaving.

- [ ] Extend `lib/db/raw.ts` beyond `batchIngestHeartbeats` into a
      generic `batchIngestEvents(client, events)` handling any event type.
- [ ] `ON CONFLICT (event_id) DO NOTHING … RETURNING event_id` so the
      insert reports **which** rows were fresh, not merely how many. This
      is the correct fix for F2 — `slice(0, fresh)` assumes fresh rows
      are the first N in array order, true only when there are no replays.
- [ ] Rewrite `handleOcppEventsBatch` to group `preParsed` by
      `eventType`, one bulk insert per group, replacing the
      `allHeartbeats` gate. Delete the pure-heartbeat special case once
      the general path subsumes it.
- [ ] Apply projections per group in bulk. Keep the registration
      mechanism in `lib/ocpp/bootstrap.ts` — projection *semantics* do
      not change here, only how many round trips they cost.
- [ ] Preserve per-message failure isolation: validation failures `ack()`
      and drop; transient failures `retry()`. A bad row in a group must
      not retry the whole batch indefinitely.
- [ ] Preserve idempotency — replaying a batch produces no duplicate
      `event_log` rows and no duplicate archive objects.
- [ ] Tests: pure-heartbeat, pure-MeterValues, mixed, with-replays,
      one-malformed, empty.
- [ ] Keep the `[ocpp-q] batch_summary` line shape; add `groups` and
      per-group counts so `wrangler tail | grep batch_summary | jq`
      still works.

> ⚠️ **Rule 5 — stop and summarise before code.** The `StopTransaction`
> projection triggers tariff resolution and a ledger write. Changing
> *how* projections are invoked touches billing math's execution path
> even if the math is untouched. Write the summary — what changes, what
> cannot change, why it's safe — and wait for approval before editing
> `projections.ts` call sites.

## Milestone P4.13 — Archive fanout

- [ ] Replace the sequential loop with `sendBatch()`, chunked to the
      Cloudflare Queues per-call limit.
- [ ] Drive the fanout from P4.12's `RETURNING event_id` set, closing F2
      by construction rather than with a second fix.
- [ ] Keep fire-and-forget: an archive failure is logged and never rolls
      back the Postgres ack (ADR 0018 Decision 3).
- [ ] Test: a batch of 100 with 30 replays archives exactly the 70 fresh
      events — assert on identity, not count.

## Milestone P4.14 — Connection handling and batch cadence

- [ ] Stop creating and destroying a pg pool per batch. Establish
      whether a module-scope pool is safe under Hyperdrive in a queue
      consumer, or whether one client per invocation without the pool
      wrapper is correct. Record the finding in `docs/notes/` — this is
      a real question, not a known answer.
- [ ] Re-apply the 2026-05-12 cadence change (`max_batch_timeout` 1s →
      30s), measured at roughly a 50% Neon CU-hour reduction and not in
      the live config.
- [ ] State the trade in the commit message: longer batching is cheaper
      and better-batched, at up to 30s of projection latency. Confirm
      that latency sits inside whatever P4-D will assert on.

> ⚠️ **Rule 4 — `apps/api/wrangler.jsonc` is an edit-with-instruction
> file.** Ask for an explicit instruction naming it.

## Milestone P4.15 — Partition retention

> `partition-cron.ts` says outright: *"What it does NOT do (yet):
> detach/drop partitions older than the retention window."* At 1000
> chargers that is ~2M rows/day with no ceiling.
>
> ⚠️ **Blocked on [ADR 0037](../adr/0037-r2-key-scheme-retention-class-segment.md)**
> (Proposed, 2026-08-02). The archive gate below cannot be built until
> the R2 key scheme carries a retention-class segment — today billing
> evidence and heartbeat noise are indistinguishable by key, so no
> lifecycle rule can expire one without the other. ADR 0037 also
> replaces "count objects under the prefix" with a fail-closed
> `events.archive_watermark` read. **Do not start P4.15 until 0037 is
> accepted.**

- [ ] Detach-and-drop past the retention window, per retention class —
      7 days for `raw_protocol` per ADR 0017 §5; `financial` and
      `operational` indefinite.
- [ ] **Gate on archive confirmation.** A partition is droppable only
      once its rows are confirmed in R2. Establish how that is confirmed
      — completion marker or reconciliation count — before anything drops.
- [ ] Dry-run mode first: log every partition that *would* drop, with
      row counts, for at least one full cycle before enabling.
- [ ] Explicit enable flag, off by default. The one task here that
      destroys data.
- [ ] Tests: boundary arithmetic, with/without archive confirmation,
      idempotency across repeated ticks.

> ⚠️ **Rule 3.** State which database it targets before it runs. Never
> wire to a connection string that doesn't clearly resolve to a
> confirmed dev branch during development.

## Milestone P4.16 — Outbound command durability

> `IdentityDurableObject` uses the WebSocket Hibernation API — evicted
> between frames by design. `pendingOutbound` is an in-memory `Map`. The
> header comment already describes the fix (*"Inflight outbound commands
> still: `cmd:<commandId>`"*) but only `meta` and `lastClosedAt` persist.
> `handleDispatch` returns 202 "Sent" immediately, so a lost correlation
> shows in the console as a command sent and never resolved.

- [ ] Move pending commands into `state.storage` under `cmd:<uniqueId>`.
      Write before the frame is sent; delete on correlation.
- [ ] `handleInboundCallResult` / `handleInboundCallError` read storage
      rather than the map.
- [ ] `webSocketClose` sweeps still-pending commands and records
      failed-on-disconnect rather than losing them silently.
- [ ] DO alarm-based timeout sweep, so a command whose CallResult never
      arrives reaches a terminal state.
- [ ] Delete the `transactions` map (F7) and the comment describing
      behaviour that was never implemented.
- [ ] Check whether ADR 0017 Sprint 9 Track A's `outbox.commands` state
      machine shipped. If yes, correlate to it. If no, record the gap —
      the operator-facing half is then still open.
- [ ] Tests: correlation across a simulated eviction, disconnect
      in-flight, timeout, duplicate CallResult.

## Milestone P4.17 — OCPP subprotocol echo

> Known since 2026-05-13. Zaptec firmware tolerates the missing header;
> spec-strict clients close 1006. `virtual-cp.ts` works around it by
> dropping the subprotocol argument. **A mixed-vendor fleet will contain
> spec-strict firmware** — this is a hard dependency for P7 and has no
> workaround.

- [ ] Echo `Sec-WebSocket-Protocol: ocpp1.6` on the 101 when the client
      offered it; omit when it did not.
- [ ] Handle multiple offered subprotocols — select the supported one,
      reject cleanly if none match.
- [ ] Remove the `virtual-cp.ts` workaround so the simulator exercises
      the spec-strict path from here on.
- [ ] Test against Node's built-in `WebSocket` (spec-strict) and the
      permissive path.

## Milestone P4.18 — Authorize verdict caching

> The sidecar `MAIN_APP.fetch` → Postgres lookup is awaited on the hot
> path for `Authorize` and `StartTransaction`, partly defeating the
> queue decoupling Sprint 5 bought. The code comment claims the lookup
> never blocks the reply; it does.

- [ ] Cache verdicts in DO storage keyed by idTag, short TTL.
- [ ] Define and document the staleness window. A cached "Accepted" for
      a token revoked seconds ago is an access-control decision, not a
      performance detail.
- [ ] Invalidation path so revocation or suspension takes effect without
      waiting out the TTL.
- [ ] **Must not change P4.11's shadow-mode → enforced flip** in either
      direction. When `enforceAuthorize` is false the verdict is logged
      and the reply is Accepted regardless.
- [ ] Tests: hit, miss, expiry, explicit invalidation, upstream error
      with a cached entry present.

> ⚠️ **Rule 5 — stop and summarise before code.** Access-grant
> resolution. Present the staleness window, invalidation path and
> failure modes, and wait for approval.

## Milestone P4.C9 — P4-C exit verification

- [ ] `npx tsc --noEmit` clean; `npm run build` succeeds.
- [ ] Full suite green, including new tests for P4.12–P4.18.
- [ ] End-to-end VCP sandbox session — Boot, Status, Start, MeterValues,
      Stop — every projection firing, exactly one correct ledger entry,
      no duplicate sessions.
- [ ] One hour of real staging traffic via
      `wrangler tail | grep '\[ocpp-q\]'`: no `validation_failed`, no
      unexplained `transient_failure`, no DLQ growth.
- [ ] Partition count stable across a retention cycle in dry-run mode.
- [ ] Notes committed for the P4.14 pooling finding.

**P4-C risks.**

- Two Rule 5 gates (P4.12, P4.18). Not formalities — one changes how
  billing projections are invoked, the other caches an authorization
  decision.
- P4.15 is destructive. Dry-run first; gate on archive confirmation,
  not elapsed time alone.
- P4.14's pooling question is genuinely open. Ending with a written
  finding rather than a refactor is acceptable, so long as the
  create-and-destroy-per-batch behaviour is gone.
- Scope creep toward measurement. Resist — that's P4-D, with a real
  simulator. Fix here, measure there.
- P4.C0 may be larger than it looks. ~70 untracked files is a sprint's
  worth of undocumented decisions if any turn out to be load-bearing.

---

# P4-D — Measurement *(sketch — refine when next-up)*

> ⚠️ **P5.5 depends on this and does not know it.** P5.5 says "re-run
> Sprint 9 Scenario D"; ADR 0017's Sprint 9 Track B never shipped and no
> fleet simulator exists. Until P4-D lands, P5.5 cannot be executed and
> P5.7's go/no-go cannot honestly be signed.

- [ ] **P4.19** Fleet simulator — extend `apps/api/scripts/virtual-cp.ts`
      to N concurrent identities, configurable heartbeat and MeterValues
      intervals, mixed-vendor behaviour.
- [ ] **P4.20** Scenarios — steady state at 100 / 500 / 1000 / 5000;
      **connect storm** (a fleet repointed at once — required by P7);
      reconnect storm; DB-latency injection; API-unavailable.
- [ ] **P4.21** Instrumentation + write-up — queue depth, batch path
      selection, DLQ growth, DB write latency, partition growth, Neon
      CU-hours. Raw graphs, not summaries. Feeds P4.3's alert thresholds
      with measured numbers instead of guesses.
- [ ] **P4.22** Documented per-component limits, replacing the arithmetic
      estimates in the 2026-08-02 review.

**Exit:** 5,000-charger simulation sustained one hour with no DLQ growth
and bounded Postgres; per-component limits documented.

---

# P4-B extension — Tenancy depth and domain model *(sketch)*

> [TENANT_ISOLATION_AUDIT.md](../architecture/TENANT_ISOLATION_AUDIT.md)
> (2026-06-05) already scoped P4.5 and P4.9. Its findings: driver and
> cross-host-driver isolation ✅ enforced; host isolation ⚠ safe-by-
> accident, not row-scoped; DB/RLS ❌ none — **High**; OCPP ingest write
> path ❌ trusts envelope `orgId`. **Do not re-run the audit — validate
> it and fix.**

- [ ] **P4.23** Re-validate the audit. Two months old on a moving branch.
- [ ] **P4.24** Host-path row scoping — close the Medium finding.
- [ ] **P4.25** OCPP ingest write-path row guard — close the Medium
      finding.
- [ ] **P4.26** **Operator-as-tenant.** The audit covered *host*
      isolation, not operator. Follow ADR 0031's build note:
      `Organization.kind` gives way to role-derived-from-agreements, so
      an org holding `service_cpo` *is* a CPO. Decide shared-with-RLS vs
      per-operator isolation.
- [ ] **P4.27** **EVSE layer** between Charger and Connector. OCPP 1.6
      tolerates its absence; OCPI does not — the EVSE ID is the
      roaming-visible unit. Migrating after a fleet lands, against live
      billing, is the expensive version.

**Exit:** a second operator provisioned and proven isolated by automated
test; EVSE layer migrated with no billing regression.

---

# P4-E — Operational read models *(sketch)*

- [ ] **P4.28** `fleet_state` projection keyed by connector, maintained
      by `lib/ocpp/projections.ts`. `listSiteTree` and the list endpoints
      read it instead of recomputing hierarchy + credential decrypt per
      request.
- [ ] **P4.29** Console read path — server-rendered first paint,
      stale-while-revalidate, stop blanking lists on refetch, UI state
      separated from server state.
- [ ] **P4.30** **Derived downtime periods** from connector status and
      last-seen. A downtime period is a derived *fact*; an issue is a
      *workstream* referencing one. P4.1's dashboards, SLA reporting and
      P6.1's issue engine all read this.
- [ ] **P4.31** Driver polling backoff — focus-gated 10–15s instead of
      3–4s. Cheap, no new infrastructure, removes the largest single
      source of database load. Full SSE/push stays at P6.2.

**Exit:** cold page load is one indexed query; downtime periods populate
with no human input; driver-originated DB load down roughly an order of
magnitude.
