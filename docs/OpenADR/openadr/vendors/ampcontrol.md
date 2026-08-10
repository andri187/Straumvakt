# Ampcontrol — protocol capability assessment

**Assessed:** 2026-08-05
**Claims:** OpenADR certified; recently received IEEE 2030.5 certification for
California's Flex Connect Program (site launched). Existing N1 engagement —
an integration/cybersecurity overview was drafted previously.
**Finding:** Strong credentials, but what was *offered* is a proprietary DR API
and a portal tenancy, not a VEN.

---

## Credentials (Documented — vendor statement, unverified)

- **Revel** — US public DC operator, first client 5+ years, 235+ DC connectors
  across 15+ sites, with eMSP and roaming-hub integrations. Verifiable, real,
  relevant reference.
- **OpenADR certified** — version, role and profile not stated.
- **IEEE 2030.5 certified** for California **Flex Connect**; site launched.
- Solar/BESS/microgrid deployments across US and EU, including a large EU
  grocery distributor's DCs and a large North American transit depot.

**The Flex Connect line is the most valuable item here.** A launched
flexible-interconnection programme with a utility counterparty is exactly the
international precedent an Icelandic DSO would want. A reference call between
the DSO and the Californian utility counterparty is likely worth more than any
technical argument.

**Inference:** Californian flexible interconnection runs on 2030.5/CSIP.
Their OpenADR certification is therefore probably a separate, older capability
— likely 2.0b — and unrelated to the DOE deployment. Two genuine but distinct
capabilities that do not automatically combine into an OpenADR 3.1.0 VEN.

---

## What was actually offered (Documented)

Three options: their **proprietary v2 DR-Events API**, the portal UI under
*Energy Management → Utility Events*, or an **RBAC user account for the DSO**
(optionally API-only).

Notably, they did **not** offer a VEN to register against a VTN. Asked how a
DSO would run a VTN, the natural answer for a vendor with a working 3.x VEN is
*"send us the VTN URL, clientID and secret."* They steered to a portal
tenancy instead.

### Why a DSO tenancy is the wrong shape

In the OpenADR model the DSO **publishes** and CPOs consume; the DSO holds no
accounts anywhere and adding a CPO costs nothing. A tenancy inverts this: N
CPOs means N portals, N APIs, N credential sets — the fragmentation the
exercise exists to prevent — and it places grid-constraint authority inside a
commercial SaaS tenancy. A state DSO's security and procurement review of
*that* could take longer than standing up a VTN.

**Use the demo, don't let it become the proof.** It is genuinely useful for
making the concept tangible to DSO staff. Label it explicitly as a
demonstration of boundary control, not as the proposed architecture.

---

## API analysis — `/v2/dr_events/` (Documented)

CRUD complete: `GET` (list, network-scoped, ISO 8601 range), `POST` (create),
`GET /{uuid}`, `PATCH` (start / end / value), `DELETE`. BearerAuth.

**The primitive is a delta, not a ceiling.** From the Create description:

> "load curtailment by **reducing the available variable network capacity by a
> given 'load amount'** for a certain time period, or … power generation
> through discharging vehicles … by a given 'discharge amount'"

and `PATCH.value`: *"In kW. If Load Amount, the value is the load reduction on
the network. If V2G, the value is the provided power from the network."*

**Critical nuance:** it reduces *available network capacity*, not *measured
draw*. That distinction decides viability:

- If it reduces a **configured capacity ceiling**, the delta is
  deterministically convertible. Base 400 kW, DSO wants 175 kW → issue a
  225 kW reduction. Verifiable. Workable.
- If it reduces a **dynamically computed internal quantity**, the DSO can
  neither express nor audit an absolute grid limit through it. Unusable for
  DOE.

### Gaps

- **Event object schema undocumented.** All response samples are
  `"data": [{}]`; the POST body's `drEvents` is `Array of objects` with no
  expansion. Type discriminator, targeting and priority all unknown.
- **`networkId` is the unit of control.** Charger/connector filters appear
  only on the *log* endpoint. Whether one network maps 1:1 to one grid
  connection point with one revenue meter is unknown and matters as much as
  the delta question.
- **No fail-safe semantics anywhere.** Events carry start, end, value. No
  timeout, no default, no documented loss-of-contact behaviour.
- **No verification path.** `/v2/events/` is operational logging — alerts,
  urgency, category, session source — not metered power. Closed-loop
  verification needs a telemetry API not present in this documentation.

**In their favour:** PATCH and DELETE make envelope revision and cancellation
first-class, which OpenADR 3 actually handles worse (no cancel mechanism).

---

## Pending

| Question | Status |
|---|---|
| Is "available variable network capacity" a **static configured value, readable via API**, or dynamically computed? | **Decides viability** |
| Does one `network` == one grid connection point with one revenue meter? | Open |
| Expanded `drEvents` object schema | Open |
| Can you expose an **absolute site import limit in kW**? | Feature request worth making — small for them |
| OpenADR certificate: version, role, profile, number | Open |
| Flex Connect: which protocol carries the limit — `opModImpLimW` or OpenADR? | Open |
| Reference call with the Flex Connect utility counterparty | **Highest-value ask** |
| Comms-loss behaviour; restart persistence | Open |

---

## Strategic note

> "we envision leading the market in similar programs around the world,
> **including Iceland**"

That is a stated intention to occupy the DSO-interface and aggregation
position. If Ampcontrol integrates directly with the DSO's VTN, there is no
translator layer. On the CPO leg they are a supplier; on the DSO leg they are
a competitor for the same position. Both can be true; decide deliberately.
