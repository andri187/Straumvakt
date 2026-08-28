# Target architecture and first proof

## The separation decision

**The dynamic-communications module is a standalone service, not a CPMS
module.** This is deliberate and load-bearing:

1. **It must be CPMS-agnostic.** Its whole value is driving Driivz, AMPECO,
   Ampcontrol *and* Straumvakt's own CSMS. A component living inside one CPMS
   naturally binds to that CPMS's chargers and domain model.
2. **Different lifecycle, different counterparty.** The CPMS serves hosts and
   drivers. This serves the grid relationship. They change for different
   reasons and on different clocks.
3. **Neutrality is structural, not asserted.** A DSO-facing component owned by
   a party that also operates charging is compromised by construction.
   Physical separation is what makes the governance story tellable — and what
   makes it possible to hand the VTN half to the DSO later without unpicking a
   platform.
4. **Ownership may change.** This is the component most likely to be
   licensed, transferred, or spun out. Keeping it out of the platform's git
   history avoids exactly that entanglement.
5. **Separate blast radius.** DSO-facing, potentially safety-relevant, with
   its own audit trail and fail-safe semantics. It should not share a
   deployment or a security posture with the driver app.
6. **Certification is per product.** A bounded service is certifiable. A
   feature inside a CPMS is not.

**Recommendation: separate repository, not a monorepo app.** It has no
dependency on Straumvakt's domain model — it speaks OpenADR upward and vendor
APIs downward. If it needs shared types, publish them rather than importing
across.

Documentation stays here; code does not.

---

## The boundary

```
   DSO Business Logic  ──(writes events)──►  VTN  (OpenADR 3.1.0)
                                              │
                                     envelope │ standard, interoperable
                                              ▼
                                   ┌──────────────────────┐
                                   │  OpenADR svc (VEN)   │
                                   │  translation layer   │
                                   └──────────────────────┘
                                              │
                          ┌───────────────────┼───────────────────┐
                          ▼                   ▼                   ▼
                   CPMS site-limit      CPMS site-limit     Own CSMS
                   API (Driivz)         API (Ampcontrol)    OCPP direct
                          │                   │                   │
                          ▼                   ▼                   ▼
                       chargers            chargers            chargers
```

Two components, different fates:

| Component | Owner | Lifetime |
|---|---|---|
| **VTN** | DSO eventually. Operated by a platform partner for the proof only. | Transitional. Hand over at production. |
| **VEN + translator** | Straumvakt | Permanent. This is the product. |

**The DSO does not have to host the VTN to control the envelopes.** Business
Logic is a *client* of the VTN in the OpenADR object model — separate hosting
is an explicitly valid deployment. The ask to a utility reduces to "you POST
events and read reports; you retain full envelope authority; you host,
procure and secure nothing." That is a decision that fits inside a meeting
rather than a budget cycle.

---

## Southbound reality

**A charger holds exactly one OCPP connection.** If a CPMS owns it, the
translator cannot send `SetChargingProfile` directly — the chain terminates at
the CPMS's site-limit API, and the CPMS does OCPP internally.

Direct OCPP is only available where the chargers are pointed at our own
endpoint. For a single pilot site that is a repointing exercise, and it
removes every vendor from the critical path. Already demonstrated in the field
with Zaptec hardware.

For a first proof under time pressure, the site we control is the low-risk
choice; CPMS integrations are the phase after.

---

## What a first proof must demonstrate

Not a successful API call — a **closed loop at the boundary meter**:

1. Authenticate, register resource, reconcile IDs both sides
2. Site reports current / preferred / minimum-useful power
3. VTN issues an envelope (`IMPORT_CAPACITY_LIMIT`, kW, bounded validity)
4. Site applies the cap; load attempts to exceed it
5. **Boundary meter stays within tolerance**
6. VTN revises the envelope; site follows within SLA
7. Metered response returned, reconciled against event ID
8. Communications deliberately cut → local controller enters agreed fallback
9. Communications restored → explicit resynchronisation, no uncontrolled jump

## What it must *not* claim

- Avoided capex — that needs a network study
- Market pricing or financial settlement
- TSO/DSO primacy across simultaneous programmes
- Fleet-scale optimisation
- V2G export unless already certified

## KPI notes

Two commonly-written KPIs are unmeasurable as usually phrased:

- **"Event delivered and acknowledged"** — OpenADR 3 has no ACK operation.
  Measure a report POST referencing the event ID, or measure the meter.
- **Sub-10s telemetry** — achievable but against the grain. Reports are
  interval-structured REST POSTs, and the MQTT binding does not help because
  notifications flow VTN→client, not upward. The compliance evidence that
  matters is the boundary meter, not the reporting cadence.

---

## Open questions

| Question | Blocks |
|---|---|
| Which pilot site, and do we control its OCPP endpoint? | Whether the proof has vendor dependencies at all |
| Boundary meter — what hardware, what read path? | Verification leg |
| Does the DSO accept operating as a BL client against a hosted VTN? | The whole timeline |
| Fallback value per site (`IMPORT_CAPACITY_SUBSCRIPTION`) | Fail-safe test case |
