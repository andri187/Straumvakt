# Release drill — Cloudflare Core

Written for a tired human at 07:00. Nothing here mutates anything until
**Step 9**, which is the only step that deploys. Every step before it is
safe to run, safe to abandon, and safe to repeat.

If you only have five minutes: run Step 1. If it is red, stop — the rest
does not matter yet.

---

## Step 1 · Preflight, local, no network

```
cd E:\Claude\Straumvakt-relops-b
node scripts/analysis/observability/check-observability.mjs --self-test
node scripts/analysis/observability/check-observability.mjs .
node gateway/src/observability.selftest.mjs
node gateway/src/heartbeat-fastpath.selftest.mjs
node scripts/analysis/ocpp/collect-ocpp-cost-profile.mjs --repo . > profile.json   # from beta-production
```

**Expected today:** self-tests green (56 / 69 / 35). The tree check
reports **10 errors, 3 warnings** — all known, all listed in Step 2.

**GO condition:** the *count* has not risen and no new rule id appears.
A new id means something regressed since this document was written.

## Step 2 · The ten known errors, and which block a release

| Gate | Error | Blocks release? |
|---|---|---|
| OB24 | no `version_metadata` in any gateway env | **YES — this is the one** |
| OB15 | same binding, Sentry release id | yes, same fix |
| OB16 | gateway top-level has no queue producer | **YES for a top-level deploy** |
| OB17 | api top-level consumes no OCPP queue | **YES for a top-level deploy** |
| OB14 | Analytics Engine binding commented | no — but you are flying blind |
| OB19 ×5 | env declares neither `routes` nor `workers_dev` | **YES if you are touching routes** |
| OB20 | no R2 bucket top-level | no, unless exports are in scope |
| OB22 | no Cloudflare Access | no |
| OB25 | cap breach logged, not metered | no |

**Staging is deployable today. Top-level is not**, because OB16/OB17
mean a top-level deploy silently runs the whole estate on the
synchronous fallback with no DLQ.

## Step 3 · Read-only Cloudflare session

Requires a token (checklist item B1). None of this changes anything.

```
wrangler whoami                       # confirms account, no secrets
wrangler deployments list --name straumvakt-ocpp-staging
wrangler versions list  --name straumvakt-ocpp-staging
```

API equivalents, if the token is API-scoped rather than OAuth:

| Check | Call |
|---|---|
| Versions retained | `GET /accounts/{a}/workers/scripts/{name}/versions` |
| Currently serving | `GET /accounts/{a}/workers/deployments` |
| Bindings **as deployed** | `GET /accounts/{a}/workers/scripts/{name}/settings` |
| Routes | `GET /zones/{z}/workers/routes` |
| Custom domains | `GET /accounts/{a}/workers/domains` |
| DO namespaces | `GET /accounts/{a}/workers/durable_objects/namespaces` |
| Secret **names** | `GET /accounts/{a}/workers/scripts/{name}/secrets` |
| Queues + DLQ depth | dashboard → Queues |
| R2 buckets + public flag | `GET /accounts/{a}/r2/buckets` |

> **Never run** `GET /accounts/{a}/workers/scripts/{name}` — it returns
> the Worker source bundle, not metadata, and would pull production JS
> into your evidence pack.
>
> **Never store the raw `/secrets` response.** The `secret_key` variant
> carries `key_base64` and `key_jwk`. Record **names and types only**.

## Step 4 · Bindings that must be present

| Binding | Worker | Env | Today |
|---|---|---|---|
| `IDENTITY_DO` | `straumvakt-ocpp*` | both | ✅ declared |
| `MAIN_APP` | `straumvakt-ocpp*` | both | ✅ declared |
| `OCPP_EVENTS_QUEUE` | `straumvakt-ocpp` | **top-level** | ❌ **absent** |
| `OCPP_EVENTS_QUEUE` | `straumvakt-ocpp-staging` | staging | ✅ declared |
| OCPP events consumer + DLQ | `hlada-api` | **top-level** | ❌ **absent** |
| OCPP events consumer + DLQ | `hlada-api-staging` | staging | ✅ declared |
| `OCPP_METRICS` | gateway | both | ❌ commented |
| `CF_VERSION_METADATA` | gateway | both | ❌ commented |
| `EVIDENCE_BUCKET` | `hlada-api-staging` | staging only | ⚠️ |

