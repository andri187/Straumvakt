# DC Readiness - Sprint Plan (gbtnotes DC)

**Status:** planning note.
**Date:** 2026-05-03.
**Context:** based on the current `E:\Claude\Straumvakt` codebase and architecture review. Sibling of `scale-to-4000-chargers-sprint-plan.md` (gbtnotes scale). Both live under `gbtNotes/`. Sequencing: GBT scale precedes DC because DC ingest volume melts the current Prisma hot path.

## Gaps Found In The Current Situation

This note does not change the current Straumvakt scope. It records the
DC-specific gaps that must be planned around before any DC site enters
production. The list assumes the current `E:\Claude\Straumvakt` codebase as of
2026-05-03.

### Protocol Gaps

- **OCPP 2.0.1 ingest is absent.** Only 1.6J is wired today. DC vendor
  hardware (Autel DH480, Kempower, Tritium) ships with 2.0.1 certification.
  Without 2.0.1 the gateway cannot accept `TransactionEvent`, dynamic
  `SetChargingProfile`, or the `DataTransfer` carrier required for ISO 15118
  tunnelling.
- **ISO 15118 / Plug & Charge is absent.** No contract certificate handling,
  no EXI tunnelling, no MO/CSO trust chain, no Hubject EVSE CHECK
  integration. Public DC in EU/IS markets expects Plug & Charge.
- **Authorize anchors at EVSE, not Connector.** A DC EVSE with two physical
  connectors (CCS2 + CHAdeMO) cannot authorise per plug today;
  `ChargeSession.evseId` (per ADR 0012) is the session anchor, and
  `Installation.enforceAuthorize` operates above the connector layer.
- **No SmartCharging schema.** OCPP 1.6J `SetChargingProfile` is listed in
  the spec docs but there is no `ChargingProfile` table, no profile
  composition, and no runtime that builds limit schedules per EVSE.

### Physical Model Gaps

- **No cabinet power envelope.** A 480 kW DH480 with four dispensers sharing
  one supply has no shared-state row that says "this cabinet has 480 kW
  total to allocate across its dispensers right now". `Circuit.ampereCeiling`
  exists but is per-breaker AC and not wired to runtime allocation.
- **No per-connector current limits.** `Connector.maxPowerKw` exists;
  `maxCurrentA` and connector charge curves do not. CCS dispensers
  taper aggressively, and current limits drive cable/coupler safety.
- **No dispenser-distinct status model.** `Connector.status` exists, but no
  reason codes for "dispenser cooling", "isolation fault", "cable retract
  fault", "card terminal offline-blocking-payments", which DC sites need to
  triage from a dashboard.

### Tariff And Billing Gaps

- **No kW-aware tariff data dictionary.** `Tariff.rule` and
  `TariffDefinition.computeRule` are free-form JSONB. Encoding "EUR/kWh",
  "EUR/kW peak demand", "EUR/min idle when SoC > X%", "time-of-use bands"
  works, but there is no documented schema and no validator.
- **Per-connector billing granularity is untested.** Sessions anchor on
  EVSE; a single EVSE with two connectors served sequentially must split
  billing per physical plug, and that path has no coverage.
- **No ad-hoc payment terminal model.** EU AFIR Article 5 requires a
  contactless card option at every public DC charge point above 50 kW.
  Schema has no `PaymentTerminal`, no payment-processor binding, no
  guest-pay-at-charger flow. Tariff and subscription logic is
  driver-account-centric.

### Roaming And Vendor Gaps

- **OCPI is generic, not Hubject-specific.** `HubConnection`, `OcpiToken`,
  `CdrQueueEntry` exist as scaffolding. Hubject CPO portal onboarding,
  Hubject token roster sync, and Hubject-flavoured CDR push are not
  implemented.
- **No production DC vendor adapter.** Autel DH480 is documented in
  `docs/reference/integrations/autel.md` but no adapter code exists.
  Kempower, Tritium, ABB are flagged as Phase 4 in
  `docs/reference/integrations/README.md` and have no scaffold.
- **No generic DC vendor onboarding template.** A new DC vendor lacks a
  checklist for power envelope, dispenser count, connector types,
  authorise granularity, cost-per-kW model, roaming pool registration,
  and certificate handling.

### Operational Gaps

