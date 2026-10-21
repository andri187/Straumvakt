# Release-ops queue — round 3

Written 2026-08-19 by `claude-b` after the §6 gates of the 20:55 dispatch were
met. Supersedes §7 of
[`2026-08-18-release-ops-queue-round2.md`](2026-08-18-release-ops-queue-round2.md).

Items 1 and 2 shipped as code (PDF renderer + delivery wiring) and are
described in commit `36e28a1`. Items 3, 5 and 6 were **delivered in full in
round 2**; this round re-verifies them and records the deltas rather than
restating them. Item 4 is a re-verification by definition. Item 7 is new.

---

## 3 · Observability red gates — re-verified, one delta

Round 2's decision record stands
[`round2 §3`](2026-08-18-release-ops-queue-round2.md). Re-run this round:
**9 errors, 3 warnings**, unchanged.

**The delta is in the reasoning, not the count.** Round 2 said of OB18:

> *the only one with customer-visible consequence — a charger that dies
> silently is never reported*

That is still true, and round 3 adds a second one with customer-visible
consequence that is **not** an observability gate at all: the charger-identity
cross-org duplication (finding 3b in
[`2026-08-19-onboarding-an-org-to-invoiceable.md`](2026-08-19-onboarding-an-org-to-invoiceable.md)).
It is worse than OB18 in kind — OB18 means you do not learn a charger is down;
3b means a charger's energy is invoiced to the wrong org and nothing reports
it at all.

**Revised posture:** unchanged for the nine gates. But "what must be green
before the first invoice" now has a non-gate item at the top of it.

---

## 4 · The Cloudflare facts — re-verified, all six hold

Read-only, this round:

| # | Fact | Round 2 | Round 3 |
|---|---|---|---|
| 1 | `hlada-api` exists? | **no** | **no** — `code: 10007`, unchanged |
| 2 | Production queues? | none, all six `-staging` | **unchanged** |
| 3 | Production R2 bucket? | none, only `straumvakt-evidence-staging` | **unchanged** |
| 4 | Any runtime version id? | no binding declared | **unchanged** — `/version` is still undeployed |
| 5 | Last deployments | console 2026-04-23, gateway 2026-04-19 (top-level) | not re-pulled; no deploy has occurred (nothing was pushed) |
| 6 | Secret names per Worker | recorded | **unchanged** |
| 7 | **Which gateway holds the 21 chargers** | **CLOSED in round 2** — `ws.straumvakt.org` → `straumvakt-ocpp-staging`, proven by tail-and-probe | still true: `ws.straumvakt.org/health` **200**, top-level `straumvakt-ocpp.straumvakt.workers.dev` **404** |

**The seventh fact is not outstanding.** Round 2 closed it with a positive
observation; the dispatch's offer to close it this round is already spent.

`api.straumvakt.org/health` → **200**, unchanged. `straumvakt.org/health` →
404, which is correct and expected: the console is a Next.js app with no
`/health` route, and its root returns 200.

---

## 5 · `ADMIN_PASSWORD` rotation — unchanged, still not performed

Round 2's runbook [`round2 §5`](2026-08-18-release-ops-queue-round2.md) stands
verbatim. Nothing was performed this round either.

**One correction the dispatch already anticipated and I confirm:** the
runbook's scope is **three Workers, not four** — `hlada`, `hlada-staging`,
`hlada-api-staging`. `hlada-api` is not on the list because **it does not
exist**, re-verified above. Round 2's note said "four Workers … three in
practice"; the dispatch states three. **Three is right.**

Ordering rule unchanged and worth restating because it is the part that gets
skipped: rotate the API first, verify the OLD value is rejected — a rotation
that only proves the new value works has not proved the old one is dead — and
never rotate a secret on a Worker you intend to delete.

---

## 6 · `Straumvakt-core-security` — re-verified, unchanged

| | |
|---|---|
| Branch | `scratch/core-security-access-invite-2026-08-10` |
| Tip | `4b69d0f` |
| Dirty | 0 |
| Commits ahead of base | 0 |
| Unmerged vs `dev/market-rails` | 0 |

