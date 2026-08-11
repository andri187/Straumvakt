# Market Core UI backend unlock list

Date: 2026-08-10

This list describes required contracts. It does not authorize backend work.

| Gate | UI command/read | Required before enabling |
|---|---|---|
| Identity | Login, invitation, installation code, access request | Rate limiting, identity binding, policy outcome, safe recovery |
| Tenant authority | Add/deactivate driver, access-group assignment | Permission, tenant scope, actor attribution, effective dates, audit |
| Organisation setup | Add site, installation or connector | Validation, vendor mapping, idempotency, rollback and partial failure |
| Telemetry | Live state, measured power, offline state | Source provenance, timestamp, freshness, stale/unavailable semantics |
| Session control | Start/stop and multi-session recovery | Ownership, transaction identity, command outcome, retry/idempotency |
| Pricing | Create/effect rate version | DSO/retailer/CPO ownership, UTC boundary, immutable history, validation |
| Cost | Provisional and final driver amount | Meter delta, CDR price authority, explicit minor units, correction model |
| Period close | Lock billing period | Completeness gate, held-session policy, immutable material, audit |
| Statement | Download/final state | Stable statement schema, finality, correction and retention contracts |
| Delivery | Send/retry bundle | Recipient, material hash, provider outcome, idempotency and evidence |
| Reporting | Export monthly report | Stable read model, pagination and approved Icelandic formats |
| Support | Enter organisation support context | `platform.support.enter`, expiry, on-behalf-of context and audit |
| Platform reads | Cross-tenant billing/readiness | Explicit platform permission and enforced tenant filter |

## Unlock order

1. Identity and tenant authority.
2. Measured session and CDR authority.
3. Versioned pricing.
4. Period completeness and immutable statements.
5. Delivery and validated exports.
6. Platform support and cross-tenant reads.

The UI should receive additive read contracts before mutations. A command remains unavailable until permission, validation, persistence, audit, idempotency, errors and rollback can all be tested.
