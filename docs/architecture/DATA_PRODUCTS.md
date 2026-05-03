# Data products taxonomy

**Status:** Sprint 6 — supports ADR 0018.
**Source:** classification of every model in
[prisma/schema.prisma](../../prisma/schema.prisma) into one of the
nine categories from
[gbtNotes/scale-to-4000-chargers-sprint-plan.md](../../gbtNotes/scale-to-4000-chargers-sprint-plan.md).

## Why this exists

At 4000 chargers, treating every table as "Prisma row writes
through Hyperdrive" stops working. Different tables have different
profiles:

- Operator login state needs a normal CRUD ORM (low volume,
  relations matter).
- MeterValues at 133 writes/sec sustained needs batched raw SQL
  and partitioned storage.
- Raw OCPP frames need a tiered hot/archive split with R2 or
  similar object storage.
- Aggregates and report-ready datasets need to be PRE-COMPUTED, not
  recomputed per page render.

This taxonomy classifies tables into one of nine categories. The
category drives decisions about partitioning, ORM choice, retention
window, and read path. Sprint 6's ADR 0018 commits to those
decisions; Sprints 7+ implement them.

## Categories

| # | Category | Profile | ORM | Partition? | Retention |
|---|---|---|---|---|---|
| 1 | **control-plane** | CRUD; admin-driven; low volume | Prisma | No | Until deletion |
| 2 | **current-state** | One row per entity, hot upsert | Raw SQL | No | While entity lives |
| 3 | **outbox** | Queue dispatch staging; ephemeral state | Raw SQL | No | 14d post-final |
| 4 | **billing-grade** | Money math; financial audit trail | Prisma writes / Raw SQL reads | Maybe (yearly by occurredAt) | 7y (VAT) |
| 5 | **time-series** | High-volume append-only telemetry | Raw SQL | YES (daily by recordedAt) | 30d hot, 7y archive |
| 6 | **raw-archive** | Original OCPP envelopes for evidence | None (R2) | n/a | 7y for billing-touched, 90d others |
| 7 | **aggregate** | Pre-computed rollups (kWh/day, etc.) | Raw SQL or Prisma | Maybe | 7y |
| 8 | **report-ready** | Read-optimised denormalised projections | Raw SQL writes / Prisma reads | Maybe | 7y |
| 9 | **API-metadata** | OAuth refresh tokens, webhook cursors | Prisma | No | Until deletion |

## Classification

Schema namespace shown in the leftmost column; alpha-sorted within.

### identity

| Table | Category | Owner module | Notes |
|---|---|---|---|
| `users` | control-plane | repos/users.ts | Admin CRUD, low volume. Prisma stays. |
| `user_credentials` | control-plane | routes/admin/auth.ts | Per-user one row; password hash. Prisma. |
| `user_tokens` *(Sprint 5.6)* | outbox-like | repos/user-tokens.ts | Short-lived bearer artefacts (invite/magic-link/password-reset). Bounded volume; Prisma is fine. Could be category 3 if volume grows. |
| `user_vendor_refs` | control-plane | repos/users.ts | Per-vendor mapping; sync-driven, not hot. Prisma. |
| `id_tokens` | control-plane | repos/id-tokens.ts | RFID + future app-JWT tokens. Hot-path read on Authorize but volume is bounded by user count × cards. Prisma OK at 4k; revisit if cards/user > 100. |
| `vendor_user_groups` | control-plane | repos/vendor-user-groups.ts | Zaptec UserGroup mirror; sync-driven. Prisma. |
| `vendor_user_group_memberships` | control-plane | repos/vendor-user-groups.ts | Same. Prisma. |
| `vehicles` | control-plane | repos/vehicles.ts | Per-driver registration; low volume. Prisma. |
| `family_groups` | control-plane | repos/family-groups.ts | Driver fleet hierarchy; low volume. Prisma. |
| `family_memberships` | control-plane | repos/family-groups.ts | Same. Prisma. |
| `platform_grants` | control-plane | repos/platform-grants.ts | One row per platform admin. Prisma. |

### tenancy

| Table | Category | Owner module | Notes |
|---|---|---|---|
| `organizations` | control-plane | repos/organizations.ts | Tenant root; low volume. Prisma. |
| `memberships` | control-plane | repos/memberships.ts | Per-org-per-user, low volume. Prisma. |

### properties / hosts

| Table | Category | Owner module | Notes |
|---|---|---|---|
| `properties` | control-plane | repos/properties.ts | Prisma. |
| `sites` | control-plane | repos/sites.ts | Prisma. |
| `site_assets` | control-plane | repos/site-tree.ts | Prisma. |
| `installations` | control-plane | repos/installations.ts | Prisma. |
| `circuits` | control-plane | repos/circuits.ts | Prisma. |
| `site_energy_policies` | control-plane | repos/site-energy.ts | Prisma. |
| `property_energy_policies` | control-plane | repos/site-energy.ts | Prisma. |
| `energy_planning_results` | aggregate | repos/site-energy.ts | Pre-computed energy-budget outputs; small per-site rows. Either Prisma or raw SQL. |

