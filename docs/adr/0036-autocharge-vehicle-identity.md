# ADR 0036 — Autocharge: vehicle identity capture across transport layers

> **LEGACY — pre-market-focus historical reference. Not active canon. See /FOCUS.md. Load-bearing constraints extracted into the focus rules.**

**Status:** Proposed
**Date:** 2026-05-08
**Sprint:** Pulled forward — sequenced ahead of [ADR 0020](./0020-driver-access-via-driver-groups.md) implementation. Operator declared this priority 1 over the previously-planned Sprint 10 driver-access work and the Sprint 11 Forensic Capture roadmap.
**Relates to:** [ADR 0014](./0014-identity-tenancy-and-authorization.md) (drivers admin-created only — Autocharge does NOT bypass that; it identifies vehicles, not drivers), [ADR 0019](./0019-agreement-and-bearer-architecture.md) (billing — Autocharge attribution feeds future bearer-rule resolution), [ADR 0020](./0020-driver-access-via-driver-groups.md) (deferred — vehicle identity will eventually feed access decisions but not in this milestone), [docs/reference/integrations/zaptec.md](../reference/integrations/zaptec.md) §5 / §10 (StateId catalog).
**Rollback anchor:** `feat/agreement-architecture` HEAD on the day this ADR was written.

---

## Context

Driver attribution today is gated on the OCPP `idTag` field matching an `IdToken` row. For RFID-tapped sessions, that works. For everything else — anonymous free-vend at Dalvegur, Plug & Charge sessions before Zaptec ships PnC firmware, plain Mode-3 charging where no auth handshake fires — the session lands with `user_id = NULL` and no vehicle identity at all.

But the vehicle is **constantly emitting identifying data** at multiple layers, regardless of whether formal driver attribution succeeds:

1. **Link layer (HomePlug GreenPHY pairing)** — every EV with a PLC modem exchanges its modem MAC with the charger when cable is plugged in. Fires *before* any application-layer protocol runs. Persistent per-vehicle. Carries an OUI prefix that resolves to vendor (Tesla / VW / Polestar / Hyundai / etc.).
2. **Protocol layer (ISO 15118 PnC negotiation)** — the EV initiates a PnC authorization request (`StateId 724`) regardless of whether it succeeds. Failed attempts are tracked separately (`StateId 725`).
3. **Application layer (OCMF identity inside SignedSession)** — when PnC fully completes, the contract certificate (EMAID) and vehicle MAC (EVCCID) land in the OCMF identity block (IS / IT / ID / IF fields).

**We capture none of these today.** The `auth_id_*` columns exist (added earlier this session for the AMQP 723 handler) but no firmware in our fleet populates them. Per [docs/reference/integrations/zaptec.md](../reference/integrations/zaptec.md), Zaptec exposes the link-layer and protocol-layer signals as discrete StateIds — `953 MacPlcModuleEv`, `716 DetectedCar`, `714 CableType`, `921 PlcPibVersionEV`, `724 PlugAndChargeAuthorizeRequest`, `725 RejectedUserUuid` — but our AMQP consumer's whitelist doesn't include them.

The operator-stated requirement is concrete: **catch the vehicle's identifier at whatever layer it surfaces**, even when formal PnC fails. Make session-level "is this the same car that came back?" answerable. Make "is this an Audi or a Tesla?" answerable from the data alone, without driver self-identification.

This is **distinct from driver authorization** (ADR 0020 territory). Vehicle identity is a separate observation surface that informs, but does not gate, access decisions. A vehicle plugging in produces a Vehicle Identity record regardless of whether the driver has authorization.

## Decision

Capture vehicle identity at all three layers into a new set of columns on `charging.sessions`, with each layer treated as an independent confidence tier. Augment the existing OCMF identity capture to be **transport-agnostic** (works on both AMQP 723 and OCPP MeterValues paths). Add OUI vendor derivation. Treat the EV PLC MAC as PII with operator-only visibility by default.

### 1. Three confidence tiers

