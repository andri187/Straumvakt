# Dashboard verification kit

**An operator session, not an automation.** Every step is **read-only**. Nothing
in this kit changes state; if a page offers a Save button, it is not used.

Purpose: close the nine `UNK` facts in the
[evidence ledger](2026-08-09-release-evidence-ledger.md). Expect **20–30 minutes**.

## Rules for the operator

1. **Read only.** Do not click Save, Deploy, Rollback, Delete, Connect or Disconnect.
2. **Never transcribe a secret value.** Names only. If a value is visible, do not
   copy it, and do not screenshot that region.
3. **Record verbatim.** Not "looks right" — the actual string.
4. **If a field is absent, write `ABSENT`.** Do not leave it blank; blank is
   ambiguous and will be read as "not checked".
5. **Stop conditions are hard.** If one triggers, stop and report before continuing.

---

# A · Cloudflare

## A1 · Account and zone identity

| Field | Where | Expected | Contradiction → risk | Stop? |
|---|---|---|---|---|
| Account name + id | top-right account switcher | one account | **two accounts** → the Worker you inspect may not be the one serving traffic | — |
| Zone `straumvakt.org` present | Websites list | present, active | absent → domains are managed elsewhere | **STOP** |
| Zone plan | zone Overview | any | — | — |
| Is CPMS in the **same** account? | Workers list contains CPMS Workers | — | same account → name collision is real and immediate | — |

## A2 · Workers list

Record **every** Worker, not only the expected ones.

| Expected | Expected state | Contradiction → risk |
|---|---|---|
| `hlada-staging` | present | absent → something else serves the brand domain |
| `hlada-api-staging` | present | absent → the API is served by another name |
| `straumvakt-ocpp-staging` | present | absent → contradicts the live 404 evidence |
| `hlada` | **absent** | present → a production Worker exists and is unrouted |
| `hlada-api` | **absent** | present → same |
| `straumvakt-ocpp` | **absent** | present → **do not create it; inspect first** |
| `straumvakt-web` / `straumvakt-api` | **absent** | present → the proposed names are taken |
| *(any CPMS Worker)* | — | **list them all** |

## A3 · Deployed versions — closes **U3**

For each of the three live Workers → **Deployments** tab:

| Field | Record | Why it matters |
|---|---|---|
| Active **version id** | verbatim | **the rollback target. None is recorded anywhere today** |
| Deployed at (UTC) | verbatim | dates the running build |
| Deployed by | verbatim | a person, or an integration |
| Source | "Uploaded" / "GitHub" | distinguishes manual from automatic |
| Count of retained versions | number | Cloudflare retains ~100; fewer limits rollback reach |

**Stop condition:** if fewer than two versions exist for a Worker, there is
effectively **no rollback target** — record it as a release blocker.

## A4 · Build / Git integration — closes **U1 and U2**, the highest-value fields

`hlada-staging` → **Settings → Build**:

| Field | Expected | Contradiction → risk | Stop? |
|---|---|---|---|
| Git integration | *unknown* | — | — |
| **Repository** | `andri187/Straumvakt` | **`andri187/CPMS`** → a dormant repo can overwrite the brand domain | **STOP — incident** |
| **Branch** | `staging` | any other → a different ref deploys production traffic | **STOP** |
| Build command | — | record verbatim | — |
| Root directory | — | record verbatim | — |
| Deploy command | — | note whether it passes `--env staging` | — |

**Then repeat A4 for every CPMS Worker found in A2.** This is the single most
important page in the kit: it decides whether a second repository holds deploy
rights to the Worker serving `straumvakt.org`.

## A5 · Routes and Custom Domains — closes **U5**

`hlada-staging` → **Settings → Domains & Routes**:

| Field | Expected | Contradiction → risk |
|---|---|---|
| `straumvakt.org` | Custom Domain, active | absent → something else serves it |
| `www.straumvakt.org` | Custom Domain, active | absent → the `www` 200 comes from elsewhere |
| Certificate status per domain | active | **record apex and www separately** — the SAN shows they differ |
| workers.dev | enabled | disabled → the workers.dev 200 is impossible; re-examine |
| Wildcard/other routes | none expected | any → an undocumented route pattern exists |

