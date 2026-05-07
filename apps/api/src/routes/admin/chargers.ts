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
import {
  getChargerZaptecConfig,
  writeChargerZaptecProperty,
} from "../../repositories/charger-zaptec-config";
import { enqueueCommand } from "../../repositories/outbound-commands";
import type { Env } from "../../bindings";

export const adminChargers = new Hono<{ Bindings: Env; Variables: AuthVars }>();

adminChargers.use("*", requireAdmin);

// ── CRUD ─────────────────────────────────────────────────────────────────

adminChargers.get("/", requirePermission("platform.tenant.read"), async (c) => {
  const db = makePrisma(c.env);
  const includeDecommissioned =
    c.req.query("includeDecommissioned") === "1" ||
    c.req.query("includeDecommissioned") === "true";
  const chargers = await listAllChargers(db, {
    includeDecommissioned,
    kek: c.env.OCPP_CRED_KEK,
  });
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

// Sprint 9.6 — active session for this charger if any. Reads
// charging.live_sessions which the AMQP consumer maintains. Returns
// null when no active session.
adminChargers.get(
  "/:id/active-session",
  requirePermission("charger.read"),
  async (c) => {
    const db = makePrisma(c.env);
    const row = await db.liveSession.findUnique({
      where: { chargingStationId: c.req.param("id") },
      select: {
        startedAt: true,
        lastObservedAt: true,
        lastOperationMode: true,
        lastPowerW: true,
        lastSessionEnergyWh: true,
        vendorResourceId: true,
      },
    });
    if (!row) return c.json({ activeSession: null });
    return c.json({
      activeSession: {
        startedAt: row.startedAt.toISOString(),
        lastObservedAt: row.lastObservedAt.toISOString(),
        lastOperationMode: row.lastOperationMode,
        lastPowerW: row.lastPowerW != null ? Number(row.lastPowerW) : null,
        lastSessionEnergyWh:
          row.lastSessionEnergyWh != null ? Number(row.lastSessionEnergyWh) : null,
        vendorResourceId: row.vendorResourceId,
      },
    });
  },
);

// Sprint 9.5 — raw Zaptec configuration: full /state observations +
// detail properties. Backs the Configuration panel below the chart on
// /chargers/[id]. Read endpoint is the slow path (one Zaptec auth +
// two API calls); write endpoint proxies to PUT /api/chargers/{id}.
adminChargers.get(
  "/:id/zaptec-state",
  requirePermission("charger.read"),
  async (c) => {
    const db = makePrisma(c.env);
    const snapshot = await getChargerZaptecConfig(
      db,
      c.env.OCPP_CRED_KEK,
      c.req.param("id"),
    );
    return c.json(snapshot);
  },
);

adminChargers.post(
  "/:id/zaptec-state",
  requirePermission("charger.config"),
  async (c) => {
    const raw = (await c.req.json().catch(() => null)) as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return c.json({ error: "body must be a flat key/value object" }, 400);
    }
    const body: Record<string, string | number | boolean> = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
        body[k] = v;
      }
    }
    if (Object.keys(body).length === 0) {
      return c.json({ error: "no writable fields in body" }, 400);
    }
    const db = makePrisma(c.env);
    const result = await writeChargerZaptecProperty(
      db,
      c.env.OCPP_CRED_KEK,
      c.req.param("id"),
      body,
    );
    if (!result.ok) {
      // Surface the Zaptec status code as our HTTP status so the
      // operator can tell 401/403/404 apart. Default to 502 (bad
      // gateway) when Zaptec was unreachable.
      const status: 400 | 401 | 403 | 404 | 500 | 502 =
        result.status === 401
          ? 401
          : result.status === 403
            ? 403
            : result.status === 404
              ? 404
              : result.status && result.status >= 500
                ? 502
                : 500;
      return c.json({ error: result.error ?? "write_failed" }, status);
    }
    return c.json({ ok: true });
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

// Sprint 9.4 — read the result of a previously-enqueued command. UI
// fires GetConfiguration via POST /:id/get-configuration, then polls
// this endpoint with the returned commandId until status="completed"
// (or "failed" / "timed_out") and renders result.configurationKey[].
adminChargers.get(
  "/commands/:commandId",
  requirePermission("charger.read"),
  async (c) => {
    const db = makePrisma(c.env);
    const cmd = await db.outboundCommand.findUnique({
      where: { id: c.req.param("commandId") },
      select: {
        id: true,
        status: true,
        controlDomain: true,
        attempts: true,
        result: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!cmd) return c.json({ error: "command not found" }, 404);
    return c.json({
      commandId: cmd.id,
      status: cmd.status,
      controlDomain: cmd.controlDomain,
      attempts: cmd.attempts,
      result: cmd.result,
      createdAt: cmd.createdAt.toISOString(),
      updatedAt: cmd.updatedAt.toISOString(),
    });
  },
);
