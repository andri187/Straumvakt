/**
 * Straumvakt OCPP Gateway — Cloudflare Worker entry.
 *
 * Routes:
 *   • GET  /health                          — 200 liveness check
 *   • GET  /ocpp/:identityString            — WebSocket upgrade from charger
 *   • GET  /ocpp/1.6/:identityString        — same, version-prefixed alias
 *   • POST /dispatch/:identityId            — outbound command from main-app
 *                                             dispatcher (Service Binding only)
 *
 * Both `/ocpp/<id>` and `/ocpp/1.6/<id>` are accepted because vendors
 * differ on whether they include the protocol version in the URL —
 * Zaptec configures `wss://.../ocpp/<deviceId>` without any version
 * prefix. The OCPP version of an identity is authoritative from
 * `ocpp_identities.ocpp_version`, not the URL.
 *
 * Both the WebSocket path and the dispatch path route requests to the
 * per-identity Durable Object. Authentication:
 *   • WebSocket path: Basic-Auth verified via main-app Service Binding
 *     (see `./auth.ts`).
 *   • Dispatch path: `x-straumvakt-ingest` header, same secret as the
 *     main-app-side ingest route (ADR 0004).
 */
import { authenticate } from "./auth";
import { IdentityDurableObject } from "./identity-do";

export { IdentityDurableObject };

interface Env {
  IDENTITY_DO: DurableObjectNamespace;
  MAIN_APP: { fetch: (req: Request) => Promise<Response> };
  OCPP_INGEST_SECRET: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return new Response("ok", { status: 200 });
    }

    // WebSocket upgrade from a charger. Accept both /ocpp/<id> and
    // /ocpp/1.6/<id> — see file header for why.
    const wsMatch = /^\/ocpp\/(?:1\.6\/)?([^/]+)$/.exec(url.pathname);
    if (wsMatch && wsMatch[1]) {
      if (request.headers.get("upgrade") !== "websocket") {
        return new Response("expected websocket upgrade", { status: 426 });
      }
      const identityString = decodeURIComponent(wsMatch[1]);
      return handleChargerUpgrade(request, env, identityString);
    }

    // Main-app → gateway outbound dispatch
    const dispatchMatch = /^\/dispatch\/([0-9a-f-]+)$/.exec(url.pathname);
    if (dispatchMatch && dispatchMatch[1] && request.method === "POST") {
      const secret = request.headers.get("x-straumvakt-ingest");
      if (!secret || secret !== env.OCPP_INGEST_SECRET) {
        return new Response("unauthorized", { status: 401 });
      }
      const identityId = dispatchMatch[1];
      return forwardToDo(request, env, identityId, "/dispatch");
    }

    return new Response("not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;

async function handleChargerUpgrade(
  request: Request,
  env: Env,
  identityString: string,
): Promise<Response> {
  const auth = await authenticate(
    env,
    identityString,
    request.headers.get("authorization"),
  );
  if (!auth.ok) {
    return new Response(auth.reason, { status: auth.status });
  }

  // Route the upgrade to the DO keyed by the identity UUID. We pass
  // identity context as trailing headers so the DO can persist meta
  // on first connection and recover it after hibernation.
  const id = env.IDENTITY_DO.idFromName(auth.identityId);
  const stub = env.IDENTITY_DO.get(id);

  const headers: Record<string, string> = {
    upgrade: "websocket",
    "x-straumvakt-identity-id": auth.identityId,
    "x-straumvakt-org-id": auth.orgId,
    "x-straumvakt-identity-string": identityString,
  };

  // P4.17 — this request is rebuilt from scratch, so the client's
  // `Sec-WebSocket-Protocol` offer would be lost. Carry it on a custom
  // header (the Sec-* names are reserved on outbound subrequests) so
  // the DO can negotiate and echo it on the 101.
  const offeredProtocols = request.headers.get("sec-websocket-protocol");
  if (offeredProtocols) headers["x-straumvakt-ws-protocol"] = offeredProtocols;

  const forward = new Request("https://do.internal/ws", {
    method: "GET",
    headers,
  });
  return stub.fetch(forward);
}

async function forwardToDo(
  request: Request,
  env: Env,
  identityId: string,
  path: string,
): Promise<Response> {
  const id = env.IDENTITY_DO.idFromName(identityId);
  const stub = env.IDENTITY_DO.get(id);
  const forward = new Request(`https://do.internal${path}`, {
    method: request.method,
    headers: request.headers,
    body: request.body,
  });
  return stub.fetch(forward);
}
