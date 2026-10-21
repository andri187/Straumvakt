# Worker migration rehearsal — three scenarios

**Command-level rehearsal. Nothing was executed.** Every command below is
written so an operator can read it, understand the failure mode, and run it later
with approval. Mutating commands are marked ⚙️ and require 🔒.

## Preflight — common to all scenarios

```bash
# READ-ONLY. Establishes the ground truth every scenario assumes.
git fetch origin --no-tags
git rev-list --left-right --count origin/staging...origin/<source>   # left MUST be 0

for h in straumvakt.org www.straumvakt.org api.straumvakt.org \
         hlada-staging.straumvakt.workers.dev \
         hlada-api-staging.straumvakt.workers.dev \
         straumvakt-ocpp-staging.straumvakt.workers.dev; do
  printf '%-52s %s %s\n' "$h" \
    "$(curl -s -o /dev/null -w '%{http_code}' "https://$h/")" \
    "$(curl -s "https://$h/" | sha256sum | cut -c1-16)"
done
```

**Plus the dashboard kit.** No scenario begins until version ids, the
Git-integration owner, and the Hyperdrive target are recorded. **A migration
without a captured version id has no rollback target.**

---

# Scenario 1 · Keep beta Worker names indefinitely

Beta keeps `hlada-staging` / `hlada-api-staging`. Production is built on new
names. The legacy names simply never change.

```bash
# ⚙️🔒 additive only — give beta its own address
#   Cloudflare → hlada-staging → Domains & Routes → Add custom domain
#     beta.straumvakt.org
#   Cloudflare → hlada-api-staging → Add custom domain
#     beta.api.straumvakt.org      # possibly covered by the *.api SAN

# read-only verification
curl -sI https://beta.straumvakt.org/ | head -1
echo | openssl s_client -connect beta.straumvakt.org:443 -servername beta.straumvakt.org 2>/dev/null \
  | openssl x509 -noout -dates
```

| | |
|---|---|
| **Risk** | **Lowest.** No rename, no binding change, no client breakage |
| **Value** | Low — the naming confusion (`hlada` means nothing; `staging` means beta) persists |
| **Downtime** | None |
| **Customer impact** | None |
| **Reversibility** | Full — detach a domain |
| **Cost** | A permanent onboarding tax: every new engineer must be told what `hlada` is |

---

# Scenario 2 · Migrate beta web and API names only

Rename beta web and API; **leave OCPP alone**. This is the recommended shape.

## 2a · Web (no inbound service binding — the free one)

```bash
# ⚙️🔒 config change, then deploy under the new name
#   wrangler.jsonc:  env.staging.name  "hlada-staging" → "straumvakt-web-beta"
npx wrangler deploy --env staging          # ⚙️🔒 creates a NEW Worker

# ⚙️🔒 attach beta domain to the new Worker, detach from the old
# read-only parity check BEFORE detaching:
curl -s https://straumvakt-web-beta.straumvakt.workers.dev/ | sha256sum | cut -c1-16
curl -s https://hlada-staging.straumvakt.workers.dev/       | sha256sum | cut -c1-16
#   identical hashes = same build serving = safe to move the domain
```

**Binding parity to verify before the switch:** `ASSETS`, `OCPP_GATEWAY` →
`straumvakt-ocpp-staging`, `HYPERDRIVE_DB`.
**Secret-name parity:** `AUTH_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` — names
compared, values never printed.

## 2b · API (two consumers — the constrained one)

Two things point at the API Worker:

1. the gateway's `MAIN_APP` service binding — **repointable in config**;
2. **the shipped mobile app**, pinning `hlada-api-staging.straumvakt.workers.dev`
   — **not repointable; it is installed on phones**.

```bash
# ⚙️🔒 deploy the API under the new name
npx wrangler deploy --env staging          # from apps/api

# ⚙️🔒 repoint the gateway binding
#   gateway/wrangler.jsonc: env.staging.services[MAIN_APP].service
#     "hlada-api-staging" → "straumvakt-api-beta"
npx wrangler deploy --env staging          # from gateway

# read-only: ingest still works?
curl -s -o /dev/null -w '%{http_code}\n' https://straumvakt-api-beta.straumvakt.workers.dev/api/admin/me
# expect 401 with application/json
```

**The old Worker cannot be deleted.** Its workers.dev hostname must keep serving
until app telemetry shows zero traffic from installed clients. Practically that
means running **both** API Workers for at least one full app-release cycle.

