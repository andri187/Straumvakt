# Virtual charger — OCPP 1.6J simulator

**Status:** development tool reference (not a production integration).
**Last verified:** 2026-05-03.
**Used by:** Straumvakt engineers iterating on the gateway / api hot
path who don't want to wait 30s for a real charger's heartbeat to
verify a change.
**Source:** [`apps/api/scripts/virtual-cp.ts`](../../apps/api/scripts/virtual-cp.ts).

---

## 1. What it is

A 350-line TypeScript script that pretends to be a charger.
Connects to a Straumvakt gateway WSS endpoint, sends `BootNotification`,
loops `Heartbeat`, optionally drives a full charging session
(`StartTransaction` → `MeterValues` → `StopTransaction`). Replies
to inbound calls (`RemoteStartTransaction`, `Reset`, etc.) with
sensible Accepted defaults.

| Property | Value |
|---|---|
| OCPP version | 1.6J (JSON over WebSocket) |
| Auth modes | Basic (URL-embedded) or no-auth |
| Concurrency | One process = one charger |
| Runtime | Node 22+ (built-in WebSocket) |
| Dependencies | Zero (no npm install needed) |
| TypeScript | Strict — typechecks under apps/api/tsconfig.json |

It is **not**:
- A load-test simulator (Sprint 9 has a separate one for 4k load).
- A reference CSMS (that's [SteVe](./steve.md)).
- A protocol conformance tool (use OCA's tester suite).
- A frame inspector (use `wrangler tail` against the gateway).

It is a **deterministic developer dev-loop tool** — drive specific
frame sequences against the gateway and watch the consumer side.

## 2. Why it exists

Three uses, in order of frequency:

1. **Validate gateway/api changes locally.** Push a change, deploy
   to staging, run the virtual charger, watch tail. Ten-second
   cycle vs the 30-second real-charger heartbeat wait.
2. **Drive specific scenarios.** "What happens when a charger sends
   a Heartbeat but the consumer has already DLQ'd one of its
   events?" — set up the scenario, run the sim, see.
3. **Smoke-test deploy ordering.** Deploy ordering during cutover
   (Sprint 5 → 6 queue cutover, future archive queue addition) is
   easier to validate when the simulator can drive a known-good
   sequence in seconds.

## 3. Usage

```powershell
# From repo root, against staging
npx tsx apps/api/scripts/virtual-cp.ts `
  --gateway=wss://straumvakt-ocpp-staging.straumvakt.workers.dev `
  --identity=zpr-test-001 `
  --password=<plaintext OCPP password> `
  --duration=120
```

For no-auth installations (where the operator has flipped the
no-auth path per Sprint 5.8), omit `--password`.

| Flag | Default | Purpose |
|---|---|---|
| `--gateway` | required | wss:// URL of the gateway worker (no trailing slash, no `/ocpp/...` suffix — the script appends the identity) |
| `--identity` | required | Identity-string the charger presents in the URL path AND Basic-Auth username |
| `--password` | unset | If set, sends `Authorization: Basic` header. Omit for no-auth installations. |
| `--vendor` | `Zaptec` | `chargePointVendor` in BootNotification |
| `--model` | `Pro` | `chargePointModel` |
| `--serial` | `--identity` | `chargePointSerialNumber` |
| `--heartbeat-interval` | `30` | Seconds between Heartbeat frames. Server may override via BootNotification response. |
| `--status` | `Available` | Initial StatusNotification status |
| `--session` | off | Drive a full charging session over ~70s (Auth → Start → 6×MeterValues @ 10s → Stop) |
| `--duration` | infinite | Exit after N seconds |

## 4. Common scenarios

### 4a. Boot + heartbeat loop (default)

```powershell
npx tsx apps/api/scripts/virtual-cp.ts `
  --gateway=wss://straumvakt-ocpp-staging.straumvakt.workers.dev `
  --identity=zpr-test-001 `
  --password=<plaintext> `
  --duration=120
```

Two-minute run. Sends BootNotification + initial StatusNotification,
then a Heartbeat every 30s. Useful for validating ingest is live
and the gateway's auth path accepts the credentials.

### 4b. Full session (driver actually charges)

```powershell
npx tsx apps/api/scripts/virtual-cp.ts `
  --gateway=wss://straumvakt-ocpp-staging.straumvakt.workers.dev `
  --identity=zpr-test-001 `
  --password=<plaintext> `
  --session `
  --duration=180
```

Three-minute run that includes a complete charge cycle. Useful for
validating the session projection (Sprint 5's
`session.started`/`session.meter_value_recorded`/`session.ended`
events). Watch `wrangler tail hlada-api-staging` for `[ocpp-q]
consumed` lines with `eventType: charger.transaction_started`,
`session.meter_value_recorded`, `session.ended`.

### 4c. No-auth installation

```powershell
npx tsx apps/api/scripts/virtual-cp.ts `
  --gateway=wss://straumvakt-ocpp-staging.straumvakt.workers.dev `
  --identity=zpr-noauth-001
```

Tests the Sprint 5.8 no-auth path. The script omits the
`Authorization` header. Gateway should accept on identity-string
match alone (per ADR 0017's no-auth carve-out).

### 4d. Multi-charger fan-out

PowerShell — start three concurrent simulators in separate windows:

```powershell
1..3 | ForEach-Object {
  Start-Process powershell -ArgumentList "-NoExit", "-Command", "npx tsx apps/api/scripts/virtual-cp.ts --gateway=wss://straumvakt-ocpp-staging.straumvakt.workers.dev --identity=zpr-test-00$_ --password=<plaintext>"
}
```

For more than ~10 chargers concurrently use the Sprint 9 load-test
simulator instead — this script wasn't designed for that scale.

## 5. What the gateway sees

When the simulator connects with valid credentials, gateway tail
(`npx wrangler tail straumvakt-ocpp-staging`) shows:

```
{ event: { request: { url: "...ocpp/zpr-test-001", ... }, response: { status: 101 } } }
```

(101 Switching Protocols — WebSocket upgrade succeeded.)

Then api tail (`npx wrangler tail hlada-api-staging`) shows the
queue consumer line per ingested frame:

```
[ocpp-q] consumed { eventId, eventType: "ocpp.raw.BootNotification", recorded: true, lagMs: ... }
[ocpp-q] consumed { eventId, eventType: "ocpp.raw.StatusNotification", recorded: true, lagMs: ... }
[ocpp-q] consumed { eventId, eventType: "ocpp.raw.Heartbeat", recorded: true, lagMs: ... }
```

If `recorded: false`, the eventId already existed (idempotency
hit). Re-running the simulator with the same `--identity` and
fresh boot is the easy way to verify replay safety.

## 6. Interpreting failures

| Symptom | Probable cause | Fix |
|---|---|---|
| `ws_close { code: 1006 }` immediately on connect | TLS handshake or DNS fail | Verify `--gateway` host is correct; try `curl` against it |
| `ws_close { code: 1006 }` after 401 | Wrong password OR identity-string mismatch | Verify against the installation's OCPP password panel; check `wrangler tail` gateway-side for the upgrade attempt |
| `call_timeout: BootNotification` after 30s | Gateway accepted upgrade but DO didn't reply | Likely a queue consumer issue; check `hlada-api-staging` tail |
| `call_error: ... FormationViolation` | Frame shape rejected by the gateway parser | Open the script and check the payload shape against OCPP 1.6J spec |
| Heartbeat fires but no `[ocpp-q] consumed` line | Producer-side queue accept failed | Tail gateway for `[ocpp-gw] queue.send failed`; if seeing it, the queue binding is wrong |

## 7. Limitations

- **Single charger per process.** No fan-out built-in. Use Sprint
  9's load-test simulator for >10 chargers.
- **OCPP 1.6J only.** No 2.0.1 support. Sprint DC1 will need a
  separate simulator (CitrineOS / EVerest based).
- **Inbound CSMS messages get generic Accepted responses.** No
  state-machine simulation — if you send `RemoteStartTransaction`
  the script Accepts but doesn't actually flip into `Charging`.
  Use `--session` for the actual charging flow.
- **No CallError on protocol violations.** Real chargers are
  sometimes pickier about CSMS responses than this simulator is.
  Cross-check with [SteVe](./steve.md) for protocol-correctness
  questions.
- **Energy values are linear ramp.** Real chargers ramp up + hold
  + ramp down. The simulator's MeterValues sequence is uniform
  1.5kWh-per-sample.

## 8. When to extend it

- **Add a scenario flag** when you find yourself driving the same
  manual sequence twice. Examples: `--scenario=offline-burst`
  (no Heartbeat for 5 min then a flood of frames),
  `--scenario=idle-tag` (Authorize + StartTransaction with an
  unknown idTag).
- **Add a vendor profile** if you onboard a new charger model and
  want canonical BootNotification fields. Examples:
  `--vendor-profile=easee`, `--vendor-profile=chargeamps`.
- **Don't add concurrency.** That belongs in the Sprint 9
  load-test simulator. Keep this one a single-charger tool with
  zero deps.

## 9. Sources

- OCPP 1.6J spec — see [`../reference/integrations/ocpp-1.6j.md`](../reference/integrations/ocpp-1.6j.md)
  if it lives there.
- Sister tool: [`steve.md`](./steve.md) — reference CSMS for
  cross-checking gateway behaviour against an industry baseline.
