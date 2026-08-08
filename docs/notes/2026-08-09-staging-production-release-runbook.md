# Staging → production release runbook

**Status: not approved, not executed. Nothing in this document has been run.**

This supersedes the premise of `docs/notes/2026-08-08-staging-catchup-runbook.md`
(`30fa407`). That document is accurate on the database work and should still be
read for its migration analysis, but its framing — *"a git fast-forward"*, with
the custom-domain attachment treated as a first-time, forward-looking step — is
stale. **The brand domain is already live**, and it is served by the Worker that
the `staging` branch deploys to. Advancing `staging` is therefore a production
release, not a staging catch-up.

Written 2026-08-09 (UTC) from `docs/infra-release-safety-packet`. Evidence and
timestamps are in `docs/notes/2026-08-08-infra-release-safety-packet.md`.

---

## 0. The premise this runbook is built on

| Fact | Evidence |
|---|---|
| `straumvakt.org`, `www.straumvakt.org` and `hlada-staging.straumvakt.workers.dev` return **byte-identical** bodies (SHA-256 `4bf6719964446f68…`) | direct HTTPS GET, 2026-08-08T23:25:42Z |
| ⇒ the live brand domain is served by the **staging** Worker `hlada-staging` | derived, plus `wrangler.jsonc` `env.staging.routes` |
| TLS cert for `straumvakt.org`: CN=`straumvakt.org`, Google Trust Services, valid `2026-08-04` → `2026-11-02` | `openssl s_client`, 2026-08-08T23:25:42Z |
| ⇒ the custom domain has been live since approximately **2026-08-04** | cert `notBefore` |
| The production Workers `hlada` and `hlada-api` are **not deployed** (error 1042) | HTTPS GET, 2026-08-08T23:25:42Z |
| **CPMS declares the same Worker names** — `hlada` and `hlada-staging` | `E:\Claude\CPMS\CPMS\wrangler.jsonc:3,32` |

**Consequence:** a push to `staging` — if the Cloudflare Git integration is
connected — is an immediate, customer-visible production release. It cannot be
treated as a rehearsal.

---

## 1. Preconditions and owners

| # | Precondition | Owner |
|---|---|---|
| O1 | Cloudflare dashboard facts in §2 resolved and recorded | **Andri** (only holder of dashboard access) |
| O2 | CI `check` green on the release candidate | **Claude A** (owns CI; do not duplicate) |
| O3 | Release candidate excludes `4fe0a95`, `30fa407`, `5311cbd` | Claude A + this document §3 |
| O4 | `apps/mobile` compatibility confirmed against the RC API surface | **Codex** (owns `apps/mobile`) |
| O5 | Neon backup branch created | **Andri** (Neon mutation — approval-gated) |
| O6 | Go/no-go decision | **Andri** |

**No step in this runbook may be started before O1 is complete.** Every other
precondition is subordinate to it, because the answer determines whether the git
push and the deploy are one action or two.

---

## 2. Blocking Cloudflare dashboard checks

These cannot be answered from outside the control plane. Wrangler is not
authenticated, the Cloudflare MCP servers require an interactive OAuth flow, and
`gh` is not installed. **GitHub-side absence of deployments is explicitly not
accepted as evidence.**

| # | Check | Where | Record |
|---|---|---|---|
| C1 | Is a Git integration connected to `hlada-staging`? | Worker → Settings → Build | connected y/n; repo; **branch**; build command; root directory; deploy command |
| C2 | Which repository is it connected to — `Straumvakt` or `CPMS`? | same | **Both repos declare this Worker name.** This is the single highest-value question in the packet |
| C3 | Is a Git integration connected to any CPMS Worker? | CPMS Workers → Settings | if CPMS still auto-deploys `hlada-staging`, a CPMS push can overwrite the live brand domain |
| C4 | Custom domains on `hlada-staging` | Worker → Settings → Domains & Routes | confirm `straumvakt.org` + `www.straumvakt.org`; screenshot |
| C5 | Current deployment version ID + timestamp | Worker → Deployments | **this is the rollback target — without it there is no clean revert** |
| C6 | Secret names present on `hlada-staging` | Worker → Settings → Variables and Secrets | names only; compare against §4 of the packet |
| C7 | Hyperdrive `d2d56ab1ffe241bbb64946ba78a52be5` target | Hyperdrive → config | confirm it points at Neon `br-tiny-river-abgpqq37` (`staging`) |
| C8 | Does `hlada` exist at all? | Workers list | error 1042 says no; confirm, because it changes the migration plan |
| C9 | workers.dev enabled for `hlada-api-staging` | Worker → Settings → Domains | **the shipped mobile app calls this hostname directly** (§11) |

