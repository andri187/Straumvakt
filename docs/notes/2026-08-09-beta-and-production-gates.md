# Beta and production release gates

**Checklists. Nothing was executed.** Two distinct gates: beta is a *test*
environment with real hardware; production carries real customers and legal
obligations. They are not the same gate with a stricter threshold.

Legend: 🔒 requires Andri's approval · ⚙️ external mutation · 📋 verification only

---

# Beta release gate

Beta's purpose: **exercise the real product with test organisations, on real
hardware, without a customer being affected by a mistake.**

## B1 · Identity and data hygiene

| # | Item | Type |
|---|---|---|
| B1.1 | Every organisation in beta is flagged as a test organisation in-row | 📋 |
| B1.2 | Every driver identity uses the agreed test convention | 📋 |
| B1.3 | **No real customer's data is present in beta** | 📋 |
| B1.4 | Beta secrets are beta-specific — **no value shared with production** | 📋 |
| B1.5 | Beta database is the `staging` Neon branch, verified by explicit branch id | 📋 |

**B1.3 is the load-bearing one.** Beta will be used for demos and experiments;
the moment a real customer's data lands in it, beta inherits production's legal
obligations and stops being expendable.

## B2 · Onboarding workflow exercise

| # | Item |
|---|---|
| B2.1 | Create a test organisation end to end through the real onboarding path |
| B2.2 | Invite a host admin; accept the invite; confirm the resulting membership |
| B2.3 | Invite a driver; redeem the code; confirm the driver group membership |
| B2.4 | **A code minted for driver A cannot be redeemed by driver B** — on every consume path |
| B2.5 | Onboard a charger and confirm it appears under the right installation |

B2.4 is called out because **three invite-consume paths coexist**
(`/api/public/invites/consume`, `/redeem-invite`, `/claim-invite`) and ADR 0053's
identity-binding invariant must hold on all three. Enforced on two of three is
not enforced.

## B3 · Staff and organisation UI

| # | Item |
|---|---|
| B3.1 | `/staff` and `/staff/overview` render for an employee persona |
| B3.2 | `/org/[slug]` renders for a `host_admin`, and shows **only** that org |
| B3.3 | A non-`host_admin` session is redirected away from `/org/*` |
| B3.4 | An unauthenticated visitor reaches the login page, not a rendered app |
| B3.5 | Cross-tenant negative tests pass — another org's slug resolves to your own org |

## B4 · First real hardware charge

| # | Item |
|---|---|
| B4.1 | A real charger, a real vehicle, a **test** driver identity |
| B4.2 | Start from the app → command accepted → session row created |
| B4.3 | Active session recovers after the app is killed and reopened |
| B4.4 | Stop from the app → charger actually stops |
| B4.5 | Session completes and a cost is projected |
| B4.6 | Displayed cost matches an **independently calculated** expectation |

**B4.6 is the single most informative test available**, and it requires no new
code. It is also the one that would catch a money-unit error, which is the
outstanding risk in the driver surface.

## B5 · Multiple sessions

Multiple concurrent sessions are an accepted behaviour, so beta must exercise
them rather than avoid them.

| # | Item |
|---|---|
| B5.1 | Two concurrent sessions for one driver both appear |
| B5.2 | Stopping one stops **the correct one** |
| B5.3 | Recovery after app restart selects deterministically, and does not flap between polls |

## B6 · Access-code policy

| # | Item |
|---|---|
| B6.1 | Invite TTL behaves as configured; an expired code is refused |
| B6.2 | A consumed code cannot be reused |
| B6.3 | Driver login is rate-limited — **currently outstanding**; if unlanded, record it as a known beta gap |
| B6.4 | Tap intents expire; a far-away tap is refused **server-side** |

## B7 · Monitoring and cleanup

| # | Item |
|---|---|
| B7.1 | Queue depth, consumer lag and DLQ visible before hardware testing begins |
| B7.2 | An alert fires on DLQ growth |
| B7.3 | A documented way to purge beta test data without touching schema |
| B7.4 | Beta Worker version ids recorded per deploy |

## Beta stop conditions

Stop and fix before continuing if: a real customer's data appears in beta;
cross-tenant isolation fails (B3.5); a stop command is accepted but the charger
keeps charging; displayed cost disagrees with the independent calculation (B4.6);
or beta writes reach the production database.

---

# Production release gate

Everything in the beta gate, **plus** the following. Production is not "beta with
more confidence" — it adds obligations beta does not carry.

## P1 · The commit

| # | Item | Type |
|---|---|---|
| P1.1 | The commit being released is **byte-identical** to the one beta tested | 📋 |
| P1.2 | `production` is a **fast-forward** from that exact commit — `rev-list --left-right --count` shows `0 N` | 📋 |
| P1.3 | An annotated release tag marks it | ⚙️ |
| P1.4 | Excluded commits confirmed absent (`4fe0a95`, `30fa407`, `5311cbd`) | 📋 |
| P1.5 | No environment-specific patch exists on `production` that is not on `main` | 📋 |

