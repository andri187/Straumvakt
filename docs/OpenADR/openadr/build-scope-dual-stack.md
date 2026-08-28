# Build scope — dual-stack envelope service

**Internal engineering scope. Not client-facing.**
Companion to [`poc-scope-of-work.md`](./poc-scope-of-work.md).
**Date:** 2026-08-05

---

## Why both

Waiting on Driivz's sample payload to decide the protocol path puts a hard
gate on 8 August. Building both stacks removes the gate: the sample payload
becomes *validation* of an adapter we already have rather than a *decision*
that unblocks work.

It is also the right shape independent of Driivz:

- **Many CPMS are 2.0b.** AMPECO may well be too. A 2.0b adapter is a reusable
  translation asset, not throwaway scaffolding for one vendor.
- **"We speak both" is a position.** With RARIK it means their choice of north
  side is not constrained by any single supplier. With vendors it removes the
  "our platform doesn't support that" conversation entirely.
- **It is the report's argument, implemented.** Iceland should not have its
  national interface set by one supplier's implementation age.

---

## Architecture — one model, two adapters

```
        RARIK BL  ──── OpenADR 3.1.0 REST/JSON ────┐
                                                   ▼
                                    ┌──────────────────────────┐
                                    │   Envelope service       │
                                    │   (canonical model)      │
                                    └──────────────────────────┘
                                       │                    │
                    OpenADR 3.1.0 ─────┤                    ├───── OpenADR 2.0b
                    REST/JSON          ▼                    ▼      XML / poll
                                   3.x VEN              Driivz VEN
```

### Canonical internal model

Everything both adapters serve resolves to one object:

```
Envelope {
  resourceId       string      # maps to connection point
  importLimitKw    number
  exportLimitKw    number?
  validFrom        datetime
  validUntil       datetime
  priority         int         # 0 = mandatory network limit
  fallbackKw       number      # applied on loss of contact
  revision         int
}
```

**Neither protocol is the internal representation.** Both adapters are
translations of this. That is what keeps a third adapter (IEEE 2030.5 `DERControl`,
a vendor REST API) cheap to add later.

---

## Relationship to the Straumvakt CPMS — none

This service does **not** build on the Straumvakt platform, and must not.

In the chain this SOW describes — RARIK BL → VTN → Driivz VEN → Driivz's
chargers — Straumvakt's CPMS appears nowhere. Driivz owns the hardware. There
is no `Circuit`, no outbound-command dispatcher, no OCPP gateway and no
`MeterValues` projection anywhere in that path.

**Straumvakt's CPMS is a southbound target, in the same class as Driivz and
Ampcontrol.** Not a foundation, not a dependency. If a pilot ever runs on
chargers we operate, the VTN service calls the Straumvakt API exactly as it
calls a vendor's — across a network boundary, through a published interface.

That is what keeps the separation real rather than asserted. A VTN service
that imports Straumvakt's domain model cannot be handed to a DSO, cannot be
sold to another retailer, and cannot claim neutrality.

### What it actually needs

Generic infrastructure, none of it domain-specific:

- HTTP server with TLS
- A database
- OAuth 2.0 client-credentials issuance and validation
- Its own resource model — see below
- XML serialisation for the 2.0b adapter
- An outbound HTTP client for webhooks and southbound vendor calls

### Reuse that is legitimate

Patterns copied, not dependencies imported:

| Pattern | Value |
|---|---|
| Worker + Neon deployment shape, `wrangler.jsonc` conventions | Half a day of not solving deployment from scratch |
| Prisma conventions | Familiarity, not code |
| Auth middleware and rate-limit code | Copyable if useful; small |

**This does not reduce the build.** It reduces the number of decisions.

### The resource model, done correctly

Straumvakt's `Circuit` is not available and should not be. The VTN service
needs its own — and it is much simpler, because it needs no topology:

```
Resource {
  resourceId        string    # the ID RARIK addresses
  displayName       string
  adapter           enum      # DRIIVZ | AMPCONTROL | STRAUMVAKT | ...
  vendorRef         string    # the identifier that adapter understands
  fallbackKw        number
  nominalCeilingKw  number?
}
```

A mapping table, not an electrical graph. The VTN service does not model
circuits, phases or chargers — those are the site operator's concern behind
whichever adapter owns them.

---

## What is genuinely missing

Everything. This is a new service.

| Component | Severity | Note |
|---|---|---|
| **OAuth2 client-credentials flow** | Medium | `/auth/token`, client registry, scope issuance and enforcement. |
| **OpenADR object model + REST surface** | Medium | Programs, events, reports, vens, resources, subscriptions. Mechanical from the YAML. |
| **Webhook sender + `echo` challenge** | Small | Straightforward. |
| **XML / SOAP for 2.0b** | **Large** | The single biggest genuinely-new concern. |
| **Resource → adapter mapping** | Small | The table above. |
| **Southbound adapters** | Per vendor | Each is an HTTP client against a documented API. |

---

## Component breakdown

### A — Envelope service core

| Item | Notes | Est. |
|---|---|---|
| Canonical model, persistence, resource→adapter mapping | Envelope, Resource, revision history | 0.5 d |
| Envelope resolution | Active envelope for a resource at time T; overlap and priority rules | 0.5 d |
| Audit trail | Every request, event, command and meter value linked by ID — acceptance criterion T7 | 0.5 d |

**≈ 1.5 days**

### B — OpenADR 3.1.0 adapter

North side to RARIK BL, and south side to any 3.x VEN.

