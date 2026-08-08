# Infrastructure and release-safety packet — go/no-go for the staging catch-up and Worker migration

**Status: read-only investigation. Nothing was changed.** No Cloudflare, Neon,
GitHub, DNS, secret, branch, or deployment state was modified. Every command
run was a read. Nothing here has been executed as a change.

Produced 2026-08-08 from `docs/infra-release-safety-packet`, a worktree off
`dev/drizzle-ownership-and-market-harvest` @ `2b7ebf6`.

## Headline: the current recommendation is NO-GO, on one blocking unknown

The blocker is not a defect. It is that **the single most consequential fact
cannot be verified from this session**: whether Cloudflare's Git integration is
connected to the `staging` branch. Everything else needed for a go decision is
now established, and one finding raises the stakes sharply:

> **`straumvakt.org` and `www.straumvakt.org` are served by the *staging*
> Worker, `hlada-staging`.** The brand domain is not on a production Worker. It
> is on the same Worker the `staging` branch deploys to.

So if the Git integration is connected, `git push origin …:staging` is not a
staging deploy. **It is a production release to the live brand domain**, and it
carries 140 commits at once. That is the operation the catch-up runbook
describes as a git fast-forward.

---

## 1. Evidence table

Every row is a direct observation. "Blocked" rows are stated as blocked rather
than inferred.

