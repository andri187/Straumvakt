# Appendix S — Agent Landmine Barrier

A block to paste into every future Straumvakt agent prompt. It exists because
each rule below was earned: something in this programme went wrong, or nearly
did, in exactly that way.

---

## The barrier

```markdown
## Landmine Barrier (paste verbatim)

### Workspace
- Do NOT create a new top-level folder under `E:\Claude`. Work in an existing
  worktree. If you genuinely need a new one, STOP and ask.
- State every intended output path BEFORE writing anything.
- Keep docs under an existing `docs/notes` or the relevant docs folder.
- No duplicate repository copies.

### Artifacts
- Report the size of every artifact you generate.
- Report any `node_modules`, `.next`, `build`, `.dart_tool`, `.gradle`, `.turbo`,
  cache, coverage or screenshot pile you create or grow.
- Leave no untracked unique content without a manifest entry.

### Destruction
- Do NOT delete, move or archive anything unless a phase explicitly authorises it.
- Never `git clean`, `git reset --hard`, `git worktree prune`, `git branch -D`,
  a broad wildcard delete, or a process kill.
- Never a recursive delete on or near a junction. Unlink with `cmd /c rmdir`
  first, then confirm the target's file count is unchanged.
- Deletion is a separate session with a separate approval, after an archive has
  been verified by EXTRACTING and comparing hashes — never by reading a listing.

### External state
- No push, deploy, SQL, or mutation of Cloudflare, Neon, GitHub remote, DNS,
  OCPP, chargers, BLE/NFC or hardware.
- Do not open the contents of any `.env`, `.pem`, `.jks`, `.p12`, `key.properties`
  or credential file. Record existence by path only.
- Do not commit a secret value. Scan the STAGED set before committing.

### Peers
- Do not edit another agent's worktree. Record its tip; assume it will move.

### Evidence
- Every non-obvious claim needs a `file:line`, a command with its output, or a
  documentation citation.
- If you cannot establish something, write NOT DETERMINABLE and what would settle
  it. Inventing a fact is worse than returning nothing.
- Re-verify a claim you inherited before repeating it.

### Reporting
- Report start UTC, end UTC, actual wall-clock, target, and whether it was met.
- If under target, give the concrete reason. Do not pad.
- Confirm external state explicitly: what changed outside this machine, or that
  nothing did.
```

---

## Why each rule is here

| Rule | What it is protecting against, on this project |
|---|---|
| No new top-level folders | The estate reached **29 registered worktrees** while every document said six. I added a thirtieth myself last task. |
| State output paths first | Reports have been written into three different worktrees and then cited from a fourth. |
| Report artifact sizes | `E:\Claude` is **17.09 GB with 1.24 GB of content**. Nine worktrees, nine `node_modules`. |
| No recursive delete near a junction | It follows the link and deletes the **target**. The same following behaviour produced a measurement with negative real content and more reclaimable space than the tree contained. |
| Archive verified by extraction | A listing proves a listing exists. |
| Never open a credential | Nine credential-shaped files sit outside version control, including an Android upload key that **cannot be rotated**. |
| Scan the staged set | A real `AUTH_SECRET` is already public in this repository's history. |
| Do not edit peer worktrees | Two peers moved **during** a single run of mine; one moved twice. |
| `file:line` or NOT DETERMINABLE | An adversarial pass found claims with citations that pointed at the wrong lines, in my own documents. |
| Re-verify inherited claims | "Two mismatches cancel" survived four packets before line-by-line reading refuted the mechanism. |
| Do not pad | Two runs came in far under target. Reporting that honestly is more useful than filling the time. |

---

## Prompt ledger format

One row per run. Small enough that it actually gets filled in.

```csv
date_utc,prompt,lane,start_utc,end_utc,wall_clock,target,met,worktree,start_tip,end_tip,commits,files_changed,artifact_mb,new_folders,deletions,external_mutations,corrections,blockers
```

| Column | Rule |
|---|---|
| `wall_clock` | measured, never estimated |
| `met` | `yes` / `no` — and if `no`, `blockers` carries the concrete reason |
| `artifact_mb` | total size of what the run generated |
| `new_folders` | must be `0`, or name them |
| `deletions` | must be `0`, or name them and cite the approval |
| `external_mutations` | must be `none`, or enumerate |
| `corrections` | count of prior claims this run overturned — **a run with corrections is usually worth more than one without** |

### Rows so far

```csv
2026-08-09,ultra-release-ops,relops-b,13:09:14Z,13:20:57Z,0h11m43s,8-14h,no,beta-production,563b554,31ce40b,3,58,~0.4,0,0,none,3,"Cloudflare access absent"
2026-08-09,mechanical-execution-artifacts,relops-b,13:42:57Z,14:29:55Z,0h46m58s,8-14h,no,beta-production,31ce40b,56af65d,3,58,~0.5,0,0,none,3,"approval-gated work"
2026-08-09,overnight-verification-prep,relops-b,15:23:22Z,16:36:50Z,1h13m28s,4h,no,beta-production,56af65d,606ceae,2,83,~0.6,0,0,none,6,"credential-gated"
2026-08-09,control-plane-freeze,relops-b,22:07:55Z,22:45:21Z,0h37m26s,4h,no,beta-production,606ceae,939d9e4,2,37,~0.4,0,0,none,10,"credential-gated"
2026-08-10,commit-canonical-delete-duplicates,canonical,02:07:03Z,02:16:19Z,0h09m16s,none,n/a,Straumvakt,10c292b,82c63ac,1,97,~1.2,0,0,none,0,"deletion blocked by classifier"
```

The pattern in that table is the useful part: **five runs, none met target, every
one blocked on a credential or an approval rather than on work remaining.** That
is a finding about the programme, not about the runs.