| Item | Notes | Est. |
|---|---|---|
| `/auth/server`, `/auth/token` | client_credentials, JWT, scope resolution | 0.5 d |
| CRUD: programs, events, reports, vens, resources, subscriptions | Mechanical from the YAML. Hand-write `venRequest`/`resourceRequest` — `oneOf` with the discriminator commented out doesn't code-generate | 1.0 d |
| Webhook notification + `echo` challenge handshake | Mandatory before a subscription may be created | 0.5 d |
| Deploy, TLS, credential issuance | Workers + Neon | 0.5 d |

**≈ 2.5 days.** No targeting/object privacy (single VEN), no MQTT, no
`/notifiers*`.

### C — OpenADR 2.0b adapter

South side only. We are the VTN; Driivz is the VEN and polls us.

| Item | Notes | Est. |
|---|---|---|
| `oadrPoll` handling | Driivz polls at 60 s default | 0.5 d |
| `oadrDistributeEvent` construction | `eiEvent` with `eiEventSignal` — `signalName`/`signalType` pairs, `eiActivePeriod`, `eiTarget` | 1.0 d |
| `oadrCreatedEvent` handling | VEN opt-in/response | 0.5 d |
| Registration | `oadrQueryRegistration`, `oadrCreatePartyRegistration`, venID assignment. May be reducible — Driivz takes `venId` as pre-shared config | 1.0 d |
| Report path | `oadrRegisterReport` / `oadrUpdateReport`. **Deferrable** — telemetry can come from the boundary meter instead | 1.0 d |
| Iteration against a live Driivz VEN | Genuinely unknown until we have one | 1–2 d |

**≈ 4–6 days**, of which 1–2 is unpredictable integration.

### Signals to emit

Driivz documents exactly two accepted pairs:

```
LOAD_DISPATCH ; setpoint
x-gridConnectionLimitMax ; x-loadControlCapacity      # units kW
TimeZone=UTC
```

Both are **absolute** primitives. `x-gridConnectionLimitMax` is a connection
ceiling and `setpoint` is an absolute operating point — neither is a delta
from a baseline. Their protocol generation is legacy; their semantics are
correct for a dynamic operating envelope. That maps cleanly:

| Canonical | 3.1.0 | 2.0b (Driivz) |
|---|---|---|
| `importLimitKw` | `IMPORT_CAPACITY_LIMIT`, units `KW` | `x-gridConnectionLimitMax` / `x-loadControlCapacity`, kW |
| `fallbackKw` | `IMPORT_CAPACITY_SUBSCRIPTION` | long-duration event at fallback value |

### Simplifications available

Driivz's published configuration lists **no certificate parameters** — only
`openAdrVtnId`, `openAdrVtnUrl`, `openAdrVenId`, `openAdrVenName`, allowed
IDs, and poll period. That implies plain TLS rather than mTLS, which removes
the single most expensive part of 2.0b:

- **No OpenADR PKI, no x.509 client certificates**
- **No XMLDSig signing**
- **No EXI encoding**
- Poll-only — no push, no callback endpoint
- One known client, two signal types, no certification

This is what makes a 2.0b adapter days rather than weeks. **Confirm the TLS
assumption before relying on it** — if mTLS with OpenADR PKI certificates is
required, add certificate procurement lead time and revise upward.

---

## Total

| Component | Estimate | Notes |
|---|---|---|
| A — Envelope service core | 1.5 d | Model, resolution, audit |
| B — OpenADR 3.1.0 adapter | 2.5 d | North side. Non-negotiable under every path |
| C — OpenADR 2.0b adapter | 4–6 d | XML is the wholly-new concern |
| D — Southbound adapter, first vendor | 1–2 d | HTTP client against a documented API |
| E — Operator UI | 1–1.5 d | Thin client over the VTN API using BL credentials. No separate auth stack |
| F — Containerisation + Fly deploy | 0.5 d | Dockerfile is also deliverable D9 |
| **Total** | **11–15 working days** | |

Against roughly 18 working days to 1 September. Feasible with contingency,
assuming no other calls on the time.

**Southbound work in the Straumvakt CPMS is not in this scope.** If a pilot
runs on chargers we operate, that platform needs a site-limit endpoint and
`SetChargingProfile` support — neither of which exists today. That is CPMS
work, tracked on the CPMS side, and it makes Straumvakt one more integration
target rather than part of this service.

---

## Sequencing

1. **A + B first, to a working state.** The 3.1.0 north side is non-negotiable
   under every path — it is what RARIK talks to. Get it deployed and
   demonstrable before touching 2.0b.
2. **C in parallel or immediately after**, depending on capacity.
3. **Sample payload validates C**, it no longer gates the start.

## What building both does *not* solve

**We cannot test the 2.0b adapter without a live Driivz VEN.** Building
against an inferred wire format from a documentation snippet is the real risk
— not the effort. The sample payload is still needed, and early access to a
Driivz test environment matters more than any other single dependency.

If neither materialises in time, **Path C stands**: bypass the OpenADR layer
entirely and drive the SmartChain site limit through the Driivz API, or run
the proof on a site whose chargers point at our own OCPP endpoint.

---

## Out of scope

Targeting and object privacy · MQTT notifier binding · `/notifiers*` ·
OpenADR certification (either version) · XMLDSig · EXI · 2.0a · IEEE 2030.5
adapter · multi-tenancy · settlement · production hardening of webhook
delivery (SSRF, retry/backoff, HMAC signing).

The 2030.5 adapter is explicitly *not* in scope but the canonical model is
shaped so it could be added without restructuring.
