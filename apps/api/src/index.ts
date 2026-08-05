// Straumvakt API Worker — Phase 1 of ADR 0013.
//
// This is the API tier. It runs on Cloudflare Workers, talks to Neon via
// Hyperdrive + PrismaPg, and serves /api/* for the operator console (and
// eventually the driver app and the OCPI gateway). No UI rendering, no
// Next.js, no OpenNext — Wrangler+esbuild bundles this directly so the
// Prisma 7 prisma-client generator's `runtime: "cloudflare"` output works
// without any externalize gymnastics the monolith needed.

import { Hono } from "hono";
import { cors } from "hono/cors";
import { adminAuth } from "./routes/admin/auth";
import { adminOrgs } from "./routes/admin/orgs";
import { adminProperties } from "./routes/admin/properties";
import { adminSites } from "./routes/admin/sites";
import { adminInstallations } from "./routes/admin/installations";
import { adminCircuits } from "./routes/admin/circuits";
import { adminUsers } from "./routes/admin/users";
import { adminMemberships } from "./routes/admin/memberships";
import { adminChargers } from "./routes/admin/chargers";
import { adminVehicles } from "./routes/admin/vehicles";
import { adminActiveSessions } from "./routes/admin/active-sessions";
import { adminOnboarding } from "./routes/admin/onboarding";
import { adminMe } from "./routes/admin/me";
import { adminZaptec } from "./routes/admin/zaptec";
import { adminPendingDiscoveries } from "./routes/admin/pending-discoveries";
import {
  adminVendorCredentialsAll,
  adminVendorCredentialsByOrg,
} from "./routes/admin/vendor-credentials";
import { adminGroups } from "./routes/admin/groups";
import { adminIdTokens } from "./routes/admin/id-tokens";
import { adminOrgInvites } from "./routes/admin/org-invites";
import { adminBilling } from "./routes/admin/billing";
import { adminContracts } from "./routes/admin/contracts";
import { adminAgreementsDebug } from "./routes/admin/agreements-debug";
import { adminAgreementsResolve } from "./routes/admin/agreements-resolve";
import { adminDriverGroupMemberships } from "./routes/admin/driver-group-memberships";
import { adminAccessRequests } from "./routes/admin/access-requests";
import { adminHostApplications } from "./routes/admin/host-applications";
import { adminBillObjects } from "./routes/admin/bill-objects";
import { publicDriver } from "./routes/public/driver";
import { driverTapIntent } from "./routes/public/driver-tap-intent";
import { driverChargerPin } from "./routes/public/driver-charger-pin";
import { publicInvites } from "./routes/public/invites";
import { publicRegister } from "./routes/public/register";
import { publicEmailVerification } from "./routes/public/email-verification";
import { publicPasswordReset } from "./routes/public/password-reset";
import { publicHostApplications } from "./routes/public/host-applications";
import { internalOcppAuth } from "./routes/internal/ocpp-auth";
import { internalOcppAuthorize } from "./routes/internal/ocpp-authorize";
import { internalOcppEvents } from "./routes/internal/ocpp-events";
import { internalPendingDiscovery } from "./routes/internal/pending-discovery";
import { internalZaptecTriggerSync } from "./routes/internal/zaptec-trigger-sync";
import { internalZaptecStateEvent } from "./routes/internal/zaptec-state-event";
import { zaptecWebhooks } from "./routes/webhooks/zaptec";
import { makePrisma } from "./lib/prisma";
import { buildRegistry } from "./lib/dispatch-targets";
import { processCommand, sweepStuckPending } from "./lib/dispatcher";
import { handleOcppEventsBatch } from "./queues/ocpp-events";
import { handleArchiveEventsBatch } from "./queues/archive-events";
import {
  ensureForwardPartitions,
  dropExpiredPartitions,
  isPartitionDropEnabled,
} from "./lib/db/partition-cron";
import { makePool } from "./lib/db/raw";
import { runZaptecCronSync, runZaptecSessionsOnlyCron } from "./lib/zaptec-sync-cron";
import { runAgreementsBillingTick } from "./lib/agreement/billing-tick";
import { checkOcppSilence } from "./lib/ocpp-silence-watch";
import type {
  Env,
  OutboundCommandMessage,
  OcppEventMessage,
} from "./bindings";
import type {
  ExportedHandler,
  MessageBatch,
  ScheduledController,
  ExecutionContext,
} from "@cloudflare/workers-types";

