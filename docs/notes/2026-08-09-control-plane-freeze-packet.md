# Control-plane evidence, worktree freeze, and cleanup safety

**Run.** `next-claude-b-control-plane-cleanup-freeze-2026-08-09.md`
**Worktree.** `E:\Claude\Straumvakt-beta-production` · `docs/beta-production-release-architecture`
**Start tip.** `606ceae` — verified, 0 dirty, 0 commits since.

## Navigation

| | |
|---|---|
| [P — Approval packets AP-1 … AP-8](2026-08-09-appendix-p-approval-packets.md) | exact commands, seven fields each |
| [Q — Cleanup safety plan](2026-08-09-appendix-q-cleanup-safety-plan.md) | zero-delete rehearsal, retire list, archive layout |
| [L — Cloudflare evidence session](2026-08-09-appendix-l-cloudflare-evidence-session.md) | 36 fields *(two corrections below)* |
| [M — Neon and GitHub evidence](2026-08-09-appendix-m-neon-and-github-evidence.md) | 24 + 22 fields |
| [N — Prompt-folder preservation](2026-08-09-appendix-n-prompt-folder-preservation.md) | 18 records |
| Prior | [D](2026-08-09-appendix-d-dashboard-evidence-templates.md) · [E](2026-08-09-appendix-e-release-checklists.md) · [F](2026-08-09-appendix-f-offline-validator-spec.md) · [G](2026-08-09-appendix-g-cleanup-preservation-manifest.md) · [H](2026-08-09-appendix-h-approval-decision-records.md) · [I](2026-08-09-appendix-i-execution-work-items.md) · [J](2026-08-09-appendix-j-issue-bodies.md) · [K](2026-08-09-appendix-k-drills-rehearsals-nogo.md) |

---

## Phase 0

```
branch: docs/beta-production-release-architecture
tip:    606ceae071b0eb24c31f24b1125aaf913cfbe04b   (matches the stated start tip)
dirty:  0        commits after 606ceae: 0

ALL GREEN — 105/105 fixtures across 5 checkers
docs/OCPP: 128    Straumvakt-parked: 38    prompt-folder commits: 0
```

Nothing under `E:\Claude` was deleted, moved or modified at any point.

---

## WP1 — Worktree freeze

A new schema, a read-only collector, and an independent validator. The collector
records what is true; the validator decides whether that is acceptable. A
generator that judged its own output would always approve of it.

**The live manifest** (`evidence/freeze-manifest-2026-08-09.json`):

| | |
|---|---|
| Registered worktrees | **29** (28 on disk, 1 stale) |
| Local branches | **43** |
| Remote branches | **16** |
| **Local branches with no remote** | **29** — measured, not derived |
| Unregistered top-level entries | 3 — `CPMS`, `Straumvakt-parked`, `zaptec-test` |
| Suggested: keep / retire / review / prune | 17 / 6 / 5 / 1 |

**It fails validation, and that is the honest baseline** — six findings:
FZ1 ×3 (forbidden commits at HEAD), FZ2 ×2 (deploy-pointer tracking),
FZ4 ×1 (`zaptec-test` in no preservation record), plus FZ2/FZ3 warnings.

### Twelve rules

**FZ1** forbidden commit at HEAD, and a HEAD that matches one while the flag says
null · **FZ2** upstream naming a different branch, escalated when it is a deploy
pointer · **FZ3** stale registration mislabelled · **FZ4** project content under
the root that no preservation record covers · **FZ5** retire with unique commits,
dirty files, or no `branchPreserved` · **FZ6** retire of a branch that exists on
no remote, with no rationale · **FZ7** upstream absent from the remote ·
**FZ8** one branch in two worktrees · **FZ9** retire despite untracked documents ·
**FZ10** archive with no destination · **FZ11** totals disagreeing with the rows ·
**FZ12** credential-shaped files, and a value pasted into the field that takes paths.

**23 fixtures, all passing, every rule failing for its own reason.**
Suite total: **128/128 across 6 checkers.**

### The archive gate

`verify-archive.mjs` is the check that must pass before deletion is ever
*proposed*. It verifies by extracting and hashing, never by reading the archive's
own listing — a listing proves that a listing exists. It fails if a
credential-shaped file appears in the archive, because an archive is then a second
copy of a live secret. **5/5 self-tests.**

---

## Corrections

Fourteen agents gathered ground truth and seven more tried to refute them. Each
correction below was re-verified by me directly; several refutations were
themselves partly wrong.

### C-1 · `zaptec-test` is not a spike, and holds code that exists nowhere else

62 content files (189 minus 127 `.next` outputs) forming a coherent Next.js
technician-view diagnostic app — 11 tech-cards, 5 OCPP cards, a live dashboard.
**It is not a git repository**, so its own `.gitignore` is inert and every file in
it exists in exactly one place.

The load-bearing part: `sendChargerCommand()` and the
`POST /api/chargers/{id}/sendCommand/{commandId}` implementation are **only**
here. The canonical repo documents the route and carries a *richer* command table
(10 commands versus 5), but `apps/api/src/lib/zaptec.ts` has no cloud-API
command-send code at all. That is working code that sends commands to physical
chargers, in no manifest and no repository.

