# Overnight readiness audit — main packet

**Status: audit only. No product behaviour, external state, or other worktree was changed.**

| | |
|---|---|
| Auditor | Claude B (independent readiness audit) |
| Worktree | `E:\Claude\Straumvakt-overnight-readiness` |
| Branch | `docs/overnight-readiness-audit` |
| Base | `4265364` — the **verified** release-candidate tip |
| Started | 2026-08-08T23:56:58Z |

Companion documents: [capability matrix](2026-08-09-product-capability-matrix.md) ·
[session lifecycle](2026-08-09-driver-session-lifecycle.md) ·
[acceptance plan](2026-08-09-launch-acceptance-plan.md) ·
[backlog](2026-08-09-prioritized-readiness-backlog.md) ·
[decision register](2026-08-09-release-decision-register.md)

---

## 0. Headline

**The backend is materially more complete than the driver app exposes.** The
single largest readiness gap is not missing capability — it is that shipped UI
makes numeric claims the API cannot support, while four working API endpoints
have no caller at all.

Three findings gate launch:

1. **`powerKw` is a hardcoded `0` that the app renders as "0.0 kW"** during an
   active charge. This is a confidently-wrong reading, not an unavailable state.
2. **`costIsk: 0` cannot distinguish *free* from *not yet priced*.** The app
   renders "0 kr" mid-session.
3. **`POST /api/driver/login` has no rate limiting**, while a neighbouring route
   uses a limiter binding literally named `DRIVER_LOGIN_RATE_LIMITER`.

---

## 1. Startup discrepancy (resolved)

The assignment expected the release candidate at `29c3317`. It is not there.

| Expected | Observed | Resolution |
|---|---|---|
| RC at `29c3317` | RC at **`4265364`** | `29c3317` **is** an ancestor of the RC. Claude A added 4 commits after the brief was written. Not a conflict — the brief was simply written earlier |
| — | Mobile worktree is at `29c3317` | The mobile branch forked at that commit and has **0 commits ahead**. Codex's work is entirely uncommitted (12 dirty files) |

I based this audit on the **verified** RC tip `4265364`, not the stated one.

## 2. Containment map