// Discriminated union of every queue body this Worker may consume.
// The `queue()` handler dispatches by `batch.queue` (the queue name
// from wrangler.jsonc), so each branch can narrow its message type
// before calling the per-queue handler.
type AnyQueueMessage = OutboundCommandMessage | OcppEventMessage;

const app = new Hono<{ Bindings: Env }>();

// CORS — the API Worker is reachable from the UI's origin
// (localhost:3000 in dev, hlada-staging.straumvakt.workers.dev in
// staging, the future Pages domain in prod). credentials: include
// is required so the admin session cookie is sent on cross-origin
// fetches; that mandates Access-Control-Allow-Origin to echo the
// request origin (not "*"). The list below is the operator's known
// surfaces; new origins land here.
const ALLOWED_ORIGINS = [
  "http://localhost:3000",
  "https://hlada-staging.straumvakt.workers.dev",
  "https://hlada.straumvakt.workers.dev",
  // Brand domain (Option B) — the UI runs on straumvakt.org and calls the
  // API at api.straumvakt.org (same-site, credentialed).
  "https://straumvakt.org",
  "https://www.straumvakt.org",
];

app.use(
  "/api/*",
  cors({
    origin: (origin) => (ALLOWED_ORIGINS.includes(origin) ? origin : null),
    credentials: true,
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    // Authorization is required for the driver web portal's bearer-token calls
    // (/api/driver/*). This global /api/* CORS handles their preflight first,
    // so it must allow it — otherwise the browser blocks every driver request.
    allowHeaders: ["Content-Type", "Authorization"],
  }),
);

app.get("/health", (c) => c.json({ ok: true, service: "hlada-api" }));

// Auth — login mints the admin HMAC cookie, logout clears it. Required
// by every other admin route via the requireAdmin middleware.
app.route("/api/admin", adminAuth);

// Admin entity routes — all gated by requireAdmin inside their files.
app.route("/api/admin/orgs", adminOrgs);
app.route("/api/admin/properties", adminProperties);
app.route("/api/admin/sites", adminSites);
app.route("/api/admin/installations", adminInstallations);
app.route("/api/admin/circuits", adminCircuits);
app.route("/api/admin/users", adminUsers);
app.route("/api/admin/memberships", adminMemberships);
app.route("/api/admin/chargers", adminChargers);
app.route("/api/admin/vehicles", adminVehicles);
app.route("/api/admin/active-sessions", adminActiveSessions);
app.route("/api/admin/onboarding", adminOnboarding);
app.route("/api/admin/me", adminMe);
app.route("/api/admin/zaptec", adminZaptec);
app.route("/api/admin/pending-discoveries", adminPendingDiscoveries);
app.route("/api/admin/vendor-credentials", adminVendorCredentialsAll);
app.route("/api/admin/orgs/:orgId/vendor-credentials", adminVendorCredentialsByOrg);
app.route("/api/admin/groups", adminGroups);
app.route("/api/admin/tokens", adminIdTokens);
// Sprint 5.7 — agent invite flow (admin side). Mounts under
// /api/admin/orgs/:orgId/invites — see org-invites.ts.
app.route("/api/admin/orgs", adminOrgInvites);

// Sprint 9 / ADR 0022 (ENROLL-4) — DriverGroupMembership create endpoint.
//   POST /api/admin/orgs/:orgId/driver-group-memberships
//   GET  /api/admin/orgs/:orgId/driver-group-memberships?driverGroupId=<uuid>
// Creates an access grant. Idempotent on (driverGroupId, userId).
// Cross-tenant guard: DriverGroup.ownerOrgId must equal URL :orgId.
app.route("/api/admin/orgs", adminDriverGroupMemberships);

