# API endpoints — generated

**Do not edit.** Written by `scripts/gen-api-endpoints.mjs` from
`apps/api/src/index.ts` and the sub-apps it mounts. Regenerate with
`npm run api:endpoints`; `npm run check` fails if this file is stale.

Route paths are a public contract — the Flutter app and the console both
consume them. This file exists so a change to that contract shows up as a
diff in review, rather than when someone opens the app.

**Grouped by domain**, per the split in
[the transition plan](../notes/2026-08-06-drizzle-transition-plan.md):

```
commercial -> charging -> protocol -> assets -> identity
  vendor off the chain (nothing may import it)
  platform at the bottom (imports nothing)
```

Ownership is an explicit map in the generator, not inferred from what the
handlers touch. Inference was tried and abandoned: repositories import each
other, so one hop lights up six domains and `/api/admin/users` came out
"commercial" on the strength of a single degraded agreements read.

## Reading the Called-by column

It lists repos in THIS tree that reference the path. **Empty does not mean
dead.** Zaptec calls the webhook endpoints from their own servers, and the
public auth endpoints are hit by browsers — no grep can see either. Treat
an empty cell as "worth asking about", not as permission to delete.

**187 endpoints across 41 mounts.**

GET 86 · POST 71 · PATCH 15 · DELETE 14 · PUT 1

| Domain | Endpoints | No in-repo caller |
|---|---:|---:|
| identity | 75 | 63 |
| assets | 45 | 41 |
| protocol | 8 | 3 |
| charging | 4 | 0 |
| commercial | 33 | 24 |
| vendor | 22 | 20 |

## identity — 75 endpoints, 63 with no in-repo caller

