// Zaptec consumer — Phase 1.
//
// Boots, lists every installation visible to the credential, opens
// one AMQP subscription per installation, logs every message to
// stdout. Fly captures stdout into its log drain; operator inspects
// via `fly logs` and the dashboard.
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
//
// Phase 2 will add an HTTP postback to /api/internal/ocpp-events;
// for now this is observe-only.

import {
  getAccessToken,
  listInstallations,
  type InstallationLite,
} from "./zaptec-auth.js";
import { startListener, type ListenerStats } from "./amqp-listener.js";
import { startHealthServer } from "./health.js";
import { log } from "./logger.js";

const ZAPTEC_USERNAME = requireEnv("ZAPTEC_USERNAME");
const ZAPTEC_PASSWORD = requireEnv("ZAPTEC_PASSWORD");
const PORT = parseInt(process.env.PORT ?? "8080", 10);
const INSTALLATION_IDS_FILTER = (process.env.INSTALLATION_IDS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const MAX_INSTALLATIONS = parseInt(process.env.MAX_INSTALLATIONS ?? "20", 10);

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
