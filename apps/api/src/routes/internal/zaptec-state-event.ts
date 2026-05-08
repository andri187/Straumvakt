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

    // Sprint 9 / 2026-05-08 — plug / charge / non-charge timers.
    // Lifecycle widened: we now create live_sessions on the FIRST
    // non-Disconnected mode (so plug-in time before charging starts
    // is captured) and maintain cumulative seconds per bucket as
    // mode transitions arrive. Charging (mode 3) -> charging_seconds.
    // Anything else except Disconnected (1) -> non_charging_seconds.

    if (mode === OPERATION_MODE_DISCONNECTED || mode === OPERATION_MODE_FINISHED) {
      // End-of-session. Roll up the final delta from last_mode_at into
      // the bucket of the previous mode, then drop the row. The
      // consumer should also fire /zaptec-trigger-sync to enrich the
      // closed CDR via /chargehistory.
      const existing = await db.liveSession.findUnique({
        where: { chargingStationId: identity.chargingStationId },
        select: {
          lastModeAt: true,
          lastOperationMode: true,
          chargingSeconds: true,
          nonChargingSeconds: true,
        },
      });
      if (!existing) {
        return c.json({ ok: true, action: "no_active_session", endedTransition: mode });
      }
      const delta = computeDeltaSeconds(existing.lastModeAt, observedAt);
      const incCharging = existing.lastOperationMode === OPERATION_MODE_CHARGING ? delta : 0;
      const incNonCharging =
        existing.lastOperationMode != null &&
        existing.lastOperationMode !== OPERATION_MODE_CHARGING &&
        existing.lastOperationMode !== OPERATION_MODE_DISCONNECTED
          ? delta
          : 0;

      // Persist the final tick — operator queries within the same
      // second see the rolled-up totals — then delete.
      await db.liveSession
        .update({
          where: { chargingStationId: identity.chargingStationId },
          data: {
            lastObservedAt: observedAt,
            lastOperationMode: mode,
            lastModeAt: observedAt,
            chargingSeconds: { increment: incCharging },
            nonChargingSeconds: { increment: incNonCharging },
          },
        })
        .catch(() => null);
      const deleted = await db.liveSession
        .delete({ where: { chargingStationId: identity.chargingStationId } })
        .catch(() => null);
      return c.json({
        ok: true,
        action: deleted ? "session_ended" : "no_active_session",
        endedTransition: mode,
        finalChargingSeconds: existing.chargingSeconds + incCharging,
        finalNonChargingSeconds: existing.nonChargingSeconds + incNonCharging,
      });
    }

    // Non-terminal mode (2 = Requesting, 3 = Charging, 6 = Suspended, …).
    // Either create the row (first state event for this charger) or
    // update it, rolling the delta from last_mode_at into the previous
    // mode's bucket if the mode just changed.
    const existing = await db.liveSession.findUnique({
      where: { chargingStationId: identity.chargingStationId },
      select: {
        lastModeAt: true,
        lastOperationMode: true,
        chargingStartedAt: true,
      },
    });

    if (!existing) {
      // First observation for this charger. Establish the row with
      // connected_at set from the observation timestamp; counters at 0.
      await db.liveSession.create({
        data: {
          chargingStationId: identity.chargingStationId,
          orgId: identity.orgId,
          ocppIdentityId: identity.id,
          vendorResourceId: chargerId,
          startedAt: observedAt,
          lastObservedAt: observedAt,
          lastOperationMode: mode,
          connectedAt: observedAt,
          chargingStartedAt: mode === OPERATION_MODE_CHARGING ? observedAt : null,
          lastModeAt: observedAt,
        },
      });
      return c.json({
        ok: true,
        action: mode === OPERATION_MODE_CHARGING ? "session_active" : "plugged_in",
        mode,
      });
    }

    // Existing row — roll forward. Add the time we just spent in the
    // PREVIOUS mode to its bucket.
    const delta = computeDeltaSeconds(existing.lastModeAt, observedAt);
    const incCharging = existing.lastOperationMode === OPERATION_MODE_CHARGING ? delta : 0;
    const incNonCharging =
      existing.lastOperationMode != null &&
      existing.lastOperationMode !== OPERATION_MODE_CHARGING &&
      existing.lastOperationMode !== OPERATION_MODE_DISCONNECTED
        ? delta
        : 0;
    const startedCharging =
      mode === OPERATION_MODE_CHARGING && existing.chargingStartedAt === null;

    await db.liveSession.update({
      where: { chargingStationId: identity.chargingStationId },
      data: {
        lastObservedAt: observedAt,
        lastOperationMode: mode,
        lastModeAt: observedAt,
        ...(startedCharging ? { chargingStartedAt: observedAt } : {}),
        chargingSeconds: { increment: incCharging },
        nonChargingSeconds: { increment: incNonCharging },
      },
    });
    return c.json({
      ok: true,
      action: mode === OPERATION_MODE_CHARGING ? "session_active" : "mode_observed",
      mode,
    });
  }

  // Telemetry observations (513 power, 553 session-energy) only land
  // when there's already an active session — silently no-op otherwise.
  // Each observation also writes a live_session_sample row for charge-
  // log timeline reconstruction.
  if (stateId === 513) {
    const watts = value != null ? Number(value) : NaN;
    if (!Number.isFinite(watts)) return c.json({ ok: true, action: "value_unparseable" });
    const powerW = Math.round(watts);
    await db.liveSession
      .update({
        where: { chargingStationId: identity.chargingStationId },
        data: {
          lastObservedAt: observedAt,
          lastPowerW: powerW,
        },
      })
      .catch(() => null);
    await db.liveSessionSample
      .create({
        data: {
          chargerId: identity.chargingStationId,
          observedAt,
          powerW,
          stateId,
        },
      })
      .catch(() => null);
    return c.json({ ok: true, action: "power_updated" });
  }

  if (stateId === 553) {
    // Zaptec reports session energy in kWh; convert to Wh for storage.
    const kwh = value != null ? Number(value) : NaN;
    if (!Number.isFinite(kwh)) return c.json({ ok: true, action: "value_unparseable" });
    const energyWh = Math.round(kwh * 1000);
    await db.liveSession
      .update({
        where: { chargingStationId: identity.chargingStationId },
        data: {
          lastObservedAt: observedAt,
          lastSessionEnergyWh: energyWh,
        },
      })
      .catch(() => null);
    await db.liveSessionSample
      .create({
        data: {
          chargerId: identity.chargingStationId,
          observedAt,
          energyWh: BigInt(energyWh),
          stateId,
        },
      })
      .catch(() => null);
    return c.json({ ok: true, action: "energy_updated" });
  }

  return c.json({ ok: true, action: "noop" });
});

// Compute integer-seconds delta between two timestamps. Returns 0 on
// missing or backwards / clock-skew cases — defensive, since AMQP
// observations can occasionally arrive out of order or with stale
// timestamps if the consumer just reconnected.
function computeDeltaSeconds(from: Date | null, to: Date): number {
  if (!from) return 0;
  const ms = to.getTime() - from.getTime();
  if (ms <= 0) return 0;
  return Math.floor(ms / 1000);
}
