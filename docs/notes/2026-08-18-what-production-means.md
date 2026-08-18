# What "production" means — decision packet

Written 2026-08-18 by `claude-b` in `E:\Claude\Straumvakt-relops-b`. Follows
[`2026-08-18-release-ops-queue.md`](2026-08-18-release-ops-queue.md), whose §1
HOLD is what this packet exists to lift.

Basis labels: `[repo]` verified in this repository · `[cf]` observed via a
**read-only** Cloudflare command or an unauthenticated HTTP probe this run ·
`[inferred]` with reasoning shown · `[confirm: who — question]`.

---

## THE ANSWER — 191 words

**Production already exists. It is called staging.**

`ws.straumvakt.org`, `api.straumvakt.org` and `straumvakt.org` all serve
traffic today, and all three are bound to **`-staging` Workers** `[cf]`. The
21 chargers hold their WebSockets against `ws.straumvakt.org` →
**`straumvakt-ocpp-staging`**, proven by tailing that Worker and watching a
probe request arrive `[cf]`. The top-level `straumvakt-ocpp` is deployed,
**unreachable, and served zero requests in a 25-second tail** `[cf]`.

**So the question is not "how do we build production". It is "what do we call
the production we already run, and how do we get a test environment back".**

**Take option (a): adopt staging as production in place.** It is the only
option whose first step does not touch 21 live WebSockets. Options (b) and (c)
both require repointing `ws.straumvakt.org` at a different Worker script — and
a different script means **a different Durable Object namespace**, so every
charger's liveness, frame-cap and pending-command state starts empty
`[inferred]`.

**Do first, under every option:** declare the two undeclared custom domains in
config. `ws.straumvakt.org` and `api.straumvakt.org` exist only in the
dashboard `[repo]` `[cf]`.

---

## 1. The finding that reframes the decision

The 14:15 dispatch and my own previous note both assumed top-level
`straumvakt-ocpp` was the live charger gateway. **It is not.**

### What is actually serving

| Public hostname | HTTP probe `[cf]` | Worker | Declared in a wrangler config? |
|---|---|---|---|
| `straumvakt.org`, `www.straumvakt.org` | 200, Next.js | `hlada-staging` | **yes** `[repo: wrangler.jsonc:61-64]` |
| `api.straumvakt.org` | 200 `{"ok":true,"service":"hlada-api"}` | **`hlada-api-staging`** — proven by tail | **NO** |
| **`ws.straumvakt.org`** | 200 `ok` | **`straumvakt-ocpp-staging`** — proven by tail | **NO** |
| `straumvakt-ocpp.straumvakt.workers.dev` | **404, Cloudflare error 1042** | top-level `straumvakt-ocpp` | n/a |
| `hlada.straumvakt.workers.dev` | **404, Cloudflare error 1042** | top-level `hlada` | n/a |

**How the two bindings were proven, not inferred.** `wrangler tail
straumvakt-ocpp-staging` was left connected while
`https://ws.straumvakt.org/health?probe=claudeb1` was requested twice; both
requests appeared in that Worker's tail with the exact query string. The same
method proved `api.straumvakt.org` → `hlada-api-staging` `[cf]`.

**And the negative case, same invocation:** `wrangler tail straumvakt-ocpp`
connected successfully and produced **zero events in 25 seconds**, while
`straumvakt-ocpp-staging` produced live `/dispatch` traffic within seconds of
connecting `[cf]`.

### Three consequences

1. **S0 attaches to `ws.straumvakt.org` → `straumvakt-ocpp-staging`.** The
   charger-facing hostname that must not change is a custom domain on a Worker
   whose name ends in `-staging`.
2. **There is no safe place to test.** `wrangler deploy --env staging` on the
   gateway or the API deploys **to the live production system**. The command
   that reads as "deploy to staging" is the production deploy `[repo]` `[cf]`.
   *This is the single most dangerous fact in this packet.*
3. **Two of the three production hostnames are not in version control.** If
   the dashboard bindings were lost, nothing in the repository would restore
   them, and nothing in the repository records that they exist. `[repo]`

### Correction to my own prior artifact and to the dispatch

