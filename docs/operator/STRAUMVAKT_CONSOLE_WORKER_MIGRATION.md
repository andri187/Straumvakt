# Console Worker migration — `hlada-staging` → a Straumvakt-owned Worker

**Status: plan only. Nothing has been created, deployed, renamed, or deleted.**

This is a **migration**, not a rename. Cloudflare has no rename operation for a
Worker script, and Wrangler exposes none — verified against the installed
wrangler 4.84.1 source, where the only `rename*` symbol is
`renameWorkerNamespace`, which acts on Workers-for-Platforms dispatch namespaces,
not on Worker scripts. A Worker's script name **is** its identity. Changing
`name` in `wrangler.jsonc` and deploying produces a *different Worker*; the
original is left exactly as it was.

`hlada` is preserved throughout. Nothing in this plan deletes or modifies it.

---

## 1. Why this migration exists — the collision is real

`4fe0a95`'s stated rationale ("to avoid CPMS collision") is **correct**, and was
verified from local evidence on 2026-08-08:

`E:\Claude\CPMS\CPMS\wrangler.jsonc` declares:

```
"name": "hlada"                    // line 3   — CPMS production
"env": { "staging": { "name": "hlada-staging" } }   // line 32 — CPMS staging
```

The Straumvakt repo declares **the same two names**, in the same Cloudflare
account (both use the `straumvakt.workers.dev` subdomain). CPMS's own `CLAUDE.md`
documents the topology as live:

| Env | Branch | Worker | URL |
|---|---|---|---|
| Staging | `staging` | `hlada-staging` | `hlada-staging.straumvakt.workers.dev` |
| Production | `master` | `hlada` | `hlada.straumvakt.workers.dev` |

— and states *"Cloudflare auto-deploys on push: push to `staging` → staging
Worker rebuilds; push to `master` → production Worker rebuilds."*

### The collision is on the wrong Worker

`4fe0a95` renames the **root** name (`hlada` → `straumvakt-console`) and leaves
`env.staging.name` as `hlada-staging`.

- `hlada` is **not deployed** (error 1042, 2026-08-08T23:25:42Z).
- `hlada-staging` **is** deployed, and is serving `straumvakt.org`.

So the commit resolves a collision on a Worker that does not exist, and leaves it
in place on the Worker that is live and customer-facing. **The live risk is that
a push to CPMS's `staging` branch redeploys `hlada-staging` and overwrites
Straumvakt's production site.** CPMS's last commit is 2026-04-23, so this is
dormant rather than imminent — but it is one `git push` away, and whether CPMS's
Git integration is still connected is a dashboard question (C3 in the release
runbook).

**This is the strongest argument for doing the migration at all**, and it is a
different argument from the one in the commit message.

---

## 2. What `4fe0a95` actually does — proven, not assumed

Verified against wrangler 4.84.1's own config resolution. The relevant line is
`inheritable()` in `wrangler-dist/cli.js`:

```js
(rawEnv !== topLevelEnv ? rawEnv[field] : void 0) ?? transformFn(topLevelEnv?.[field]) ?? defaultValue
```

with `transformFn = appendEnvName(envName)`, i.e. `` `${value}-${envName}` ``.

| Command | Resolved Worker name | Why |
|---|---|---|
| `wrangler deploy` | **`straumvakt-console`** | top-level `name`, changed by `4fe0a95` |
| `wrangler deploy --env staging` | **`hlada-staging`** | `env.staging.name` is explicitly set, so it short-circuits the `??` chain before `appendEnvName` is ever applied |

**So `4fe0a95` is provably inert for `--env staging`** — but only because
`env.staging.name` is explicitly present. If that key were ever removed, the
staging name would fall through to `appendEnvName`, becoming
`straumvakt-console-staging`, and the deploy would **silently target a different,
non-existent Worker while the live one kept serving stale code**. That is a
latent trap worth a comment in the config.

For a root deploy, `4fe0a95` is consequential: `straumvakt-console` does not
exist (error 1042), so it would be **created** — empty of everything that is not
in `wrangler.jsonc`.

---

## 3. Source → target identity

| | Source | Target |
|---|---|---|
| Worker name | `hlada-staging` | `straumvakt-console` (proposed) |
| Currently deployed | **yes** — serving production | no — does not exist |
| Custom domains | `straumvakt.org`, `www.straumvakt.org` | none |
| workers.dev | `hlada-staging.straumvakt.workers.dev`, enabled | none |
| Config block | `env.staging` | root |
| Name collides with CPMS | **yes** | no |
| Deployment history | present (rollback targets) | none |