| Tier | Source | Confidence | What it tells us |
|---|---|---|---|
| **Link** | StateId 953 `MacPlcModuleEv` | Hardware-level — MAC of the EV's HomePlug modem. Fires whenever PLC pairing succeeds. | Persistent vehicle ID. OUI prefix → vendor name. Survives anonymous sessions. |
| **Protocol** | StateId 724 `PlugAndChargeAuthorizeRequest` + 725 `RejectedUserUuid` | Application-protocol — vehicle attempted ISO 15118 PnC, succeeded or failed. | Tells us "this vehicle is PnC-capable" + the rejected UUID when PnC denied. |
| **Application** | OCMF identity (`IS` / `IL` / `IT` / `ID` / `IF`) — via either AMQP 723 OR OCPP MeterValues `signedMeterData` | Cryptographically-signed identity block. Includes EMAID (contract) and EVCCID (vehicle MAC, possibly redundant with link layer). | Auditable, billing-grade vehicle identity. Requires firmware that populates the OCMF identity slot. |

The tiers are independent — a session may light up some, all, or none. The session detail UI surfaces them as a nested confidence display.

### 2. Schema migration on `charging.sessions`

Additive columns (no existing column reshape):

```
ev_plc_mac                  text         -- link-layer EV PLC modem MAC, e.g. "B4:E6:2D:09:26:3C"
ev_plc_mac_oui_vendor       text         -- derived from first 3 bytes via OUI table, e.g. "Tesla"
ev_plc_pib_version          text         -- StateId 921 — EV-side PLC firmware
cable_type                  text         -- StateId 714 — Mode 3 / Type 2 / etc.
pnc_attempted               boolean      -- StateId 724 fired during this session
pnc_succeeded               boolean      -- nullable: true if PnC completed, false if rejected, null if not attempted
pnc_rejected_uuid           text         -- StateId 725 — UUID denied if PnC failed
```

Index: `(ev_plc_mac)` for vehicle-recurrence lookups. Partial index `WHERE ev_plc_mac IS NOT NULL` to keep it lean.

The existing `auth_id_*` columns continue to hold OCMF application-layer identity (added in the May 8 migration). No reshape.

### 3. OUI vendor lookup

Static IEEE OUI vendor registry shipped as a JSON file in `apps/api/src/lib/oui/oui-vendors.json` (~20 MB, ~50k entries). Refreshed quarterly from `https://standards-oui.ieee.org/oui/oui.csv`. Lookup helper:

```
lookupOuiVendor(mac: string): { vendor: string | null; oui: string | null }
```

Returns the vendor name normalized to a short form (`"Tesla, Inc."` → `"Tesla"`, `"Bayerische Motoren Werke AG"` → `"BMW"`, etc.) via a small synonym map. Unknown OUIs return `null` with the OUI prefix preserved for forensic display.

### 4. OCPP MeterValues OCMF projection

New projection handler registered in [apps/api/src/queues/ocpp-events.ts](../../apps/api/src/queues/ocpp-events.ts). When `ocpp.raw.MeterValues` fires:

1. Walk `payload.request.meterValue[].sampledValue[]`
2. Find any sampledValue with `format === "SignedData"` and `value` starting with `"OCMF|"`
3. Parse via existing `parseOcmf()` from [apps/api/src/lib/ocmf.ts](../../apps/api/src/lib/ocmf.ts) — same parser already used for AMQP 723
4. Resolve the active session via OCPP `transactionId` → `charging.sessions`
5. Write the resulting OCMF gateway block + identity (auth_id_*) onto the matching session row
6. Idempotent — if columns already populated by AMQP 723 path, the OCPP projection is a no-op (last-write-wins is acceptable since both transports carry byte-for-byte identical OCMF, but we prefer the first arrival as canonical)

This closes the **transport-parity gap**: OCMF identity captures on both transports, no longer just AMQP. Becomes the primary path for Dalvegur post-OCPP-cutover.

### 5. idTag format classifier