### Stop condition on C1/C2

- **If connected to `Straumvakt`/`staging`:** the git push *is* the deploy.
  Steps 6 and 7 collapse into one irreversible action. Either pause the
  integration and deploy deliberately, or accept that and schedule accordingly.
- **If connected to `CPMS`:** stop entirely. The live brand domain is being
  served by a Worker whose deploy pipeline belongs to a different repository,
  and the next CPMS push overwrites Straumvakt's production site. That is a
  separate incident, not a release step.
- **If not connected:** the release becomes a deliberate `wrangler deploy --env
  staging`, and the git push is safe bookkeeping.

---

## 3. Exact commit range and release manifest

```
Range:  origin/staging..origin/dev/drizzle-ownership-and-market-harvest
From:   f53fb55   2026-06-14   (currently deployed)
To:     2b7ebf6   2026-08-08   (release candidate base)
```

`git rev-list --left-right --count origin/staging...origin/dev/…` = **`0  140`**
— staging is a strict ancestor, so this is a true fast-forward with no merge and
no possible conflict. Verified 2026-08-08T23:25:03Z.

| Measure | Value |
|---|---|
| Commits | **140** |
| Files changed | **635** |
| New migrations | **16** (31 → 47 on disk) |
| Largest areas | `apps/api` (183), `apps/driver` (85), `docs/adr` (52), `apps/mobile` (47), `packages/shared` (40), `packages/contracts` (34) |
| Commit mix | 23 docs, 20 feat, 18 fix, 3 ci, 2 test, 2 prisma |

**Excluded commits — verified absent from the RC base:**

| Commit | What | Why excluded |
|---|---|---|
| `4fe0a95` | root Worker `name` → `straumvakt-console` | Not a rename; see §5 and the migration doc |
| `30fa407` | staging catch-up runbook | Superseded by this document |
| `5311cbd` | consolidated session log | Preserves superseded conclusions |

All three confirmed **not** ancestors of `2b7ebf6` (2026-08-09). The RC base is
clean as it stands; no revert is required, only a decision not to merge them.

> **Note the scale.** This is not a routine deploy. 635 files and two months of
> work land on a live customer-facing domain in a single step, including a
> Prisma→Drizzle ownership change and 16 migrations. The fast-forward is trivial;
> the release is not.

---

## 4. Database backup and rollback prerequisites

**Nothing here is executed. Every item is a prerequisite to be satisfied by
Andri before the release, and each is an approval-gated Neon mutation.**

| # | Prerequisite | Notes |
|---|---|---|
| D1 | Neon backup branch from `staging` (`br-tiny-river-abgpqq37`) named `backup-2026-08-XX-pre-release` | Matches the existing convention (`backup-2026-08-03-pre-protocol-log-split`, etc.). Copy-on-write: near-instant, near-free |
| D2 | Record the backup's `parent_lsn` and creation timestamp | This is the restore point |
| D3 | Confirm `test` (`br-withered-hat-abtc5gzi`) is expendable | It is reset periodically; `last_reset_at` 2026-08-06 |
| D4 | Decide whether Neon branch protection is enabled on `staging` first | Currently `protected: false`. Approval-required |

**The database rollback path is the backup branch. There is no other.** A schema
change applied and then discovered wrong is not undone by a Worker rollback —
the code goes back, the schema does not.

---

## 5. Migration reconciliation — order, and why nothing happens yet

The analysis in `30fa407` §3 is correct and is not superseded: the two pending
migrations are genuinely different cases, one fully applied and unrecorded, the
other half-applied (its `DROP TYPE`s never ran on staging). Read it there.

What changes is the **ordering constraint and the gate**:

