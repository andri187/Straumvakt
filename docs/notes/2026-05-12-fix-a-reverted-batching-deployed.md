# 2026-05-12 → 2026-05-13 — Fix-A redeployed + CDR reconciliation live

**Update 2026-05-13 ~01:25 UTC** — Fix-A is back on, CDR reconciliation
committed and deployed, end-to-end vcp-001 session test verified all
handlers firing (Boot mirror, StatusNotification → connector_status,
StartTransaction → session row, StopTransaction → tariff resolution
+ ledger write). 9 kWh test session costed at 194.97 kr through the
Veitur AD1 + N1 retailer chain. No duplicate sessions, no OOM.

Live worker: `hlada-api-staging` version `c172c781-b7e1-4d19-adb8-4c...`
Live commits at HEAD: `[Sprint 9] zaptec-session-sync - match-existing
OCPP row` + `Revert "Revert "...""`.

Original session summary below for context.

---

## Deployed state right now

| Worker | Live version | Notes |
|---|---|---|
| `hlada-api-staging` | `7aa1c968-00d7-47d4-9d8a-129f52bf2887` | Batching + Revert of fix-A |
| `straumvakt-ocpp-staging` (gateway) | unchanged | — |

`apps/api/wrangler.jsonc` — OCPP events consumer `max_batch_timeout` bumped
from 1s → 30s. Should drop Neon CU-hours ~50% overnight.

## What got reverted and why

Commit `7d991e1` reverts `2e3cd5b` (fix-A: 4 raw-frame projection handlers
for Boot / StatusNotification / StartTransaction / StopTransaction).

Fix A worked technically — `connectors.status` populated for the first
time, driver attribution via idTag fired, no handler throws on real traffic.

But it introduced **duplicate session rows** at Dalvegur because BOTH
writers were creating ChargeSession entries for the same plug-in event:

- Zaptec REST CDR sync → row with `id_tag = NULL`
- My new `onOcppRawStartTransaction` → row with `id_tag = EE43C609263CC7`

Ledger upserts on `session_id` (unique per row), so each unique session
row got its own ledger entry → **billing ledger over-counted by 2×** for
new Dalvegur sessions. Reverted to avoid overnight accumulation.

## Tomorrow's first move — CDR-matches-OCPP reconciliation

The fix is to make `zaptec-session-sync.ts` (REST CDR poller) update an
existing OCPP-side ChargeSession row instead of creating a new one. Match
key options to investigate:

- Zaptec `transactionId` (int) — both OCPP frames AND Zaptec CDR carry it.
  Cleanest match key. Schema doesn't currently store it on ChargeSession;
  would need a new column `ocpp_transaction_id`.
- `chargingStationId + startedAt` window match — fuzzy, no schema change.

Recommended: add `ocpp_transaction_id Int? @unique` to ChargeSession,
populate from `onOcppRawStartTransaction`, then have the CDR sync look it
up before creating new rows.

Once reconciliation is in place, redeploy fix A — perfectly safe at that
point.

## Other findings worth following up

1. **AMQP CDR enrichment dead** — `latest_amqp_close = NULL` over last 24h
   across 39 sessions. StateId 723 (Zaptec CompletedSession) isn't landing
   on `charging.sessions`. Either the Fly consumer filters it out, or the
   handler in `zaptec-state-event.ts` has a join bug. Live samples (553)
   are flowing fine — 53 samples/5min.