My 14:15 completion recorded fact 7 — which gateway the chargers use — as
**not closed**, and said explicitly that an empty 30-second tail proves
nothing. That was right, and it is now closed by a *positive* observation
rather than an absence. The 15:40 dispatch's §2 states *"`straumvakt-ocpp` at
top level is the gateway the 21 chargers are connected to right now"* —
**that premise is wrong**, and the whole of §5's option analysis changes
because of it. ADR 0035:390 already said chargers connect to the staging
host `[repo]`; it was correct and had been overtaken by assumption.

---

## 2. The three options

**Every table starts with S0. That is the point.**

### Option (a) — adopt staging in place as production

Stop treating the `-staging` Workers as a pre-production environment, because
they are not one. Declare what already exists, then build a *new* lower
environment for testing.

| | |
|---|---|
| **S0 / 21 chargers** | **Untouched. Zero WebSocket interruption.** No hostname moves, no Worker script changes identity, no DO namespace changes. This is the only option that can say that. |
| **Account mutations required** | 1. Declare `ws.straumvakt.org` and `api.straumvakt.org` as `custom_domain` routes in config and deploy so the config matches reality *(config-only; the domains already exist)*. 2. Create the new lower environment's resources — Neon branch, queues, R2 — **all new names, nothing existing touched**. |
| **Irreversible?** | **Nothing in step 1.** Step 2 creates new resources only; deleting them later is clean. |
| **Frozen April `straumvakt-ocpp`** | Becomes formally dead. Retire it *after* the dead-path work in §7 of this packet's companion, not before. Its `CHARGER_BASIC_AUTH` is retired with it. |
| **Secrets** | **Create:** none for production. **Rotate:** `ADMIN_PASSWORD` (compromised via git history, outstanding since 2026-08-08) `[repo]`. **Retire:** `OCPP_WEBHOOK_SECRET` on `hlada`, `ADMIN_SECRET` + `CHARGER_BASIC_AUTH` on `straumvakt-ocpp` — all on the dead top-level Workers. |
| **Monthly cost** | **No delta for production.** The new lower environment costs the Track-B task-9 figure: ≈ **$5–15/mo** scale-to-zero or ≈ **$40–50/mo** hot `[repo: SERVICES.md]`. |
| **What happens to `-staging`** | The **suffix stays and becomes a misnomer**, which is the honest cost of this option. Mitigation: the suffix is a Worker *name*, invisible to customers — every customer-facing hostname is already `straumvakt.org`. Rename later, deliberately, as its own project (see §3). |
| **Rollback, per step** | Step 1: revert the config commit; the domains were already bound, so nothing changes at the edge. Step 2: delete the new resources. |

### Option (b) — create top-level resources and deploy fresh

| | |
|---|---|
| **S0 / 21 chargers** | **Breaks, by construction.** The final step is repointing `ws.straumvakt.org` from `straumvakt-ocpp-staging` to `straumvakt-ocpp`. Every charger's WebSocket terminates and must reconnect. Worse: **a different Worker script has a different Durable Object namespace**, so `IdentityDurableObject` starts empty for all 21 — liveness, frame-cap windows and any in-flight command state are gone `[inferred: a DO namespace is defined by the script that declares the class; a second script declaring the same class name gets its own namespace]` `[confirm: Cloudflare docs / a test in the lower environment — can the new Worker bind to the existing namespace via `script_name` instead?]`. **That mitigation exists and would need proving before this option is safe.** |
| **Account mutations required, in order** | 1. Create 6 queues (events, archive, outbound, + 3 DLQs). 2. Create R2 bucket. 3. Create Hyperdrive config against a production Neon branch. 4. Create the Neon production project/branch (none exists). 5. Set every secret on 3 Workers. 6. Deploy `hlada-api` — **a Worker that has never existed**. 7. Deploy `hlada`, `straumvakt-ocpp`. 8. Repoint 3 custom domains. |
| **Irreversible?** | Step 6 is the irreversible one in the sense that matters: **a Worker name, once deployed, is a name chargers and clients can be pointed at.** Step 8 is reversible at the edge but not in its effect — the DO state lost at cutover does not come back. |
| **Frozen April `straumvakt-ocpp`** | Overwritten by the fresh deploy. `CHARGER_BASIC_AUTH` must be **recreated or deliberately retired first** — if chargers authenticate with it and it is dropped, they fail to reconnect after cutover. `[confirm: does the current gateway still accept CHARGER_BASIC_AUTH, or is auth fully via OCPP_INGEST_SECRET + per-identity credentials?]` |
| **Secrets** | **Create:** the full set on 3 Workers (~15 secret-puts). **Rotate:** `ADMIN_PASSWORD`. **Retire:** the staging set, eventually. |
| **Monthly cost** | Production and the current environment run **in parallel** during cutover, so for that window you pay both. Steady-state after: roughly today's cost plus a second Neon compute — the same **≈$40–50/mo hot / ≈$5–15/mo scale-to-zero** shape `[repo: SERVICES.md]`, plus duplicated queue/R2 usage which is negligible at 21 chargers `[inferred]`. |
| **What happens to `-staging`** | Becomes a real staging environment again — the one genuine benefit of this option. |
| **Rollback, per step** | Steps 1–5: delete the created resources. Step 6–7: a deployed Worker can be deleted but the name stays claimed. Step 8: repoint the domain back — **but the chargers reconnect a second time and the DO state is lost again.** Rolling back costs a second outage. |