// ADR 0029 — billing-home (BillObject) management.
//   POST/GET /api/admin/orgs/:orgId/bill-objects[/:id][/members]
// Org-scoped; billing.read / billing.write on :orgId. The attribution
// spine (who pays), orthogonal to DriverGroup access.
app.route("/api/admin/orgs", adminBillObjects);

// Sprint 8.4 — billing dashboard read surface.
//   GET /api/admin/billing/sessions[?orgId|siteId|chargingStationId|driverUserId][&startedAfter&startedBefore&limit&offset]
// Scope-tagged read with totals tile + paginated session list.
// Operator console reads from here; per-entity tabs (org / site /
// charger / driver detail pages) pass the right query param.
app.route("/api/admin/billing", adminBilling);

// Sprint 8.13 — per-contract management (read/update/delete).
// Org-scoped list is at /api/admin/orgs/:id/contracts; this is the
// platform-wide view + individual mutations.
app.route("/api/admin/contracts", adminContracts);

// Sprint 9 / ADR 0019 milestone A.6 — read-only debug endpoint for the
// agreement resolver. Operator picks (driver, charger, time) and sees
// what the resolver would emit at session-stop. Never writes.
app.route("/api/admin/agreements", adminAgreementsDebug);

// Sprint 9 / ADR 0019 (2026-05-08) — manual session-resolution trigger.
// POST /api/admin/agreements/sessions/:sessionId/resolve runs the
// resolver against a real ChargeSession and writes agreements.billing_lines.
// Idempotent — second call returns alreadyExisted=true.
app.route("/api/admin/agreements/sessions", adminAgreementsResolve);

// Sprint 9 / ADR 0022 (ENROLL-2, 2026-05-31 addendum) — driver
// self-onboarding operator inbox.
//   GET   /api/admin/access-requests?orgId=&status=
//   PATCH /api/admin/access-requests/:id   { action, denialReason? }
// Approve writes a DriverGroupMembership row + emails the driver;
// deny records the reason + emails the driver. member.write on the
// installation's parent org required.
app.route("/api/admin/access-requests", adminAccessRequests);

// ADR 0026 §6/§7 — going-public host-application (RFQ) operator inbox.
//   GET   /api/admin/host-applications?status=
//   GET   /api/admin/host-applications/:id
//   PATCH /api/admin/host-applications/:id   { status }
// Global (pre-tenant) surface; gated by platform.tenant.read/write.
app.route("/api/admin/host-applications", adminHostApplications);

// Sprint 5.8 — agent invite flow (recipient side). Public routes
// gated by the token itself, NOT by the admin session cookie.
//   GET  /api/public/invites/peek?token=<plaintext>
//   POST /api/public/invites/consume
app.route("/api/public/invites", publicInvites);

// ADR 0026 §6 — going-public public /apply intake. No auth (allow-listed
// in middleware.ts isPublicApplyPath). POST /api/public/host-applications.
app.route("/api/public/host-applications", publicHostApplications);

// Sprint 9 / ENROLL-1 / ADR 0022 (2026-05-31 addendum) — driver
// self-onboarding public endpoints. No auth gate; rate-limited via the
// shared ADMIN_LOGIN_RATE_LIMITER binding.
//   POST /api/public/register                          — create driver + send verify email
//   GET  /api/public/verify-email/:token               — confirm + maybe auto-join
//   POST /api/public/verify-email/:token               — same handler, POST alias
//   POST /api/public/password-reset                    — anti-enumeration initiate
//   POST /api/public/password-reset/confirm/:token     — set new password
app.route("/api/public/register", publicRegister);
app.route("/api/public/verify-email", publicEmailVerification);
app.route("/api/public/password-reset", publicPasswordReset);