`hlada-api-staging` → same page: expect `api.straumvakt.org` + workers.dev
enabled (**the shipped mobile app depends on the latter**).

> **U5 cannot be answered by looking.** Whether a deploy omitting `routes`
> detaches a live domain is behavioural. **Do not test it on the brand domain.**
> Test on a throwaway Worker + throwaway hostname, or ask Cloudflare support.
> Until then it stays UNK and remains a stop condition on any deploy.

## A6 · Bindings and secret names — closes **U7**

Per Worker → **Settings → Variables and Secrets** and **Bindings**:

| Record | Do **not** record |
|---|---|
| Variable **names** | any variable **value** |
| Secret **names** | any secret **value** |
| Binding names + target resource names | — |

Expected on `hlada-api-staging`: `AUTH_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`,
`OCPP_INGEST_SECRET`, `OCPP_CRED_KEK`; bindings `HYPERDRIVE_DB`, `OCPP_GATEWAY`,
`OUTBOUND_QUEUE`, `ARCHIVE_QUEUE`, `EVIDENCE_BUCKET`, two rate limiters.

**Contradiction to look for:** `DATABASE_URL` / `DIRECT_URL` set on the **web**
Worker. Source says its `src/` has no database client, so those would be stale —
note them, do not delete them.

## A7 · Hyperdrive — closes **U4**

Hyperdrive → configuration `d2d56ab1ffe241bbb64946ba78a52be5`:

| Field | Expected | Contradiction → risk | Stop? |
|---|---|---|---|
| Configuration name | — | record | — |
| **Target host** | an `ep-quiet-bird-abxartp8…` endpoint (Neon **staging**) | an `ep-cold-waterfall…` endpoint → **pointed at the abandoned `production` branch** | **STOP** |
| Database name | — | record | — |
| Caching enabled | — | record | — |

Record the **host prefix only**. Never the full connection string.

## A8 · Durable Objects, queues, R2

| Page | Record |
|---|---|
| Workers → `straumvakt-ocpp-staging` → Settings → Bindings | `IDENTITY_DO` namespace id + class |
| Queues | all queue names, consumer Worker, concurrency, **current depth**, retries |
| Queues → each DLQ | **current message count — non-zero is a finding** |
| R2 | `straumvakt-evidence-staging` present; object count/size if shown; lifecycle rules |

## A9 · Compatibility and limits

Per Worker → Settings: compatibility date, compatibility flags, CPU limit,
observability enabled, log retention.

Expected from source: date `2026-04-18`, flags `nodejs_compat` +
`global_fetch_strictly_public`, web `cpu_ms: 50`.
**Contradiction:** a deployed compatibility date *newer* than source means the
running Worker was deployed from a different tree.

---

# B · Neon (read-only)

| # | Where | Record | Stop condition |
|---|---|---|---|
| B1 | Project list | project name + id | more than one Straumvakt project already exists |
| B2 | Branches | name, id, **default flag**, **protected flag**, size | `production` still default **and** unprotected — expected, confirm |
| B3 | `staging` branch | compute endpoint id, state | endpoint differs from the Hyperdrive target in A7 → **STOP** |
| B4 | Roles | role **names** only | an unexpected role exists |
| B5 | Connection pooling | pooled/unpooled per compute | — |
| B6 | Backups/history retention | retention window | shorter than the intended rollback window |

**No SQL. No connection.** Metadata pages only.

---

# C · GitHub (read-only)

Already established via public API on 2026-08-09T11:31Z — re-confirm only if acting later.

| Field | Observed | Note |
|---|---|---|
| Default branch | `dev/sprint-00-foundation` | stale placeholder |
| Protected branches | **0 of 16** | — |
| Rulesets | `[]` | — |
| Visibility | **public** | raises the cost of every other gap |

