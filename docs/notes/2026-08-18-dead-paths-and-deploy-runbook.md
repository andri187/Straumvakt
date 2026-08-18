# Version id, dead paths, and the deploy runbook

Written 2026-08-18 by `claude-b`. Companion to
[`2026-08-18-what-production-means.md`](2026-08-18-what-production-means.md).

Basis labels: `[repo]` · `[cf]` read-only Cloudflare observation this run ·
`[inferred]` · `[confirm:]`.

---

## 0. The correction that changes the release risk

**Since 2026-08-11 the board has carried this claim:** *"no `version_metadata`
version id exists, so there is no rollback target, which makes the first
deploy a one-way door."*

**The premise is right. The conclusion is wrong.**

`wrangler versions list --name straumvakt-ocpp-staging` returns a full version
history, and `wrangler deployments list` shows the live deployment is version
`aaf5f724-752a-410a-b280-30f779bf3376` (2026-08-03), with the previous
deployment on `a9c1438d-2fae-4232-8b8e-93ba1172e6ae` (2026-05-08) `[cf]`.

**Cloudflare has been recording every version all along.** Rollback is a
`wrangler rollback` / `wrangler versions deploy` away.

### So what IS missing

| Missing | Not missing |
|---|---|
| The `version_metadata` **binding**, so a running Worker cannot say which version it is | The platform's version history |
| A **release id for Sentry**, so an error cannot be keyed to a deploy | The ability to roll back to a prior version |
| Any **recorded** "known-good" version to roll back *to* deliberately | The technical means to do it |

**The distinction matters because it changes the plan.** The first deploy is
**not** a one-way door — it is a door with an unlabelled handle. The work is
not "make rollback possible", it is "make it possible to say which version you
are on, and to write down which one was good."

`[confirm: none needed — this is directly observable with the two read-only
commands above, and anyone can repeat it in thirty seconds.]`

---

## 1. The version id — specification

### What it must record

| Field | Source | Why |
|---|---|---|
| `versionId` | `CF_VERSION_METADATA.id` | The platform's own identifier for the running code. The only value that cannot be stale. |
| `tag` | `CF_VERSION_METADATA.tag` | Optional human label set at deploy. Null when unset — never invented. |
| `timestamp` | `CF_VERSION_METADATA.timestamp` | When the version was created. |
| `configured` | derived | Whether the binding is present AND usable. |
| `reason` | derived | `ok` · `binding-absent` · `binding-malformed`. |

**Where it comes from, and why not a git hash.** The value is populated by
Cloudflare at deploy time. It is not set by the build, not injected at bundle
time, and not settable by a developer. That is the point: **a hand-set value
can be stale, and a stale version id is worse than none, because it is
believed.** `[inferred]`

**`binding-absent` vs `binding-malformed` are deliberately distinct.** Absent
means nobody declared it. Malformed means somebody did and something else is
wrong — a different investigation, and one that a single boolean would hide.

### Runtime read — implemented

`gateway/src/version.ts`, exposed at **`GET /version`** on the gateway, with
19 tests including a fool-test `[repo]`.

**`/health` is deliberately unchanged.** It returns exactly the bytes `ok`,
and the alert policy specifies a synthetic probe against it `[repo:
2026-08-11-alert-policy-and-incidents.md:161]`. Changing that body to JSON
would silently break whatever asserts on it. Deployment identity gets its own
route.

**`/version` always returns HTTP 200**, including when unconfigured. A 5xx
would trip uptime alerting for a release-readiness problem rather than an
outage. The **gate** is what fails.

### The gate — implemented

`npm run check:version-id -- --probe <origin>` fetches `/version` and fails
when the environment cannot identify itself. 12 self-test fixtures `[repo]`.

It rejects **placeholders as well as absence** — `unknown`, `dev`, `latest`,
`none`, `n/a` and empty all fail, because each reads like an answer and would
pass a truthiness check. That is the fool-test.

**Run against the live gateway right now it FAILS**, correctly: `/version`
does not exist on the deployed 2026-08-03 code, so the probe gets the
gateway's `not found` 404 `[cf]`. Exit code 1.

**Why it is not in `npm run check`:** it needs a network call, and
`npm run check` is the offline, credential-free, must-stay-green surface. It
sits alongside the observability gate — a real gate, currently red, run
deliberately. Its `--self-test` is offline and is what CI can run.

### Does establishing a version id require a deploy?

**Yes, unavoidably — but a smaller one than previously assumed.**

The binding is populated at deploy time, so the Worker must be redeployed
*after* `version_metadata` is uncommented `[inferred: this is what "populated
at deploy time" means]`. No amount of read-only work substitutes.

**But the rollback safety net already exists** (§0), so this deploy is
recoverable in a way the board has been assuming it is not.

---

## 2. The smallest safe deploy

