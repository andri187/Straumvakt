# Appendix L — Cloudflare read-only evidence session (fillable)

**36 capture fields.** Every API path below was verified against Cloudflare's own
documentation or SDK during this run, not recalled. Fields marked
`none - UI only` have no REST equivalent and force a dashboard visit.

Print this, or copy it into the evidence directory and fill the **Captured**
column. Target: **30 minutes**.

---

## Before you log in

**Evidence directory** — outside `E:\Claude`, because that tree is a cleanup
target: `C:\Users\Andri\Documents\cloudflare-evidence-2026-08-09\`

**Token** — one custom token, Read permissions only, scoped to the Straumvakt
account, 7-day TTL. Ten permissions: Workers Scripts:Read, Workers KV:Read,
Workers Tail:Read, Workers R2:Read, Account Settings:Read, D1:Read,
Hyperdrive:Read, Zone:Read, DNS:Read, SSL and Certificates:Read.

```bash
export CF="<token>"            # session only — never persist to the profile
export ACC="<32-hex account id>"
export ZONE="<zone id>"
CFH=(-H "Authorization: Bearer $CF")
```

### The single most dangerous field in this appendix

> **`GET /accounts/{account_id}/workers/scripts/{script_name}` does NOT return
> metadata. It downloads the Worker's raw source bundle.**
>
> It reads like a harmless per-script metadata call and it is not. Running it
> pulls the entire production JavaScript bundle into the evidence pack, and a
> bundle can contain inlined configuration. **Never run it.** Per-script metadata
> comes from `/settings` and `/script-settings`; the version list comes from
> `/versions`.

### Never capture

- Any secret **value**. Names and types only. Never click a reveal control.
- Any connection string, DSN, or Hyperdrive password. The API does not return the
  Hyperdrive password — that is correct behaviour, not an obstacle to route around.
- Any queue **message body** or R2 **object key** — both can carry customer data.
- Any Worker source. See the box above.
- Any `newValue` field from the audit log.

### Stop conditions

Stop, record, and do not proceed to the next field if:

1. A Worker appears that this project did not create.
2. A **production-named** Worker exists (all production names currently return
   error 1042, which is consistent with "not deployed" but does not prove
   "does not exist" — L-19 settles it).
3. A Worker's Git integration points at **`andri187/CPMS`** or any repository
   nobody recognises — that is an incident, not a finding.
4. More than one account is returned by a token that should be account-scoped.
5. Any dead-letter queue is non-empty.
6. Any secret **value** becomes visible on screen — close the page, do not
   transcribe, and note that it happened.

---

## Part 1 — Identity and access (L-01 … L-04)

| # | Fact | Where | Read-only API / CLI | Expected | Dangerous | Shot | **Captured** |
|---|---|---|---|---|---|---|---|
| **L-01** | Token is live and read-only | — | `curl "${CFH[@]}" .../user/tokens/verify` | `status: active`, `expires_on` ≤ 7 days | Not active, or no expiry | — | ☐ |
| **L-02** | Token cannot write | — | `curl -X PUT "${CFH[@]}" .../workers/scripts/hlada-staging` → expect **403** | HTTP 403, auth-class error | **400** — the request was accepted for processing; that is not proof of read-only. Revoke and reissue. | — | ☐ |
| **L-03** | Account id | Zone → Overview → right sidebar **API** panel; or the `dash.cloudflare.com/<account_id>` URL segment | `GET /accounts` · `wrangler whoami` | Exactly one account; 32-hex id matching the one pinned in wrangler config | More than one account for a scoped token | req | ☐ |
| **L-04** | Zone id for `straumvakt.org` | Domain → Overview → right sidebar **API** panel | `GET /zones?name=straumvakt.org` | One zone, `status: active`, `account.id` = L-03 | Zero results, or status not active | opt | ☐ |

## Part 2 — The estate (L-05 … L-08)

| # | Fact | Where | Read-only API / CLI | Expected | Dangerous | Shot | **Captured** |
|---|---|---|---|---|---|---|---|
| **L-05** | Worker inventory | Compute (Workers & Pages) → Overview | `GET /accounts/$ACC/workers/scripts` — **wrangler has no account-wide list command** | `hlada-staging`, `hlada-api-staging`, `straumvakt-ocpp-staging`, plus whatever else | Any unrecognised name — stop condition 1 | opt | ☐ |
| **L-06** | Per-Worker `created_on` / `modified_on` | same list | same call | Modification dates consistent with known releases | A Worker modified outside any known change window | — | ☐ |
| **L-07** | **CPMS Workers in the same account?** | Overview → scan every name | `GET /accounts/$ACC/workers/scripts` | The collision is believed to be name-level only | CPMS-owned Workers alongside Straumvakt's — re-scope every other finding | req | ☐ |
| **L-08** | Production names present or absent | Overview → search each production name | same call | **Absent** | Present — something deployed under a production name and nobody here did it | req | ☐ |

## Part 3 — Versions and rollback targets (L-09 … L-12)

> This is the block that closes blocked fact **F3**. No Worker version id has ever
> been recorded, which is why release-manifest rule R1 rejects every release: a
> release with no recorded prior version has no rollback target.

| # | Fact | Where | Read-only API / CLI | Expected | Dangerous | Shot | **Captured** |
|---|---|---|---|---|---|---|---|
| **L-09** | Version list — `hlada-staging` | Worker → Deployments → Versions | `GET .../workers/scripts/hlada-staging/versions` · `wrangler versions list --name hlada-staging` | **≥2 versions retained** | Exactly 1 — no rollback target exists at all | opt | ☐ |
| **L-10** | Version list — `hlada-api-staging` | same | same, name substituted | ≥2 | 1 | opt | ☐ |
| **L-11** | Version list — `straumvakt-ocpp-staging` | same | same, name substituted | ≥2 | 1 — and this one terminates charger WebSockets | opt | ☐ |
| **L-12** | **Actively serving version, per Worker** | Worker → Deployments (top entry is live) | `GET .../deployments` — *"The first deployment in the list is the latest deployment actively serving traffic."* · `wrangler deployments status` | One version at **100%** | A gradual rollout still open (two versions sharing traffic) when a full rollout was believed complete — a rollback during a rollout is a different operation | req | ☐ |

> **Do not expect author or message from the deployments endpoint.** Each entry of
> `versions[]` carries exactly two fields: `percentage` and `version_id`.
> Annotations (`workers/message`, `workers/triggered_by`) and `author_email` come
> from the **versions** endpoint (L-09…L-11), not from `/deployments`. A capture
> plan that expects provenance from `/deployments` returns blanks.

## Part 4 — Configuration as deployed (L-13 … L-18)

| # | Fact | Where | Read-only API / CLI | Expected | Dangerous | Shot | **Captured** |
|---|---|---|---|---|---|---|---|
| **L-13** | Bindings, compatibility date, placement | Worker → Settings → Bindings / Runtime | `GET .../workers/scripts/{name}/settings` — *"Get metadata and config, such as bindings or usage model."* | Identical to the committed wrangler config for that environment | A binding pointing at another environment's resource (staging KV/R2/Hyperdrive bound into production); a binding present here and absent from committed config; a silently rolled-back compatibility date | req | ☐ |
| **L-14** | Logpush, tail consumers, observability | Worker → Settings → Observability | `GET .../workers/scripts/{name}/script-settings` — **a different endpoint from L-13** | Observability enabled on anything production-facing | Disabled (no forensic trail); a tail consumer routing logs into an unexpected script | opt | ☐ |
| **L-15** | **Secret names** | Worker → Settings → Variables and Secrets (values hidden) | `GET .../workers/scripts/{name}/secrets` — capture `name` and `type` ONLY, and **never store the raw response**: the documented schema has a `secret_key` variant carrying `key_base64` and `key_jwk`, so a Worker with any such binding would put key material in the evidence pack · `wrangler secret list --name <w> --format json` | API: `AUTH_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `OCPP_INGEST_SECRET`, `OCPP_CRED_KEK` | `DATABASE_URL`/`DIRECT_URL` on the **web** Worker → stale, its `src/` has no DB client. Any captured "name" containing `=`, `:`, `/` or over 40 chars is a **value** — discard and redo. | opt | ☐ |
| **L-16** | Plaintext variable names **and** values | same page, Variables section | same as L-13 | Ordinary configuration | A credential stored as a plaintext var — redact, report, rotate | opt | ☐ |
| **L-17** | Durable Object namespaces | Workers → Durable Objects; and Worker → Settings → Bindings | `GET /accounts/$ACC/workers/durable_objects/namespaces` | `IDENTITY_DO`, class `IdentityDurableObject`, one namespace | **More than one namespace** — an orphan from an earlier deploy; binding the wrong one loses every charger's identity silently | req | ☐ |
| **L-18** | Namespace shared with another Worker? | same | same | Owned by the gateway only | Shared — a rename or delete of the other script orphans charger identity | — | ☐ |