### assets / hardware

| Table | Category | Owner module | Notes |
|---|---|---|---|
| `charging_stations` | control-plane *(+ current-state fields)* | repos/chargers.ts | The row itself is control-plane. Status/lastSeen/lifetimeKwhCached fields make it part current-state too — see Drift below. |
| `evses` | control-plane *(+ current-state fields)* | repos/chargers.ts | `status`, `statusUpdatedAt` are upsert-hot. Drift candidate. |
| `connectors` | control-plane *(+ current-state fields)* | projections.ts | `status`, `statusUpdatedAt`, `errorCode` are upsert-hot — every StatusNotification writes. **PRIMARY current-state HOT PATH.** Move to raw SQL upsert per ADR 0018 milestone 6.3. |
| `capability_profiles` | control-plane | repos/chargers.ts | Prisma. |
| `control_routing_policies` | control-plane | repos/chargers.ts | Prisma. |
| `meters` | control-plane | repos/chargers.ts | Prisma. |
| `modems` | control-plane | repos/chargers.ts | Prisma. |
| `controllers` | control-plane | repos/chargers.ts | Prisma. |
| `hardware_vendors` | control-plane | repos/installations.ts | Tiny; Prisma. |
| `vendor_credentials` | control-plane | repos/credential-management.ts | Encrypted vendor portal creds; Prisma. |
| `hardware_models` | control-plane | repos/chargers.ts | Prisma. |
| `vendor_adapter_health` | aggregate | (future) | Per-adapter health rollup; small. Prisma. |
| `vendor_contract_tests` | API-metadata | (future) | Test runs; bounded volume. Prisma. |
| `vendor_asset_refs` | control-plane | repos/credential-management.ts | Prisma. |

### ocpp

| Table | Category | Owner module | Notes |
|---|---|---|---|
| `ocpp_identities` | control-plane *(+ current-state fields)* | repos/chargers.ts | `lastSeenAt`, `status` are heartbeat-hot — every Heartbeat update. Drift candidate. |
| `pending_discoveries` | outbox | repos/pending-discoveries.ts | Bounded queue of unrecognised auth attempts. Volume is operator-action-paced. Prisma OK. |
| `outbound_commands` | outbox | repos/outbound-commands.ts | Active queue of admin-dispatched commands. Bounded by inflight count + 14d ack history. **PRIMARY outbox HOT PATH** for command lifecycle. Per ADR 0018 milestone 6.3, raw SQL on the queue-dispatch hot path; Prisma for admin reads. |
| `ocpp_configuration_keys` | control-plane | repos/chargers.ts | Per-charger key state; bounded. Prisma. |

### charging

| Table | Category | Owner module | Notes |
|---|---|---|---|
| `charge_sessions` | billing-grade | repos/charge-sessions.ts | Money trail. Created on session.started, updated on meter_value, closed on session.ended. **Hot writes during active session** (every meter sample bumps energyWh). Per ADR 0018 milestone 6.3, raw SQL upsert from queue consumer; Prisma reads from operator console. |
| `meter_values` | **time-series** | projections.ts | **HIGH-VOLUME HOT PATH.** 4000 chargers × ~6 samples/min during active sessions = 24k inserts/min peak. Partition by `recordedAt` daily. Raw SQL batch insert from queue consumer. Drop after 30d (raw archive in R2 carries the evidence trail). |
| `reservations` | control-plane | (future) | Bounded; Prisma. |
| `protocol_transaction_refs` | control-plane | repos/charge-sessions.ts | OCPP transactionId mapping. Prisma. |
| `imported_cdr_refs` | control-plane | (future OCPI) | Inbound CDR links; bounded. Prisma. |

### billing

| Table | Category | Owner module | Notes |
|---|---|---|---|
| `tariffs` | control-plane | repos/tariffs.ts (Sprint 8) | Tariff definitions; admin CRUD. Prisma. |
| `customer_plans` | control-plane | (Sprint 8) | Org × tariff × validity. Prisma. |
| `subscriptions` | control-plane | (future) | Per-driver-contract; Prisma. |
| `billing_transactions` | billing-grade | (Sprint 8) | Per-session monetary line. Prisma writes (low volume per session); reads via report-ready aggregates. |
| `invoices` | billing-grade | (Sprint 8) | Generated monthly; bounded. Prisma. |
| `invoice_lines` | billing-grade | (Sprint 8) | Lines per invoice; bounded. Prisma. |
| `statements` | report-ready | (Sprint 8) | Pre-computed customer statements. Raw SQL writes from period-close job; Prisma reads for the dashboard. |
| `cost_factors` | control-plane | repos/cost-factors.ts | Tariff component definitions; tiny. Prisma. |
| `tariff_definitions` | control-plane | repos/tariffs.ts | Prisma. |
| `cost_centers` | control-plane | repos/cost-centers.ts | Prisma. |
| `contracts` | control-plane | repos/contracts.ts | Prisma. |
| `contract_factor_assignments` | control-plane | repos/contracts.ts | Prisma. |
| `driver_contracts` | control-plane | (Sprint 8) | Prisma. |
| `driver_contract_factor_overrides` | control-plane | (Sprint 8) | Prisma. |
| `contract_period_accumulators` | aggregate | (Sprint 8) | Per-period running totals; small per-period write volume. Could be Prisma; raw SQL if Sprint 9 surfaces a hot-path problem. |
| `billing_lines` | billing-grade | (Sprint 8) | Per-session monetary line items. Prisma. |

