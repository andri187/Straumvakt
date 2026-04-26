# ADR 0011 - Control-Plane Optionality + Protocol-Neutral Operations

**Status:** Accepted
**Date:** 2026-04-26
**Sprint:** documentation lands immediately; schema/code changes are deferred to a follow-up Phase-3 ADR/migration before pilot data is created.
**Supersedes (in part):** [ADR 0001](./0001-v3-foundation-schema.md), [ADR 0002](./0002-hardware-catalog-and-installations.md), and [ADR 0004](./0004-ocpp-transport-service-binding.md) where they imply that `OCPPIdentity` is the center of the charger/session model. Native OCPP remains supported.
**Rollback anchor:** `pre-control-plane-optionality-2026-04-26` (tag reserved before any future schema migration or destructive apply).

## Context

The current V3 foundation can speak OCPP 1.6J and has a useful event-log
pipeline, but the data model still reads as OCPP-first:

```text
SiteAsset -> Charger -> OCPPIdentity -> Connector -> ChargeSession
```

That shape is too narrow for the commercial product. Many AC customers
already have working charger fleets locked into Zaptec, Easee, Monta,
Driivz, or another OEM/CPMS. They may not want Straumvakt to take over
OCPP auth/control. They still need Straumvakt for operations, billing,
issues, reporting, intelligence, cost allocation, asset registry, and
contractor workflow.

AC OEM APIs make this especially important:

- **Easee API mode** can support API-side authorization/start/stop/read
  sessions when permissions allow. Straumvakt can operate above Easee
  without owning OCPP.
- **Zaptec API mode** is stronger for discovery, state, charge history,
  command/enrichment, and may use webhook authorization or native OCPP
  depending on installation capability. Straumvakt must support all
  of these without pretending Zaptec REST, webhook auth, and OCPP are
  the same control path.
- **External CPMS overlay mode** keeps an existing OCPP/CPMS provider
  as the control plane while Straumvakt imports sessions/CDRs/status
  and handles the operating and commercial layer.

The gap is conceptual, not just naming. `OCPPIdentity` is a protocol
endpoint. It is not the physical charger. It is not the EVSE. It is
not the connector. It is one possible control attachment on a physical
charging asset.

## Decision

Straumvakt is a protocol-neutral charging operating platform. Native
OCPP is one supported control plane, not the required root of the
asset/session model.

The canonical operating modes are:

| Mode | Control owner | Straumvakt role |
|---|---|---|
| Native OCPP | Straumvakt OCPP gateway | Auth, commands, sessions, CDRs, operations, billing, issues, intelligence |
| OEM API control | Vendor/OEM API such as Easee or Zaptec | API auth/control where supported, plus operations, billing, issues, intelligence |
| Hybrid | Split by asset/control domain | Route each command/data flow by capability and policy |
| External CPMS overlay | Existing CPMS/OCPP provider | Import/sync sessions, CDRs, status, assets; operate commercially above it |
| Read-only intelligence | External system | Reporting, cost allocation, issue intelligence, audit, dashboards |

### Canonical modelling rule

Physical charging equipment must exist independently of the control
plane. Future schema work should move toward:

```text
ChargingStation -> EVSE -> Connector
```

with optional attachments:

```text
OcppIdentity / OcppEndpoint
VendorAssetRef
ExternalCpmsRef
ControlRoutingPolicy
CapabilityProfile
ProtocolTransactionRef
ImportedCdrRef
```

`ChargeSession` should anchor to the physical connector/EVSE first.
OCPP transaction IDs, vendor session IDs, and external CPMS session IDs
are protocol/source references, not the primary session identity.

### Capability and routing rule

Every controllable action must be resolved through a capability and
routing policy, not through hardcoded assumptions that `routedTo =
"ocpp"`:

- start / authorize
- stop / deauthorize
- unlock connector
- reset / reboot
- configuration read/write
- status/health reads
- session/CDR import