Two things this is **not**: `openapi.json` and `zaptec-constants.json` are tracked
in git (commit `2256f1d`) and byte-identical after line-ending normalisation, and
`_easee-const.py` is preserved in `docs/reference/integrations/easee.md`. A prior
note claiming the Zaptec specs live only in `zaptec-test` is stale.

### C-2 · An Android upload keystore my own detector missed

`CPMS\mobile-app-driver\android\app\straumvakt-upload.jks` (2,814 bytes) and its
`key.properties`. My credential pattern covered `.keystore` but not `.jks` or
`key.properties`.

**An upload keystore is the one credential on this estate that cannot be
rotated.** Lose it and that Play Store listing can never be updated again. It is
in no preservation record and no git repository.

### C-3 · The credential detector was drowning its own signal

The first version scanned `node_modules` and returned ~160 lines of vendor noise —
every `token.js`, every `secrets.d.ts` — around four real findings. A detector
whose output nobody reads detects nothing. It now skips regenerable trees, which
is also how the `.jks` came into view. **Nine real findings**, listed by path in
Appendix Q5. **None was opened.**

### C-4 · `npm ci` cannot run in this repository

Preservation records P-14 and P-20 both specify `npm ci` into a temporary copy as
the proof that build output is regenerable. `package-lock.json` is **untracked,
absent from disk, and ignored at `.gitignore:51`** — a deliberate choice recorded
in the project's own session log. `npm ci` exits rather than installing.

The proof method is impossible as written. Replacement in Appendix Q6: use
`npm install`, record resolved versions, and stop calling regeneration
reproducible — it can be made to work again, not restored identically.

### C-5 · The Cloudflare Git-integration fact is **not** dashboard-only

Appendix L records blocked fact F2 as having no CLI or API equivalent. A
documented Workers Builds REST API exists:

```
GET /accounts/{account_id}/builds/workers/{external_script_id}/triggers
```

It returns exactly what F2 needs — `provider_type`, `repo_name`, `repo_id`,
`build_command`, `deploy_command`, branch inclusion. **Appendix L L-33 is
corrected: it is scriptable.**

With a safety addendum that matters more than the correction. Only these are
GETs: `/builds/workers/{tag}/triggers`, `/builds/workers/{tag}/builds`,
`/builds/builds/{uuid}`, `/builds/builds/latest`, `/builds/builds?version_ids=`,
`/builds/builds/{uuid}/logs`, `/builds/tokens`,
`/builds/workers/{script}/deploy_hooks`,
`/builds/triggers/{uuid}/environment_variables`, `/builds/account/limits`. **The
same resource has mutating siblings**, and a read-only checklist must name the
GETs explicitly rather than the resource.

### C-6 · The Worker secrets endpoint **can** return key material

Appendix L L-15 states the response "exposes only `{name, type}`; there is no
value field". That is true of the `secret_text` variant shown in the docs'
*example*. The documented *schema* also has a **`secret_key`** variant whose
fields include **`key_base64`** and **`key_jwk`**.

**If any Worker has a `secret_key` binding, dumping that endpoint captures key
material into the evidence pack.** L-15 is corrected: capture `name` and `type`
only, and **never store the raw response**.

### C-7 · G1's severity was overstated for the name-mismatch case

Git here is **2.53.0** with `push.default` **unset**, which defaults to `simple`.
Under `simple`, a bare `git push` from a branch whose upstream has a *different
name* is **refused**. So `dev/rename-prod-worker` → `origin/staging` is not
one bare push from publishing.

The risk is real but narrower than stated: it needs `git push origin HEAD:staging`,
`git push -u`, or `push.default` changed to `upstream`. AP-4 remains worth doing —
four commands, four failure modes removed — but the honest framing is *"a
plausible command"*, not *"a bare push"*.

### C-8 · The junction count is not reliably measured

Three methods have now produced **5**, **7** and **0** cross-worktree junctions.
The disagreement is in the measurement, not the estate. Until one method is agreed
and re-run, the count is **NOT RELIABLY MEASURED**, and P-12's "five" should not
be cited. The *rule* is unaffected: unlink with `cmd /c rmdir` and confirm the
target's file count afterwards.

### C-9 · Neon `pooler_enabled` does not gate pooling

The pooled endpoint is always available; pooling is selected by using the
`-pooler` hostname. On this project the pooled host **is in production use** —
the staging Worker's `DATABASE_URL` points at `ep-quiet-bird-abxartp8-pooler`.
Reading `pooler_enabled: false` as "pooling is off" would be wrong.

### C-10 · Two smaller ones

The wrangler non-inheritable list is **14 entries**; mine had 12, missing
`secrets` and `secrets_store_secrets` — now added. And `CPMS\New folder` is
**completely empty**, so it is not a preservation concern at all.

### A disclosure

One refutation agent **breached the read-only constraint**: it wrote
`/tmp/ids.txt` (238 identifier names, no secrets) while counting Easee coverage,
and disclosed it itself. Nothing under `E:\Claude`, no repository, no git state
and no cloud resource was touched. I am reporting it because a constraint that is
only enforced when it is convenient is not a constraint.