**P1.5 is the invariant that makes "beta-tested" mean anything.** A branch that
differs by even one config line is a fork, and beta tested something else.

## P2 · Production resources

| # | Item | Type |
|---|---|---|
| P2.1 | `straumvakt-web` / `straumvakt-api` deployed and smoke-tested on workers.dev | 📋 |
| P2.2 | Production secrets set **by name**, from the source of truth, never copied through a terminal | 🔒⚙️ |
| P2.3 | **No beta secret value is reused** | 📋 |
| P2.4 | Production Hyperdrive confirmed pointing at the **production** database | 📋 |
| P2.5 | Production queues, DLQs and R2 bucket exist and are distinct from beta's | 📋 |
| P2.6 | Service bindings resolve to production Workers, not beta ones | 📋 |

**P2.4 and P2.6 are the two that fail silently.** A production Worker bound to
the beta database looks perfectly healthy while mixing customer and test data.

## P3 · Database

| # | Item | Type |
|---|---|---|
| P3.1 | Production database is a **separate Neon project** | 🔒⚙️ |
| P3.2 | Migrations replay cleanly **from scratch** — the reconciled set, 47 recorded | 📋 |
| P3.3 | Backup branch taken immediately before cutover | 🔒⚙️ |
| P3.4 | **No beta/test organisation, driver or session is copied in** | 📋 |
| P3.5 | Migration history is accurate — no `resolve --applied` shortcuts carried forward | 📋 |

P3.2 depends on the [migration reconciliation](2026-08-09-migration-history-reconciliation.md)
having been done on beta first.

## P4 · Domain cutover

Per the [cutover runbook](2026-08-09-domain-and-worker-cutover-runbook.md).

| # | Item | Type |
|---|---|---|
| P4.1 | `beta.straumvakt.org` live **before** the brand domain moves | 📋 |
| P4.2 | Current beta Worker **version id captured** — the rollback target | 📋 |
| P4.3 | Custom-domain attachment recorded before the change | 📋 |
| P4.4 | Cutover window scheduled, not discovered | 📋 |
| P4.5 | TLS verified independently after the move | 📋 |
| P4.6 | Mobile's pinned API host still resolves | 📋 |

## P5 · Legal and retention

| # | Item |
|---|---|
| P5.1 | Privacy policy and terms reachable from the product |
| P5.2 | Data-retention policy defined for sessions, meter evidence and audit logs |
| P5.3 | GDPR request path exists — access, export, erasure |
| P5.4 | Evidence-bucket retention configured per ADR 0018 Decision 3 |
| P5.5 | Personal data is not in logs — sampled review |

**P5 has no beta equivalent**, which is exactly why the two gates are separate
documents. Beta can run without any of it; production cannot.

## P6 · Support readiness

| # | Item |
|---|---|
| P6.1 | A named person is reachable when a customer cannot charge |
| P6.2 | Support can identify a driver, their org and their sessions **without database access** |
| P6.3 | Incident ownership assigned (below) |
| P6.4 | A customer-facing status channel exists |

**P6.2 is a product requirement disguised as an operations one.** If support
needs a DBA to answer "why did my charge fail", every incident escalates.

## P7 · Rollback readiness

| # | Item |
|---|---|
| P7.1 | Worker version id recorded — **primary rollback unit** |
| P7.2 | Neon backup branch exists with a recorded parent LSN |
| P7.3 | Custom-domain re-attach procedure rehearsed at least on paper |
| P7.4 | Beta Worker left **deployed and warm** through the bake period |
| P7.5 | Rollback is **ungated** — no approval required to execute it |

## Production stop conditions

Abort and roll back if: the released commit differs from the beta-tested commit;
a production Worker resolves to beta data (P2.4/P2.6); either brand hostname
fails to serve or its TLS is invalid; the API stops returning `401` on an
unauthenticated `/api/admin/me`; a charger transaction is lost during cutover;
`_prisma_migrations` disagrees with disk; or any beta identity is found in
production.

---

## Incident ownership

| Stage | Owner | Escalation |
|---|---|---|
| Pre-cutover verification | release owner | Andri |
| Cutover window | release owner, hands on keyboard | Andri |
| First 24h after | on-call | Andri |
| Charger/field issues | operations | site host |
| Data incident | **Andri directly** | legal |
| Rollback decision | **whoever is on call — no approval needed** | inform after |

The last row is deliberate. Every other row can wait for a conversation; a
rollback cannot, and a gate that delays recovery is a liability, not a control.