- **No DC load test scenarios.** GBT scale Sprint S7 covers AC traffic
  shapes (Heartbeat 60s, MeterValues 30-60s). DC sessions emit MeterValues
  every 10-15s during ramp and at SoC inflection points; reconnect storms
  on 4-dispenser cabinets behave differently.
- **No SoC propagation.** ISO 15118 and OCPP 2.0.1 carry battery SoC; the
  schema and UI do not surface it. Driver-facing apps for DC need active
  SoC, projected finish time, and power curve.
- **No dispenser-health runbook.** Cooling failures, contactor weld faults,
  earth-leakage trips, isolation faults are DC-specific incidents with no
  named alerts or operator runbook.

---

This note scopes the work needed to make Straumvakt **DC-ready as a
first-class product**, not "OCPP 1.6J shadow with manual power caps".

The current architectural direction is **DC-compatible**:

- The `ChargingStation -> EVSE -> Connector` model (ADR 0012) maps cleanly
  to a DC cabinet with multiple dispensers and connectors per dispenser.
- `VendorCredentialScope.identity` (the DC scope) is a first-class enum
  value alongside `installation` and `none`.
- `Tariff.rule` is JSON and can encode kW-based rules without schema
  change.
- `ControlRoutingPolicy` allows per-action dispatch (authorize -> ocpp,
  start -> vendor) which is exactly the AC-vs-DC split.

The current implementation is **not DC-functional**:

- Only OCPP 1.6J is wired.
- No real-time power-allocation state.
- No Plug & Charge.
- No card-terminal model.
- No DC vendor adapter shipped.

The DC track is therefore **additive** to the GBT scale track. GBT scale
fixes the substrate (queue-backed ingest, batched writes, time-series
storage); DC adds the protocol, physics, payment, roaming, and vendor
layers on top.

## Target Architecture (DC-Specific Additions)

```text
DC Cabinet (e.g. Autel DH480)
  -> Dispenser A (CCS2 + CHAdeMO)
  -> Dispenser B (CCS2 + CHAdeMO)
  -> Dispenser C (CCS2 + CHAdeMO)
  -> Dispenser D (CCS2 + CHAdeMO)
       |
       v
  OCPP 2.0.1 over WSS
       |
       v
  Gateway Worker (parses 2.0.1 + 1.6J)
       |
       v
  Inbound Event Queue
       |
       v
  API Worker consumer
       |
       +--> Postgres / Timescale telemetry (per dispenser)
       |
       +--> Power Allocator (cabinet envelope -> per-EVSE setpoint)
       |
       +--> SmartCharging Profile Composer
       |
       +--> Plug & Charge Authorizer
                |
                +--> Contract certificate cache
                +--> Hubject EVSE CHECK (when roaming)

Driver Plug-In At Dispenser
  -> ISO 15118 SECC handshake (charger side)
  -> Plug & Charge contract certificate presented
  -> OCPP Authorize.req with idTokenInfo or contract id
  -> API Worker authorise resolver (driver / contract / Hubject roaming)
  -> ChargeSession opened anchored on Connector (not EVSE)
  -> Cabinet power allocator assigns initial kW envelope
  -> SmartCharging profile applied
  -> MeterValues stream every 10-15s with SoC and power
  -> Settlement at session close uses tariff data dictionary
       (energy + power + idle + roaming margin)

Ad-hoc Card Payment
  -> Driver taps contactless card at dispenser terminal
  -> Terminal -> payment processor -> pre-auth amount
  -> OCPP Authorize.req carries terminal-issued idToken
  -> Session opens with payment_terminal anchor
  -> Settlement closes pre-auth at end of session
```

## Scale Assumptions

- Pilot DC sites: 1-3 cabinets in months 1-6.
- Dispensers per cabinet: 2-4.
- Connectors per dispenser: 2 (CCS2 + CHAdeMO typical).
- Concurrent DC sessions per cabinet: equal to dispenser count.
- MeterValues interval during DC session: 10-15s during ramp, 30s steady.
- Session lifetime: typically 15-45 minutes.
- Public-DC reconnect storms behave differently from AC: usually one site
  losing uplink rather than fleet-wide.

## Success Criteria

- An OCPP 2.0.1 charger can connect, authenticate, and exchange the full
  DC session lifecycle (including TransactionEvent and MeterValues).
- Plug & Charge is end-to-end functional against at least one MO trust
  chain (Hubject sandbox or vendor demo).
