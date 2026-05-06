// Tiny HTTP server exposing /health. Fly's health checks hit this;
// returns 200 when at least one listener is connected, 503 when none
// are. Body includes per-installation state for human inspection
// (Fly logs / curl).

import { createServer, IncomingMessage, ServerResponse } from "node:http";
import type { ListenerStats } from "./amqp-listener.js";
import { log } from "./logger.js";

export function startHealthServer(
  port: number,
  getListenerStats: () => ListenerStats[],
): { stop: () => Promise<void> } {
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== "GET") {
      res.statusCode = 405;
      res.end();
      return;
    }
    if (req.url === "/health") {
      const listeners = getListenerStats();
      const connected = listeners.filter((l) => l.state === "connected").length;
      const status = connected > 0 ? 200 : 503;
      res.statusCode = status;
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify(
          {
            ok: status === 200,
            listeners: listeners.length,
            connected,
            installations: listeners.map((l) => ({
              installationId: l.installationId,
              installationName: l.installationName,
              state: l.state,
              messagesReceived: l.messagesReceived,
              errorsSeen: l.errorsSeen,
              lastMessageAt: l.lastMessageAt?.toISOString() ?? null,
              connectedAt: l.connectedAt?.toISOString() ?? null,
              subjectCounts: l.subjectCounts,
            })),
          },
          null,
          2,
        ),
      );
      return;
    }
    res.statusCode = 404;
    res.end();
  });

  server.listen(port, () => {
    log.info("health_server_listening", { port });
  });

  return {
    stop: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}