**Note the asymmetry.** The natural reading of `4fe0a95` is "production Worker
`hlada` becomes `straumvakt-console`". But the Worker that actually needs to move
is `hlada-staging`, because that is the one serving traffic. The migration below
targets the live Worker, not the phantom one.

---

## 4. Required configuration, bindings and secret names

Names only. **No secret value is recorded, read, or transmitted anywhere in this
plan.**

### Bindings the target must have

| Binding | Type | Present in root config today? | Action |
|---|---|---|---|
| `ASSETS` | assets | ✅ yes | inherits |
| `OCPP_GATEWAY` | service | ✅ yes → `straumvakt-ocpp` | **decide**: root binds `straumvakt-ocpp`, staging binds `straumvakt-ocpp-staging` |
| `HYPERDRIVE_DB` | hyperdrive | ❌ **absent from root** | **must be added** if the Worker needs a database — see §5 |

> The root config has **no Hyperdrive binding at all**. Deploying it as-is
> produces a Worker with no database access. This is the single most likely way
> to break the site during a migration.

### Secret names to provision on the target

| Name | Required? | Evidence |
|---|---|---|
| `AUTH_SECRET` | **yes** | referenced by 28 route files + `src/lib/api-auth.ts` |
| `ADMIN_EMAIL` | probably | only `getAdminCredentials()` in `src/lib/admin-session.ts` |
| `ADMIN_PASSWORD` | probably | same |
| `DATABASE_URL` | **no — see §5** | not referenced anywhere in `src/` |
| `DIRECT_URL` | **no — see §5** | not referenced anywhere in `src/` |
| `AUDKENNI_ISSUER_URL` / `_CLIENT_ID` / `_CLIENT_SECRET` | no | declared in `.env.example`, not referenced in `src/` |
| `OCPP_INGEST_SECRET` | no | API Worker only |

Secrets are per-Worker and are never stored in Wrangler configuration —
Cloudflare's documentation states *"Secrets described on this page are defined
and managed on a per-Worker level."* **They do not transfer to a Worker with a
different name.** Every required secret must be set on the target from the same
source of truth as the original, never copied through a terminal or a log.

---

## 5. Resources deliberately not carried forward

Source evidence says these are stale. Carrying them forward would propagate dead
configuration into a new Worker.

| Resource | Evidence it is stale | Recommendation |
|---|---|---|
| `DATABASE_URL`, `DIRECT_URL` secrets | The console `src/` tree contains **no** DB client, no `DATABASE_URL`/`DIRECT_URL` reference, and no `src/app/api` directory. Prisma left the Next bundle in the API-Worker cutover | **Do not set on the target.** Removing them from the source is a separate, approval-gated hygiene change |
| `HYPERDRIVE_DB` binding | Same evidence — nothing in `src/` calls `getCloudflareContext()` or uses the binding | **Confirm before omitting.** Omitting a binding that turns out to be needed breaks the site; note also that rollback is blocked if a binding is deleted between versions |
| `wrangler.jsonc` comment claiming DB secrets live on the Worker (line 35) | Contradicted by the above | Correct the comment when the config is next touched |

**Do not act on this table from inference alone.** C6 in the release runbook
(dashboard secret-name list) tells you what is actually set. Compare, then decide.

---

## 6. Git integration decision

| Option | Consequence |
|---|---|
| Connect the target to `Straumvakt`/`staging` | Reproduces today's behaviour: a branch push deploys production. Only sane if the branch is protected and the deploy is intended to be automatic |
| Connect to a dedicated release branch | Push-to-deploy, but from a ref that exists for that purpose |
| No integration; deploy with `wrangler deploy` | Most deliberate. Requires an authenticated operator each time |

**Recommendation: no Git integration on the target initially.** The current
situation — a production domain on a Worker whose deploy trigger nobody in this
investigation could confirm — is precisely the failure mode to avoid repeating.
Add an integration later, deliberately, once the branch it watches is protected.

Whatever is chosen, **the CPMS integration must be resolved in the same change**
(C3). Migrating Straumvakt off `hlada-staging` while leaving CPMS pointed at it
is fine — that is in fact the goal — but only once Straumvakt's domains have
moved.

---

## 7. Custom-domain cutover decision

This is the only step customers can see, and the only one that is atomic.

Cloudflare's documentation confirms attaching a Custom Domain creates a DNS
record **and** an Advanced Certificate, and that removing the domain does **not**
delete the certificate.