## Part 5 — Routing and hostnames (L-19 … L-24)

> This block closes the **workers.dev** question. The linter reports **5 L2
> warnings** across the three configs: `hlada` (top level), `hlada-api` (top
> level), `hlada-api-staging`, `straumvakt-ocpp` (top level),
> `straumvakt-ocpp-staging` — each declaring neither `routes` nor `workers_dev`,
> so the live state is **inferred, not declared**, and only observable here.

| # | Fact | Where | Read-only API / CLI | Expected | Dangerous | Shot | **Captured** |
|---|---|---|---|---|---|---|---|
| **L-19** | workers.dev state — **API Worker** | Worker → Settings → Domains & Routes → the `workers.dev` row | **none - UI only** | Enabled — the shipped mobile app pins this host | Disabled → every installed app has already lost API access | **req** | ☐ |
| **L-20** | workers.dev state — **gateway** | same | **none - UI only** | Enabled | Disabled → the charger fleet. Chargers do not reconnect to a host that stops resolving; reconfiguring them is a field or vendor-portal operation. | **req** | ☐ |
| **L-21** | workers.dev state — web Worker | same | **none - UI only** | Enabled (`wrangler.jsonc:67` declares `workers_dev: true` in `env.staging`) | Disabled despite the declaration → config and reality disagree | req | ☐ |
| **L-22** | Account workers.dev subdomain | Workers & Pages → Subdomain | **none - UI only** | Matches the host pinned at `apps/mobile/lib/api/client.dart:25` | A mismatch. **Never change this** — it is irreversible in practice and breaks every pinned host at once. | req | ☐ |
| **L-23** | Worker routes on the zone | Worker → Settings → Domains & Routes | `GET /zones/$ZONE/workers/routes` | Either explicit patterns or an empty list — **record an empty list as a finding, not an omission** | A wildcard nobody expected. A wildcard covers exactly one subdomain level. | opt | ☐ |
| **L-24** | Worker custom domains | same | `GET /accounts/$ACC/workers/domains` | `api.straumvakt.org` present, `status: active` | Absent or pending → the web→API path's only dependency is not in place, and it is the one Worker-to-Worker path that uses plain HTTPS | req | ☐ |