### It must not be the gateway, and it does not have to be

**The gateway is the one thing that cannot be casually deployed.**
`straumvakt-ocpp-staging` holds 21 live charger WebSockets on
`ws.straumvakt.org` `[cf]`, and a Worker deploy terminates open WebSockets —
chargers reconnect, and any in-flight OCPP call is lost.

**The smallest safe deploy is `hlada-staging` — the console Worker.**

| | |
|---|---|
| **Which Worker** | `hlada-staging` |
| **Which environment** | `--env staging` from the repo root |
| **What changes** | `version_metadata` uncommented in `wrangler.jsonc` staging env. Nothing else. |
| **What does not change** | No route, no custom domain, no secret, no binding, no application code. |
| **Effect on S0** | **None.** The console Worker holds no charger WebSockets. `straumvakt.org` may serve a few hundred milliseconds of cold start. |
| **What confirms success** | `curl https://straumvakt.org/` returns 200, and the console's version route reports a `versionId`. |
| **Rollback** | `wrangler rollback --name hlada-staging` to the prior version, which §0 proves exists. |

**Why the console and not the API:** `hlada-api-staging` serves
`api.straumvakt.org`, which the gateway calls through a service binding for
charger authentication. A deploy blip there could fail an `Authorize` while a
driver is plugging in. The console has no such path. `[inferred]`

### If it must eventually be the gateway — and it must

The gateway needs the binding too. That deploy is a separate, later step with
its own stop point:

> **STOP.** Before deploying the gateway, record the current version id
> (`aaf5f724-…`) as the known-good rollback target. Deploy. Then watch
> `wrangler tail straumvakt-ocpp-staging` for reconnections.
>
> **Abort condition, stated numerically:** if fewer than 21 distinct charger
> identities have re-established a WebSocket within **15 minutes**, roll back
> to the recorded version immediately. `[inferred: 21 is the known fleet size;
> 15 minutes is longer than any OCPP reconnect backoff a charger is likely to
> use, and is a `[confirm:]` if any charger uses a longer one.]`
>
> **How to count them:** `wrangler tail straumvakt-ocpp-staging --format json`
> and count distinct identities on `/ocpp/` upgrades. Read-only.

---

## 3. Deploy runbook — WRITTEN, NOT RUN

**Nothing below was executed. Every command is for a human with deploy
authority.** Steps 1–4 are reversible; the stop points mark where that stops
being true.

```
 1. Confirm the tree is green.
       npm run check                 # expect: all 13 checks passed
       npx vitest run                # expect: 846+ passed
       cd gateway && npx vitest run  # expect: 176+ passed

 2. Record the CURRENT known-good versions, before changing anything.
       npx wrangler deployments list --name hlada-staging
       npx wrangler deployments list --name hlada-api-staging
       npx wrangler deployments list --name straumvakt-ocpp-staging
    Write the three version ids into the release record. This is the
    rollback target. It costs 60 seconds and it is the whole safety net.

 ── STOP 1 ── Do not continue without those three ids written down. ──

 3. Uncomment `version_metadata` in wrangler.jsonc (staging env only).
    Commit. This is a config change with no deploy — still reversible by
    `git revert`.

 4. Deploy the console ONLY. This is the smallest safe deploy.
       npm run deploy:staging
    Confirm:
       curl -s -o /dev/null -w "%{http_code}" https://straumvakt.org/   # 200

 ── STOP 2 ── First real deploy. If the console does not serve, roll back
    now and stop: `npx wrangler rollback --name hlada-staging`. Do not
    proceed to the API or gateway to "see if they work". ──

 5. Uncomment `version_metadata` for the API. Deploy the API.
       cd apps/api && npx wrangler deploy --env staging
    Confirm:
       curl -s https://api.straumvakt.org/health     # {"ok":true,...}
       node scripts/analysis/release/check-version-id.mjs \
            --probe https://api.straumvakt.org       # expect PASS

 ── STOP 3 ── The API is on the charger authentication path. Before the
    gateway step, confirm a charger can still authorize: watch
    `npx wrangler tail straumvakt-ocpp-staging` for a successful Authorize
    or StatusNotification. If none arrives within 10 minutes and the fleet
    was previously active, STOP. ──

 6. THE IRREVERSIBLE-IN-EFFECT ONE. Uncomment `version_metadata` for the
    gateway. Deploy the gateway.
       cd gateway && npx wrangler deploy --env staging
    This terminates 21 live WebSockets. They will reconnect.

 ── STOP 4 ── Count reconnections for 15 minutes:
       npx wrangler tail straumvakt-ocpp-staging --format json
    ABORT CONDITION: fewer than 21 distinct identities reconnected in 15
    minutes → `npx wrangler rollback --name straumvakt-ocpp-staging` to the
    id recorded at step 2. ──

 7. Confirm all three self-identify.
       node scripts/analysis/release/check-version-id.mjs --probe https://ws.straumvakt.org
       node scripts/analysis/release/check-version-id.mjs --probe https://api.straumvakt.org
    Expect PASS on both. Record the new version ids as the next known-good.
```