| # | Conclusion | Evidence | Source / tool | Timestamp (UTC) |
|---|---|---|---|---|
| E1 | `straumvakt.org`, `www.straumvakt.org`, `hlada-staging.straumvakt.workers.dev` return **byte-identical** bodies (SHA-256 `4bf6719964446f68…`, 7438 bytes, `<title>Straumvakt</title>`) | HTTPS GET `/` ×3 | `curl` + `sha256sum` | 2026-08-08T23:04:56Z |
| E2 | ⇒ The brand domains are served by the **staging** Worker `hlada-staging` | E1 + `wrangler.jsonc` `env.staging.routes` declares both as `custom_domain: true` | derived + repo config | 2026-08-08T23:04:56Z |
| E3 | `hlada.straumvakt.workers.dev` → Cloudflare **error 1042** (no live Worker on that workers.dev host) | HTTPS GET | `curl` | 2026-08-08T23:04:56Z |
| E4 | Root config sets no `workers_dev: false`, so the default (`true`) applies ⇒ E3 is strong evidence **`hlada` is not deployed at all** | `wrangler.jsonc:3-32` | repo read | 2026-08-08T23:05Z |
| E5 | `straumvakt-console.straumvakt.workers.dev` → **error 1042** ⇒ the target Worker of `4fe0a95` **does not exist yet** | HTTPS GET | `curl` | 2026-08-08T23:04:56Z |
| E6 | `api.straumvakt.org` and `hlada-api-staging.straumvakt.workers.dev` both return `{"error":"unauthorized"}` on `/api/admin/me`; `hlada-api.straumvakt.workers.dev` returns error 1042 | HTTPS GET ×3 | `curl` | 2026-08-08T23:04:34Z |
| E7 | ⇒ `api.straumvakt.org` is served by **`hlada-api-staging`**; the production API Worker `hlada-api` is **not deployed** | derived from E6 | derived | 2026-08-08T23:04:34Z |
| E8 | `4fe0a95` changes **one line**: root `name` `hlada` → `straumvakt-console`. `env.staging.name` (`hlada-staging`) is **untouched** | `git show 4fe0a95` — 1 file, 1 insertion, 1 deletion | `git` | 2026-08-08T23:06Z |
| E9 | Neon branch `production` (`br-fragrant-bonus-abrc01g6`) is `primary: true`, `default: true`, `protected: false`, logical size **37 MB** | project description | Neon MCP `describe_project` | 2026-08-08T23:05Z |
| E10 | Neon branch `staging` (`br-tiny-river-abgpqq37`) is `default: false`, `protected: false`, logical size **595 MB**, 336,340 CPU-sec | same | Neon MCP `describe_project` | 2026-08-08T23:05Z |
| E11 | Staging compute `ep-quiet-bird-abxartp8` is **`active`**, `last_active` 23:02:43Z, `suspend_timeout_seconds: 0`, running since 2026-08-01 | compute list | Neon MCP `list_branch_computes` | 2026-08-08T23:06Z |
| E12 | Production compute `ep-cold-waterfall-abxxo8w1` is `idle`, total **504 CPU-sec** since 2026-04-22 — but `last_active` **2026-08-08T20:38:44Z**, i.e. it *was reached today* | same | Neon MCP `list_branch_computes` | 2026-08-08T23:06Z |
| E13 | `origin/staging` @ `f53fb55` (2026-06-14); frontier @ `2b7ebf6` (2026-08-08); `rev-list --left-right --count` = **`0  140`** — strict ancestor | git | `git` | 2026-08-08T23:07:19Z |
| E14 | **`origin/staging` does not contain the `routes` / `workers_dev` block.** The custom-domain binding is present in Cloudflare but absent from the deployed config | `git diff origin/staging frontier -- wrangler.jsonc` | `git` | 2026-08-08T23:07:19Z |
| E15 | Migrations on disk: `origin/staging` **31**, frontier **47** (+16) | `git ls-tree` | `git` | 2026-08-08T23:07:19Z |
| E16 | The console Worker's `src/` contains **no DB client, no `DATABASE_URL`/`DIRECT_URL` reference, no `HYPERDRIVE_DB` use, and no `src/app/api`** | recursive grep | `grep` | 2026-08-08T23:06Z |
| E17 | Wrangler CLI is **not authenticated** (`wrangler whoami` → "You are not authenticated") | `npx wrangler whoami`, exit 0 | wrangler 4.84.1 | 2026-08-08T23:03Z |
| E18 | Cloudflare MCP servers (`cloudflare-api`, `-builds`, `-bindings`, `-observability`) require OAuth; this session is non-interactive | session capability notice | harness | 2026-08-08T23:00Z |
| E19 | No `gh` CLI installed anywhere on `C:\` or `E:\` (depth-5 scan) | filesystem scan | PowerShell | 2026-08-08T23:02Z |

### What is blocked, and why it cannot be inferred

**E17 + E18 + E19 together mean the Cloudflare control plane is unreachable
from this session.** No `wrangler` auth, no MCP OAuth, no `gh`. Therefore:

- **Q1 (does pushing `staging` trigger a build?) is UNANSWERABLE here.** GitHub
  shows no deployments and no Cloudflare check-runs on staging's tip, but that
  is exactly the evidence the brief correctly rules insufficient — Workers
  Builds does not always surface either. The repo *asserts* the integration
  exists (`wrangler.jsonc:33` — "deployed by Cloudflare's git integration from
  the `staging` branch"), and the 2026-04-24 deploy-pause note records it being
  disconnected from a different repo. **Those two claims cannot both be
  resolved without the dashboard.**
- The Hyperdrive config's actual target branch is likewise unverifiable
  (see §5).

---

## 2. Which Worker serves the brand domains (Q2)

**Answer: `hlada-staging`.** Established by byte-identity (E1/E2), corroborated
by the config's own `env.staging.routes` block.

| | value |
|---|---|
| Worker | `hlada-staging` (the `staging` environment of the `hlada` config) |
| Custom domains | `straumvakt.org`, `www.straumvakt.org` — declared `custom_domain: true` |
| workers.dev | `hlada-staging.straumvakt.workers.dev` — live, `workers_dev: true` |
| API counterpart | `api.straumvakt.org` → `hlada-api-staging` (E6/E7) |
| Production console Worker `hlada` | **not deployed** (E3/E4) |
| Production API Worker `hlada-api` | **not deployed** (E6) |
| Deployed version / date | **BLOCKED** — needs dashboard; the served HTML carries no build marker |
| Source integration | **BLOCKED** — see Q1 |

**E14 is the sharp edge here.** The deployed branch `origin/staging` has no
`routes` block; the custom domains exist in Cloudflare anyway. So the binding
was created out-of-band — dashboard, or a `wrangler deploy --env staging` from
a branch that had the block. Consequence: **nobody should assume a deploy from
`origin/staging` preserves the custom-domain attachment.** Whether Wrangler
detaches custom domains absent from config is version-dependent and must be
confirmed, not guessed. Treated as a stop condition in §6.

---

## 3. What deploying `4fe0a95` would actually do (Q3)

**Treat it as a migration. It is not a rename, and Wrangler cannot make it one.**

A Worker's script name *is* its identity in the Workers API. There is no rename
operation. Changing `name` in `wrangler.jsonc` and deploying creates or targets
a **different Worker**; the old one is left exactly as it was.

Concretely, given E5 (`straumvakt-console` does not exist) and E8:

| Command | Effect with `4fe0a95` applied |
|---|---|
| `wrangler deploy` (no `--env`) | **Creates a brand-new Worker `straumvakt-console`.** `hlada` untouched (and per E4, `hlada` does not exist today anyway). |
| `wrangler deploy --env staging` | **Unchanged** — `env.staging.name` is still `hlada-staging`. `4fe0a95` is inert for staging. |

**What does *not* transfer to the new Worker:**

| Item | Transfers? | Why |
|---|---|---|
| `vars` (non-secret) | ✅ yes | declared in `wrangler.jsonc` |
| `services` binding (`OCPP_GATEWAY`) | ✅ yes | declared in config |
| `assets` binding (`ASSETS`) | ✅ yes | declared in config |
| `observability`, `limits`, compat flags | ✅ yes | declared in config |
| **Secrets** (`AUTH_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, …) | ❌ **no** | per-Worker, set via `wrangler secret put` / dashboard; never in config |
| **Custom domains** | ❌ **no** | attached to a Worker; a new Worker starts with none |
| **Git integration** | ❌ **no** | bound to a Worker in the dashboard |
| **Hyperdrive binding** | ❌ **not in root config at all** | only `env.staging` declares `HYPERDRIVE_DB` |
| Deployment history / rollback targets | ❌ no | new Worker, empty history |