---

## WP2 — Control-plane read-only session (30–45 minutes)

Full field tables in Appendices L and M. This is the running order, with the stop
condition for each block.

| Min | Block | Category | Stop if |
|---|---|---|---|
| **0–3** | Local prep: run all six checkers; regenerate the freeze manifest | `RO` | any checker red, or the remote baseline (16 / `f53fb55e1229`) has moved — that means something was pushed, and *whether it deployed* is the first question |
| **3–6** | Create the scoped read-only token (**AP-1**); verify; prove it cannot write | `EXT` **approval** | the write test returns anything but **403**; a 400 is not proof of read-only |
| **6–10** | Identity and estate: L-03 … L-08 | `RO` | an unrecognised Worker, or a **production-named** Worker present |
| **10–17** | **Version ids: L-09 … L-12** — closes F3, the reason rule R1 rejects every release | `RO` | fewer than 2 versions on any Worker about to take traffic |
| **17–23** | Bindings, secret **names**, DO namespaces: L-13 … L-18 | `RO` | a secret **value** on screen — close the page, do not transcribe. Never store the raw `/secrets` response (**C-6**) |
| **23–28** | **workers.dev toggles: L-19 … L-22** — dashboard-only | `RO` | any pinned host disabled → drill TT-02 now |
| **28–33** | Routes, domains, DNS, certificates, Hyperdrive, queues | `RO` | Hyperdrive origin ≠ `ep-quiet-bird-abxartp8…`; any non-empty DLQ |
| **33–36** | **Git integration: L-33** — now scriptable via the Builds API (**C-5**), GETs only | `RO` | repository is `andri187/CPMS` → incident, halt the release |
| **36–41** | Neon metadata (**AP-2**): org, `require_mfa`, branches, default, retention, computes | `RO` | the Neon compute and the Hyperdrive origin disagree — correct code, correct queries, wrong database |
| **41–45** | Hash the bundle, secret-scan it, **delete the token**, re-verify → 401 | `EXT` | the scanner matches anything |

**Never** run `GET /accounts/{a}/workers/scripts/{name}` — it downloads the
Worker's source bundle, not metadata. **Never** click Disconnect, Rollback,
Delete, Purge, Reveal, or Change subdomain.

---

## WP5 — Handoff notes

### For Codex

**The hostname pin has no fallback of any kind.** `apps/mobile/lib/api/client.dart`
sets `defaultBaseUrl` as a compile-time constant, and the source comment states
the localhost fallback was deliberately retired. There is no env var, no remote
config, no user setting, no debug menu. Every construction site passes zero
arguments. If that host stops answering, **the fix is server-side or there is no
fix** — a store release is not a mitigation, it is a description of how long the
outage lasts.

**`powerKw: 0` must never render as a measurement.** Four sites hardcode it, and
the comment justifying one of them is factually wrong: it claims the app reads
live power from another surface; the app reads it from that very payload. Either
populate the field or remove it from the contract — never ship a plausible zero.

**Cost on mobile risks 100× high if surfaced.** The wire contract is aurar. The
web portal divides by 100; the Flutter app does not. It is latent only because
the endpoint the app reads never carries a non-null cost today. **The moment a
cost appears on a mobile surface, it is wrong by two orders of magnitude** unless
the client divides first.

*Verified during this run:* two of the three `powerKw: 0` sites are unreachable
from the shipped app — the Stop button is permanently disabled, and
`StartSessionResult` never reads a `session` field. The defect is real; some of
the stated symptoms are not yet reachable. Fix the contract, not the symptom.

**`/visual` and the new post-login routes remain demo-only** and must stay clearly
marked as such.

### For Claude A

**Do not "fix" the API aurar conversion.** The API is internally consistent: it
stores aurar, emits aurar, and `driver-invoices.ts:20` documents the wire field
correctly. The only defect *inside* the API is the comment at
`driver-sessions.ts:93-94` claiming ISK has no minor unit. **Changing
`driver-invoices.ts:69` to divide would break the web portal by 100×**, because
the portal already divides. Fix the comment; leave the arithmetic.

**Password routes need an explicit decision** before beta widens — see the
route list in the workflow evidence. They are currently neither documented as
intentional nor flagged as gaps.

**Support-context and org-scope convergence must account for provenance.** CPMS is
where the `hlada` names and much of the OCPP design originate; its repo is a
separate remote with 161 dirty entries. Any convergence that assumes a single
lineage will be wrong about where a behaviour came from.

**A caution from this programme's own history:** a row count of zero is never
sufficient evidence for dropping a table. Thirty-two were dropped on that
reasoning and relation loads hid the references.

---

## Counts

| Output | Result |
|---|---|
| Checkers | **6** |
| Fixtures | **128 / 128** |
| New rules this run | **12** (FZ1 … FZ12) |
| New machine-readable manifests | **1 live** (freeze) + the archive gate |
| Approval packets | **8**, each with exact commands |
| Corrections | **10**, plus one disclosure |
| Deletions performed | **0** |
