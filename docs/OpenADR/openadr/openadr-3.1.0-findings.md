# OpenADR 3.1.0 — working notes

Source documents: OpenADR 3.1.0 Definitions (rev 3.1.0, 07 Aug 2025, Final
Specification), the OpenADR 3 OpenAPI YAML, the 3.1.0 User Guide, and the
Alliance's *OpenADR 3 Introduction and Certification Program* README.

**Version discipline:** it is **3.1.0**, not 3.0. The changelog states 3.1.0 is
*not fully backwards compatible* with 3.0.1 — `/resources` became a first-level
object, ven/resource request bodies changed, and `targets` was refactored from
`valuesMap` to plain strings. Specifying "3.0" in stakeholder material is a
correctness error, not a rounding.

---

## The enumerations that matter

A common mistake is to propose a custom Icelandic profile of private `IS_*`
strings. Almost everything needed already exists as standard enumerations, and
using them is what preserves interoperability and the certification argument.

| Need | Standard enumeration | Where |
|---|---|---|
| Import / export envelope | `IMPORT_CAPACITY_LIMIT`, `EXPORT_CAPACITY_LIMIT` | Event payload |
| Capacity request from site | `IMPORT_RESERVATION_CAPACITY`, `IMPORT_RESERVATION_FEE` | Report payload |
| Capacity offered back | `IMPORT_CAPACITY_AVAILABLE`, `..._AVAILABLE_PRICE`, `..._RESERVATION`, `..._RESERVATION_FEE` | Event payload |
| **Comms-loss fallback level** | `IMPORT_CAPACITY_SUBSCRIPTION`, `EXPORT_CAPACITY_SUBSCRIPTION` | Event payload |
| Flexibility availability | `LOAD_SHED_DELTA_AVAILABLE`, `GENERATION_DELTA_AVAILABLE`, `UP_REGULATION_AVAILABLE`, `DOWN_REGULATION_AVAILABLE` | Report payload |
| Activation | `DISPATCH_SETPOINT`, `DISPATCH_SETPOINT_RELATIVE`, `DISPATCH_INSTRUCTION` | Event payload |
| Metered response | `READING`, `USAGE`, `DEMAND` + `readingType: DIRECT_READ`, plus `DATA_QUALITY` | Report payload |
| Exception / resource state | `OPERATING_STATE` (`ERROR`, `IDLE_OPTED_OUT`, `RUNNING_OPTED_OUT`, …) | Report payload |
| Baseline flexibility settlement | `BASELINE`, `DELTA_USAGE` | Report payload |
| Storage / V2G state | `STORAGE_CHARGE_LEVEL`, `STORAGE_USABLE_CAPACITY`, `STORAGE_MAX_CHARGE_POWER`, `STORAGE_MAX_DISCHARGE_POWER` | Report payload |

User Guide **§8.10.1 Dynamic Operating Envelopes** and **§8.10.2 Dynamic
Capacity Management** work the full request → allocate → verify cycle as
examples, referencing CSIP-AUS.

**The fallback is standardised.** After an extended communications
interruption with the `CAPACITY_LIMIT` schedule exhausted — and following a
grid outage — the VEN reverts to `IMPORT/EXPORT_CAPACITY_SUBSCRIPTION` as its
default limit. There is no need to invent a fail-safe mechanism; only to set
its value.

**Units:** the enum has `KW` but **no `MW`**. Standardise on kW in any profile;
keep MW for tariff arithmetic only.

---

## Defects and ambiguities in the published spec

Found while reading; all will be hit during implementation.

| # | Issue | Consequence |
|---|---|---|
| 1 | **`read_bl` scope is undefined.** Seven `/notifiers/mqtt/topics/*` endpoints require it. It appears nowhere in `securitySchemes.oAuth2ClientCredentials.scopes` nor in the Definitions scope table. | Must be invented locally. |
| 2 | **`/notifiers` requires `read_all` (BL-only)** but User Guide §6.3.2 shows the **VEN** calling it to discover the MQTT binding. Same on `/notifiers/mqtt/topics/programs`. The `vens/{venID}` variants correctly use `read_ven_objects`. | Scope assignment is wrong; a VEN cannot discover notifiers as specified. |
| 3 | **YAML artifact in `BlVenRequest.targets`** — `default: null          -`. The trailing hyphen makes the default parse as a string. | Codegen emits a bogus default. |
| 4 | **`venRequest` / `resourceRequest` are `oneOf` with the discriminator commented out.** Definitions warns `oneOf`/`anyOf` don't code-generate in strongly typed languages. | Hand-write deserialisation, dispatch on `objectType`. |
| 5 | **Definitions Figure 6 is stale** — shows `"operation": "POST"` in a notification. Changelog issue 209 moved these to CRUD verbs; the YAML enum is `[CREATE, READ, UPDATE, DELETE]`. | Follow the YAML. |
| 6 | **Definitions RI walkthrough shows `GET /auth/token` with clientID/clientSecret headers.** The YAML specifies `POST` with `application/x-www-form-urlencoded` per RFC 6749. | Follow the YAML. |

Also worth knowing:

- **User Guide §8.10.2 uses enumerations that don't exist** — `CAPACITY_SUBSCRIPTION`, `CAPACITY_RESERVATION`, `CAPACITY_AVAILABLE_FEE`. The normative table has `IMPORT_`/`EXPORT_`-prefixed forms and `..._AVAILABLE_PRICE`. Cite Definitions Table 1, never the User Guide examples.
- **`event.priority` is an integer**, minimum 0, lower = higher priority. And the spec states that when two conflicting events share a priority, **behaviour is undefined**. Conflict resolution is therefore a legitimate profile item.
- **There is no event cancellation.** Either set duration to `PT0S` with start `0001-01-01`, or DELETE the event and rely on the subscriber's notification.
- **There is no application-level event acknowledgement.** No ACK operation exists. Any KPI phrased as "event delivered and acknowledged" is untestable; measure a report POST referencing the event ID, or measure the boundary meter.
- **`intervalPeriod.randomizeStart`** exists precisely to avoid synchronised switching when one envelope change hits many sites. Use it.

---

## Certification

- Certification is **per product, per role, per version, per profile**. "Supports OpenADR" and "is OpenADR certified" are different claims; ask which certificate.
- Current OpenADR 3 profiles: **Continuous Pricing (CP)** and **Baseline Profile (BP)**. A VEN must implement at least one to certify.
- **A closed-system VTN** — purpose-built by a utility, aggregator or government agency, not resold — **may certify against OpenADR 3 alone**, with no 2.0b obligation. Only commercial VTNs sold as part of a DERMS must carry both, and only after a six-month grace period from profile publication.
- Test tooling is licensed to members; final verification happens at an Alliance-appointed certification manager.

Certification is irrelevant for a first proof. Conformance to the YAML is not.

---

## Official sources

Point counterparties at the Alliance's own repository — `github.com/oadr3/specification` — rather than third-party mirrors. A state utility building against an unofficial copy invites an easy objection.
