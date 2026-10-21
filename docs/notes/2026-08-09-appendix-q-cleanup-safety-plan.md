# Appendix Q — Cleanup safety plan (zero deletions)

**No deletion appears anywhere in this appendix.** It is a rehearsal, a retire
list, a must-not-delete list, an archive layout, and a verification gate. Deletion
happens later, in its own session, with its own approval, and only after the gate
passes.

The estate, measured read-only: **29 registered worktrees, 28 on disk, 1 stale
registration · 43 local branches against 16 remote · 3 top-level entries that are
not worktrees.**

---

## Q1 — The zero-delete rehearsal

Every step is read-only or a copy. Run it end to end; nothing it does needs
undoing.

```bash
cd E:/Claude/Straumvakt-beta-production

# 1. Freeze the inventory. Refuses to write inside E:\Claude.
node scripts/analysis/cleanup/build-freeze-manifest.mjs \
     --out docs/notes/evidence/freeze-manifest-<date>.json

# 2. Judge it with the independent validator.
node scripts/analysis/manifest/validate-freeze-manifest.mjs \
     docs/notes/evidence/freeze-manifest-<date>.json

# 3. Freeze the preservation register.
node scripts/analysis/cleanup/build-preservation-manifest.mjs \
     --out C:/Users/Andri/Documents/preservation-manifest-<date>.json
node scripts/analysis/manifest/validate-preservation-manifest.mjs --strict \
     C:/Users/Andri/Documents/preservation-manifest-<date>.json

# 4. Report what a prune WOULD reclaim. Contains no delete verb — grep it first.
grep -nE 'Remove-Item|rmdir|\bdel\b|\brd\b|Clear-|Move-Item' \
     scripts/analysis/cleanup/cleanup-dryrun.ps1
pwsh -File scripts/analysis/cleanup/cleanup-dryrun.ps1 \
     -OutFile C:/Users/Andri/Documents/cleanup-dryrun-<date>.txt

# 5. Copy the preservation material. COPY. Nothing is moved.
#    Then verify by extracting and comparing — never by reading a listing.
node scripts/analysis/cleanup/verify-archive.mjs \
     --manifest C:/Users/Andri/Documents/preservation-manifest-<date>.json \
     --archive  <extracted archive root> \
     --report   C:/Users/Andri/Documents/archive-verification-<date>.txt
```

**The rehearsal passes when step 5 prints:**

```
All N record(s) verified by extract-and-compare.
This is a precondition for proposing deletion. It is not an approval,
and it does not authorise anything.
```

**It fails loudly**, and the tool says so in those words: *deletion must not be
proposed* — not "proceed with care", **not proposed**.

---

## Q2 — Must not delete yet

| # | What | Why it cannot go |
|---|---|---|
| **MND-1** | `E:\Claude\Straumvakt\docs\OCPP` — 128 untracked files | Official OCPP 1.6 / 2.0.1 / 2.1 specifications. Untracked means one `git clean -fdx` from gone, and re-acquisition depends on the standards body still publishing these versions. |
| **MND-2** | `E:\Claude\Straumvakt-parked` — 38 files | OpenADR 3.1.0 specification set and the Dynamic Grid Iceland technical report in four formats, plus figures and a signed SOW. **Not a git worktree at all** — no remote, no branch, no reflog. |
| **MND-3** | `E:\Claude\zaptec-test` — 62 content files | **Not a spike.** A coherent Next.js technician-view diagnostic app: 11 tech-cards, 5 OCPP cards, a live dashboard, and `zaptec.ts` / `zaptec-state.ts` / `zaptec-enums.ts` / `ocpp.ts`. **It is not a git repository** — its own `.gitignore` is inert because there is no repo to honour it. |
| **MND-4** | `zaptec-test/src/lib/zaptec.ts` → `sendChargerCommand()` and the `POST /api/chargers/{id}/sendCommand/{commandId}` implementation | **This exists nowhere else.** The canonical repo *documents* the route and carries a richer `COMMAND_INFO` table, but has no cloud-API command-send implementation — `apps/api/src/lib/zaptec.ts` exposes read paths plus `putChargerProperties` only. This is working code that sends commands to physical chargers. |
| **MND-5** | The three worktrees at forbidden commits | `Straumvakt-rename-worker` @ `4fe0a95`, `Straumvakt-catchup-runbook` @ `30fa407`, and the stale registration @ `5311cbd`. Whether those branches are still wanted is Andri's decision, not a cleanup's. |
| **MND-6** | `C:\Users\Andri\Documents\New project` | 22,888 files, a `.git` with **zero commits**, and the prompts driving all three agents. Out of scope for `E:\Claude` cleanup, listed so nobody widens the sweep. |
| **MND-7** | Any worktree with dirty or untracked files owned by Claude A or Codex | This track never decides for another agent. |
| **MND-8** | `E:\Claude\CPMS` in its entirety | Provenance for the `hlada` names and the OCPP design. The standing rule is explicit, and P-15's "never, from here" is a prohibition on *this track* deleting it — protective, not an abandonment. |
| **MND-9** | The nine credential-shaped files | See Q5. They are not preservation targets; they are a rotation problem that must be settled before any archive is created. |

