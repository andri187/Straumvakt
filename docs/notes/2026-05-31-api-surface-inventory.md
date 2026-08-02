# Straumvakt API surface inventory

**Date:** 2026-05-31
**Scope:** Every HTTP endpoint exposed by the Straumvakt platform as of
the `staging` branch at commit `1460733`.

## Topology

The platform is a two-Worker split (ADR 0013):

- **API Worker** — Hono on Cloudflare Workers, source at
  [apps/api/src/](../../apps/api/src/), entry at
  [apps/api/src/index.ts](../../apps/api/src/index.ts). Deployed as
  `hlada-api-staging` / `hlada-api` (manual deploy — see memory note
  `api_worker_manual_deploy`). This is the **operational API surface**
  the UI Worker, mobile driver app, OCPP gateway, and Fly AMQP consumer
  call.
- **UI Worker** — Next.js (Pages Router code at
  [src/app/](../../src/app/)) deployed via OpenNext as `hlada-staging`
  / `hlada`. Hosts the operator console UI. **Only two legacy routes
  remain in `src/app/api/`** — both transition shims pending removal
  once the gateway is fully cut over to the API Worker:
  - [src/app/api/ocpp/events/route.ts](../../src/app/api/ocpp/events/route.ts)
  - [src/app/api/internal/ocpp-auth/route.ts](../../src/app/api/internal/ocpp-auth/route.ts)

All endpoints below live in the **API Worker** unless explicitly noted.

## Mount table

Mounts are declared in [apps/api/src/index.ts](../../apps/api/src/index.ts).
Auth model per group:

| Group | Auth | Notes |
|---|---|---|
| Admin (`/api/admin/*`) | `requireAdmin` HMAC session cookie | Set by `/api/admin/login` |
| Public driver (`/api/driver/*`) | Bearer token | Issued by `/api/driver/login` |
| Public invites (`/api/public/invites/*`) | Invite token | Token is the credential |
| Internal (`/api/internal/*`, `/api/ocpp/events`) | `OCPP_INGEST_SECRET` header | Used by OCPP gateway + Fly consumer |
| Webhooks (`/api/webhooks/zaptec/*`) | `ZAPTEC_WEBHOOK_SECRET` bearer | Per AuthenticationType=Webhooks (ADR notes in `zaptec_authtype_webhooks_idtoken_required`) |

## Endpoints

### Health

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Service health probe |

### Auth

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/admin/login` | Mint HMAC admin session cookie |
| POST | `/api/admin/logout` | Clear admin session cookie |

### Admin — orgs

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/admin/orgs` | List all orgs |
| POST | `/api/admin/orgs` | Create org |
| GET | `/api/admin/orgs/:id` | Get org |
| PATCH | `/api/admin/orgs/:id` | Update org |
| POST | `/api/admin/orgs/:id/archive` | Archive org (status=archived) |
| GET | `/api/admin/orgs/:id/sites` | List sites under org |
| GET | `/api/admin/orgs/:id/installations` | List installations under org |
| GET | `/api/admin/orgs/:id/contracts` | List contracts under org |
| GET | `/api/admin/orgs/:id/tariff-chain` | Per-org tariff chain summary |
| GET | `/api/admin/orgs/:id/family-groups` | List family groups |
| GET | `/api/admin/orgs/:id/properties` | List properties |
| GET | `/api/admin/orgs/:id/users` | List users |
| GET | `/api/admin/orgs/:id/memberships` | List org memberships |
| POST | `/api/admin/orgs/:id/memberships` | Add membership to org |

### Admin — properties

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/admin/properties` | List |
| POST | `/api/admin/properties` | Create |
| GET | `/api/admin/properties/:id` | Get |
| PATCH | `/api/admin/properties/:id` | Update |
| DELETE | `/api/admin/properties/:id` | Delete |

### Admin — sites

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/admin/sites` | List |
| GET | `/api/admin/sites/tree` | Site tree with chargers + apiActive |
| POST | `/api/admin/sites` | Create |
| GET | `/api/admin/sites/:siteId` | Get |
| PATCH | `/api/admin/sites/:siteId` | Update |
| DELETE | `/api/admin/sites/:siteId` | Delete |
| POST | `/api/admin/sites/:siteId/move` | Move site to target org |
| GET | `/api/admin/sites/:siteId/circuits` | List circuits |
| GET | `/api/admin/sites/:siteId/installations` | List installations |

