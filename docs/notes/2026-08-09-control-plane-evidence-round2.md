# Control-plane evidence — round 2

**Read-only. Nothing was pushed, deployed, mutated, or queried with SQL.**
Measured 2026-08-09T12:30–12:37Z.

---

## 0. The premise of this track is false — stated first

This track was scoped on the basis that *"Cloudflare access already exists"*.
**It does not, in this environment.** Verified three ways:

| Probe | Result |
|---|---|
| `npx wrangler whoami` (wrangler 4.120.0) | **"You are not authenticated."** |
| `CLOUDFLARE_*` / `CF_API_*` environment variables | **none present** |
| Cloudflare MCP servers available | **`cloudflare-docs` only** — `cloudflare-api`, `-bindings`, `-builds`, `-observability` are **not** loadable |

`ListMcpResourcesTool` returns nothing, and a direct `select:` for
`cloudflare-api`/`-bindings` tools returns **"No matching deferred tools found"**.

**So seven of the nine blocked facts remain blocked.** I did not simulate them,
and I did not fill them with inference.

**But two closed anyway** — and they are the two that were *never* closable by
looking at a dashboard, because they are questions about documented *behaviour*.
The one Cloudflare tool available is documentation search, and it is authoritative
for exactly this class of question.

---

## 1. U5 — route omission on deploy · **CLOSED (documented)**

**Source:** `developers.cloudflare.com/workers/wrangler/configuration/`, "Source of truth".

> *"If you change your routes in the dashboard, Wrangler will override them in
> the next deploy with the routes you have set in your Wrangler configuration
> file. To manage routes via the Cloudflare dashboard only, remove any route and
> routes keys from your Wrangler configuration file. **Then add
> `workers_dev = false`** to your Wrangler configuration file."*

### What this establishes

1. **Wrangler is documented to override dashboard-managed routes on deploy.** The
   prior packet treated detachment as *possible*; it is now the **documented
   default direction of travel**. The risk estimate goes up, not down.
2. **Dashboard-only route management requires two things**, not one: no `routes`
   key **and** `workers_dev = false`.

### Applied to `origin/staging` — the currently deployed config

| Condition | `origin/staging` | Documented mode |
|---|---|---|
| `routes` key present | **no** | — |
| `workers_dev = false` | **no** (key absent entirely) | — |

**`origin/staging` is in neither documented mode.** It has no routes to push and
no declaration that the dashboard owns them. What the documentation does *not*
state explicitly is whether "override with the routes you have set" means
"override to empty" when the set is empty.

**Residual unknown, now much narrower:** only the empty-set case. That is a
single question for Cloudflare support, or a two-minute experiment on a throwaway
Worker + throwaway hostname — **never on the brand domain**.

### A second finding from the same page — new, and it bites

> *"If you do not specify `workers_dev = false` but add a routes component to
> your Wrangler configuration file, the value of `workers_dev` will be inferred
> as **`false`** on the next deploy."*

And, from the `workers.dev` page:

> *"If you disable your `workers.dev` route in the dashboard but do not update
> your Worker's Wrangler file with `workers_dev = false`, the `workers.dev` route
> will be **re-enabled** the next time you deploy."*

**Why this matters here specifically:** the shipped mobile app pins
`hlada-api-staging.straumvakt.workers.dev`. The API Worker's config (`apps/api`)
declares **no `workers_dev` key**. If a `routes` block is ever added to the API
config — which the beta-domain plan (C-02) proposes doing — then **`workers_dev`
is inferred `false` on the next deploy and the pinned hostname stops serving.**

That would break every installed app, and it would happen as a *side effect* of
adding a custom domain, with nothing in the diff mentioning workers.dev.

**Mitigation, and it is one line:** add an explicit `"workers_dev": true` to the
API Worker's environment **in the same change** that adds `routes`. The web
Worker already does this correctly (`wrangler.jsonc` `env.staging.workers_dev:
true`) — the API config does not.

**This is the single most actionable finding of the session.**

---

## 2. U9 — `*.api` wildcard reuse · **CLOSED (documented)**

