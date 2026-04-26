# Change Management — How Straumvakt evolves

> **For:** any operator, advisor, or AI agent who is about to change
> something in this codebase. Read this before drafting an edit, an
> ADR, a migration, or a commit. It tells you which artefacts to
> touch, in which order, and what rule governs each step.

---

## 1. The artefact stack

Six layers. Each has one job.

| Layer | Where it lives | What it does |
|---|---|---|
| **Rules** | [`CLAUDE.md`](../../CLAUDE.md) (root) · `## Working rules` in [README](./README.md) | Constitution. Tells you what you can / cannot do without explicit operator instruction. AI-agent-binding form lives in CLAUDE.md; the README five-rule version is human-readable summary. |
| **Decisions** | [`docs/adr/NNNN-title.md`](../adr/) | Why something is the way it is. One ADR per load-bearing decision. Numbered sequentially. Status field controls authority (Proposed / Accepted / Superseded). |
| **Plans** | [`docs/architecture/STRAUMVAKT_V3_DELIVERY_PLAN.md`](./STRAUMVAKT_V3_DELIVERY_PLAN.md) · [`docs/sprints/SPRINT_NN_TASKS.md`](../sprints/) | What to do, in what order. Plan = sprint sequence + exit criteria. Sprint task list = implementation grain beneath each milestone. |
| **Canon** | [`STRAUMVAKT_ARCHITECTURE_V3.md`](./STRAUMVAKT_ARCHITECTURE_V3.md) · SVG diagrams (this folder) | Current decided shape of the system. Principles, hierarchies, integration tracks, schema list. Updated by ADRs. |
| **State** | [`prisma/schema.prisma`](../../prisma/schema.prisma) · `prisma/migrations/` · `src/` · `gateway/` | The actual implementation. Schema, migrations, repos, API routes, UI, OCPP gateway. |
| **History** | [`docs/retros/`](../retros/) · [`docs/notes/`](../notes/) · [README change log](./README.md#change-log) · git commits + tags | How we got here + how to roll back. Per-sprint retros, mid-sprint checkpoint notes, dated change-log table, git rollback anchors. |

**The principle behind the stack:** every change leaves a trail across
all six layers. A change with no ADR is invisible to future readers; a
change with no plan amendment drifts the sprint silently; a change
with no rollback anchor is irreversible.

---

## 2. The change flow

Every architectural change moves through three phases. Each phase has
a concrete artefact deliverable. None of the phases skip — even small
changes pass through all three (the artefacts are just shorter).

### Phase 1 — Propose

**Trigger:** somebody (operator, advisor, AI agent) says "I want to
change X."

**Required:**

1. **Pause and summarise.** State what the change does, what
   surface it touches, and what breaks if you proceed. CLAUDE.md
   Rule 5 — fundamental-logic stops — applies whenever the change
   touches OCPP semantics, control-plane ownership, OEM API control,
   external CPMS overlay, imported session/CDR authority, billing
   math, tariff resolution, access control, OCPI translation, or
   anything in the architecture canon.
   In those cases, *no code is written until the summary is approved
   in writing.*
2. **Read the relevant ADRs.** Search `docs/adr/` for prior
   decisions about the same surface. If your proposal contradicts an
   accepted ADR, you must supersede it — not silently override it.
3. **Identify the affected layers.** A change usually touches more
   than one. Tick which:
   - [ ] Rules (CLAUDE.md / README — almost never changes)
   - [ ] Decisions (ADRs — almost always)
   - [ ] Plans (delivery plan + sprint task list)
   - [ ] Canon (architecture canon + SVGs)
   - [ ] State (schema, migrations, code)
   - [ ] History (retro / checkpoint / change log)
4. **Name a rollback anchor.** Format: `pre-<topic>-YYYY-MM-DD`.
   The git tag isn't created yet — just reserved by name. It will be
   tagged before any destructive operation runs.
5. **Draft an ADR with `Status: Proposed`.** ADR template:

   ```markdown
   # ADR NNNN — <Title>

   **Status:** Proposed
   **Date:** YYYY-MM-DD
   **Sprint:** <which sprint will land this>
   **Supersedes (in part):** ADR NNNN — what it overrides
   **Rollback anchor:** pre-<topic>-YYYY-MM-DD

   ## Context
   <Why is this change being proposed?>

   ## Decision
   <What exactly changes?>

   ## Operating mode impact
   - Native OCPP:
   - OEM API control:
   - Hybrid:
   - External CPMS overlay:
   - Read-only intelligence:

   ## Consequences
   ### Positive
   ### Negative
   ### Neutral

   ## Alternatives considered
   <List rejected options + why>

   ## References
   <Links to canon §s, plan milestones, related ADRs>
   ```

   Numbering: next available NNNN in `docs/adr/`. Always sequential.

### Phase 2 — Commit to design

**Trigger:** Phase-1 ADR is approved by the operator and moves to
`Status: Accepted`.

**Required:**

1. **Cascade updates across the documentation stack.** For every
   layer the change touches:
   - **Plans** — edit `STRAUMVAKT_V3_DELIVERY_PLAN.md` if scope
     shifts (CLAUDE.md Rule 11). Edit
     `docs/sprints/SPRINT_NN_TASKS.md` to add/reshape milestones.
   - **Canon** — edit `STRAUMVAKT_ARCHITECTURE_V3.md` §s that
     reflect the new shape. Update visual SVGs that show the
     hierarchy / data model / commercial model when they change.
   - **History** — add a row to the README change log table at
     the top (most-recent first), with date, summary, ADR link, and
     rollback anchor.
2. **No code changes yet.** Phase 2 is documentation-only. The system
   in code still reflects the *previous* shape until Phase 3 lands.
3. **Cross-reference everywhere.** Each ADR should link the canon
   §s it amends; the canon should link the ADRs that amended it; the
   delivery plan should reference the ADRs scoped into each sprint;
   the sprint task list should call out which ADR is being
   implemented per milestone.
4. **Visual artefacts get a regeneration if data shape changed.**
   The SVGs in `docs/architecture/` are part of canon. If the asset
   hierarchy or schema changes, at minimum
   [`prisma_schema_graph.svg`](./prisma_schema_graph.svg) needs an
   update.

### Phase 3 — Land

**Trigger:** Phase-2 documentation is complete and the operator says
"go."

**Required (in order):**

1. **Schema** — only if the change touches `prisma/schema.prisma`:
   - CLAUDE.md Rule 4 — *edit-with-instruction*. The operator must
     have named the file in the current message before you edit.
     "Make changes" is a sufficient explicit instruction once the
     ADR is accepted.
   - Edit `prisma/schema.prisma`.
   - Run `npx prisma validate` — must come out green.
   - Run `npx prisma migrate diff --from-config-datasource prisma.config.ts --to-schema prisma/schema.prisma --script`
     to **generate** the migration SQL. Save it under
     `prisma/migrations/<ts>_<name>/migration.sql`.
   - **Do NOT apply the migration without explicit operator
     instruction (Rule 3).** The SQL is reviewable in writing first.
2. **Rollback anchor created.** Before applying any destructive
   migration: operator runs
   `git tag pre-<topic>-YYYY-MM-DD`. This is the operator's action,
   not the agent's.
3. **Apply migration** — operator runs `npx prisma migrate dev` (or
   `migrate deploy` for staging / production). Rule 3 again.
4. **Code** — repos, API routes, UI:
   - Repo + mapper pattern (Rule 7). Pages don't import Prisma
     types directly.
   - No mock data ever (Rule 6).
   - `withOrgContext` for tenant-scoped reads/writes; only Org-level
     CRUD bypasses it (and is documented at the top of the file).
5. **Verification suite** (Rule 10):
   - `npx prisma validate` — green
   - `npx tsc --noEmit` — exit 0 (main + gateway)
   - `npm run build` — clean
   - `npx vitest run` — all green
   - Smoke routes you touched in the running dev server
6. **Commit** — only when the operator explicitly asks (CLAUDE.md
   `# Committing changes with git`). One logical change per commit.
   Format: `[Sprint NN] terse summary`. Co-Authored-By trailer.
7. **Push** — only when the operator explicitly asks (Rule 1).
   Never to `master` without confirmation. Never with `--no-verify`.

### Mid-sprint and end-of-sprint history

- **Checkpoint note** — if the change is non-trivial and a session
  pauses mid-implementation, write
  `docs/notes/YYYY-MM-DD-<topic>.md` capturing the state. Includes
  what's done, what's pending, what the verification suite says,
  what operator decisions are open, and where the rollback anchors
  are. Cold-readable.
- **Retro** — at sprint end, write `docs/retros/sprint-NN.md`. What
  shipped, what slipped, what changed in the plan (ADRs filed),
  what to carry into the next sprint. Mandatory per Rule 11 — Sprint
  N+1 doesn't start until Sprint N's retro is filed.

---

## 3. Reading order for a cold advisor

If you're walking into the project with no context and you need to
understand what's happening before proposing changes, read in this
order. Budget about 90 minutes for a thorough first pass.

1. [`CLAUDE.md`](../../CLAUDE.md) — the rules. 5 minutes.
2. [`docs/architecture/README.md`](./README.md) — canonical-doc index +
   change log. 10 minutes.
3. **This document** — how change happens here. 10 minutes.
4. [`STRAUMVAKT_ARCHITECTURE_V3.md`](./STRAUMVAKT_ARCHITECTURE_V3.md)
   — the architecture canon. 20 minutes (first pass).
5. [`STRAUMVAKT_V3_DELIVERY_PLAN.md`](./STRAUMVAKT_V3_DELIVERY_PLAN.md)
   — the execution canon. 20 minutes.
6. [`straumvakt_roadmap.svg`](./straumvakt_roadmap.svg) — visual
   roadmap. 5 minutes.
7. **Most recent `docs/notes/<date>-*.md`** — what's true right now.
   The current checkpoint note tells you what's done, what's
   pending, what's blocked.
8. **Most recent `docs/sprints/SPRINT_NN_TASKS.md`** — current
   sprint's tasks with checkboxes.
9. **`docs/adr/*.md` in reverse-chronological order** — newest first.
   Stop reading when you understand the design. 15 minutes.
10. [`docs/retros/*.md`](../retros/) — completed sprints retros for
    historical context.
11. **`prisma/schema.prisma`** — the current decided data model.
    Skim, don't memorise.

When you're ready to propose, you should be able to answer:

- What sprint are we in? What milestones are remaining? What's
  blocking?
- Which ADRs touch the surface I'm proposing to change? Are any of
  them load-bearing for cost-center splitting / OCPP / OCPI / Issue
  Engine?
- Does this change still work if Straumvakt does not own OCPP/auth/
  control for the charger?
- What's the most recent checkpoint note say? What pending operator
  decisions are open?
- What rollback anchors exist? When were they created?

If any answer is "I don't know," go re-read.

---

## 4. The change flow in one diagram

```
                     Phase 1            Phase 2             Phase 3
                     PROPOSE            COMMIT TO DESIGN    LAND
                     ───────            ─────────────       ────
ADRs                 draft Proposed  →  Accepted         →
Plans                                   amend (delivery
                                        plan + sprint
                                        task list)
Canon                                   amend (§s, SVGs)
History                                 README change log →  checkpoint
                                                              note · retro
Schema                                                    →  edit · diff →  apply
                                                              (Rule 3 gate)
Code                                                      →  repos · API · UI
                                                              (Rule 7)
Verify                                                    →  prisma validate
                                                              tsc · build ·
                                                              smoke (Rule 10)
Git                                                       →  commit (Rule 8) →
                                                              push (Rule 1)
                                                              tag rollback
                                                              anchor
```

A small change might collapse into one session. A big change (like
rev-4: drop ChargerHost + enrich Org + add OCPP config keys) might
take days, with checkpoint notes between sessions and the apply step
deferred to a separate operator action. Either way, the artefact
trail is the same.

---

## 5. Worked example — Rev 4 (2026-04-26)

The most recent foundation change in this codebase. Use this as a
template for what a substantial change looks like across all six
layers.

**The trigger.** Operator paused mid-Sprint-2 and asked: "why are
there ChargerHosts? what data does Organization have? why people →
users not just drivers?" — flagging that the schema was too thin and
the asset hierarchy carried a vestigial tier.

**Phase 1 — Propose.**
- Pause + summarise: "Org/User schemas are minimal; multi-role and
  kennitala etc. missing; ChargerHost role gone after ADR 0008."
- Read prior ADRs: 0001 (foundation schema), 0002 (hardware catalog +
  installations), 0008 (cost-center splitting).
- Identified affected layers: Decisions, Plans, Canon, State, History
  — all six (Rules unchanged).
- Reserved rollback anchors: `pre-host-drop-2026-04-26`,
  `pre-org-enrichment-2026-04-26`.
- Drafted [ADR 0009](../adr/0009-drop-charger-host-tier.md) and
  [ADR 0010](../adr/0010-organization-profile-enrichment.md) as
  Proposed → moved to Accepted after operator approval.

**Phase 2 — Commit to design.**
- [Delivery plan §1.1 + §2](./STRAUMVAKT_V3_DELIVERY_PLAN.md) updated
  for "four-pass scope tightening" narrative; Sprint 2 row title
  expanded.
- [Sprint 2 task list](../sprints/SPRINT_02_TASKS.md): rev-3+rev-4
  status block, milestone 2.1 reshaped (Host CRUD struck through),
  milestone 2.6 expanded into the consolidated migration with
  per-ADR steps, milestone 2.14 added for OCPP configuration_keys.
- [Architecture canon §4 + §10](./STRAUMVAKT_ARCHITECTURE_V3.md)
  amended: hierarchy diagram redrawn without Host, multi-role Org
  framing added, schema list extended.
- New SVG [`prisma_schema_graph.svg`](./prisma_schema_graph.svg)
  generated to show every table in the rev-4 shape.
- README change log got two entries: ADR 0009 + ADR 0010 acceptance,
  and the rev-4 checkpoint note.
- No code yet.

**Phase 3 — Land.**
- Edited [`prisma/schema.prisma`](../../prisma/schema.prisma) — drop
  ChargerHost + ChargerServicePlan + HostType + HostStatus enums,
  add 12 new tables + 8 enums, ALTER 6 existing models, drop
  Property.host_id.
- `npx prisma validate` — green.
- `npx prisma migrate diff` — generated 483-line migration at
  [`prisma/migrations/20260426120000_rev3_foundation_consolidated/migration.sql`](../../prisma/migrations/20260426120000_rev3_foundation_consolidated/migration.sql).
- **Migration NOT applied.** Operator's call. Rule 3 gate.
- Code changes that did happen: removed `/tenants/hosts` UI + API +
  repo, fixed Sprint-1.5 dev provisioning route's stale Host
  reference, refreshed dashboard + Org detail page with rev-4
  framing.
- Verification suite (Rule 10) — `prisma validate` ✅, `tsc` ✅
  (exit 0), `npm run build` ✅ (clean), smoke ✅ (all routes 200,
  /tenants/hosts correctly 404).
- [Checkpoint note `docs/notes/2026-04-26-rev4-checkpoint.md`](../notes/2026-04-26-rev4-checkpoint.md)
  written — full file map, verification results, pending operator
  decisions, suggested next sprint moves.
- README change log updated with both the rev-4 entry and the
  checkpoint-note entry.

**What's left for the operator** (Phase 3 not fully landed):
1. `git tag pre-host-drop-2026-04-26` (rollback anchor before any
   apply).
2. `npx prisma migrate dev` (apply the migration — Rule 3 explicit
   instruction needed).
3. Commit + push the rev-4 work (Rule 1 + Rule 8).

This is the canonical example. Every future architectural change
should leave a trail of comparable depth across the six layers.

---

## 6. What an advisor can change · what they cannot

### Change freely (with appropriate ADR + plan amendment)

- Add new ADRs.
- Add new sprints, milestones, or task lists.
- Add new tables / columns / enums to `prisma/schema.prisma`
  (additive only, per Rule 4).
- Add new repos, API routes, UI pages.
- Add new SVG diagrams.
- Refactor visual artefacts to better explain decisions.
- Propose scope shifts (rev-1, rev-2, rev-3, rev-4 are all examples).

### Change only with explicit operator instruction

- `prisma/schema.prisma` (Rule 4 — including additive changes).
- `prisma migrate dev`, `migrate deploy`, `migrate reset` (Rule 3).
- `wrangler.jsonc`, `middleware.ts`, `open-next.config.ts`,
  `src/lib/admin-session.ts` (Rule 4).
- Any change to billing math, tariff resolution, OCPP semantics,
  access-grant resolution, OCPI translation (Rule 5 — stop and
  summarise first).
- Commits and pushes (Rule 1 + Rule 8 — git is operator-driven).
- Touching `master` branch in any form (Rule 1).

### Never change without exceptional cause + written approval

- Anything that supersedes an *Accepted* ADR — superseding is
  allowed but the new ADR must explicitly reference what it
  supersedes and document why.
- Rules in CLAUDE.md or this document. Process changes are
  themselves architectural changes; they take an ADR.
- Rollback-anchor naming after a tag exists.
- Already-applied migrations.

---

## 7. Common mistakes — what to avoid

1. **Editing the schema before the ADR is accepted.** Rule 4 +
   Rule 5 territory. The schema is the most expensive surface to
   change; design pressure must come from documents, not from code.
2. **Skipping the plan amendment.** Adding a milestone in a sprint
   task list without updating the delivery plan creates a silent
   drift. Rule 11.
3. **Skipping the rollback anchor.** Tags cost nothing. Forgetting
   one before a destructive migration is the difference between "an
   afternoon's work" and "incident".
4. **Putting domain data in the wrong artefact.** Real-world Iceland
   energy parties belong in `docs/reference/iceland-energy-parties.json`
   (and post-rev-4, in `tenancy.organizations` after the seed runs)
   — NOT in the architecture canon as inline lists. Canon is for
   shape; reference is for content.
5. **Re-deciding without superseding.** If you find yourself
   contradicting an accepted ADR in code, you owe the next sequential
   ADR explicitly superseding it. Silent re-decisions are how
   architectures rot.
6. **Treating OCPP identity as the charger.** Real-world assets must
   exist independently of whether Straumvakt controls them through
   OCPP, controls them through an OEM API, imports from an external
   CPMS, or only observes them in read-only mode. `OCPPIdentity` is a
   protocol endpoint, not the physical charger.
7. **Visual drift.** Updating the schema without regenerating the
   SVGs. Diagrams that lie are worse than diagrams that don't exist.
8. **Forgetting `npm run build` at end of session.** Rule 10. tsc
   passing isn't the same as build passing.

---

## 8. Quick reference — files an advisor will touch

| Purpose | File |
|---|---|
| Propose a decision | `docs/adr/NNNN-<title>.md` (next number; sequential) |
| Amend the plan | `docs/architecture/STRAUMVAKT_V3_DELIVERY_PLAN.md` |
| Amend a sprint | `docs/sprints/SPRINT_NN_TASKS.md` |
| Amend the canon | `docs/architecture/STRAUMVAKT_ARCHITECTURE_V3.md` |
| Visual artefacts | `docs/architecture/*.svg` (`+` mirror copy in `public/` if served from app) |
| Schema (Rule 4) | `prisma/schema.prisma` |
| Migrations | `prisma/migrations/<ts>_<name>/migration.sql` |
| Repos (Rule 7) | `src/lib/repositories/*.ts` |
| API routes | `src/app/api/admin/**/*.ts` |
| UI pages | `src/app/(app)/**/*.tsx` |
| Vendor/API adapters | `src/lib/vendors/**` |
| External refs / imports | vendor adapter contracts, import mappers, CDR/session normalization docs |
| Capability/routing contracts | OCPP dispatch targets, vendor dispatch targets, routing-policy docs |
| Mid-sprint state | `docs/notes/YYYY-MM-DD-<topic>.md` |
| End-of-sprint state | `docs/retros/sprint-NN.md` |
| Index of all changes | `docs/architecture/README.md` change-log table |

---

## 9. Sign-off — who decides what

- **Rules** (CLAUDE.md, this document) — operator + advisor
  consensus, captured as an ADR.
- **ADRs** — operator decides Accepted / Superseded.
- **Plans** — operator decides scope; advisor / agent drafts.
- **Canon** — amended by accepted ADRs only.
- **State** (schema, code) — operator gates every Phase-3 step
  (Rules 1, 3, 4, 5, 8).
- **History** (retros, checkpoints) — anyone writes; operator
  approves.

The operator (`Thor` for this repo) is the single point of decision
for every "ship this" moment. ADRs are how the operator delegates
authority to the design layer. CLAUDE.md is how the operator
delegates authority to the AI agent layer. Everything else is the
trail those decisions leave behind.

---

**Last updated:** 2026-04-26 — amended by
[ADR 0011](../adr/0011-control-plane-optionality.md) so every
architectural change records its impact on native OCPP, OEM API
control, hybrid, external CPMS overlay, and read-only intelligence
modes. Next update: when this process itself changes (which takes its
own ADR).