| Method | Path | Called by | Source |
|---|---|---|---|
| GET | `/api/admin/groups` | — | `routes/admin/groups` |
| GET | `/api/admin/host-applications` | console | `routes/admin/host-applications` |
| GET | `/api/admin/host-applications/:id` | — | `routes/admin/host-applications` |
| PATCH | `/api/admin/host-applications/:id` | — | `routes/admin/host-applications` |
| POST | `/api/admin/login` | console | `routes/admin/auth` |
| POST | `/api/admin/logout` | console | `routes/admin/auth` |
| GET | `/api/admin/me` | console | `routes/admin/me` |
| DELETE | `/api/admin/memberships/:orgId/:userId` | — | `domains/identity/routes/admin-memberships` |
| PATCH | `/api/admin/memberships/:orgId/:userId` | — | `domains/identity/routes/admin-memberships` |
| GET | `/api/admin/orgs` | console | `routes/admin/orgs` |
| POST | `/api/admin/orgs` | console | `routes/admin/orgs` |
| GET | `/api/admin/orgs/:orgId` | console | `routes/admin/orgs` |
| PATCH | `/api/admin/orgs/:orgId` | console | `routes/admin/orgs` |
| GET | `/api/admin/orgs/:orgId/agreements` | — | `routes/admin/orgs` |
| POST | `/api/admin/orgs/:orgId/archive` | — | `routes/admin/orgs` |
| GET | `/api/admin/orgs/:orgId/bill-objects` | — | `routes/admin/bill-objects` |
| POST | `/api/admin/orgs/:orgId/bill-objects` | — | `routes/admin/bill-objects` |
| GET | `/api/admin/orgs/:orgId/bill-objects/:id` | — | `routes/admin/bill-objects` |
| GET | `/api/admin/orgs/:orgId/bill-objects/:id/members` | — | `routes/admin/bill-objects` |
| POST | `/api/admin/orgs/:orgId/bill-objects/:id/members` | — | `routes/admin/bill-objects` |
| GET | `/api/admin/orgs/:orgId/billing/periods/:year/:month` | — | `routes/admin/billing/periods` |
| POST | `/api/admin/orgs/:orgId/billing/periods/:year/:month/activity` | — | `routes/admin/billing/periods` |
| POST | `/api/admin/orgs/:orgId/billing/periods/:year/:month/assertions` | — | `routes/admin/billing/periods` |
| POST | `/api/admin/orgs/:orgId/billing/periods/:year/:month/close` | — | `routes/admin/billing/periods` |
| GET | `/api/admin/orgs/:orgId/billing/periods/:year/:month/document` | — | `routes/admin/billing/periods` |
| POST | `/api/admin/orgs/:orgId/billing/periods/:year/:month/issue` | — | `routes/admin/billing/periods` |
| POST | `/api/admin/orgs/:orgId/billing/periods/:year/:month/open` | — | `routes/admin/billing/periods` |
| POST | `/api/admin/orgs/:orgId/billing/periods/:year/:month/price` | — | `routes/admin/billing/periods` |
| GET | `/api/admin/orgs/:orgId/billing/statements` | — | `routes/admin/billing/periods` |
| GET | `/api/admin/orgs/:orgId/chargers` | console | `routes/admin/orgs` |
| GET | `/api/admin/orgs/:orgId/contracts` | — | `routes/admin/orgs` |
| GET | `/api/admin/orgs/:orgId/driver-group-memberships` | — | `routes/admin/driver-group-memberships` |
| POST | `/api/admin/orgs/:orgId/driver-group-memberships` | — | `routes/admin/driver-group-memberships` |
| GET | `/api/admin/orgs/:orgId/driver-groups` | — | `routes/admin/orgs` |
| GET | `/api/admin/orgs/:orgId/driver-invites` | — | `routes/admin/orgs` |
| POST | `/api/admin/orgs/:orgId/driver-invites` | — | `routes/admin/orgs` |
| GET | `/api/admin/orgs/:orgId/drivers` | — | `routes/admin/orgs` |
| GET | `/api/admin/orgs/:orgId/family-groups` | — | `routes/admin/orgs` |
| GET | `/api/admin/orgs/:orgId/installations` | console | `routes/admin/orgs` |
| GET | `/api/admin/orgs/:orgId/invites` | — | `routes/admin/org-invites` |
| POST | `/api/admin/orgs/:orgId/invites` | — | `routes/admin/org-invites` |
| DELETE | `/api/admin/orgs/:orgId/invites/:tokenId` | — | `routes/admin/org-invites` |
| GET | `/api/admin/orgs/:orgId/memberships` | — | `routes/admin/orgs` |
| POST | `/api/admin/orgs/:orgId/memberships` | — | `routes/admin/orgs` |
| GET | `/api/admin/orgs/:orgId/properties` | — | `routes/admin/orgs` |
| GET | `/api/admin/orgs/:orgId/sessions` | console | `routes/admin/orgs` |
| GET | `/api/admin/orgs/:orgId/sessions/:sessionId` | — | `routes/admin/orgs` |
| GET | `/api/admin/orgs/:orgId/sites` | — | `routes/admin/orgs` |
| GET | `/api/admin/orgs/:orgId/sites/tree` | — | `routes/admin/orgs` |
| GET | `/api/admin/orgs/:orgId/tariff-chain` | — | `routes/admin/orgs` |
| GET | `/api/admin/orgs/:orgId/users` | — | `routes/admin/orgs` |
| DELETE | `/api/admin/tokens/:tokenId` | — | `domains/identity/routes/admin-id-tokens` |
| GET | `/api/admin/tokens/:tokenId` | — | `domains/identity/routes/admin-id-tokens` |
| PATCH | `/api/admin/tokens/:tokenId` | — | `domains/identity/routes/admin-id-tokens` |
| DELETE | `/api/admin/tokens/:tokenId/permanent` | — | `domains/identity/routes/admin-id-tokens` |
| POST | `/api/admin/tokens/backfill` | — | `domains/identity/routes/admin-id-tokens` |
| GET | `/api/admin/users` | — | `domains/identity/routes/admin-users` |
| POST | `/api/admin/users` | — | `domains/identity/routes/admin-users` |
| GET | `/api/admin/users/:id` | — | `domains/identity/routes/admin-users` |
| PATCH | `/api/admin/users/:id` | — | `domains/identity/routes/admin-users` |
| DELETE | `/api/admin/users/:id/password` | — | `domains/identity/routes/admin-users` |
| PUT | `/api/admin/users/:id/password` | — | `domains/identity/routes/admin-users` |
| GET | `/api/admin/users/:id/tokens` | — | `domains/identity/routes/admin-users` |
| POST | `/api/admin/users/:id/tokens` | — | `domains/identity/routes/admin-users` |
| GET | `/api/admin/vehicles` | — | `routes/admin/vehicles` |
| GET | `/api/admin/vehicles/:mac` | — | `routes/admin/vehicles` |
| GET | `/api/admin/vehicles/fly-health` | — | `routes/admin/vehicles` |
| POST | `/api/public/host-applications` | — | `routes/public/host-applications` |
| POST | `/api/public/invites/consume` | mobile | `routes/public/invites` |
| GET | `/api/public/invites/peek` | — | `routes/public/invites` |
| POST | `/api/public/password-reset` | — | `routes/public/password-reset` |
| POST | `/api/public/password-reset/confirm/:token` | — | `routes/public/password-reset` |
| POST | `/api/public/register` | — | `routes/public/register` |
| GET | `/api/public/verify-email/:token` | — | `routes/public/email-verification` |
| POST | `/api/public/verify-email/:token` | — | `routes/public/email-verification` |

