# Architecture — Reference of Work to be Done

> **This folder is the canonical reference for all V3 work on Straumvakt.**
>
> Every sprint, every milestone, every architectural question traces back
> to the documents here. If something you are about to build is not
> described or implied by these documents, stop and update them first —
> don't silently drift.

---

## The three canonical documents

| Document | What it is | When you read it |
|---|---|---|
| [`STRAUMVAKT_ARCHITECTURE_V3.md`](./STRAUMVAKT_ARCHITECTURE_V3.md) | The architecture canon. Principles, seven-layer asset hierarchy, three integration tracks, commercial model, data retention, runtime, schemas, non-goals. | Any time you're making an architectural decision or adding a new module |
| [`STRAUMVAKT_V3_DELIVERY_PLAN.md`](./STRAUMVAKT_V3_DELIVERY_PLAN.md) | The execution canon. Scope, success criteria, 10 sprints × 3–5 milestones, open questions, risks, working conventions. | Start of every sprint, end of every sprint (retrospective check-in) |
| [`straumvakt_architecture_v3.svg`](./straumvakt_architecture_v3.svg) | The visual map. Six horizontal lanes (Clients → Edge → Integration → Event Bus → Domain → Data) plus business hierarchy, commercial model, and principles insets. | Any time you need the big picture in one frame |

**Reading order for a first pass:** architecture → diagram → delivery plan.

---

## What these documents supersede

These are the source of truth going forward. Older documents remain in
the repo for historical context but are **no longer authoritative**
unless explicitly referenced from V3:

- `docs/scope/CPMS_Scope_v1.2_Stage1_Beta.docx` — superseded for
  architecture and scope; retained for domain-language reference.
- `docs/scope/CPMS_Scope_v2.0_Full.docx` — superseded as future vision;
  V3 architecture replaces it.
- `docs/scope/VSCODE_BRIEF_*.md` — superseded as session plans; V3
  delivery plan replaces session sequencing.
- `docs/notes/THREAD_*.md` — conversation artefacts; useful archaeology,
  not authority.

The older scope `.docx` files still carry useful detail on Icelandic
domain concepts (DSOs, retailer rate profiles, Auðkenni specifics, VSK
breakdown) — read them for those, not for architectural direction.

---

## Working rules for anyone (including future-you) touching V3

1. **Architecture changes require an ADR** — even for yourself. Write
   a short entry under `docs/adr/NNNN-title.md`. The V3 architecture doc
   will point at ADRs for every load-bearing decision.

2. **Scope changes require an edit to the delivery plan** — if a sprint
   needs to change, change the plan first, then work. If you find
   yourself skipping a milestone, that's an amendment, not a quiet pass.

3. **The diagram stays in sync.** When the asset model, integration
   tracks, or commercial model change, update
   `straumvakt_architecture_v3.svg`. A stale diagram misleads more than
   it helps.

4. **"Foundations before floors" applies at every level.** Sprint N+1
   does not start until Sprint N's exit criterion has been met. The
   plan is a commitment to *order*, not dates.

5. **The 10 principles in the architecture doc are firm.** Violating
   one requires an ADR and explicit sign-off in the delivery plan's
   next retrospective.

---

## Reading-time estimates

- Architecture canon: ~20 minutes (first pass), 5 minutes (reference)
- Delivery plan: ~30 minutes (first pass), 10 minutes per sprint kickoff
- Diagram: 5 minutes

Budget an hour for the first complete read-through. Re-read the relevant
sprint at every sprint kickoff.

---

## Change log

| Date | Change | By |
|---|---|---|
| 2026-04-24 | Sprint 0 closed. ADR 0003 supersedes milestone 0.3 (no CPMS backfill — clean rebuild). Catalog seed (Zaptec + Zaptec Pro, empty profile) landed. tsc / build / vitest green. Retro in `docs/retros/sprint-00.md`. | Thor (with Claude) |
| 2026-04-24 | Hardware catalog + Installations added (ADR 0002). Architecture §3/§4/§5/§10 updated; delivery-plan Sprint 0 gains milestone 0.6 (catalog seed) and `hardware` schema; Sprint 5 gains Hardware nav group. SVG diagram update pending. | Thor (with Claude) |
| 2026-04-24 | Initial V3 drop — architecture, delivery plan, diagram | Thor (with Claude) |

Append entries above this line as the documents evolve.
