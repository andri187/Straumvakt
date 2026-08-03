# 2026-08-02 — Session record + rollback guide

Written before context compaction so the reasoning survives, and so any
part of this can be reversed deliberately rather than archaeologically.

**Branch:** `dev/p4-c-ingest-integrity`
**Base (pre-session HEAD):** `9a9e724` on `feat/agreement-architecture`
**Commits added:** 29
**Nothing pushed.** All 29 commits are local.

> ⚠️ **Before any `git reset`, read "Uncommitted work that is NOT mine"
> at the bottom.** The tree contains concurrent tap-intent, ADR 0038 and
> mobile work that a hard reset would destroy.

---

## 1. Rollback anchors

| Want | Command |
|---|---|
| Undo **everything** this session | `git checkout feat/agreement-architecture` (the branch is untouched at `9a9e724`) |
| Keep the Sprint-9 tidy-up, drop all P4 work | `git reset --hard 81ac972` |
| Keep everything up to the roadmap, drop code changes | `git reset --hard 82e0a60` |
| Drop only the last change (F21 fail-closed) | `git reset --hard e0d32b4` |
| Inspect any single change | `git show <hash>` |

**Use `--keep` not `--hard` if the tree is dirty:**
`git reset --keep <hash>` preserves uncommitted work.

The safest reversal is `git checkout feat/agreement-architecture` — it
abandons nothing, because every commit stays reachable on
`dev/p4-c-ingest-integrity` until that branch is deleted.

---

## 2. What happened, in three phases

### Phase 1 — tree hygiene (`45bc567` … `81ac972`, 12 commits)

The working tree carried ~80 untracked files and 9 modified, some months
old. Triaged and committed in logical units: diagnostic probes, sandbox
seeds, three ADRs, dated notes, architecture diagrams, concept mockups,
the reference catalogue, the driver self-onboarding migration, billing
invoice UI, and a mobile BLE fix.

Also: `.gitignore` gained `apps/api/prisma/generated/` (**9.9 MB** of
generated Prisma client, which Rule 8 forbids committing) and `.claude/`.

**Duplicate ADR 0021 resolved.** Two documents held the number and the
citation graph was split — ADRs 0025 and 0031 cited `0021` meaning
*reference-catalogue*, ADR 0024 cited it meaning *autocharge*. Autocharge
renumbered to **0036** (fewer citations to repair).

### Phase 2 — planning reconciliation (`82e0a60`)

Found **four competing plan documents**: the delivery plan,
`GOING_PUBLIC_CRITICAL_PATH.md` (ratified 2026-06-04, phases P0–P6),
`gbtNotes/dc-readiness-sprint-plan.md` (DC1–DC5), and ADR 0017.

My first attempt renumbered sprints 10–22 and **was wrong** — it silently
contradicted a ratified plan I had not read, because I edited the
delivery plan from line 206 without reading its own header banner. That
attempt was reverted in full.

**ADR 0035** was rewritten to *extend* GOING_PUBLIC rather than replace
it: P4 expands, new **P7 (fleet acquisition)** added, P0.7 re-opened.
Phase numbering P0–P6 stands. Launch does not move, because P4 already
runs parallel to Track E.

### Phase 3 — P4-C execution (`4130daf` … `fa886f2`)

Seven milestones implemented. See §4.

---

## 3. Cloudflare + Neon changes — NOT in git

**These cannot be reversed by any git command.** Reverse them here.

| Change | Reversible? | How |
|---|---|---|
| Deleted D1 database `straumvakt-db` | ❌ **No** | It had **0 tables**, was created 2026-04-21, and was referenced in no config or source. Nothing to restore. |
| Disabled `workers.dev` on `hlada` | ✅ Yes | `POST /accounts/{acc}/workers/scripts/hlada/subdomain` with `{"enabled":true}` |
| Disabled `workers.dev` on `straumvakt-ocpp` | ✅ Yes | same, `.../straumvakt-ocpp/subdomain` |
| Disabled `workers.dev` on `straumvakt` | ✅ Yes | same, `.../straumvakt/subdomain` |
| Added custom domain `ws.straumvakt.org` → `straumvakt-ocpp-staging` | ✅ Yes | `DELETE /accounts/{acc}/workers/domains/5367755127ca8cc3a2b3da2eb26572d85dafa404` |
| Installed Cloudflare Claude plugin + marketplace | ✅ Yes | `claude plugin uninstall cloudflare@cloudflare` |