- A multi-dispenser cabinet has a runtime power envelope; two dispensers
  drawing simultaneously cannot exceed the cabinet limit.
- Per-connector authorise and per-connector billing are tested.
- DC tariff rules encode energy + power + idle + ToU bands using a
  documented data dictionary, with a validator.
- Ad-hoc card payment can open and close a session against a sandbox
  payment processor, with audit trail.
- Hubject CPO sandbox sessions complete and produce CDRs.
- One production-grade DC vendor adapter (Autel DH480 or Kempower) is
  shipped end-to-end.
- Operators have DC-specific dashboards, alerts, and runbooks.
- Staging load tests cover DC traffic shapes including SoC sampling and
  reconnect behaviour.

---

# Sprint DC1 - OCPP 2.0.1 Ingest Foundation

**Goal:** make the gateway and API Worker speak OCPP 2.0.1 alongside 1.6J without breaking the 1.6J fleet.

## Task List

- [ ] Add OCPP 2.0.1 message schemas under `apps/api/src/protocols/ocpp201`.
- [ ] Add a protocol-version negotiation step in the gateway DO so 1.6J and 2.0.1 chargers route to the right parser.
- [ ] Implement core 2.0.1 message handlers:
  - [ ] `BootNotification`
  - [ ] `Heartbeat`
  - [ ] `StatusNotificationRequest`
  - [ ] `Authorize`
  - [ ] `TransactionEvent` (Started / Updated / Ended)
  - [ ] `MeterValues`
  - [ ] `DataTransfer` (carrier for 15118 EXI later)
- [ ] Map 2.0.1 `evseId` and `connectorId` to the existing EVSE/Connector schema.
- [ ] Reuse the GBT-scale inbound queue path; do not branch persistence by version.
- [ ] Add an ADR `docs/adr/00NN-ocpp-2-0-1-ingest.md` describing the dual-version dispatch.
- [ ] Tests:
  - [ ] mixed 1.6J + 2.0.1 fleet on staging gateway
  - [ ] 2.0.1 BootNotification persists
  - [ ] 2.0.1 TransactionEvent maps to ChargeSession
  - [ ] 2.0.1 MeterValues persists with SoC

## Exit Criteria

- A 2.0.1 charger and a 1.6J charger can connect to the same gateway without cross-talk.
- Session lifecycle for 2.0.1 chargers persists end to end.
- The 1.6J fleet sees no regression.

---

# Sprint DC2 - Connector-Anchored Sessions And Authorise

**Goal:** make session and authorise anchor on the physical connector, not the EVSE, so multi-connector DC EVSEs work correctly.

## Task List

- [ ] Add `connector_id` to `ChargeSession` (nullable for legacy EVSE-anchored AC sessions).
- [ ] Update repository code so DC sessions populate connector and EVSE.
- [ ] Update Authorise resolver to accept `(evse_id, connector_id)` as the dispatch key.
- [ ] Update OCPP 2.0.1 handlers to record connector on every session and meter row.
- [ ] Update OCPP 1.6J handlers so multi-connector EVSEs (rare but possible) record connector.
- [ ] Update UI session detail to show the physical connector type and number.
- [ ] Tests:
  - [ ] DC EVSE with CCS2 + CHAdeMO opens two distinct sessions sequentially
  - [ ] Authorise targeted at one connector does not authorise the other
  - [ ] Per-connector billing produces two separate session rows

## Exit Criteria

- Connector is the canonical session anchor for DC.
- Authorise per connector is a tested path.

---

# Sprint DC3 - Cabinet Power Envelope And Allocator

**Goal:** stop two dispensers in one cabinet from drawing more than the cabinet supplies.

## Task List

- [ ] Add `ChargingStationPowerEnvelope` table:
  - [ ] station id
  - [ ] total kW limit
  - [ ] effective from / to
  - [ ] source (vendor template, operator override, DSO contract)
- [ ] Add `EvsePowerAllocation` runtime state (current kW assigned per EVSE).
- [ ] Implement an allocator service:
  - [ ] reads cabinet envelope
  - [ ] reads active session demand per EVSE
  - [ ] assigns proportional or priority-based kW
  - [ ] emits OCPP `SetChargingProfile` / `SetVariables` to each EVSE
- [ ] Allocator triggers:
  - [ ] new session start
  - [ ] session end
  - [ ] manual operator override
  - [ ] envelope change (DSO curtailment)
