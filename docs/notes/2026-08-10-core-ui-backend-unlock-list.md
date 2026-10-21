# Core UI backend unlock list

Date: 2026-08-10

This is an interface dependency list, not approval to implement backend behavior.

| Priority | UI capability | Required contract/evidence | Remains disabled because |
|---|---|---|---|
| P0 | Driver login and identity | Rate-limited login, identity assurance and unaffiliated-driver contract | Local preview performs no authentication |
| P0 | Driver access request/invite | One identity-bound join path; no bearer password overwrite | Current visual must not imply submission |
| P0 | Session power | Authoritative measured-power provenance and stale/unavailable semantics | 0 kW must never stand in for missing telemetry |
| P0 | Session cost | Authoritative CDR price source, explicit units and provisional/final state | Fixture money is not a live charge |
| P0 | Multi-session recovery | Explicit list/current-session selection contract | Newest-session selection is not sufficient UI authority |
| P1 | Organisation driver mutation | Tenant permission, actor attribution, effective dates and audit read | Roster visibility does not prove add/deactivate authority |
| P1 | Rate version mutation | Effective-date validation, immutable historical versions and CDR linkage | Configured rates do not prove applied session pricing |
| P1 | Billing period lock | Completeness checks for meter delta, CDR provenance and corrections | A lock must not hide unresolved sessions |
| P1 | Statement delivery/retry | Material hash, recipient, provider outcome and idempotency | Provider acceptance is not receipt or payment |
| P1 | Admin support context | platform.support.enter, tenant context, expiry and full attribution | Assistance must not become impersonation |
| P1 | Platform billing reads | Explicit cross-tenant read permission and audited tenant filter | Staff identity alone is not billing authority |
| P2 | Icelandic export | Researched and validated bank/accounting formats | No supported format is currently proven |
| P2 | Reports | Stable read model, period semantics, export schema and pagination | Local fixtures only demonstrate information hierarchy |
| P2 | Standard telemetry | Measured cadence, freshness, missing/stale semantics and capacity evidence | Source shape is not runtime evidence |

## Unlock sequence

1. Make identity and access safe before enabling onboarding actions.
2. Establish measured session and CDR authority before enabling final cost language.
3. Establish tenant mutation permissions and attribution before enabling CPO actions.
4. Establish period-close invariants before enabling statement lock.
5. Establish delivery idempotency and outcome logging before retry.
6. Research Icelandic export formats before presenting export as supported.

The frontend should receive additive read contracts first. Mutations remain disabled until permission, audit, error, idempotency and rollback behavior are all testable.
