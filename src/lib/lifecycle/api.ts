// POST /api/cpo/lifecycle — charger remove/retire/return, as plain Request -> Response.
//
// Guard order, nothing reaches storage before all of it passes: method -> signed
// shell session (the actor is derived here, never read from the body) -> same
// origin -> JSON content type and size cap -> zod. Every response is no-store.
// Authority is checked in the SERVICE/repository path by organisation; hiding a
// button never grants or removes it. Refusals about another tenant's device are
// the same 404 as an unknown one.

import { z } from "zod";
import { isSameOriginRequest } from "@/lib/cpo-shell-handlers";
import { authenticate, DatabaseUnavailableError } from "@/lib/installations/api";
import { mayAdminister } from "@/lib/installations/actor";
import type { ShellEnv } from "@/lib/cpo-shell-session";
import { cancelRemoval, listReturnable, previewRemoval, progressRemoval, requestRemoval, returnDevice, type ActorRef, type Deps, type Refusal } from "./service";

export const MAX_LIFECYCLE_JSON_BYTES = 8 * 1024;
const uuid = z.string().uuid();

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("preview"), deviceId: uuid }),
  z.object({ action: z.literal("remove"), deviceId: uuid, kind: z.enum(["remove", "retire"]).default("remove"), reason: z.string().max(300).default(""), requestKey: uuid }),
  z.object({ action: z.literal("progress"), requestId: uuid }),
  z.object({ action: z.literal("cancel"), requestId: uuid }),
  z.object({ action: z.literal("returnable"), installationId: uuid, orgId: uuid }),
  z.object({
    action: z.literal("return"), deviceId: uuid, installationId: uuid, orgId: uuid, circuitId: uuid,
    label: z.string().trim().min(1).max(80), chargePointId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,47}$/), confirmRetiredReturn: z.boolean().optional(),
  }),
]);

const STATUS: Record<Refusal, number> = {
  not_found: 404, forbidden: 403, reason_required: 422, bad_request: 422, stop_unavailable: 409, conflict: 409, placed_elsewhere: 409, not_detached: 409, retired_needs_return: 409, identity_in_use: 409,
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export type LifecycleApiDeps = {
  env?: ShellEnv;
  withLifecycle<T>(fn: (d: Deps) => Promise<T>): Promise<T>;
};

export async function handleLifecycle(request: Request, deps: LifecycleApiDeps): Promise<Response> {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const actor = await authenticate(request, deps.env);
  if (!actor) return json({ error: "unauthorized" }, 401);
  if (!isSameOriginRequest(request)) return json({ error: "bad_origin" }, 403);
  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) return json({ error: "unsupported_media_type" }, 415);
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_LIFECYCLE_JSON_BYTES) return json({ error: "payload_too_large" }, 413);
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return json({ error: "malformed_json" }, 400); }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) return json({ error: "validation", problems: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) }, 422);
  const b = parsed.data;
  const who: ActorRef = { kind: "shared_login", label: actor.label };

  try {
    return await deps.withLifecycle(async (d) => {
      const deps2: Deps = { ...d, authorise: (a, orgId) => mayAdminister(actor, orgId) && a.kind === "shared_login" };
      const reply = (r: { ok: true; value: unknown } | { ok: false; refusal: Refusal; message: string }) => (r.ok ? json(r.value) : json({ error: r.refusal, message: r.message }, STATUS[r.refusal]));
      switch (b.action) {
        case "preview": return reply(await previewRemoval(deps2, { deviceId: b.deviceId, actor: who }));
        case "remove": return reply(await requestRemoval(deps2, { deviceId: b.deviceId, kind: b.kind, reason: b.reason, requestKey: b.requestKey, actor: who }));
        case "progress": return reply(await progressRemoval(deps2, b.requestId));
        case "cancel": return reply(await cancelRemoval(deps2, { requestId: b.requestId, actor: who }));
        case "returnable": return json({ devices: await listReturnable(deps2, { installationId: b.installationId, orgId: b.orgId, actor: who }) });
        case "return": return reply(await returnDevice(deps2, { deviceId: b.deviceId, installationId: b.installationId, orgId: b.orgId, circuitId: b.circuitId, label: b.label, chargePointId: b.chargePointId, ...(b.confirmRetiredReturn ? { confirmRetiredReturn: true } : {}), actor: who }));
      }
    });
  } catch (e) {
    if (e instanceof DatabaseUnavailableError) return json({ error: "database_unavailable" }, 503);
    return json({ error: "internal" }, 500);
  }
}
