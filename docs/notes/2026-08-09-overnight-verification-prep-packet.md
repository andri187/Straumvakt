# Overnight release-ops verification-prep packet

**Run.** `overnight-claude-b-release-ops-approved-verification-prep-2026-08-09.md`
**Worktree.** `E:\Claude\Straumvakt-beta-production` · `docs/beta-production-release-architecture`
**Start tip.** `56af65d`

The goal was to make the next human session mostly filling fields and running
known-safe commands. This packet is that session's kit — and, unexpectedly, the
run's largest output is a set of **corrections to my own prior findings**, three
of which were load-bearing.

## Navigation

| Appendix | Contents |
|---|---|
| [L — Cloudflare evidence session](2026-08-09-appendix-l-cloudflare-evidence-session.md) | 36 fillable fields, 30-minute session |
| [M — Neon and GitHub evidence](2026-08-09-appendix-m-neon-and-github-evidence.md) | 24 + 22 fields |
| [N — Prompt-folder preservation](2026-08-09-appendix-n-prompt-folder-preservation.md) | 18 records |
| Prior: [D](2026-08-09-appendix-d-dashboard-evidence-templates.md) · [E](2026-08-09-appendix-e-release-checklists.md) · [F](2026-08-09-appendix-f-offline-validator-spec.md) · [G](2026-08-09-appendix-g-cleanup-preservation-manifest.md) · [H](2026-08-09-appendix-h-approval-decision-records.md) · [I](2026-08-09-appendix-i-execution-work-items.md) · [J](2026-08-09-appendix-j-issue-bodies.md) · [K](2026-08-09-appendix-k-drills-rehearsals-nogo.md) | |

---

## Phase 0 — Containment

```
branch: docs/beta-production-release-architecture
tip:    56af65d23effd756af1d9a0d3365d8f4760e81d7   (matches the stated start tip)
dirty:  0
commits after 56af65d: 0

node scripts/analysis/manifest/self-test-all.mjs
  ok  environment manifests   8 fixtures
  ok  release manifests      37 fixtures
  ok  wrangler configs        5 fixtures
  ALL GREEN — 50/50 fixtures across 3 checkers

docs/OCPP: 128 files   Straumvakt-parked: 38 files   prompt-folder commits: 0
```

Nothing under `E:\Claude` was deleted, moved or modified at any point.

---

## Corrections

Twelve agents gathered ground truth and twelve more tried to refute them. Every
correction below was then re-verified by me directly — several of the refutations
were themselves partly wrong, so nothing here rests on an agent's word alone.

### C-1 — The estate is **29 worktrees, not 6**

Every prior packet said "six active worktrees" and scaled the cleanup plan to it.

| Measured | Value |
|---|---|
| Registered worktrees | **29** |
| Existing on disk | **28** |
| Stale registrations | **1** |
| Local branches | **43** |
| Remote branches | **16** — so **27 local branches have no remote counterpart at all** |
| Retirable (0 unique commits **and** 0 dirty) | **6** |

The stale registration is `/sessions/rcw-01fyf9w4byh1mrs6p2npr9my/mnt/Straumvakt-docs-log`
— a Linux path left behind by a cloud session. It still holds its branch and
still appears in every enumeration, which is why every count derived from
`git worktree list` was wrong until it was noticed.

### C-2 — All three forbidden commits are **checked out** right now

Knowing a branch carried `4fe0a95` was the prior finding. The stronger fact:

| Worktree | HEAD | Branch |
|---|---|---|
| `E:\Claude\Straumvakt-rename-worker` | **`4fe0a95`** | `dev/rename-prod-worker` |
| `E:\Claude\Straumvakt-catchup-runbook` | **`30fa407`** | `docs/staging-catchup-runbook` |
| the stale registration | **`5311cbd`** | `docs/relaunch-session-log-2026-08-08` |

Not merely reachable — **HEAD**. A working copy sitting on a forbidden commit is
one `git push -u` from publishing it. This became rule **G10**, which found it.

Reassuring counterpart: all three are **absent** from the release candidate
`4b69d0f` and from `origin/staging`, each check resolved rather than silently
skipped (rule G4 treats "unresolved" as failure, because unresolved is not absent).

