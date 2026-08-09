# Appendix G — Cleanup preservation manifest (20 records)
> **Superseded in part by [the overnight verification-prep packet](2026-08-09-overnight-verification-prep-packet.md).** That run corrected several findings recorded here: the estate is **29 registered worktrees, not 6**; three worktrees are checked out **at** forbidden commits; the wrangler linter emits **5 L2 / 6 L3**, not 4 / 3; the linter's inheritance model was wrong and is fixed; and the money-unit finding's **mechanism** was wrong — there is no cancelling pair inside the API. See "Corrections" there.


**Nothing in this appendix has been deleted, moved, or modified.** This is a
register of what must survive, how to prove it survived, and what has to be true
before any deletion is even proposed.

The measurement behind it: **45.2 GB total, 42.92 GB (95%) regenerable, 2.28 GB real content**
(re-measured 2026-08-09 by an independent implementation; the earlier 43.76 / 41.57 / 2.25 figures were the same method on a slightly smaller tree). The first attempt at that measurement followed junctions,
double-counted shared `node_modules`, and produced impossible figures — negative
real content, and more reclaimable space than the tree contained. The correction
is recorded rather than silently applied, because the cause (tools follow
junctions) is the same cause as the most dangerous deletion mistake available
here.

**Deletion is a separate, later, separately-approved session.** Preservation,
archive verification, and deletion never happen in one sitting: bundling them
means the deletion happens while the archive verification is still fresh in
someone's optimism.

| Field | Meaning |
|---|---|
| **Kind** | what sort of thing this is |
| **Why preserve** | what is lost, specifically, if it goes |
| **Prove preserved** | the check that demonstrates it survived |
| **Checksum plan** | how integrity is established |
| **Archive target** | where the copy lives |
| **Approval** | who must agree before it is touched |
| **Safe-delete prerequisite** | what must be true before deletion is even discussed |
| **Recovery** | what actually gets it back |

---

## P-01 — `E:\Claude\Straumvakt-parked`
**Kind** Research output — OpenADR and dynamic-grid report. **38 files.**
**Why preserve** Not a git worktree. There is no remote, no branch, no reflog. It exists in exactly one place.
**Prove preserved** `cleanup-dryrun.ps1` section 1 reports `P1 PRESENT 38 files`.
**Checksum plan** SHA-256 per file, both sides, compared after copy.
**Archive target** Outside `E:\Claude`, alongside P-02.
**Approval** Andri. **Safe-delete prerequisite** Verified archive extraction (P-18) plus a decision on whether it should be committed somewhere.
**Recovery** Archive only. Nothing else has a copy.

## P-02 — `E:\Claude\Straumvakt\docs\OCPP`
**Kind** Third-party specifications — official OCPP 1.6, 2.0.1, 2.1. **128 files, untracked.**
**Why preserve** Untracked in a git repository means one `git clean -fdx` from gone. This is the reference for every protocol decision the project makes, and re-acquisition depends on third-party availability.
**Prove preserved** Dry-run reports `P2 PRESENT 128 files`; hash comparison after copy.
**Checksum plan** SHA-256 per file; counts must be 128 on both sides.
**Archive target** Outside `E:\Claude`.
**Approval** Andri. **Safe-delete prerequisite** AD-14 decided (committed versus archived) — the current state, untracked and unbacked, is not one of the options.
**Recovery** Archive, or re-download from the standards body if licensing permits.

## P-03 — Untracked entries in the canonical checkout
**Kind** Other agents' in-progress work. **24 dirty entries at session start** in `E:\Claude\Straumvakt` on `dev/straumvakt-org-relaunch`.
**Why preserve** Untracked files belong to Claude A or Codex and are not recoverable from any remote. The standing rule is explicit: never reset, clean, checkout over, or delete unknown work.
**Prove preserved** `git status --porcelain` count unchanged; every `??` entry copied.
**Checksum plan** SHA-256 per untracked file.
**Archive target** Outside `E:\Claude`.
**Approval** The owning agent, not this track. **Safe-delete prerequisite** The owner commits or explicitly abandons it. This track never decides.
**Recovery** Archive only.