If a capability is absent, Straumvakt may still operate in read-only or
commercial mode. Lack of control must not prevent billing allocation,
issue tracking, reporting, or asset registry.

### Pilot rule

The pilot proves Straumvakt as the operating/commercial layer. It does
not need full OCPP 2.x or every OEM command. It must, however, avoid
locking the product story to native OCPP only.

Pilot should demonstrate at least two asset/control shapes when possible:

1. one native-OCPP path, and
2. one OEM/API or external-control path represented in the same
   operations/billing/asset model.

## Operating mode impact

- **Native OCPP:** unchanged as a supported mode. The Sprint 1 gateway
  remains valuable, but it becomes one adapter behind the operating
  model.
- **Hybrid:** becomes explicit. Zaptec/Easee/OCPP can coexist per
  charger, per command, or per data surface.
- **Overlay / external CPMS:** becomes first-class. Imported sessions
  and CDRs must not require Straumvakt-owned OCPP identity rows.
- **Read-only intelligence:** becomes a valid product tier. Billing
  preview, cost allocation, issue intelligence, and reporting can work
  from imported data.

## Consequences

### Positive

- Straumvakt can sell into customers who cannot or will not replace
  their current OCPP/CPMS provider.
- AC OEM integrations become commercially meaningful, not just
  enrichment sidecars.
- The Issue Engine and billing/cost-center model can work across
  native OCPP, vendor API, external CPMS, and read-only imports.
- OCPP 2.0.1 readiness improves because the future asset hierarchy
  aligns better with ChargingStation / EVSE / Connector concepts.

### Negative

- The current schema is now knowingly provisional around charger,
  connector, and session anchoring.
- Diagrams and docs that show `OCPPIdentity -> Connector` as the
  physical hierarchy need a follow-up regeneration.
- Sprint 2 gains an additional design obligation before any pilot data:
  decide whether the physical `ChargingStation -> EVSE -> Connector`
  correction lands before applying the consolidated foundation
  migration.
- API/vendor adapters need capability metadata. A simple CRUD wizard is
  not enough.

### Neutral

- The existing OCPP 1.6J gateway, outbox, event log, and configuration
  key registry remain useful.
- ADR 0011 is documentation/design only. No schema or code changes land
  in this ADR.
- A future ADR/migration should define exact Prisma models and data
  migration steps once the operator approves Phase 3.

## Alternatives considered

**Stay OCPP-first for pilot and fix later.** Rejected. This would make
the pilot prove the wrong story: "Straumvakt replaces your CPMS" rather
than "Straumvakt operates above whichever control plane you already
have."

**Make `identityString` globally unique and keep the model otherwise.**
Rejected as insufficient. It fixes one tenant-auth bug, but not the
physical/control-plane conflation.

**Treat OEM APIs as enrichment only.** Rejected. Easee-like API control
can be a real operating path. Zaptec webhook/API/OCPP combinations also
need explicit modelling.

**Skip physical EVSE modelling until OCPP 2.0.1.** Rejected as likely
to create a second migration later. The modelling pressure already
exists for overlay and vendor API mode.

## References

- [`docs/architecture/STRAUMVAKT_ARCHITECTURE_V3.md`](../architecture/STRAUMVAKT_ARCHITECTURE_V3.md) Sections 1, 2, 4, 5, 10
- [`docs/architecture/STRAUMVAKT_V3_DELIVERY_PLAN.md`](../architecture/STRAUMVAKT_V3_DELIVERY_PLAN.md) Sections 1, 2, 5, 13, 14
- [`docs/sprints/SPRINT_02_TASKS.md`](../sprints/SPRINT_02_TASKS.md) Sprint 2 control-plane optionality amendments
- [`docs/architecture/CHANGE_MANAGEMENT.md`](../architecture/CHANGE_MANAGEMENT.md) Rule 5 process additions for operating-mode impact
- [`docs/notes/2026-04-26-rev4-checkpoint.md`](../notes/2026-04-26-rev4-checkpoint.md) updated with the new pending ADR/migration decision
