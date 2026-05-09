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
import { triggerSync, postStateEvent, type TriggerSyncOptions } from "./trigger.js";

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

// Sprint 9 Phase 3 hardening — silent-connection watchdog.
//
// Failure mode: the Service Bus SDK can stay in "connected" state but
// stop delivering messages (silent token expiry, stale TCP, server-side
// subscription glitch). The /health endpoint reports OK, the process
// is alive, but no observations land. Without this watchdog, the
// consumer would sit silently forever and we'd notice only when an
// operator wonders "why are we not capturing anything?"
//
// The watchdog runs at 60s intervals. If the listener reports
// state === "connected" AND lastMessageAt is either null OR older than
// WATCHDOG_SILENT_MS, we force a reconnect by closing the current
// receiver — the existing reconnect loop in connectLoop catches the
// resulting subscription-closed event and re-establishes from scratch
// (which re-fetches the SAS token via Zaptec API, dropping any stale
// state). False positives during legitimately quiet periods (Dalvegur
// at 4am with no plug-ins) are cheap — a 1-2s reconnect with no data
// loss because messages are receiveAndDelete and chargers re-publish
// on next state change.
//
// Tunable via env var. Default 30 minutes — tight enough to recover
// quickly from a stuck connection, loose enough to skip past genuine
// idle periods without churn.
const WATCHDOG_SILENT_MS = Number(process.env.WATCHDOG_SILENT_MS ?? "") || 30 * 60 * 1000;
const WATCHDOG_INTERVAL_MS = 60 * 1000;

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
  // Sprint 9 Phase 3 — set by the watchdog to break the inner wait loop
  // and force the connectLoop to re-establish. Reset to false after
  // each successful (re)connect.
  let forceReconnect = false;

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

    // Sprint 9.6 — fan out per observation:
    //   1. ALWAYS POST /zaptec-state-event for every parseable obs
    //      (the API Worker filters to StateId 710 / 513 / 553 and
    //      upserts charging.live_sessions; everything else is no-op).
    //   2. ONLY fire /zaptec-trigger-sync on StateId 710 transitions
    //      to 5 (Finished) or 1 (Disconnected) — i.e. end of session.
    //      The chargehistory enrichment is expensive (OAuth + REST
    //      fan-out per installation); firing once at session end is
    //      enough. The */1 sessions cron on the API Worker is the
    //      backstop for missed transitions.
    if (config.trigger) {
      const obs = parseObservation(msg);
      if (obs) {
        void postStateEvent(
          {
            chargerId: obs.ChargerId,
            stateId: obs.StateId,
            value: obs.ValueAsString,
            timestamp: obs.Timestamp,
          },
          config.trigger,
        );
        if (obs.StateId === 710) {
          const mode = obs.ValueAsString != null ? Number(obs.ValueAsString) : NaN;
          if (mode === 5 || mode === 1) {
            void triggerSync(obs.ChargerId, config.trigger);
          }
        }
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

        // Sprint 9 Phase 1.1 — Azure Service Bus rejects the SAS-signature
        // form here ("Missing 'sharedAccessKeyName'"). Zaptec returns
        // Username = key name, Password = key (NOT a SAS token), so build
        // the standard key-based connection string the SDK expects.
        const connectionString = `Endpoint=sb://${mcd.Host}/;SharedAccessKeyName=${mcd.Username};SharedAccessKey=${mcd.Password}`;
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

        // Wait until either stopped, the subscription closes (which
        // happens on transient errors despite the SDK's reconnect
        // logic — re-creating the receiver is cleaner than relying
        // on its internals), OR the silent-connection watchdog flips
        // forceReconnect to true.
        await new Promise<void>((resolve) => {
          const interval = setInterval(() => {
            if (stopped || forceReconnect) {
              clearInterval(interval);
              resolve();
            }
          }, 1000);
        });

        if (forceReconnect) {
          log.warn("zaptec_amqp_force_reconnect", {
            installationId: config.installationId,
            reason: "silent_connection_watchdog",
            lastMessageAt: stats.lastMessageAt?.toISOString() ?? null,
            connectedAt: stats.connectedAt?.toISOString() ?? null,
          });
          forceReconnect = false;
        }

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

  // Sprint 9 Phase 3 — silent-connection watchdog. Runs in the
  // background as a setInterval (not part of the connectLoop). Triggers
  // forceReconnect when state==="connected" but no message has arrived
  // for WATCHDOG_SILENT_MS. Cleared in stop().
  const watchdog = setInterval(() => {
    if (stats.state !== "connected") return; // not our problem; the connectLoop is reconnecting
    const reference = stats.lastMessageAt ?? stats.connectedAt;
    if (!reference) return;
    const silentMs = Date.now() - reference.getTime();
    if (silentMs >= WATCHDOG_SILENT_MS) {
      log.warn("zaptec_amqp_silent_watchdog_trip", {
        installationId: config.installationId,
        silentMs,
        thresholdMs: WATCHDOG_SILENT_MS,
        lastMessageAt: stats.lastMessageAt?.toISOString() ?? null,
        connectedAt: stats.connectedAt?.toISOString() ?? null,
      });
      forceReconnect = true;
    }
  }, WATCHDOG_INTERVAL_MS);

  return {
    stats,
    stop: async () => {
      stopped = true;
      clearInterval(watchdog);
      await currentReceiver?.close().catch(() => undefined);
      await currentClient?.close().catch(() => undefined);
    },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Sprint 9.6 — extractChargerId removed in favour of parseObservation
// inline at the message handler (fans out state-event + trigger-sync).

/**
 * Sprint 9.6 — Zaptec wraps state observations as AMQP-encoded
 * strings. The @azure/service-bus client surfaces them as a Buffer
 * (or `{ type: "Buffer", data: number[] }` after JSON-roundtrip).
 * Inside is an AMQP framing prefix (string-type marker + length)
 * followed by a UTF-8 JSON document. We just decode the buffer to
 * text, find the first `{`, and parse from there.
 *
 * Expected shape after parse:
 *   {
 *     "DeviceId": "ZPR042316",
 *     "DeviceType": 1,
 *     "ChargerId": "<uuid>",
 *     "StateId": 201,
 *     "Timestamp": "2026-05-06T00:45:04.691493Z",
 *     "ValueAsString": "14.7348"
 *   }
 */
export interface ZaptecObservation {
  ChargerId: string;
  DeviceId?: string;
  StateId: number;
  ValueAsString: string | null;
  Timestamp: string;
}

export function parseObservation(
  msg: ServiceBusReceivedMessage,
): ZaptecObservation | null {
  // Try parsed-object first (some clients pre-decode).
  if (msg.body && typeof msg.body === "object" && !Buffer.isBuffer(msg.body)) {
    const obj = msg.body as Record<string, unknown>;
    if (typeof obj.ChargerId === "string" && typeof obj.StateId === "number") {
      return {
        ChargerId: obj.ChargerId,
        DeviceId: typeof obj.DeviceId === "string" ? obj.DeviceId : undefined,
        StateId: obj.StateId,
        ValueAsString:
          typeof obj.ValueAsString === "string"
            ? obj.ValueAsString
            : obj.ValueAsString === null
              ? null
              : String(obj.ValueAsString ?? ""),
        Timestamp:
          typeof obj.Timestamp === "string" ? obj.Timestamp : new Date().toISOString(),
      };
    }
  }
  // Fall back to buffer decode + JSON tail.
  const bytes = bodyToBytes(msg.body);
  if (!bytes) return null;
  // Find the first '{' (0x7B) — everything before it is AMQP framing.
  const start = bytes.indexOf(0x7b);
  if (start < 0) return null;
  const slice = bytes.subarray(start);
  const text = new TextDecoder("utf-8", { fatal: false }).decode(slice);
  // The JSON document ends at the matching '}'; allow trailing AMQP
  // bytes after by parsing only up to the last '}'.
  const end = text.lastIndexOf("}");
  if (end < 0) return null;
  const json = text.slice(0, end + 1);
  try {
    const obj = JSON.parse(json) as Record<string, unknown>;
    if (typeof obj.ChargerId !== "string" || typeof obj.StateId !== "number") {
      return null;
    }
    return {
      ChargerId: obj.ChargerId,
      DeviceId: typeof obj.DeviceId === "string" ? obj.DeviceId : undefined,
      StateId: obj.StateId,
      ValueAsString:
        typeof obj.ValueAsString === "string"
          ? obj.ValueAsString
          : obj.ValueAsString === null
            ? null
            : String(obj.ValueAsString ?? ""),
      Timestamp:
        typeof obj.Timestamp === "string" ? obj.Timestamp : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

function bodyToBytes(body: unknown): Uint8Array | null {
  if (!body) return null;
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof Uint8Array) return body;
  if (typeof body === "string") return new TextEncoder().encode(body);
  // The JSON-roundtrip shape: { type: "Buffer", data: number[] }.
  if (typeof body === "object") {
    const obj = body as { type?: unknown; data?: unknown };
    if (obj.type === "Buffer" && Array.isArray(obj.data)) {
      return Uint8Array.from(obj.data as number[]);
    }
  }
  return null;
}