23 worktrees. **Only `dev/drizzle-ownership-and-market-harvest` exists on
origin** — 21 branches are local-only and unpushed. Full inventory in
[Appendix A](#appendix-a--worktree-inventory).

| Worktree | Branch | Tip | Dirty | Owner | Safe next action |
|---|---|---|---|---|---|
| `Straumvakt` | `dev/straumvakt-org-relaunch` | `10c292b` | **21** | shared | **Never edit.** Read-only reference |
| `Straumvakt-release-candidate` | `dev/relaunch-release-candidate` | `4265364` | 0 | **Claude A** | Read-only for me |
| `Straumvakt-mobile-product` | `dev/mobile-product-to-market` | `29c3317` | **12** | **Codex** | Read-only for me |
| `Straumvakt-overnight-readiness` | `docs/overnight-readiness-audit` | `4265364` | 0 | **me** | docs only |

## 3. Contradictions resolved

Two findings from my own earlier infra packet are **now fixed in the RC**. I am
recording them as resolved rather than carrying them forward.

| # | Earlier claim | Current state | Evidence |
|---|---|---|---|
| C1 | "`middleware.ts` is never compiled on Next 16 — all its auth gating is dead" | **FIXED.** `src/middleware.ts` exists in the RC | RC commit `14c1ce2` "[Sprint 9] move middleware.ts into src/ so it actually runs" |
| C2 | "real `AUTH_SECRET` committed in `.env.example`" | **FIXED.** Zero matches for `AUTH_SECRET=`/`ADMIN_EMAIL=`/`ADMIN_PASSWORD=` with values | RC commit `e7e8ad1` |
| C3 | Assignment: driver HTTP surface "includes … history, billing records, session detail" | **Partly true, lineage-dependent.** Those endpoints exist on the **API**; the RC mobile app does **not** call them. Codex's uncommitted work adds the screens | see §4 |
| C4 | API comment: "the app polls `/sessions/current` and reads live power from the charger-status surface" | **Contradicted.** `apps/mobile/lib/api/client.dart` has no charger-status endpoint at all | `apps/api/src/repositories/driver-sessions.ts` comment vs. mobile client |

## 4. The orphaned-endpoint gap

Sixteen driver endpoints are registered; the RC mobile app calls twelve.

| Endpoint | Line | Mobile caller in RC? |
|---|---|---|
| `GET /sessions/history` | `driver.ts:713` | ❌ none |
| `GET /invoices` | `driver.ts:740` | ❌ none |
| `GET /sessions/:id` | `driver.ts:759` | ❌ none |
| `GET /chargers/:id/pricing` | `driver.ts:829` | ❌ none |
| `GET /installations` | `driver.ts:816` | ❌ none |
| `POST /access-requests` | `driver.ts:867` | ❌ none |

**This is capability that exists and is unsurfaced — not capability that is
missing.** It also means these routes are reachable, authenticated surface with
no client exercising them, so they are untested in practice.

Codex's uncommitted work adds `charge_history.dart`, `session_detail.dart`,
`my_vehicle.dart` and `profile.dart` — precisely the screens that would consume
them. That work is the right shape; see [decision register](2026-08-09-release-decision-register.md).

## 5. Facts / inferences / unknowns

### Verified facts (source-cited)

| # | Fact | Evidence |
|---|---|---|
| F1 | `powerKw` is hardcoded `0` in the active-session read model | `apps/api/src/repositories/driver-sessions.ts` — `powerKw: 0,` in the `rows.map` |
| F2 | The mobile app renders it as a real value | `apps/mobile/lib/screens/active_session.dart:189-190` — `'${s!.powerKw!.toStringAsFixed(1)} kW'` |
| F3 | `costIsk` conflates null with zero | `minorToIsk()` returns `0` when `minor == null`; rendered at `active_session.dart:208-209` as `'… kr'` |
| F4 | `energyKwh` conflates null with zero the same way | `whToKwh()` returns `0` when `wh == null` |
| F5 | `POST /api/driver/login` has **no** rate limiting | `driver.ts:121` — bare handler, no middleware |
| F6 | `POST /api/driver/claim-invite` **is** rate-limited, 10/min by IP | `driver.ts:1029-1036`, binding `DRIVER_LOGIN_RATE_LIMITER` |
| F7 | Driver tokens: access TTL 1h, refresh TTL 30d, stateless HMAC, no session table | `driver.ts:14-16` |
| F8 | `GET /sessions/:id` returns **404, not 403**, for another driver's session | `driver.ts:759-783`, deliberate and commented |
| F9 | Raw OCMF / 723 envelopes are **never** exposed to drivers | `driver.ts` — `includeRaw` deliberately omitted |
| F10 | Stop requires an explicit `sessionId` (uuid) and a resolved OCPP `transactionId`; otherwise 409 | `driver.ts:617+`, `resolveStoppableSession()` |
| F11 | Tap intent has a server-side RSSI gate and a TTL | `driver-tap-intent.ts:27-28, 67-73` |
| F12 | BLE PIN release is audit-logged | `driver-charger-pin.ts:143` — `charger.ble_pin.released` |
| F13 | `/invoices` returns **charge sessions**, not invoice documents | `driver.ts:740-757` and its own comment |
| F14 | Money is stored minor-unit (`costIncVatMinor`, BigInt); for ISK minor == major | `driver-sessions.ts` `minorToIsk()` comment |
| F15 | Only `dev/drizzle-ownership-and-market-harvest` exists on origin | `git ls-remote` 2026-08-08T23:56Z |

### Strong inferences (consistent, not proven)

| # | Inference | Basis |
|---|---|---|
| I1 | The driver app will show "0.0 kW / 0 kr" for the whole of a live charge | F1+F2+F3; not observed on device |
| I2 | The four orphaned endpoints are effectively untested in production paths | no caller exists |
| I3 | `DRIVER_LOGIN_RATE_LIMITER` was intended for `/login` and landed on `/claim-invite` | the binding name vs. its use site |

### Unknowns (require access I do not have)

| # | Unknown | Blocked by |
|---|---|---|
| U1 | Cloudflare Git-integration state, deployed version, custom-domain retention, Hyperdrive target | no control-plane auth (unchanged from the infra packet) |
| U2 | Whether any driver has ever completed a session end-to-end in staging | requires authenticated observation; no login permitted |
| U3 | Device behaviour of BLE/NFC paths | requires hardware |
| U4 | Whether Codex's WIP fixes F1–F4 | uncommitted and moving; see §7 |

## 6. Security findings

Full detail in [the backlog](2026-08-09-prioritized-readiness-backlog.md). Ranked
by launch risk, not theory.

| # | Finding | Severity | Blocks launch? |
|---|---|---|---|
| S1 | `POST /api/driver/login` unthrottled — credential stuffing against driver accounts. Admin login *is* throttled (`ADMIN_LOGIN_RATE_LIMITER`), so this is an inconsistency, not an unconsidered design | **High** | **Yes** |
| S2 | Refresh-token TTL 30d, stateless, no revocation list — a leaked refresh token is valid for a month with no server-side kill switch | Medium | No, but needs a decision |
| S3 | `advanced-grant` / `ble-pin` expose charger-privileged material to a driver-audience token. Audited (F12) and PIN never shown to the user, but the *grant* is driver-reachable | Medium | Decision — see decision register |
| S4 | Truthfulness: UI asserts measured values the API does not measure (F1–F4). A safety-adjacent product claim, not a memory-safety bug | **High** | **Yes** |
| S5 | Neon default-branch hazard — unqualified connections reach the abandoned `production` branch | Medium | No (operational discipline) |

**Positives worth recording**, because a review that only lists faults misleads:
404-not-403 on cross-driver reads (F8), raw meter envelopes withheld (F9),
stop-by-transactionId rather than guessing a connector (F10), server-side RSSI
gate rather than trusting the client (F11), and PIN release audited (F12). These
are deliberate, commented decisions.

## 7. Codex WIP — observed, not judged as final

12 dirty files, 0 commits, at 2026-08-09T00:0xZ. Read-only observation:

```
 M apps/mobile/lib/api/client.dart          (+120)
 M apps/mobile/lib/api/types.dart           (+158)
 M apps/mobile/lib/screens/active_session.dart (568 changed)
 M apps/mobile/lib/screens/home.dart        (+232)
 ?? charge_history.dart  session_detail.dart  my_vehicle.dart  profile.dart
```

Direction is correct: it surfaces the orphaned endpoints and rewrites the exact
screen that carries the F1–F4 truthfulness problem. **Acceptance criteria for it
are in the [acceptance plan](2026-08-09-launch-acceptance-plan.md) §M.** I did not
review it as a finished diff because it is mid-flight.

## 8. Scale readiness (Phase 9, summary)

Assessed from architecture, not load tests. **Design capacity ≠ tested capacity;
nothing here has been load-tested.**

| Layer | 1k connectors | 4–5k connectors |
|---|---|---|
| OCPP WebSocket ownership (gateway DO) | fine | **Durable-Object fan-out is the first thing to model** — connection ownership is per-charger |
| Hot-path ingest via queues | fine | queue depth + consumer concurrency become the bottleneck before Postgres does |
| Postgres via Hyperdrive | fine | connection ceiling: Workers mint a client per request; Hyperdrive pools, but `max: 1` per client |
| Session projection / cost | fine | batch cost projection is the likely lag source, and it is what drivers see |
| Worker CPU limit `cpu_ms: 50` | fine | any per-request fan-out over thousands of rows will exceed it |

A load-test plan is in the [backlog](2026-08-09-prioritized-readiness-backlog.md)
under P2. **No live load test was run.**

---

## Appendix A — worktree inventory

| Worktree | Branch | Tip | Dirty | On origin |
|---|---|---|---|---|
| `Straumvakt` | `dev/straumvakt-org-relaunch` | `10c292b` | 21 | no |
| `Straumvakt-release-candidate` | `dev/relaunch-release-candidate` | `4265364` | 0 | no |
| `Straumvakt-mobile-product` | `dev/mobile-product-to-market` | `29c3317` | 12 | no |
| `Straumvakt-driver-parity` | `dev/drizzle-ownership-and-market-harvest` | `2b7ebf6` | 0 | **yes** |
| `Straumvakt-infra-verify` | `docs/infra-release-safety-packet` | `856ebe2` | 0 | no |
| `Straumvakt-relaunch-integration` | `dev/relaunch-integration` | `14c1ce2` | 0 | no |
| `Straumvakt-n1` | `dev/n1-org-landing` | `52e3b32` | 0 | no |
| `Straumvakt-employee-landing` | `dev/employee-landing` | `9a6c6f5` | 0 | no |
| `Straumvakt-secret-hygiene` / `-v2` | `dev/secret-hygiene`, `-v2` | `776552f`, `174475f` | 0 | no |
| `Straumvakt-trunk-proposal` | `docs/repo-trunk-proposal` | `5324241` | 0 | no |
| `Straumvakt-catchup-runbook` | `docs/staging-catchup-runbook` | `30fa407` | 0 | no |
| `Straumvakt-docs-ci` | `docs/ci-and-custom-domain` | `d4e2e07` | 0 | no |
| `Straumvakt-w1-checkaudit` | `fix/wire-work-view-check` | `b2250e5` | 0 | no |
| `Straumvakt-migrations-config` | `fix/prisma-migrations-path` | `6b9246e` | 0 | no |
| `Straumvakt-housekeeping` / `-parity-fix` | `dev/housekeeping`, `dev/verify-invite-parity-tests` | `185e6da` | 0 | no |
| `Straumvakt-diag-drizzle` | `diag/fix-api-endpoints-drift` | `0a2943c` | 0 | no |
| `Straumvakt-rename-worker` | `dev/rename-prod-worker` | `4fe0a95` | 0 | no |
| `Straumvakt-audit-checks`, `-diag-p4c` | detached | `2b7ebf6`, `09b1333` | 0, 1 | — |
| `Straumvakt-docs-log` | `docs/relaunch-session-log-2026-08-08` | `5311cbd` | prunable | no |

**21 branches carry unpushed local commits.** Nothing is lost, but nothing is
backed up off this machine either.