## P-04 — `C:\Users\Andri\Documents\New project` (prompts and evidence)
**Kind** The programme's own instructions, evidence, and cross-agent record.
**Why preserve** **Correction to the earlier finding.** This was recorded as "unbacked". The truth is worse: it has a `.git` directory with **zero commits and zero tracked files**, 170 untracked entries at the top level, and 22,888 files in total (~9.04 GB). The presence of `.git` invites the assumption that it is safe. It is not — it has the appearance of version control and none of the substance.
**Prove preserved** `git log --oneline` shows at least one commit; the **33 top-level markdown documents** are tracked.
**Checksum plan** A commit is the checksum. Until one exists, SHA-256 per document.
**Archive target** Its own repository, plus an off-machine copy.
**Approval** Andri. **Safe-delete prerequisite** Nothing here is a deletion candidate. The tool caches (`.jadx-1.5.5`, `.zaptec-apk`, `.zaptec-jadx`, `cache/`) are, but only after the documents are committed.
**Recovery** None currently. **This is the single largest unmitigated preservation risk in the project.**

## P-05 — `coordinator-ledger-straumvakt-2026-08-09.md`
**Kind** The cross-agent coordination record.
**Why preserve** It is how three parallel agents avoid contradicting each other, and it lives inside P-04's zero-commit repository.
**Prove preserved** Tracked in P-04's first commit.
**Checksum plan** Covered by the commit.
**Archive target** As P-04.
**Approval** The coordinator. **Safe-delete prerequisite** Never a deletion candidate.
**Recovery** As P-04 — currently none.

## P-06 — Visual status page
**Kind** The coordinator's deliverable.
**Why preserve** It is the human-readable view of programme state.
**Prove preserved** Present and **byte-identical** in the backup.
**Checksum plan** SHA-256 before and after every session that touches the folder.
**Archive target** As P-04.
**Approval** The coordinator. **Safe-delete prerequisite** Never.
**Recovery** As P-04.
> **This track preserves it and does not edit it.** Updating it belongs to the coordinator, and this run wrote to the ledger documents instead.

## P-07 — Worktrees and their branches
**Kind** Twenty-nine registered git worktrees, 28 on disk, 1 stale registration.
**Why preserve** A worktree may be retired only when it holds nothing that exists nowhere else. Session-start state: `Straumvakt-release-candidate` `4b69d0f`, `Straumvakt-onboarding-domain` `4dea004`, `Straumvakt-onboarding-web` `7a25fa5`, `Straumvakt-driver-access-ui` `ad5d8c7`, `Straumvakt-n1` `52e3b32`, `Straumvakt-beta-production` `31ce40b`.
**Prove preserved** `git branch --list` still shows every branch after any retirement.
**Checksum plan** Tip sha per worktree, recorded before and after.
**Archive target** The branches themselves; a worktree is a working copy, not an artifact.
**Approval** Andri, and the owning agent. **Safe-delete prerequisite** Zero unique commits against the release candidate **and** zero dirty files.
**Recovery** `git worktree add` from the branch, which survives.
> **Never delete a branch as part of cleanup.** The branch is the cheap part.

## P-08 — Release candidate `4b69d0f`
**Kind** The commit a production release would promote.
**Why preserve** It is the reference point for every "unique commits" calculation in the cleanup plan.
**Prove preserved** `git cat-file -e 4b69d0f` succeeds in the canonical repository.
**Checksum plan** The sha is the checksum.
**Archive target** The object database; also present on `origin` if pushed.
**Approval** n/a. **Safe-delete prerequisite** Never garbage-collect while it is the release candidate — keep a branch or tag pointing at it.
**Recovery** From any worktree sharing the object database.

## P-09 — Mobile visual evidence
**Kind** Screenshots and captures of the Flutter app — 10,110 lines across 28 files' worth of UI.
**Why preserve** It is the only record of how the product looked at a given version, and it is the input to any store listing or beta communication.
**Prove preserved** File count and hashes in the archive manifest.
**Checksum plan** SHA-256 per image.
**Archive target** Outside `E:\Claude`, alongside P-10.
**Approval** Codex owns the UI; Andri owns the material. **Safe-delete prerequisite** Superseded by newer captures, and those captured.
**Recovery** Re-capture requires a working build at that version — expensive, sometimes impossible.

## P-10 — Web visual evidence
**Kind** Screenshots of the web application, including the per-organisation landing work.
**Why preserve** As P-09.
**Prove preserved** As P-09.
**Checksum plan** SHA-256 per image.
**Archive target** As P-09.
**Approval** As P-09. **Safe-delete prerequisite** As P-09.
**Recovery** As P-09.

