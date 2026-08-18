# Driver product capability matrix

Companion to [the main packet](2026-08-09-overnight-readiness-audit.md). Every
row is source-cited against the release candidate at `4265364`.

## Status vocabulary

These are **not** synonyms and are used strictly:

| Term | Means |
|---|---|
| `implemented` | code exists |
| `wired` | a caller reaches it end-to-end |
| `tested` | an automated test exercises it |
| `device-verified` | run on real hardware |
| `deployed` | present in the running Worker |
| `operationally proven` | observed working in production with real users |

**Nothing in this product is `operationally proven`.** No driver flow was
observed end-to-end (no live login permitted in this audit).

## Three lineages compared

- **RC** = release candidate `4265364` (`apps/mobile` as committed)
- **Codex** = `dev/mobile-product-to-market` **uncommitted** working tree
- **Web** = archived driver portal, `archive/straumvakt-org-console-2026-08-08/app/driver/`

## The matrix

| # | Capability | API route | Mobile caller (RC) | Codex WIP | Web (archived) | Status | Launch decision |
|---|---|---|---|---|---|---|---|
| 1 | Sign-in | `POST /api/driver/login` `driver.ts:121` | `client.dart:32` | rewritten | yes | **wired**, not rate-limited | **Fix S1 first** |
| 2 | Token resume | stateless HMAC, access 1h / refresh 30d `driver.ts:14-16` | yes | yes | yes | **wired** | ship |
| 3 | Profile read | `GET /me` `driver.ts:199` | `client.dart:50` | yes | yes | **wired** | ship |
| 4 | Profile update / locale | `PATCH /me` `driver.ts:784` | `client.dart:193` | `profile.dart` (new) | yes | **wired** (RC has no screen) | ship with Codex screen |
| 5 | Invite redemption | `POST /api/public/invites/consume` `client.dart:99`; also `POST /redeem-invite` `driver.ts:1158`, `POST /claim-invite` `driver.ts:1029` | yes | yes | yes | **wired — but three paths exist** | **Decide which is canonical** |
| 6 | Pending approval | `POST /access-requests` `driver.ts:867` | ❌ none | ❌ | yes | **implemented, unsurfaced** | P1 |
| 7 | Charger discovery | `GET /chargers` `driver.ts:238` | `client.dart:211` | yes | yes | **wired** | ship |
| 8 | Installation listing | `GET /installations` `driver.ts:816` | ❌ none | ? | yes | **implemented, unsurfaced** | P1 |
| 9 | BLE proximity | client-side scan + RSSI | `charger_settings/` | yes | n/a | **implemented**, not device-verified here | P0 gate below |
| 10 | Tap intent | `POST /tap-intent` `driver.ts` + `driver-tap-intent.ts` | `client.dart:247`, `:272` | yes | n/a | **wired**, server-side RSSI gate | ship if §9 verified |
| 11 | Manual session start | `POST /start-session` `driver.ts:450` | `client.dart:70` | yes | yes | **wired** | ship |
| 12 | Current-session recovery | `GET /sessions/current` `driver.ts:696` | `client.dart:145` | rewritten | yes | **wired** | ship |
| 13 | Multiple concurrent sessions | returns `{sessions:[…]}`, array | app reads array | rewritten | yes | **implemented**; product policy undefined | **Decide** |
| 14 | Live power (kW) | **none — hardcoded `0`** | renders `0.0 kW` `active_session.dart:189` | rewritten | — | **PLACEHOLDER / UNSAFE CLAIM** | **P0 blocker** |
| 15 | Live energy (kWh) | `energyWh` real, but null→0 | renders | rewritten | yes | **partial** — null indistinguishable from zero | P0 (display rule) |
| 16 | Live cost (ISK) | null-until-stop → 0 | renders `0 kr` | rewritten | yes | **PLACEHOLDER / UNSAFE CLAIM** | **P0 blocker** |
| 17 | Elapsed time | `startedAt` real | yes | yes | yes | **wired** | ship |
| 18 | Connector state | `status` string, hardcoded `"Charging"` in read model | yes | rewritten | yes | **partial** — one literal value | P1 |
| 19 | Stop session | `POST /stop-session` `driver.ts:617` | `client.dart:169` | yes | yes | **wired**, deterministic (requires `sessionId`) | ship |
| 20 | Completed settlement | ledger via `/sessions/history` | ❌ none | `charge_history.dart` | yes | **implemented, unsurfaced** | P1 |
| 21 | Activity / history | `GET /sessions/history` `driver.ts:713` | ❌ none | `charge_history.dart` | yes | **implemented, unsurfaced** | P1 |
| 22 | Session detail | `GET /sessions/:id` `driver.ts:759` | ❌ none | `session_detail.dart` | yes | **implemented, unsurfaced** | P1 |
| 23 | "Invoices" | `GET /invoices` `driver.ts:740` — returns **charge sessions** | ❌ none | ? | yes | **misnamed** — not invoice documents | **Rename before shipping** |
| 24 | Pricing preview / tariff | `GET /chargers/:id/pricing` `driver.ts:829` | ❌ none | ? | yes | **implemented, unsurfaced** | P1 |
| 25 | Operator/host context | via charger payload | partial | ? | yes | **partial** | P2 |
| 26 | RFID / tokens | `IdToken` model exists | ❌ none | ❌ | partial | **backend only** | P2 |
| 27 | Vehicle profile | **no vehicle-account API** | `number_plate.dart` prototype | `my_vehicle.dart` (new) | ❌ | **PLACEHOLDER** | **P0 — see below** |
| 28 | Autocharge / EVCCID / EMAID | ingest-side only; no driver binding flow | ❌ | ❌ | ❌ | **not a driver capability** | park |
| 29 | Charger BLE settings | `GET /chargers/:serial/ble-pin`, `POST /advanced-grant` | `client.dart:301`, `:333` | ? | ❌ | **wired** — driver-reachable charger privilege | **Decide IA placement** |
| 30 | Notifications | none found | ❌ | ❌ | ❌ | **absent** | park |
| 31 | Support / privacy / terms | `menu_drawer.dart` | partial | rewritten | yes | **partial** | P1 — required for store listing |

## The three P0 truthfulness rows, stated plainly

Rows **14, 16, 27** all share one failure mode: **the UI asserts a fact the
system does not know.**

- Row 14/16 — `powerKw: 0` and `costIsk: 0` are emitted by
  `driver-sessions.ts` unconditionally, and rendered by
  `active_session.dart:189-209` as though measured. A driver mid-charge sees
  **"0.0 kW · 0 kr"**. That reads as *nothing is happening and it is free*.
- Row 27 — the vehicle configurator asserts make, plate, battery, range, year and
  Autocharge state with **no backing vehicle-account API**. Nothing in
  `apps/api` serves a driver vehicle profile.

The fix for 14/16 is not necessarily backend work. `null` is already available
in the DTO shape — the read model chooses `0` over `null`. **Emitting `null` and
having the app render "—" would make the app truthful without any new data
source.** That is a small, well-scoped change owned by whoever owns
`driver-sessions.ts`, and it is the highest value-per-line change in this audit.

## What is genuinely ready

Sign-in, token resume, profile, charger discovery, manual start, current-session
recovery, elapsed time, and stop are all `wired` and internally coherent.
**A driver can find a charger, start, see it running, and stop it.** That is a
real product. The gap is that the app decorates it with numbers it cannot back.
