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
import { parseOcmf, type OcmfParsed } from "../../lib/ocmf";
import { formatMac, lookupOuiVendor } from "../../lib/oui/lookup";
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
  // 710 — ChargerOperationMode (lifecycle + plug/charge/non-charge timers)
  // 513 — TotalChargePower (live power + samples)
  // 553 — TotalChargePowerSession (live energy + samples)
  // 722 — ChargerCurrentUserUuid (real-time driver enrichment)
  // 723 — CompletedSession (full session JSON + OCMF SignedSession at session-end)
  //
  // ADR 0021 Autocharge — Step B additions (vehicle identity capture):
  // 953 — MacPlcModuleEv (link-layer EV PLC modem MAC; the gold signal)
  // 716 — DetectedCar (plug/unplug event)
  // 714 — CableType (Mode 3 / Type 2 / etc.)
  // 921 — PlcPibVersionEV (vehicle's PLC firmware)
  // 724 — PlugAndChargeAuthorizeRequest (PnC attempt)
  // 725 — RejectedUserUuid (PnC denied)
  if (
    stateId !== 710 &&
    stateId !== 513 &&
    stateId !== 553 &&
    stateId !== 722 &&
    stateId !== 723 &&
    stateId !== 953 &&
    stateId !== 716 &&
    stateId !== 714 &&
    stateId !== 921 &&
    stateId !== 724 &&
    stateId !== 725
  ) {
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

  // Sprint 9 / 2026-05-08 — StateId 722 (ChargerCurrentUserUuid).
  // Maps the active driver's Zaptec UUID to a Straumvakt User via
  // identity.user_vendor_refs (vendor_slug='zaptec') and stamps userId
  // on the live_sessions row. Update-only — if no row exists yet, ack
  // and skip (a 722 firing before the first 710!=Disconnected is rare
  // and the next 722 picks up the right state).
  if (stateId === 722) {
    const trimmed = (value ?? "").trim();
    if (!trimmed) {
      // Empty value — Zaptec sometimes blanks 722 on session end. Clear
      // the user_id on the row so downstream views don't keep showing
      // a stale driver after the cable is unplugged.
      await db.liveSession
        .update({
          where: { chargingStationId: identity.chargingStationId },
          data: { userId: null, lastObservedAt: observedAt },
        })
        .catch(() => null);
      return c.json({ ok: true, action: "user_cleared" });
    }
    // Lookup Zaptec UUID -> Straumvakt User. The unique key is
    // (vendor_slug, vendor_user_id).
    const ref = await db.userVendorRef.findUnique({
      where: { vendorSlug_vendorUserId: { vendorSlug: "zaptec", vendorUserId: trimmed } },
      select: { userId: true },
    });
    if (!ref) {
      // Unknown Zaptec user — Straumvakt hasn't seen this driver yet.
      // Surface the action so the operator can spot orphan drivers in
      // logs and onboard them.
      return c.json({ ok: true, action: "user_unknown", zaptecUserUuid: trimmed });
    }
    await db.liveSession
      .update({
        where: { chargingStationId: identity.chargingStationId },
        data: { userId: ref.userId, lastObservedAt: observedAt },
      })
      .catch(() => null);
    return c.json({ ok: true, action: "user_resolved", userId: ref.userId });
  }

  // Sprint 9 / 2026-05-08 — StateId 723 (CompletedSession).
  // Carries the full session JSON with embedded OCMF SignedSession.
  // Find the matching ChargeSession (by chargingStationId + closest
  // started_at to the blob's StartDateTime) and stamp the parsed
  // session metadata onto it. Idempotent — guarded by
  // completed_session_seen_at NOT NULL check on update.
  //
  // Falls back to logging when:
  //   - the value isn't valid JSON
  //   - no matching ChargeSession exists yet (can land via /chargehistory cron later)
  if (stateId === 723) {
    if (!value || typeof value !== "string" || value.trim().length === 0) {
      return c.json({ ok: true, action: "value_unparseable" });
    }
    let blob: Record<string, unknown>;
    try {
      blob = JSON.parse(value) as Record<string, unknown>;
    } catch {
      return c.json({ ok: true, action: "json_parse_failed" });
    }

    const startStr = pickString(blob, ["StartDateTime", "startDateTime"]);
    const endStr = pickString(blob, ["EndDateTime", "endDateTime"]);
    const signedSession = pickString(blob, ["SignedSession", "signedSession"]);
    const externallyEnded = pickBool(blob, ["ExternallyEnded", "externallyEnded"]);
    const externalId = pickString(blob, ["ExternalId", "externalId"]);
    const energyKwh = pickNumber(blob, ["Energy", "energy"]);

    const startedAt = startStr ? new Date(startStr) : null;
    const endedAt = endStr ? new Date(endStr) : null;
    if (!startedAt || Number.isNaN(startedAt.getTime())) {
      return c.json({ ok: true, action: "no_started_at" });
    }

    // Match a ChargeSession on (chargingStationId, ±60s on startedAt).
    // We use the asymmetric +/- because clock skew between Zaptec and
    // our recorded started_at is typically sub-second but defensive.
    const windowMs = 60_000;
    const session = await db.chargeSession.findFirst({
      where: {
        chargingStationId: identity.chargingStationId,
        startedAt: {
          gte: new Date(startedAt.getTime() - windowMs),
          lte: new Date(startedAt.getTime() + windowMs),
        },
      },
      select: { id: true, completedSessionSeenAt: true, energyWh: true, endedAt: true },
      orderBy: { startedAt: "desc" },
    });

    if (!session) {
      // No matching session yet — the /chargehistory cron will create
      // it later, and a follow-up reconciliation step (separate sprint)
      // can replay the 723 blob onto it. For now, ack.
      return c.json({ ok: true, action: "no_matching_session" });
    }

    if (session.completedSessionSeenAt) {
      // Already captured for this session — second 723 firing is rare
      // but defensive idempotency.
      return c.json({ ok: true, action: "already_captured", sessionId: session.id });
    }

    const ocmf: OcmfParsed | null = signedSession ? parseOcmf(signedSession) : null;
    const firstReading = ocmf?.readings[0]?.cumulativeKwh ?? null;
    const lastReading = ocmf?.readings[ocmf.readings.length - 1]?.cumulativeKwh ?? null;
    const computedKwh =
      firstReading !== null && lastReading !== null ? lastReading - firstReading : null;

    await db.chargeSession.update({
      where: { id: session.id },
      data: {
        completedSessionRawJson: blob as unknown as object,
        ocmfSignedSession: signedSession ?? null,
        ocmfFormatVersion: ocmf?.formatVersion ?? null,
        ocmfGatewayId: ocmf?.gatewayId ?? null,
        ocmfGatewaySerial: ocmf?.gatewaySerial ?? null,
        ocmfGatewayVersion: ocmf?.gatewayVersion ?? null,
        authIdStatus: ocmf?.identity?.identified ?? null,
        authIdLevel: ocmf?.identity?.level ?? null,
        authIdType: ocmf?.identity?.idType ?? null,
        authIdValue: ocmf?.identity?.idValue ?? null,
        authIdFlags: ocmf?.identity?.flags ?? [],
        ocmfFirstReadingKwh: firstReading !== null ? firstReading.toString() : null,
        ocmfLastReadingKwh: lastReading !== null ? lastReading.toString() : null,
        ocmfSignedSessionKwh: computedKwh !== null ? computedKwh.toString() : null,
        completedSessionSeenAt: observedAt,
        // ENRICH-1 — AMQP per-source columns. amqpEnergyKwh records the
        // figure the AMQP feed advertised on the 723 blob; ocmfBlobRef
        // mirrors the signed-session blob so an operator can answer
        // "did AMQP land OCMF on this row?" without having to inspect
        // ocmf_signed_session (which both AMQP and OCPP MeterValues
        // populate — first-arrival-wins per ADR 0021). CDR > AMQP in
        // priority per spec, so AMQP does NOT touch verified_source
        // / canonical energy_wh / canonical ended_at.
        ...(energyKwh != null
          ? { amqpEnergyKwh: energyKwh.toFixed(4) }
          : {}),
        ...(signedSession ? { ocmfBlobRef: signedSession } : {}),
        // Backfill endedAt + energyWh from the blob if not already set.
        ...(session.endedAt ? {} : endedAt ? { endedAt } : {}),
        ...(session.energyWh != null
          ? {}
          : energyKwh != null
          ? { energyWh: BigInt(Math.round(energyKwh * 1000)) }
          : {}),
      },
    });

    return c.json({
      ok: true,
      action: "completed_session_captured",
      sessionId: session.id,
      authIdType: ocmf?.identity?.idType ?? null,
      authIdValue: ocmf?.identity?.idValue ?? null,
      externallyEnded: externallyEnded ?? null,
      externalId: externalId ?? null,
      ocmfReadings: ocmf?.readings.length ?? 0,
    });
  }

  // ── ADR 0021 Autocharge — Step B handlers ─────────────────────────
  //
  // These StateIds populate the vehicle-identity columns added in
  // Step A. All resolve the active charging.sessions row via the
  // most-recent in_progress session for this charger. If no session
  // row exists yet (rare race — observation arrived before the OCPP
  // session.started projection ran), we ack and skip; the next
  // observation in the same session window catches us up.

  // Helper: resolve the in-progress charging.sessions row for this charger.
  async function resolveActiveSession(): Promise<{ id: string } | null> {
    return db.chargeSession.findFirst({
      where: {
        chargingStationId: identity!.chargingStationId,
        status: "in_progress",
      },
      orderBy: { startedAt: "desc" },
      select: { id: true },
    });
  }

  // StateId 953 — MacPlcModuleEv. The gold signal: link-layer EV PLC
  // modem MAC, exchanged during HomePlug GreenPHY pairing. Persistent
  // per-vehicle, OUI-prefix → vendor name. Captured regardless of
  // formal PnC success.
  if (stateId === 953) {
    const mac = formatMac(value);
    if (!mac) return c.json({ ok: true, action: "value_unparseable" });
    const oui = lookupOuiVendor(mac);
    const session = await resolveActiveSession();
    console.log("[autocharge] ev_plc_mac_observed", {
      chargingStationId: identity.chargingStationId,
      mac,
      vendor: oui.vendor,
      sessionId: session?.id ?? null,
    });
    if (!session) {
      return c.json({ ok: true, action: "no_active_session", mac, vendor: oui.vendor });
    }
    await db.chargeSession.update({
      where: { id: session.id },
      data: {
        evPlcMac: mac,
        evPlcMacOuiVendor: oui.vendor,
      },
    });
    return c.json({ ok: true, action: "ev_plc_mac_captured", sessionId: session.id, mac, vendor: oui.vendor });
  }

  // StateId 921 — PlcPibVersionEV. The EV-side PLC firmware version.
  // Useful for fleet diagnostics ("all 2024 Tesla M3s on PIB v1.3 are
  // showing X behaviour").
  if (stateId === 921) {
    const session = await resolveActiveSession();
    if (!session) return c.json({ ok: true, action: "no_active_session" });
    await db.chargeSession.update({
      where: { id: session.id },
      data: { evPlcPibVersion: value ?? null },
    });
    return c.json({ ok: true, action: "ev_plc_pib_version_captured", sessionId: session.id, version: value });
  }

  // StateId 714 — CableType. Connector cable identification.
  if (stateId === 714) {
    const session = await resolveActiveSession();
    if (!session) return c.json({ ok: true, action: "no_active_session" });
    await db.chargeSession.update({
      where: { id: session.id },
      data: { cableType: value ?? null },
    });
    return c.json({ ok: true, action: "cable_type_captured", sessionId: session.id, cableType: value });
  }

  // StateId 716 — DetectedCar. Cable plug-in / unplug event. Doesn't
  // populate a session-level field on its own; logged for observability
  // (and we bump live_sessions.lastObservedAt so the operator UI shows
  // the charger as active).
  if (stateId === 716) {
    console.log("[autocharge] detected_car_observed", {
      chargingStationId: identity.chargingStationId,
      value,
    });
    await db.liveSession
      .update({
        where: { chargingStationId: identity.chargingStationId },
        data: { lastObservedAt: observedAt },
      })
      .catch(() => null);
    return c.json({ ok: true, action: "detected_car_observed", value });
  }

  // StateId 724 — PlugAndChargeAuthorizeRequest. Vehicle initiated
  // ISO 15118 PnC. Set the boolean flag on the active session.
  if (stateId === 724) {
    const session = await resolveActiveSession();
    if (!session) return c.json({ ok: true, action: "no_active_session" });
    await db.chargeSession.update({
      where: { id: session.id },
      data: { pncAttempted: true },
    });
    console.log("[autocharge] pnc_attempt", {
      sessionId: session.id,
      chargingStationId: identity.chargingStationId,
    });
    return c.json({ ok: true, action: "pnc_attempted_marked", sessionId: session.id });
  }

  // StateId 725 — RejectedUserUuid. PnC was attempted and rejected.
  // Mark pnc_succeeded=false + capture the rejected UUID for forensics.
  if (stateId === 725) {
    const session = await resolveActiveSession();
    if (!session) return c.json({ ok: true, action: "no_active_session" });
    await db.chargeSession.update({
      where: { id: session.id },
      data: {
        pncSucceeded: false,
        pncRejectedUuid: value ?? null,
      },
    });
    console.log("[autocharge] pnc_rejected", {
      sessionId: session.id,
      chargingStationId: identity.chargingStationId,
      rejectedUuid: value,
    });
    return c.json({ ok: true, action: "pnc_rejected_captured", sessionId: session.id, rejectedUuid: value });
  }

  return c.json({ ok: true, action: "noop" });
});

// Small JSON-blob accessors used by the 723 handler. Tolerant of
// case-variant keys (Zaptec mixes PascalCase and camelCase across
// endpoints); returns null when the value is missing or wrong-typed.
function pickString(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return null;
}

function pickBool(obj: Record<string, unknown>, keys: string[]): boolean | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "boolean") return v;
  }
  return null;
}

function pickNumber(obj: Record<string, unknown>, keys: string[]): number | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return null;
}

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
