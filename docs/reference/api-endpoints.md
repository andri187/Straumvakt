# API endpoints — generated

**Do not edit.** Written by `scripts/gen-api-endpoints.mjs` from
`apps/api/src/index.ts` and the sub-apps it mounts. Regenerate with
`npm run api:endpoints`; `npm run check` fails if this file is stale.

Route paths are a public contract — the Flutter app and the console both
consume them. This file exists so a change to that contract shows up as a
diff in review, rather than when someone opens the app.

## Reading the Called-by column

It lists repos in THIS tree that reference the path. **Empty does not mean
dead.** Zaptec calls the webhook endpoints from their own servers, and the
public auth endpoints are hit by browsers — no grep can see either. Treat
an empty cell as "worth asking about", not as permission to delete.

**177 endpoints across 41 mounts.**

GET 83 · POST 64 · PATCH 15 · DELETE 14 · PUT 1

## /api/admin — 140 endpoints, 15 with no in-repo caller

| Method | Path | Called by | Source |
|---|---|---|---|
| GET | `/api/admin/access-requests` | — | `routes/admin/access-requests` |
| PATCH | `/api/admin/access-requests/:id` | — | `routes/admin/access-requests` |
| GET | `/api/admin/active-sessions` | — | `routes/admin/active-sessions` |
| GET | `/api/admin/agreements` | console | `routes/admin/agreements-debug` |
| GET | `/api/admin/agreements/:id` | console | `routes/admin/agreements-debug` |
| GET | `/api/admin/agreements/debug-options` | console | `routes/admin/agreements-debug` |
| POST | `/api/admin/agreements/debug-resolve` | console | `routes/admin/agreements-debug` |
| POST | `/api/admin/agreements/sessions/:sessionId/resolve` | — | `routes/admin/agreements-resolve` |
| GET | `/api/admin/billing/sessions` | console | `routes/admin/billing` |
| GET | `/api/admin/billing/sessions/:id` | console | `routes/admin/billing` |
| GET | `/api/admin/billing/sessions/:id/full` | console | `routes/admin/billing` |
| GET | `/api/admin/billing/tariffs` | console | `routes/admin/billing` |
| GET | `/api/admin/chargers` | console | `routes/admin/chargers` |
| POST | `/api/admin/chargers` | console | `routes/admin/chargers` |
| DELETE | `/api/admin/chargers/:id` | console | `routes/admin/chargers` |
| GET | `/api/admin/chargers/:id` | console | `routes/admin/chargers` |
| PATCH | `/api/admin/chargers/:id` | console | `routes/admin/chargers` |
| GET | `/api/admin/chargers/:id/active-session` | console | `routes/admin/chargers` |
| POST | `/api/admin/chargers/:id/attach-vendor` | — | `routes/admin/chargers` |
| GET | `/api/admin/chargers/:id/technical-read` | console | `routes/admin/chargers` |
| GET | `/api/admin/chargers/:id/zaptec-state` | console | `routes/admin/chargers` |
| POST | `/api/admin/chargers/:id/zaptec-state` | console | `routes/admin/chargers` |
| POST | `/api/admin/chargers/:ocppIdentityId/change-configuration` | — | `routes/admin/chargers` |
| POST | `/api/admin/chargers/:ocppIdentityId/get-configuration` | — | `routes/admin/chargers` |
| POST | `/api/admin/chargers/:ocppIdentityId/local-auth-list/push` | console | `routes/admin/chargers` |
| POST | `/api/admin/chargers/:ocppIdentityId/remote-start` | — | `routes/admin/chargers` |
| POST | `/api/admin/chargers/:ocppIdentityId/remote-stop` | — | `routes/admin/chargers` |
| GET | `/api/admin/chargers/commands/:commandId` | console | `routes/admin/chargers` |
| GET | `/api/admin/circuits` | console | `routes/admin/circuits` |
| POST | `/api/admin/circuits` | console | `routes/admin/circuits` |
| DELETE | `/api/admin/circuits/:id` | console | `routes/admin/circuits` |
| GET | `/api/admin/circuits/:id` | console | `routes/admin/circuits` |
| PATCH | `/api/admin/circuits/:id` | console | `routes/admin/circuits` |
| GET | `/api/admin/contracts` | console | `routes/admin/contracts` |
| DELETE | `/api/admin/contracts/:id` | console | `routes/admin/contracts` |
| GET | `/api/admin/contracts/:id` | console | `routes/admin/contracts` |
| PATCH | `/api/admin/contracts/:id` | console | `routes/admin/contracts` |
| GET | `/api/admin/contracts/:id/tariffs` | console | `routes/admin/contracts` |
| GET | `/api/admin/groups` | console | `routes/admin/groups` |
| GET | `/api/admin/host-applications` | console | `routes/admin/host-applications` |
| GET | `/api/admin/host-applications/:id` | console | `routes/admin/host-applications` |
| PATCH | `/api/admin/host-applications/:id` | console | `routes/admin/host-applications` |
| GET | `/api/admin/installations` | console | `routes/admin/installations` |
| POST | `/api/admin/installations` | console | `routes/admin/installations` |
| DELETE | `/api/admin/installations/:id` | console | `routes/admin/installations` |
| GET | `/api/admin/installations/:id` | console | `routes/admin/installations` |
| PATCH | `/api/admin/installations/:id` | console | `routes/admin/installations` |
| GET | `/api/admin/installations/:id/ocpp-password` | console | `routes/admin/installations` |
| PATCH | `/api/admin/installations/:id/ocpp-password` | console | `routes/admin/installations` |
| POST | `/api/admin/installations/:id/ocpp-password/disable` | console | `routes/admin/installations` |
| POST | `/api/admin/installations/:id/ocpp-password/rotate` | console | `routes/admin/installations` |
| POST | `/api/admin/login` | console | `routes/admin/auth` |
| POST | `/api/admin/logout` | console | `routes/admin/auth` |
| GET | `/api/admin/me` | console | `routes/admin/me` |
| DELETE | `/api/admin/memberships/:orgId/:userId` | console | `domains/identity/routes/admin-memberships` |
| PATCH | `/api/admin/memberships/:orgId/:userId` | console | `domains/identity/routes/admin-memberships` |
| POST | `/api/admin/onboarding/chains` | console | `routes/admin/onboarding` |
| GET | `/api/admin/orgs` | console | `routes/admin/orgs` |
| POST | `/api/admin/orgs` | console | `routes/admin/orgs` |
| GET | `/api/admin/orgs/:id` | console | `routes/admin/orgs` |
| PATCH | `/api/admin/orgs/:id` | console | `routes/admin/orgs` |
| GET | `/api/admin/orgs/:id/agreements` | console | `routes/admin/orgs` |
| POST | `/api/admin/orgs/:id/archive` | console | `routes/admin/orgs` |
| GET | `/api/admin/orgs/:id/chargers` | console | `routes/admin/orgs` |
| GET | `/api/admin/orgs/:id/contracts` | console | `routes/admin/orgs` |
| GET | `/api/admin/orgs/:id/driver-groups` | console | `routes/admin/orgs` |
| GET | `/api/admin/orgs/:id/driver-invites` | console | `routes/admin/orgs` |
| POST | `/api/admin/orgs/:id/driver-invites` | console | `routes/admin/orgs` |
| GET | `/api/admin/orgs/:id/drivers` | console | `routes/admin/orgs` |
| GET | `/api/admin/orgs/:id/family-groups` | console | `routes/admin/orgs` |
| GET | `/api/admin/orgs/:id/installations` | console | `routes/admin/orgs` |
| GET | `/api/admin/orgs/:id/memberships` | console | `routes/admin/orgs` |
| POST | `/api/admin/orgs/:id/memberships` | console | `routes/admin/orgs` |
| GET | `/api/admin/orgs/:id/properties` | console | `routes/admin/orgs` |
| GET | `/api/admin/orgs/:id/sessions` | console | `routes/admin/orgs` |
| GET | `/api/admin/orgs/:id/sessions/:sessionId` | console | `routes/admin/orgs` |
| GET | `/api/admin/orgs/:id/sites` | console | `routes/admin/orgs` |
| GET | `/api/admin/orgs/:id/sites/tree` | console | `routes/admin/orgs` |
| GET | `/api/admin/orgs/:id/tariff-chain` | console | `routes/admin/orgs` |
| GET | `/api/admin/orgs/:id/users` | console | `routes/admin/orgs` |
| GET | `/api/admin/orgs/:orgId/bill-objects` | console | `routes/admin/bill-objects` |
| POST | `/api/admin/orgs/:orgId/bill-objects` | console | `routes/admin/bill-objects` |
| GET | `/api/admin/orgs/:orgId/bill-objects/:id` | console | `routes/admin/bill-objects` |
| GET | `/api/admin/orgs/:orgId/bill-objects/:id/members` | console | `routes/admin/bill-objects` |
| POST | `/api/admin/orgs/:orgId/bill-objects/:id/members` | console | `routes/admin/bill-objects` |
| GET | `/api/admin/orgs/:orgId/driver-group-memberships` | — | `routes/admin/driver-group-memberships` |
| POST | `/api/admin/orgs/:orgId/driver-group-memberships` | — | `routes/admin/driver-group-memberships` |
| GET | `/api/admin/orgs/:orgId/invites` | console | `routes/admin/org-invites` |
| POST | `/api/admin/orgs/:orgId/invites` | console | `routes/admin/org-invites` |
| DELETE | `/api/admin/orgs/:orgId/invites/:tokenId` | console | `routes/admin/org-invites` |
| GET | `/api/admin/orgs/:orgId/vendor-credentials` | console | `routes/admin/vendor-credentials` |
| POST | `/api/admin/orgs/:orgId/vendor-credentials` | console | `routes/admin/vendor-credentials` |
| GET | `/api/admin/pending-discoveries` | console | `routes/admin/pending-discoveries` |
| DELETE | `/api/admin/pending-discoveries/:identityString` | console | `routes/admin/pending-discoveries` |
| POST | `/api/admin/pending-discoveries/clear-idle` | console | `routes/admin/pending-discoveries` |
| GET | `/api/admin/properties` | console | `routes/admin/properties` |
| POST | `/api/admin/properties` | console | `routes/admin/properties` |
| DELETE | `/api/admin/properties/:id` | console | `routes/admin/properties` |
| GET | `/api/admin/properties/:id` | console | `routes/admin/properties` |
| PATCH | `/api/admin/properties/:id` | console | `routes/admin/properties` |
| GET | `/api/admin/sites` | console | `routes/admin/sites` |
| POST | `/api/admin/sites` | console | `routes/admin/sites` |
| DELETE | `/api/admin/sites/:siteId` | console | `routes/admin/sites` |
| GET | `/api/admin/sites/:siteId` | console | `routes/admin/sites` |
| PATCH | `/api/admin/sites/:siteId` | console | `routes/admin/sites` |
| GET | `/api/admin/sites/:siteId/circuits` | console | `routes/admin/sites` |
| GET | `/api/admin/sites/:siteId/installations` | console | `routes/admin/sites` |
| POST | `/api/admin/sites/:siteId/move` | console | `routes/admin/sites` |
| GET | `/api/admin/sites/tree` | console | `routes/admin/sites` |
| DELETE | `/api/admin/tokens/:tokenId` | console | `domains/identity/routes/admin-id-tokens` |
| GET | `/api/admin/tokens/:tokenId` | console | `domains/identity/routes/admin-id-tokens` |
| PATCH | `/api/admin/tokens/:tokenId` | console | `domains/identity/routes/admin-id-tokens` |
| DELETE | `/api/admin/tokens/:tokenId/permanent` | console | `domains/identity/routes/admin-id-tokens` |
| POST | `/api/admin/tokens/backfill` | console | `domains/identity/routes/admin-id-tokens` |
| GET | `/api/admin/users` | console | `domains/identity/routes/admin-users` |
| POST | `/api/admin/users` | console | `domains/identity/routes/admin-users` |
| GET | `/api/admin/users/:id` | console | `domains/identity/routes/admin-users` |
| PATCH | `/api/admin/users/:id` | console | `domains/identity/routes/admin-users` |
| DELETE | `/api/admin/users/:id/password` | console | `domains/identity/routes/admin-users` |
| PUT | `/api/admin/users/:id/password` | console | `domains/identity/routes/admin-users` |
| GET | `/api/admin/users/:id/tokens` | console | `domains/identity/routes/admin-users` |
| POST | `/api/admin/users/:id/tokens` | console | `domains/identity/routes/admin-users` |
| GET | `/api/admin/vehicles` | console | `routes/admin/vehicles` |
| GET | `/api/admin/vehicles/:mac` | console | `routes/admin/vehicles` |
| GET | `/api/admin/vehicles/fly-health` | console | `routes/admin/vehicles` |
| GET | `/api/admin/vendor-credentials` | console | `routes/admin/vendor-credentials` |
| DELETE | `/api/admin/vendor-credentials/:id` | console | `routes/admin/vendor-credentials` |
| GET | `/api/admin/vendor-credentials/:id` | console | `routes/admin/vendor-credentials` |
| PATCH | `/api/admin/vendor-credentials/:id` | console | `routes/admin/vendor-credentials` |
| POST | `/api/admin/vendor-credentials/:id/apply` | console | `routes/admin/vendor-credentials` |
| GET | `/api/admin/vendor-credentials/:id/manage-tree` | console | `routes/admin/vendor-credentials` |
| POST | `/api/admin/vendor-credentials/:id/move` | console | `routes/admin/vendor-credentials` |
| POST | `/api/admin/vendor-credentials/:id/probe` | console | `routes/admin/vendor-credentials` |
| GET | `/api/admin/vendor-credentials/:id/probe-sessions` | — | `routes/admin/vendor-credentials` |
| POST | `/api/admin/vendor-credentials/:id/sync-sessions` | — | `routes/admin/vendor-credentials` |
| POST | `/api/admin/zaptec/bulk-auth` | console | `routes/admin/zaptec` |
| POST | `/api/admin/zaptec/discover` | console | `routes/admin/zaptec` |
| POST | `/api/admin/zaptec/import` | console | `routes/admin/zaptec` |
| POST | `/api/admin/zaptec/inspect` | — | `routes/admin/zaptec` |
| POST | `/api/admin/zaptec/probe-users` | — | `routes/admin/zaptec` |