## Part 6 — DNS and certificates (L-25 … L-27)

| # | Fact | Where | Read-only API / CLI | Expected | Dangerous | Shot | **Captured** |
|---|---|---|---|---|---|---|---|
| **L-25** | Zone DNS records | Zone → DNS → Records | `GET /zones/$ZONE/dns_records?per_page=100` | API and dashboard counts match; every project hostname present or explicitly absent | A record pointing somewhere unrecognised; a count mismatch between the two views | req | ☐ |
| **L-26** | Edge certificate SAN list | Zone → SSL/TLS → Edge Certificates | **none - UI only** for the rendered host list | `www.straumvakt.org` is **known absent** from the apex SAN — confirm still true | A production hostname uncovered; expiry within 30 days | req | ☐ |
| **L-27** | Certificate issuer and type | same | same | Universal or Advanced, consistent across hosts | A hostname served by a certificate nobody ordered | opt | ☐ |

## Part 7 — Data plane (L-28 … L-32)

| # | Fact | Where | Read-only API / CLI | Expected | Dangerous | Shot | **Captured** |
|---|---|---|---|---|---|---|---|
| **L-28** | Hyperdrive config and **origin host** | Workers → Hyperdrive → config `d2d56ab1ffe241bbb64946ba78a52be5` | `GET /accounts/$ACC/hyperdrive/configs` · `wrangler hyperdrive list` | Origin `ep-quiet-bird-abxartp8…` (Neon **staging**) | `ep-cold-waterfall…` → pointed at the **abandoned** branch. Correct code, correct queries, wrong database — the most invisible possible data bug. **Do not deploy.** | req | ☐ |
| **L-29** | Hyperdrive caching mode | same | same | As committed | Caching enabled where freshness is assumed | — | ☐ |
| **L-30** | Queue topology | Workers → Queues | `GET /accounts/$ACC/queues` · `wrangler queues list` | **Six queues + three DLQs** | A producer with no consumer — work accepted and dropped | opt | ☐ |
| **L-31** | **Queue and DLQ depths, with a timestamp** | Workers → Queues → each queue | **none - UI only** for live depth · `wrangler queues info <name>` | Depths ≈0, **DLQs empty** | Any non-zero DLQ → an unnoticed processing failure, and a production no-go input. **Never purge.** | **req** | ☐ |
| **L-32** | R2 buckets and public access | R2 → Overview | `GET /accounts/$ACC/r2/buckets` | Private buckets only | Any public bucket; a bucket bound to a Worker but absent from committed config | opt | ☐ |

