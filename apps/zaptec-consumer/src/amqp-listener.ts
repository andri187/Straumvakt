// Per-installation Service Bus subscriber. Holds one persistent AMQP
// connection per installation; reconnects on transient errors with
// exponential backoff; refreshes the SAS token by re-fetching
// messagingConnectionDetails when the existing token expires.
//
// Phase 2 (claim-check pattern): every received message is logged
// for observability AND triggers a sync against /api/internal/zaptec-trigger-sync.
// We don't trust AMQP message bodies to carry full session data;
// AMQP is just the "go look now" signal. The API Worker fetches the
// authoritative payload via /api/chargehistory + DetailLevel=1
// and runs the existing writeback. Per-charger debounce in
// trigger.ts coalesces bursts of messages.

import {
  ServiceBusClient,
  ServiceBusReceiver,
  ServiceBusReceivedMessage,
  ProcessErrorArgs,
} from "@azure/service-bus";
import {
  getAccessToken,
  getMessagingConnectionDetails,
  invalidateToken,
} from "./zaptec-auth.js";
import { log } from "./logger.js";
import { triggerSync, type TriggerSyncOptions } from "./trigger.js";

export interface ListenerConfig {
  installationId: string;
  installationName: string | undefined;
  username: string;
  password: string;
  /** Phase 2 — when set, every AMQP message triggers a sync POST
   *  to the API Worker. When undefined, observe-only mode (Phase 1
   *  during development / before STRAUMVAKT_API_BASE_URL is set). */
  trigger?: TriggerSyncOptions;
}

export interface ListenerStats {
  installationId: string;
  installationName: string | undefined;
  messagesReceived: number;
  errorsSeen: number;
  lastMessageAt: Date | null;
  connectedAt: Date | null;
  state: "connecting" | "connected" | "reconnecting" | "stopped";
  subjectCounts: Record<string, number>;
}

const MAX_RECONNECT_BACKOFF_MS = 5 * 60 * 1000;
const INITIAL_RECONNECT_BACKOFF_MS = 5 * 1000;

/**
 * Per-installation subscriber. Returns a stats object that gets
 * mutated as messages arrive — so the /health endpoint can read it
 * without going through any IPC.
 */