## /api/driver — 19 endpoints, 3 with no in-repo caller

| Method | Path | Called by | Source |
|---|---|---|---|
| POST | `/api/driver/access-requests` | — | `routes/public/driver` |
| GET | `/api/driver/chargers` | mobile | `routes/public/driver` |
| GET | `/api/driver/chargers/:id/pricing` | — | `routes/public/driver` |
| GET | `/api/driver/chargers/:serial/ble-pin` | mobile | `routes/public/driver-charger-pin` |
| GET | `/api/driver/health` | — | `routes/public/driver` |
| GET | `/api/driver/installations` | console | `routes/public/driver` |
| GET | `/api/driver/invoices` | console, mobile | `routes/public/driver` |
| POST | `/api/driver/login` | console, mobile | `routes/public/driver` |
| GET | `/api/driver/me` | console, mobile | `routes/public/driver` |
| PATCH | `/api/driver/me` | console, mobile | `routes/public/driver` |
| POST | `/api/driver/redeem-invite` | console | `routes/public/driver` |
| GET | `/api/driver/sessions/:id` | console, mobile | `routes/public/driver` |
| GET | `/api/driver/sessions/current` | mobile | `routes/public/driver` |
| GET | `/api/driver/sessions/history` | console, mobile | `routes/public/driver` |
| POST | `/api/driver/start-session` | mobile | `routes/public/driver` |
| POST | `/api/driver/stop-session` | mobile | `routes/public/driver` |
| GET | `/api/driver/tap-intent` | mobile | `routes/public/driver-tap-intent` |
| POST | `/api/driver/tap-intent` | mobile | `routes/public/driver-tap-intent` |
| DELETE | `/api/driver/tap-intent/:id` | mobile | `routes/public/driver-tap-intent` |

