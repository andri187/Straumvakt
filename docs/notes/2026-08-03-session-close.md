# 2026-08-03 — Session close

Companion to [`2026-08-02-session-record-and-rollback.md`](./2026-08-02-session-record-and-rollback.md),
which carries the rollback anchors and the Cloudflare reversal table.
This is the "what a cold reader needs" summary.

**Branch:** `dev/p4-c-ingest-integrity` · **base:** `9a9e724` ·
**45 commits** · **nothing pushed.**

---

## State of play

| | |
|---|---|
| P4-C (ingest integrity) | ✅ complete — 7 milestones |
| Tests | `apps/api` 641 + 1 skipped · `gateway` 91 · typechecks clean |
| `npm run build` | ⚠️ **never run** — Rule 10 gate unverified |
| Deployed | ❌ nothing |
| Migrations applied to staging | ✅ `protocol_log`, `archive_watermark`, retention reclassify |
| R2 lifecycle / `PARTITION_DROP_ENABLED` | ❌ deliberately off |

**Neon backup before the migrations:** `br-empty-mountain-ab7d1rc4`
(forked from staging `br-tiny-river-abgpqq37`).

---

## The blocking item

`prisma/schema.prisma` and `apps/api/prisma/schema.prisma` hold the
`ProtocolLogEntry` model **uncommitted**, entangled with concurrent
tap-intent work. `events.protocol_log` now exists in the database and the
routing code is committed — but `apps/api`'s deploy runs `prisma
generate` against its own schema copy, so the build produces a client
without the model until those files are committed.

---

## Deploy mechanics — not what CLAUDE.md implies

**There is no CI pipeline for the app.** The only workflow is
`zaptec-consumer-deploy.yml` (the Fly consumer). Pushing to `staging`
does not deploy `apps/api` or `gateway`. Each workspace deploys by hand:

```
cd gateway  && npm run deploy:staging
cd apps/api && npm run deploy:staging
npm run deploy:staging              # UI
```

### ⚠️ Order is load-bearing: gateway **before** apps/api

If `apps/api` ships first, the old gateway still stamps every frame
`raw_protocol`, and the new consumer routes `raw_protocol` →
`protocol_log`. **Every MeterValues frame, OCMF and all, lands in the
7-day table.** Recoverable only because `PARTITION_DROP_ENABLED` is
unset.

### Partitions run out 2026-08-09

Seven forward partitions exist. The cron extends them once `apps/api`
deploys; if the deploy slips past the 9th, ingest hits *"no partition of
relation found for row."*

---

## Retention: three gates before switching anything on

1. ✅ `protocol_log` migration applied
2. ✅ Reclassify applied — **6,321 rows of OCMF billing evidence moved
   out of 7-day disposal**; `raw_protocol` now means `ocpp.raw.Heartbeat`
   and nothing else
3. ❌ **R2 side not written.** The Postgres backfill does *not* make R2
   safe: retention class is baked into the object key (ADR 0037 D1), so
   historical objects stay under `raw_protocol/` regardless. A lifecycle
   rule on that prefix would still delete historical OCMF frames. Either
   exclude the pre-migration date range or re-key those objects.

---

## What this session got wrong, and how it was caught

Recorded because the pattern matters more than the individual errors.

- **Sprint renumbering (reverted in full).** Rewrote the delivery plan
  from line 206 without reading its own header banner, silently
  contradicting `GOING_PUBLIC_CRITICAL_PATH.md` — ratified two months
  earlier. *Read the top of a canon document before editing its middle.*
- **Nearly deleted billing evidence.** ADRs 0037 and 0039 as first
  written would have expired OCMF signed meter readings from both R2 and
  Postgres on a 7-day timer, because the gateway stamped `raw_protocol`
  on every frame. Caught by the operator's *"heartbeats only"*
  constraint. The same reasoning had already been applied correctly at
  the ingest layer in P4.12 and was not carried through to retention.
- **Four type errors shipped** in `4130daf` because root
  `npx tsc --noEmit` **excludes `apps/**`, `gateway/**`, `packages/**`**
  — the command CLAUDE.md Rules 9/10 name verifies about a third of the
  codebase. Rules 9/10 need a per-workspace typecheck.
- **F3 was not a defect.** Per-batch pg Pool is *required* by Workers I/O
  isolation, documented in `raw.ts`'s own header.
- **F23 was overstated.** The two schemas are semantically identical;
  the diff is comments and ordering.
- **P4.28 (`fleet_state`) was the weaker design.** ADR 0038 D3 argued it
  better and it was dropped.

---

## Open threads, by owner

**Operator decisions**
Accept ADRs 0037 / 0039 / 0040 / 0042 / 0043 · push or hold 45 commits ·
rotate `hlada`'s deferred secrets · raise Neon PITR off **6 hours** ·
heartbeat window 3 vs 7 days · re-apply for `.is` under an Icelandic
kennitala (ISNIC rejected it, which **invalidates P5.1 and SPRINT_11
11.1** — both specify `*.straumvakt.is`).

**Next implementation, roughly in order**
1. `tap_intents` FKs — free while the migration is unapplied
2. P4.29 console read path — the original "page reloads oddly" complaint
   is **still unfixed**; F13/F14/F15 all open
3. P4-D fleet simulator — **P5.5 depends on a "Scenario D" that has never
   existed**, so P5.7's go/no-go cannot honestly be signed
4. P4.30 derived downtime — gates the issue engine, SLA reporting, and
   ADR 0040's heartbeat disposal

**Live findings** — ADR 0035 F5/F12/F22/F23/F24 · the ten in
[`2026-08-03-prisma-schema-audit.md`](./2026-08-03-prisma-schema-audit.md),
six of them Rule 5.

---

## Not built, contrary to any impression otherwise

**The middle layer does not exist.** No read model, no serving tier, no
fanout. The console still calls the API Worker which queries base tables
directly, `listSiteTree` still recomputes the hierarchy and decrypts
credentials per request, and the driver apps still poll every 3–4
seconds. ADR 0038's invariant — *"no UI read path queries base tables
directly"* — is satisfied nowhere. What shipped this session was the
**write** path.
