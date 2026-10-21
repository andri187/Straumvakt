# Appendix A · Cloudflare access-gap pack and blocked-facts operator kit

**Read-only throughout. No credential was created, read, or used.**

---

# Part 1 · Access-gap resolution pack

## 1.1 Failed probes — the evidence

| Probe | Result | UTC |
|---|---|---|
| `npx wrangler whoami` (v4.120.0) | **"You are not authenticated. Please run `wrangler login`."** | 2026-08-09T12:30Z |
| `Get-ChildItem env: \| ? Name -match 'CLOUDFLARE\|CF_API'` | **empty** | 12:30Z |
| MCP servers loadable | **`cloudflare-docs` only** | 12:31Z |
| `select:` for `cloudflare-api` / `-bindings` tools | **"No matching deferred tools found"** | 12:31Z |
| `ListMcpResourcesTool` | no resources | 12:31Z |

**Diagnosis:** the Cloudflare *documentation* server is connected; the *account*
servers are listed as connectors but never completed OAuth, so their tools are
not exposed. Wrangler has no stored OAuth token and no API-token environment
variable.

## 1.2 Tool names to expect once connected

If MCP OAuth completes, tools appear as
`mcp__plugin_cloudflare_cloudflare-api__*`,
`…cloudflare-bindings__*`, `…cloudflare-builds__*`,
`…cloudflare-observability__*`. **If those names are still absent after a login,
the connection did not take effect** — do not assume it silently worked.

## 1.3 Wrangler auth modes — and which to choose

| Mode | Mechanism | Scope | Fit here |
|---|---|---|---|
| **A. `wrangler login`** | interactive OAuth in a browser | **full account, read *and* write** | fast, but grants deploy rights to a session doing read-only verification |
| **B. `CLOUDFLARE_API_TOKEN`** | scoped API token in the environment | **exactly the permissions granted** | **recommended** |
| C. `--temporary` preview account | throwaway | none of this account | useless for verification |

**Recommendation: B.** The whole point of this verification is to look without
being able to break anything. Option A hands a session that only needs to *read*
the ability to deploy, and the operator cannot tell afterwards which it used.

### Least-privilege read-only token

Create at **My Profile → API Tokens → Create Token → Custom token**:

| Permission | Level | Closes |
|---|---|---|
| Account → Workers Scripts | **Read** | version ids, bindings, secret *names* |
| Account → Workers KV Storage | Read | (completeness) |
| Account → Workers R2 Storage | Read | bucket inventory |
| Account → Account Settings | Read | account identity |
| Account → Hyperdrive | Read | Hyperdrive target |
| Account → Queues | Read | queue depths, consumers |
| Zone → Zone | Read | zone identity |
| Zone → Zone Settings | Read | — |
| Zone → DNS | Read | custom-domain DNS records |
| Zone → SSL and Certificates | Read | certificate coverage |

**Grant no `Edit` anywhere.** Scope to the single account and the
`straumvakt.org` zone. Set a short TTL — a verification token should expire.

> A read-only token cannot mutate even by accident, which converts "be careful"
> into a property of the credential rather than a property of the operator.

## 1.4 Local setup

```powershell
# Session-scoped only — do NOT persist to the user profile.
$env:CLOUDFLARE_API_TOKEN = '<paste read-only token>'
$env:CLOUDFLARE_ACCOUNT_ID = '<account id>'

# Validate the token itself first
npx wrangler whoami
```

**Never** commit the token, echo it into a log, paste it into a document, or put
it in `.env`. When finished: `Remove-Item Env:\CLOUDFLARE_API_TOKEN`.

## 1.5 Validation commands and what each closes

**Every command below is read-only.**

| # | Command | Closes |
|---|---|---|
| V1 | `npx wrangler whoami` | **F1** account identity |
| V2 | `npx wrangler deployments list --name hlada-staging` | **F3** version ids (web) |
| V3 | `npx wrangler deployments list --name hlada-api-staging` | **F3** (API) |
| V4 | `npx wrangler deployments list --name straumvakt-ocpp-staging` | **F3** (gateway) |
| V5 | `npx wrangler secret list --name hlada-api-staging` | **F5** secret **names** (never values) |
| V6 | `npx wrangler hyperdrive list` | **F4** Hyperdrive target |
| V7 | `npx wrangler queues list` | **F7** queues + consumers |
| V8 | `npx wrangler triggers list --name hlada-staging` *(if supported)* | routes/domains |
| V9 | Dashboard → Worker → Settings → Build | **F2** integration owner |
| V10 | Dashboard → Worker → Settings → Bindings | **F6** DO namespace ids |