- [ ] Add operator UI to set cabinet envelope and view live allocation.
- [ ] Tests:
  - [ ] two dispensers drawing simultaneously stay below envelope
  - [ ] one dispenser receives full envelope when alone
  - [ ] operator override drops a dispenser to a fixed kW

## Exit Criteria

- A cabinet cannot exceed its envelope by software action.
- Live allocation is observable.

---

# Sprint DC4 - Per-Connector Current Limits And Charge Curves

**Goal:** model the physical limits of a DC connector so the allocator and tariff engine can reason about cable safety and curve shape.

## Task List

- [ ] Add `Connector.maxCurrentA` (decimal).
- [ ] Add `Connector.curveProfile` JSONB (max kW vs SoC, optional).
- [ ] Populate curve metadata for known connector classes (CCS2 350 kW, CCS2 150 kW, CHAdeMO 100 kW).
- [ ] Allocator respects per-connector current ceiling, not just kW.
- [ ] Surface curve in the operator UI.
- [ ] Tests:
  - [ ] allocator never assigns over connector maxCurrent
  - [ ] curve shape rendered correctly per connector

## Exit Criteria

- DC connector physical limits live in the schema, not just in vendor docs.

---

# Sprint DC5 - SmartCharging Profile Pipeline

**Goal:** compose, persist, and dispatch ChargingProfiles so the allocator and external limits (DSO, tariff ToU bands) actually reach the charger.

## Task List

- [ ] Add `ChargingProfile` and `ChargingSchedule` tables (1.6J + 2.0.1 compatible shape).
- [ ] Implement profile composition stack:
  - [ ] cabinet envelope (highest priority)
  - [ ] DSO/grid curtailment
  - [ ] tariff time-of-use band
  - [ ] driver/session preference (lowest priority)
- [ ] Dispatch `SetChargingProfile` (1.6J) and `SetVariables`/`SetChargingProfile` (2.0.1) via the existing outbound command queue.
- [ ] Persist profile acceptance and rejection per charger.
- [ ] Add operator UI to inspect active profiles per EVSE.
- [ ] Tests:
  - [ ] composed profile equals the minimum of all active limits
  - [ ] rejected profile is retried with adjusted shape
  - [ ] expired profile is replaced before its `validTo`

## Exit Criteria

- Power limits come from a documented composition stack.
- Profile dispatch is reliable, observable, and idempotent.

---

# Sprint DC6 - ISO 15118 Plug & Charge

**Goal:** support contract-certificate-driven authorise, end to end.

## Task List

- [ ] Decide tunnelling shape:
  - [ ] OCPP 2.0.1 native (`AuthorizeRequest.certificate`)
  - [ ] OCPP 1.6J `DataTransfer` carrier (vendor-flavoured)
- [ ] Add certificate cache tables:
  - [ ] contract certificates
  - [ ] root CA / sub-CA chain
  - [ ] revocation status
- [ ] Integrate with at least one trust source:
  - [ ] Hubject EVSE CHECK sandbox
  - [ ] vendor demo CA for offline testing
- [ ] Implement authorise resolver:
  - [ ] verify contract certificate signature
  - [ ] check revocation
  - [ ] map contract id to driver / agreement
  - [ ] fall back to idToken when contract is missing
- [ ] Add ADR `docs/adr/00NN-iso-15118-plug-and-charge.md`.
- [ ] Tests:
  - [ ] valid contract opens session
  - [ ] revoked contract is rejected
  - [ ] expired contract is rejected
  - [ ] unknown CA chain is rejected

## Exit Criteria

- Plug & Charge works against a sandbox MO.
- Trust chain is documented and rotatable.

---

# Sprint DC7 - DC Tariff Data Dictionary

**Goal:** stop relying on free-form JSON for DC pricing; document the keys, validate them, expose them in the UI.

## Task List

- [ ] Author `docs/architecture/TARIFF_RULE_SCHEMA.md` with required keys:
  - [ ] `energy_price` (EUR/kWh)
  - [ ] `power_price` (EUR/kW)
  - [ ] `idle_fee` (EUR/min, with SoC and time-after-stop conditions)
  - [ ] `tou_bands` (start/end, multiplier or override)
  - [ ] `peak_demand` (window, threshold, EUR/kW peak)
  - [ ] `roaming_margin` (EUR/kWh extra for non-home-account drivers)
  - [ ] `currency`, `vat_rate`, `effective_from`, `effective_to`