## assets — 45 endpoints, 41 with no in-repo caller

| Method | Path | Called by | Source |
|---|---|---|---|
| GET | `/api/admin/chargers` | console | `routes/admin/chargers` |
| POST | `/api/admin/chargers` | console | `routes/admin/chargers` |
| DELETE | `/api/admin/chargers/:id` | — | `routes/admin/chargers` |
| GET | `/api/admin/chargers/:id` | — | `routes/admin/chargers` |
| PATCH | `/api/admin/chargers/:id` | — | `routes/admin/chargers` |
| GET | `/api/admin/chargers/:id/active-session` | — | `routes/admin/chargers` |
| POST | `/api/admin/chargers/:id/attach-vendor` | — | `routes/admin/chargers` |
| GET | `/api/admin/chargers/:id/technical-read` | — | `routes/admin/chargers` |
| GET | `/api/admin/chargers/:id/zaptec-state` | — | `routes/admin/chargers` |
| POST | `/api/admin/chargers/:id/zaptec-state` | — | `routes/admin/chargers` |
| POST | `/api/admin/chargers/:ocppIdentityId/change-configuration` | — | `routes/admin/chargers` |
| POST | `/api/admin/chargers/:ocppIdentityId/get-configuration` | — | `routes/admin/chargers` |
| POST | `/api/admin/chargers/:ocppIdentityId/local-auth-list/push` | — | `routes/admin/chargers` |
| POST | `/api/admin/chargers/:ocppIdentityId/remote-start` | — | `routes/admin/chargers` |
| POST | `/api/admin/chargers/:ocppIdentityId/remote-stop` | — | `routes/admin/chargers` |
| GET | `/api/admin/chargers/commands/:commandId` | — | `routes/admin/chargers` |
| GET | `/api/admin/circuits` | — | `routes/admin/circuits` |
| POST | `/api/admin/circuits` | — | `routes/admin/circuits` |
| DELETE | `/api/admin/circuits/:id` | — | `routes/admin/circuits` |
| GET | `/api/admin/circuits/:id` | — | `routes/admin/circuits` |
| PATCH | `/api/admin/circuits/:id` | — | `routes/admin/circuits` |
| GET | `/api/admin/installations` | console | `routes/admin/installations` |
| POST | `/api/admin/installations` | console | `routes/admin/installations` |
| DELETE | `/api/admin/installations/:id` | — | `routes/admin/installations` |
| GET | `/api/admin/installations/:id` | — | `routes/admin/installations` |
| PATCH | `/api/admin/installations/:id` | — | `routes/admin/installations` |
| GET | `/api/admin/installations/:id/ocpp-password` | — | `routes/admin/installations` |
| PATCH | `/api/admin/installations/:id/ocpp-password` | — | `routes/admin/installations` |
| POST | `/api/admin/installations/:id/ocpp-password/disable` | — | `routes/admin/installations` |
| POST | `/api/admin/installations/:id/ocpp-password/rotate` | — | `routes/admin/installations` |
| POST | `/api/admin/onboarding/chains` | — | `routes/admin/onboarding` |
| GET | `/api/admin/properties` | — | `routes/admin/properties` |
| POST | `/api/admin/properties` | — | `routes/admin/properties` |
| DELETE | `/api/admin/properties/:id` | — | `routes/admin/properties` |
| GET | `/api/admin/properties/:id` | — | `routes/admin/properties` |
| PATCH | `/api/admin/properties/:id` | — | `routes/admin/properties` |
| GET | `/api/admin/sites` | — | `routes/admin/sites` |
| POST | `/api/admin/sites` | — | `routes/admin/sites` |
| DELETE | `/api/admin/sites/:siteId` | — | `routes/admin/sites` |
| GET | `/api/admin/sites/:siteId` | — | `routes/admin/sites` |
| PATCH | `/api/admin/sites/:siteId` | — | `routes/admin/sites` |
| GET | `/api/admin/sites/:siteId/circuits` | — | `routes/admin/sites` |
| GET | `/api/admin/sites/:siteId/installations` | — | `routes/admin/sites` |
| POST | `/api/admin/sites/:siteId/move` | — | `routes/admin/sites` |
| GET | `/api/admin/sites/tree` | — | `routes/admin/sites` |