### C-3 — My wrangler linter's model was **wrong**, and Cloudflare's docs settle it

I modelled `workers_dev` and `routes` as **non**-inheritable into named
environments. The documentation says the opposite:

> "The majority of keys are inheritable, meaning that top-level configuration can
> be used in environments. **Bindings**, such as `vars` or `kv_namespaces`, are
> **not** inheritable and need to be defined explicitly."
> — *developers.cloudflare.com/workers/wrangler/configuration/*

`workers_dev` is listed under **Inheritable keys**. The error ran both ways:

- **False positive** — the fixture `toplevel-only-covers-toplevel.error.jsonc`
  asserted that a top-level `workers_dev: true` fails to cover `env.staging`. It
  covers it. That fixture was one of the "50 green".
- **False negative, and worse** — a config with `routes` at the top level and an
  environment declaring neither key **inherits the routes**, so the inference
  fires for that environment **today**. The old model called that "latent" (warn,
  exit 0) rather than an error.

Rules now evaluate an **effective** config: inheritable keys inherited, bindings
not. Also fixed: only `routes` (plural) was checked, so a config using `route`
(singular) slipped through entirely. Three new fixtures cover all three cases.

**On the real configs the corrected model gives the same verdict** — 0 errors —
so nothing live was misclassified. The model was wrong; the answer happened not
to be.

### C-4 — The linter emits **5 L2 warnings and 6 L3 infos**, not 4 and 3

I wrote "four L2 warnings … exactly where predicted". It is five, and the fifth is
the web config's **own top level** (`hlada`, the production Worker name), which my
enumeration — "apps/api and gateway each, at top level and in env.staging" —
omitted entirely. "Exactly where predicted" was false. L3 is six, not three.

### C-5 — The money-unit finding was **wrong in its mechanism**

I have written, in several packets, that *"two mismatches currently cancel, so
fixing either alone breaks everything by a factor of one hundred."* The
documentation contradiction is real. **The cancelling pair is not.** Verified
line by line:

| Fact | Evidence |
|---|---|
| The unit is aurar, 1/100 króna | `compute-session-cost.ts:10-21` (the defining sentence is at :12, not :13 as I cited) |
| The contradicting comment exists | `driver-sessions.ts:93-98` — *"ISK has no minor unit, so minor === major"* + an identity conversion |
| **There is no second, cancelling conversion inside the API** | Every write stores the tariff output verbatim: `zaptec.ts:393`, `projections.ts:436,993`, `zaptec-session-sync.ts:317,358,459`. The database holds aurar. |
| The driver **wire contract is aurar**, and it is consistent | `driver-invoices.ts:20` — *"VAT-inclusive amount in aurar (1/100 króna)"* — and `:69` passes through without dividing, exactly like `driver-sessions.ts` |
| The compensation lives in the **web client** | All three driver pages divide by 100 — `history/page.tsx:27`, `cost/page.tsx:24`, `page.tsx:27` |
| …and they consume a **different** endpoint | All three fetch `/api/driver/invoices` (`:51`, `:53`, `:39`), **not** `/sessions/history`. A stale comment at `history/page.tsx:4` names the wrong endpoint, which is what makes this easy to get wrong. |
| The **Flutter app does not divide** | `active_session.dart:208-209, 290` — `toStringAsFixed(0)`, no division. It would render **100× too high**. |
| …but that is **latent** | `/sessions/current` filters `status: "in_progress"`; cost is only written with `status: "completed"`, so the value is always null → 0 |
| `/sessions/history` — the only path where the identity conversion returns a non-null cost — **has no client anywhere in the repo** | Repo-wide grep finds only the route definition and a `⏳` row in `apps/mobile/README.md` |

**The corrected statement.** The API is internally consistent: it stores aurar and
emits aurar. The only defect inside the API is a **comment that is wrong**. The
real risk is **client divergence** — the web portal compensates, the Flutter app
does not — and the real danger is that someone reads the wrong comment and
"fixes" `driver-invoices.ts:69` to divide, which **would** break the web portal by
100×. Fixing `minorToIsk` alone is, today, harmless.

That is a different and more actionable finding than the one I had been repeating.

### C-6 — `powerKw: 0` is at **four** sites, and its justifying comment is false

`driver-sessions.ts:135`, `driver.ts:590`, `driver.ts:680`, plus
`driver-sessions.test.ts:51` pinning it. The comment at
`driver-sessions.ts:104-107` says the app reads live power from a different
surface; the app reads `powerKw` **from this very payload** and renders it as
"0.0 kW". The product states a falsehood about physical equipment, and the
comment explaining why it is fine is itself wrong.

### C-7 — Two blocked-fact references were swapped

Appendix A defines F4 = Hyperdrive, F5 = secret names. Appendix I's CFI-09 cited
F5 for Hyperdrive and Appendix J's ISS-43/44 cited F4 for secret names. **Fixed.**

### C-8 — Estate measurement updated: **45.2 GB / 42.92 GB regenerable / 2.28 GB content**

Prior: 43.76 / 41.57 / 2.25. Measured independently in JavaScript, excluding
reparse points — an independent implementation landing within 3% of the
PowerShell figure is useful cross-validation of the corrected method.

### C-9 … C-13 — Smaller, all consequential

- **`gh` is not installed on this host.** Every GitHub API field is
  operator-run, not agent-run. Appendix M marks them accordingly.
- **Neon organisation `require_mfa` is `false`** (`org-young-math-18391044`,
  "Andri", plan `launch`). MFA is not required on the org owning the only
  database this product has.
- **`GET /accounts/{a}/workers/scripts/{name}` downloads the Worker's source
  bundle**, not metadata. It reads like a harmless metadata GET. Putting it in an
  evidence plan would pull the production JS bundle into the evidence pack. It is
  now boxed and flagged as the most dangerous field in Appendix L.
- **`/deployments` returns only `percentage` and `version_id` per entry.**
  Annotations and `author_email` come from `/versions`. A capture plan expecting
  provenance from `/deployments` returns blanks.
- **`core.hooksPath` is set** to `E:\Claude\Straumvakt\.git\hooks` **and no
  pre-push hook exists there.** My rule G7 originally treated a set hooksPath as
  protection. A configured hooks directory with no hook reads as protected and is
  not. G7 now checks for the hook.

---

## Phase 1 — Executable checks

**31 new rules, 55 new fixtures, 105/105 green across 5 checkers.**

```
node scripts/analysis/manifest/self-test-all.mjs
  ok  environment manifests   8 fixtures
  ok  release manifests      37 fixtures
  ok  preservation manifests 32 fixtures
  ok  wrangler configs       11 fixtures
  ok  branch safety          17 fixtures
  ALL GREEN — 105/105 fixtures across 5 checkers
```

### New checker: preservation manifests — 15 rules, 32 fixtures

`validate-preservation-manifest.mjs` reads the manifest **and nothing else** — it
does not stat the paths it describes, because a validator that touches the tree it
protects is one bug from being the thing that damages it.

| Rule | Enforces |
|---|---|
| **P1** | Deletable + archive recovery requires `archiveVerified` |
| **P2** | An archive "verified" by reading its own listing is not verified — only extract-and-compare |
| **P3** | The archive must not live inside the tree it protects |
| **P4** | Deletion requires a verified archive **and** a stated prerequisite |
| **P5** | `docs/OCPP` (128), `Straumvakt-parked` (38) and the prompt folder must each be present, with matching counts |
| **P6** | **A `.git` with zero commits is not a backup** and may not claim `git-remote` recovery |
| **P7** | "verified" without a timestamp is an assertion |
| **P8** | md5/sha1 rejected |
| **P9** | Personal data needs `dataProtectionApproved` |
| **P10** | A junction unlink must not be a recursive delete; a target losing files during unlink is an error |
| **P11** | Retirable requires 0 unique **and** 0 dirty **and** `branchPreserved` |
| **P12** | `reparsePointsExcluded` must be true; `regenerable > total` is rejected as the signature of a junction-following measurement |
| **P13** | Third-party material via git remote warns — redistribution is a decision |
| **P14** | Duplicate record ids |
| **P15** | An archive sharing a failure domain with the original warns |

### New checker: branch safety — 11 rules, 17 fixtures

`check-branch-safety.mjs` separates **collection** from **evaluation**: `collect()`
runs read-only git and emits a snapshot; `evaluate()` is a pure function over that
snapshot. That split exists so the rules can be tested — you cannot conveniently
manufacture "two branches sharing an upstream" in a real repository, but you can
write it down in ten lines.

Git is spawned through a **single** `spawnSync` choke point behind an allowlist of
12 read-only verbs, with three explicit refusal guards. Audited: **zero mutating
verbs on the allowlist.**

G1 deploy-pointer tracking · G2 upstream/branch name mismatch · G3 shared upstream
· G4 forbidden-commit ancestry (unresolved ≠ absent) · G5 fast-forward proof ·
G6 `push.default` · G7 pre-push hook actually exists · G8 dirty on a deploy pointer
· G9 remote baseline drift · **G10 worktree HEAD is a forbidden commit** ·
**G11 stale registration**.

### Wrangler linter: L4–L8 added, L1–L2 corrected

L4 bindings absent from a named environment (the *correct* non-inheritance rule) ·
L5 cross-script Durable Object · L6 inherited compatibility_date · L7 environment
name unrelated to the base · L8 queue producer with no consumer estate-wide.

---

## Phase 6 — The 90-minute human-assisted session

Every step names **who acts**, the **screen or command**, a **mutation category**,
the **expected output**, the **artifact**, and a **stop condition**.

### 0–10 min · Local prep — `RO`, no approval

| Min | Who | Command | Expect | Artifact | Stop if |
|---|---|---|---|---|---|
| 0–2 | operator | `node scripts/analysis/manifest/self-test-all.mjs` | `ALL GREEN — 105/105` | terminal | anything red — a checker regression would make every later judgement suspect |
| 2–4 | operator | `node scripts/analysis/git/check-branch-safety.mjs --repo E:/Claude/Straumvakt --out evidence/branch-safety-<date>.json` | G1×2, G3×2, G10×3 errors; G2×2, G6, G7, G11 warns | snapshot JSON | **remote count ≠ 16 or `origin/staging` ≠ `f53fb55e1229`** → G9: something was pushed. Establish what, and whether it deployed, before anything else. |
| 4–6 | operator | `node scripts/analysis/lint/lint-wrangler.mjs` | 0 errors, 5×L2, 6×L3 | terminal | any **L1 error** — a routing change has already disabled a pinned hostname |
| 6–8 | operator | `node scripts/analysis/cleanup/build-preservation-manifest.mjs --out <outside E:\Claude>` then validate it | `VALID`, 29 worktrees, 6 retirable | manifest JSON | any preservation target `missing` |
| 8–10 | operator | create the evidence directory **outside `E:\Claude`**; open Appendix L | — | directory | — |

### 10–40 min · Cloudflare read-only — `EXT` for the token, then `RO`

| Min | Who | Screen / command | Category | Artifact | Stop if |
|---|---|---|---|---|---|
| 10–13 | **Andri** | create the scoped read-only token (AP-1) | `EXT` **approval** | token, not persisted | any Edit permission on the form |
| 13–15 | operator | L-01, L-02 — verify, then prove it cannot write | `RO` | `token-verify.json` | write test returns anything but **403** |
| 15–18 | operator | L-03 … L-08 — identity and estate | `RO` | `accounts.json`, `workers-scripts.json` | an unrecognised Worker; a **production-named** Worker present |
| 18–24 | operator | **L-09 … L-12 — version ids** | `RO` | `versions-*.json` | fewer than 2 versions on any Worker about to take traffic |
| 24–28 | operator | L-13 … L-18 — bindings, secret **names**, DO namespaces | `RO` | `bindings.json`, `secret-names.json` | a secret **value** appears — close the page, do not transcribe |
| 28–33 | operator | **L-19 … L-22 — workers.dev toggles** (UI only) | `RO` | 4 screenshots | any pinned host **disabled** → drill RD-02 now |
| 33–36 | operator | L-23 … L-32 — routes, domains, DNS, certs, Hyperdrive, queues | `RO` | JSON + screenshots | Hyperdrive origin ≠ `ep-quiet-bird-abxartp8`; any **non-empty DLQ** |
| 36–39 | operator | **L-33 — Git integration owner** (UI only, blocked fact F2) | `RO` | screenshot | repository is **`andri187/CPMS`** → incident, halt the release |
| 39–40 | **Andri** | hash the bundle, secret-scan it, **delete the token**, re-verify → 401 | `EXT` | `bundle-manifest.txt` | scanner matches anything |

> **Never click:** Disconnect · Rollback · Delete · Purge · Reveal · Change
> subdomain · Save. **Never run** `GET /workers/scripts/{name}` — it downloads the
> source bundle.

### 40–60 min · Neon read-only — `RO`, metadata only

| Min | Who | Screen / command | Category | Artifact | Stop if |
|---|---|---|---|---|---|
| 40–44 | operator | M-01 … M-05 — project, org, **`require_mfa`** | `RO` | `neon-evidence-capture.json` | a project nobody recognises |
| 44–50 | operator | M-06 … M-12 — branches, **which is default**, protection | `RO` | same | the default is confirmed abandoned → record it; anything omitting a branch id reaches the wrong data |
| 50–55 | operator | M-13 … M-18 — computes, **max connections**, pooling, IP allow | `RO` | same | worst-case concurrency exceeds the ceiling |
| 55–58 | operator | M-19 … M-23 — role **names**, **retention**, production absence | `RO` | same + screenshot of retention | retention shorter than believed |
| 58–60 | operator | cross-check M-13 endpoint against Cloudflare **L-28** Hyperdrive origin | `RO` | one line in the ledger | **they disagree** → correct code, correct queries, wrong database. Do not deploy. |

**No SQL. No connection string. No `psql`. No live database connection.**

### 60–75 min · GitHub protection review — `RO`, then decisions only

| Min | Who | Screen / command | Category | Artifact | Stop if |
|---|---|---|---|---|---|
| 60–62 | operator | confirm `gh` is installed and authenticated — **it is not on this host** | — | note | not installed → use the dashboard for M-38 … M-46 |
| 62–68 | operator | M-38 … M-41 — default branch, protection, rulesets, visibility | `RO` | `github-evidence-capture.json` | a ruleset exists with a broad bypass list |
| 68–72 | operator | **M-42, M-43 — Actions secret names and deploy-capable workflows** | `RO` | same | a Cloudflare-shaped secret plus a push-triggered workflow → merging a PR deploys with nobody present |
| 72–75 | operator | M-44 … M-46 | `RO` | same | remote count or staging sha differs from baseline |

**Nothing is changed in this window.** Protection is enabled later, under AP-3,
after the current state is captured — once it is on, nobody can show what it was.

### 75–90 min · Record decisions and blockers — `LOCAL`

| Min | Who | Action | Artifact | Stop if |
|---|---|---|---|---|
| 75–80 | operator | fill every `matchesExpected` in the three capture JSONs; write the **not-inspected list** | capture JSONs | any field left `null` without a reason |
| 80–84 | operator | draft `release-beta-current.json` from the captured version ids; `validate-release-manifest.mjs --strict --json` | manifest + validator output | it validates on the first try — that would mean nothing was actually blocked, so re-read it |
| 84–88 | **Andri** | answer AP-1 … AP-8 below | ledger entries | — |
| 88–90 | operator | append to the release evidence ledger; hash everything; **do not touch the visual status HTML** | ledger | — |

---

## Phase 7 — Rollback tabletop drills

Ten drills. Read them in order: **detection, containment, then diagnosis** — the
usual way a rollback goes wrong is that someone debugs forward while the product
is down. **Capture evidence before rolling back**; rolling back destroys the
evidence of what went wrong.

### TT-01 · Wrong Worker version live
**Detect** error rate rises at the deploy timestamp; health endpoint fails.
**Contain** roll back to the captured version id — do not diagnose first.
**Evidence** active version id, previous version id, failing response body, deploy time.
**Rollback** `wrangler rollback --version-id <prev>`, or the Deployments tab. **Requires L-09…L-12 to have been captured** — no version id has ever been recorded, so until then this is a redeploy of an older commit, which is slower and riskier, and that difference must be said out loud.
**Verify** health + one authenticated read + error rate at baseline. Record elapsed seconds → `restoreTimeMeasuredSec`.
**After** why did the deploy pass its checks? Add the missed condition to CL-44.

### TT-02 · workers.dev disabled
**Detect** **error 1042** on the pinned host while a custom domain on the same Worker answers. Distinguish from a DNS failure (different fix) and from an application 404 (**not a failure**).
**Contain** re-enable the toggle: Worker → Settings → Domains & Routes. Faster than a rollback and usually sufficient.
**Evidence** the 1042 response verbatim; the diff that caused it — look for a newly added `routes` array, **or an environment that now inherits one from the top level**.
**Rollback** re-enable; if that does not restore it, roll back the version.
**Verify** the pinned host returns an application response of any status.
**After** declare `workers_dev` explicitly and confirm `lint-wrangler.mjs` L1 catches that diff — the corrected model now catches the inherited-routes case too.

### TT-03 · Mobile pinned API host broken
**Detect** app fails to load data while the web app works — possibly no signal at all, which is why a synthetic check on the pinned host exists.
**Contain** **restore the hostname server-side.** There is no client-side fix: `apps/mobile/lib/api/client.dart:25` pins it as a compile-time constant with **no remote-config override and no localhost fallback**, so every installed app is affected and a store release takes days.
**Evidence** the exact host requested, the response, the affected app version.
**Rollback** whatever restores the host — re-enable workers.dev, reverse a rename (the hostname derives from the Worker name), or roll back the version.
**After** this is the failure AD-08 exists to prevent permanently. Waiting for a store release is not a mitigation; it is a description of how long the outage lasts.

### TT-04 · OCPP gateway unreachable
**Detect** connected-charger count drops, or a WebSocket upgrade fails. **If no charger count is exposed, record that this drill cannot currently be detected** rather than assuming it can.
**Contain** roll back the gateway version immediately. Every minute is chargers offline, some mid-session.
**Evidence** upgrade status and headers, active gateway version, charger count, and **whether the `IDENTITY_DO` namespace id changed**.
**Rollback** to the recorded gateway version. Expect a **reconnect storm** — check Neon connection headroom (M-16) before assuming it absorbs cleanly.
**Verify** charger count at **+1, +5, +15 min**. Reconnection is not instant.
**After** was a session in progress? Establish the reconciliation behaviour from the specification, not from the incident.

### TT-05 · Web-to-API fetch broken
**Detect** pages hang or 500 while the API answers when called directly. Looks like an application bug; is a routing problem.
**Contain** **flip the configuration switch** back to the working path — no deploy. That is the entire reason AD-09 recommends a switch rather than a straight cutover.
**Evidence** the failing request; whether `api.straumvakt.org` is a **Custom Domain** or a **route** (L-24). If a same-zone route is in play, the request looped back to the calling Worker.
**Verify** a page loads and an authenticated read succeeds.
**After** if a route replaced a Custom Domain, service-binding adoption becomes urgent rather than optional.

### TT-06 · Bad migration
**Detect** errors naming missing columns — or, worse, data that reads wrongly rather than failing.
**Contain** stop writes if that is possible without a worse outage. Every write after the bad migration is a write the restore discards.
**Evidence** the migration that ran, `_prisma_migrations` state, and **the exact time the change took effect** — the restore point depends on it.
**Rollback** restore from the backup branch, or PITR within the window. **A restore alone is not the recovery**: the restored branch has a **different endpoint** and the Workers still point at the old one. Repoint the secret, the Hyperdrive origin (L-28), and local tooling.
**Verify** schema version; row counts on key tables; one read through the API. A branch that connects is not a branch the application can use.
**After** why did the reference search not catch it? **A row count of zero is never sufficient evidence for dropping anything** — 32 tables were dropped on that reasoning and relation loads hid the references.

### TT-07 · Recovery needed beyond PITR
**Detect** the problem traces to a change older than the retention window (M-21, believed 7 days).
**Contain** stop anything that compounds it, then be honest about what exists.
**Evidence** when the problem originated; the retention ceiling; every deliberate backup branch and its date — **there are none today (M-23)**.
**Rollback** beyond the window, only branches created on purpose exist. If none covers the point, **there is no restore**: recovery becomes forward repair, and some information is gone.
**Approves** Andri. This is a business decision about acceptable data loss.
**After** this drill is the argument for AD-05's retention decision. *A problem noticed on day eight is currently unrecoverable*, and that sentence should be uncomfortable enough to produce a decision.

### TT-08 · Bad branch push
**Detect** an unexpected commit on `origin/staging`; or **G9** fires on the ref count or sha.
**Contain** **first question: did the push trigger a deploy?** Not "how do I undo it". Until blocked fact **F2** (L-33) is resolved, `origin/staging` must be treated as a live production deploy pointer.
**Evidence** pushed sha, previous sha, pusher, timestamp, and **whether any Worker's active version changed in the same window**.
**Rollback** if a deploy fired: roll back the Worker first (TT-01), then the branch. If not, correct the branch calmly. **A force-push fix is itself dangerous and must not be normalised** — with protection enabled it will be refused, which is correct.
**After** three worktrees currently sit **on** forbidden commits (C-2) and two branches track the deploy pointer. AP-4 removes the tracking; a pre-push hook removes the class.

### TT-09 · CPMS redeploy collision
**Detect** a Worker's active version changes with **no corresponding Straumvakt deploy**; the version id is unfamiliar; the audit log (L-36) shows an unrecognised actor.
**Contain** roll back to the last known-good Straumvakt version — noting this is a *contested* Worker, which is the problem.
**Evidence** the unexpected version id, the audit entry, the Git integration for that Worker (L-33), and whether the deployed code is Straumvakt's or CPMS's.
**Rollback** version rollback; disconnecting the offending integration is `EXT` + approval and touches another project's deploy path, so it is a conversation, not a reflex.
**After** **distinguish an unexpected deploy from a bad deploy** — a CPMS deploy of working code is still an incident, because nobody controls what runs.

### TT-10 · Prompt / evidence folder loss
**Detect** a preservation check reports missing; a prompt cannot be found; `git status` in the prompt folder looks unfamiliar.
**Contain** **stop all cleanup immediately.** The next step may destroy the evidence of what the last one took.
**Evidence** what is missing; which step preceded it; the deletion-log entry mapping the path to an archive member.
**Rollback** **today there is none.** The folder has zero commits, no remote, no reflog (Appendix N). Recovery depends on an archive that does not yet exist. If the loss is inside `E:\Claude`, extract from the verified archive and hash-compare.
**Approves** pre-approved for restoration from an archive.
**After** this drill has no working recovery path until AP-5 is approved and executed. **That is the finding, not a gap in the drill.**

---

## Phase 8 — Approval packets

Eight yes/no decisions. Each states the risk of **yes**, the risk of **no**, and
whether it can be undone.

### AP-1 · Create a scoped read-only Cloudflare token
**Recommend YES.** Ten Read permissions, account-scoped, 7-day TTL, revoked at session end.
**Risk of yes** a credential exists for a week; mitigated by read-only scope, proven by the L-02 write-refusal test.
**Risk of no** all seven blocked facts stay blocked; **no Worker version id is ever recorded**, so rule R1 correctly rejects every release and no production deploy can be undone.
**Reversible** yes, instantly — delete the token.
**Evidence required** none to decide.

### AP-2 · Run a read-only Neon metadata session
**Recommend YES.** Metadata only: no SQL, no connection string, no live connection.
**Risk of yes** essentially none; the read tools do not return passwords.
**Risk of no** the default-branch trap stays unconfirmed, the PITR window stays unverified, and `require_mfa: false` stays unaddressed on the org owning the only database.
**Reversible** n/a — nothing changes.
**Evidence required** none.

### AP-3 · Enable GitHub branch protection on the deploy pointer and trunk
**Recommend YES — but capture the current state first.** Require a PR, block force pushes, restrict deletions, require linear history.
**Risk of yes** Claude A and Codex must open pull requests. That is a real change to how they work and should be **told to them, not discovered**.
**Risk of no** zero of sixteen branches protected, rulesets empty, and the branch that may trigger production deploys can be force-pushed or deleted by anyone with write access.
**Reversible** yes — disable the ruleset.
**Evidence required** M-39, M-40 captured and hashed **before** enabling; once protection is on, nobody can show what it was.

### AP-4 · Unset the mis-tracked local upstreams
**Recommend YES.** `dev/rename-prod-worker` and `dev/secret-hygiene-v2` (→ `origin/staging`); `docs/ci-and-custom-domain` and `fix/prisma-migrations-path` (→ `origin/dev/drizzle-ownership-and-market-harvest`, which they also share with each other).
**Risk of yes** effectively none. **Nothing on the remote changes**; the branches and their commits are untouched; `git branch -u <upstream> <branch>` restores it exactly.
**Risk of no** the first two are one reflexive `git push` from publishing to the deploy pointer — and `dev/rename-prod-worker` is **checked out at `4fe0a95`**, the forbidden commit. The second two would land on a branch whose name bears no relation to theirs, so the mistake is invisible in the command *and* in the branch name.
**Reversible** yes.
**Evidence required** the branch-safety snapshot, already collected.

### AP-5 · Give the prompt / evidence folder real version control
**Recommend YES.** `.gitignore` for tool caches, third-party decompilation and the DaVinci material; then commit the 33 markdown documents plus the coordinator ledger; then copy the class-A documents into `E:\Claude\Straumvakt\docs\prompts\`.
**Risk of yes** committing something sensitive — mitigated by the N-18 filename scan and a content scan of the staged set, either of which stops the commit.
**Risk of no** **the largest unmitigated preservation risk in the project stays unmitigated.** 22,888 files, zero commits, no remote, no reflog, and it holds the instructions driving all three agents. TT-10 currently has no recovery path at all.
**Reversible** yes — nothing is deleted; a commit can be discarded.
**Evidence required** the filename scan returning clean.

### AP-6 · Stage a beta custom domain **behind** the workers.dev fix
**Recommend YES, in that order.** Declare `workers_dev` explicitly in the API and gateway configs **first**; then attach the domain; then verify **both** hosts answer.
**Risk of yes** if the order is reversed, every installed mobile app loses API access with no client-side fix (TT-03).
**Risk of no** the product's availability keeps depending on an inferred toggle that two of three configs do not declare and whose state is only observable in a dashboard.
**Reversible** yes — remove the domain; **then re-verify the workers.dev host still answers**, because removal does not automatically restore what attachment may have disabled.
**Evidence required** L-19, L-20 captured; `lint-wrangler.mjs` reporting no L1 error.

### AP-7 · Create a production Neon project
**Recommend YES — separate project, empty, protected from creation.**
**Risk of yes** a second project's cost and a second set of secrets.
**Risk of no** production has nowhere to put data; a branch inside the beta project shares its compute, limits and blast radius, and rule R6 rejects a production manifest pointing at the beta branch anyway.
**Reversible** yes while empty; **not** once it holds customer data.
**Evidence required** M-08, M-09, M-22. Settle retention here too — **beta rows do not move**; beta holds real users' personal data gathered in a testing context.

### AP-8 · Choose the cleanup archive destination
**Recommend YES — two destinations, and say which protects against what.**
**Risk of yes** none, beyond storage.
**Risk of no** **2.28 GB of irreplaceable content** has no recovery path. An archive on the same disk protects against a wrong `Remove-Item`; it does not protect against losing the disk. Both risks are real here and only one is currently mitigated at all.
**Reversible** yes — move it.
**Evidence required** the preservation manifest (already generated and validating), and an archive verified by **extracting and comparing**, not by reading its listing.

---

## Counts

| Gate | Required | Produced |
|---|---|---|
| 1 · additional fixture cases | 25 | **55** (50 → 105) |
| 2 · new executable rules | 12 | **31** (P1–P15, L4–L8, G1–G11) |
| 3 · Cloudflare capture fields | 30 | **36** |
| 4 · Neon capture fields | 20 | **24** |
| 5 · GitHub / branch-safety fields | 20 | **22** |
| 6 · prompt-folder preservation records | 15 | **18** |
| 7 · rehearsal scripts / checklists | 12 | **60** (Appendix E) + 5 session blocks |
| 8 · rollback drill tabletops | 10 | **10** |
| 9 · approval packets | 8 | **8** |
| 10 · machine-readable manifests | 5 | **5** |
| 11 · 90-minute operator sequence | 1 | yes |