Account: `1b2fc4c163e8544e9cd472baa5a19c74`. Zone `straumvakt.org`:
`4f40b41fe94a59dd5e643875df8bf336`.

**No secrets were rotated. No production deploy was made. No R2
lifecycle rule was applied. No database migration was run.**

### Why the three workers were disabled

`hlada` (last deploy **2026-04-23**) and `straumvakt-ocpp` (**2026-04-19**)
were publicly reachable, running 3.5-month-old code. `hlada` held
`DATABASE_URL`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` and `AUTH_SECRET`, and —
being an April deploy — had **no rate-limiter bindings**, since those
exist only in `env.staging`. With exactly one Neon project in existence,
that connection string necessarily pointed at live billing data. It was
an unthrottled admin login against production data, on unpatched code,
for roughly three months. `straumvakt` (2026-04-19) was a third such
artifact with no secrets.

**Secret rotation was deferred by operator decision** and is still owed.

---

## 4. P4-C milestones delivered

| | Milestone | Commit |
|---|---|---|
| ✅ | P4.C0 baseline — clean tree | `45bc567`…`81ac972` |
| ✅ | P4.12/P4.13 — partition the ingest batch, fix archive identity | `4130daf`, `ef44dda` |
| ✅ | P4.14 — batch cadence 1s → 10s | `9de627b` |
| ✅ | P4.15 — R2 retention-class key, watermark, fail-closed drop | `e0d32b4` |
| ✅ | P4.16/P4.17 — durable outbound commands, subprotocol echo | `0d27030` |
| ✅ | P4.18 — Authorize verdict caching | `5a0ff5f` |
| ✅ | F21 — fail the Authorize gate closed | `44ca473` |

**Test state at write time:** `apps/api` 629/629, `gateway` 86/86, all
typechecks clean.

### The Rule 5 decisions, so they are not silently re-litigated

**P4.12 — MeterValues deliberately excluded from the batched path.** Its
projection early-returns unless the frame carries an OCMF `SignedData`
blob, so most frames do no database work and *could* be batched. Rejected
because deciding eligibility by payload inspection duplicates a condition
living in `projections.ts`. If database work is ever added before that
OCMF check, the classifier silently starts skipping projections and drops
**signed billing evidence and EVCCID vehicle identity**. The AMQP feed
carries the same OCMF and has died silently for 16h at a time, so the
OCPP path is sometimes the only source. Not worth ~19% of throughput.

**F21 — fail closed.** Operator decision: *"if things are offline, the
user can't charge."* The reasoning was attribution, not access: at a
multi-payer installation an unattributable session cannot be settled, and
ADR 0031 §15 would send that dispute to the host with no evidence. A
per-installation `host_absorbs` opt-out was designed and then explicitly
dropped as unnecessary.

---

## 5. Documents created

| Doc | Status |
|---|---|
| **ADR 0035** — scale readiness + fleet acquisition (extends GOING_PUBLIC) | Proposed |
| **ADR 0037** — R2 key scheme needs a retention-class segment | Proposed — **code already shipped against it** |
| **ADR 0039** — split the raw protocol log out of the event log | Proposed |
| `docs/sprints/P4_TASKS.md` — expanded P4 task list | Live |
| `docs/sprints/P4C_PROMPT.md` — kickoff prompt | Live |
| `docs/notes/2026-08-02-ampeco-benchmark-change-suggestions.md` | Live |

ADR 0038 (read-serving tier) is **not mine** — written concurrently by
the operator. P4.28 (`fleet_state`) was **dropped** in its favour
(`2c8960d`); 0038's D3 argument is better than the one P4.28 rested on.

---

## 6. Findings — F1 through F24

**Closed:** F1, F2, F2b, F4, F6, F7, F8, F9, F20, F21.

**Not defects after investigation:**
- **F3** — per-batch pg Pool is *required* by Workers I/O isolation. No
  change. P4.14's "open question" is answered: leave it.

**Open and consequential:**

| # | What | Why it matters |
|---|---|---|
| **F5 / F22** | Partition drop cannot reclaim `raw_protocol` — partitions are per-day, retention is per-class, every day holds indefinite `operational` rows. P4.15's gate is correct and will almost never fire. | **Unbounded Postgres growth is still unsolved.** ADR 0039 is the fix. |
| **F12** | No load-test harness. **P5.5 depends on a "Scenario D" that has never existed.** | P5.7's go/no-go cannot honestly be signed until P4-D builds it. |
| **F24** | A charger connecting to a *fresh* DO during an outage admits everyone at an armed installation, until its first successful lookup. | Fix is pushing `enforceAuthorize` at WebSocket-upgrade time, not in the DO. |
| **F23** | Two Prisma schemas 24 KB apart and diverging. | A model added to one is invisible to the other. |
| — | **Root `npx tsc --noEmit` verifies ~a third of the codebase.** `tsconfig.json` excludes `apps/**`, `gateway/**`, `packages/**`. | **CLAUDE.md Rules 9/10 name that command as the verification bar.** Four type errors shipped in `4130daf` before this was noticed. Rules 9/10 need a per-workspace typecheck. |
| — | **RLS (P4.5) cannot work as written.** Hyperdrive connects as `neondb_owner`; Postgres exempts the table owner from RLS. | The `straumvakt_app` role the task list assumes does not exist. |
| — | **Neon PITR is 6 hours** (`history_retention_seconds: 21600`), on the database holding real billing evidence, with no other backup. | Thinnest recovery posture in the stack. P5.3 wants 14 days. |
| — | **ISNIC rejected `straumvakt.is`.** | **Invalidates P5.1 and SPRINT_11 11.1**, which specify `app./api./ws.straumvakt.is`. Layout must be `.org`. |
| — | Outbox projection recognises only `accepted`/`rejected`, so P4.16's timeout and disconnect sweeps both surface as `failed`. | ADR 0017 specified `timed_out` as distinct. |
| — | Nothing calls `POST /invalidate-authorize` yet. The cache is per-identity-DO, so revoking a token must fan out to every identity. | A single call will look like it worked and will not be sufficient. |

---

## 7. Decisions still owed by the operator

1. **Accept ADR 0037?** Code is already shipped against it.
2. **Accept ADR 0039?** Implementation was in progress at write time.
3. **Push or hold** the 29 commits.
4. **Rotate** `hlada`'s `DATABASE_URL` / `ADMIN_PASSWORD` / `AUTH_SECRET`
   if shared with staging — deferred, still owed.
5. **Raise Neon PITR** off 6 hours.
6. **Re-apply for `.is`** under an Icelandic entity kennitala.
7. **Decide the permanent charger hostname before P7.** `ws.straumvakt.org`
   is attached; onboarding a fleet onto `workers.dev` instead means
   repointing every charger twice.
8. **F5/F22 reclamation** — ADR 0039 is the proposed answer.

---

## 8. Uncommitted work that is **NOT** mine

A hard reset would destroy these. They belong to concurrent operator
work, not this session:

- `apps/api/src/lib/tap-intent/`, `repositories/tap-intents.ts`,
  `routes/public/driver-tap-intent.ts`
- `prisma/migrations/20260802190000_tap_intents/`
- `docs/adr/0038-read-serving-tier-and-state-propagation.md`
- `docs/notes/2026-08-02-tap-and-auth-implementation.md`,
  `2026-08-02-foundation-gap-check.md`
- `apps/mobile/lib/screens/session_journey_mock.dart`,
  `charger_detail_sheet.dart`
- `docs/architecture/GOING_PUBLIC_CRITICAL_PATH.md` (modified),
  `docs/app/straumvakt-admin-concept.html`
- Various `apps/api/src` files: `idtag-classifier`, `oui/*`,
  `session-full-detail`, `vehicle-*`, `routes/admin/vehicles`,
  `zaptec-state-event`, `routes/public/driver`

Two files carry **both** mine and theirs and were deliberately left
uncommitted: `prisma/schema.prisma` (holds `TapIntent` **and**
`ArchiveWatermark`) and `apps/api/src/index.ts` (tap-intent routing
**and** the partition-drop cron wiring).

**Also in flight at write time:** an agent implementing ADR 0039, which
had already created `prisma/migrations/20260802220000_protocol_log/` and
modified `apps/api/src/lib/db/raw.ts`.

---

# Addendum — 2026-08-03

Seven further commits after `656f5ba` (where §1–§8 above stop). Nothing
in the Cloudflare/Neon section changed — **no new infrastructure
mutations were made**, so §3's reversal table is still complete.

## Commits

| hash | what |
|---|---|
| `c11bba7` | ADR 0039 implemented — `raw_protocol` writes routed to `events.protocol_log` |
| `9ac5c53` | fix: technical-read badge reported the wrong cause for unlinked chargers |
| `20eedc3` | ADR 0039 amendment — `raw_protocol` is too coarse to expire |
| `2de1734` | ADR 0040 — tier storage by volume and access pattern, not age |
| `65f4514` | classify retention by OCPP action at the gateway |
| `c436ff9` | ADR 0040 D4 — stop archiving heartbeats to R2 |
| `29fce37` | backfill migration: reclassify historical `retention_class` |

Additional rollback anchors:

| Want | Command |
|---|---|
| Keep everything up to the protocol-log split | `git reset --keep c11bba7` |
| Drop only the retention-classification work | `git reset --keep 9ac5c53` |

## The defect this addendum exists to record

ADRs 0037 and 0039, as originally written, **would have deleted signed
billing evidence on a timer.**

`gateway/src/identity-do.ts` stamped `retention_class = 'raw_protocol'`
on every inbound OCPP frame. That class did not mean "disposable" — it
meant "arrived over OCPP", and that set includes `MeterValues` (which
carries the OCMF signed meter reading) and `StopTransaction` (the
charger's own record of delivered energy). ADR 0037 expires the
`raw_protocol/` prefix from R2 at 7 days; ADR 0039 drops `protocol_log`
partitions at 7 days. Both would have fired on billing evidence, while
ADR 0031 §15 settles metering disputes on exactly those logs.

Caught by the operator asking for retention to be limited to *heartbeats
only*. Worth recording plainly: P4.12 had already refused to risk OCMF
for 19% of ingest throughput, and the same evidence was then put on a
deletion timer two ADRs later. The ingest-layer instinct was right and
was not carried through to the retention layer.

**Fixed in `65f4514`:** `Heartbeat` → `raw_protocol` (7d);
`MeterValues`/`StartTransaction`/`StopTransaction` → `financial`
(indefinite); everything else → `operational` (90d). Default is
`operational`, never `raw_protocol` — fail long, not short.

## Retention is gated. Nothing is live.

No R2 lifecycle rule is applied and `PARTITION_DROP_ENABLED` is unset,
so there is **no exposure today**. Before either is switched on, in
order:

1. **Apply `20260802220000_protocol_log`** — and it must land *before*
   the code deploys, or every `ocpp.raw.*` INSERT fails with "no
   partition of relation found for row". Total ingest failure, not
   degradation.
2. **Apply `20260803090000_reclassify_retention_by_action`** and verify
   the only rows left as `raw_protocol` are heartbeats.
3. **Handle R2 separately.** ⚠️ The Postgres backfill does **not** make
   R2 safe. Retention class is baked into the object key (ADR 0037 D1),
   so historical objects stay under `raw_protocol/` whatever Postgres
   says. A lifecycle rule on that prefix would still delete historical
   OCMF frames. Either exclude the pre-migration date range from the
   rule, or re-key those objects first. **This is not written yet.**
4. Only then enable R2 lifecycle rules and `PARTITION_DROP_ENABLED`.

## Test state

`apps/api` 641 passed / 1 skipped · `gateway` 91 passed · all three
typechecks clean.

The skipped test is deliberate, not a regression:
`ocpp-events.test.ts` "archives the events the insert reported fresh"
(F2). The fast path handles only heartbeats and heartbeats are no longer
archived, so the assertion has no reachable path. The underlying
contract is still correct and still covered in `lib/db/raw.test.ts`.

## Still stranded in the working tree

`prisma/schema.prisma` and `apps/api/prisma/schema.prisma` hold the
`ProtocolLogEntry` model, entangled with concurrent tap-intent work.
**The committed `protocol_log` code does not function without them.**
