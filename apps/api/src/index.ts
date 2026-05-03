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
import { internalOcppAuth } from "./routes/internal/ocpp-auth";
import { internalOcppAuthorize } from "./routes/internal/ocpp-authorize";
import { internalOcppEvents } from "./routes/internal/ocpp-events";
import { internalPendingDiscovery } from "./routes/internal/pending-discovery";
import { makePrisma } from "./lib/prisma";
import { buildRegistry } from "./lib/dispatch-targets";
import { processCommand, sweepStuckPending } from "./lib/dispatcher";
import { handleOcppEventsBatch } from "./queues/ocpp-events";
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
];

app.use(
  "/api/*",
  cors({
    origin: (origin) => (ALLOWED_ORIGINS.includes(origin) ? origin : null),
    credentials: true,
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type"],
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
app.route("/api/admin/onboarding", adminOnboarding);
app.route("/api/admin/me", adminMe);
app.route("/api/admin/zaptec", adminZaptec);
app.route("/api/admin/pending-discoveries", adminPendingDiscoveries);
app.route("/api/admin/vendor-credentials", adminVendorCredentialsAll);
app.route("/api/admin/orgs/:orgId/vendor-credentials", adminVendorCredentialsByOrg);
app.route("/api/admin/groups", adminGroups);
app.route("/api/admin/tokens", adminIdTokens);

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
  },
};

export default handler;
