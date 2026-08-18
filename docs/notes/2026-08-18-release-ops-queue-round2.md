# Release-ops queue — round 2

Written 2026-08-18 by `claude-b`, after the §9 gates of the 15:40 dispatch
were met. Supersedes §7 of
[`2026-08-18-release-ops-queue.md`](2026-08-18-release-ops-queue.md).

Basis labels: `[repo]` · `[cf]` read-only observation · `[inferred]` ·
`[confirm:]`.

---

## 1 · Host kennitala capture — **built**

`packages/contracts/src/invoice/kennitala.ts`, 26 tests including a fool-test.
Exported as `@straumvakt/contracts/invoice/kennitala`.

**The field.** Ten digits, stored normalised with no dash. One canonical form.

**The validation.** `kennitalaProblems(value)` returns codes — `empty`,
`wrong_length`, `non_digit`, `checksum_failed`, `implausible_date` — and
**never the input**, so a caller that logs the result cannot accidentally log
a kennitala. Structural problems short-circuit the checksum, because reporting
`checksum_failed` on a five-character string sends the reader after the wrong
bug.

**The storage contract**, as asserted data rather than prose
(`KENNITALA_STORAGE_CONTRACT`): normalised; required for invoicing; nullable
before an org is billable; **never logged**; masked in UI; unique per tenant.

**Where it surfaces.** `maskKennitala` renders `DDMMYY-****` — the date part
is what a human uses to recognise a record, the last four digits are the
identifying part and stay hidden. Anything showing a kennitala in a UI, a log
line, an error message or a support tool uses this.

**What refuses without it** (`REFUSES_WITHOUT_KENNITALA`): invoice document
construction for both `claimHolder` and `recipient`; the header render, which
refuses rather than rendering a partial header; bank claim creation, since a
krafa is addressed by kennitala; and marking an org billable.

**HANDOVER TARGET: `packages/contracts/src/inputs/orgs.ts`** — the org input
schema should adopt `kennitalaProblems` as a field validator. Same pattern as
the delivery-log contract: this module owns the rule, the consuming schema
owns the field. Not edited here, because the org input schema is not in this
lane.

**On the sensitivity.** No real-looking kennitala appears anywhere in the
repository. The tests build checksum-valid values from **impossible dates**
(day 88, month 99), which exercise every branch while being unmistakably
synthetic. The honest consequence, stated in the test file: the mod-11
algorithm is verified by **property** — changing any single digit must break
the checksum, asserted across 70+ mutations — rather than against published
vectors, because committing published vectors would commit real-looking
kennitala. A property test is what a checksum is actually for.

**Why this was the one to do.** From the 14:15 run: it is the only remaining
zero-dependency task whose cost *rises* with every org onboarded without it,
because it cannot be added retroactively without going back and asking.

---

## 2 · The local-green half of the release checklist — **executed**

Items 1–4 of §7 of the round-1 note. All run this round.

| # | Item | Result |
|---|---|---|
| 1 | `npm run check` including the invoice gate | **all 13 passed** (was 12 — `bindings` added this round) |
| 2 | `npx vitest run` with `prisma generate` first | **888 passed, 1 skipped, 60/60 files** |
| 2b | gateway suite | **176 passed, 8/8 files** |
| 3 | Observability gate reviewed | **9 errors, 3 warnings** (was 11/3 at the start of this round — see §3) |
| 4 | Validator run against a real generated document | **Not possible — see below.** |

**On item 4, honestly.** The round-1 note said to use A's dry-run invoice if
it existed by now. **It does not.** A's branch `dev/core-billing-integration`
at `e7247b6` carries an activity-source census, a `0002` preflight, tenant
scoping and money-unit work, but no generated invoice document `[repo,
read-only]`. The two `*dry-run*` files there are from 2026-05-31 and unrelated.

So the validator has been run against hand-written JSON (round 1) and the
65-fixture corpus, but **not yet against a document produced by a generator**.
That remains the single most useful test of the invoice rail and it is
A-gated. Recorded rather than glossed.

---

## 3 · The observability red-gate decision record

Shipping with red gates is *"a decision to record, not a state to hide"*. Here
is the record.

**Current: 9 errors, 3 warnings** — down from 11 at the start of this round,
because declaring the live hostnames resolved the two S0-adjacent OB19s.