**What this runbook deliberately does NOT do:** create any account resource,
touch any custom domain, rotate any secret, or apply any migration. Each of
those is its own procedure with its own approval.

---

## 4. The dead `OCPP_WEBHOOK_SECRET` path — traced and proven unreachable

### The trace

| Question | Answer |
|---|---|
| Does `OCPP_WEBHOOK_SECRET` appear in any source file? | **No.** A repository-wide search finds it only in `docs/adr/0035`, and in my own two 2026-08-18 notes `[repo]`. Zero occurrences in `src/`, `apps/`, `gateway/`, `packages/`. |
| Do the consuming routes still exist? | **No.** `src/lib/ocpp/`, `src/app/api/ocpp/events/` and `src/app/api/internal/ocpp-auth/` — the three paths `gateway/wrangler.jsonc` named — **do not exist in this tree** `[repo]`. |
| Is the secret still set anywhere? | **Yes — on top-level `hlada` only.** `hlada-staging` does not have it `[cf]`. |

**Conclusion: the code was already deleted; only the secret survives.** The
config comment claiming deletion was still pending was stale, and has been
corrected in this run's commit.

**Corollary worth stating:** the secret is set *only* on the Worker that is
itself unreachable (top-level `hlada` returns 404/error-1042 on its
workers.dev host `[cf]`). **A dead secret on a dead Worker** — which is why
this is hygiene, not an incident.

### The deletion plan, ordered so nothing is removed before its referent

```
 1. Confirm nothing references it.   ← already true, re-confirm at the time
       grep -rn "OCPP_WEBHOOK_SECRET" --include=* .   # expect: docs only
 2. Confirm top-level `hlada` is genuinely retired under the chosen
    production option. Under option (a) it is; under (b) it is redeployed
    and this plan pauses.
 3. STOP — this step needs the production decision. Do not proceed on (b).
 4. Delete the secret:
       npx wrangler secret delete OCPP_WEBHOOK_SECRET --name hlada
 5. Same procedure, same ordering, for the other dead top-level secrets:
       OCPP_ADMIN_SECRET on hlada
       ADMIN_SECRET, CHARGER_BASIC_AUTH on straumvakt-ocpp
    CHARGER_BASIC_AUTH LAST, and only after Q3 in the production packet is
    answered — if any charger still authenticates with it, deleting it is
    an outage.
 6. Only then consider deleting the Workers themselves.
```

**Ordering rationale:** secrets before Workers (a Worker delete orphans its
secrets anyway, but doing it in this order leaves an auditable trail), and
`CHARGER_BASIC_AUTH` last because it is the only one with a plausible live
consumer.

---

## 5. `MAIN_APP` — the per-option answer

| Option | What `gateway/wrangler.jsonc` top-level `MAIN_APP` should bind to |
|---|---|
| **(a) adopt staging as production** | Nothing — the whole top-level block is deleted with the Worker. |
| **(b) build top-level fresh** | `hlada-api`, exactly as written today. The binding becomes correct the moment the Worker is created. |
| **(c) rename** | Struck — see the production packet §2(c). |

**Because the answer differs, the binding is NOT fixed in this run**, per the
dispatch's instruction to fix only where option-independent. It is **gated**
instead: `npm run check:bindings` lists it as pending-creation with an owner
and a reason, and **fails** if any other binding starts naming a resource that
does not exist.

**This is the design that would have caught the original defect.** The
binding was introduced, referenced a Worker that never existed, and survived
because no gate compared configuration against the account.

---

## 6. What changed in the configs this run

| File | Change | S0 impact |
|---|---|---|
| `gateway/wrangler.jsonc` staging | Declared `routes: [ws.straumvakt.org custom_domain]` **and explicit `workers_dev: true`** | **Protective.** Both hostnames serve live charger traffic; declaring routes *without* `workers_dev: true` would infer `false` and remove the workers.dev host on the next deploy — OB19's foot-gun, with chargers behind it. |
| `apps/api/wrangler.jsonc` staging | Declared `routes: [api.straumvakt.org custom_domain]` and `workers_dev: true` | None directly; preserves the host the console's `NEXT_PUBLIC_API_BASE_URL` points at. |
| `gateway/wrangler.jsonc` top-level | Comment corrected; binding left as-is and gated | None — top-level serves nobody. |

**Neither config change has been deployed.** They make version control match
what the account already does; they do not ask the account to change.

**Observability gate moved 11 errors → 9** as a direct result: the two OB19
errors for the staging gateway and staging API are resolved `[repo]`.
