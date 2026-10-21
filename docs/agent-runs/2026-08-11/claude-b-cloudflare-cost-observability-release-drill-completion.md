---
agent: claude-b
lane: cloudflare-cost-observability-release-drill
status: complete
prompt: docs/agent-prompts/2026-08-11/2026-08-11-0410-claude-b-cloudflare-cost-observability-release-drill.md
start_utc: 2026-08-11T08:38:27Z
end_utc: 2026-08-11T09:03:20Z
wall_clock: 24m53s
target_wall_clock: 4-8h
target_met: false
external_mutation: none
---

# Claude B — completion: Cloudflare cost/observability release drill

## TL;DR

**The event-driven architecture exists only in staging.** Top-level
declares no queue producer, no consumer, no DLQ and no R2 bucket — so a
top-level deploy runs every meaningful OCPP event through the
synchronous service-binding fallback with nowhere to park a failure.
The previous gate passed this, because it asked "is a producer
declared?" globally instead of per environment. Twelve new rules
(OB16–OB28) now ask it correctly, and the answer is **NO-GO for
top-level, GO for staging**.

Second finding, quieter and arguably worse: **missed heartbeats create
no event.** Liveness is computed only when a frame arrives, so a
charger that dies silently is never reported.

## Timing

| | |
|---|---|
| Start | `2026-08-11T08:38:27Z` |
| End | `2026-08-11T09:03:20Z` |
| Wall-clock | **24 m 53 s** |
| Target | 4–8 h |
| **Target met** | **No** |

**What bounded the work, concretely.** All eleven phases ran and the
full fallback queue (**12 of 12**) was exhausted. Three things that
would consume hours are gated elsewhere and no amount of local time
substitutes: the read-only Cloudflare session needs a token decision,
`node_modules` is empty so no vitest/tsc run is possible, and the Sentry
SDK is not installed. The remaining work is either a config change
needing approval, an afternoon of DO code, or a hardware measurement.
No phase was skipped and nothing was padded.

## State

| | Start | End |
|---|---|---|
| `Straumvakt-relops-b` (primary) | `10f873d` dirty 0 | **`815425a`** dirty 0 |
| `Straumvakt-beta-production` | `44230c9` dirty 0 | unchanged |
| `Straumvakt-release-candidate` | `4b69d0f` | unchanged |

Branch `scratch/claude-b-release-ops-2026-08-10` (scratch — rule 6 satisfied).

## Commits — 4 slices, 16 files, +3533 / −22

| SHA | Slice |
|---|---|
| `00ece24` | gateway: harden metrics dimensions and Sentry config validation |
| `0cfff35` | gates: per-environment rules OB16–OB27, census, cost model |
| `ee02860` | docs: config census, cost evidence, release drill, alerts, audit |
| `815425a` | gates+docs: config edge cases, OB28, runbooks, dashboards, issue packages |

**Source:** `gateway/src/metrics.ts`, `gateway/src/sentry-scrub.ts`,
`gateway/src/observability.selftest.mjs`,
`scripts/analysis/observability/{check-observability,collect-config-census,cost-model}.mjs`

**Docs (9):** config census · cost evidence model (+ JSON) · release
drill · alert policy · tool comparison · correction audit · ops
runbooks · dashboards/evidence/secrets · issue packages

## Checks run

```
check-observability --self-test        81 passed, 0 failed   (was 20)
gateway observability selftest         69 passed, 0 failed   (was 32)
gateway heartbeat fast-path selftest   35 passed, 0 failed
beta-production checker suite         168/168 across 7 checkers
OCPP cost gate, relops-b                3 errors, all OC20 — baseline unchanged
config census                         160 rows, derived
cost model                              9 scenarios × 5 fleet sizes
staged DSN-literal scan                 0
```

**61 new fixtures and 37 new assertions** — against required minimums of
35 and 70 (98 combined).

Against the real tree: **10 errors, 3 warnings**, every one of them a
real gap, listed in the release drill.

## What landed

**Twelve new gate rules, all per environment.** OB16 queue producer ·
OB17 consumer + DLQ · OB18 liveness sweeper · OB19 routes/workers_dev
(inheritance-aware) · OB20 R2 · OB21 scheduler exists · OB22 Access ·
OB23 reports the cost multiplier rather than only failing · OB24 version
metadata · OB25 noisy-charger signal reaches a metric · OB26 closed
metric vocabulary · OB27 scrubber coverage and bounds · OB28 a config
that exists but does not parse must fail loudly.

**Two hardening fixes to my own earlier code.** `buildBlobs` accepted
any string dimension — now capped at 64 chars and rejected on
whitespace/`@`, with `identity` exempt because it is hashed first.
`sentryConfigFrom` accepted any non-empty DSN — a malformed DSN makes
SDKs drop every event silently, which is indistinguishable from "no
errors happened", so it is now shape-checked, fail-closed with a
`reason`, and never echoes the rejected value.

**A cost model that quotes no kr figures.** Unit prices are not knowable
from this tree and a plausible wrong number is worse than a formula.
Named placeholders throughout; what it produces is sensitivity.

## Findings