**Holds no unique work. Retirable with no loss. NOT retired** — operating rule
6 forbids the act, and the recommendation is not the act.

**Round-3 addition:** the caveat in round 2 — that the worktree's name points
at the access/invite work and that work was still open — **can now be
dropped.** All three 2026-08-08 invite defects are verified fixed this round.
The worktree is now simply stale, with nothing conceptually pending behind it.

---

## 7 · Release checklist — round 3

Supersedes round 2's §7. **Changes marked ▲.**

### Local green — no cloud, no credential

| # | Step | State |
|---|---|---|
| 1 | `npm run check` — **now 14 checks** ▲ (`onboarding` added) | ✅ green |
| 2 | `npx vitest run` after `npm run db:generate` | ✅ **992 passed** |
| 2b | gateway suite | ✅ 176 passed |
| 3 | Observability gate reviewed against §3 | ✅ 9 errors, decision recorded |
| 4 | Validator against a **generated** document | ▲ **still A-gated** — A's branch carries no generated invoice document |
| 5 | **Onboarding dry run** ▲ NEW | ✅ `npm run check:onboarding`, 6 of 6 cases |

### The sequence

| # | Step | ⛔ Stop point | Change |
|---|---|---|---|
| 1 | Answer Q1 — does anything outside engineering inspect resource names? | — | unchanged; still decides the production option |
| 2 | **Build the agreement write surface** | — | ▲ **NEW, and it is now the top blocker.** An org cannot reach invoiceable without a database write. Blocks task 12 *and* task 13. |
| 3 | **Decide the charger-identity uniqueness fix** | **access-grant → design approval (FOCUS Rule 5)** | ▲ **NEW.** Cross-org duplicate identities route energy to an arbitrary org. Needs a partial unique index (a migration, A's lane) plus an `ORDER BY` on the auth lookup. |
| 4 | Apply migration `0002` per A's preflight | Andri's approval, outstanding | unchanged |
| 5 | Record the three current version ids | STOP 1 of the deploy runbook | unchanged |
| 6 | Deploy the console only | STOP 2 | unchanged |
| 7 | Deploy the API | STOP 3 — confirm a charger can still authorize | unchanged |
| 8 | Deploy the gateway | STOP 4 — 21 reconnections in 15 min or roll back | unchanged |
| 9 | Wire the liveness sweeper into the API cron | one disconnect → exactly one event | unchanged |
| 10 | Create the dev tier | account mutation | unchanged |
| 11 | **Onboard customer 1 using the operator script** | ⛔ step 4 of that script: check the `orgId` and the charger identity by hand — nothing validates either | ▲ NEW |
| 12 | **Confirm readiness reports INVOICEABLE** | — | ▲ NEW — before issuing, not after |
| 13 | Issue invoice number 1 | the most irreversible step | unchanged |
| 14 | Deliver invoice 1 | delivery state `delivered`, not `unknown` | ▲ the PDF path now exists and is fail-closed |

### Not on the critical path

Unchanged: **kröfuhafi registration** — customer 1 can pay a transfer against
a PDF, and as of this round there is a PDF to pay against.

▲ **Removed from the blocker list:** the invite-code hijack. Fixed, with an
ADR and identity-bound redemption.

---

## Cross-reference against A's operator runbook

The dispatch asks that this not drift from A's Phase 4 runbook.

**Not cross-referenced, and I am not claiming it was.** A's round-3 output was
not present on `dev/core-billing-integration` at the tip I read
(`a84141e` at start, `e7247b6`/`a84141e` during the run) — the branch carries
A's round-2 material. The two documents therefore cannot be reconciled yet.

**What I did instead:** made the seam explicit. Steps 11–13 above are the
onboarding side; A's runbook owns the period-close and generation side. The
handover point is **step 12** — readiness reporting INVOICEABLE is the
precondition A's generator assumes, and `assessOrgReadiness` is the function
that answers it. If A's runbook asserts a different precondition set, that is
the disagreement to resolve, and it is one function call wide.
