# Launch acceptance plan

Executable by a human team. Companion to
[the main packet](2026-08-09-overnight-readiness-audit.md).

**Nothing here was executed.** Cases marked 🔒 require explicit approval;
🔧 require hardware; 🗄 require a disposable Neon branch.

## Legend

| Mark | Meaning |
|---|---|
| 🔒 | needs Andri's approval (live login, production touch) |
| 🔧 | needs a physical charger and/or vehicle |
| 🗄 | needs a disposable Neon branch — **never** run against `staging` |

---

## A. Install, sign-in, resume

| # | Case | Prereq | Steps | Expected | Evidence | Pass criterion |
|---|---|---|---|---|---|---|
| AC-01 | Clean install → login | test driver account 🔒 | fresh install; sign in | 200; access + refresh stored | HAR + screenshot | tokens present, home renders |
| AC-02 | Token resume | AC-01 | kill app; reopen after >1 min | no re-login | screen recording | no login screen |
| AC-03 | Access-token expiry | AC-01, wait >1h | idle 1h; act | silent refresh via refresh token | HAR | no user-visible interruption |
| AC-04 | Refresh-token expiry | token aged >30d (or forged clock) | act | clean re-login prompt | log | no crash, no infinite loop |
| AC-05 | **Login throttling** | — | 50 wrong passwords, same IP | **429 after threshold** | HAR | **currently EXPECTED TO FAIL — see backlog P0-3** |

## B. Access, invite, approval

| # | Case | Expected | Pass criterion |
|---|---|---|---|
| AC-06 | Driver with no access | empty-access screen, no chargers | `empty_access.dart` renders; no leak of other orgs' chargers |
| AC-07 | Invite redemption | consume → access granted | driver appears in the org's driver group |
| AC-08 | Invite reuse | second consume rejected | single-use enforced |
| AC-09 | Pending approval | request visible to host_admin | **no mobile surface today** — P1 |
| AC-10 | Access to 1 vs many installations | picker appears only when >1 | `installation_picker.dart` |

## C. Session lifecycle — the critical block

| # | Case | Steps | Expected | Pass criterion |
|---|---|---|---|---|
| AC-11 🔧 | Manual start | select charger → start | 202, then "starting…" | **must not show "ended"** while awaiting the row |
| AC-12 🔧 | **Start-race grace** | start; poll before the session row exists | app holds a starting state ≥60s | **empty array ≠ ended** (lifecycle §4) |
| AC-13 🔧 | Command delay | charger slow to respond | bounded wait then clear failure | no silent hang |
| AC-14 🔧 | App killed mid-session | kill; reopen | session recovered from `/sessions/current` | correct elapsed time |
| AC-15 🔧 | Zero active sessions | idle driver | empty state | no phantom session |
| AC-16 🔧 | One active session | charging | one card | matches charger |
| AC-17 🔧 | **Multiple active sessions** | two chargers | both listed; stop targets the chosen one | **deterministic** — `sessionId` sent, correct one stops |
| AC-18 🔧 | Stop from app | stop | 202 → finishing → completed | charger actually stops |
| AC-19 🔧 | Stop with no transactionId | session lacking OCPP ref | **409 `no_transaction_id`**, clear message | no false success |
| AC-20 🔧 | Unplug at vehicle | pull cable | session completes server-side | app converges |
| AC-21 🔧 | Charging complete, still plugged | full battery | state reflects it | not shown as actively charging |

## D. Telemetry truthfulness — currently expected to FAIL

| # | Case | Expected **after** the P0 fix | Current behaviour |
|---|---|---|---|
| AC-22 🔧 | **Live power** | "—" or hidden while unmeasured | **shows "0.0 kW"** ❌ |
| AC-23 🔧 | **In-flight cost** | "—" until priced | **shows "0 kr"** ❌ |
| AC-24 🔧 | Energy unavailable | "—" | shows "0.00 kWh" ❌ |
| AC-25 🔧 | Genuinely free session | "0 kr" **and** distinguishable from unpriced | indistinguishable ❌ |
| AC-26 🔧 | Cost arrives later | value appears post-projection | needs history screen (P1) |