- [ ] Add a Zod / JSON Schema validator at write time.
- [ ] Add a UI tariff editor that produces conforming rules.
- [ ] Migrate existing AC tariffs (where applicable) to the dictionary.
- [ ] Surface rules at the dispenser HMI and driver app preview.
- [ ] Tests:
  - [ ] invalid rule is rejected at save
  - [ ] DC session settlement matches expected value across all rule classes

## Exit Criteria

- DC tariff math is reproducible from the documented dictionary.
- No production tariff is saved as undocumented JSON.

---

# Sprint DC8 - Ad-Hoc Card Payment

**Goal:** comply with EU AFIR Article 5 by supporting a contactless card at every public DC charge point.

## Task List

- [ ] Add `PaymentTerminal` table (per dispenser, vendor, terminal id, status).
- [ ] Pick a payment processor (Adyen / Stripe Terminal / Nayax-equivalent) and add an adapter.
- [ ] Implement pre-auth at session start, capture at session close.
- [ ] Add `Payment` table linking session to processor reference.
- [ ] Authorise resolver accepts terminal-issued idToken.
- [ ] Add receipt issuance (email, QR-link, on-screen).
- [ ] Add operator UI for terminal status, payment failures, refunds.
- [ ] Add audit events for every payment lifecycle transition.
- [ ] Tests:
  - [ ] sandbox card pre-auths, captures, refunds
  - [ ] failed terminal blocks new sessions on that dispenser
  - [ ] refund updates session and audit trail

## Exit Criteria

- A guest driver can charge with a contactless card at a DC dispenser.
- Refunds and disputes are handled with audit trail.

---

# Sprint DC9 - Hubject Roaming Integration

**Goal:** join the dominant EU roaming hub so non-home-account drivers can charge.

## Task List

- [ ] Register Straumvakt as a CPO in Hubject sandbox.
- [ ] Implement Hubject CPO interface:
  - [ ] EVSE data push
  - [ ] EVSE status push
  - [ ] authorise via Hubject (eRoamingAuthorizeStart / Stop)
  - [ ] CDR push (eRoamingChargeDetailRecord)
- [ ] Map Straumvakt EVSE / Connector / tariff to Hubject EVSE Data shape.
- [ ] Bridge OCPI internal model to Hubject (Hubject is OICP, not OCPI; conversion required).
- [ ] Add `RoamingPartner` table and per-partner pricing margin.
- [ ] Promote sandbox to production with at least one MO partner.
- [ ] Tests:
  - [ ] sandbox session via foreign MO completes
  - [ ] CDR is delivered and acknowledged
  - [ ] EVSE status changes propagate within SLA

## Exit Criteria

- A foreign-MO driver can plug in at a Straumvakt DC site and complete a session.

---

# Sprint DC10 - First DC Vendor Adapter (Autel DH480 Or Kempower)

**Goal:** prove the end-to-end DC stack against one real vendor.

## Task List

- [ ] Pick the first vendor based on pilot site availability:
  - [ ] Autel DH480 (OCPP 2.0.1 direct, no vendor REST)
  - [ ] Kempower (OCPP 2.0.1 + Kempower cloud REST)
- [ ] Author `docs/reference/integrations/<vendor>.md` live findings section.
- [ ] Implement adapter:
  - [ ] credential scope = identity (per OCPP identity)
  - [ ] vendor-specific DataTransfer payloads (firmware, diagnostics)
  - [ ] vendor-specific config keys
  - [ ] vendor health probes
- [ ] Onboarding wizard step for the chosen DC vendor.
- [ ] Cabinet template seeded into `hardware.models` with power envelope, dispenser layout, connectors, curve.
- [ ] Pilot install on staging gateway with one cabinet.
- [ ] Tests:
  - [ ] cabinet onboarding from blank to first session
  - [ ] firmware update via vendor channel
  - [ ] fault injection (cooling fault, isolation fault) surfaces in UI

## Exit Criteria

- One real DC cabinet runs end to end on Straumvakt staging.
- Vendor-specific quirks are documented in the reference doc.

---

# Sprint DC11 - DC Operations: Dashboards, Alerts, Runbooks

**Goal:** make a DC site operable by a human who did not write the code.

## Task List

