# Issue-ready implementation packages — ops / cost observability

Thirty packages, each with a gate that proves it done. Ordered by
**value per hour**, not by size.

Legend — **E** engineering only · **C** needs a Cloudflare session ·
**A** needs Andri's approval · **H** needs hardware.

---

## Tier 1 — blocks beta (do these first)

| # | Package | Kind | Done when | Gate |
|---|---|---|---|---|
| 1 | Merge `relops-b` into the release line | A | fast path, frame cap, interval fix and observability slice are on the deploy branch | OB1–OB7 pass on the merged tree |
| 2 | Uncomment `version_metadata`, deploy staging, **record the version id** | A+C | a version id exists in the release record | OB24, OB15 |
| 3 | Declare `OCPP_EVENTS_QUEUE` producer on gateway top-level | A | top-level config has the producer | OB16 |
| 4 | Declare OCPP events consumer **+ DLQ** on `hlada-api` | A | top-level config has consumer and DLQ | OB17 |
| 5 | **Liveness sweeper**: DO alarm emitting `missed_heartbeats` on silence | E | a charger unplugged in test produces an offline event within 3 intervals | OB18 |
| 6 | Declare a scheduler (cron trigger) for billing/report jobs | A | a cron exists in some environment | OB21 |
| 7 | Synthetic probe on pinned hostnames, 2 regions, 1 min | E | probe alerts within 2 min of host loss | alert A13 |
| 8 | Declare `workers_dev: true` explicitly on all 5 environments | A | no environment declares neither routes nor workers_dev | OB19, OC20 |
| 9 | Uncomment `analytics_engine_datasets`; confirm points arrive | A+C | a data point is visible | OB14 |
| 10 | Wire `heartbeats_received` / `heartbeats_suppressed` into the hot path | E | ratio panel shows ≈ 1.0 | Panel A |

## Tier 2 — needed before real money moves

| # | Package | Kind | Done when | Gate |
|---|---|---|---|---|
| 11 | Install `@sentry/cloudflare`, wire `beforeSend: scrubEvent` | E | an exception appears scrubbed in staging | OB11 |
| 12 | Sentry DSN as a Worker secret, **staging only** | A+C | secret name present, value never printed | OB12 |
| 13 | Scrubber verification probe with an idTag sentinel | E | probe asserts the sentinel is absent | alert A8 |
| 14 | Production DSN, gated on 13 passing | A+C | 13 green on a real payload | M-8 |
| 15 | `noisy_charger_events` metric at the cap breach | E | breach produces a metric, not just a log | OB25 |
| 16 | `queue_messages_by_type` at the enqueue | E | heartbeat share visible and ≈ 0 | Panel B |
| 17 | `gateway_errors_by_type` in the parse-error path | E | a malformed frame increments it | Panel C |
| 18 | Expose connected-charger count | E | count is queryable | unblocks rollback drill |
| 19 | DLQ depth + backlog-age alerts | C | alert fires on a seeded message | A3, A4 |
| 20 | Billing job metrics (`started`/`completed`/`failed`) | E | started equals completed for a period | A10 |

## Tier 3 — hygiene and durability

| # | Package | Kind | Done when | Gate |
|---|---|---|---|---|
| 21 | R2 bucket for exports/debug bundles, top-level | A | bucket declared, private | OB20 |
| 22 | R2 lifecycle: cap size and TTL on the debug bucket **at creation** | A | lifecycle rule exists | — |
| 23 | Cloudflare Access on internal/ops tools | A+C | ops tool requires Access | OB22 |
| 24 | Neon production project, protected from creation | A | project exists, protected | checklist B6 |
| 25 | Protect the beta Neon branch; enable org `require_mfa` | A | both true | B7, B8 |
| 26 | Backup branches beyond the 7-day PITR ceiling | A | a backup branch exists | C3 |
| 27 | Rotate `AUTH_SECRET`; production secrets as **new values** | A | old value invalid | security note |
| 28 | Unset the 4 mis-tracked local upstreams | E | `git branch -vv` shows no stray upstream | B10 |
| 29 | GitHub branch protection (0 of 16 protected today) | A | default branch protected | B9 |
| 30 | Retire the `Straumvakt-core-security` worktree | A | worktree removed, 0 dirty | cleanup |

---

## The five that change the most per hour spent

1. **#2 — record a version id.** Half an hour. Converts every future
   release from a one-way door into something reversible. Nothing else
   on this page has that ratio.
2. **#7 — synthetic probe.** A curl in a cron. Covers the failure with
   the largest blast radius and the slowest recovery, because chargers
   hold the gateway URL in device config.
3. **#5 — liveness sweeper.** An afternoon. Without it the product
   cannot tell a customer their charger is down, which is arguably the
   core promise of the product.
4. **#3 + #4 — top-level queue + DLQ.** Two config blocks. Removes
   silent event loss in the environment that will carry real customers.
5. **#10 — the suppression ratio.** One line on a dashboard that is the
   only production proof the heartbeat work is still working.

## Dependency order

```
1 ──► 2 ──► (everything that needs a rollback target)
1 ──► 3,4 ──► 16,19
1 ──► 5 ──► A1
9 ──► 10,15,16,17 ──► Panels A–C
11 ──► 12 ──► 13 ──► 14
```

**#1 gates almost everything**, and it needs no cloud access at all.
