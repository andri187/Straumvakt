/**
 * Straumvakt OCPP Gateway — Cloudflare Worker entry.
 *
 * Routes:
 *   • GET  /health                          — 200 liveness check
 *   • GET  /ocpp/:identityString            — WebSocket upgrade from charger
 *   • GET  /ocpp/1.6/:identityString        — same, version-prefixed alias
 *   • POST /dispatch/:identityId            — outbound command from main-app
 *                                             dispatcher (Service Binding only)
 *   • POST /invalidate-authorize/:identityId — drop cached Authorize
 *                                             verdicts for that identity
 *                                             (P4.18, Service Binding only)
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
import { admit } from "./engine-client";
import { guardIngress, type IngressGuardEnv } from "./ingress-guard";
import { ENGINE_CTX_HEADER } from "./engine-mode";
import { PENDING_ATTEMPT_HEADER, PENDING_CTX_HEADER } from "./pending-mode";
import { IdentityDurableObject } from "./identity-do";
import { versionResponseBody } from "./version";

export { IdentityDurableObject };
// Named entrypoint for commands from the shell Worker (service binding only; not a route).
export { CommandEntrypoint } from "./command-entrypoint";

interface Env extends IngressGuardEnv {
  IDENTITY_DO: DurableObjectNamespace;
  MAIN_APP: { fetch: (req: Request) => Promise<Response> };
  OCPP_INGEST_SECRET: string;
  /** Service binding to the shell Worker's `EngineEntrypoint` (adopted path). */
  ENGINE?: import("./engine-client").EngineBinding;
  /**
   * Legacy identity path switch. ANY value other than the exact string "true"
   * leaves /ocpp/<id>, /dispatch and /invalidate-authorize answering 404. The
   * adopted configuration never sets it, so adopted traffic cannot fall into the
   * legacy Prisma-backed path. It exists only so the retained legacy tests and a
   * deliberate rollback can still exercise that code.
   */
  LEGACY_OCPP_ENABLED?: string;
  /**
   * Pending onboarding switch. Only the exact string "true" lets an UNKNOWN charge point id of an active CPO keep a
   * restricted waiting socket; anything else keeps today's plain 401. Retired, ambiguous and credential-failing
   * identities are refused regardless.
   */
  PENDING_ONBOARDING?: string;
  /**
   * Populated by Cloudflare when `version_metadata` is declared. Optional
   * because the binding is still commented out in wrangler.jsonc pending
   * approval — the runtime half is built so that enabling it is a config
   * change and not a code change.
   */
  CF_VERSION_METADATA?: { id: string; tag?: string; timestamp?: string };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Generic engine route: wss://{cpo-routing-id}.straumvakt.org/{charge-point-id}. The CPO is the host and the
    // charger's own OCPP identity is the single path segment; there is no installation segment. Host and path are
    // resolved TOGETHER by the engine (admission), which derives the installation from the charger's registered
    // placement; this Worker never decides tenancy. A WebSocket upgrade on this shape is claimed first, so a charger
    // whose id happens to be "health" or "version" is still routed to the engine; a plain GET still reaches those
    // routes below. The old two-segment form /{installation-key}/{charge-point-id} matches nothing and is a 404.
    // The legacy /ocpp/<id> route further down is excluded from the adopted release.
    const isEngineRoute = url.hostname.endsWith(".straumvakt.org") && /^\/[^/]+$/.test(url.pathname);
    if (isEngineRoute && request.headers.get("upgrade") === "websocket") {
      return handleEngineUpgrade(request, env, url);
    }

    if (url.pathname === "/health") {
      // Exactly the bytes "ok". The alert policy specifies a synthetic probe
      // against this route; deployment identity lives on /version so this
      // contract never has to change.
      return new Response("ok", { status: 200 });
    }

    // Deployment identity. Always 200 — an unconfigured version id is a
    // release-readiness problem, not an outage, and a 5xx here would trip
    // uptime alerting for the wrong reason. `check:version-id` is what fails.
    if (url.pathname === "/version") {
      return new Response(versionResponseBody(env, "straumvakt-ocpp"), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    const legacy = env.LEGACY_OCPP_ENABLED === "true";

    // WebSocket upgrade from a charger. Accept both /ocpp/<id> and
    // /ocpp/1.6/<id> — see file header for why. LEGACY: gated off by default.
    const wsMatch = /^\/ocpp\/(?:1\.6\/)?([^/]+)$/.exec(url.pathname);
    if (legacy && wsMatch && wsMatch[1]) {
      if (request.headers.get("upgrade") !== "websocket") {
        return new Response("expected websocket upgrade", { status: 426 });
      }
      const identityString = decodeURIComponent(wsMatch[1]);
      return handleChargerUpgrade(request, env, identityString);
    }

    // Main-app → gateway outbound dispatch
    const dispatchMatch = /^\/dispatch\/([0-9a-f-]+)$/.exec(url.pathname);
    if (legacy && dispatchMatch && dispatchMatch[1] && request.method === "POST") {
      const secret = request.headers.get("x-straumvakt-ingest");
      if (!secret || secret !== env.OCPP_INGEST_SECRET) {
        return new Response("unauthorized", { status: 401 });
      }
      const identityId = dispatchMatch[1];
      return forwardToDo(request, env, identityId, "/dispatch");
    }

    // P4.18 — main-app → gateway Authorize-cache invalidation. Same
    // shared-secret gate as dispatch: it is a Service-Binding-only
    // control-plane call, and an unauthenticated one would let anyone
    // force the fleet back onto the uncached (Postgres) path.
    const invalidateMatch = /^\/invalidate-authorize\/([0-9a-f-]+)$/.exec(url.pathname);
    if (legacy && invalidateMatch && invalidateMatch[1] && request.method === "POST") {
      const secret = request.headers.get("x-straumvakt-ingest");
      if (!secret || secret !== env.OCPP_INGEST_SECRET) {
        return new Response("unauthorized", { status: 401 });
      }
      // Body is read here rather than streamed through: it is a couple
      // of dozen bytes of control-plane JSON, and a buffered body keeps
      // the forward constructible outside the Workers runtime (node's
      // Request demands `duplex` for a stream body), which is what
      // makes this route testable.
      return forwardToDo(
        request,
        env,
        invalidateMatch[1],
        "/invalidate-authorize",
        await request.text(),
      );
    }

    // A CPO host and a single segment, but not a WebSocket upgrade.
    if (isEngineRoute) return new Response("expected websocket upgrade", { status: 426 });

    return new Response("not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;

async function handleEngineUpgrade(request: Request, env: Env, url: URL): Promise<Response> {
  const refused = await guardIngress(request, env, url);
  if (refused) return refused;
  // Pending onboarding is a deliberate switch: only the exact string "true" lets a genuinely unknown charger wait.
  const acceptPending = env.PENDING_ONBOARDING === "true";
  const decision = await admit(env, url.hostname, url.pathname, request.headers.get("authorization"), acceptPending);
  // Every refusal looks the same to the charger; the reason stays inside the engine.
  if (decision.kind === "deny") return new Response("unauthorized", { status: 401 });
  if (decision.kind === "unavailable") return new Response("service unavailable", { status: 503 });
  if (decision.kind === "pending") {
    // Per-CPO admission gate: a lease is taken BEFORE any pending state is allocated, so the number of waiting sockets per CPO
    // is bounded. Fail closed: an unreachable gate is a 503, a CPO at its cap is a 429.
    const gateStub = env.IDENTITY_DO.get(env.IDENTITY_DO.idFromName(`pending-gate:${decision.orgId}`));
    // One token per upgrade attempt. It is the upgrade's claim at the gate (one unconfirmed claim per id at a time) and, handed
    // on to the pending object, the owner token of the connection this upgrade creates. A refused upgrade can therefore give
    // back exactly its own unconfirmed claim and never the slot of a surviving or newer connection.
    const attempt = crypto.randomUUID();
    let granted = false;
    try {
      const res = await gateStub.fetch(new Request("https://do.internal/gate/acquire", { method: "POST", body: JSON.stringify({ id: decision.chargePointId, attempt }) }));
      granted = ((await res.json()) as { ok?: unknown }).ok === true;
    } catch {
      return new Response("service unavailable", { status: 503 });
    }
    if (!granted) return new Response("retry later", { status: 429, headers: { "retry-after": "60" } });
    const giveBackAttempt = async () => {
      try {
        await gateStub.fetch(new Request("https://do.internal/gate/release", { method: "POST", body: JSON.stringify({ id: decision.chargePointId, attempt }) }));
      } catch {
        /* best effort: an unconfirmed claim lapses by itself within the first-boot deadline */
      }
    };
    // A restricted object per CPO + charge point id. It has no device, placement or credential context.
    const pendingStub = env.IDENTITY_DO.get(env.IDENTITY_DO.idFromName(`pending:${decision.orgId}:${decision.chargePointId}`));
    const pendingHeaders: Record<string, string> = {
      upgrade: "websocket",
      [PENDING_CTX_HEADER]: JSON.stringify({ orgId: decision.orgId, routingId: decision.routingId, chargePointId: decision.chargePointId }),
      [PENDING_ATTEMPT_HEADER]: attempt,
    };
    const offeredPending = request.headers.get("sec-websocket-protocol");
    if (offeredPending) pendingHeaders["x-straumvakt-ws-protocol"] = offeredPending;
    let upgraded: Response;
    try {
      upgraded = await pendingStub.fetch(new Request("https://do.internal/pending/ws", { method: "GET", headers: pendingHeaders }));
    } catch {
      // The outcome is unknown: the object may have accepted the socket before the error. Do NOT give the claim back, or an
      // accepted connection could be left without its slot. A socket confirms its own claim on its first boot (or gives it back
      // at its first-boot deadline); if there is no socket the claim lapses within that deadline.
      return new Response("service unavailable", { status: 503 });
    }
    // A definite refusal (unsupported subprotocol, bad context, object error) leaves no socket: give back this claim only.
    if (upgraded.status !== 101) await giveBackAttempt();
    return upgraded;
  }

  // One Durable Object per PERMANENT device, so a reconnect under a new placement supersedes the old socket.
  const stub = env.IDENTITY_DO.get(env.IDENTITY_DO.idFromName(`device:${decision.context.deviceId}`));
  const headers: Record<string, string> = { upgrade: "websocket", [ENGINE_CTX_HEADER]: JSON.stringify(decision.context) };
  const offered = request.headers.get("sec-websocket-protocol");
  if (offered) headers["x-straumvakt-ws-protocol"] = offered;
  return stub.fetch(new Request("https://do.internal/ws", { method: "GET", headers }));
}

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
  /** Pre-read body; falls back to streaming the original through. */
  body?: string,
): Promise<Response> {
  const id = env.IDENTITY_DO.idFromName(identityId);
  const stub = env.IDENTITY_DO.get(id);
  const forward = new Request(`https://do.internal${path}`, {
    method: request.method,
    headers: request.headers,
    body: body ?? request.body,
  });
  return stub.fetch(forward);
}