## P-11 — Release-manifest fixtures
**Kind** **37 fixtures** in `scripts/analysis/manifest/release-fixtures/`, plus 8 environment-manifest and 5 wrangler fixtures.
**Why preserve** They are the executable form of seventeen judgements about what makes a release unsafe. Losing them turns the validator into untested code.
**Prove preserved** `node scripts/analysis/manifest/self-test-all.mjs` reports **50/50**.
**Checksum plan** Tracked in git; the commit is the checksum.
**Archive target** The repository.
**Approval** n/a. **Safe-delete prerequisite** Never — but note they are **regenerable** from `build-fixtures.mjs` except for the two hand-written bases.
**Recovery** `node build-fixtures.mjs`, plus the two bases from git history.

## P-12 — Junctions and their targets
**Kind** **Five cross-worktree junctions.**
**Why preserve** Not the junctions themselves — the **targets**. `Remove-Item -Recurse` can traverse a junction and delete the target rather than the link, and that same following behaviour is what produced the impossible measurement figures. The failure mode is demonstrated, not theoretical.
**Prove preserved** After each unlink, the target directory's file count is unchanged.
**Checksum plan** File count per target, before and after.
**Archive target** n/a — the targets are covered by their own records.
**Approval** Andri. **Safe-delete prerequisite** Every junction unlinked with `cmd /c rmdir "<junction>"` **before** any pruning.
**Recovery** `mklink /J` recreates the junction; a deleted target recovers only from its own archive record.

## P-13 — Any `_to_delete` folder
**Kind** A claim made by a past session.
**Why preserve** A folder named for deletion is a claim, not a verified fact, and the session that named it is not here to defend it.
**Prove preserved** Contents listed, hashed, and checked against every other record in this appendix.
**Checksum plan** SHA-256 per file before any decision.
**Archive target** Outside `E:\Claude` until confirmed regenerable.
**Approval** Andri. **Safe-delete prerequisite** Every file confirmed either regenerable or archived. **The name is not evidence.**
**Recovery** Archive.

## P-14 — Build output classified as regenerable
**Kind** `node_modules`, `.next`, `.open-next`, `.dart_tool`, `build` — **41.57 GB, 95% of the tree.**
**Why preserve** Conditionally, and only until regeneration is demonstrated. "Regenerable" assumes lockfiles resolve and registries are reachable, including for pinned versions that may since have been unpublished.
**Prove preserved** Not preserved — **proven reproducible**: `npm ci` into a temporary copy, `flutter pub get` into a temporary copy, both succeeding.
**Checksum plan** None. Reproduction, not integrity, is the property that matters.
**Archive target** None, once reproduction is demonstrated.
**Approval** Andri. **Safe-delete prerequisite** Reproduction demonstrated for **each** ecosystem, not assumed from one.
**Recovery** Reinstall — if the demonstration held.