export function startListener(config: ListenerConfig): {
  stats: ListenerStats;
  stop: () => Promise<void>;
} {
  const stats: ListenerStats = {
    installationId: config.installationId,
    installationName: config.installationName,
    messagesReceived: 0,
    errorsSeen: 0,
    lastMessageAt: null,
    connectedAt: null,
    state: "connecting",
    subjectCounts: {},
  };

  let stopped = false;
  let currentClient: ServiceBusClient | null = null;
  let currentReceiver: ServiceBusReceiver | null = null;
  let backoffMs = INITIAL_RECONNECT_BACKOFF_MS;

  const onMessage = async (msg: ServiceBusReceivedMessage): Promise<void> => {
    stats.messagesReceived++;
    stats.lastMessageAt = new Date();
    const subject = msg.subject ?? "(no-subject)";
    stats.subjectCounts[subject] = (stats.subjectCounts[subject] ?? 0) + 1;

    // Log the full message — observability layer. Body +
    // applicationProperties carry whatever Zaptec is signalling.
    // SAS tokens never appear in message bodies, so this is safe.
    log.info("zaptec_amqp_message", {
      installationId: config.installationId,
      messageId: msg.messageId,
      subject: msg.subject,
      contentType: msg.contentType,
      enqueuedAt: msg.enqueuedTimeUtc?.toISOString(),
      applicationProperties: msg.applicationProperties,
      body: msg.body,
    });

    // Phase 2 — claim-check trigger. Pull a charger id out of the
    // message and tell the API Worker to refetch its sessions.
    // Per-charger debounce in trigger.ts handles bursts; runs in
    // background so we don't slow down message acknowledgement.
    if (config.trigger) {
      const chargerId = extractChargerId(msg);
      if (chargerId) {
        void triggerSync(chargerId, config.trigger);
      }
    }

    // Auto-complete is on (receiveAndDelete mode); nothing to ack.
  };

  const onError = async (args: ProcessErrorArgs): Promise<void> => {
    stats.errorsSeen++;
    log.warn("zaptec_amqp_error", {
      installationId: config.installationId,
      source: args.errorSource,
      error: args.error.message,
    });
  };

  const connectLoop = async (): Promise<void> => {
    while (!stopped) {
      try {
        stats.state = stats.connectedAt ? "reconnecting" : "connecting";
        log.info("zaptec_amqp_connecting", {
          installationId: config.installationId,
          installationName: config.installationName,
        });

        const token = await getAccessToken(config.username, config.password);
        const mcd = await getMessagingConnectionDetails(
          token,
          config.installationId,
        );

        const connectionString = `Endpoint=sb://${mcd.Host}/;SharedAccessSignature=${mcd.Password}`;
        currentClient = new ServiceBusClient(connectionString);
        currentReceiver = currentClient.createReceiver(
          mcd.Topic,
          mcd.Subscription,
          { receiveMode: "receiveAndDelete" },
        );

        stats.state = "connected";
        stats.connectedAt = new Date();
        backoffMs = INITIAL_RECONNECT_BACKOFF_MS; // reset on successful connect
        log.info("zaptec_amqp_connected", {
          installationId: config.installationId,
          topic: mcd.Topic,
          subscription: mcd.Subscription,
        });

        const subscription = currentReceiver.subscribe(
          {
            processMessage: onMessage,
            processError: onError,
          },
          { autoCompleteMessages: false },
        );

        // Wait until either stopped or the subscription closes (which
        // happens on transient errors despite the SDK's reconnect
        // logic — re-creating the receiver is cleaner than relying
        // on its internals).
        await new Promise<void>((resolve) => {
          const interval = setInterval(() => {
            if (stopped) {
              clearInterval(interval);
              resolve();
            }
          }, 1000);
        });

        await subscription.close().catch(() => undefined);
      } catch (err) {
        stats.errorsSeen++;
        const msg = err instanceof Error ? err.message : String(err);
        log.error("zaptec_amqp_connect_failed", {
          installationId: config.installationId,
          error: msg,
          willRetryInMs: backoffMs,
        });
        // 401 likely means token expired even though our cache says
        // it shouldn't have — invalidate so next iteration re-grants.
        if (msg.includes("401") || msg.includes("oauth")) {
          invalidateToken();
        }
      } finally {
        await currentReceiver?.close().catch(() => undefined);
        await currentClient?.close().catch(() => undefined);
        currentReceiver = null;
        currentClient = null;
      }

      if (stopped) break;
      await sleep(backoffMs);
      backoffMs = Math.min(MAX_RECONNECT_BACKOFF_MS, backoffMs * 2);
    }

    stats.state = "stopped";
  };

  // Start the loop in the background; caller owns the lifetime via stop().
  void connectLoop();

  return {
    stats,
    stop: async () => {
      stopped = true;
      await currentReceiver?.close().catch(() => undefined);
      await currentClient?.close().catch(() => undefined);
    },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Extract a charger id (Zaptec internal UUID) from a Service Bus
 * message. Defensive across multiple shapes since we don't have a
 * stable schema yet:
 *   1. body.ChargerId / chargerId / DeviceId / deviceId
 *   2. applicationProperties.ChargerId / chargerId
 *   3. subject prefix (some Zaptec subjects look like "<uuid>/...")
 *
 * Returns null when none of the above yield a valid UUID.
 */
function extractChargerId(msg: ServiceBusReceivedMessage): string | null {
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const tryString = (v: unknown): string | null =>
    typeof v === "string" && uuidRe.test(v) ? v : null;

  const body = msg.body;
  if (body && typeof body === "object") {
    const obj = body as Record<string, unknown>;
    for (const k of ["ChargerId", "chargerId", "DeviceId", "deviceId"]) {
      const candidate = tryString(obj[k]);
      if (candidate) return candidate;
    }
  }
  if (msg.applicationProperties) {
    for (const k of ["ChargerId", "chargerId"]) {
      const candidate = tryString(msg.applicationProperties[k]);
      if (candidate) return candidate;
    }
  }
  if (typeof msg.subject === "string") {
    const m = msg.subject.match(uuidRe);
    if (m) return m[0];
  }
  return null;
}