| Gate | What it protects | What breaks if it stays red through the first invoice | Green before which step |
|---|---|---|---|
| **OB14** Analytics Engine binding | OCPP economics counters | Nothing customer-visible. Cost surprises are discovered on a bill instead of a dashboard. | Before scale, not before invoice 1. **Acceptable red.** |
| **OB15 / OB24** `version_metadata` | Runtime self-identification and a Sentry release id | You cannot tell which code produced a wrong invoice. **Rollback still works** — see the round-1 correction; the platform records versions regardless. | **Before the first gateway deploy.** The runbook's step 3. |
| **OB16 / OB17** top-level queue producer/consumer/DLQ | Event durability in top-level | **Nothing** — top-level serves no traffic `[cf]`. These are red about an environment nobody uses. | **Not before invoice 1.** They go green or go away with the production decision. |
| **OB18** liveness sweeper | A charger that dies silently is never reported | A host's charger is down and nobody knows until they complain. **This is the one with real customer impact.** | **Before onboarding customer 1**, not before invoice 1 — logic is built, wiring is a deploy. |
| **OB19** routes / `workers_dev` | The pinned-host foot-gun | Was the S0 risk. **The two live environments are now green**; the three remaining are top-level, which serves nobody. | With the production decision. |
| **OB20** R2 in top-level (warn) | Exports and debug bundles | Nothing today. | — |
| **OB22** Cloudflare Access (warn) | Internal/ops tools unprotected | Real but unquantified. `[confirm: which internal tools are reachable without auth?]` | Before any ops tool has a real URL. |
| **OB25** frame-cap breach unmetered (warn) | Noisy-charger detection | A noisy charger is logged but not aggregated, so it is found by reading logs. | Before scale. |

**The decision, stated plainly:** of nine errors, **six are about an
environment that serves no traffic** and are noise until the production
question is answered. Two (OB15/OB24) matter at the first deploy. **One
(OB18) is the only one with customer-visible consequence**, and its logic
shipped last round — what remains is a deploy, not development.

**Recommended posture:** ship invoice 1 with OB14/16/17/19/20/22/25 red,
having recorded why. Take OB15/OB24 green at the first deploy because they are
free once the binding is uncommented. Take OB18 green before customer 1 is
onboarded onto real hardware.

---

## 4 · The Neon production project plan

**None exists.** Every environment runs against branches of one Neon project
`[repo: SERVICES.md]`.

| Question | Answer |
|---|---|
| **What it needs** | Depends entirely on the production decision. Under **option (a)** — nothing new; the live branch *is* production and the work is naming and a `dev` branch beside it. Under **option (b)** — a separate project or a dedicated branch, plus a data migration for 21 chargers' history, which is the expensive part. |
| **What it costs** | A branch is **free**; you pay compute `[repo: SERVICES.md]`. A second always-on 0.5 CU compute is **≈ $39/mo**; scale-to-zero is a few dollars. Storage $0.35/GB-mo, shared across branches of a project. |
| **Retention** | `[confirm: Andri — what point-in-time-restore window does the current plan give, and is it enough for a billing system?]` **This is the one genuinely unanswered question in this section**, and it matters more than the cost: the 7-year invoice retention obligation is about *documents*, but the ability to recover the *database* to a point before a bad migration is what makes A's `0002` rollback window real. |
| **Branch topology** | `production` ← the live branch, renamed or adopted · `dev` ← new, scale-to-zero, task 9 · `test` ← parity, exists. Deliberately **no per-developer branches** until more than one person is building. |
| **Relation to the three options** | (a): rename/adopt, add `dev`. (b): new project, migrate data. (c): struck. |

**Recommendation:** do nothing here until the production decision. The one
action that is safe and useful now is answering the retention question, which
costs a dashboard glance and changes the risk profile of every migration.

---

## 5 · `ADMIN_PASSWORD` rotation runbook — **written, NOT performed**

Outstanding since 2026-08-08. The old value is compromised via git history
`[repo]`. **Names only below; no value appears, and nothing was run.**

**Scope: four Workers** `[cf]` — `hlada`, `hlada-staging`, `hlada-api`
(does not exist, so three in practice), `hlada-api-staging`. Both live Workers
hold `ADMIN_PASSWORD` and `ADMIN_EMAIL`.

```
 1. Generate a new value out of band. Never in a shell that logs history,
    never in a file in the repository, never in a chat.
 2. Rotate the API first — it is what actually authenticates.
       npx wrangler secret put ADMIN_PASSWORD --name hlada-api-staging
 ── STOP — verify BEFORE touching the console, or you will have two broken
    surfaces and no way to tell which change broke which. ──
 3. Verify: log in against api.straumvakt.org with the new value. Then
    verify the OLD value is REJECTED. A rotation that only proves the new
    one works has not proved the old one is dead.
 4. Rotate the console.
       npx wrangler secret put ADMIN_PASSWORD --name hlada-staging
 5. Verify login at straumvakt.org.
 ── STOP — both live surfaces verified before touching anything dead. ──
 6. The dead top-level `hlada` holds it too. Under option (a) that Worker is
    retired and the secret goes with it — prefer deletion to rotation:
       npx wrangler secret delete ADMIN_PASSWORD --name hlada
    Do NOT rotate a secret on a Worker you intend to delete; it creates a
    fresh credential on an unmonitored surface.
 7. Record the rotation date. Do not record the value.
```

