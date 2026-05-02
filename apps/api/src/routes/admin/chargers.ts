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
import { requirePermission } from "../../lib/auth/require-permission";
import {
  createCharger,
  deleteCharger,
  findConnectorOnStation,
  findOcppIdentity,
  getChargerById,
  listAllChargers,
  updateCharger,
} from "../../repositories/chargers";
import { getChargerTechnicalRead } from "../../repositories/charger-technical-read";
import { enqueueCommand } from "../../repositories/outbound-commands";
import type { Env } from "../../bindings";

export const adminChargers = new Hono<{ Bindings: Env; Variables: AuthVars }>();

adminChargers.use("*", requireAdmin);

// ── CRUD ─────────────────────────────────────────────────────────────────

adminChargers.get("/", requirePermission("platform.tenant.read"), async (c) => {
  const db = makePrisma(c.env);
  const chargers = await listAllChargers(db);
  return c.json({ chargers });
});

adminChargers.post("/", requirePermission("charger.write"), async (c) => {
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

adminChargers.get("/:id", requirePermission("charger.read"), async (c) => {
  const db = makePrisma(c.env);
  const charger = await getChargerById(db, c.req.param("id"));
  if (!charger) return c.json({ error: "not_found" }, 404);
  return c.json({ charger });
});

// Live vendor-side telemetry (Zaptec). Slow path — auths to the
// vendor portal and fetches detail + state. Render the charger
// detail page in parallel with this so a slow Zaptec response
// doesn't block the rest of the page.
adminChargers.get(
  "/:id/technical-read",
  requirePermission("charger.read"),
  async (c) => {
    const db = makePrisma(c.env);
    const read = await getChargerTechnicalRead(db, c.req.param("id"), c.env.OCPP_CRED_KEK);
    return c.json({ technicalRead: read });
  },
);

adminChargers.patch("/:id", requirePermission("charger.write"), async (c) => {
  const raw = (await c.req.json().catch(() => null)) as unknown;
  const parsed = ChargerUpdateInput.safeParse(raw);
  if (!parsed.success) return c.json({ error: "validation", issues: parsed.error.issues }, 400);
  const db = makePrisma(c.env);
  const charger = await updateCharger(db, c.req.param("id"), parsed.data, null);
  return c.json({ charger });
});

// DELETE — wipes the SiteAsset + ChargingStation + EVSE + Connector +
// OcppIdentity chain in one cascade. If the physical charger keeps
// trying to connect with the same identity_string, the auth-fail path
// in /api/internal/ocpp-auth will record a fresh pending_discoveries
// row, so it re-appears in /chargers/pending.
adminChargers.delete("/:id", requirePermission("charger.write"), async (c) => {
  const db = makePrisma(c.env);
  await deleteCharger(db, c.req.param("id"));
  return c.json({ ok: true });
});

// ── OCPP outbound-command enqueue ────────────────────────────────────────
//
// These endpoints are addressed by ocppIdentityId, not chargingStationId.
// Each writes one row to the outbox AND publishes { commandId } to
// OUTBOUND_QUEUE. The queue handler in src/index.ts processes it and
// dispatches via the OCPP_GATEWAY service binding. They return 202 with
// { commandId, status: "pending" } so callers can poll/correlate via
// the event log.

adminChargers.post(
  "/:ocppIdentityId/remote-start",
  requirePermission("charger.remote_start"),
  async (c) => {
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

  const enqueued = await enqueueCommand(db, c.env.OUTBOUND_QUEUE, {
    orgId: identity.orgId,
    identityId: identity.id,
    controlDomain: "remote_start",
    routedTo: "ocpp",
    payload: { connectorId: parsed.data.connectorId, idTag: parsed.data.idTag },
    correlationId: crypto.randomUUID(),
    requestedBy: null,
  });
  return c.json({ commandId: enqueued.id, status: enqueued.status }, 202);
  },
);

adminChargers.post(
  "/:ocppIdentityId/remote-stop",
  requirePermission("charger.remote_stop"),
  async (c) => {
  const raw = (await c.req.json().catch(() => null)) as unknown;
  const parsed = RemoteStopBody.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message ?? "invalid body" }, 400);
  }
  const db = makePrisma(c.env);
  const identity = await findOcppIdentity(db, c.req.param("ocppIdentityId"));
  if (!identity) return c.json({ error: "ocpp identity not found" }, 404);

  const enqueued = await enqueueCommand(db, c.env.OUTBOUND_QUEUE, {
    orgId: identity.orgId,
    identityId: identity.id,
    controlDomain: "remote_stop",
    routedTo: "ocpp",
    payload: { transactionId: parsed.data.transactionId },
    correlationId: crypto.randomUUID(),
    requestedBy: null,
  });
  return c.json({ commandId: enqueued.id, status: enqueued.status }, 202);
  },
);

adminChargers.post(
  "/:ocppIdentityId/get-configuration",
  requirePermission("charger.config"),
  async (c) => {
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

  const enqueued = await enqueueCommand(db, c.env.OUTBOUND_QUEUE, {
    orgId: identity.orgId,
    identityId: identity.id,
    controlDomain: "get_configuration",
    routedTo: "ocpp",
    payload,
    correlationId: crypto.randomUUID(),
    requestedBy: null,
  });
  return c.json({ commandId: enqueued.id, status: enqueued.status }, 202);
  },
);

adminChargers.post(
  "/:ocppIdentityId/change-configuration",
  requirePermission("charger.config"),
  async (c) => {
  const raw = (await c.req.json().catch(() => null)) as unknown;
  const parsed = ChangeConfigurationBody.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message ?? "invalid body" }, 400);
  }
  const db = makePrisma(c.env);
  const identity = await findOcppIdentity(db, c.req.param("ocppIdentityId"));
  if (!identity) return c.json({ error: "ocpp identity not found" }, 404);

  const enqueued = await enqueueCommand(db, c.env.OUTBOUND_QUEUE, {
    orgId: identity.orgId,
    identityId: identity.id,
    controlDomain: "change_configuration",
    routedTo: "ocpp",
    payload: { key: parsed.data.key, value: parsed.data.value },
    correlationId: crypto.randomUUID(),
    requestedBy: null,
  });
  return c.json({ commandId: enqueued.id, status: enqueued.status }, 202);
  },
);