---

## Q3 — Safest retire candidates

Six worktrees have **zero unique commits against the release candidate and zero
dirty files**. Retiring a working copy is not deleting anything: `git worktree
remove` leaves the branch intact and `git worktree add` recreates it.

| Worktree | HEAD | Branch on remote? |
|---|---|---|
| `Straumvakt-audit-checks` | `2b7ebf6` | detached |
| `Straumvakt-driver-parity` | `2b7ebf6` | — |
| `Straumvakt-employee-landing` | `9a6c6f5` | — |
| `Straumvakt-n1` | `52e3b32` | — |
| `Straumvakt-relaunch-integration` | `14c1ce2` | — |
| `Straumvakt-release-candidate` | `4b69d0f` | — |

Two cautions the freeze validator enforces rather than trusts:

- **`Straumvakt-release-candidate` is the release candidate.** Its working copy is
  retirable; the *commit* must keep a branch or tag pointing at it or a future
  garbage collection could reach it. Rule FZ5 does not know that — a human does.
- **29 of 43 local branches exist on no remote.** For those, the branch is the
  only copy. Retiring the working copy is still safe; deleting the branch is not,
  and rule FZ5 fails any record that says `retire` without `branchPreserved`.

Plus the one clean registration fix: the stale `/sessions/rcw-.../Straumvakt-docs-log`
entry, removable with `git worktree prune` — preview it with `--dry-run -v` first.

---

## Q4 — Archive layout

Keyed by **record id**, not by basename, so two records with the same directory
name cannot collide. `verify-archive.mjs` expects exactly this shape.

```
<archive root>/
  manifest.json                    ← the preservation manifest this archive serves
  sha256sums.txt                   ← one line per member
  P-01/                            ← E:\Claude\Straumvakt-parked            (38 files)
  P-02/                            ← E:\Claude\Straumvakt\docs\OCPP        (128 files)
  P-03/                            ← untracked entries from the canonical checkout
  P-04/                            ← C:\Users\Andri\Documents\New project  (class A only)
  P-21/                            ← E:\Claude\zaptec-test  (62 content files; NO node_modules, NO .next, NO .env)
  README.txt                       ← what this is, when it was made, and what it does NOT cover
```

**Excluded by construction:** `node_modules`, `.next`, `.open-next`,
`.dart_tool`, `build`, and **every credential-shaped file**. The verifier fails
the whole run if one appears, because an archive containing a credential is a
second copy of a live secret.

**Two destinations**, and the plan must say which protects against what:

| | Protects against | Does not protect against |
|---|---|---|
| Second disk on this machine | a wrong delete, a `git clean` | losing the machine |
| Off-machine | losing the machine | nothing — but see P-19 before anything leaves |

---

## Q5 — Credential findings (paths only; nothing was opened)

Nine credential-shaped files sit outside version control under the estate root.
**None was opened.** Their existence is the finding.