- [ ] DC dashboards:
  - [ ] cabinet envelope vs current draw
  - [ ] per-dispenser session state and SoC
  - [ ] per-connector availability and fault counts
  - [ ] payment terminal status and pre-auth queue
  - [ ] Plug & Charge authorise success/failure
  - [ ] Hubject roaming session count and CDR backlog
- [ ] Alerts:
  - [ ] cabinet envelope exceeded (should be impossible; alert on attempt)
  - [ ] dispenser cooling fault
  - [ ] isolation fault
  - [ ] cable retract fault
  - [ ] payment terminal offline > N minutes
  - [ ] Plug & Charge cert expiry approaching
  - [ ] Hubject CDR backlog
- [ ] Runbooks:
  - [ ] dispenser will not start a session
  - [ ] cabinet draws less than expected
  - [ ] payment terminal not pre-authing
  - [ ] Plug & Charge cert chain rotation
  - [ ] Hubject session not appearing in Hubject portal
  - [ ] vendor firmware rollback
- [ ] SoC and power-curve telemetry surfaced in driver-facing surfaces.

## Exit Criteria

- An on-call operator can triage the common DC failure modes from dashboards and runbooks.

---

# Sprint DC12 - DC Load Test And Soak

**Goal:** prove the DC stack under realistic shapes before the second site goes live.

## Task List

- [ ] Extend the GBT-scale OCPP simulator to emit:
  - [ ] OCPP 2.0.1 traffic
  - [ ] DC MeterValues at 10-15s with SoC and power
  - [ ] TransactionEvent lifecycle
  - [ ] Plug & Charge authorise traffic
  - [ ] payment terminal pre-auth/capture cycles
- [ ] Run scenarios:
  - [ ] one cabinet, four dispensers, fully loaded
  - [ ] cabinet envelope curtailment mid-session
  - [ ] reconnect storm on a single cabinet
  - [ ] Hubject sandbox roaming load
  - [ ] payment processor sandbox load
- [ ] Capture metrics and bottlenecks.
- [ ] Update GBT-scale runbooks with DC-specific sections.

## Exit Criteria

- DC-only scenarios pass on staging.
- Bottlenecks are documented with owners.

---

# Priority Order And Dependency On GBT Scale

DC sprints assume GBT scale Sprints S1-S4 are complete. Specifically:

- DC1 needs S1-S2 (queue-backed inbound ingest) so 2.0.1 traffic does not write through Prisma row-by-row.
- DC3 (allocator) emits commands and benefits from S6 (outbound command hardening).
- DC9 (Hubject) benefits from S5 (export pipeline) for CDR archives.
- DC11 (DC ops) extends S8 dashboards.
- DC12 reuses the S7 load harness.

## Recommended Order

1. **GBT scale S1-S4 first** (substrate).
2. DC1 - OCPP 2.0.1 ingest.
3. DC2 - Connector-anchored sessions.
4. DC3 - Cabinet power envelope.
5. DC4 - Per-connector current and curve.
6. DC5 - SmartCharging pipeline.
7. DC10 - First vendor adapter (can move earlier if pilot site is ready and the adapter exercises DC1-DC3 in production).
8. DC7 - Tariff data dictionary (can run in parallel with DC1-DC5).
9. DC8 - Ad-hoc card payment (legal blocker for any public DC site; can move earlier if a public site is in scope).
10. DC6 - Plug & Charge.
11. DC9 - Hubject roaming.
12. DC11 - DC ops.
13. DC12 - DC load test.

## What This Plan Does Not Cover

- AC retrofits or AC-only feature work.
- Driver-facing mobile app for DC. Driver UX (active SoC, projected finish, receipt) needs its own track sequenced after DC2 and DC8.
- HPC-specific certification (CCS PnP, ChaoJi 2.0). These are post-pilot.
- ChargePoint Operator licensing (national regulator paperwork). Operator concern, not engineering.

## Key Architectural Decision

DC readiness is **additive on top of GBT scale**, not a replacement. The
data model already accommodates DC; the runtime, protocol, and payment
layers do not. The cheapest first cabinet ships as "OCPP 2.0.1 + cabinet
envelope + ad-hoc card + tariff dictionary" (DC1-DC4, DC7, DC8, DC10) and
defers Plug & Charge and Hubject to the second cabinet onwards. That is
the smallest viable production-grade DC slice.
