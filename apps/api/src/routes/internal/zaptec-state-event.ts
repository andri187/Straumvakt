// Sprint 9.6 — per-state-observation ingest from the Fly AMQP consumer.
//
// The consumer parses each Service Bus message into a flat observation
// {chargerId, stateId, value, timestamp} and POSTs here. The endpoint
// classifies a small set of operationally-meaningful StateIds and
// upserts / deletes charging.live_sessions accordingly:
//
//   StateId 710 (ChargerOperationMode):
//     value=3 (Charging)              -> upsert live_sessions row
//     value=5 (Finished) or 1 (Disc.) -> delete live_sessions row
//                                        + (consumer should also fire
//                                          /zaptec-trigger-sync to
//                                          enrich the closed CDR)
//   StateId 513 (TotalChargePower):   -> update lastPowerW if row exists
//   StateId 553 (TotalChargeEnergy):  -> update lastSessionEnergyWh
//
// All other StateIds are accepted (200 OK) and ignored — the consumer
// can fire-and-forget for every observation without filtering on its
// side; we keep the classification logic centralized here.
//
// Auth: shared OCPP_INGEST_SECRET (same as zaptec-trigger-sync).

import { Hono } from "hono";
import { z } from "zod";
import { makePrisma } from "../../lib/prisma";
import { verifyIngest } from "../../lib/ocpp-internal-auth";
import type { Env } from "../../bindings";

export const internalZaptecStateEvent = new Hono<{ Bindings: Env }>();

const StateEventInput = z
  .object({
    chargerId: z.string().uuid(),         // Zaptec internal UUID
    stateId: z.number().int(),
    value: z.string().nullable().optional(),
    timestamp: z.string().datetime(),     // observation timestamp from Zaptec
  })
  .strict();

const OPERATION_MODE_CHARGING = 3;
const OPERATION_MODE_FINISHED = 5;
const OPERATION_MODE_DISCONNECTED = 1;

internalZaptecStateEvent.post("/", async (c) => {
  const fail = verifyIngest(c.req.raw, c.env.OCPP_INGEST_SECRET);
  if (fail) return fail;

  const raw = (await c.req.json().catch(() => null)) as unknown;
  const parsed = StateEventInput.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: "validation", issues: parsed.error.issues }, 400);
  }
  const { chargerId, stateId, value, timestamp } = parsed.data;

  // We only act on a small whitelist; everything else is acked.
  if (stateId !== 710 && stateId !== 513 && stateId !== 553) {
    return c.json({ ok: true, action: "ignored" });
  }

  const db = makePrisma(c.env);

  // Resolve identity / station / org from the Zaptec UUID.
  const identity = await db.ocppIdentity.findFirst({
    where: { vendor: "Zaptec", vendorResourceId: chargerId },
    select: { id: true, orgId: true, chargingStationId: true },
  });
  if (!identity || !identity.chargingStationId) {
    return c.json({ ok: true, action: "no_identity_mapped" });
  }

  const observedAt = new Date(timestamp);

  if (stateId === 710) {
    const mode = value != null ? Number(value) : NaN;
    if (!Number.isFinite(mode)) {
      return c.json({ ok: true, action: "value_unparseable" });
    }
    if (mode === OPERATION_MODE_CHARGING) {
      // Upsert: insert if no row, update lastObservedAt + lastOperationMode
      // if existing. startedAt sticks across updates so the operator
      // sees the true session start time.
      await db.liveSession.upsert({
        where: { chargingStationId: identity.chargingStationId },
        create: {
          chargingStationId: identity.chargingStationId,
          orgId: identity.orgId,
          ocppIdentityId: identity.id,
          vendorResourceId: chargerId,
          startedAt: observedAt,
          lastObservedAt: observedAt,
          lastOperationMode: mode,
        },
        update: {
          lastObservedAt: observedAt,
          lastOperationMode: mode,
        },
      });
      return c.json({ ok: true, action: "session_active" });
    }
    if (mode === OPERATION_MODE_FINISHED || mode === OPERATION_MODE_DISCONNECTED) {
      // End-of-session: drop the row. Caller should also fire
      // /zaptec-trigger-sync to enrich the closed CDR via /chargehistory.
      const deleted = await db.liveSession
        .delete({ where: { chargingStationId: identity.chargingStationId } })
        .catch(() => null);
      return c.json({
        ok: true,
        action: deleted ? "session_ended" : "no_active_session",
        endedTransition: mode,
      });
    }
    // Other operation modes (Requesting=2, Suspended=6, etc.) -> just
    // bump observation freshness if a row already exists.
    await db.liveSession
      .update({
        where: { chargingStationId: identity.chargingStationId },
        data: { lastObservedAt: observedAt, lastOperationMode: mode },
      })
      .catch(() => null);
    return c.json({ ok: true, action: "mode_observed", mode });
  }

  // Telemetry observations (513 power, 553 session-energy) only land
  // when there's already an active session — silently no-op otherwise.
  if (stateId === 513) {
    const watts = value != null ? Number(value) : NaN;
    if (!Number.isFinite(watts)) return c.json({ ok: true, action: "value_unparseable" });
    await db.liveSession
      .update({
        where: { chargingStationId: identity.chargingStationId },
        data: {
          lastObservedAt: observedAt,
          lastPowerW: Math.round(watts),
        },
      })
      .catch(() => null);
    return c.json({ ok: true, action: "power_updated" });
  }

  if (stateId === 553) {
    // Zaptec reports session energy in kWh; convert to Wh for storage.
    const kwh = value != null ? Number(value) : NaN;
    if (!Number.isFinite(kwh)) return c.json({ ok: true, action: "value_unparseable" });
    await db.liveSession
      .update({
        where: { chargingStationId: identity.chargingStationId },
        data: {
          lastObservedAt: observedAt,
          lastSessionEnergyWh: Math.round(kwh * 1000),
        },
      })
      .catch(() => null);
    return c.json({ ok: true, action: "energy_updated" });
  }

  return c.json({ ok: true, action: "noop" });
});
