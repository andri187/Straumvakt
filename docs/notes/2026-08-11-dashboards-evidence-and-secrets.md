# Dashboards, evidence capture, and secret handling

Three things that all share one rule: **an artifact that leaves this
machine must never carry a secret value.**

---

## Part 1 · Dashboard specification

Four panels. Deliberately few — a dashboard nobody reads on a normal
day is not a dashboard, it is a screenshot.

### Panel A · Fast-path health (the one that matters)

```
heartbeats_suppressed / heartbeats_received      target ≈ 1.0
```

Baseline **≈ 1.0**: nearly every heartbeat should be suppressed, since
a transition or a rollup flush is rare. If this ratio falls, cost has
silently returned to the pre-fix baseline and **nothing else in the
system notices**. This single line is the production proof of the whole
heartbeat lane.

Alert when < 0.9 for 1 hour.

| Series | Source | Baseline |
|---|---|---|
| `heartbeats_received` | AE | 720/connector/month |
| `heartbeats_suppressed` | AE | received − transitions |
| ratio | derived | ≈ 1.0 |

### Panel B · Cost drivers

| Series | Baseline | Trouble |
|---|---|---|
| `queue_messages_by_type` | heartbeat share ≈ 0 | any heartbeat share = OC1 regression |
| frames/connector/hour | ≈ 1 idle | > 120 = cap breach |
| `noisy_charger_events` | 0 | any |
| DO invocations vs socket count | flat | rising while sockets flat = hibernation regressed |
| Neon rows/day by table | tracks sessions | tracks frames = raw persistence leaked back |

### Panel C · Liveness and errors

| Series | Baseline |
|---|---|
| `missed_heartbeats` | 0 |
| connected charger count | **not exposed today** — blocks the rollback drill |
| `gateway_errors_by_type` | 0; any `parse_error` class is new protocol reality |
| queue backlog age | seconds |
| DLQ depth | **0** |

### Panel D · Release and billing

| Series | Note |
|---|---|
| deployed version id vs release record | mismatch = A12 |
| `billing_job_started / completed / failed` | started must equal completed |
| statement generation duration | trend, not threshold |

### Cardinality discipline

Analytics Engine **indexes** are sampled and grouped; blobs are not.
The writer indexes on the **metric name only** — nine values, forever.
Charger identity rides in a blob, pseudonymised. Do not add an index on
identity: cardinality would become a function of fleet size, which is
the one thing that must not scale with customers.

---

## Part 2 · No-secrets evidence capture template

Use this verbatim for a read-only Cloudflare session. Fill the right
column; **never paste a raw API response.**

```
# Cloudflare read-only evidence — <date> <operator>
# Session is READ ONLY. No POST/PUT/PATCH/DELETE. No deploy.

account_name:            ____________________
account_id:              <recorded separately, not in this file>

## Workers
worker: straumvakt-ocpp
  versions_retained:     ____
  serving_version_id:    ____________________
  bindings_present:      [ ] IDENTITY_DO  [ ] MAIN_APP  [ ] OCPP_EVENTS_QUEUE
                         [ ] OCPP_METRICS [ ] CF_VERSION_METADATA
  routes:                ____________________
  workers_dev:           [ ] on  [ ] off  [ ] not shown
  secret_NAMES_only:     ____________________     # names, never values

worker: straumvakt-ocpp-staging      (repeat block)
worker: hlada-api / hlada-api-staging (repeat block)

## Queues
  queue:                 ____________________  backlog: ____  DLQ depth: ____

## R2
  buckets:               ____________________  public flag: [ ] private

## Neon
  project / branch:      ____________________
  protected:             [ ] yes [ ] no
  PITR window:           ____ days
  require_mfa:           [ ] yes [ ] no

## Verdict
  GO / NO-GO:            ____________________
  blocking items:        ____________________
```

**Forbidden in any evidence artifact**

| Never | Why |
|---|---|
| `GET /accounts/{a}/workers/scripts/{name}` | returns the Worker **source bundle**, not metadata |
| Raw `/secrets` response | the `secret_key` variant carries `key_base64` and `key_jwk` |
| Any DSN, connection string, token, or `Authorization` header | credential |
| Screenshots of a secrets page | same, and harder to redact later |
| Account id in a shared doc | not a secret, but not needed either — record it once, separately |

**Allowed**: names, counts, booleans, version ids, queue depths,
timestamps, verdicts.

---

## Part 3 · Security note — keys, DSNs, tokens, OAuth state

### Google Maps key (DSO POC)

A browser Maps key is **world-readable by design** — it ships in the
page. The only control is **HTTP-referrer restriction**, and it must be
set to the exact production origin before the key is ever used in a
deployed page. An unrestricted key is usable by anyone who views source
and bills to this account. Additionally: restrict by API (Maps
JavaScript only), and keep it out of the repo — it belongs in deploy
config.

### Sentry DSN

A DSN is a credential-shaped URL: whoever holds it can forge events
into the project. Consequences: **never a `vars` entry**, always
`wrangler secret put`; never committed (gate OB12); never echoed into a
config object even when malformed, which is why `sentryConfigFrom`
returns a `reason` rather than the rejected value.

Separate DSNs per environment. A staging DSN in production makes every
release regression invisible.

### Cloudflare API tokens

Prefer a **read-only token** for verification sessions, scoped to the
account, with an expiry. The distinction matters more than usual here
because column A of the launch checklist is entirely read-only work
that has been blocked on not having *any* token — and the temptation is
to reach for an existing write-capable one.

### wrangler OAuth state — checked this run

`wrangler whoami` succeeds on this machine. The session is an **OAuth
token for `andrith187@gmail.com`** with a broad scope set that includes
**write and admin** grants (queues, secrets_store, containers,
connectivity admin, and others). No token value was read or printed.

Three consequences worth stating plainly:

1. **Any process that can run `wrangler` on this machine can deploy.**
   That includes an agent with shell access. The operating rules for
   these runs forbid it; the credential does not.
2. `~/.wrangler/config/default.toml` is a credential file on a
   developer workstation with no additional protection.
3. If this machine is ever shared, imaged, or backed up to an
   unencrypted location, that OAuth state travels with it.

**Recommendation:** `wrangler logout` when not actively deploying, and
use a scoped read-only API token for verification work. This is a
posture note, not an incident — nothing indicates misuse.

### AUTH_SECRET

A real `AUTH_SECRET` from this project **is already public in git
history**. It must be **rotated, not reused**, and production secrets
must be new values rather than copies of staging. The habit of reuse is
not hypothetical here — it has already happened once.