| Option | Trade-off |
|---|---|
| **A. Prove on a spare hostname first** (e.g. `next.straumvakt.org`), then move the brand domains | Slowest, safest. Full smoke test against real bindings and secrets before any customer traffic |
| B. Move `www` first, then apex | Partial exposure; two cert provisioning events |
| C. Move both at once | Shortest window, least reversible |

**Recommendation: A.** The target Worker starts with no secrets and no database
binding; a spare hostname is the only way to prove those are right before the
brand domain depends on them.

Expect a short window during the move where a hostname may serve from neither
Worker while DNS/cert settle. Schedule it; do not discover it.

---

## 8. Migration steps

Every step is reversible until M6.

| # | Step | Reversal |
|---|---|---|
| M0 | Resolve C1–C9 (release runbook §2). Confirm whether `hlada` exists and which repo owns the `hlada-staging` integration | read-only |
| M1 | Add `HYPERDRIVE_DB` to the **root** config (and settle the `OCPP_GATEWAY` target). Config change only — not deployed | revert the commit |
| M2 | `wrangler deploy` → creates `straumvakt-console`, workers.dev only, **no custom domain** | delete the Worker |
| M3 | Set required secrets by name (§4) from the original source of truth | re-set |
| M4 | Smoke-test on `straumvakt-console.straumvakt.workers.dev`: auth gating, a DB-backed read, migration status | — |
| M5 | Attach a spare hostname (§7 option A); full smoke incl. TLS | detach |
| M6 | **Cutover:** attach `straumvakt.org` + `www` to the target; detach from `hlada-staging` | re-attach to `hlada-staging` |
| M7 | Decide and apply the Git integration (§6) | disconnect |
| M8 | Bake period — leave `hlada-staging` deployed, warm, with its secrets intact | — |
| M9 | Only after the bake: consider what happens to `hlada-staging`, given CPMS also claims the name (§9) | — |

---

## 9. Evidence required before deleting or changing any old Worker

**Do not delete `hlada-staging`.** Two independent reasons:

1. It is the rollback target for the entire migration. Until the bake period ends
   it is the only warm Worker with a proven-good configuration and real secrets.
2. **CPMS claims the same name.** Deleting the Worker does not delete CPMS's
   claim to it — CPMS's `wrangler.jsonc` and `CLAUDE.md` still name it, and if
   CPMS's Git integration is live, a CPMS push would simply recreate it. Deleting
   it therefore achieves nothing durable and destroys the rollback target.

Required before any change to an old Worker:

| # | Evidence |
|---|---|
| X1 | Target has served the brand domains without incident for the agreed bake period |
| X2 | Dashboard confirmation of which repo's integration points at the old Worker (C2/C3) |
| X3 | CPMS's intent is settled — either CPMS is retired, or it is repointed to names Straumvakt does not use |
| X4 | The old Worker's secret names are recorded (names only), so it could be rebuilt |
| X5 | Andri's explicit approval — Worker deletion is irreversible and not covered by any rollback in this plan |

---

## 10. Smoke tests and rollback

### Smoke tests for the target (M4, M5)

| # | Test | Expected |
|---|---|---|
| T1 | `GET /` on the target hostname | 200, login page |
| T2 | Protected route unauthenticated | redirect to `/`, not a 200 render |
| T3 | `POST /api/admin/login`, valid test account | session cookie, correct domain attributes |
| T4 | Authenticated DB-backed read | real rows — proves Hyperdrive bound and pointed at Neon `staging` |
| T5 | Cross-org read attempt | `403 permission_missing` |
| T6 | TLS on the spare hostname | valid |
| T7 | `hlada-api-staging.straumvakt.workers.dev` still serving | **the shipped mobile app calls this host directly** — the console migration must not disturb it |

### Rollback

| Failure | Path | Reversible? |
|---|---|---|
| Target misbehaves pre-cutover | Stop. Nothing customer-visible changed | fully |
| Target misbehaves post-cutover | Re-attach brand domains to `hlada-staging`, still warm | fully, minutes |
| Bad code on the target | Cloudflare version rollback (needs a version ID; resources unchanged) | mostly |
| Secret wrong/missing | Re-set and redeploy | fully |
| Old Worker deleted | **none** | ❌ irreversible — hence §9 |

---

## 11. Bottom line

**`4fe0a95` alone performs no safe control-plane migration.** It is a one-line
config edit that, on a root deploy, creates an empty Worker with no secrets, no
custom domains, no Git integration and no database binding — and on a staging
deploy does nothing at all. It is M1's neighbour at best; the migration is M0–M9,
and most of it happens in the Cloudflare dashboard, not in this repository.

The commit's *instinct* is right and its rationale is now verified. It is aimed
at the wrong Worker, and it is roughly 10% of the work.