Helper in `apps/api/src/lib/idtag-classifier.ts`:

```
classifyIdTagFormat(idTag: string): {
  detectedKind: "iso14443_4byte" | "iso14443_7byte" | "evccid_mac" | "emaid" | "key_code" | "unknown";
  confidence: "high" | "medium" | "low";
}
```

Heuristics:
- 8 hex chars → `iso14443_4byte` (MIFARE Classic 4-byte UID), confidence high
- 14 hex chars → `iso14443_7byte` (DESFire 7-byte UID, what Zaptec generates as Default ID tag), confidence high
- 12 hex chars matching IEEE MAC OUI prefix → `evccid_mac`, confidence medium (could be coincidental)
- Pattern `^[A-Z]{2}[A-Z0-9]{3}[A-Z0-9]{9}[A-Z0-9]$` (country + provider + instance + checksum) → `emaid`, confidence high
- All-numeric, 4-8 digits → `key_code`, confidence medium
- Default → `unknown`

Result is stored on `IdToken.kind` (existing column) when minting, and additionally surfaced inline on the session detail page when the idTag's detected_kind disagrees with the IdToken row's stored kind (operator alert: "this idTag was classified as EMAID but stored as ISO14443 — possibly mis-tagged").

### 6. AMQP consumer extension (Fly-blocked path)

Whitelist additions in [apps/api/src/routes/internal/zaptec-state-event.ts](../../apps/api/src/routes/internal/zaptec-state-event.ts):

| StateId | Action |
|---|---|
| 953 `MacPlcModuleEv` | On observation: resolve active session for the charger (via `live_sessions` lookup) → write `charging.sessions.ev_plc_mac` + `ev_plc_mac_oui_vendor` (derived synchronously) |
| 716 `DetectedCar` | Plug-in event; emit to `charging.session_events` (when that table lands; for now log to event_log only) |
| 714 `CableType` | Write to `charging.sessions.cable_type` |
| 921 `PlcPibVersionEV` | Write to `charging.sessions.ev_plc_pib_version` |
| 724 `PlugAndChargeAuthorizeRequest` | Set `charging.sessions.pnc_attempted = true` for active session |
| 725 `RejectedUserUuid` | Set `charging.sessions.pnc_succeeded = false` + write `pnc_rejected_uuid` |

This phase requires the Fly consumer to be authenticating successfully against the API Worker. Once Fly is back, this lights up automatically — no code re-deploy needed beyond the consumer extension itself.

### 7. Session detail UI surfacing

New "Vehicle identity" section on `/charge-log/[id]`, immediately after the "Identification" (driver) section. Shows three layered cards:

- **Link layer**: PLC MAC (operator-visible) + OUI vendor badge ("Tesla") + EV PLC firmware version. Empty-state copy: *"No PLC pairing observed — likely a Mode-3-only EV without HomePlug modem, or AMQP feed silent."*
- **Protocol layer**: PnC attempt indicator (Yes/No) + result pill (Accepted / Rejected / Not attempted) + rejected UUID when applicable. Empty: *"No PnC attempt observed during this session."*
- **Application layer**: Existing OCMF identity block (the auth_id_* fields). Empty: as currently rendered.

A small "Confidence" pill at the top of the section: `Link` / `Link + Protocol` / `Link + Protocol + Application` depending on which layers populated.

### 8. Vehicle-recurrence panel

New `/vehicles/[mac]` page surfacing per-PLC-MAC history. Operator-only. Shows:

- All sessions where this MAC was observed (chargingStation, started_at, energy_kwh, driver if attributed)
- First-seen timestamp and chargers count
- Vendor badge (OUI lookup)
- Linked driver(s) — when sessions had user_id populated alongside this MAC, infer "this MAC belongs to this driver"

For non-privileged views (operator-staff dashboards, summary stats), MACs are redacted to last-3-bytes only (`xx:xx:xx:09:26:3C`).

### 9. Privacy treatment