| | |
|---|---|
| **Risk** | Medium — the API move is gated on an external release train |
| **Value** | High — names become self-describing; the CPMS collision is resolved for web and API |
| **Downtime** | None if sequenced; **total for old clients** if the pinned host is retired early |
| **Customer impact** | None if the old host is kept |
| **Reversibility** | Full while both Workers exist |

---

# Scenario 3 · Migrate everything including OCPP

Scenario 2, plus a fleet endpoint campaign.

```bash
# ⚙️🔒 create the new gateway (name is free — DF: error 1042)
#   gateway/wrangler.jsonc: env.staging.name → "straumvakt-ocpp-beta"
npx wrangler deploy --env staging

# THEN, per cohort, per charger, via the vendor portal or physically:
#   OCPP endpoint  wss://straumvakt-ocpp-staging.straumvakt.workers.dev/...
#              →   wss://straumvakt-ocpp-beta.straumvakt.workers.dev/...
# NO COMMAND EXISTS FOR THIS STEP. It is device configuration.
```

| | |
|---|---|
| **Risk** | **Highest.** Every open WebSocket severed; `IDENTITY_DO` state lost; in-flight sessions unstoppable; chargers that fail to reconnect need physical or portal access |
| **Value** | **Marginal** — consistency of naming, nothing functional |
| **Downtime** | Per-charger, unbounded on failure |
| **Customer impact** | Direct: a charger that does not come back is a customer who cannot charge |
| **Reversibility** | **Only while the old gateway is live.** Retire it and recovery becomes a field visit |
| **Prerequisite** | BT-8 must first establish whether remote reconfiguration is even possible |

---

## Comparison

| | S1 keep names | S2 web+API | S3 everything |
|---|---|---|---|
| Risk | ▁ lowest | ▃ medium | █ **highest** |
| Value | ▁ low | █ high | ▃ marginal over S2 |
| Downtime | none | none | per-charger |
| Customer impact | none | none if sequenced | **direct** |
| Reversibility | full | full | partial, time-bounded |
| Blocked on external release | no | **yes** (mobile) | yes |
| Blocked on vendor capability | no | no | **yes** (BT-8) |
| Resolves CPMS collision | ✗ | web + API | fully |

## Recommendation — S2, with the OCPP piece deliberately unfinished

**Adopt Scenario 2. Do not schedule Scenario 3.**

Reasoning, in order of weight:

1. **S3's incremental value over S2 is naming consistency; its incremental risk
   is stranded hardware.** That trade is not close.
2. **The accepted no-backfill decision probably eliminates the need for S3
   entirely.** Real customers onboard fresh in production, so production chargers
   are configured once, correctly, against `straumvakt-ocpp` at onboarding. The
   only chargers on the beta endpoint are beta chargers, which can stay there for
   as long as beta exists.
3. **S2's API half is gated on a mobile release**, so S2 naturally splits: the web
   rename is available immediately, the API rename waits. That is not a delay to
   engineer around — it is the constraint doing its job.
4. **S1 is not wrong**, merely permanently taxed. If engineering time is scarce,
   S1 plus the additive beta domains captures most of the operational benefit for
   almost none of the cost.

### Assumptions this recommendation rests on

| # | Assumption | If false |
|---|---|---|
| A1 | Beta chargers may stay on the beta endpoint indefinitely | S3 returns, on a schedule |
| A2 | Production chargers are configured at onboarding against the production gateway | production inherits the migration problem |
| A3 | A mobile release moving off the pinned host is achievable within a normal cycle | the API rename stalls; S1 for the API |
| A4 | `beta.api.straumvakt.org` is covered by the existing `*.api` wildcard | one extra certificate issuance — minor |
| A5 | CPMS's integration can be disconnected before any rename | ordering changes; disconnect first regardless |

## Post-migration observation and cleanup deferral

| Step | Timing |
|---|---|
| Watch 5xx, latency, ingest lag | 15 min minimum, then 24 h |
| Verify both brand hostnames + TLS **independently** | immediately, then daily for a week |
| Confirm mobile traffic on the pinned host | before any retirement decision |
| **Keep old Workers deployed and warm** | entire bake period |
| Delete anything | **not scheduled** — a separate decision, after CPMS is settled |

**Cleanup is deliberately deferred and unscheduled.** Every deletion in this
system is irreversible, and none of them is urgent.