## Part 8 — Governance (L-33 … L-36)

| # | Fact | Where | Read-only API / CLI | Expected | Dangerous | Shot | **Captured** |
|---|---|---|---|---|---|---|---|
| **L-33** | **Git integration / build owner, per Worker** | Compute → Worker → Settings → **Build** → Git Repository | **`GET /accounts/{acc}/builds/workers/{script}/triggers`** — the Workers Builds API DOES expose this (corrected 2026-08-09). GETs only; the same resource has mutating siblings | `andri187/Straumvakt`, branch `staging` | **`andri187/CPMS`** → a dormant private repo can overwrite the brand domain. **Halt the release.** | **req** | ☐ |
| **L-34** | Git App installation scope | Worker → Settings → Builds → Git Repository → **Manage** | **none - UI only** | Installation grants access to the expected org and repos only | Access to repositories outside the project | opt | ☐ |
| **L-35** | Account members and roles | Manage Account → Members | **none - UI only** | A short list; every Administrator expected | An unrecognised member; an Administrator without two-factor | req | ☐ |
| **L-36** | Audit log, last 30 days | Manage Account → Audit Log | **none - UI only** | Every deploy and DNS change attributable to a named actor | An unattributable deploy — that is the CPMS collision made visible | req | ☐ |

**Never click, on any of these pages:** Disconnect · Rollback · Delete · Purge ·
Reveal · Change subdomain · Save.

---

## Closing the session

1. Write the **not-inspected list** — every dashboard section not opened. Absence
   of evidence has been mistaken for evidence of absence twice on this project.
2. `Get-FileHash -Algorithm SHA256 *` → `bundle-manifest.txt`.
3. Run the secret scan across the bundle before considering it final.
4. **Delete the token**, then re-run L-01 and expect **401**.
5. Fill `cloudflare-evidence-capture.json` (machine-readable twin of this table)
   and feed the version ids straight into `rollback.workerVersionsBefore`.

## What each field unblocks

| Blocked fact | Closed by | Consequence of leaving it blocked |
|---|---|---|
| **F1** account identity | L-03, L-04, L-07 | Every other finding is scoped to an unverified account |
| **F2** integration owner | **L-33**, L-34 | `origin/staging` must keep being treated as a live production deploy pointer |
| **F3** version ids | L-09 … L-12 | Rule R1 rejects every release: no rollback target |
| **F4** Hyperdrive target | L-28 | Reads and writes may be going to the abandoned branch, silently |
| **F5** secret names | L-15 | The production secret list is guessed |
| **F6** DO namespace ids | L-17, L-18 | A cutover can orphan charger identity |
| **F7** queue depths | L-31 | A cutover strands unprocessed work |