1. **Environment asymmetry** — queues, DLQs and R2 exist in staging
   only. `ingest-client.ts:30` already said "when provisioned"; nothing
   gated it.
2. **No liveness sweeper** — a dead charger is invisible. The DO
   `alarm()` is the outbound-command timeout sweep, not this.
3. **No scheduler at all** — no Workflow, no cron. "Workflows optional"
   was a decision about Workflows; absent-by-omission looks identical
   in a config file.
4. **`workers_dev` foot-gun on 5 environments** — unchanged since
   2026-08-09; the shipped Flutter client has no fallback host and
   chargers hold the gateway URL in device config.
5. **No version id, still** — the single blocking release fact.
6. **wrangler OAuth is live on this machine** with write/admin scopes
   for `andrith187@gmail.com`. No token value was read or printed. Any
   process that can run `wrangler` here can deploy; the operating rules
   forbid it, the credential does not. Posture note, not an incident.

Cost headlines: idle **720** frames/connector/month at 3600 s vs
**43,200** at 60 s (**60×**); a noisy connector's month is **2,592,000**
frames of which **86,400** reach the queue after the cap (96.7 % shed);
20,000 connectors idle is **14.4 M** frames/month, or **864 M** at the
60 s defect.

## Corrections to my own prior claims

- "Queue producer declared — pass" was **too coarse to be true**.
- "The fast path removes heartbeat cost" — it removes the queue op,
  consumer invocation and Neon row; **DO wakeups and storage writes are
  still paid** per frame.
- "Observability is free" — two metric points per heartbeat; at 20,000
  connectors that is 28.8 M points/month on the idle path alone.
- "`node_modules` is present" — the directory has **zero entries**;
  `test -d` was the wrong check.
- OB26 first fired on `metrics.ts`'s own comment saying the code is
  *deliberately not* `Record<string, string>` — a rule reading a note
  about a defect as the defect. Third instance of this class here.
- OB18's first regex was case-sensitive against comment-stripped
  source, so it failed every fixture including the good one.

## Release go / no-go

**NO-GO for top-level.** OB16/OB17: no queue producer, no consumer, no
DLQ — silent event loss in the environment that would carry real
customers.

**GO for staging**, conditional on doing issue package #2 first
(uncomment `version_metadata`, deploy, record the version id) so the
next release has something to roll back to.

## Exact next human actions

1. **Merge `relops-b`** — carries the fast path, frame cap, interval
   fix, observability slice and all 28 gates. No cloud access needed.
2. **Record a version id** — 30 minutes; converts every future release
   from a one-way door into something reversible.
3. **Declare the top-level queue producer, consumer and DLQ** — two
   config blocks; removes silent event loss.
4. **Build the liveness sweeper** — an afternoon; without it the
   product cannot tell a customer their charger is down.
5. **Add the synthetic hostname probe** — a curl in a cron, covering the
   failure with the largest blast radius and slowest recovery.

## Ten review questions for the diff

1. Should `OCPP_HEARTBEAT_INTERVAL_SECONDS` be per-charger rather than
   per-Worker? A mixed fleet may need different intervals.
2. The frame cap is 120/hour globally — should it scale with connector
   count per site, or is per-connector correct?
3. `pseudonymiseIdentity` uses an empty default salt. Where should the
   real salt live — a var, or a secret?
4. OB19 flags all 5 environments; OC20 flagged 3 (only client-pinned
   hosts). Is the broader rule right, or noise for hosts nobody pins?
5. Should OB23 fail, or warn with the multiplier, when an operator has
   *deliberately* set a low interval after M-2?
6. `MAX_DIMENSION_LENGTH = 64` — does any legitimate `period` or
   `errorKind` exceed it?
7. Is one DO storage write per heartbeat acceptable, or should liveness
   batch to the rollup boundary?
8. Should the metrics writer be wired to the hot path before the
   binding exists, given it is provably no-op safe?
9. Is `hlada-api` (top-level) actually production, or has it never been
   deployed? The census assumes the former conservatively.
10. Does the DLQ requirement belong on all three staging consumers, or
    only the OCPP events queue?

## External state confirmation

No push, deploy, DNS/Cloudflare mutation, Neon mutation, SQL, GitHub
remote mutation, hardware or OCPP command, BLE/NFC, delete/move/archive,
worktree retirement, or new top-level `E:\Claude` folder. No
dependencies installed. `wrangler whoami` was run read-only; no token,
DSN, key or connection string was printed or stored. Read-only
worktrees were read only. Four local commits on an existing scratch
branch.

## Fallback queue — 12 of 12

1 ✅ 25 config edge-case fixtures · 2 ✅ 30 issue packages · 3 ✅
dashboard spec · 4 ✅ noisy-charger runbook · 5 ✅ missed-heartbeat
runbook · 6 ✅ billing-failure runbook · 7 ✅ no-secrets evidence
template · 8 ✅ cost sensitivity appendix · 9 ✅ incident taxonomy ·
10 ✅ rollback drill · 11 ✅ security note · 12 ✅ diff review, above.

## Cleanup candidates

None created. Outstanding: `Straumvakt-core-security` (0 dirty,
retirable) — **not retired**, per operating rule 5.