**F2 has no CLI equivalent** — Git-integration ownership is dashboard-only, and
it is the single most important fact. Plan for a dashboard visit regardless.

## 1.6 What never to run

| Never | Why |
|---|---|
| `wrangler deploy` (any form) | deploys |
| `wrangler delete` | destroys a Worker |
| `wrangler secret put` / `delete` | mutates credentials |
| `wrangler rollback` | changes what is serving |
| `wrangler versions deploy` | same |
| `wrangler queues purge` / `consumer remove` | destroys messages |
| `wrangler hyperdrive update/delete` | repoints the database |
| `wrangler r2 object delete` | destroys evidence |
| `wrangler login` **if a scoped token will do** | over-grants |

**A read-only token makes most of this list fail safely** — which is the
argument for it.

---

# Part 2 · The seven blocked facts

Common: record **verbatim**, write `ABSENT` rather than blank, never transcribe a
value.

## F1 · Account identity

| | |
|---|---|
| Dashboard | account switcher (top right) → **Account Home** |
| API | `GET /accounts` |
| Wrangler | `wrangler whoami` |
| Capture | account name, **last 6 of the id**, whether CPMS Workers are in the same account |
| Expected | one account containing both Straumvakt and CPMS Workers |
| Contradictory | two accounts → **every other finding must be re-scoped** |
| Risk | inspecting the wrong account and concluding the wrong thing |
| **Stop if** | the `straumvakt.org` zone is absent |

## F2 · Integration owner — **the highest-value fact**

| | |
|---|---|
| Dashboard | Workers & Pages → `hlada-staging` → **Settings → Build** |
| API | none reliable |
| Wrangler | **none** |
| Capture | connected y/n · **repository** · **branch** · build command · root dir · deploy command |
| Expected | `andri187/Straumvakt`, branch `staging` |
| Contradictory | **`andri187/CPMS`** → a dormant private repo can overwrite the brand domain |
| Risk | advancing `staging` produces an unpredictable deploy |
| **Stop if** | repository is CPMS → **incident, halt the release** |
| Repeat for | **every CPMS Worker found in F1** |

## F3 · Deployed version ids — **no rollback target exists today**

| | |
|---|---|
| Dashboard | Worker → **Deployments** |
| Wrangler | `wrangler deployments list --name <worker>` |
| Capture | active **version id**, timestamp, author, source, **count of retained versions** |
| Expected | ≥2 versions retained per Worker |
| Contradictory | **1 version** → no rollback target at all |
| Risk | a release becomes a one-way door |
| **Stop if** | fewer than 2 versions on any Worker about to receive traffic |

## F4 · Hyperdrive target

| | |
|---|---|
| Dashboard | Hyperdrive → config `d2d56ab1ffe241bbb64946ba78a52be5` |
| Wrangler | `wrangler hyperdrive list` |
| Capture | name, **target host prefix only**, database name, caching |
| Expected | `ep-quiet-bird-abxartp8…` (Neon **staging**) |
| Contradictory | `ep-cold-waterfall…` → **pointed at the abandoned branch** |
| Risk | every read and write goes to the wrong database, silently |
| **Stop if** | it does not match Neon's `staging` compute — **do not deploy** |
| Cross-check | Neon → branches → `staging` → compute id — **two sources** |

## F5 · Secret names as set