**Why API-first:** the console defers authentication to the API
`[inferred from the secret sets: hlada-api-staging holds the auth secrets and
the console's NEXT_PUBLIC_API_BASE_URL points at it]` `[confirm: is
ADMIN_PASSWORD read by the console Worker at all, or only by the API? If only
the API, steps 4–5 are unnecessary and the runbook is three steps shorter.]`

**Note the ordering rule this shares with the dead-secret plan:** nothing is
removed before the thing that references it, and nothing is created on a
surface that is about to be deleted.

---

## 6 · The `Straumvakt-core-security` worktree

Read-only inspection `[repo]`:

| | |
|---|---|
| Path | `E:\Claude\Straumvakt-core-security` |
| Branch | `scratch/core-security-access-invite-2026-08-10` |
| Tip | `4b69d0f` |
| Dirty | **0** |
| Commits ahead of its base | **0** |
| Unmerged vs `dev/market-rails` | **0** |
| Last commit | `4b69d0f`, 2026-08-09, *"docs(release): record release-candidate verification and the work-view decision"* |

**It holds no unique work.** The branch never advanced past the commit it was
created from, so there is nothing in it that is not already reachable.

**Recommendation: retirable, with no loss.** **Not retired** — operating rule 6
forbids worktree retirement, and the recommendation is not the act.

**One caveat worth stating:** its name suggests it was created for the
access/invite work, and the invite-code defect (TASKS.md 13, bearer-only
codes) is still open and still unsafe `[repo]`. Retiring the worktree does not
retire that problem, and nothing here should be read as saying it does.

---

## 7 · Release checklist for customer 1 — round-2 revision

Supersedes §7 of the round-1 note. **Changes are marked ▲.**

### Local green — no cloud, no credential

| # | Step | State |
|---|---|---|
| 1 | `npm run check` — **now 13 checks** ▲ (`bindings` added) | ✅ green |
| 2 | `npx vitest run` after `npm run db:generate` | ✅ 888 passed |
| 2b | gateway suite ▲ | ✅ 176 passed |
| 3 | Observability gate reviewed against §3's record ▲ | ✅ 9 errors, decision recorded |
| 4 | Validator against a **generated** document | ❌ **A-gated** — no generated invoice exists yet |

### The irreversible sequence

| # | Step | ⛔ Stop point | Change |
|---|---|---|---|
| 5 | **Answer Q1: does anything outside engineering inspect resource names?** | — | ▲ **NEW, and it is now first.** It decides the production option, and options (b)/(c) reorder everything below. |
| 6 | Apply migration `0002` per A's preflight | Andri's approval, outstanding | unchanged |
| 7 | Record the three current version ids | **STOP 1** of the deploy runbook | ▲ Was "record a version id". Now: the rollback target **already exists** — write down the three ids you have. |
| 8 | Uncomment `version_metadata`; deploy **the console only** | **STOP 2** | ▲ Was "deploy staging". Now explicitly the smallest safe deploy, and explicitly **not** the gateway. |
| 9 | Deploy the API | **STOP 3** — confirm a charger can still authorize | ▲ new |
| 10 | Deploy the gateway | **STOP 4** — 21 reconnections in 15 min or roll back | ▲ Abort condition is now numeric. |
| 11 | Wire the liveness sweeper into the API cron | one deliberate disconnect → exactly one event | unchanged |
| 12 | Create the `dev` tier so there is somewhere to test | account mutation | ▲ new — task 9 |
| 13 | Issue invoice number 1 | **The most irreversible step.** Accountant questions answered; a rendered document read by a human. | unchanged |
| 14 | Deliver invoice 1 | delivery state `delivered`, not `unknown` | unchanged |

### What is NOT on the critical path

Unchanged from round 1: **kröfuhafi registration** — customer 1 can pay a
transfer against a PDF. Start it in parallel; do not gate on it.

▲ **Added:** the top-level environment. Six of the nine red observability
errors are about Workers that serve no traffic. They are not a release
blocker; they are a decision waiting to happen.
