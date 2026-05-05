// Per-installation Service Bus subscriber. Holds one persistent AMQP
// connection per installation; reconnects on transient errors with
// exponential backoff; refreshes the SAS token by re-fetching
// messagingConnectionDetails when the existing token expires.
//
// Phase 1: just receive messages and log them. The translator and
// HTTP postback land in Phase 2 once we know the message shape.

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

export interface ListenerConfig {
  installationId: string;
  installationName: string | undefined;
  username: string;
  password: string;
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

    // Log the full message — Phase 1 is observe-only. Body and
    // applicationProperties tell us what events look like. SAS
    // tokens never appear in message bodies, so this is safe.
    log.info("zaptec_amqp_message", {
      installationId: config.installationId,
      messageId: msg.messageId,
      subject: msg.subject,
      contentType: msg.contentType,
      enqueuedAt: msg.enqueuedTimeUtc?.toISOString(),
      applicationProperties: msg.applicationProperties,
      body: msg.body,
    });

    // Auto-complete is on (peekLock=false equivalent via ReceiverMode);
    // nothing to ack here.
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
