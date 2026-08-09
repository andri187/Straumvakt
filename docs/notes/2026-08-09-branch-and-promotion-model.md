# Branch and promotion model

**Design proposal. No branch, protection rule, or remote ref was created or changed.**

## Current state — measured 2026-08-09T10:50:37Z

| Fact | Value | Class |
|---|---|---|
| GitHub `default_branch` | **`dev/sprint-00-foundation`** (stale placeholder) | DEPLOYED-FACT |
| `main` / `master` | **neither exists** | DEPLOYED-FACT |
| Remote branches | 16 | DEPLOYED-FACT |
| Protected branches | **0 of 16** (`"protected": false` ×16) | DEPLOYED-FACT |
| Rulesets | **`[]`** | DEPLOYED-FACT |
| Repository visibility | **public** | DEPLOYED-FACT |
| `origin/staging` → frontier | `0 140` (strict ancestor) | DEPLOYED-FACT |
| `origin/staging` → RC | **`0 166`** | DEPLOYED-FACT |
| frontier → RC | `0 26` | DEPLOYED-FACT |
| RC excludes `4fe0a95`, `30fa407`, `5311cbd` | **confirmed absent** | DEPLOYED-FACT |

A public repository, zero protection, and the branch that serves the brand
domain is force-pushable by anyone with access.

## Target model

```mermaid
gitGraph
    commit id: "feature work"
    branch main
    commit id: "integrated" tag: "v-candidate"
    branch staging
    commit id: "same commit — ff only"
    branch production
    commit id: "same commit — ff only" tag: "release"
```

| Branch | Role | Writes | Protection |
|---|---|---|---|
| `main` | canonical integrated source | PR merge | no force-push, no delete, required checks |
| `staging` | **beta deploy pointer** | fast-forward from `main` **only** | no force-push, no delete, no direct commits |
| `production` | **production deploy pointer** | fast-forward from the **exact beta-tested commit** | as above + approval |

### The invariant that makes this work

> A commit reaches production **only** by being fast-forwarded from the commit
> that was already running in beta. Nothing is edited on the way.

If a fix is needed, it goes to `main`, flows to `staging`, is tested, and flows
on. **There is no path that puts code in production which beta never ran.** This
is the single property that makes "tested in beta" mean anything.

### Environment values live in configuration, not in branch diffs

Beta and production differ by `wrangler.jsonc` environment blocks and per-Worker
secrets — never by a branch-only patch. A branch that differs from `main` by an
environment tweak silently becomes a fork, and then "the exact tested commit"
stops being true.

## Fixing the current state without mutating it

Three problems, in dependency order. **None is performed here.**

1. **No trunk.** `main` does not exist. Recommended: create it *additively* at
   the RC commit rather than renaming anything — a rename deletes the old remote
   ref and breaks tracking for ~29 live worktrees simultaneously. The additive
   route costs a temporary two-names period, closed deliberately later.
2. **Default branch is a stale placeholder.** Repointing to `main` is one API
   call and changes what a fresh clone checks out and what PRs target.
   **GitHub refuses to delete a default branch**, so `dev/sprint-00-foundation`
   cannot be retired until this happens.
3. **The 166-commit `staging` gap.** `staging` is a strict ancestor of the RC
   (`0 166`), so closing it is a **true fast-forward** — no merge, no conflict
   possible. The gap is not a merge problem; it is a *pointer nobody advanced and
   nothing measured*. The fix is therefore procedural, not technical: advance it,
   then publish the distance.

## Protection specification

Phase 1 — costs nothing, blocks nothing legitimate:

| Branch | `non_fast_forward` | `deletion` | Required checks | Approvals |
|---|---|---|---|---|
| `main` | ✅ | ✅ | `check` (once green) | 1 (when a second reviewer exists) |
| `staging` | ✅ | ✅ | ❌ **deliberately none** | none |
| `production` | ✅ | ✅ | ❌ | **1 explicit** |

**No required status check on `staging` or `production`.** Both are
fast-forward-only pointers to a commit whose checks already ran on `main`.
Re-gating them would turn a bookkeeping rule into a deploy blocker — and, while
`check` is red on this lineage, into a *permanent* one.

**Approval on `production` is the human gate**, and it is the only place one is
needed: the code is already tested, so what is being approved is *"release it to
customers now"*, not *"is this correct"*.

Recommended as a single ruleset covering all three branches, since the rules are
identical apart from the approval requirement.

## Who can promote

| Action | Who | Gate |
|---|---|---|
| Merge to `main` | any engineer, via PR | checks green |
| Advance `staging` | any engineer | beta is expendable — speed matters more than ceremony |
| Advance `production` | **named release owner** | approval + the production gate checklist |
| Emergency rollback | **anyone on call, no approval** | see below |

**Rollback is deliberately ungated.** A control that slows recovery during an
incident is a liability. The rollback unit is the **Worker version id**, not a
Git operation — reverting the branch does not un-deploy anything, and
force-pushing a deploy pointer during an incident is itself a production action
that may re-trigger a build.

## Branch versus tag as the deployment trigger

The accepted decision is a `production` **branch**. Honoured. But tags should
**additionally** mark releases, for a reason that is not aesthetic:

| | Branch pointer | Immutable tag |
|---|---|---|
| Answers "what should be running" | ✅ | ✗ |
| Answers "what *was* running on date X" | ✗ — history is overwritten as it advances | ✅ |
| Can trigger a build | ✅ | ✅ |
| Survives a mistaken force-push | ✗ | ✅ |

A branch tells you the present; a tag preserves the past. Incident work needs the
past — *"which commit was live when this started?"* is the first question in
almost every runbook here, and a moving pointer cannot answer it.

**Recommendation:** `production` remains the trigger; every advance is
accompanied by an annotated tag `release-YYYY-MM-DD[-n]`. The repo already has
the habit (`staging-deploy-2026-06-04-pre-goingpublic`,
`pre-detour-2026-04-25`). Tags cost nothing and are the cheapest form of the
release evidence the production gate requires anyway.

## What this does not solve

- **It does not make the deploy deliberate.** If a Git integration is connected,
  advancing a pointer *is* the deploy. That is a control-plane fact
  ([forensics Q7](2026-08-09-hlada-staging-forensics.md)), not a branching one.
- **It does not protect against the CPMS collision.** Protection on this
  repository's branches says nothing about a second repository that declares the
  same Worker names.
