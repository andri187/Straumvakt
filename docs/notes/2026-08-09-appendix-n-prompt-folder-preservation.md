# Appendix N — Prompt and evidence folder preservation plan

**18 preservation records** for `C:\Users\Andri\Documents\New project`.

**Nothing was moved, deleted or modified. This is a plan and an inventory.**

---

## Why this folder is the sharpest preservation risk in the project

| Measured | Value |
|---|---|
| Total files | **22,888** |
| Approximate size | **~9.04 GB** |
| Top-level entries | **170** (35 directories + 135 files) |
| Git directory present | **yes** |
| **Commits** | **0** |
| **Tracked files** | **0** |
| Untracked top-level entries | 170 |
| Markdown documents at top level | **33** |

An earlier finding recorded this folder as "unbacked". That was too kind. It has
a `.git` directory with **zero commits and zero tracked files** — which is worse
than having none, because the presence of `.git` invites the assumption that it
is safe. Nothing here has ever been committed. There is no remote, no reflog, no
stash: a `git clean -fdx` run in the wrong directory removes the instructions that
drive all three agents, and the coordinator ledger with them.

**Second problem: signal-to-noise.** Of 22,888 files, the load-bearing content is
roughly 33 markdown documents. The rest is decompiled third-party code, DaVinci
Resolve crash diagnostics, and tool caches. Committing the folder as-is would be
both useless and, for some of it, a redistribution decision nobody has made.

---

## Classification

| Class | Meaning | Commit? |
|---|---|---|
| **A** | Straumvakt-critical — prompts, ledger, handoffs, manifests | **Yes** |
| **B** | Straumvakt evidence — screenshots, reports, audit output | Yes, selectively |
| **C** | Third-party derived — decompiled APKs, vendor tool caches | **No** — archive only |
| **D** | Unrelated — DaVinci Resolve, user-profile repair | **No** — archive or leave |
| **E** | Tool cache — regenerable | **No** — ignore |

---

## Records

### N-01 · The 33 top-level prompt and handoff documents — **class A**
**Why** These *are* the programme. Every agent run, including this one, is driven by one of them. **How to prove preserved** `git ls-files '*.md' | wc -l` ≥ 33 after the first commit. **Checksum** the commit is the checksum. **Archive** the repository itself, plus an off-machine copy. **Approval** Andri. **Safe-delete prerequisite** never. **Recovery** none today.

### N-02 · `coordinator-ledger-straumvakt-2026-08-09.md` — **class A**
**Why** The cross-agent record: how three parallel agents avoid contradicting each other. **Prove** tracked in the first commit. **Recovery** none today. **Approval** the coordinator. **Note** this track writes to it; it does not own it.

### N-03 · `next-*.md` (16 files) and `overnight-*.md` (9 files) — **class A**
**Why** The task specifications. Reconstructing one after the fact means reconstructing what was asked, which is exactly what nobody can do. **Prove** all present in `git ls-files`. **Recovery** none today.

### N-04 · `straumvakt-agent-prompts-2026-08-08.md`, `straumvakt-mobile-*-handoff-*.md` — **class A**
**Why** Handoff contracts between agents and sessions. **Prove** tracked. **Recovery** none.

### N-05 · `mobile-import-manifest-2026-08-08.md`, `DRIVER_ACCESS_IMPLEMENTATION.md` — **class A**
**Why** Import manifests and implementation notes that the repository does not contain. **Prove** tracked.

### N-06 · `evidence/` — **class B**
**Why** Captured evidence supporting findings that are cited in committed documents. Evidence that cannot be produced is not evidence. **Prove** file count and hash manifest. **Archive** with the repository if free of personal data; otherwise archive only. **Prerequisite** scan for personal data first.