**The most dangerous version of this change is not the deploy itself.** It is
the follow-on the config comment already anticipates (`wrangler.jsonc:53-57`):
"When the production Worker is cut over, these routes move to the root config."
Moving `straumvakt.org` onto the root config as it stands would point the live
brand domain at a Worker with **no Hyperdrive binding and no secrets**.

**The stated rationale is unverified.** "to avoid CPMS collision" implies a
name clash with the CPMS project's `hlada` Worker. That cannot be checked
without dashboard access. If `hlada` genuinely does not exist in this account
(E3/E4), there may be no collision to avoid — or the collision may be exactly
why it was never deployed. Unresolved.

**Recommendation: `4fe0a95` stays out of the release candidate** — consistent
with the standing rule. It is a correct *intent* expressed as a change that
does something materially different from what its message says.

---

## 4. Bindings and secret-name inventory (Q4)

Names only. **No secret value was read, printed, or transmitted at any point.**

### Bindings

| Binding | `hlada` (root) | `hlada-staging` | `straumvakt-console` (proposed) | API Worker (`hlada-api-staging`) |
|---|---|---|---|---|
| `ASSETS` (assets) | ✅ | ✅ | ✅ inherits root | — |
| `OCPP_GATEWAY` (service) | ✅ → `straumvakt-ocpp` | ✅ → `straumvakt-ocpp-staging` | ✅ inherits root | ✅ |
| `HYPERDRIVE_DB` | ❌ **absent** | ✅ `d2d56ab1ffe241bbb64946ba78a52be5` | ❌ **absent** | ✅ same id |
| `OUTBOUND_QUEUE`, `ARCHIVE_QUEUE` | ❌ | ❌ | ❌ | ✅ |
| `EVIDENCE_BUCKET` (R2) | ❌ | ❌ | ❌ | ✅ |

The console and API Workers **share one Hyperdrive resource** (same id in both
`wrangler.jsonc` files).

### Secret names

| Name | Declared in `.env.example` | Referenced by console `src/` | Referenced by API `bindings.ts` |
|---|---|---|---|
| `AUTH_SECRET` | ✅ | ✅ (28 route files + `api-auth.ts`) | ✅ |
| `ADMIN_EMAIL` | ✅ | ✅ (`admin-session.ts`) | ✅ |
| `ADMIN_PASSWORD` | ✅ | ✅ (`admin-session.ts`) | ✅ |
| `OCPP_INGEST_SECRET` | ✅ | ❌ | ✅ |
| `OCPP_CRED_KEK` | ❌ | ❌ | ✅ |
| `DATABASE_URL` | ✅ | ❌ **not referenced** | ❌ (uses Hyperdrive) |
| `DIRECT_URL` | ✅ | ❌ **not referenced** | ❌ |
| `AUDKENNI_ISSUER_URL` / `_CLIENT_ID` / `_CLIENT_SECRET` | ✅ | ❌ | ❌ |