1b. **Fly AMQP consumer is unreliable — needs rebuild or replacement.**
   Caught two silent feed deaths in one day:
   - Earlier: ~16h gap before recovery around 09:00 UTC 2026-05-12
   - Tonight: feed died again sometime after 09:07 UTC, still dead at 01:35
     UTC 2026-05-13 (16h since last sample)
   Symptom: machine alive on Fly dashboard, `live_session_samples` not
   advancing. Root cause: lack of robust reconnect-on-disconnect loop,
   likely token refresh, restart-on-stop policy, and health-check endpoint
   in the Fly consumer code. **Structural debt in the consumer**, not
   in this repo.

   Investigation steps next session (Fly consumer is in a separate repo):
   ```
   flyctl apps list
   flyctl status -a <consumer-app-name>
   flyctl logs -a <consumer-app-name>
   ```
   Immediate fix: `flyctl machine restart` or `flyctl deploy`.

   Real fix — two paths to choose between:
   - (i) Harden the existing Fly consumer: add AMQP reconnect loop,
     token refresh, health-check, `restart_policy = always`, deploy as
     hardened version. Estimated 1-2 days.
   - (ii) Migrate to Azure Functions with native Service Bus trigger.
     Eliminates connection management entirely. Cost: ~$0/mo at pilot
     scale. Estimated 0.5-1 day for the relay portion. Aligns with the
     "Azure Functions is the future-state answer" view captured in the
     "future-proof?" conversation earlier.

   **Blocks**: OCMF capture from AMQP, vehicle PLC MAC enrichment,
   live session samples, real-time `live_sessions.lastPowerW`. All
   silently degrades until consumer restored.

2. **AMQP StateId 513 missing from live_session_samples** — last 15 min
   showed only StateId 553. Power observations either aren't being
   forwarded by Fly consumer or aren't being persisted.

3. **Gateway WS subprotocol bug** — `gateway/src/identity-do.ts` doesn't
   echo `Sec-WebSocket-Protocol: ocpp1.6` back to the charger on accept.
   Real Zaptec firmware tolerates it; Node's built-in `WebSocket` is
   spec-strict and closes 1006. Worked around in `apps/api/scripts/virtual-cp.ts`
   by dropping the subprotocol arg. Proper fix is 3-4 lines in
   `identity-do.ts`.

4. **N1-1 connectivity flap** — `errorCode = WeakSignal` flapping with
   `NoError` every 1-30 min through the night. Validates the operator's
   manual annotation in the display name (`N1 - 1 < sló stanslaust út <`).
   Worth a maintenance visit; UI surface as an alert.

5. **Neon Free tier exhausted likely** — 24/7 OCPP heartbeats means
   compute never autosuspends; expected 100 CU-hr/mo budget burns in days
   at current load. Upgrade to Launch (~$25/mo usage-based) before any
   re-deploy of fix-A to remove Neon as a debug variable.

6. **10 ghost rows at Dalvegur** — 8 UUID-serial ghosts (orphan imports)
   + 2 real-serial ghosts (Zaptec dropped, kept with operator annotations).
   Decommissioned-by-omission logic already hides them in normal UIs;
   cleanup script is a low-priority chore.

## Operator-console UX backlog (2026-05-13 — discovered during onboarding the zpr074002 charger)

Operator tried to onboard a new charger at a newly-created site this
evening. The flow exposed several friction points. None are blockers
on their own; together they made a 2-minute task into a 30-minute one
plus a stuck physical charger.

### UX-1. Site → Installation → Charger chain is invisible

Operator created Site "Reykjavík HQ" under N1 ehf. Tried to attach a
charger directly to it — couldn't. The chain requires an Installation
between Site and Charger, but the operator console doesn't surface
"this site has no installation, create one" anywhere.

**Fix direction:** when a Site has no Installation, show a prominent
"Create Installation here" CTA on the site detail page. The claim
flow at `/chargers/new` should list "(no installation)" as a valid
selection AND show a warning that future driver-attribution paths
expect an installation.

### UX-2. Claim flow doesn't auto-fill vendor/model/serial

Operator claimed pending discovery `zpr074002`. The identity string was
pre-filled, but Vendor, Model, and Serial were empty with placeholder
text ("Zaptec" / "Pro" / "ZAP-12345") that LOOKED filled. Create button
was disabled because three required fields were actually empty.

**Fix direction:** when claiming a Zaptec-shaped identity (`ZPR*` /
`ZCS*` / `ZAP*` prefix), pre-fill Vendor=`Zaptec`, Serial=`<identity-
string>.toUpperCase()`, and Model derived from the prefix (`ZPR`→`Pro`,
`ZCS`→`Go`). Brighten or remove placeholder text on the required
fields so they aren't mistaken for real values.