### N-07 · `ocpp-source-pack-2026-08-09/` — **class B/C, needs a decision**
**Why** OCPP source material assembled for this project. **Risk** may contain third-party specification text, which is the same licensing question as `docs/OCPP` (AD-14). **Prove** hash manifest. **Approval** Andri. **Do not commit until AD-14 is decided.**

### N-08 · `mobile-hardening-evidence-2026-08-09/`, `mobile-preservation-2026-08-08-232703/`, `mobile-edit/`, `mobile-hardening-edit/` — **class B**
**Why** The only record of mobile UI states at specific versions. Re-capture needs a working build at that version — expensive, sometimes impossible. **Prove** counts and hashes. **Archive** outside version control if large.

### N-09 · `straumvakt-mobile-audit/`, `transaction_analysis/`, `straumvakt_report_render/` — **class B**
**Why** Analysis output cited by committed documents. **Prove** hashes. **Commit** only the reports, not intermediates.

### N-10 · `driver-app-api/`, `my-vehicle-preview-staging/`, `straumvakt-alpitronic-inspired/`, `vehicle-hero-images/` — **class B**
**Why** Design and prototype material for surfaces Codex is currently building. **Approval** Codex owns the surfaces; Andri owns the material. **Prerequisite** confirm no vendor imagery is redistributed by committing it.

### N-11 · `.zaptec-apk/`, `.zaptec-jadx/`, and the top-level `.apk` — **class C**
**Why preserve** provenance for BLE and charger-protocol findings. **Why NOT commit** it is a decompiled third-party application. Committing it to a **public** repository would redistribute it. **Archive** outside version control. **Approval** Andri, explicitly. **Safe-delete prerequisite** the findings derived from it are written down somewhere that survives without it.

### N-12 · `.jadx-1.5.5/`, `.jadx-config/` — **class C/E**
**Why** The decompiler and its configuration. The tool is re-downloadable; the configuration is trivial. **Recovery** re-download. **Ignore** in `.gitignore`.

### N-13 · `cache/` — **class E**
**Why** Regenerable. **Ignore.** **Prerequisite before deletion** confirm nothing unique was written into it, which is not the same as assuming.

### N-14 · `DaVinci-Leftovers-Quarantine-*` (3), `Resolve-Crash-Diagnostics-*` (7), `Resolve-CurrentUser-*-Backup-*` (2), `Resolve-UserProfile-Compare-*` (2), `Andri-Resolve-Profile-Diff-Fix-*` (2) — **class D**
**Why** Nothing to do with Straumvakt: DaVinci Resolve crash diagnostics and user-profile repair backups from 2026-07-31. **16 directories plus matching `.txt` reports.** **Do not commit.** **Approval** Andri — these are personal-machine artefacts and may still be wanted. **Action** leave in place, exclude from the repository, and treat as out of scope for this programme rather than as clutter to clear.

### N-15 · `*.png` (30), `*.svg` (8), `*.html` (6) at top level — **class B/D mixed**
**Why** Includes `charger_settings_*.png`, `connectivity_redo.png` and similar — Straumvakt UI evidence — mixed with unrelated images. **Prerequisite** classify individually before committing; do not bulk-add.

### N-16 · `*.ps1` (13), `*.py` (1), `*.cmd` (1) — **class B/D mixed**
**Why** Includes `Compare-Resolve-UserProfiles.ps1` (class D) and `build_straumvakt_report_docx.py` (class B). **Prerequisite** classify individually. **Scan for credentials before committing any script.**

### N-17 · `*.txt` (29), `*.log` (2), `*.csv` (3), `*.docx` (1), `*.zip` (1), `*.xml` (1), `.~lock.*` — **class mixed**
**Why** Includes `samgongustofa_folksbifreidar_rafmagn.csv` (Icelandic vehicle registry data — check for personal data before it goes anywhere) and DaVinci cleanup reports. **Prerequisite** a personal-data scan on every `.csv` before any archive leaves the machine. **Delete** the stale `.~lock.` file only after confirming nothing has it open.