**Two findings worth acting on separately:**

1. **The console Worker no longer needs a database at all** (E16 — no DB
   client, no `DATABASE_URL` reference, no `src/app/api`). Yet `env.staging`
   still declares `HYPERDRIVE_DB`, and `wrangler.jsonc:35` still claims
   `DATABASE_URL`/`DIRECT_URL` secrets live on it. Those are very likely
   **stale secrets on a live production Worker**. Removing them is a hygiene
   win and reduces blast radius — but it is a change to a live Worker and needs
   approval.
2. `ADMIN_EMAIL`/`ADMIN_PASSWORD` are consumed only by `getAdminCredentials()`
   in `src/lib/admin-session.ts`. Whether any live code path still calls it
   should be confirmed before treating them as required.

---

## 5. Neon: which branch, and the default-branch trap (Q5)

### Which branch is live

**Not conclusively verifiable** — the Hyperdrive connection string lives in
Cloudflare. The circumstantial evidence is strong and one-directional:

| | `production` (default) | `staging` |
|---|---|---|
| Neon flags | `primary: true`, `default: true` | `default: false` |
| `protected` | **false** | **false** |
| Logical size | 37 MB | 595 MB |
| Lifetime CPU | 504 sec | 336,340 sec |
| Compute state | `idle` | **`active`**, `suspend_timeout_seconds: 0`, up since 2026-08-01 |

A continuously-active, never-suspending compute with 336k CPU-seconds is what a
Hyperdrive connection pool looks like. **Working assumption: Hyperdrive →
`staging` (`br-tiny-river-abgpqq37`, compute `ep-quiet-bird-abxartp8`).
Confirm in the dashboard before the release.**

### The trap is real and was triggered today

`production` is the Neon **default** branch and is abandoned. Anything that
connects "to the project" without naming a branch lands there:

- The Neon MCP `run_sql` tool documents *"If not provided the default branch is
  used."*
- **E12: the production compute's `last_active` is 2026-08-08T20:38:44Z.**
  It was reached today. Earlier in this session a `run_sql` without `branchId`
  returned `relation "identity.organizations" does not exist` — that query hit
  `production`, whose 37 MB schema predates the `tenancy` split.

So this is not hypothetical. It is a live footgun that fires silently: queries
succeed against the wrong, near-empty branch and return plausible "no rows" or
"no such relation" answers.

**Neither `production` nor `staging` is `protected`.** Enabling Neon branch
protection on `staging` (and ideally on `production`, to make accidental writes
fail loudly) is a cheap mitigation — requires approval.

---

## 6. The staging catch-up, corrected as a production release (Q6)

### What changes versus the existing runbook

The existing runbook (`docs/notes/2026-08-08-staging-catchup-runbook.md`) is
accurate on the database work and correctly flags the deploy-trigger question.
It is framed as *"a git fast-forward"*. Given E2, that framing understates it.
The corrections:

| Runbook framing | Corrected framing |
|---|---|
| Step 5 is "fast-forward the git `staging` branch" | Step 5 is **a production release to `straumvakt.org`**, potentially automatic |
| "Confirm first whether this push *is* the deploy" (a caveat) | **A hard gate.** Nothing proceeds until answered from the dashboard |
| 2 pending migrations | Also **+16 migrations of code drift** (31 → 47 on disk, E15) |
| Deploy target implicitly "staging" | Deploy target is the **live brand domain** |
| — | **New:** the deployed `origin/staging` config lacks the `routes` block (E14). Custom-domain retention across the deploy is unverified |

### Preflight — all must pass before anything is done

| # | Check | Pass condition |
|---|---|---|
| P1 | Cloudflare dashboard → Worker `hlada-staging` → Settings → Build/Deployments | Git integration state **recorded explicitly** (connected + branch + build command + root dir, or absent) |
| P2 | Same page → Custom Domains | `straumvakt.org` + `www.straumvakt.org` listed, and it is known whether a deploy without `routes` detaches them |
| P3 | Hyperdrive config `d2d56ab1ffe241bbb64946ba78a52be5` | Confirmed to target `br-tiny-river-abgpqq37` |
| P4 | Worker secrets list (names only) | Every name in §4 marked required is present on `hlada-staging` |
| P5 | `git rev-list --left-right --count origin/staging...origin/main` | Left side **0** (still a fast-forward) |
| P6 | CI `check` green on the release candidate | Owned by Claude A — **do not duplicate**; consume the result only |
| P7 | RC contents | Excludes `4fe0a95`, `30fa407`, `5311cbd` |
| P8 | Neon backup branch created from `staging` | `backup-2026-08-XX-pre-catchup` exists, parent LSN recent |

