# Market release gates

Eleven gates. Nine are already executable; two cannot be evaluated by any tool
that exists, and are recorded as such rather than assumed green.

Run: `node scripts/analysis/manifest/self-test-all.mjs` — **168/168 across 7 checkers.**

---

## Executable today

| # | Gate | Checker | `relops-b` | `beta-production` |
|---|---|---|---|---|
| 1 | Heartbeat skips queue and full ingest | OC1 | **pass** | **fail** |
| 2 | Heartbeat still replies on the fast path | OC1 structural | **pass** | n/a |
| 3 | Per-connector frame cap exists | OC10 | **pass** | **fail** |
| 4 | DO hibernating | OC12 | pass | pass |
| 5 | Queue producer binding declared | OC16 | pass | pass |
| 6 | Queue not used for an unchanged heartbeat | OC1 + OC2 | **pass** | **fail** |
| 7 | No permanent raw heartbeat persistence | OC7 / OC8 | pass, TTL unrecorded | pass, TTL unrecorded |
| 8 | workers_dev / route foot-gun | OC20, L1, L2 | **fail ×3** | **fail ×3** |
| 9 | No fabricated active-session interval | OC6 | pass | pass |

**Gate 2 is the subtle one.** It is not enough that a heartbeat skips the queue —
it must still send its CallResult. A guard that skipped both would satisfy a
keyword search and stop cars charging. The collector therefore requires the guard
to appear *before* the enqueue, to end in a `return`, and to reply on that path.
Three mutations were run against the live file and all three are caught:
deleting the reply, neutering the return, and renaming the guard.

That check itself had a defect found by mutation testing: replacing `return;`
with `/* no return here */` left the word in place and satisfied a naive
`\breturn\b`. Comments are now stripped before control flow is inspected.

---

## Not evaluable by any existing tool

| # | Gate | Why not | What would settle it |
|---|---|---|---|
| 10 | **Sentry configured before beta** | No DSN, no config, nothing to inspect | A Worker secret name plus an init call in the gateway; then a static gate can assert both |
| 11 | **Analytics Engine writer before beta** | No binding, no writer | An `analytics_engine_datasets` binding in `wrangler.jsonc`; then a config gate mirrors OC16 |

These are **absent, not broken.** Both become one-line static checks the moment
the thing exists — which is the argument for creating them before beta rather
than after.

---

## The gap between the branches

`relops-b` (`21f6d20`) carries the heartbeat fast path and the frame cap: **3
OCPP errors.** `beta-production` (`a951669`) does not: **5 errors.** The
difference is gates 1, 3 and 6.

**Those three are the entire cost case, and they are on an unmerged scratch
branch.** Nothing is deployed from `relops-b`. Until it merges, production
behaviour is the 5-error profile.

The 3 errors remaining on `relops-b` are all gate 8 — pinned hosts whose configs
declare neither `routes` nor `workers_dev`. Unrelated to the heartbeat work and
unchanged since 2026-08-09.

---

## Verification evidence

```
ALL GREEN — 168/168 fixtures across 7 checkers
  environment 8 · release 37 · preservation 32 · freeze 23
  wrangler 11 · ocpp 40 · branch-safety 17
wrangler L1 errors: 0
```

Every checker imports only `node:` builtins, reaches no network, and mutates
nothing. `check-branch-safety.mjs` spawns git through a single choke point behind
an allowlist of twelve read-only verbs.

---

## Blocking for beta

1. **Merge `relops-b`** or the cost fix does not exist in production.
2. **Sentry** — gate 10 cannot pass because there is nothing to check.
3. **Analytics Engine** — gate 11, same shape.
4. **Gate 8** — three environments, unchanged for two days.
5. **Queue binding unverified in the deployed environment.** Config is not
   deployment; only a read-only Cloudflare session settles it.