1. **No database action occurs until O1 and O6 are satisfied.** The reason is
   sequencing, not caution for its own sake: if C1 shows the git push auto-
   deploys, then code and schema move together, and reconciling the schema first
   leaves a window where the database is ahead of the running code. That window
   is currently ~14 migrations wide and has been survivable, but widening it
   deliberately before a 140-commit release is not.
2. Reconcile `staging` **before** resetting `test` from it, or `test` inherits
   the three orphaned enum types and the divergence reverses.
3. `npm run check:migrations` must report 47 found / up to date **before**
   deploy, not after.

---

## 6. Custom-domain and route retention

**This is a genuine unknown and a stop condition, not a formality.**

`origin/staging` — the currently deployed configuration — contains **no `routes`
block and no `workers_dev` key**. The custom-domain attachment exists in
Cloudflare anyway, so it was created out of band (dashboard, or a deploy from a
branch that had the block). Verified by `git show origin/staging:wrangler.jsonc`
2026-08-08T23:25:03Z.

The release candidate **does** contain the block (`env.staging.routes`, both
brand hostnames, `custom_domain: true`).

Cloudflare's documentation states that attaching a Custom Domain creates a DNS
record and an Advanced Certificate, and that deleting one does **not** remove the
certificate. It does **not** document what happens to an existing custom domain
when a deploy omits it from configuration. That behaviour must therefore be
treated as unknown.

| # | Check | When |
|---|---|---|
| R1 | Screenshot / API-read the custom-domain list on `hlada-staging` | before |
| R2 | Confirm both hostnames still attached | immediately after |
| R3 | Confirm TLS still valid on both (cert currently expires 2026-11-02) | immediately after |
| R4 | If either detaches — re-attach immediately; this is the fastest path back to serving | on failure |

Deploying *from the RC* moves in the safer direction (config gains the routes it
was missing). The risk is the reverse operation: any later deploy from a
configuration lacking the block.

---

## 7. Build and deploy trigger verification

Resolved by C1/C2/C3. Record the answer in the packet before proceeding. If the
integration is connected, the following are true simultaneously and must be
planned as one action:

- the push to `staging` starts a build;
- the build's success or failure is not gated by the repo's `check` workflow;
- the deploy lands on `straumvakt.org` with no further confirmation step.

---

## 8. Version capture and rollback target

| # | Requirement |
|---|---|
| V1 | Record the current `hlada-staging` deployment **version ID** and timestamp before anything changes (C5) |
| V2 | Confirm it is within the 100-most-recent versions Cloudflare retains for rollback |
| V3 | Note that rollback deploys a prior version **across all routes and domains** — it is not partial |
| V4 | Note that rollback does **not** revert bindings, secrets, or database state — *"Resources connected to your Worker will not be changed during a rollback"* |
| V5 | Rollback is blocked if bindings were deleted between versions — so do not remove the Hyperdrive binding in the same change |

---

## 9. Pre-deploy smoke tests

Run against the current live deployment, to establish a baseline to compare
against. All are unauthenticated reads.

| # | Test | Baseline recorded 2026-08-08T23:25:42Z |
|---|---|---|
| PS1 | `GET https://straumvakt.org/` | 200, body SHA-256 `4bf6719964446f68…` |
| PS2 | `GET https://www.straumvakt.org/` | 200, identical SHA |
| PS3 | `GET https://api.straumvakt.org/api/admin/me` | `401 {"error":"unauthorized"}` |
| PS4 | `GET https://hlada-api-staging.straumvakt.workers.dev/` | 404, SHA `da660378f25e1778…` (same Worker as PS3) |
| PS5 | TLS on both brand hostnames | valid, expires 2026-11-02 |
| PS6 | `npm run check:migrations` against staging | 47 found, up to date |

---

## 10. Deployment observation and stop conditions

Watch for 15 minutes minimum. Abort and roll back on any of:

1. `straumvakt.org` or `www` returns anything other than 200.
2. Either custom domain missing from the Worker, or TLS invalid.
3. `api.straumvakt.org` stops returning `401` on `/api/admin/me` (API Worker or
   its routing broken).