### Backup and rollback requirements

- **Database:** Neon branch `backup-YYYY-MM-DD-pre-catchup` from `staging`
  before any migration work. Copy-on-write, near-instant. This is the only
  rollback for the schema.
- **Worker:** record the current deployment version id **before** deploying.
  Cloudflare rollback is per-version; without the id there is no clean revert.
- **Git:** record `origin/staging`'s pre-push SHA (`f53fb55`). Rolling the
  branch back is a force-push, which is itself a production action — so the
  Worker-version rollback is the primary path, not the git one.
- **Custom domains:** capture the current attachment (screenshot or API read)
  so it can be re-created if a deploy detaches it.

### Ordering

1. P1–P4 dashboard verification. **Stop if P1 is "connected".** A connected
   integration means the git push and the deploy are one irreversible action,
   and the plan must change to a deliberate `wrangler deploy` with the
   integration paused.
2. Neon backup branch (P8).
3. Migration reconciliation on `staging` (per the existing runbook §3 — it is
   correct; the two pending migrations are genuinely different cases).
4. Reset `test` from `staging` — **after** step 3, or the divergence reverses.
5. Record Worker version id + custom-domain state.
6. Advance `staging` to the RC.
7. Deploy (or observe the automatic deploy).
8. Smoke tests.

### Smoke tests, post-deploy

| # | Test | Expected |
|---|---|---|
| S1 | `GET https://straumvakt.org/` | 200, login page renders |
| S2 | `GET https://www.straumvakt.org/` | 200, identical to S1 |
| S3 | TLS certificate on both | valid, not expired, correct SAN |
| S4 | `GET https://api.straumvakt.org/api/admin/me` (no cookie) | `401 {"error":"unauthorized"}` |
| S5 | Authenticated login round-trip | session cookie issued, `/api/admin/me` returns the expected persona |
| S6 | One DB-backed authenticated read | real rows, i.e. Hyperdrive still bound |
| S7 | `npm run check:migrations` against staging | "47 migrations found", "up to date" |
| S8 | Worker error rate / logs, 15 min | no elevated 5xx |
| S9 | OCPP gateway service binding | a charger transaction completes end-to-end |

### Stop conditions — abort and roll back immediately

1. P5 left-side ≠ 0 — no longer a fast-forward.
2. Custom domain missing or TLS invalid after deploy (S1–S3).
3. S4 or S6 fails — API or DB binding broken.
4. Any Neon query during the window returns data inconsistent with the backup.
5. `production` Neon compute shows unexpected activity — indicates something is
   pointed at the wrong branch.
6. Worker 5xx rate rises above baseline after deploy.
7. Any step requires a decision not covered here.

---

## 7. The CI migration-status credential (Q7)

Evaluating `docs/operator/CI_MIGRATION_CHECK_CREDENTIAL.md` (branch
`docs/ci-and-custom-domain` @ `d4e2e07`). **Nothing was created:** no Neon role,
no GitHub secret, no environment, no workflow change.

**The design is sound, and its central finding is the important one.** That
Neon roles created via console/CLI/API are granted `neon_superuser` — carrying
`pg_write_all_data` — makes the obvious approach strictly worse than reusing
the existing credential. Creating the role **in SQL** is genuinely the only way
to get a least-privilege account. That is a real and non-obvious trap, correctly
identified.

The rest holds up: fork PRs cannot read secrets; GitHub Environments fence a
secret to a named job *and* approved branches; `pull_request_target` is
correctly rejected as worse.

**Three additions before implementation:**

1. **Branch-scope the role deliberately.** Neon roles are branch-scoped and
   duplicate into children. Creating it on `staging` means it propagates to
   every future `test` reset — convenient, but it also means the credential
   exists on every branch created from `staging` thereafter, including backup
   branches. Decide whether that is intended.
2. **The role needs `USAGE` on the schema plus `SELECT` on exactly one table.**
   `prisma migrate status` reads `_prisma_migrations` only. Grant no more, and
   verify with a negative test (a `SELECT` against `identity.users` must fail).