## protocol — 8 endpoints, 3 with no in-repo caller

| Method | Path | Called by | Source |
|---|---|---|---|
| GET | `/api/admin/pending-discoveries` | console | `routes/admin/pending-discoveries` |
| DELETE | `/api/admin/pending-discoveries/:identityString` | — | `routes/admin/pending-discoveries` |
| POST | `/api/admin/pending-discoveries/clear-idle` | — | `routes/admin/pending-discoveries` |
| POST | `/api/internal/ocpp-auth` | gateway | `routes/internal/ocpp-auth` |
| POST | `/api/internal/ocpp-authorize` | gateway | `routes/internal/ocpp-authorize` |
| POST | `/api/internal/ocpp-events` | gateway | `routes/internal/ocpp-events` |
| POST | `/api/internal/pending-discovery` | gateway | `routes/internal/pending-discovery` |
| POST | `/api/ocpp/events` | — | `routes/internal/ocpp-events` |

## charging — 4 endpoints

| Method | Path | Called by | Source |
|---|---|---|---|
| GET | `/api/admin/active-sessions` | console | `routes/admin/active-sessions` |
| GET | `/api/driver/tap-intent` | mobile | `routes/public/driver-tap-intent` |
| POST | `/api/driver/tap-intent` | mobile | `routes/public/driver-tap-intent` |
| DELETE | `/api/driver/tap-intent/:id` | mobile | `routes/public/driver-tap-intent` |

## commercial — 33 endpoints, 24 with no in-repo caller