// Sprint 9 / 2026-05-10 — Driver-app public API (Flutter mobile).
// Implements the driver-app-api OpenAPI contract natively in
// Straumvakt; bearer-token auth, no cookies, CORS allowlist on the
// route group.
//   POST /api/driver/login
//   GET  /api/driver/me
//   GET  /api/driver/chargers
//   GET  /api/driver/health
// Tap & Auth tap-intent (ADR 0024 addendum 2). MUST be mounted before the
// catch-all /api/driver mount below — Hono matches by prefix, so
// publicDriver would otherwise swallow /api/driver/tap-intent and 404.
app.route("/api/driver/tap-intent", driverTapIntent);
// ADR 0046 (renumbered from 0044, 2026-08-04) — local BLE PIN release.
// Mounted before the catch-all for the same prefix-matching reason as
// tap-intent above.
app.route("/api/driver/chargers", driverChargerPin);
app.route("/api/driver", publicDriver);

// Internal — gateway → API auth lookup. Gated by OCPP_INGEST_SECRET
// header (ADR 0004), not the admin session middleware.
app.route("/api/internal/ocpp-auth", internalOcppAuth);
app.route("/api/internal/ocpp-authorize", internalOcppAuthorize);
// Sprint 4.5 production cutover — dual-mount during transition.
// /api/ocpp/events: legacy URL that today's gateway still posts to.
// /api/internal/ocpp-events: new URL the post-cutover gateway uses.
// Both routes share the same handler. The legacy URL stays mounted
// until the gateway has been redeployed everywhere with the new URL,
// then a follow-up commit drops it (along with the UI-Worker-side
// dead code in src/lib/ocpp/* and src/app/api/ocpp/events/).
app.route("/api/ocpp/events", internalOcppEvents);
app.route("/api/internal/ocpp-events", internalOcppEvents);
app.route("/api/internal/pending-discovery", internalPendingDiscovery);

// Sprint 9 — claim-check trigger from Zaptec consumer (Fly).
// AMQP arrives → consumer POSTs here → we fetch the authoritative
// session payload via REST + DetailLevel=1 + write through.
app.route("/api/internal/zaptec-trigger-sync", internalZaptecTriggerSync);
app.route("/api/internal/zaptec-state-event", internalZaptecStateEvent);

// Sprint 8.9 — Zaptec webhook receivers for AuthenticationType=1
// (Webhooks). Operator pastes these URLs into the Zaptec portal:
//   POST /api/webhooks/zaptec/auth          per-RFID Accept/Reject
//   POST /api/webhooks/zaptec/session-start charge session begins
//   POST /api/webhooks/zaptec/session-end   charge session ends + cost
// Bearer secret in Authorization header, value matches
// env.ZAPTEC_WEBHOOK_SECRET — middleware enforces.
app.route("/api/webhooks/zaptec", zaptecWebhooks);

app.notFound((c) => c.json({ error: "not_found", path: c.req.path }, 404));

app.onError((err, c) => {
  console.error(err);
  return c.json(
    { error: "internal", message: err instanceof Error ? err.message : String(err) },
    500,
  );
});

// ── ExportedHandler — fetch + queue + scheduled ──────────────────────────
//
// fetch:     Hono router (admin HTTP surface, plus /health).
// queue:     consumer side of every queue this Worker is subscribed to
//            in wrangler.jsonc. Dispatches by `batch.queue` (queue
//            name) — see Sprint 5 / ADR 0017 for the inbound OCPP
//            events queue addition.
// scheduled: cron sweeper. Re-publishes any stuck pending row whose
//            not_before is older than the staleness threshold — covers
//            the "row written but queue.send failed" race and any rows
//            that landed in the DLQ.

async function handleOutboundCommandBatch(
  batch: MessageBatch<OutboundCommandMessage>,
  env: Env,
): Promise<void> {
  const db = makePrisma(env);
  const registry = buildRegistry(env);
  for (const message of batch.messages) {
    try {
      const outcome = await processCommand(db, registry, message.body.commandId);
      if (outcome.kind === "retry") {
        // Throw so CF Queue redelivers per max_retries / retry_delay.
        // The row stays 'pending' and the result column doesn't get
        // overwritten — observability via the row's last_attempt_at +
        // attempts counter, and via the message-retry log.
        throw new Error(`retriable: ${outcome.error}`);
      }
      message.ack();
    } catch (err) {
      console.error("queue handler error", {
        commandId: message.body.commandId,
        error: err instanceof Error ? err.message : String(err),
      });
      message.retry();
    }
  }
}