3. **`check.yml` currently triggers on `push: branches: ["**"]`.** An
   environment-gated job with required reviewers will prompt on *every branch
   push*, which will be ignored within a day. Restrict the migration-status job
   to the trunk/RC branch, or make it `workflow_dispatch` + scheduled.

**One caveat on sequencing:** this touches the same workflow file Claude A is
working in. It should land after that work, not alongside it.

---

## 8. Worker migration plan that preserves `hlada`

Written on the assumption that a rename is wanted eventually. It never assumes
Wrangler renames anything.

**Principle: `hlada` is never modified or deleted. The new Worker is built
alongside, proven, then cut over at the DNS/custom-domain layer — the only
layer where the switch is atomic and reversible.**

| Step | Action | Reversible? |
|---|---|---|
| M0 | Dashboard: confirm whether `hlada` exists at all (E3/E4 say no). If absent, "preserving `hlada`" is trivially satisfied and the CPMS-collision rationale needs re-examining | read-only |
| M1 | Add `HYPERDRIVE_DB` (and any other missing binding, §4) to the **root** config. Without this the new Worker has no database | config only, not deployed |
| M2 | `wrangler deploy` → creates `straumvakt-console` on workers.dev only. **No custom domain yet** | delete the Worker |
| M3 | Set secrets on `straumvakt-console` by name (§4). Never copy values through a terminal — set them from the same source of truth as the originals | re-set |
| M4 | Verify on `straumvakt-console.straumvakt.workers.dev`: S4–S7 from §6 | — |
| M5 | Attach a **staging-only** hostname first (e.g. `next.straumvakt.org`), verify TLS + full smoke | detach |
| M6 | Cut over: attach `straumvakt.org` + `www` to `straumvakt-console`, detach from `hlada-staging`. **Brief window where both or neither may serve** — schedule it | re-attach to `hlada-staging` |
| M7 | Reconnect Git integration to the new Worker, if one exists | disconnect |
| M8 | Leave `hlada-staging` deployed and warm for a defined bake period as the rollback target. Do not delete | — |

**Rollback at any point after M6:** re-attach the custom domains to
`hlada-staging`, which is still deployed and still has its secrets. This is why
M8 matters and why `4fe0a95` alone — which does M2 with none of M1, M3–M8 — is
not a migration plan.

---

## 9. Decisions requiring Andri's approval

| # | Decision | Why it needs you |
|---|---|---|
| A1 | **Verify the Cloudflare Git integration on `hlada-staging`** and record the result | Blocking. Nothing proceeds without it. Requires dashboard access this session does not have |
| A2 | Whether the catch-up runs at all, knowing it is a **production release to `straumvakt.org`** | Changed risk profile versus how it was scoped |
| A3 | Grant read-only Cloudflare access (scoped API token or `wrangler login`) for verification | Would convert five "blocked" rows into facts |
| A4 | Enable Neon branch protection on `staging` (and `production`) | Mutates Neon settings |
| A5 | Remove stale `DATABASE_URL`/`DIRECT_URL` secrets from the console Worker, if confirmed unused | Mutates a live production Worker |
| A6 | Confirm or drop the "CPMS collision" rationale behind `4fe0a95` | Determines whether the migration is needed at all |
| A7 | Whether the Worker migration (§8) happens before, after, or independently of the catch-up | Sequencing; both touch the live domain |
| A8 | Approve the CI credential design with the three §7 additions; the SQL role creation itself is DDL | Explicitly requires approval |
| A9 | Whether `origin/staging` should be force-push-protected before it is advanced | Changes branch protection |

---

## 10. What was NOT done

No Cloudflare, Neon, GitHub, DNS, secret, branch, or deployment state was
changed. Specifically: no deploy, no push, no merge, no branch created or
deleted on any remote, no Neon branch created/reset/deleted, no DDL, no DML, no
role created, no secret read or rotated, no DNS record touched, no Git
integration modified, no branch protection changed.

Reads performed: HTTPS GETs against public endpoints; Neon MCP
`describe_project` and `list_branch_computes` (metadata only — no SQL was run
in this investigation); local `git` reads; local file reads; `wrangler whoami`.

No authentication attempt was made against any production endpoint — in
particular, `POST /api/admin/login` was deliberately **not** exercised, because
a login attempt against the live API is a state-changing action (rate limiter,
audit trail).