The EV PLC MAC is **PII** — it identifies a specific physical vehicle, and by extension typically a specific household (vehicles are usually owned/leased per-household). Stricter than RFID UID treatment because RFID UID is operator-issued and revocable, whereas the PLC MAC is hardware-baked.

Decisions:

- Default visibility: **operator-only** (requires `member.read` permission minimum; non-operator views redact to last-3-bytes)
- GDPR right-to-be-forgotten: when a driver is deleted, every `charging.sessions.ev_plc_mac` linked to their `user_id` (via inferred recurrence — if the same MAC was seen on >50% of sessions where this driver was attributed) is anonymized via HMAC-SHA256 with a per-installation salt. Hashed values preserve recurrence-matching capability for the *operational* purpose of "is this the same vehicle?" while breaking back-linking to the original MAC.
- Privacy policy: addendum required mentioning that vehicle PLC MACs are observed, retained, and used for diagnostic recurrence-detection. Plain-language explanation: *"Your vehicle's wireless network ID is observed by the charger when you plug in, similar to how a Wi-Fi access point sees your phone's MAC."*
- No surfacing of full PLC MAC in customer-facing receipts or invoices — only operator/admin views.

### 10. The data flow at session time

```
Vehicle plugs in
       │
       ├─ HomePlug GreenPHY pairing succeeds
       │      → Charger publishes StateId 953 MacPlcModuleEv  ──►  AMQP topic
       │                                                              │
       │                                                              ▼
       │                                              Fly consumer ingests
       │                                                              │
       │                                                              ▼
       │                                          POST /api/internal/zaptec-state-event
       │                                                              │
       │                                                              ▼
       │                                              charging.sessions.ev_plc_mac ✓
       │                                              + ev_plc_mac_oui_vendor (sync)
       │
       ├─ EV initiates ISO 15118 PnC
       │      → StateId 724 PlugAndChargeAuthorizeRequest ──►  charging.sessions.pnc_attempted = true
       │      → Either:
       │              StateId 723 CompletedSession with OCMF identity → auth_id_* columns ✓
       │              OR
       │              StateId 725 RejectedUserUuid → pnc_succeeded = false, pnc_rejected_uuid ✓
       │
       └─ Charging starts → OCPP MeterValues frames flow
              → MeterValues.signedMeterData with OCMF blob → OCMF projection → auth_id_* (if not already populated)
              → idTag classification from Authorize.req → IdToken.detectedKind
```

After the session ends, the operator opens `/charge-log/[id]` and sees:

```
VEHICLE IDENTITY                                            Confidence: Link + Protocol

Link layer
  PLC MAC          B4:E6:2D:09:26:3C
  Vendor           Tesla                          (via OUI B4:E6:2D)
  EV PLC firmware  GH3.0.13

Protocol layer
  PnC attempted    Yes
  PnC succeeded    No
  Rejected UUID    a1b2c3d4-e5f6-...

Application layer
  OCMF identity    No application-layer identity captured
                   (firmware-dependent — populates when Zaptec ships ISO 15118-2 PnC)
```

## Consequences

### Benefits

- Vehicle identification works regardless of formal PnC status. Anonymous free-vend sessions get vehicle attribution.
- Cross-session recurrence detection via stable PLC MAC. Pattern recognition for support: "this same car has plugged in 14 times across 3 chargers."
- OUI vendor lookup gives operators immediate context without driver self-identification.
- Transport-agnostic OCMF capture (decision §4) fixes the existing OCPP-side parsing gap. Zaptec firmware that ever ships PnC will populate auth_id_* on either transport.
- Eventually feeds [ADR 0020](./0020-driver-access-via-driver-groups.md) access resolution: a future "this vehicle's MAC is on the allow-list" rule becomes possible without inventing a new identity surface.

### Costs

- 8 new columns on `charging.sessions` (already a wide table). Migration is additive but the row count gets bigger; partial index keeps lookup fast.
- ~20 MB OUI vendor table shipped in the API Worker bundle. Cloudflare Workers bundle limit is 10 MB compressed → need to load the table from R2 at first use, cache via WAF or KV. Implementation detail to resolve in Autocharge E.
- AMQP consumer needs StateId whitelist expansion + per-StateId handler additions.
- Privacy / GDPR work in Autocharge H. Real legal-review surface, not just code.