### Admin — installations

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/admin/installations` | List with vendors + OCPP summaries |
| POST | `/api/admin/installations` | Create |
| GET | `/api/admin/installations/:id` | Get |
| PATCH | `/api/admin/installations/:id` | Update |
| DELETE | `/api/admin/installations/:id` | Delete |
| GET | `/api/admin/installations/:id/ocpp-password` | Get OCPP password summary |
| POST | `/api/admin/installations/:id/ocpp-password/rotate` | Rotate password |
| PATCH | `/api/admin/installations/:id/ocpp-password` | Set password |
| POST | `/api/admin/installations/:id/ocpp-password/disable` | Disable OCPP auth |

### Admin — circuits

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/admin/circuits` | List |
| POST | `/api/admin/circuits` | Create |
| GET | `/api/admin/circuits/:id` | Get |
| PATCH | `/api/admin/circuits/:id` | Update |
| DELETE | `/api/admin/circuits/:id` | Delete |

### Admin — users

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/admin/users` | List |
| POST | `/api/admin/users` | Create |
| GET | `/api/admin/users/:id` | Get with memberships, tokens, agreements |
| PATCH | `/api/admin/users/:id` | Update |
| PUT | `/api/admin/users/:id/password` | Set or rotate password |
| DELETE | `/api/admin/users/:id/password` | Clear password |
| GET | `/api/admin/users/:id/tokens` | List IdTokens |
| POST | `/api/admin/users/:id/tokens` | Add IdToken |

### Admin — memberships

| Method | Path | Purpose |
|---|---|---|
| PATCH | `/api/admin/memberships/:orgId/:userId` | Update membership role |
| DELETE | `/api/admin/memberships/:orgId/:userId` | Remove membership |

### Admin — chargers

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/admin/chargers` | List |
| POST | `/api/admin/chargers` | Create |
| GET | `/api/admin/chargers/:id` | Get |
| GET | `/api/admin/chargers/:id/technical-read` | Live vendor-side technical read |
| GET | `/api/admin/chargers/:id/active-session` | Live session detail with timers + samples |
| GET | `/api/admin/chargers/:id/zaptec-state` | Raw Zaptec state + detail snapshot |
| POST | `/api/admin/chargers/:id/zaptec-state` | Write Zaptec property values |
| PATCH | `/api/admin/chargers/:id` | Update |
| DELETE | `/api/admin/chargers/:id` | Delete |
| POST | `/api/admin/chargers/:id/attach-vendor` | Attach Zaptec UUID + credential to OcppIdentity |
| POST | `/api/admin/chargers/:ocppIdentityId/remote-start` | Enqueue RemoteStartTransaction |
| POST | `/api/admin/chargers/:ocppIdentityId/remote-stop` | Enqueue RemoteStopTransaction |
| POST | `/api/admin/chargers/:ocppIdentityId/get-configuration` | Enqueue GetConfiguration |
| POST | `/api/admin/chargers/:ocppIdentityId/change-configuration` | Enqueue ChangeConfiguration |
| POST | `/api/admin/chargers/:ocppIdentityId/local-auth-list/push` | Push IdToken via SendLocalList |
| GET | `/api/admin/chargers/commands/:commandId` | Poll outbound command status |

### Admin — vehicles

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/admin/vehicles` | List sessions with vehicle-identity signals |
| GET | `/api/admin/vehicles/fly-health` | Probe Fly AMQP consumer health |
| GET | `/api/admin/vehicles/:mac` | Vehicle recurrence by EV PLC MAC |

### Admin — active sessions

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/admin/active-sessions` | List live charging sessions |

### Admin — onboarding

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/admin/onboarding/chains` | Create onboarding chain (multi-charger) |

### Admin — me

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/admin/me` | Session introspection (email + role) |

### Admin — zaptec

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/admin/zaptec/discover` | Discover installations + chargers |
| POST | `/api/admin/zaptec/inspect` | Inspect per-charger OCPP config |
| POST | `/api/admin/zaptec/probe-users` | Probe Zaptec user/group endpoints |
| POST | `/api/admin/zaptec/bulk-auth` | Cascade-toggle AuthenticationRequired |
| POST | `/api/admin/zaptec/import` | Import Zaptec installation into schema |

### Admin — pending discoveries

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/admin/pending-discoveries` | List pending charger discoveries |
| POST | `/api/admin/pending-discoveries/clear-idle` | Bulk-delete idle pending rows |
| DELETE | `/api/admin/pending-discoveries/:identityString` | Dismiss one pending row |