## P-15 — `E:\Claude\CPMS`
**Kind** A separate project, and this project's provenance.
**Why preserve** CPMS is where the `hlada` name and much of the OCPP design originate. It explains why two projects declare the same Worker names: CPMS renamed `straumvakt` to `hlada` on 2026-04-19 and Straumvakt inherited the names on 2026-04-24. Deleting it would remove the explanation for the collision this programme is trying to resolve.
**Prove preserved** `git status` in the CPMS checkout shows nothing attributable to this track, at every session close.
**Checksum plan** Tip sha and dirty count recorded per session.
**Archive target** Its own repository.
**Approval** Not this track's to give. **Safe-delete prerequisite** Never, from here.
**Recovery** Its own remote.
> **Standing rule: never touch `E:\Claude\CPMS\CPMS\` files.** The mobile app is a separate sibling directory.

## P-16 — Credentials and tokens created for evidence sessions
**Kind** A scoped read-only Cloudflare token, and any equivalent.
**Why preserve** Preserve the **absence** of it from every repository. A real `AUTH_SECRET` from this project is already committed and public; the habit exists.
**Prove preserved** `git status` in every worktree shows no new file after the session; a grep for the token prefix across `E:\Claude` returns nothing.
**Checksum plan** None — never hash a credential into a manifest.
**Archive target** The OS credential store or a password manager, never a file in a worktree.
**Approval** Andri. **Safe-delete prerequisite** Revoke at session end rather than waiting for the TTL. A 7-day TTL is a ceiling, not a plan.
**Recovery** Reissue.

## P-17 — Cloudflare, GitHub, and Neon evidence bundles
**Kind** Captured control-plane evidence with a hash manifest.
**Why preserve** Every decision in Appendix H rests on evidence captured at a point in time. Evidence that cannot be shown unchanged is not evidence.
**Prove preserved** `bundle-manifest.txt` re-verifies; the secret scanner reports clean.
**Checksum plan** SHA-256 per file, plus a manifest.
**Archive target** `C:\Users\Andri\Documents\cloudflare-evidence-<date>\` — **outside `E:\Claude`**, because the tree is itself a cleanup target. `cleanup-dryrun.ps1` refuses to write its own manifest inside `E:\Claude` for the same reason.
**Approval** Andri. **Safe-delete prerequisite** Superseded by a newer capture, and the decisions it supported re-verified against that.
**Recovery** Re-run the read-only session — possible, but it captures *now*, not *then*.

## P-18 — The cleanup archive itself
**Kind** The verified archive of every preservation record.
**Why preserve** It is the recovery path for everything else. A deletion whose recovery is "we think we copied it" is not recoverable.
**Prove preserved** **Extract to a scratch location, re-hash, compare against the manifest, discard the extraction.** An untested backup is a hypothesis.
**Checksum plan** SHA-256 per member plus a manifest, verified from the extraction rather than the listing.
**Archive target** A location whose failure modes are **independent** of the original's — an archive on the same disk protects against `git clean`, not against disk loss (AD-11).
**Approval** Andri. **Safe-delete prerequisite** Its own retention rule, decided separately.
**Recovery** None. This is the bottom of the stack.

## P-19 — Beta personal data, wherever it appears
**Kind** Real users' data in the beta Neon branch, and in anything derived from it.
**Why preserve** Not "preserve" — **contain**. Beta has real users. Any branch, export, backup, or log derived from that branch carries their data and inherits the obligation. This record exists so that a copy made for safety does not quietly become a second exposure.
**Prove preserved** Every branch or export of the beta branch is recorded with its purpose and its retention.
**Checksum plan** n/a.
**Archive target** No archive of personal data leaves the platform without a decision.
**Approval** Andri. **Safe-delete prerequisite** For copies: as soon as their purpose is served.
**Recovery** n/a — this record is about **not** proliferating copies.
> Applies to logs too: no alert, log line, or evidence template in this programme may carry personal data, and none of Appendix D's templates has a field that could hold it.

## P-20 — Regeneration proof itself
**Kind** The demonstration that P-14 is genuinely regenerable.
**Why preserve** The entire cleanup case rests on 95% of the tree being reproducible. If that turns out to mean "was reproducible in April", the plan changes rather than the reality.
**Prove preserved** A dated transcript of `npm ci` and `flutter pub get` succeeding into temporary copies, with the resolved versions recorded.
**Checksum plan** Lockfile hashes recorded alongside the transcript.
**Archive target** With the evidence bundle (P-17).
**Approval** n/a. **Safe-delete prerequisite** n/a — this is the prerequisite for everything else.
**Recovery** Re-run, if the registry still cooperates. That is precisely the risk.

---

## Ordering — the part that actually prevents loss

1. **Prove reproduction** (P-20) — before anything is called regenerable.
2. **Copy and hash** every preservation record (P-01 … P-06, P-09, P-10, P-13).
3. **Commit** the prompt folder (P-04, P-05) — it is the one with no recovery path at all.
4. **Archive and verify by extraction** (P-18).
5. **Unlink junctions** with `cmd /c rmdir`, target counts checked after each (P-12).
6. **Then, separately, with explicit approval:** prune build output, retire zero-unique clean worktrees.
7. **Re-run the dry run after every step** — the preservation check is the tripwire, and running it once at the start does not protect the later steps.

`cleanup-dryrun.ps1` performs steps 1, 5 and 7's *reporting* and nothing else. It
contains **no executable delete statement** — verified by grep; the only
occurrences of delete verbs are inside comments and strings that instruct the
operator. Re-audit it before every run: safety by construction only holds if the
construction is re-checked.