### Option (c) — rename

| | |
|---|---|
| **S0 / 21 chargers** | **Same breakage as (b), plus a trap.** |
| **The trap** | **Changing `name` in a wrangler config does not rename a Worker — it deploys a *new* Worker under the new name and leaves the old one running** `[repo: this is exactly why commit `4fe0a95`, which renamed `hlada` → `straumvakt-console`, is on the release-candidate exclusion list — "changing `name` may select a *new* Worker rather than rename in place, and is unproven to carry secrets or the Git binding"]`. Secrets do **not** follow. Durable Object namespaces do **not** follow. |
| **Verdict** | **Option (c) is option (b) wearing a disguise.** It has all of (b)'s cost, plus the risk that someone believes it is a rename and skips (b)'s secret-recreation and DO-migration steps. **It should be struck from the list, not chosen against.** |

---

## 3. The cheapest option, and when it flips

**Option (a), and it is not close.**

**Reasoning shown:**

1. It is the only option whose first step does not interrupt 21 live
   WebSockets. Every other option's benefit has to be worth an outage; (a)'s
   costs nothing.
2. Its expensive-sounding part — a new lower environment — is **work you must
   do under all three options**, because today there is nowhere to test.
   Option (a) is therefore not "do less", it is "do the necessary part first".
3. The thing (a) does not fix — the `-staging` suffix — is a Worker name.
   **No customer, charger or client ever sees it.** Every public hostname is
   already `straumvakt.org`.

**Conditions under which it flips — one is real, two are not:**

| Condition | Real? |
|---|---|
| A compliance or contractual requirement that the production Worker not be named `-staging` | **Real, and it is the only real one.** `[confirm: Andri — does any customer contract, audit or procurement process inspect infrastructure resource names?]` |
| "It is confusing for engineers" | Not sufficient. Confusion is fixed by `docs` + the config declaring reality; an outage is not fixed by anything. |
| "We want a clean start" | Not sufficient — and it is the reasoning that produced a `hlada-api` service binding to a Worker that never existed. |

**If it flips**, the correct route is **(b) executed from the new lower
environment**, having first proven there that a Worker can bind to an existing
DO namespace via `script_name`. Never (c).

---

## 4. Reversibility — permanent vs changeable

### Effectively permanent

| Thing | Why |
|---|---|
| **A Worker name, once deployed** | It is a name chargers and clients get pointed at, and it is claimed on the account. `hlada-api` is claimed today by a config file that references it, without a Worker to match. |
| **Durable Object state, once a charger is repointed to a different script** | It does not migrate with a cutover. Liveness history, frame-cap windows and in-flight commands are gone. |
| **The charger-facing hostname** | 21 devices hold it in device config; the shipped Flutter client has no fallback host `[repo: 2026-08-11 finding]`. Changing it is a truck roll or a remote-config campaign, per device. |
| **The fact that a hostname once served production** | Cannot be un-published. |

### Changeable in six months at low cost

| Thing | Cost |
|---|---|
| **The `-staging` suffix** | A deliberate migration project, priced as option (b), executable *later* from a real lower environment with a proven DO-migration path. Deferring it costs nothing but embarrassment. |
| **Which config file declares a custom domain** | A commit. |
| **Queue batch sizes, cron cadence, rate-limit namespaces** | Config. |
| **Whether the lower environment is hot or scale-to-zero** | A Neon setting `[repo: SERVICES.md]`. |