**AC-22 to AC-25 are the launch gate.** They are expected to fail today; they
are the acceptance criteria for backlog item **P0-1**.

## E. Tap, BLE, NFC

| # | Case | Expected | Pass criterion |
|---|---|---|---|
| AC-27 🔧 | Tap near charger | intent accepted | RSSI ≥ threshold |
| AC-28 🔧 | Tap far from charger | **rejected server-side** | server gate fires even if client is patched |
| AC-29 🔧 | Tap wrong charger | no access → refused | no cross-tenant start |
| AC-30 🔧 | Expired intent | TTL passed → rejected | replay refused |
| AC-31 🔧 | Intent cancel | cancel → cannot be used | `DELETE /tap-intent/:id` |
| AC-32 | BLE permission denied | graceful degrade to manual | no crash, actionable copy |
| AC-33 🔧 | BLE offline / reconnect | recovery without restart | watchdog behaviour |
| AC-34 🔧 | **Advanced grant** | driver-token reachable — confirm intended | audit row written |

## F. Billing surfaces

| # | Case | Expected | Pass criterion |
|---|---|---|---|
| AC-35 | History list | ledger-projected sessions | matches `/sessions/history` |
| AC-36 | Session detail | totals; **no raw OCMF** | drivers never see raw envelopes |
| AC-37 | Cross-driver detail | **404, not 403** | no existence leak |
| AC-38 | Label truthfulness | list is **not** called "Invoices" | see P0-4 |
| AC-39 | History vs billable disagreement | explained in UI or one source used | two screens must not silently disagree |

## G. Cross-tenant negatives — must all pass

| # | Case | Expected |
|---|---|---|
| AC-40 | Fetch another driver's session by id | **404** |
| AC-41 | Stop another driver's session | rejected — ownership is in the query predicate |
| AC-42 | Charger outside driver's group | not listed; start refused |
| AC-43 | Admin-audience token on driver route | rejected |
| AC-44 | Driver token on `/api/admin/*` | rejected |

## H. Resilience, i18n, accessibility

| # | Case | Pass criterion |
|---|---|---|
| AC-45 | Airplane mode mid-session | clear offline state; recovery on reconnect |
| AC-46 | Flaky network | no duplicate start commands |
| AC-47 | Locale fallback (`is` ↔ `en`) | no raw keys, no mixed-language screens |
| AC-48 | Text scaling 200% | no clipped text on the session card |
| AC-49 | Small (5") / large (7") Android | no overflow |
| AC-50 | Screen-reader labels | numeric tiles announce value **and** unit |

## I. Deployment preflight 🔒

| # | Case | Pass criterion |
|---|---|---|
| AC-51 🔒 | Cloudflare Git-integration state recorded | resolved before any push |
| AC-52 🔒 | Deployed version ID captured | rollback target exists |
| AC-53 🔒 | Custom domains retained post-deploy | both hostnames + valid TLS |
| AC-54 🗄 | Migration status against a **disposable** branch | 47 found, up to date |
| AC-55 🔒 | Neon backup branch exists | restore point recorded |

## M. Acceptance for Codex's mobile work

Not a review of the diff — criteria for when it is done.

| # | Criterion |
|---|---|
| M-1 | No screen renders a numeric value the API did not measure (AC-22–25) |
| M-2 | `my_vehicle.dart` asserts **no** plate/battery/range/Autocharge state without a backing API |
| M-3 | Preserved prototype assets are not deleted, merely not presented as live data |
| M-4 | A start-race grace state exists (AC-12) |
| M-5 | History/detail screens consume the **existing** endpoints; no new backend contract assumed |
| M-6 | The billable list is not labelled "Invoices" |
| M-7 | `widget_test.dart` covers the unavailable-value rendering path |