### issues

| Table | Category | Owner module | Notes |
|---|---|---|---|
| `issue_tickets` | control-plane | (post-pilot) | Operator workflow tickets; bounded. Prisma. |
| `ticket_events` | outbox-like | (post-pilot) | Per-ticket activity stream. Volume scales with operator-activity, not charger fleet. Prisma. |
| `detection_rules` | control-plane | (post-pilot) | Tiny config table. Prisma. |

### events

| Table | Category | Owner module | Notes |
|---|---|---|---|
| `event_log_entries` *(supersedes per-class tables)* | **time-series** | repos/events.ts | **HIGH-VOLUME HOT PATH.** Every translated OCPP frame writes one row. At 4000 chargers × 30s heartbeat alone = 11.5M rows/day. Partition daily by `received_at`. **PRIMARY raw SQL target.** Drop or archive after 30d. |
| `event_log_raw_protocol` | **time-series** | repos/events.ts | Same data as above (specific retention class). Confirmed in Sprint 5 as the actual table where heartbeats land. Treat as the time-series HOT PATH alias. |
| `idempotency_keys` | outbox-like | repos/events.ts | Per-eventId dedupe cache. Bounded by TTL. Prisma OK; could move to KV for sub-ms read. |

### audit

| Table | Category | Owner module | Notes |
|---|---|---|---|
| `audit_actions` | billing-grade *(audit-grade)* | lib/audit.ts | Append-only operator-action log. Volume is operator-paced (low). Prisma. 7y retention. |

### entitlements

| Table | Category | Owner module | Notes |
|---|---|---|---|
| `feature_flags` | control-plane | (future) | Tiny. Prisma. |
| `enterprise_licenses` | control-plane | (future) | Bounded. Prisma. |

### vendors

| Table | Category | Owner module | Notes |
|---|---|---|---|
| (vendor_* tables already in `hardware`/`identity` categories) | | | |

### roaming

| Table | Category | Owner module | Notes |
|---|---|---|---|
| `ocpi_tokens` | control-plane | (future OCPI) | Per-driver OCPI token cache. Bounded. Prisma. |
| `hub_connections` | API-metadata | (future OCPI) | OCPI hub credentials. Prisma. |
| `cdr_queue_entries` | outbox | (future OCPI) | Outbound CDR transmit queue. Raw SQL when implemented. |
| `external_cpms_refs` | control-plane | (future) | Prisma. |

### webhooks

| Table | Category | Owner module | Notes |
|---|---|---|---|
| `webhook_subscriptions` | control-plane | (future) | Tiny. Prisma. |
| `webhook_deliveries` | outbox | (future) | Per-fire dispatch state. Raw SQL when implemented. |
| `webhook_dead_letters` | outbox | (future) | DLQ. Raw SQL when implemented. |

## Drift candidates

These tables straddle two categories — the row is logically
control-plane (the entity itself rarely changes) but specific
fields update at telemetry rates (every Heartbeat, every
StatusNotification). Three live drift candidates:

1. **`charging_stations.lastSeenAt`** + lifetimeKwhCached — bumps
   on most projections.
2. **`evses.status`** + `statusUpdatedAt` — every StatusNotification
   for connectorId=0.
3. **`connectors.status`** + `statusUpdatedAt` + errorCode — every
   StatusNotification for non-zero connectorId.
4. **`ocpp_identities.lastSeenAt`** — every Heartbeat.

ADR 0018 milestone 6.3's recommendation: keep the row in Prisma's
control-plane (relations + tooling) but write the hot fields via
raw SQL `UPDATE` statements skipping the ORM. The table doesn't
need to migrate; only the write path for those specific columns.

## Hot paths summary (Sprint 7's implementation targets)

**HIGHEST VOLUME**:
- `meter_values` — 24k/min peak. Time-series. Raw SQL batch insert,
  daily partition.
- `event_log_entries` / `event_log_raw_protocol` — 8k/min sustained
  baseline + bursts. Time-series. Raw SQL batch insert, daily
  partition.

**HOT PATH UPSERTS** (ADR 0018 milestone 6.3 raw-SQL targets):
- `connectors.status`, `evses.status`, `ocpp_identities.lastSeenAt`,
  `charging_stations.lifetimeKwhCached` — drift fields, raw SQL
  UPDATE per projection. Volume = (StatusNotification + Heartbeat
  + MeterValues) × charger count.
- `outbound_commands.status` — raw SQL UPDATE on dispatch result.
- `idempotency_keys` — could move to KV for sub-ms read.

**EVERYTHING ELSE** stays Prisma.