**So Andri is being asked to decide the changeable half.** Naming is in the
permanent column — which is the argument for *not* deciding it under time
pressure, and for doing (a) now.

---

## 5. True regardless of the choice — build it now

These are option-independent. **All of them are started or finished in this
run rather than deferred**, per §7 gate 8.

| # | Item | Status this run |
|---|---|---|
| 1 | **Declare `ws.straumvakt.org` and `api.straumvakt.org` in config** | ✅ done, with the S0 safety analysis in the commit |
| 2 | **A gate that fails when a binding names a resource that does not exist** | ✅ done — `check:bindings` |
| 3 | **The `version_metadata` local half + a gate for its absence** | ✅ done |
| 4 | **Fix `MAIN_APP → hlada-api`** | ✅ done — the answer is the same under all three options |
| 5 | **Trace and plan the dead `OCPP_WEBHOOK_SECRET` path** | ✅ done |
| 6 | **A lower environment must exist** | plan delivered (Track B task 9) |
| 7 | **`ADMIN_PASSWORD` rotation** | runbook written, not performed |
| 8 | **Neon production project** | plan delivered |

---

## 6. The blocking questions

Fewer and sharper, as instructed. **Only Q1 blocks anything this week.**

### Q1 — Does anything outside engineering inspect infrastructure resource names?

- **Why it blocks:** it is the single condition that flips the recommendation
  from (a) to (b). Nothing else does.
- **What unblocks:** if no → **take option (a) and stop thinking about it.**
  If yes → schedule (b) as a project, from a lower environment, after proving
  the DO `script_name` binding.
- **Ask:** Andri. Contracts, audit, procurement.

### Q2 — Can a Worker bind to a Durable Object namespace declared by a *different* script, via `script_name`?

- **Why it blocks:** it is the difference between option (b) costing "one
  reconnect" and costing "one reconnect plus every charger's durable state".
  It does **not** block option (a).
- **What unblocks:** the feasibility, and therefore the true price, of every
  future rename.
- **Ask:** provable in the lower environment once it exists — this is exactly
  the kind of thing task 9 says the Dev tier is *for* `[repo: TASKS.md 9 —
  "prove the deploy and migration flow end to end"]`.

### Q3 — Does the gateway still authenticate chargers with `CHARGER_BASIC_AUTH`?

- **Why it blocks:** only options (b) and (c). If the answer is yes and the
  secret is not recreated on the new Worker, **all 21 chargers fail to
  reconnect after cutover** — the worst failure mode in this document.
- **What unblocks:** whether a cutover needs that secret carried across.
- **Ask:** readable from the gateway source and the deployed secret set; the
  top-level Worker holds it and the staging Worker does not `[cf]`, which
  already suggests the live path does not use it `[inferred]`.

### Q4 — Should the lower environment be hot or scale-to-zero?

- **Why it blocks:** task 9's cost line, and nothing else. Does not block (a).
- **What unblocks:** ≈$40–50/mo vs ≈$5–15/mo `[repo: SERVICES.md]`.
- **Ask:** Andri. Recommendation on file is scale-to-zero, and nothing found
  this run contradicts it.

---

## 7. Appendix — what was verified, and how

**Verified `[cf]` this run, all read-only:** the three live custom domains and
their HTTP responses; that `ws.straumvakt.org` is served by
`straumvakt-ocpp-staging` and `api.straumvakt.org` by `hlada-api-staging`,
both by tail-and-probe; that top-level `straumvakt-ocpp` and `hlada` return
404/error-1042 on their `workers.dev` hostnames; that top-level
`straumvakt-ocpp` produced zero tail events in 25 s while the staging gateway
produced live traffic in seconds; the Worker/deployment/secret-name inventory
carried forward from the 14:15 run.

**Not verified, and not guessed:** whether a DO namespace can be shared across
scripts (Q2); whether `CHARGER_BASIC_AUTH` is still on the live auth path
(Q3); whether any non-engineering process inspects resource names (Q1);
whether `wrangler deploy` removes custom domains absent from config — **the
config is being fixed to declare them precisely so this never has to be
answered under pressure** `[confirm: not required if item 5.1 lands first]`.

**Commands used:** `wrangler whoami`, `wrangler tail <worker>`, and
unauthenticated `curl` against public hostnames. No mutating verb was run.
