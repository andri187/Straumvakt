# PROPOSED A — `staging` is a production deploy pointer, and should stop pretending otherwise

**Status:** Proposed · **Date:** 2026-08-09 · **Decision owner:** Andri
**Register:** D-1

## Context

`straumvakt.org`, `www.straumvakt.org` and `hlada-staging.straumvakt.workers.dev`
returned byte-identical bodies (SHA-256 `4bf6719964446f68…`, measured
2026-08-08T23:25:42Z). The brand domain is served by the **staging** Worker.
`origin/staging` is 140 commits behind the frontier, 31 migrations against 47.

## Forces

- A deploy pointer answers "what is running"; trunk cannot.
- Trunk moves continuously; a customer-facing deploy should be deliberate.
- The 140-commit gap came from nobody advancing the pointer and nothing
  measuring the distance — not from having two branches.
- CI has been red on this lineage; auto-deploying every trunk commit would be
  worse than a stale pointer.

## Options

1. Keep `staging` as the live pointer, protected and fast-forward-only.
2. Promote a real production Worker; demote `staging` to genuine staging.
3. Collapse trunk and deploy pointer into one branch.

## Recommended

**Option 1 now, Option 2 as the target.** Option 3 is rejected: it trades a
visible-but-ignored gap for an invisible continuous deploy.

Conditions for Option 1 to be acceptable: no-force-push and no-deletion
protection on `staging`; fast-forward only from trunk; the trunk-to-staging gap
printed where a human reads it; each deploy tagged (the
`staging-deploy-YYYY-MM-DD-…` convention already exists).

## Consequences

Accepting means "staging" is knowingly the wrong word for a while — an
onboarding cost. Rejecting makes the Worker migration (PROPOSED-B) a launch
prerequisite rather than follow-up work.

## Security / tenancy

`staging` is unprotected, so anyone with push access can force-push the branch
serving the brand domain.

## Rollout / migration / observability

Protection first (no code impact), then the gap metric, then the tag habit. No
migration. Observe: gap count, last-deploy tag age.

## Unresolved

Whether a Git integration makes the push itself the deploy — PROPOSED-C.