**Source:** `developers.cloudflare.com/ssl/edge-certificates/advanced-certificate-manager/`.

> *"Wildcard certificates only cover **one subdomain level**: A certificate for
> `*.example.com` covers `www.example.com` and `api.example.com` but **not**
> `api.staging.example.com`."*

Measured SAN on `straumvakt.org` (2026-08-09T11:32Z):
`straumvakt.org, api.straumvakt.org, *.api.straumvakt.org`.

| Candidate beta API hostname | Covered by the existing SAN? |
|---|---|
| **`beta.api.straumvakt.org`** | ✅ **yes** — one level under `api.straumvakt.org` |
| `api-beta.straumvakt.org` | ❌ **no** — would need `*.straumvakt.org`, which is not in the SAN |

**The earlier recommendation is confirmed on documentary evidence**, not
inference. Prefer `beta.api.straumvakt.org`.

**Caveat that keeps this honest:** Custom Domains *auto-generate* an Advanced
Certificate anyway — *"Creating a Custom Domain will also generate an Advanced
Certificate on your target zone for your target hostname."* So coverage affects
issuance time and SAN budget, **not feasibility**. Either name would work; one is
tidier and cheaper.

**SAN budget (new):** an advanced certificate holds up to **50 hosts**, apex
included. Not a constraint here, but worth recording before anyone proposes
per-customer hostnames.

---

## 3. New constraint found while closing U9 — affects the topology

**Source:** Custom Domains, "Worker to Worker communication".

> *"On the same zone, the only way for a Worker to communicate with another
> Worker running on a **route**, or on a workers.dev subdomain, is via **service
> bindings**. … if a Worker is attempting to communicate with a target Worker
> running on a **Custom Domain** rather than a route, the limitation is removed.
> Fetch requests sent on the same zone from one Worker to another Worker running
> on a Custom Domain will succeed without a service binding."*

The web Worker calls the API over **plain HTTPS**, not a service binding
(`src/lib/api-client.ts` maps hostnames to `https://api.straumvakt.org`). That
works **only because `api.straumvakt.org` is a Custom Domain**.

**Consequence:** if the API were ever moved from a Custom Domain to a *route*, the
same-zone `fetch()` from web → API would **fail**, and the failure would look
like an application bug rather than a routing decision. Any future
"tidy up the routes" change must preserve Custom-Domain status for the API, or
add a service binding first.

**Also recorded (limits page):** 100 Custom Domains per zone; 1,000 routes per
zone. Neither constrains this design.

---

## 4. GitHub truth — 2026-08-09T12:36:20Z

| Fact | Value |
|---|---|
| Default branch | **`dev/sprint-00-foundation`** (unchanged, stale) |
| Visibility | **public** · archived: false |
| Last push to origin | **2026-08-08T15:28:52Z** — nothing pushed since |
| Remote branches | **16** |
| Remote tags | **6** (`pilot-rescope-rev1`, `pre-control-plane-optionality`, `pre-detour`, `pre-host-drop`, `pre-org-enrichment`, `pre-pilot-rescope`) |
| Protected branches | **0 of 16** |
| Rulesets | **`[]`** |
| Local branches | **42** |

### ⚠️ The finding that matters: two local branches push to the deploy pointer

| Local branch | Upstream | Risk |
|---|---|---|
| **`dev/rename-prod-worker`** | **`origin/staging`** | **A bare `git push` from this worktree pushes `4fe0a95` — the Worker-rename commit that must not be deployed — straight to the branch that serves the brand domain** |
| **`dev/secret-hygiene-v2`** | **`origin/staging`** | same hazard, different content |
| `docs/ci-and-custom-domain` | `origin/dev/drizzle-…-harvest` | a bare push advances the frontier |
| `fix/prisma-migrations-path` | `origin/dev/drizzle-…-harvest` | same |

The other 11 upstream-tracking branches point at their own matching remotes,
which is harmless.

**This is a live foot-gun that costs nothing to remove**: `git branch
--unset-upstream` on the two `origin/staging` trackers. It changes no remote
state and no history. Until branch protection exists (still 0 of 16), the
upstream misconfiguration *is* the only thing standing between a habitual
`git push` and a production deploy.