Secret **names** (never values): `OCPP_INGEST_SECRET`, `SENTRY_DSN`
(absent), `AUTH_SECRET`, `DATABASE_URL`.

## Step 5 · Domain and pinned-host check

The shipped Flutter client pins
`hlada-api-staging.straumvakt.workers.dev` at
`apps/mobile/lib/api/client.dart:25` **with no runtime override**.

- If that host stops resolving, recovery is **server-side only** — a
  client fix costs an app-store release.
- Five environments declare neither `routes` nor `workers_dev` (OB19).
  Adding a route to any of them infers `workers_dev: false` and removes
  the `.workers.dev` host.
- **Therefore: do not add a route in the same deploy as anything else.**
  Declare `workers_dev: true` explicitly first, deploy, verify the host
  still answers, and only then touch routes.

Chargers reach the gateway by a URL configured **on the device**.
Losing that host is worse than losing the app host, because recovery
means physically reconfiguring chargers.

## Step 6 · Capture the version id

This is the step that does not exist yet and is the reason nothing can
be rolled back.

1. Uncomment `version_metadata` in `gateway/wrangler.jsonc`.
2. Deploy **staging** (Step 9).
3. `wrangler versions list --name straumvakt-ocpp-staging`
4. **Write the version id down** — in the release record, not in a
   terminal buffer.

**Until a version id is recorded, every release is a one-way door.**

## Step 7 · Rollback capture, before you need it

Record, in the release record:

- previous version id (Step 6)
- previous config: bindings, routes, `workers_dev` per environment
- Neon branch id and PITR window (7 days, believed)
- queue names and DLQ names
- the exact rollback command:
  `wrangler rollback --name <worker> --version-id <previous>`

A rollback plan written after an incident is a guess.

## Step 8 · Sentry and Analytics pre-checks

- Sentry project exists; DSN held as a **secret**, never printed.
  Verify by name only: `wrangler secret list --name <worker>`.
- **Do not set a production DSN** until a real staging payload
  containing an idTag is confirmed scrubbed in the Sentry UI (M-8). An
  unscrubbed event is a personal-data export and cannot be un-sent.
- Analytics Engine: confirm the binding appears in the deployed
  settings, then confirm data points actually arrive. A binding is not
  data.
- Queue backlog and DLQ depth: both should be **0** before you deploy.
  A non-empty DLQ before a release means you are stacking an unknown on
  an unknown.

## Step 9 · The deploy (the only mutating step)

```
cd gateway
npm run deploy:staging      # straumvakt-ocpp-staging
```

Top-level `npm run deploy` is **NO-GO today** — see OB16/OB17.

Immediately after:

1. `wrangler versions list` → record the new id.
2. Confirm a charger reconnects and gets a CallResult.
3. Confirm `posted_fallback` does **not** appear in the logs. If it
   does, the queue binding did not take effect and you are on the
   synchronous path.
4. Watch DLQ depth for 15 minutes.

## Step 10 · What GO and NO-GO mean

**GO** — all of:

- Step 1 shows no new rule ids
- a version id for the *previous* deploy is recorded
- the target environment declares its queue producer and consumer + DLQ
- `workers_dev` is explicit, or routes are unchanged
- DLQs empty, backlog zero
- Sentry either off, or on with scrubbing verified on a real payload

**NO-GO** — any of:

- no recorded previous version id *(true today)*
- deploying top-level *(true today — OB16/OB17)*
- a route change bundled with any other change
- a non-empty DLQ
- a production Sentry DSN without a verified scrub
- a new gate id since this document

**Today's verdict: NO-GO for top-level. Staging GO, conditional on
Step 6 being done first so the next release has something to roll back
to.**

## Step 11 · Google Maps key note (DSO POC)

If the DSO proof-of-concept ships in the same window: the Maps
JavaScript key must be **HTTP-referrer restricted** to the exact
production origin, and the key belongs in the deploy config, not in the
bundle. A referrer-unrestricted browser key is world-usable and bills
to this account. Not otherwise in scope for this drill.