| # | Additional page | Record |
|---|---|---|
| C1 | Settings → Environments | any environment; its reviewers and branch rules |
| C2 | Settings → Secrets and variables → Actions | secret **names** only |
| C3 | Settings → Webhooks | any Cloudflare webhook — corroborates A4 |
| C4 | Actions → latest runs | `check` status on the RC lineage |

**C3 is a useful cross-check:** an active Cloudflare webhook on this repository
is independent evidence for U1, visible without Cloudflare access.

---

# D · Evidence form

Paste-back template. **Contains no field that could hold a secret value.**

```yaml
# Straumvakt control-plane verification
# Operator:            ____________________
# Date (UTC):          ____________________
# Rule: names only, never values.

cloudflare:
  account_name:            ""
  account_id_last6:        ""      # last 6 chars only
  zone_straumvakt_org:     ""      # present | absent
  cpms_workers_in_account: []      # names, or [] if none

  workers_present:         []      # every Worker name seen
  workers_absent_expected: []      # of: hlada, hlada-api, straumvakt-ocpp,
                                   #     straumvakt-web, straumvakt-api

  deployments:
    hlada_staging:           { version_id: "", deployed_at: "", source: "", versions_retained: 0 }
    hlada_api_staging:       { version_id: "", deployed_at: "", source: "", versions_retained: 0 }
    straumvakt_ocpp_staging: { version_id: "", deployed_at: "", source: "", versions_retained: 0 }

  git_integration:
    hlada_staging:  { connected: null, repository: "", branch: "", build_command: "", root_dir: "" }
    cpms_workers:   []             # [{worker: "", connected: null, repository: "", branch: ""}]

  domains:
    hlada_staging:     { custom_domains: [], workers_dev: null, cert_status_apex: "", cert_status_www: "" }
    hlada_api_staging: { custom_domains: [], workers_dev: null }

  bindings_and_secret_names:
    hlada_staging:           { secrets: [], bindings: [] }
    hlada_api_staging:       { secrets: [], bindings: [] }
    straumvakt_ocpp_staging: { secrets: [], bindings: [] }

  hyperdrive:
    d2d56ab1: { name: "", target_host_prefix: "", database: "", caching: null }

  queues:      []                  # [{name: "", consumer: "", depth: 0, dlq_depth: 0}]
  r2_buckets:  []
  durable_objects: { identity_do_namespace_id_last6: "", class_name: "" }

  compatibility:
    hlada_staging:     { date: "", flags: [], cpu_ms: 0 }
    hlada_api_staging: { date: "", flags: [] }

neon:
  project_name: ""
  branches: []                     # [{name: "", id: "", default: null, protected: null}]
  staging_compute_endpoint: ""
  role_names: []
  history_retention_days: 0

github:
  environments: []
  actions_secret_names: []
  webhooks: []                     # look for a Cloudflare webhook
  check_status_on_rc: ""

stop_conditions_triggered: []      # e.g. ["A4: repository is andri187/CPMS"]
notes: ""
```

---

# E · Facts closed by this session

| Ledger | Closed by | Consequence if the contradiction appears |
|---|---|---|
| **U1** integration owner | A4 | CPMS → **incident**, release halts |
| **U2** CPMS integrations | A4 (repeat) | any live → disconnect before anything else |
| **U3** version ids | A3 | fewer than 2 versions → no rollback target |
| **U4** Hyperdrive target | A7 + B3 | wrong branch → **STOP**, do not deploy |
| **U5** route-omission behaviour | *not closable by looking* | remains a stop condition |
| **U6** account identity | A1 | two accounts → re-verify every other finding |
| **U7** secret names | A6 | mismatch → production parity list is wrong |
| **U8** `www` certificate | A5 | separate certs → cutover moves two attachments |
| **U9** `*.api` wildcard reuse | A5 | not attachable → beta API needs fresh issuance |

**Seven of nine close in one sitting.** U5 needs an experiment on throwaway
resources; U9 may need Cloudflare support. Neither is a reason to defer the rest.