---

## 5. Neon truth — 2026-08-09T12:37Z

**One project only: `spring-leaf-73019190` "Straumvakt"** — so **no production
project exists**, confirming the separate-project plan is greenfield.

| Setting | Value | Note |
|---|---|---|
| Postgres | 17 · region `aws-eu-west-2` | |
| **History retention** | **604,800 s = 7 days** | **the point-in-time-restore ceiling** |
| `allowed_ips` | **`[]`** — no allowlist | |
| `block_public_connections` | **false** | publicly reachable |
| Storage | ~976 MB synthetic | |
| Permission | ADMIN | |

### Branches — 13 total

| Branch | Role | default | protected | Size | State |
|---|---|---|---|---|---|
| `production` `br-fragrant-bonus-abrc01g6` | CPMS-era, abandoned | **yes** | **no** | 37 MB | ready |
| `staging` `br-tiny-river-abgpqq37` | **real beta data** | no | **no** | 597 MB | ready |
| `test` `br-withered-hat-abtc5gzi` | disposable | no | no | 590 MB | ready |
| `scratch-n1-onboarding-2026-08-08` | scratch | no | no | 590 MB | ready |
| 3 × `backup-2026-08-03-*` | backups | no | no | ~505–515 MB | ready |
| 3 × `backup-2026-06-*` | backups | no | no | ~229–249 MB | **archived** |
| `dev-agreements-v2`, `dev` | legacy | no | no | ~35–38 MB | **archived** |

**Nothing is protected.** The 7-day retention is the number that matters most and
was not previously recorded: **a backup branch is copy-on-write and durable, but
point-in-time restore beyond 7 days is not available.** Any rollback plan that
assumes a longer window is wrong.

Two clean-up candidates that cost nothing to keep and something to delete:
`scratch-n1-onboarding-2026-08-08` (a scratch branch still holding 590 MB) and
the four archived branches. **Neither is recommended for deletion here** —
storage is not the constraint, and a backup's value is precisely that nobody
decided it was expendable.

---

## 6. Blocked-fact ledger after this round

| # | Fact | Before | After |
|---|---|---|---|
| U1 | Git-integration owner | UNK | **UNK** — dashboard only |
| U2 | CPMS integrations live? | UNK | **UNK** — CPMS repo is private; no public cross-check |
| U3 | Deployed version ids | UNK | **UNK** — no rollback target still exists |
| U4 | Hyperdrive target branch | UNK | **UNK** |
| **U5** | Route omission on deploy | UNK | **CLOSED (documented)** — Wrangler overrides; only the empty-set case remains |
| U6 | Cloudflare account identity | UNK | **UNK** |
| U7 | Secret names as set | UNK | **UNK** |
| U8 | Does `www` have its own certificate? | INF | **CONFIRMED by SAN** — `www` is absent from the apex cert |
| **U9** | `*.api` wildcard reuse | UNK | **CLOSED (documented)** — `beta.api.…` is covered |
| — | DO namespace ids | UNK | **UNK** |
| — | Queue depths | UNK | **UNK** |

**Two closed, one upgraded from inference to confirmed, seven still require a
dashboard session.** The verification kit from the prior packet remains the
instrument; nothing in it is superseded.

## 7. What changed in the plan because of this round

| # | Change | Driver |
|---|---|---|
| 1 | **Add `"workers_dev": true` to the API Worker env in the same change that adds `routes`** | §1 — otherwise the pinned mobile host is silently disabled |
| 2 | Beta API hostname is **`beta.api.straumvakt.org`** | §2 — confirmed cert coverage |
| 3 | **Never convert the API from Custom Domain to route** without adding a service binding first | §3 — same-zone fetch would fail |
| 4 | `git branch --unset-upstream` on `dev/rename-prod-worker` and `dev/secret-hygiene-v2` | §4 — removes a one-command path to deploying `4fe0a95` |
| 5 | Any rollback plan must assume a **7-day** PITR ceiling | §5 |
| 6 | Treat route omission as **likely to detach**, not merely possible | §1 |