| | |
|---|---|
| Dashboard | Worker → Settings → **Variables and Secrets** |
| Wrangler | `wrangler secret list --name <worker>` |
| Capture | **names only** |
| Expected (API) | `AUTH_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `OCPP_INGEST_SECRET`, `OCPP_CRED_KEK` |
| Contradictory | `DATABASE_URL`/`DIRECT_URL` on the **web** Worker → stale (its `src/` has no DB client) |
| Risk | production parity list is built from the wrong inventory |
| **Stop if** | a value is displayed — **close the page, do not transcribe** |

## F6 · Durable Object namespace ids

| | |
|---|---|
| Dashboard | Workers → `straumvakt-ocpp-staging` → Settings → **Bindings**; also Durable Objects |
| Capture | `IDENTITY_DO` namespace id (**last 6**), class name, migration tag |
| Expected | class `IdentityDurableObject` |
| Contradictory | more than one namespace → an orphan from an earlier deploy |
| Risk | a new gateway silently starts with empty DO state |
| **Stop if** | the namespace is shared with another Worker |

## F7 · Queue depths and consumers

| | |
|---|---|
| Dashboard | **Queues** |
| Wrangler | `wrangler queues list`, `wrangler queues info <name>` |
| Capture | per queue: name, consumer, concurrency, **current depth**, retries; per DLQ: **message count** |
| Expected | six queues + three DLQs; depths ≈0; **DLQs empty** |
| Contradictory | **any DLQ non-zero** → an unnoticed processing failure |
| Risk | a backlog is already accumulating before load ever increases |
| **Stop if** | a DLQ is non-empty — investigate before any release |

---

# Part 3 · The two closed facts and what follows

## U5 · Route omission on deploy — **CLOSED**

**Citation:** `developers.cloudflare.com/workers/wrangler/configuration/` →
*"If you change your routes in the dashboard, Wrangler will override them in the
next deploy with the routes you have set in your Wrangler configuration file. To
manage routes via the Cloudflare dashboard only, remove any route and routes
keys … Then add `workers_dev = false`."*

**Operational consequences:**

1. Config is authoritative for routes; a deploy **overrides** the dashboard.
2. Dashboard-only mode needs **both** conditions; `origin/staging` satisfies
   neither.
3. **Adding `routes` infers `workers_dev = false`** unless declared — the
   foot-gun, and it applies to the API **and gateway** configs today.
4. Residual: whether an *empty* route set means "override to empty". One support
   question, or a throwaway-Worker experiment. **Never test on the brand domain.**

## U9 · Wildcard reuse — **CLOSED**

**Citation:** `developers.cloudflare.com/ssl/edge-certificates/advanced-certificate-manager/`
→ *"Wildcard certificates only cover one subdomain level."* Plus: a Custom Domain
**auto-generates** an Advanced Certificate; a certificate holds up to **50 SANs**.

**Operational consequences:**

1. `beta.api.straumvakt.org` is covered by the measured `*.api.straumvakt.org`
   SAN; `api-beta.straumvakt.org` is not.
2. Coverage affects issuance tidiness and SAN budget, **not feasibility**.
3. **`www` is absent from the apex SAN** — apex and `www` are separate
   certificate-bearing attachments and must be verified independently after any
   move.

---

# Part 4 · Evidence form

Paste-back. **No field can hold a secret value.**

```yaml
operator: ""            # name
date_utc: ""
auth_mode: ""           # read-only-token | browser-login | none

F1_account:
  name: ""
  id_last6: ""
  zone_straumvakt_org: ""        # present | absent
  cpms_workers_same_account: null
  cpms_worker_names: []

F2_integration:                   # repeat per Worker
  - worker: "hlada-staging"
    connected: null
    repository: ""
    branch: ""
    build_command: ""
    root_directory: ""
  - worker: ""                    # each CPMS Worker

F3_versions:
  hlada_staging:           { version_id: "", deployed_at: "", by: "", source: "", retained: 0 }
  hlada_api_staging:       { version_id: "", deployed_at: "", by: "", source: "", retained: 0 }
  straumvakt_ocpp_staging: { version_id: "", deployed_at: "", by: "", source: "", retained: 0 }

F4_hyperdrive:
  id: "d2d56ab1…"
  target_host_prefix: ""          # ep-XXXX only, never the full string
  database: ""
  matches_neon_staging: null

F5_secret_names:                  # NAMES ONLY
  hlada_staging: []
  hlada_api_staging: []
  straumvakt_ocpp_staging: []
  unexpected_names: []

F6_durable_objects:
  identity_do_namespace_last6: ""
  class_name: ""
  extra_namespaces: []

F7_queues: []                     # [{name, consumer, concurrency, depth, retries}]
F7_dlqs: []                       # [{name, message_count}]

domains:
  hlada_staging:     { custom_domains: [], workers_dev: null, cert_apex: "", cert_www: "" }
  hlada_api_staging: { custom_domains: [], workers_dev: null }
  ocpp_staging:      { custom_domains: [], workers_dev: null }

stop_conditions_triggered: []
notes: ""
```

## Facts closed per session

| Method | Closes | Time |
|---|---|---|
| Read-only token + V1–V7 | F1, F3, F4, F5, F7 | ~10 min |
| Dashboard | **F2**, F6, domains, certificates | ~20 min |
| Both | **all seven** | **~30 min** |