### Risks

- **Not all EVs have PLC modems.** Basic Mode-3-only EVs without ISO 15118 readiness skip HomePlug pairing entirely → StateId 953 never fires → `ev_plc_mac` stays NULL. The link-layer capture is opportunistic, not guaranteed. Mitigation: empirical — log how often 953 populates across our fleet over the first 4 weeks; if <50% coverage, raise concern.
- **Some EVs randomize their PLC MAC** (rare, mostly newer Tesla and Polestar firmware as a privacy feature). Recurrence-detection breaks for those. Mitigation: accept reduced fidelity for randomized-MAC vehicles; PLC MAC randomization is rare enough today to be a minority case.
- **OUI table goes stale.** New vehicle manufacturers register OUI prefixes monthly. Mitigation: quarterly refresh script + alert when too many MACs lookup as `unknown`.
- **Privacy / regulatory exposure.** Some jurisdictions (likely future Iceland EU-aligned regulations) may classify hardware MAC as personal data deserving stricter treatment than we plan. Mitigation: privacy policy disclosure + GDPR right-to-be-forgotten path; legal review before customer-facing rollout. For pilot phase (operator-only visibility), risk is low.
- **AMQP path still depends on Fly consumer being alive.** Autocharge B doesn't ship until Fly is back. The OCPP-side path (Autocharge C) provides partial coverage in the meantime — application-layer OCMF identity, but no link-layer MAC.
- **Empirical: StateId 953 may be misnamed in Zaptec's catalog.** The constant is documented as "MAC of PLC module on EV side" but we haven't observed it in production yet. First production session with a real EV is the smoke test. Mitigation: log raw StateId 953 payload alongside the parsed value for the first ~50 sessions so we can cross-check shape.

## Implementation order

ADR (this document) lands first per [Rule 5](../../CLAUDE.md). Then in sequence:

1. **A — Schema migration** — new columns on `charging.sessions` + partial index. Purely additive. Safe to deploy on staging immediately.
2. **E — OUI vendor table + lookup helper** — static data. Solves the bundle-size question (R2 vs in-bundle) before C/D need it.
3. **C — OCPP MeterValues OCMF projection** — works on every Dalvegur OCPP-canonical session immediately. No Fly dependency. Highest near-term return.
4. **D — idTag format classifier** — helper-only addition. Enables E's stored detection on tokens.
5. **F — Session detail UI surfacing** — once A + C are live, render the new "Vehicle identity" section.
6. **H — Privacy treatment** — permission gate + redaction helper; ride alongside F when surfacing operator-only fields.
7. **B — AMQP consumer extension** (Fly-blocked) — adds StateId 953/716/714/921/724/725 ingest. Lights up the link-layer + protocol-layer tiers automatically once Fly is alive.
8. **G — Vehicle-recurrence panel** — `/vehicles/[mac]` page. Lands once enough data exists (~ a week of post-Autocharge-B sessions).

Each step is independently shippable. Steps 1-6 + 8 form the OCPP-side / data-only Autocharge — fully functional even with AMQP dead.

## Decisions confirmed during the 2026-05-08 design pass

- **Three confidence tiers** (link / protocol / application) — yes
- **Schema columns shape** as listed in §2 — yes
- **OUI vendor table approach** (static JSON, lookup helper) — yes (R2 vs in-bundle resolution deferred to E)
- **PLC MAC = PII, operator-only default, last-3-bytes redaction in non-privileged views, GDPR anonymization via HMAC-SHA256** — yes
- **Sequence (ADR → A → E → C → D → F → H → B → G)** — yes
- **Pure deferral of [ADR 0020](./0020-driver-access-via-driver-groups.md) and the Forensic Capture roadmap behind Autocharge** — yes