### Admin — vendor credentials

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/admin/vendor-credentials` | List all |
| GET | `/api/admin/vendor-credentials/:id` | Get |
| PATCH | `/api/admin/vendor-credentials/:id` | Update password/status/notes |
| GET | `/api/admin/vendor-credentials/:id/probe-sessions` | Diff Zaptec history vs DB |
| POST | `/api/admin/vendor-credentials/:id/sync-sessions` | Backfill sessions from Zaptec |
| POST | `/api/admin/vendor-credentials/:id/probe` | Discover chargers visible to credential |
| GET | `/api/admin/vendor-credentials/:id/manage-tree` | Zaptec vs DB diff tree |
| POST | `/api/admin/vendor-credentials/:id/apply` | Apply selection of Zaptec chargers |
| POST | `/api/admin/vendor-credentials/:id/move` | Move credential to target org |
| DELETE | `/api/admin/vendor-credentials/:id` | Delete credential |
| GET | `/api/admin/orgs/:orgId/vendor-credentials` | List org-scoped credentials |
| POST | `/api/admin/orgs/:orgId/vendor-credentials` | Create credential under org |

### Admin — groups

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/admin/groups` | List cross-org family + vendor user groups |

### Admin — tokens (IdToken / RFID)

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/admin/tokens/backfill` | Backfill primary RFID for users without tokens |
| GET | `/api/admin/tokens/:tokenId` | Get IdToken row |
| DELETE | `/api/admin/tokens/:tokenId` | Revoke (soft) |
| DELETE | `/api/admin/tokens/:tokenId/permanent` | Hard-delete |
| PATCH | `/api/admin/tokens/:tokenId` | Edit value/label/scope/expiry |

### Admin — org invites

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/admin/orgs/:orgId/invites` | Create agent invite |
| GET | `/api/admin/orgs/:orgId/invites` | List outstanding invites for org |
| DELETE | `/api/admin/orgs/:orgId/invites/:tokenId` | Revoke invite |

### Admin — billing

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/admin/billing/sessions` | List session ledger with totals |
| GET | `/api/admin/billing/sessions/:id` | Single-session detail (header + samples) |
| GET | `/api/admin/billing/sessions/:id/full` | Full enriched session detail |
| GET | `/api/admin/billing/tariffs` | Tariff catalogue with attachment counts |
| GET | `/api/admin/billing/tariffs/:id/detail` | Single tariff detail + usage |
| GET | `/api/admin/billing/dso` | DSO-tier cost-factor summary |
| GET | `/api/admin/billing/contracts` | List agreements + tiles |
| GET | `/api/admin/billing/driver-contracts` | Driver group memberships + tiles |
| GET | `/api/admin/billing/cost-factors` | Cost-factor catalogue summary |
| POST | `/api/admin/billing/cost-factors` | Create cost factor |
| PATCH | `/api/admin/billing/cost-factors/:id` | Edit cost factor |
| POST | `/api/admin/billing/cost-factors/:id/deactivate` | Archive cost factor |
| POST | `/api/admin/billing/cost-factors/:id/reactivate` | Reactivate cost factor |
| GET | `/api/admin/billing/electricity` | Electricity-tier catalogue |
| GET | `/api/admin/billing/summary` | Dashboard tiles (period totals) |
| GET | `/api/admin/billing/cost-centers` | Cost-centers per period |
| GET | `/api/admin/billing/rate-references` | Catalogue grouped by code |
| GET | `/api/admin/billing/rate-references/:id` | Get |
| POST | `/api/admin/billing/rate-references` | Stage new version |
| PATCH | `/api/admin/billing/rate-references/:id` | Edit notes/supplier |
| POST | `/api/admin/billing/rate-references/:id/retire` | Retire |
| GET | `/api/admin/billing/rate-references/cost-factors` | Agreement cost-factor list for selects |
| POST | `/api/admin/billing/tariffs-mgmt` | Create draft TariffDefinition |
| PATCH | `/api/admin/billing/tariffs-mgmt/:id` | Edit TariffDefinition |
| POST | `/api/admin/billing/tariffs-mgmt/:id/clone` | Clone tariff into new draft |
| POST | `/api/admin/billing/tariffs-mgmt/:id/publish` | Publish draft (draft → active) |
| POST | `/api/admin/billing/tariffs-mgmt/:id/retire` | Retire (→ retired) |
| GET | `/api/admin/billing/enrichment` | Enrichment-status summary + sessions |

### Admin — contracts

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/admin/contracts` | List platform-wide |
| GET | `/api/admin/contracts/:id` | Get |
| GET | `/api/admin/contracts/:id/tariffs` | Resolved DSO + retailer tariffs |
| PATCH | `/api/admin/contracts/:id` | Update |
| DELETE | `/api/admin/contracts/:id` | Delete |

