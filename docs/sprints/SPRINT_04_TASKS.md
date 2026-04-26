# Sprint 4 — Data Storage Lifecycle · Task List

**Status:** FUTURE — entry condition: Sprint 3 exit met.
**Branch:** `dev/sprint-04-data-lifecycle` (cut from `staging`).

> Sketch-level. See [delivery plan §7](../architecture/STRAUMVAKT_V3_DELIVERY_PLAN.md#7-sprint-4--data-storage-lifecycle).
> Aggregator correctness is high-trust — Rule 5 territory.

---

## Milestone 4.1 — Retention class column enforced

- [ ] All event-emit sites set `retention_class` explicitly (audit
      with `grep -rn 'retentionClass' src/`)
- [ ] Backfill migration for any historical rows missing the column
- [ ] Repo helper `assertRetentionClass(eventType): RetentionClass`

## Milestone 4.2 — Nightly aggregation job

- [ ] Cloudflare Cron Trigger at `0 3 * * *` (Europe/Reykjavik)
- [ ] Aggregate function: `(charger_id, hour) → {message_count,
      energy_delta_wh, fault_count}`
- [ ] Watermark table or last-row tracking
- [ ] Idempotent: re-running for the same window produces the same
      output (no double-count)
- [ ] Feature flag `AGGREGATOR_LIVE` — defaults off; flipped on after
      one week of dry-run logging

## Milestone 4.3 — raw_protocol age-out

- [ ] Daily cron, also gated by feature flag
- [ ] Delete only `raw_protocol` rows older than TTL (default 60
      days, env-configurable)
- [ ] Pre-condition: aggregate row exists for the window — if
      missing, skip + alert
- [ ] Synthetic test fixture: 1000 raw rows + 999 aggregates → 1
      survivor + 1 alert

## Milestone 4.4 — Financial + operational kept hot

- [ ] `docs/runbooks/retention-classes.md` written, per-class TTL
      table + rationale
- [ ] Unit test asserts age-out job *never* deletes
      `financial`/`operational`/`issue_history`

## Milestone 4.5 — Cold-archive scaffolding for issue_history

- [ ] R2 EU bucket provisioned (`straumvakt-archive-eu`)
- [ ] Monthly cron job behind feature flag
- [ ] Archive payload format: gzip-NDJSON
- [ ] Restore-test script (read N rows back from R2 into a scratch
      table)

---

**Risks:** Aggregator dry-run for 7 nights minimum before flipping
the feature flag. Retention deletes are permanent; verify aggregate
matches raw before deletion.