const handler: ExportedHandler<Env, AnyQueueMessage> = {
  fetch: app.fetch as ExportedHandler<Env>["fetch"],

  async queue(batch: MessageBatch<AnyQueueMessage>, env: Env) {
    // Dispatch by queue name. New queues land here.
    if (batch.queue === "straumvakt-outbound-staging") {
      await handleOutboundCommandBatch(
        batch as MessageBatch<OutboundCommandMessage>,
        env,
      );
      return;
    }
    if (batch.queue === "straumvakt-ocpp-events-staging") {
      await handleOcppEventsBatch(
        batch as MessageBatch<OcppEventMessage>,
        env,
      );
      return;
    }
    if (batch.queue === "straumvakt-archive-events-staging") {
      await handleArchiveEventsBatch(
        batch as MessageBatch<OcppEventMessage>,
        env,
      );
      return;
    }
    // Unknown queue — log + ack so the message doesn't loop. In
    // practice this means a wrangler.jsonc consumer was added without
    // a code branch.
    console.error("queue handler: unknown queue", { queue: batch.queue });
    for (const message of batch.messages) message.ack();
  },

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    const db = makePrisma(env);
    const queue = env.OUTBOUND_QUEUE;
    ctx.waitUntil(
      sweepStuckPending(db, async (commandId) => {
        await queue.send({ commandId });
      }),
    );

    // Sprint 7.2 — keep next 7 days of event_log + meter_values
    // partitions populated. Idempotent CREATE TABLE IF NOT EXISTS;
    // cheap when we're already covered. Uses a fresh pg pool (not
    // Prisma) because partition DDL isn't a Prisma migration —
    // they're routine maintenance the cron owns. Logs once per
    // run so the operator can grep tail for cadence + counts.
    ctx.waitUntil(
      (async () => {
        const pool = makePool(env);
        try {
          const client = await pool.connect();
          try {
            const result = await ensureForwardPartitions(client);
            if (result.failed.length > 0 || result.succeeded > 0) {
              console.log("[partition-cron]", {
                attempted: result.attempted,
                succeeded: result.succeeded,
                failed: result.failed.length,
                failures: result.failed.slice(0, 5),
              });
            }

            // P4.15 / ADR 0037 D5 — retention side of the same cron.
            // Dry run unless PARTITION_DROP_ENABLED is explicitly set;
            // every decision is gated on the archive watermark and
            // fails closed. Logs only when it looked at something.
            const drops = await dropExpiredPartitions(client, {
              enabled: isPartitionDropEnabled(env),
            });
            if (drops.considered > 0 || drops.failed.length > 0) {
              console.log("[partition-drop]", {
                dryRun: drops.dryRun,
                considered: drops.considered,
                dropped: drops.dropped.length,
                wouldDrop: drops.wouldDrop.length,
                blocked: drops.blocked.length,
                failed: drops.failed.length,
                failures: drops.failed.slice(0, 5),
              });
            }
          } finally {
            client.release();
          }
        } catch (err) {
          console.error("[partition-cron] failed", {
            error: err instanceof Error ? err.message : String(err),
          });
        } finally {
          await pool.end().catch(() => undefined);
        }
      })(),
    );

    // Sprint 8.7/8.8 — combined Zaptec sync (8.14.1). Single OAuth
    // grant per credential per tick: sessions writeback + status
    // sync share the access token to avoid Zaptec's back-to-back
    // /oauth/token rate limiter, which used to cause alternating
    // tick failures. Sessions writeback fans out per installation
    // since /api/chargehistory returns nothing without InstallationId.
    //
    // Sprint 9.1 — cron now fires every minute. On minutes 0,5,10,...
    // we run the full sync (sessions + status + cache writes); on the
    // other 4 minutes per cycle we run sessions-only so /charge-log
    // and the technical-read history block reflect in-progress sessions
    // within ~1 minute even for chargers AMQP can't reach. Net API
    // budget ~+20% over the previous */5 cadence.
    // Sprint 9 / ADR 0019 (2026-05-08) — agreements billing tick.
    // Picks up finalized + user-enriched ChargeSession rows that don't
    // yet have agreements.billing_lines and runs the resolver. Gated
    // off the same cadence as the other crons. Logs only when
    // something actually happened so operator log noise stays low.
    // OCPP silence watch. Reads only the protocol tables — never
    // lastSeenAt or vendor status, which stayed green throughout the
    // three-month outage this exists to catch. Logs nothing while the
    // fleet is healthy, so a line here always means something.
    ctx.waitUntil(
      (async () => {
        try {
          const report = await checkOcppSilence(db);
          if (report.fleetWide) {
            console.error("[ocpp-silence] FLEET-WIDE — no charger is speaking OCPP", {
              watched: report.watched,
              lastFrames: report.silent
                .slice(0, 5)
                .map((s) => `${s.identityString}@${s.lastFrameAt ?? "never"}`),
            });
          } else if (report.silent.length > 0) {
            console.warn("[ocpp-silence]", {
              watched: report.watched,
              speaking: report.speaking,
              silent: report.silent.length,
              chargers: report.silent
                .slice(0, 10)
                .map((s) => `${s.identityString}:${s.silentForMinutes ?? "never"}m`),
            });
          }
        } catch (err) {
          console.error("[ocpp-silence] failed", {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      })(),
    );

    ctx.waitUntil(
      (async () => {
        try {
          const result = await runAgreementsBillingTick(db);
          if (result.scanned > 0) {
            console.log("[agreements-billing-tick]", {
              scanned: result.scanned,
              emitted: result.emitted,
              alreadyExisted: result.alreadyExisted,
              denied: result.denied,
              errorCount: result.errors.length,
              firstErrors: result.errors.slice(0, 3),
            });
          }
        } catch (err) {
          console.error("[agreements-billing-tick] failed", {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      })(),
    );

    if (env.OCPP_CRED_KEK) {
      const kek = env.OCPP_CRED_KEK;
      const isFullTick = new Date().getUTCMinutes() % 5 === 0;
      ctx.waitUntil(
        (async () => {
          try {
            const result = isFullTick
              ? await runZaptecCronSync(db, kek)
              : await runZaptecSessionsOnlyCron(db, kek);
            if (
              result.outcomes.length > 0 ||
              result.failures.length > 0
            ) {
              console.log("[zaptec-sync-cron]", {
                credentials: result.credentials,
                installationsScanned: result.outcomes.reduce(
                  (n, o) => n + o.installationsScanned,
                  0,
                ),
                zaptecCount: result.outcomes.reduce(
                  (n, o) => n + o.zaptecCount,
                  0,
                ),
                imported: result.outcomes.reduce(
                  (n, o) => n + o.importedCount,
                  0,
                ),
                skipped: result.outcomes.reduce(
                  (n, o) => n + o.skippedCount,
                  0,
                ),
                errors: result.outcomes.reduce(
                  (n, o) => n + o.errorCount,
                  0,
                ),
                failedCredentials: result.failures.length,
              });
            }
            if (
              result.status.outcomes.length > 0 ||
              result.status.failures.length > 0
            ) {
              console.log("[zaptec-status-cron]", {
                credentials: result.credentials,
                updated: result.status.outcomes.reduce(
                  (n, o) => n + o.updatedCount,
                  0,
                ),
                skipped: result.status.outcomes.reduce(
                  (n, o) => n + o.skippedCount,
                  0,
                ),
                failedCredentials: result.status.failures.length,
              });
            }
          } catch (err) {
            console.error("[zaptec-sync-cron] failed", {
              error: err instanceof Error ? err.message : String(err),
            });
          }
        })(),
      );
    }
  },
};

export default handler;