### Admin — agreements (Sprint 9 / ADR 0019)

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/admin/agreements` | List (pilot types) |
| GET | `/api/admin/agreements/:id` | Detail with clauses + memberships |
| POST | `/api/admin/agreements/debug-resolve` | Dry-run resolver for (driver, charger) |
| GET | `/api/admin/agreements/debug-options` | Drivers + chargers for debug form |
| POST | `/api/admin/agreements/sessions/:sessionId/resolve` | Resolve session + write `billing_lines` |

### Public — driver app (Flutter mobile)

Bearer-token auth. CORS allowlist enforced on the route group.

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/driver/login` | Email + password login (issues bearer tokens) |
| GET | `/api/driver/me` | Profile |
| GET | `/api/driver/chargers` | Chargers accessible via DriverGroupMembership |
| GET | `/api/driver/installations` | Installations driver can charge at now |
| GET | `/api/driver/chargers/:id/pricing` | Clause breakdown for one charger |
| POST | `/api/driver/start-session` | Request RemoteStartTransaction |
| GET | `/api/driver/health` | Driver-API health probe |

### Public — invites

Gated by invite token, not the admin session cookie.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/public/invites/peek` | Read invite context by token |
| POST | `/api/public/invites/consume` | Accept invite + set password |

### Internal — gateway / OCPP

Gated by `OCPP_INGEST_SECRET` header (ADR 0004).

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/internal/ocpp-auth` | Gateway charger Basic-Auth lookup |
| POST | `/api/internal/ocpp-authorize` | Resolve idTag → verdict (Accept/Block/Expired/Invalid) |
| POST | `/api/internal/ocpp-events` | OCPP event ingest from gateway |
| POST | `/api/ocpp/events` | **Legacy alias** for `ocpp-events` (Sprint 4.5 transition; drops once every gateway uses the new URL) |
| POST | `/api/internal/pending-discovery` | Log no-auth charger discovery attempt |

### Internal — zaptec (Fly AMQP consumer → API)

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/internal/zaptec-trigger-sync` | Claim-check trigger from consumer; API fetches session payload via REST + writes through |
| POST | `/api/internal/zaptec-state-event` | Per-state observation ingest from consumer |

### Webhooks — zaptec (AuthenticationType=Webhooks)

Bearer secret in `Authorization` header — value matches `env.ZAPTEC_WEBHOOK_SECRET`.

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/webhooks/zaptec/auth` | Per-RFID Accept/Reject webhook |
| POST | `/api/webhooks/zaptec/session-start` | Session-start webhook |
| POST | `/api/webhooks/zaptec/session-end` | Session-end webhook + cost |

## Notes for maintainers

- The legacy `src/app/api/ocpp/events/route.ts` and
  `src/app/api/internal/ocpp-auth/route.ts` in the UI Worker are dead
  code after the gateway cutover. `apps/api/src/index.ts` has the
  removal trigger documented in lines 171–179.
- Vendor-credentials mount appears twice in
  [apps/api/src/index.ts](../../apps/api/src/index.ts): once as
  `/api/admin/vendor-credentials` (platform-wide list/manage) and once
  as `/api/admin/orgs/:orgId/vendor-credentials` (org-scoped). Same
  sub-router file, different mount prefixes.
- `org-invites` mounts at `/api/admin/orgs` (not
  `/api/admin/org-invites`) because the relative paths inside the
  sub-router already include `/:orgId/invites/...`.
- The API Worker also runs queue consumers and cron handlers (see
  [apps/api/src/index.ts:246-426](../../apps/api/src/index.ts#L246-L426))
  — those are not HTTP endpoints and intentionally not listed above.
