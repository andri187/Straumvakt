// Zaptec consumer — Phase 1 (observability) + Phase 2 (claim-check trigger).
//
// Boots, lists every installation visible to the credential, opens
// one AMQP subscription per installation, logs every message to
// stdout. Fly captures stdout into its log drain; operator inspects
// via `fly logs` and the dashboard.
//
// Phase 2 (claim-check): if STRAUMVAKT_API_BASE_URL + OCPP_INGEST_SECRET
// are both set, every received AMQP message also fires an HTTP POST
// to /api/internal/zaptec-trigger-sync (per-charger debounce 30s).
// The API Worker fetches the authoritative session payload via
// /api/chargehistory + DetailLevel=1 and runs the existing writeback.
// AMQP becomes the "go look now" signal — we don't translate its
// body to our event shape.
//
// Env:
//   ZAPTEC_USERNAME         (required)
//   ZAPTEC_PASSWORD         (required)
//   PORT                    (Fly sets this; default 8080)
//   INSTALLATION_IDS        (optional; comma-separated. If unset,
//                           subscribes to every installation the
//                           credential can see with MessagingEnabled
//                           !== false.)
//   MAX_INSTALLATIONS       (optional; default 20 — cap to avoid
//                           accidentally opening hundreds of
//                           subscriptions on a misconfigured account.)
//   STRAUMVAKT_API_BASE_URL (optional; e.g.
//                           "https://hlada-api-staging.straumvakt.workers.dev").
//                           When set together with OCPP_INGEST_SECRET,
//                           Phase 2 trigger fires on every AMQP message.
//                           Unset = observe-only (Phase 1 mode).
//   OCPP_INGEST_SECRET      (required when STRAUMVAKT_API_BASE_URL set;
//                           same secret the OCPP gateway uses).

import {
  getAccessToken,
  listInstallations,
  type InstallationLite,
} from "./zaptec-auth.js";
import { startListener, type ListenerStats } from "./amqp-listener.js";
import { startHealthServer } from "./health.js";
import { log } from "./logger.js";
import type { TriggerSyncOptions } from "./trigger.js";

const ZAPTEC_USERNAME = requireEnv("ZAPTEC_USERNAME");
const ZAPTEC_PASSWORD = requireEnv("ZAPTEC_PASSWORD");
const PORT = parseInt(process.env.PORT ?? "8080", 10);
const INSTALLATION_IDS_FILTER = (process.env.INSTALLATION_IDS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const MAX_INSTALLATIONS = parseInt(process.env.MAX_INSTALLATIONS ?? "20", 10);

// Phase 2 — claim-check trigger. Only enabled when BOTH env vars are
// set; halfway state would silently drop triggers.
const STRAUMVAKT_API_BASE_URL = process.env.STRAUMVAKT_API_BASE_URL;
const OCPP_INGEST_SECRET = process.env.OCPP_INGEST_SECRET;
const TRIGGER_OPTIONS: TriggerSyncOptions | undefined =
  STRAUMVAKT_API_BASE_URL && OCPP_INGEST_SECRET
    ? {
        apiBaseUrl: STRAUMVAKT_API_BASE_URL,
        ingestSecret: OCPP_INGEST_SECRET,
      }
    : undefined;

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    log.error("missing_env_var", { name });
    process.exit(1);
  }
  return v;
}

async function main(): Promise<void> {
  log.info("zaptec_consumer_starting", {
    pid: process.pid,
    port: PORT,
    filterCount: INSTALLATION_IDS_FILTER.length,
    maxInstallations: MAX_INSTALLATIONS,
    triggerEnabled: TRIGGER_OPTIONS !== undefined,
    apiBaseUrl: STRAUMVAKT_API_BASE_URL ?? "(observe-only)",
  });

  const token = await getAccessToken(ZAPTEC_USERNAME, ZAPTEC_PASSWORD);
  const all = await listInstallations(token);
  log.info("installations_visible", {
    count: all.length,
    samples: all.slice(0, 5).map((i) => ({
      id: i.Id,
      name: i.Name,
      messagingEnabled: i.MessagingEnabled,
    })),
  });

  const targets = pickTargets(all);
  if (targets.length === 0) {
    log.error("no_target_installations", {
      reason: INSTALLATION_IDS_FILTER.length
        ? "filter matched zero installations"
        : "no MessagingEnabled installations visible",
    });
    process.exit(1);
  }
  log.info("target_installations", {
    count: targets.length,
    ids: targets.map((t) => t.Id),
  });

  const listeners = targets.map((inst) =>
    startListener({
      installationId: inst.Id,
      installationName: inst.Name,
      username: ZAPTEC_USERNAME,
      password: ZAPTEC_PASSWORD,
      trigger: TRIGGER_OPTIONS,
    }),
  );

  const getStats = (): ListenerStats[] => listeners.map((l) => l.stats);
  const health = startHealthServer(PORT, getStats);

  const shutdown = async (signal: string): Promise<void> => {
    log.info("shutting_down", { signal });
    await Promise.all(listeners.map((l) => l.stop()));
    await health.stop();
    log.info("shutdown_complete");
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  // Periodic stats summary so the Fly logs show consumer health
  // without curling /health.
  setInterval(() => {
    const stats = getStats();
    log.info("stats_heartbeat", {
      installations: stats.length,
      connected: stats.filter((s) => s.state === "connected").length,
      totalMessages: stats.reduce((n, s) => n + s.messagesReceived, 0),
      totalErrors: stats.reduce((n, s) => n + s.errorsSeen, 0),
    });
  }, 60_000);
}

function pickTargets(all: InstallationLite[]): InstallationLite[] {
  let filtered = all;
  if (INSTALLATION_IDS_FILTER.length > 0) {
    filtered = all.filter((i) => INSTALLATION_IDS_FILTER.includes(i.Id));
  } else {
    // Drop explicitly disabled. Keep undefined (Zaptec doesn't always
    // populate MessagingEnabled on the bulk list — definitive answer
    // comes from messagingConnectionDetails, which the listener will
    // try and fail gracefully if it's actually off.)
    filtered = all.filter((i) => i.MessagingEnabled !== false);
  }
  if (filtered.length > MAX_INSTALLATIONS) {
    log.warn("installations_truncated", {
      visible: filtered.length,
      max: MAX_INSTALLATIONS,
    });
    filtered = filtered.slice(0, MAX_INSTALLATIONS);
  }
  return filtered;
}

main().catch((err) => {
  log.error("fatal_startup_error", {
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  });
  process.exit(1);
});
