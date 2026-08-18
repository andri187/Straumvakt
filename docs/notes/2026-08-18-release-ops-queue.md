# Release-ops queue — 2026-08-18

The fallback queue absorbed from the unfired 2026-08-11 Claude B dispatch,
worked after the market-rails gates were met. Written by `claude-b` in
`E:\Claude\Straumvakt-relops-b`.

**What changed since 2026-08-11:** a **read-only Cloudflare session was
available this run**. `wrangler` is authenticated via OAuth for
`andrith187@gmail.com`. Everything in §5 below was previously blocked and is
now answered from the account itself. No mutating command was issued, and no
token, secret value or DSN was read or printed.

Basis labels as in the market-rails packets: `[repo]`, `[cf]` = observed via a
read-only Cloudflare command this run, `[inferred]`, `[confirm:]`.

---

## The headline, before the detail

**Three findings this run change the top-level picture, and two of them
correct things that were previously assumed rather than checked.**

1. **`hlada-api` does not exist on the account.** Not "not deployed
   recently" — the Worker has never existed. `wrangler deployments list
   --name hlada-api` returns `code: 10007, This Worker does not exist on your
   account` `[cf]`. The 2026-08-11 census "assumes the former
   conservatively" (that it is production); the conservative assumption was
   the wrong one.

2. **The top-level gateway's service binding points at that non-existent
   Worker.** `gateway/wrangler.jsonc` binds `MAIN_APP → hlada-api` at the top
   level `[repo: gateway/wrangler.jsonc:36-41]`. So the top-level gateway
   config, as committed, cannot deploy into a working state.

3. **There are no production queues or R2 buckets in the account at all.**
   Every queue is `-staging` (6 of them), and the only bucket is
   `straumvakt-evidence-staging` `[cf]`. The previous finding was that
   top-level *declares* no producer/consumer/DLQ/R2. It is stronger than
   that: **the resources do not exist to declare.**

**Consequence: "top-level is NO-GO" understates it.** Top-level is not a
degraded environment that needs config added. It is an environment that has
never existed for two of its three Workers, and whose third Worker last
deployed on 2026-04-19.

---

## 1 · Top-level Cloudflare config — the recommendation is an explicit HOLD

### What is actually deployed

| Worker | Exists? | Last deployment | Secret names present `[cf]` |
|---|---|---|---|
| `hlada` (console, top-level) | yes | **2026-04-23** | ADMIN_EMAIL, ADMIN_PASSWORD, AUTH_SECRET, DATABASE_URL, OCPP_ADMIN_SECRET, OCPP_WEBHOOK_SECRET |
| `hlada-staging` | yes | 2026-08-08 | + DIRECT_URL, OCPP_INGEST_SECRET; **no** OCPP_WEBHOOK_SECRET |
| `hlada-api` (top-level) | **NO** | — | — |
| `hlada-api-staging` | yes | 2026-08-08 | ADMIN_EMAIL, ADMIN_PASSWORD, APP_ENV, AUTH_SECRET, OCPP_CRED_KEK, OCPP_INGEST_SECRET, RESEND_API_KEY |
| `straumvakt-ocpp` (gateway, top-level) | yes | **2026-04-19** | ADMIN_SECRET, CHARGER_BASIC_AUTH — **no OCPP_INGEST_SECRET** |
| `straumvakt-ocpp-staging` | yes | 2026-08-03 | OCPP_INGEST_SECRET only |

All rows `[cf]`. **Names only — no value was read or printed.**

The secret sets are the interesting part. Top-level `straumvakt-ocpp` holds
`CHARGER_BASIC_AUTH` and no `OCPP_INGEST_SECRET`, while top-level `hlada`
holds `OCPP_WEBHOOK_SECRET` — the *old* gateway→UI-Worker path that
`gateway/wrangler.jsonc:31-35` describes as dead code awaiting deletion.
**The deployed top-level pair is the pre-Sprint-4.5 architecture, frozen in
April** `[inferred from the secret sets and the deployment dates]`.

### What top-level would have to declare to be real

Per environment, and none of it currently exists at top level:

| Requirement | Top-level state `[repo]` | Account state `[cf]` |
|---|---|---|
| Queue producer (gateway → events) | absent | queue does not exist |
| Queue consumer + DLQ (api) | absent | queues do not exist |
| Archive queue + DLQ | absent | does not exist |
| Outbound queue + DLQ | absent | does not exist |
| R2 bucket | absent | does not exist |
| Hyperdrive binding | **absent** — staging-only | — |
| Cron triggers | **absent** — staging-only | — |
| Rate-limit bindings | **absent** — staging-only | — |
| `version_metadata` | commented out in both | — |
| Analytics Engine dataset | commented out | — |
| Routes / `workers_dev` | neither declared (OB19) | — |

`apps/api/wrangler.jsonc`'s top-level block declares a name, a main, an
observability flag and one service binding. **Everything that makes the API
work — database, queues, cron, rate limiting — is inside `env.staging` and
has no top-level counterpart** `[repo: apps/api/wrangler.jsonc]`.

### Why this is a hold and not a patch

A patch would need to: create six queues and a bucket in the account, create
a Hyperdrive config against a production Neon branch, decide production cron
cadence, decide production rate-limit namespaces, and deploy a Worker that
has never existed — **every one of those is an account mutation requiring
Andri's approval**, and several are irreversible in the sense that matters
(a production Worker name, once deployed, is a name chargers and clients can
be pointed at).

Writing placeholder config for them would be worse than leaving it absent:
a placeholder that looks like configuration is how `hlada-api` came to be
referenced by a service binding without ever existing.

**Recommended: an explicit, recorded HOLD** — top-level is not a deploy
target until the account resources exist. The gate already fails correctly
(OB16/OB17/OB19/OB24), so the hold is enforced rather than remembered.

**S0 is preserved by doing nothing.** The charger-facing hostname is
untouched because no config was changed and nothing was deployed. That is
the safest possible outcome for 21 live WebSockets and it is what this run
did.

`[confirm: Andri — is the intended production path (a) promote staging in
place, (b) create top-level resources and deploy fresh, or (c) rename? Each
implies a different answer to "what does top-level declare", and the config
cannot be written correctly before that is chosen.]`

### Config-edge-case fixtures

The 2026-08-11 run delivered 25 config edge-case fixtures covering missing
producer / consumer / DLQ / R2 / version metadata, routes disabling
`workers_dev`, inherited config, env override, invalid JSONC, and a commented
placeholder that must not count as live `[repo: check-observability.mjs
self-test, now 83 fixtures]`. **Those already exist and all pass**; this run
added two more (§6). No new fixtures were needed for this item — the gap is
account state, which no fixture can assert.

---

## 2 · Missed-heartbeat liveness sweeper — **built**

Shipped this run as `gateway/src/liveness-sweeper.ts` with 31 tests
(`gateway/src/liveness-sweeper.test.ts`), including a fool-test. Commit
`084c0dd`.

### The mechanism comparison, briefly, and the choice

| Option | Verdict |
|---|---|
| **DO alarm** | The DO already has an `alarm()` — the outbound command timeout sweep — and alarms are single-slot per DO. Reusing it means one handler doing two unrelated jobs on one schedule; adding a second is not possible. Workable, but it couples liveness cadence to command-timeout cadence. |
| **Scheduled Worker (cron)** | Needs to enumerate identities, which means a DB read per tick rather than DO-local state. Cheap at 21 chargers, linear later. |
| **Queue consumer** | Wrong shape — there is no message to consume. Absence produces no message; that is the whole problem. |
| **Workflow** | Durable-execution machinery for a job with no multi-step state. Overkill. |
| **API cron** | `apps/api` already runs a per-minute cron in staging `[repo: apps/api/wrangler.jsonc triggers]`, and already reads the identity table. Lowest marginal cost. |

**Choice: the API cron**, because the sweep needs a *list of identities that
should be alive*, and only the database has that. A DO cannot sweep for
identities whose DO was never woken — which is exactly the charger that
died. **This is the decisive argument and it rules out the DO alarm on
correctness, not cost.**

**Not wired this run.** Wiring it changes what a deploy does, and the adapter
belongs on the API side where the cron lives. The logic, its config surface
and its tests are complete and importable.

### Properties the tests hold it to

Emits on transition only (24 hourly sweeps of one dead charger emit exactly
one event — the fool-test shows the unlatched version emits 24, i.e. 504/day
across the fleet); recovery clears the latch so a second outage is reportable
while a repeated recovery is a no-op; per-identity interval so a mixed fleet
is not mass-flagged; clock skew never emits and never reports negative
silence; additive grace absorbs a late tick; never-seen and disabled
identities are never reported; site and org grouping for alerting; and the
emitted event carries a closed field set asserted by a test that greps the
serialised event for `idTag`, `credential`, `secret`, `password`, `payload`
and `token`.

---

## 3 · Queue / DLQ / R2 failure semantics

### Event classification

| OCPP event class | Class | Why |
|---|---|---|
| `StartTransaction` | **billing material · must persist · must retry** | A lost start makes the session unbillable and the CDR wrong. Already cap-exempt `[repo: CAP_EXEMPT_ACTIONS]`. |
| `StopTransaction` | **billing material · must persist · must retry · must alert on DLQ** | A discarded stop is a billing dispute. Cap-exempt. |
| `MeterValues` | **billing material · must persist · must retry** | The evidence prices are derived from. Cap-exempt. |
| `Authorize` | **must persist · must retry** | Access decisions are auditable. Cap-exempt. |
| `BootNotification` | **must persist · must alert** | Carries the interval negotiation; a change here is a cost event. Cap-exempt. |
| `StatusNotification` | **must persist** | Operator-visible state. Retry, but a loss is recoverable from the next one. |
| `Heartbeat` | **can drop** | Liveness plus a clock, already shed by the fast path `[repo: LIVENESS_ONLY_ACTIONS]`. |
| `DataTransfer` | **raw/debug only** | Vendor-specific, no defined meaning at the generic layer. |
| `DiagnosticsStatusNotification`, `FirmwareStatusNotification` | **raw/debug only · must persist if an update is in flight** | |
| Command results (CallResult/CallError) | **must persist · must alert on timeout** | Already handled by the DO alarm. |
| **Unrecognised action** | **must persist** | Fail long, not short — the same default `retentionClassFor` already uses `[repo: heartbeat-fastpath.ts:98-109]`. |

### The message envelope

```
schemaVersion     integer, incremented on any breaking field change
eventId           ULID — idempotency key for the consumer
occurredAt        epoch ms, charger clock, as reported
receivedAt        epoch ms, edge clock — BOTH, because they disagree and
                  the disagreement is the clock-skew signal
