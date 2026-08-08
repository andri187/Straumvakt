# ADR corpus — LEGACY

> **This corpus is historical reference, not active canon.**
> **Read [/FOCUS.md](../../FOCUS.md) instead.**

51 decision records, written between 2026-04 and 2026-08. Nothing here has
been deleted or moved — cross-links still resolve, and so do the paths
referenced by `.dependency-cruiser.cjs`.

**Their load-bearing constraints are extracted into the eight focus rules.**
Open an ADR only to recover the *reasoning* behind a rule you are about to
challenge.

---

## Why this corpus was retired

`docs/architecture/SCOPE_2026-08-04.md` measured the failure. In one session,
**nine things were found already built that nobody knew about**, and three
ADRs were written duplicating ground ten others already covered.

> *"45 ADRs exceed what one person can hold, so each new question gets
> answered fresh instead of looked up. That is how three billing generations
> happened — nobody decided to model billing three times."*

The corpus stopped being a memory aid and became the reason things were
forgotten. Decisions are now one line in [`/DECISIONS.md`](../../DECISIONS.md).

---

## Which ADRs each focus rule extracts

| Focus rule | Extracted from |
|---|---|
| **1** — the current code is the baseline | `docs/architecture/SCOPE_2026-08-04.md` §the discovery problem |
| **2** — the four safety rules stand | `CLAUDE.md` Rules 1–4 (unchanged, still in force) |
| **3** — one money pipeline | **0048** (supersedes **0025**) · **0031** + its 2026-06-14 amendment · **0019** (agreements architecture) · **0026** (invoice recipient) |
| **4** — the CDR is the record | **0049** · **0018** (raw archive, evidence bundles) |
| **5** — tenancy in every row and query | **0014** (identity/tenancy, five layers) · Architecture V3 principle 3 · `CLAUDE.md` Rule 7 |
| **6** — vendors at the edge, OCPP generic | `docs/notes/2026-08-04-target-domain-tree.md` §Vendors · **0012** (protocol-neutral model) · **0011** (control-plane optionality) · enforced by `.dependency-cruiser.cjs` |
| **7** — Drizzle owns the schema, raw SQL owns the hot path | **0051** (which ORM) · **0018** Decision 2 (the hybrid boundary — *not* repealed by 0051) |
| **8** — decisions are lightweight | the failure mode in `SCOPE_2026-08-04.md`; supersedes `CLAUDE.md` Rule 11 for the market phase |

## Still worth opening, occasionally

Not active canon — but these carry reasoning that is expensive to reconstruct:

| ADR | Why you might open it |
|---|---|
| **0048** | Which billing generation survives, and the measurement behind it |
| **0049** | What a CDR should contain; the OCPI 2.2.1 shape; where OCPP stops |
| **0051** | How the drizzle-kit baseline was done without recreating 66 tables |
| **0018** | Why the hot path is raw SQL — the 4k-charger numbers |
| **0031** | Agent-vs-principal posture and per-factor markup |
| **0045** | Why topology is a graph and not a tree level |
| **0047** | What dissolving Installation would cost (parked) |
| **0050** | The read-model diagnosis; the seven onboarding paths (parked) |
| **0052** | The team-scale workspace split (parked — see FOCUS.md) |

## Note on ADR 0052

Written 2026-08-07, retired to legacy the same day. That is not an error: its
content is the **parked** team-scale workspace split (M2–M4), and this corpus
is where parked plans live. The rules it contributed — vendors at the edge,
one money pipeline, the schema as the asset — are in FOCUS.md.

---

## Full list

Every file in this directory carries the legacy banner. Numbering is
chronological, 0001 → 0052; gaps are ADRs that were never written.
