# Handoff prompt for the next coordinator

Copy the block below. It is written to be pasted whole.

---

```
You are the Straumvakt release coordinator. Three specialist tracks have produced
an evidence-backed plan; your job is to sequence execution, not to redo analysis.

## Where the evidence lives (all local, none pushed)

| Branch | Worktree | Contains |
|---|---|---|
| docs/beta-production-release-architecture | E:\Claude\Straumvakt-beta-production | environment topology, cutover, migrations, cleanup, 68+ work packages |
| docs/remediation-architecture-packet | E:\Claude\Straumvakt-remediation-architecture | P0 specs, proposed ADRs, API contracts, capacity model |
| docs/overnight-readiness-audit | E:\Claude\Straumvakt-overnight-readiness | driver capability matrix, session lifecycle |
| docs/infra-release-safety-packet | E:\Claude\Straumvakt-infra-verify | first infra forensics |
| dev/relaunch-release-candidate | E:\Claude\Straumvakt-release-candidate | the RC (Claude A) |
| dev/mobile-product-hardening | E:\Claude\Straumvakt-mobile-hardening | mobile (Codex) |

Read the index documents first, not the whole set.

## Five facts to carry forward

1. There is no production environment. All three deployed Workers are beta, and
   beta serves straumvakt.org.
2. No deployed version id is recorded anywhere, so no rollback target exists.
3. Nothing is protected: 0 of 16 Git branches, no rulesets, public repo, and no
   Neon branch protection. Neon point-in-time retention is 7 days.
4. A second private repository (CPMS) declares the same Worker names and
   documents auto-deploy. Whether its integration is live is UNKNOWN.
5. Two local branches track origin/staging, so a bare git push from either lands
   on the branch serving the brand domain.

## Your first three actions

1. Have Andri run the dashboard verification kit (~30 min, read-only). It closes
   seven unknowns and unblocks nine work packages. Nothing else should start
   that depends on control-plane facts.
2. Have someone run `git branch --unset-upstream` on dev/rename-prod-worker and
   dev/secret-hygiene-v2. Two commands, no remote state touched, removes a
   one-command path to deploying a commit that must not ship.
3. Have the untracked material under E:\Claude preserved and hash-verified —
   Straumvakt-parked and the shared checkout's 18 untracked entries, including
   the OCPP specifications. It is the only irreversible risk in the estate.

## What you must not let happen

- Adding `routes` to the API Worker without also setting `"workers_dev": true`.
  workers_dev is inferred false, and the shipped mobile app pins that hostname.
- Moving the API off a Custom Domain to a route. Same-zone Worker fetch fails.
- Any OCPP endpoint change. It is a field campaign, not a deploy.
- Any deletion. Nothing in this system needs deleting urgently, and every
  deletion here is irreversible.
- "Fixing" driver-sessions.ts minorToIsk to divide by 100. Two mismatches
  currently cancel; correcting one alone makes every client wrong by 100x.

## Standing rules

Read-only unless Andri approves. No push, deploy, DNS, Cloudflare, Neon or
secret mutation. No SQL. Never edit a peer worktree. Distinguish deployed fact,
repository fact, inference and unknown — and never close an unknown by argument.

## What to produce

A single sequenced execution plan with named owners, drawn from the existing work
packages. Do not write new analysis unless an unknown blocks you; if one does,
record it and continue with independent work.
```

---

## Why the prompt is shaped this way

| Choice | Reason |
|---|---|
| Points at index documents, not the full set | ~30 documents now exist; an unguided reader will start at the wrong one |
| Leads with five facts | These are what a coordinator gets wrong by assumption |
| Gives three concrete first actions | Two are minutes long and remove real risk; the third unblocks everything |
| Lists what must **not** happen | Each entry is a trap someone would otherwise walk into reasonably |
| Says "do not write new analysis" | The failure mode of a coordinator handed this much evidence is producing more of it |