## /api/internal — 6 endpoints

| Method | Path | Called by | Source |
|---|---|---|---|
| POST | `/api/internal/ocpp-auth` | console, gateway | `routes/internal/ocpp-auth` |
| POST | `/api/internal/ocpp-authorize` | console, gateway | `routes/internal/ocpp-authorize` |
| POST | `/api/internal/ocpp-events` | gateway | `routes/internal/ocpp-events` |
| POST | `/api/internal/pending-discovery` | gateway | `routes/internal/pending-discovery` |
| POST | `/api/internal/zaptec-state-event` | zaptec-consumer | `routes/internal/zaptec-state-event` |
| POST | `/api/internal/zaptec-trigger-sync` | zaptec-consumer | `routes/internal/zaptec-trigger-sync` |

## /api/ocpp — 1 endpoints, 1 with no in-repo caller

| Method | Path | Called by | Source |
|---|---|---|---|
| POST | `/api/ocpp/events` | — | `routes/internal/ocpp-events` |

## /api/public — 8 endpoints, 5 with no in-repo caller

| Method | Path | Called by | Source |
|---|---|---|---|
| POST | `/api/public/host-applications` | console | `routes/public/host-applications` |
| POST | `/api/public/invites/consume` | console, mobile | `routes/public/invites` |
| GET | `/api/public/invites/peek` | console | `routes/public/invites` |
| POST | `/api/public/password-reset` | — | `routes/public/password-reset` |
| POST | `/api/public/password-reset/confirm/:token` | — | `routes/public/password-reset` |
| POST | `/api/public/register` | — | `routes/public/register` |
| GET | `/api/public/verify-email/:token` | — | `routes/public/email-verification` |
| POST | `/api/public/verify-email/:token` | — | `routes/public/email-verification` |

## /api/webhooks — 3 endpoints, 3 with no in-repo caller

| Method | Path | Called by | Source |
|---|---|---|---|
| POST | `/api/webhooks/zaptec/auth` | — | `routes/webhooks/zaptec` |
| POST | `/api/webhooks/zaptec/session-end` | — | `routes/webhooks/zaptec` |
| POST | `/api/webhooks/zaptec/session-start` | — | `routes/webhooks/zaptec` |

