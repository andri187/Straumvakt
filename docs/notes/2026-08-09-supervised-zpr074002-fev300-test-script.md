# Supervised ZPR074002 and FEV300 test script

Date: 2026-08-09  
Status: prepared only; no hardware action executed

## Boundary

This script is for a human-supervised session with charger `ZPR074002` and a Fluke FEV300 Type 2 tester. It does not authorize unattended OCPP, BLE, NFC, charger, electrical, or cloud actions. Stop if the charger identity, test lead, protective earth, supply, or test responsibility is uncertain.

## Evidence form

Record for every checkpoint: UTC timestamp, operator, charger label, app build SHA, phone/API, CP setting, expected app state, observed app state, visible connector status, OCPP event reference if independently available, screenshot filename, and deviation notes. Do not record passwords, tokens, DSNs, BLE PINs, or customer data.

## Preconditions

- Andri is present and explicitly directs each physical transition.
- The device under test is confirmed as `ZPR074002` at the enclosure.
- The FEV300 manual and local electrical-safety practice govern the physical setup.
- The app is a known debug build pointed only at the approved beta environment.
- A test organisation, installation, charger and driver exist through the singular onboarding path.
- The observer knows how to return the FEV300 to CP A and how to isolate power safely.
- Abort criteria and evidence folder are agreed before connection.

## Checkpoints

| CP | Physical meaning to confirm from FEV300 manual | Expected product presentation | Evidence | Stop condition |
| --- | --- | --- | --- | --- |
| A | Vehicle absent | Connector available or truthful unknown/offline | app + charger + timestamp | app claims charging or a person |
| B | Vehicle connected, not requesting energy | Preparing/connected; no fabricated kW or cost | app + CP selector + event reference | charging starts unexpectedly |
| C | Vehicle requests energy | Charging only after independently observed authorization/transaction | app + OCPP reference + meter observation | unsafe current, mismatch, fault |
| D | Ventilation-required state | Fault-like/unavailable behavior according to charger capability; never normalize to charging | app + charger indicators | charger energizes contrary to expected behavior |

## Sequence

1. Capture CP A baseline before the tester is connected.
2. Under Andri's direction, connect the FEV300 and select CP B.
3. Wait for stable charger indication; capture app, charger, and event evidence independently.
4. Select CP C only after the observer confirms the test setup and expected authorization behavior.
5. Observe whether the app distinguishes offered power from measured power and whether missing values remain unavailable.
6. Return to CP B and verify the session transitions without inventing final cost.
7. Exercise CP D only if the charger/tester manuals and responsible operator permit it.
8. Return to CP A, disconnect under the tester procedure, and verify the app reaches a truthful finished/settlement or unavailable state.

## Product assertions

- Available, preparing, charging, suspended and fault-like states remain distinguishable.
- `0 kW` is never used as a substitute for unavailable telemetry.
- Cost remains pending when pricing is not authoritative.
- A shared technical RFID may authorize an installation but must not identify a person.
- Concurrent sessions preserve their own session identities across polling.
- No ambiguous charger command is retried automatically.

## Abort and reset

Stop immediately for unexpected energization, protective-earth concern, heat, smell, visible damage, repeated contactor cycling, charger fault, identity mismatch, or unclear responsibility. Preserve evidence before recovery. Return the tester to CP A, follow the FEV300 disconnection procedure, and use the charger's documented isolation procedure if needed. Do not clear logs, retry credentials, or reset cloud state merely to make the test green.

## Still unverified afterward

This supervised lane alone does not prove fleet-scale behavior, billing correctness, signed-meter attribution, BLE writes, NFC correlation, production routing, roaming, or every vehicle's charging behavior.