identityId        the DO key
orgId, siteId     tenancy and alert routing (FOCUS.md rule 5)
chargingStationId, connectorId
action            OCPP action name
retentionClass    from the table above
payload           the frame body
```

**Excluded, deliberately:** `idTag` and any driver identifier in clear (must
be pseudonymised before it leaves the DO — `pseudonymiseIdentity` exists
`[repo]`); credentials of any kind; the `CHARGER_BASIC_AUTH` value; anything
from the connection headers.

**Idempotency key is `eventId`, not `(identityId, occurredAt)`** — chargers
with a stuck clock emit identical timestamps, and a natural key built on a
value the charger controls is a natural key the charger can collide
`[inferred]`.

**DLQ policy:** a DLQ'd message in a `billing material` class **must alert**;
one in `raw/debug only` may sit. Today no DLQ alerts anywhere, because
nothing reads DLQ depth `[repo: OB17; 2026-08-11 release drill]`.

---

## 4 · CRLF remediation — **the premise does not reproduce; propose nothing**

The dispatch states: *"The canonical checkout carries 580 whitespace-only
modified files because there is no `.gitattributes` and `core.autocrlf` is
unset."*

**Measured this run, read-only, in `E:\Claude\Straumvakt`:**

| Claim | Measured |
|---|---|
| 580 whitespace-only modified files | **4 modified files**, and `git diff --shortstat` equals `git diff -w --shortstat` exactly (4 files, +146/−11) — **none of them whitespace-only** |
| no `.gitattributes` | **true** — absent |
| `core.autocrlf` unset | **false — it is `true`, set at the SYSTEM level** |

The four modified files are `apps/mobile/lib/api/client.dart`,
`apps/mobile/lib/api/types.dart`, `apps/mobile/lib/screens/menu_drawer.dart`
and `docs/adr/0049-the-cdr-is-the-record.md` — real content changes belonging
to someone else, and untouched by this run.

**Why the premise was true-looking and is now wrong.** `core.autocrlf=true`
comes from the Git for Windows system config, so it applies to every checkout
on this machine including all **13** worktrees. With it set, git normalises
CRLF→LF on commit and LF→CRLF on checkout, and the tree stays clean. The
`warning: LF will be replaced by CRLF` lines that appear on every `git add`
are that mechanism working, not a defect. A run that saw 580 dirty files was
either on a checkout where the setting was absent, or read the warnings as
the diff.

**Recommendation: do not run a normalisation pass.** There is nothing to
normalise, and a `git add --renormalize` across 13 worktrees while Claude A
holds an unmerged branch is a large, risky, zero-benefit change.

**Optional hygiene, separately and later:** a `.gitattributes` with
`* text=auto` plus `eol=lf` for shell scripts would make behaviour explicit
rather than dependent on a machine-level setting — which matters the day a
second machine or CI runner joins, since CI on Linux has `autocrlf` unset by
default and would then see exactly the mass-diff this item feared
`[inferred]`. That is a real but non-urgent argument, and it is a proposal,
not a change. **Nothing was run.**

---

## 5 · The Cloudflare facts — **closed**

The 2026-08-11 artifact recorded "seven Cloudflare dashboard facts blocked on
an absent read-only session" but did not enumerate them verbatim in one list;
they are reconstructed below from that run's findings and its ten review
questions. **Six are now answered from the account. One is not, and it is
named honestly.**

| # | Question | Answer `[cf]` | How it was closed |
|---|---|---|---|
| 1 | Is `hlada-api` (top-level) production, or has it never been deployed? | **Never. The Worker does not exist** (API `code: 10007`). | `wrangler deployments list --name hlada-api` |
| 2 | Do production queues and DLQs exist in the account? | **No.** All 6 queues are `-staging`. | `wrangler queues list` |
| 3 | Does a production R2 bucket exist? | **No.** Only `straumvakt-evidence-staging`. | `wrangler r2 bucket list` |
| 4 | Has any Worker ever recorded a version id? | Versions exist per deployment, but no `version_metadata` binding is declared anywhere, so nothing captures one at runtime. **Still the blocking release gap.** | `wrangler deployments list` + `[repo]` |
| 5 | When was each Worker last deployed? | See the §1 table. Top-level console **2026-04-23**, top-level gateway **2026-04-19**. | `wrangler deployments list` |
| 6 | Which secrets are set on each Worker? | See the §1 table — **names only**. | `wrangler secret list` |
| 7 | **Which gateway do the 21 live chargers hold WebSockets against?** | **NOT CLOSED.** | see below |

**On fact 7, precisely.** `wrangler tail` was run read-only against both
`straumvakt-ocpp` and `straumvakt-ocpp-staging` for ~30 s each and produced
**no events on either**. That is **not evidence of no chargers**: at a
3600-second heartbeat interval, a 30-second window is expected to be empty
even with a full fleet connected, and hibernated WebSockets do not
necessarily produce Worker invocations between frames.

**Do not read the empty tail as an answer.** It closes with either: a tail
left running for longer than one heartbeat interval (>60 min), or the
dashboard at **Workers & Pages → `straumvakt-ocpp` → Durable Objects →
active objects / WebSocket connections**, compared against the same page for
`straumvakt-ocpp-staging`. The secret sets in §1 make staging the strong
inference `[inferred]`, and the memory of prior sessions agrees, but an
inference is the wrong basis for a fact that gates S0.

**Posture note, restated because it has not changed.** The OAuth credential
on this machine carries `workers (write)`, `workers_scripts (write)`,
`workers_kv (write)` and `workers_routes (write)`. Any process that can run
`wrangler` here can deploy. The operating rules forbid it; the credential
does not. Read-only was a discipline this run, not a constraint the token
enforced.

---

## 6 · OB16–OB28 re-verified

**Self-test: 83 passed, 0 failed** (was 81 — two fixtures added below).
**Against the real tree: 11 errors, 3 warnings** (was 10 errors, 3 warnings).

**Every OB16–OB28 result is unchanged since 2026-08-11 except OB18**, which
changed because the rule was wrong, not because the code was.

### OB18 was giving a false pass

The rule matched
`/async\s+alarm\s*\([\s\S]{0,3000}?(liveness|missed[_ ]?heartbeat|expectedNextHeartbeat)/i`
against comment-stripped source. In `identity-do.ts` that 3000-character
window reaches `recordFrame(stored?.liveness ...)` in a **different method**
about a hundred lines below the alarm. So OB18 passed — while
`identity-do.ts:521`'s `alarm()` was, verbatim, the outbound-command timeout
sweep that the rule's own error text says does not count.

**A window is not a scope.** OB18 now extracts the alarm body by brace
matching and tests only inside it. Two regression fixtures added: `liveness`
mentioned outside the alarm (passed under the old rule, fails now), and an
empty alarm.

**This is the fourth instance in this file of a rule matching text NEAR the
thing instead of the thing.** The 2026-08-11 run recorded two (OB26 firing
on `metrics.ts`'s own comment; OB18's case-sensitivity bug). This one is
worse than both, because those produced false alarms and this produced a
false pass — it hid a real gap for a week.

### Current gate output

```
WARN  OB20  api "top-level" declares no R2 bucket
WARN  OB22  no Cloudflare Access configuration found
WARN  OB25  frame cap breach logged but never metered
ERROR OB14  Analytics Engine binding still commented
ERROR OB15  version_metadata absent — no Sentry release id, no rollback target
ERROR OB16  gateway "top-level" has no OCPP_EVENTS_QUEUE producer
ERROR OB17  api "top-level" consumes no OCPP events queue
ERROR OB18  no liveness sweeper in the DO alarm            ← newly correct
ERROR OB19  ×5 environments declare neither routes nor workers_dev
ERROR OB24  no version_metadata in any gateway environment
```

**OB18 stays red on purpose.** The sweeper logic exists but is not wired into
a scheduled path (§2), and the gate should describe the deployed system, not
the available library.

---

## 7 · Release checklist for customer 1

Assuming Track A (Claude A's core-billing integration) lands. Ordered, with a
stop point at each irreversible step.

### Green before anything else — all local, no cloud

1. `npm run check` passes, including the new `invoice` gate.
2. `npx vitest run` — the `apps/api` ocpp-authorize suite needs
   `prisma generate` first; it fails on a missing generated client and has
   nothing to do with this work.
3. Observability gate reviewed — **it will not be zero**, and shipping with
   known-red OB14/15/16/17/18/19/24 is a decision to record, not a state to
   hide.
4. Invoice validator run against a real generated document, not a fixture.

### The irreversible sequence

| # | Step | ⛔ Stop point |
|---|---|---|
| 5 | Apply migration `0002` | **Andri's approval — outstanding.** A migration is not reversible by re-running it. |
| 6 | Record a `version_metadata` version id | **Deploy required.** Until this exists there is no rollback target, so step 7 is a one-way door. Do this *first* of the deploy steps. |
| 7 | Deploy staging | Stop: confirm the 21 chargers reconnect. S0 — the charger-facing hostname must not change. |
| 8 | Declare and create queues + DLQ + R2 for whatever "production" resolves to | **Account mutation.** Blocked on §1's `[confirm:]`. |
| 9 | Wire the liveness sweeper into the API cron | Stop: confirm one deliberate charger disconnect produces exactly one event, not one per minute. |
| 10 | Issue invoice number 1 | **The most irreversible step in the list.** It consumes a number that cannot be reused and puts a document in someone else's books. Before it: the accountant questions in the delivery packet §3, and a rendered document read by a human. |
| 11 | Deliver invoice 1 | Stop: confirm delivery state is `delivered` and not `unknown`. Fail-closed means an `unknown` here is a human decision, not a retry. |

### What is NOT on the critical path

The kröfuhafi registration (collection packet) — customer 1 can pay a
transfer against a PDF. Start it in parallel; do not gate on it.

---

## Sources for §5's read-only commands

All run from `E:\Claude\Straumvakt-relops-b` with the ambient OAuth session:
`wrangler whoami`, `wrangler queues list`, `wrangler r2 bucket list`,
`wrangler deployments list --name <worker>`, `wrangler secret list --name
<worker>`, `wrangler tail <worker>`. No `deploy`, `publish`, `put`, `create`,
`delete` or `versions upload` was run.