4. Worker 5xx rate above baseline.
5. Neon `production` branch compute (`ep-cold-waterfall-abxxo8w1`) shows
   activity — indicates something is pointed at the wrong database branch.
6. `check:migrations` disagrees with §9 PS6 after deploy.
7. The mobile app's API host stops responding (§11 M1).
8. Any decision arises that is not covered here.

---

## 11. Post-deploy smoke tests

### Brand domain and console

| # | Test | Expected |
|---|---|---|
| B1 | `GET https://straumvakt.org/` | 200, login page renders |
| B2 | `GET https://www.straumvakt.org/` | 200, identical to B1 |
| B3 | TLS on both | valid, correct CN/SAN |
| B4 | Static assets (`/_next/static/…`) load | 200, no mixed-content |

### API and auth gating

| # | Test | Expected |
|---|---|---|
| A1 | `GET api.straumvakt.org/api/admin/me` unauthenticated | `401 {"error":"unauthorized"}` |
| A2 | `POST /api/admin/login` with a valid test account | 200, session cookie set with correct domain/attributes |
| A3 | `GET /api/admin/me` with that cookie | correct `persona` and `orgs` |
| A4 | One DB-backed authenticated read | real rows — proves Hyperdrive still bound and pointed at `staging` |
| A5 | Cross-org read attempt | `403 permission_missing` — tenant isolation intact |

### Staff and org routes

| # | Test | Expected |
|---|---|---|
| S1 | `/` unauthenticated | login page, 200 |
| S2 | A protected app route unauthenticated | redirect to `/`, not a 200 render |
| S3 | Org landing route for a `host_admin` session | renders that org, and only that org |
| S4 | Same URL with a non-`host_admin` session | redirected away, no data leak |

> `middleware.ts` is **not compiled** on Next 16 in this repo (root file, appDir
> is `src/`), so route gating that looks like middleware's job is actually done
> server-side per route. S2 is therefore a real test, not a formality.

### Mobile API compatibility

**The shipped mobile app calls `https://hlada-api-staging.straumvakt.workers.dev`
directly** — not `api.straumvakt.org`. Verified in
`apps/mobile/lib/api/client.dart` (read-only; Codex owns this directory).

| # | Test | Expected |
|---|---|---|
| M1 | That workers.dev hostname still resolves and serves | **If workers.dev is ever disabled on that Worker, every installed app breaks** |
| M2 | `POST /api/driver/login` | contract unchanged |
| M3 | `GET /api/driver/me` | contract unchanged |
| M4 | Driver endpoints under `/api/driver/*` | present — `index.ts` routes `tap-intent`, `chargers`, and the public driver router |
| M5 | Codex confirms the RC's driver-API contract matches the shipped app | O4 |

---

## 12. Rollback paths

Separated by reversibility, because they are not equivalent.

### Reversible

| Path | Action | Notes |
|---|---|---|
| Code | Cloudflare rollback to the version ID captured in V1 | Fast. Does **not** revert bindings, secrets, or schema |
| Routing | Re-attach custom domains to `hlada-staging` | Fastest path back to serving if a domain detaches |
| Test DB | Reset `test` from `staging` | Test is disposable by design |

### Irreversible or costly

| Path | Action | Why it is not a clean undo |
|---|---|---|
| Database schema | Restore from the D1 backup branch | Any writes taken after the backup are lost. This is a restore, not a rollback |
| Git `staging` | Force-push back to `f53fb55` | A force-push to the production deploy pointer is itself a production action, and may re-trigger a build. **Prefer the Worker version rollback** |
| Advanced Certificate | — | Deleting a custom domain does not delete its certificate; re-attaching may not reuse it cleanly |
| Customer-visible errors | — | Cannot be rolled back. This is why §10 has a 15-minute observation window |

**Order of preference on failure: routing → code version → database restore.**
Reach for the database last; it is the only one that loses data.

---

## 13. What this runbook deliberately does not do

- It does not instruct anyone to push. Every path is gated on §2.
- It does not repeat the migration analysis in `30fa407` §3, which is still
  correct — it changes only the ordering and the gate.
- It does not treat the custom-domain attachment as a future step. It is live,
  and has been since approximately 2026-08-04.
- It does not assume the Git integration state in either direction.