| Path | Note |
|---|---|
| `CPMS\mobile-app-driver\android\app\straumvakt-upload.jks` | **An Android upload keystore. This is the one credential here that cannot be rotated** — lose it and that Play Store listing can never be updated again. It is also in **no** preservation record. |
| `CPMS\mobile-app-driver\android\key.properties` | The passwords for the keystore above. |
| `CPMS\CPMS\.data\charger-credentials.json` | Charger credentials, in a `.data` directory, in a repo with 161 dirty entries. |
| `CPMS\CPMS\.env.local`, `.env.development.local` | Local environment files. |
| `CPMS\CPMS\infra\terraform\secrets.tf` | Terraform secret definitions. |
| `CPMS\CPMS\.env.example`, `services\ocpp-server\.env.example` | Examples — but this project has already committed a **real** `AUTH_SECRET` into a file named `.env.example`, so "example" is not a guarantee. |
| `zaptec-test\.env` | In a directory that is not a git repository, so its own `.gitignore` protects nothing. |

**These are a rotation and custody problem, not a preservation problem.** The
upload keystore is the exception: it must be **preserved** and **not archived
alongside ordinary material** — it belongs in a password manager or credential
store, with its own decision. `straumvakt-upload.jks` should be treated as its
own approval item.

> **A detector correction worth recording.** The first version of this scan matched
> every `token.js` and `secrets.d.ts` inside `node_modules` and produced about 160
> lines of vendor noise around four real findings. A detector whose output nobody
> reads detects nothing. It now skips regenerable trees — which is also how the
> `.jks` came into view, since it had been missing from the pattern set entirely.

---

## Q6 — The sequence, and where deletion is allowed to appear

```
1. Freeze inventory        (read-only)   ── build-freeze-manifest → validate
2. Freeze preservation     (read-only)   ── build-preservation-manifest → validate --strict
3. Prove reproduction      (local)       ── see the caveat below
4. Resolve credentials     (APPROVAL)    ── Q5; the upload keystore first
5. Copy preservation       (copy only)   ── nothing is moved
6. Verify the archive      (read-only)   ── verify-archive.mjs, extract-and-compare
        ↑ everything above is reversible or read-only
────────────────────────────────────────────────────────────────────────
        ↓ only after step 6 prints "All N record(s) verified"
7. Unlink junctions        (APPROVAL)    ── cmd /c rmdir, never a recursive delete
8. Retire worktrees        (APPROVAL)    ── git worktree remove; branches survive
9. Prune build output      (APPROVAL)    ── separate session, separate approval
```

**Steps 1–6 can all be done today.** Nothing in them requires a decision, and
nothing in them is hard to undo.

### The reproduction caveat, which is a real defect in the earlier plan

Preservation records P-14 and P-20 both specify **`npm ci` into a temporary copy**
as the proof that build output is regenerable. **`npm ci` cannot run in this
repository at all.** `package-lock.json` is untracked, absent from disk, and
explicitly ignored at `.gitignore:51` — a deliberate choice recorded in the
project's own session log, to stop Windows-generated lockfiles breaking Cloudflare
builds. `npm ci` exits rather than installing.

So the proof method is impossible as written. The honest replacement:

- run **`npm install`** into a temporary copy, and record the resolved versions;
- accept that regeneration is **not bit-reproducible** — a later install may
  resolve differently;
- treat "regenerable" as *"can be made to work again"*, not *"can be restored
  identically"*, and say so wherever build output is called regenerable.

Until that is done, `regenerationProven` stays **false**, which is exactly what
the live preservation manifest records today.

### The junction count, which I can no longer state honestly

Three measurements of cross-worktree junctions have now produced **5**, **7** and
**0**, using three different methods. The disagreement is in the measurement, not
in the estate. Until one method is agreed and re-run, the count is **NOT RELIABLY
MEASURED**, and step 7 must begin by re-establishing it rather than by trusting
any figure in this programme's documents.

What is not in doubt is the rule: unlink with `cmd /c rmdir`, and confirm the
target's file count is unchanged afterwards. A recursive delete can traverse a
junction and remove the target instead of the link — which is the same
following behaviour that produced impossible size figures on the first
measurement of this estate.
