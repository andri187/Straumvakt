// Chargers admin routes — list/detail/create/update plus the four OCPP
// outbound-command enqueue endpoints. Mirrors the monolith routes at
// /src/app/api/admin/chargers/* so the UI cuts over without changing
// shapes or status codes.

import { Hono } from "hono";
import {
  ChargerCreateInput,
  ChargerUpdateInput,
  ChangeConfigurationBody,
  GetConfigurationBody,
  RemoteStartBody,
  RemoteStopBody,
} from "@straumvakt/shared/inputs/chargers";
import { makePrisma } from "../../lib/prisma";
import { requireAdmin, type AuthVars } from "../../lib/auth-middleware";
import {
  createCharger,
  findConnectorOnStation,
  findOcppIdentity,
  getChargerById,
  listAllChargers,
  updateCharger,
} from "../../repositories/chargers";
import { enqueueCommand } from "../../repositories/outbound-commands";
import type { Env } from "../../bindings";

export const adminChargers = new Hono<{ Bindings: Env; Variables: AuthVars }>();

adminChargers.use("*", requireAdmin);

// ── CRUD ─────────────────────────────────────────────────────────────────

adminChargers.get("/", async (c) => {
  const db = makePrisma(c.env);
  const chargers = await listAllChargers(db);
  return c.json({ chargers });
});

adminChargers.post("/", async (c) => {
  const raw = (await c.req.json().catch(() => null)) as unknown;
  const parsed = ChargerCreateInput.safeParse(raw);
  if (!parsed.success) return c.json({ error: "validation", issues: parsed.error.issues }, 400);
  const db = makePrisma(c.env);
  const r = await createCharger(db, parsed.data, null);
  return c.json(
    {
      ok: true,
      ...r,
      note: "Copy the OCPP password into the charger config — it is not stored plaintext and cannot be retrieved again.",
    },
    201,
  );
});

adminChargers.get("/:id", async (c) => {
  const db = makePrisma(c.env);
  const charger = await getChargerById(db, c.req.param("id"));
  if (!charger) return c.json({ error: "not_found" }, 404);
  return c.json({ charger });
});

adminChargers.patch("/:id", async (c) => {
  const raw = (await c.req.json().catch(() => null)) as unknown;
  const parsed = ChargerUpdateInput.safeParse(raw);
  if (!parsed.success) return c.json({ error: "validation", issues: parsed.error.issues }, 400);
  const db = makePrisma(c.env);
  const charger = await updateCharger(db, c.req.param("id"), parsed.data, null);
  return c.json({ charger });
});

// ── OCPP outbound-command enqueue ────────────────────────────────────────
//
// These endpoints are addressed by ocppIdentityId, not chargingStationId.
// Each writes one row to the outbox; the dispatcher (still in the monolith
// for now) picks it up. They return 202 with { commandId, status: "pending" }
// so callers can poll/correlate via the event log.

adminChargers.post("/:ocppIdentityId/remote-start", async (c) => {
  const raw = (await c.req.json().catch(() => null)) as unknown;
  const parsed = RemoteStartBody.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message ?? "invalid body" }, 400);
  }
  const db = makePrisma(c.env);
  const identity = await findOcppIdentity(db, c.req.param("ocppIdentityId"));
  if (!identity) return c.json({ error: "ocpp identity not found" }, 404);

  const connector = await findConnectorOnStation(db, parsed.data.connectorId, identity.chargingStationId);
  if (!connector) return c.json({ error: "connector does not belong to this ocpp identity" }, 400);

  const enqueued = await enqueueCommand(db, {
    orgId: identity.orgId,
    identityId: identity.id,
    controlDomain: "remote_start",
    routedTo: "ocpp",
    payload: { connectorId: parsed.data.connectorId, idTag: parsed.data.idTag },
    correlationId: crypto.randomUUID(),
    requestedBy: null,
  });
  return c.json({ commandId: enqueued.id, status: enqueued.status }, 202);
});

adminChargers.post("/:ocppIdentityId/remote-stop", async (c) => {
  const raw = (await c.req.json().catch(() => null)) as unknown;
  const parsed = RemoteStopBody.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message ?? "invalid body" }, 400);
  }
  const db = makePrisma(c.env);
  const identity = await findOcppIdentity(db, c.req.param("ocppIdentityId"));
  if (!identity) return c.json({ error: "ocpp identity not found" }, 404);

  const enqueued = await enqueueCommand(db, {
    orgId: identity.orgId,
    identityId: identity.id,
    controlDomain: "remote_stop",
    routedTo: "ocpp",
    payload: { transactionId: parsed.data.transactionId },
    correlationId: crypto.randomUUID(),
    requestedBy: null,
  });
  return c.json({ commandId: enqueued.id, status: enqueued.status }, 202);
});

adminChargers.post("/:ocppIdentityId/get-configuration", async (c) => {
  // Body is optional — empty body = query all keys.
  let raw: unknown = {};
  const ct = c.req.header("content-type") ?? "";
  if (ct.includes("application/json")) {
    raw = (await c.req.json().catch(() => null)) as unknown;
    if (raw === null) return c.json({ error: "malformed json" }, 400);
  }
  const parsed = GetConfigurationBody.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message ?? "invalid body" }, 400);
  }
  const db = makePrisma(c.env);
  const identity = await findOcppIdentity(db, c.req.param("ocppIdentityId"));
  if (!identity) return c.json({ error: "ocpp identity not found" }, 404);

  const payload: Record<string, unknown> = {};
  if (parsed.data.key) payload.key = parsed.data.key;

  const enqueued = await enqueueCommand(db, {
    orgId: identity.orgId,
    identityId: identity.id,
    controlDomain: "get_configuration",
    routedTo: "ocpp",
    payload,
    correlationId: crypto.randomUUID(),
    requestedBy: null,
  });
  return c.json({ commandId: enqueued.id, status: enqueued.status }, 202);
});

adminChargers.post("/:ocppIdentityId/change-configuration", async (c) => {
  const raw = (await c.req.json().catch(() => null)) as unknown;
  const parsed = ChangeConfigurationBody.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message ?? "invalid body" }, 400);
  }
  const db = makePrisma(c.env);
  const identity = await findOcppIdentity(db, c.req.param("ocppIdentityId"));
  if (!identity) return c.json({ error: "ocpp identity not found" }, 404);

  const enqueued = await enqueueCommand(db, {
    orgId: identity.orgId,
    identityId: identity.id,
    controlDomain: "change_configuration",
    routedTo: "ocpp",
    payload: { key: parsed.data.key, value: parsed.data.value },
    correlationId: crypto.randomUUID(),
    requestedBy: null,
  });
  return c.json({ commandId: enqueued.id, status: enqueued.status }, 202);
});