### UX-3. Claim flow ignores installation's no-auth status

This is the worst one. Operator claimed `zpr074002` under an
installation that's on the no-auth path. Create-charger generated a
Basic-Auth password regardless. Physical Zaptec was sending no Basic
Auth header. Result: gateway 403, charger stuck in pending_discoveries
loop, operator had to delete and re-investigate.

**Fix direction:** the `/api/admin/chargers` POST handler should
inspect the target installation's `enforce_authorize` flag at create
time. When `enforce_authorize=false`, write the new OcppIdentity row
with `authSecretHash=NULL` and skip the one-time password reveal step.
The operator gets a "this installation is no-auth, no password
needed" indicator on the success screen instead. Code path in
`apps/api/src/repositories/chargers.ts` `createCharger()`.

Workaround used tonight: `apps/api/scripts/seed-dalvegur-charger-
zpr074002.ts` — explicit no-auth provision plus pending_discovery
cleanup. Not a generalizable solution.

### UX-4. `/charge-log` Icelandic locale (already fixed in branch)

Numbers displayed with US separators (`1,234.56`). Fixed in
`src/app/(app)/charge-log/charge-log-table.tsx` — local fmtNumber +
fmtKwh + fmtIskMinor helpers. Pending push to staging branch.

### UX-5. Empty-Site initial state

New sites land in a state where almost nothing on the site detail
page is actionable until an Installation exists. The page should
include onboarding CTAs ("Create installation", "Move charger from
another site", etc.) explicitly rather than implying these actions
through empty tables.

## ADRs parked today (no decision yet)

- `docs/adr/0021-reference-catalogue-and-tariff-propagation.md` — Open
- `docs/adr/0022-driver-self-onboarding.md` — Open
- `docs/adr/0023-realtime-connector-status-propagation.md` — Proposed
  (gates on fix-A landing — ✓ done 2026-05-13)
- `docs/adr/0024-ble-proximity-authentication.md` — Open
  (threat model + design option to pick; Option A is the pragmatic
  pilot answer if (1)-(3) are the threats)

## Uncommitted work in working tree

Not committed yet — should be cleaned up in their own logical commits
tomorrow:

- `apps/api/scripts/virtual-cp.ts` (WS subprotocol fix)
- `apps/api/scripts/seed-vcp-sandbox.ts`
- `apps/api/scripts/amend-vcp-circuit.ts`
- `apps/api/scripts/probe-*.ts` (12 read-only probes)
- `apps/api/scripts/peek-dlq.ts`
- `docs/adr/0021..0023*.md`
- `apps/mobile/assets/images/Zaptec-logo-Black-e1678367286810.webp`
- `apps/api/src/repositories/zaptec-charger-status-sync.ts` (pre-existing
  uncommitted edit, unclear origin)

## DLQ state

- `straumvakt-ocpp-events-dlq-staging`: 1 stuck pre-existing message
  (double-stringified body, from 2026-05-11 08:50). Unrelated to today;
  ages out in ~3 days. Can drop or replay-with-unwrap.

## VCP sandbox

Provisioned and N1-driver-accessible. Full hierarchy:

- Property `Virtual Sandbox` (Straumvakt org)
- Site `Virtual Sandbox` (dso = Veitur AD1)
- Installation `VCP Lab` (retailer = N1, enforce_authorize=false)
- Circuit `Lab circuit 1` (32A, 3-phase)
- Charger `vcp-001` (no-auth OcppIdentity)
- Agreement → DriverGroup `N1 Drivers` → N1 Drivers User
- IdToken `STRMV-VCP-TEST-001` scoped to VCP Lab

Test drive with:

```powershell
cd apps/api
npx tsx scripts/virtual-cp.ts `
  --gateway=wss://straumvakt-ocpp-staging.straumvakt.workers.dev `
  --identity=vcp-001 `
  --session
```