| Method | Path | Called by | Source |
|---|---|---|---|
| GET | `/api/admin/access-requests` | — | `routes/admin/access-requests` |
| PATCH | `/api/admin/access-requests/:id` | — | `routes/admin/access-requests` |
| GET | `/api/admin/agreements` | — | `routes/admin/agreements-debug` |
| GET | `/api/admin/agreements/:id` | — | `routes/admin/agreements-debug` |
| GET | `/api/admin/agreements/debug-options` | — | `routes/admin/agreements-debug` |
| POST | `/api/admin/agreements/debug-resolve` | — | `routes/admin/agreements-debug` |
| POST | `/api/admin/agreements/sessions/:sessionId/resolve` | — | `routes/admin/agreements-resolve` |
| GET | `/api/admin/billing/sessions` | — | `routes/admin/billing` |
| GET | `/api/admin/billing/sessions/:id` | — | `routes/admin/billing` |
| GET | `/api/admin/billing/sessions/:id/full` | — | `routes/admin/billing` |
| GET | `/api/admin/billing/tariffs` | — | `routes/admin/billing` |
| GET | `/api/admin/contracts` | — | `routes/admin/contracts` |
| DELETE | `/api/admin/contracts/:id` | — | `routes/admin/contracts` |
| GET | `/api/admin/contracts/:id` | — | `routes/admin/contracts` |
| PATCH | `/api/admin/contracts/:id` | — | `routes/admin/contracts` |
| GET | `/api/admin/contracts/:id/tariffs` | — | `routes/admin/contracts` |
| POST | `/api/driver/access-requests` | — | `routes/public/driver` |
| GET | `/api/driver/chargers` | mobile | `routes/public/driver` |
| GET | `/api/driver/chargers/:id/pricing` | — | `routes/public/driver` |
| GET | `/api/driver/chargers/:serial/ble-pin` | mobile | `routes/public/driver-charger-pin` |
| POST | `/api/driver/claim-invite` | — | `routes/public/driver` |
| GET | `/api/driver/health` | — | `routes/public/driver` |
| GET | `/api/driver/installations` | — | `routes/public/driver` |
| GET | `/api/driver/invoices` | — | `routes/public/driver` |
| POST | `/api/driver/login` | mobile | `routes/public/driver` |
| GET | `/api/driver/me` | mobile | `routes/public/driver` |
| PATCH | `/api/driver/me` | mobile | `routes/public/driver` |
| POST | `/api/driver/redeem-invite` | — | `routes/public/driver` |
| GET | `/api/driver/sessions/:id` | mobile | `routes/public/driver` |
| GET | `/api/driver/sessions/current` | mobile | `routes/public/driver` |
| GET | `/api/driver/sessions/history` | — | `routes/public/driver` |
| POST | `/api/driver/start-session` | mobile | `routes/public/driver` |
| POST | `/api/driver/stop-session` | mobile | `routes/public/driver` |

## vendor — 22 endpoints, 20 with no in-repo caller

| Method | Path | Called by | Source |
|---|---|---|---|
| GET | `/api/admin/orgs/:orgId/vendor-credentials` | — | `routes/admin/vendor-credentials` |
| POST | `/api/admin/orgs/:orgId/vendor-credentials` | — | `routes/admin/vendor-credentials` |
| GET | `/api/admin/vendor-credentials` | — | `routes/admin/vendor-credentials` |
| DELETE | `/api/admin/vendor-credentials/:id` | — | `routes/admin/vendor-credentials` |
| GET | `/api/admin/vendor-credentials/:id` | — | `routes/admin/vendor-credentials` |
| PATCH | `/api/admin/vendor-credentials/:id` | — | `routes/admin/vendor-credentials` |
| POST | `/api/admin/vendor-credentials/:id/apply` | — | `routes/admin/vendor-credentials` |
| GET | `/api/admin/vendor-credentials/:id/manage-tree` | — | `routes/admin/vendor-credentials` |
| POST | `/api/admin/vendor-credentials/:id/move` | — | `routes/admin/vendor-credentials` |
| POST | `/api/admin/vendor-credentials/:id/probe` | — | `routes/admin/vendor-credentials` |
| GET | `/api/admin/vendor-credentials/:id/probe-sessions` | — | `routes/admin/vendor-credentials` |
| POST | `/api/admin/vendor-credentials/:id/sync-sessions` | — | `routes/admin/vendor-credentials` |
| POST | `/api/admin/zaptec/bulk-auth` | — | `routes/admin/zaptec` |
| POST | `/api/admin/zaptec/discover` | — | `routes/admin/zaptec` |
| POST | `/api/admin/zaptec/import` | — | `routes/admin/zaptec` |
| POST | `/api/admin/zaptec/inspect` | — | `routes/admin/zaptec` |
| POST | `/api/admin/zaptec/probe-users` | — | `routes/admin/zaptec` |
| POST | `/api/internal/zaptec-state-event` | zaptec-consumer | `routes/internal/zaptec-state-event` |
| POST | `/api/internal/zaptec-trigger-sync` | zaptec-consumer | `routes/internal/zaptec-trigger-sync` |
| POST | `/api/webhooks/zaptec/auth` | — | `routes/webhooks/zaptec` |
| POST | `/api/webhooks/zaptec/session-end` | — | `routes/webhooks/zaptec` |
| POST | `/api/webhooks/zaptec/session-start` | — | `routes/webhooks/zaptec` |