### N-18 · The absence of credentials — **class A, an assertion to verify**
**Why** Preserve the *absence*. This project has already committed one real `AUTH_SECRET` to a public repository, so the habit exists. **Prove** a filename scan for `.env`, `token`, `credential`, `key`, `secret`, `.pem`, `.p12`, `.keystore` across all 170 top-level entries returns nothing, and a content scan of everything staged returns nothing, **before** the first commit. **Stop condition** any hit — do not commit until it is resolved. **Never** run a content scan that prints matches into a log.

---

## Plan

**Step 1 — classify, do not move.** Walk the 170 top-level entries and assign a
class. Records N-15, N-16 and N-17 explicitly require per-file judgement; the
rest are decided above.

**Step 2 — write `.gitignore` before anything else.**

```gitignore
# Tool caches and third-party decompilation — archived, never committed
.jadx-1.5.5/
.jadx-config/
.zaptec-apk/
.zaptec-jadx/
cache/
*.apk

# Unrelated to this project (DaVinci Resolve, profile repair, 2026-07-31)
DaVinci-Leftovers-Quarantine-*/
Resolve-Crash-Diagnostics-*/
Resolve-CurrentUser-*/
Resolve-UserProfile-Compare-*/
Andri-Resolve-Profile-Diff-Fix-*/
davinci-cleanup-report-*.txt
andri-resolve-profile-diff-fix-*.txt

# Editor and lock artefacts
.~lock.*
*.tmp

# Never, under any circumstances
.env
.env.*
*.pem
*.p12
*.keystore
```

**Step 3 — scan before staging.** Filename scan (N-18), then a content scan of
the staged set only. **Any hit stops the commit.**

**Step 4 — first commit.** The 33 markdown documents plus the coordinator ledger.
Nothing else in the first commit — a small, reviewable commit is easier to trust
than a 22,888-file one.

**Step 5 — verify.**

```bash
git -C "C:/Users/Andri/Documents/New project" log --oneline        # ≥ 1 commit
git -C "C:/Users/Andri/Documents/New project" ls-files | wc -l     # ≥ 34
git -C "C:/Users/Andri/Documents/New project" status --porcelain | wc -l
#   → tens of entries, not tens of thousands
```

**Step 6 — canonical copy.** Copy the class-A documents to
`E:\Claude\Straumvakt\docs\prompts\` so they live inside a repository that
already has a remote. That is belt and braces: the prompt repository is local
only, and this programme's instructions should not depend on one disk.

**Step 7 — archive class B and C separately, outside version control**, with a
SHA-256 manifest, verified by **extracting and comparing** rather than by reading
the archive's listing.

**Step 8 — leave class D alone.** Not this programme's material, and not this
programme's call.

---

## What must not be included, and why

| Excluded | Reason |
|---|---|
| Decompiled Zaptec APK and jadx output | Redistribution of third-party software, into a **public** repository |
| DaVinci Resolve diagnostics and profile backups | Unrelated; may contain user-profile data |
| `cache/`, `.jadx-1.5.5/` | Regenerable, and 99% of the file count |
| Any `.csv` before a personal-data scan | `samgongustofa_folksbifreidar_rafmagn.csv` is a vehicle registry extract |
| Anything matching N-18's patterns | One real secret is already public from this project |

---

## Approval required

| # | Decision | Reversible |
|---|---|---|
| 1 | Initialise real version control here and commit the class-A documents | Yes |
| 2 | Copy class-A documents into `E:\Claude\Straumvakt\docs\prompts\` | Yes |
| 3 | Archive class B and C outside version control, location per AD-11 | Yes |
| 4 | Confirm class D is out of scope and stays untouched | Yes |
| 5 | Confirm the decompiled APK is **never** committed | Yes, but a public push is not |

Nothing above has been done. Every step is a copy, a commit or an ignore rule —
**there is no deletion anywhere in this plan.**
