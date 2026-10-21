# Claude A completion: Market Core backend readiness

## TL;DR

Straumvakt Core's billing *arithmetic* is finished and tested — eight pure modules, ~241 tests. What
is missing is the *record*. There is no billing period, no statement, no settlement snapshot, no rate
lock-in and no enablement history. Core cannot invoice a customer today, and the reason is not that
the price is wrong: it is that nothing durable records what was charged, for which month, at which
rate, to whom. Seven launch blockers are named and verified, five decisions are escalated as
human-required, and the work is sequenced into 61 issue-ready packages behind a 175-row acceptance
matrix.

## Run

- Agent: `claude-a`
- Lane: `market-core-backend-readiness`
- Start UTC: 2026-08-11T00:00:49Z
- End UTC: 2026-08-11T00:27:25Z
- Wall-clock: ~27 minutes
- Prompt estimate: 4–8 hours
- **Estimate met: no.** This lane had already produced the eight pure commercial modules and three
  prior findings documents in earlier runs, so Phase 1 built on an existing base rather than starting
  cold. The census fanned out across five lanes in parallel and the two largest artifacts were
  generated from structured output rather than transcribed. No phase was skipped or sampled.

## Containment

- Target worktree: `E:\Claude\Straumvakt-core-billing` (as specified)
- Branch: `scratch/claude-a-core-billing-2026-08-10` — no upstream, never pushed
- Start tip: `56a789e`, clean
- End tip: `55cdfe84097de3f935eb26adc8d456b838ce35a8`
- End state: tracked tree clean
- Canonical `E:\Claude\Straumvakt` was read only. This completion file is the single write, as the
  prompt permits.

## Files changed

Four new documents in `E:\Claude\Straumvakt-core-billing\docs\notes\`:

- `2026-08-10-market-core-backend-readiness.md` (17.6 KB) — census table, blockers, decisions, merge plan
- `2026-08-10-core-schema-api-package.md` (12.9 KB) — tables, DTOs, routes, permissions, migration order
- `2026-08-10-core-launch-acceptance-matrix.md` (59.7 KB) — 175 rows
- `2026-08-10-core-backend-work-packages.md` (81.9 KB) — 61 packages

One commit: `55cdfe8 docs: market Core backend readiness package`.

No source file, schema, migration, route, test or configuration was modified.

## Checks run

- `npx vitest run` — **61 files, 962 passed, 1 skipped**
- `npx tsc --noEmit -p packages/commercial` — exit 0
- Encoding sweep of all new documents — no BOM, no mojibake
- Structural validation of the generated artifacts — no duplicate ids, no dangling WP dependencies,
  all 12 required matrix areas covered
- No dependency was installed

## Launch blockers

**B1 — no rate lock-in at session start** *(verified directly)*. `compute-session-cost.ts:69-70`
declares `startedAt`/`stoppedAt` and never reads them; `resolve-tariff-chain.ts` has zero references
to `validFrom`/`validUntil`/`effectiveFrom`. Pricing reads whatever `computeRule` is current at
pricing time, so editing a rate silently restates history. The correct mechanism exists one directory
away and disconnected — `pickActiveRate` (`agreement/resolve.ts:123-137`) has priced zero sessions.

**B2 — no session settlement snapshot.** The retailer component is resolved at
`resolve-tariff-chain.ts:286` and discarded at `projections.ts:444`; the ex-VAT/VAT split is computed
and discarded; `energy_wh` is one scalar overwritten twice.

**B3 — no billing period, statement or delivery record.** `period-close.ts` and `delivery-log.ts`
have zero callers. `billing.statements.content` JSONB was the only column that ever held a stored
document, and the resend branch requires one. Restoring `reports.billing_period_summary` would have
restored a cache, not a ledger.

**B4 — billing reads are cross-tenant.** 41 gates, 8 scoped. A null `orgId` skips the membership
lookup, making those gates simultaneously unreachable for org members and tenant-wide for platform
grants.

**B5 — the commercial model is not computable.** Connectors carry `status` with no enablement
history, so the 200 kr and 50 kr charges cannot be reproduced for a month that has ended. **Most
likely to be overlooked**, because the pricing function itself is finished and green.

**B6 — plug-time has no input.** `ocpp_stopped_at` and `cdr_stopped_at` are two feeds' values for the
same instant, not two clocks. There is no unplug timestamp anywhere.

**B7 — published tariffs are unpriceable**, and the throw rolls back the `session.stopped` row with
it, so the failure is a lost event rather than a null price.

## A defect in my own earlier work

`delivery-log.ts`'s `provider_ack_without_id` branch (`:112-119`) **can never fire**. `email.ts:91-99`
converts an ack-without-id into `{ok:false, reason:"send_failed", status:<2xx>}`, which falls through
to `retriable` at `:136`. An unidentifiable provider acknowledgement is therefore retried five times —
sending the customer duplicate statements, which is exactly what that module's own comment says must
be prevented. Recorded as its own work package.

## Decisions locked

Rate lock-in at session start; aurar internally with the final **line** rounded to ISK; statement
total is the sum of rounded lines; CDR mismatch beyond tolerance → `billing_review_required`;
reconciliation tolerance **0.05 kWh** (the live value, aligning `cdr-provenance.ts`'s 0.001);
plug-time anchored at `charging_end` with partial minutes down; closed periods take additive
corrections only; `start_rate` selection policy; CSV plus human-readable export first.

## Decisions still human

1. **VAT on the Core subscription** — `subscription.ts:118` returns ex-VAT while session ledger
   amounts are VAT-inclusive. The 200/50/450 frame cannot share a statement line with session costs
   until this is decided. **This blocks the first real statement and is not an engineering call.**
2. **Who is billed for what** — driver-paid vs organisation-paid vs split. `CostCenter`'s reader sums
   a table with no writer.
3. **Which resolver Core launches on** — legacy tariff chain or agreements. Both run concurrently and
   ungated; ADR 0025's per-installation flag does not exist in code.
4. **Retention and correction window** for closed periods.
5. **Whether `/apply` conversion is in Core scope**, or organisations are created by hand at launch.

## Cleanup candidates

- `docs/notes/2026-08-10-core-backend-billing-security-census.md` carries a UTF-8 BOM (mine, from an
  earlier run in this lane). Harmless but inconsistent with the rest of `docs/notes`.
- Five orphan enums and four dead Site tariff anchors — scheduled as the single destructive migration
  M9, to ship alone and last.
- Three declared-but-dead permission verbs: `billing.export`, `tariff.read`, `tariff.write`.
- Cross-agent note for Codex Work: the untracked `poc/` in `Straumvakt-onboarding-web` **is** safely
  preserved — `poc/dso-map-public-button-2026-08-10` @ `f2e302b`. Their completion file asked for
  that confirmation before removal.

## External-state confirmation

No push, no PR, no deploy, no migration written or run, no SQL executed, no database connection, no
Cloudflare/Neon/DNS/GitHub-remote mutation, no OCPP/charger/BLE/NFC action, no secret opened, no
dependency installed, no new top-level `E:\Claude` folder. No build output, screenshot or cache was
produced.

## Next action

Answer the VAT question (decision 1) — it gates the first statement and nothing downstream can be
finished without it. Then start **WP-36 / B5**, connector and driver enablement history: it is a
purely additive migration plus two writers, and until it exists no month can be invoiced regardless
of how correct the pricing is. Note the constraint it carries: history cannot be reconstructed
backwards, so the first invoiceable month is the first **whole** month after that migration ships.
That is a date to set deliberately, not to discover.
