// Sprint 9 / 2026-05-08 — full session detail for the standalone
// /charge-log/[sessionId] page. Extends getSessionDetail with:
//
//   - OCMF identity (auth_id_*) — surfaces RFID UID today, vehicle MAC
//     (EVCCID) or PnC contract (EMAID) once Zaptec firmware ships PnC
//   - Full OCMF gateway block (gateway id / serial / firmware / format
//     version) + first/last/computed kWh
//   - AMQP-derived telemetry samples (charging.live_session_samples)
//     joined to this session by chargerId + observation window
//   - Optional raw blobs (completed_session_raw_json, ocmf_signed_session)
//     for an "advanced" accordion
//
// Built for read-only operator inspection. Not used in any write path.

import type { PrismaClient } from "../generated/prisma/client";
import { parseOcmf, deriveIntervals, type PowerInterval } from "../lib/ocmf";

export interface SessionTelemetrySample {
  observedAt: string;
  powerW: number | null;
  energyWh: number | null;
  stateId: number;
}

export interface SessionFullDetail {
  // Header
  sessionId: string;
  orgId: string;
  orgDisplayName: string | null;
  siteId: string | null;
  siteDisplayName: string | null;
  installationId: string | null;
  installationDisplayName: string | null;
  chargingStationId: string | null;
  chargerDisplayName: string | null;
  chargerSerial: string | null;
  chargerVendor: string | null;
  chargerModel: string | null;
  chargerFirmware: string | null;

  // Driver
  driverIdTag: string | null;     // legacy idTag from OCPP / sessions row
  driverUserId: string | null;
  driverDisplayName: string | null;
  driverEmail: string | null;

  // Timing
  startedAt: string;
  endedAt: string | null;
  durationSec: number | null;
  chargeTimeSec: number | null;
  idleTimeSec: number | null;

  // Lifecycle status (enum: active / completed / aborted / ...)
  status: string | null;

  // Energy
  energyKwh: string;                  // string to preserve precision
  totalEnergyWh: string | null;       // raw Wh from session row
  costIskMinor: string | null;        // legacy single-cost (preserved for back-compat)
  costFormatted: string | null;       // legacy formatted
  costExVatMinor: string | null;      // raw ex-VAT, accounting clarity
  costIncVatMinor: string | null;     // raw inc-VAT, accounting clarity
  stopReason: string | null;

  // OCMF identity (the EVCCID / EMAID future-proof slot)
  identity: {
    type: string | null;              // e.g. ISO14443 / EVCCID / EMAID
    typeLabel: string;                // human-readable
    value: string | null;
    level: string | null;             // confidence
    flags: string[];
    status: boolean | null;           // OCMF IS — was it identified
  } | null;

  // OCMF gateway + meter readings
  ocmf: {
    formatVersion: string | null;
    gatewayId: string | null;
    gatewaySerial: string | null;
    gatewayVersion: string | null;
    firstReadingKwh: string | null;
    lastReadingKwh: string | null;
    signedSessionKwh: string | null;
    signedSessionRaw: string | null;  // OCMF| envelope, returned only when ?include=raw
    capturedAt: string | null;        // when 723 fired
    /**
     * How OCMF metadata reached this session.
     *  - "live"        — captured via AMQP StateId 723 in real time (completed_session_raw_json IS NOT NULL)
     *  - "backfilled"  — derived from /chargehistory raw_payload after the fact (the May 8 backfill)
     *  - null          — no OCMF data on this session at all
     */
    provenance: "live" | "backfilled" | null;
  } | null;

  // Power-time intervals derived from OCMF or EnergyDetails
  timeSeriesSource: "ocmf" | "energyDetails" | null;
  intervals: PowerInterval[];

  // AMQP-derived high-fidelity samples
  samples: SessionTelemetrySample[];

  // Raw 723 blob — only when ?include=raw
  rawCompletedSession: object | null;
}

export async function getSessionFullDetail(
  db: PrismaClient,
  sessionId: string,
  opts: { includeRaw?: boolean } = {}
): Promise<SessionFullDetail | null> {
  const session = await db.chargeSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      orgId: true,
      siteId: true,
      chargingStationId: true,
      idTag: true,
      userId: true,
      startedAt: true,
      endedAt: true,
      stopReason: true,
      status: true,
      energyWh: true,
      costExVatMinor: true,
      costIncVatMinor: true,

      // Sprint 9 / 2026-05-08 additions
      completedSessionRawJson: true,
      ocmfSignedSession: true,
      ocmfFormatVersion: true,
      ocmfGatewayId: true,
      ocmfGatewaySerial: true,
      ocmfGatewayVersion: true,
      authIdStatus: true,
      authIdLevel: true,
      authIdType: true,
      authIdValue: true,
      authIdFlags: true,
      ocmfFirstReadingKwh: true,
      ocmfLastReadingKwh: true,
      ocmfSignedSessionKwh: true,
      completedSessionSeenAt: true,

      organization: { select: { displayName: true } },
      site: { select: { displayName: true } },
      user: {
        select: {
          displayName: true,
          firstName: true,
          lastName: true,
          email: true,
        },
      },
    },
  });
  if (!session) return null;

  const [siteAsset, station, ledger, importedRef, samples] = await Promise.all([
    session.chargingStationId
      ? db.siteAsset.findUnique({
          where: { id: session.chargingStationId },
          select: { displayName: true },
        })
      : Promise.resolve(null),
    session.chargingStationId
      ? db.chargingStation.findUnique({
          where: { siteAssetId: session.chargingStationId },
          select: {
            serialNumber: true,
            firmwareVersion: true,
            vendor: true,
            model: true,
            installationId: true,
            installation: { select: { displayName: true } },
          },
        })
      : Promise.resolve(null),
    db.sessionLedger
      .findUnique({
        where: { sessionId: session.id },
        select: {
          driverIdTag: true,
          driverUserId: true,
          durationSec: true,
          energyKwh: true,
          costIskMinor: true,
        },
      })
      .catch(() => null),
    db.importedCdrRef
      .findFirst({
        where: { sessionId: session.id },
        select: { rawPayload: true },
      })
      .catch(() => null),
    // AMQP-derived samples within the session window. Fall back to
    // (startedAt, endedAt ?? now) when endedAt is null (in-progress
    // sessions, though full-detail is mainly used for closed ones).
    session.chargingStationId
      ? db.liveSessionSample.findMany({
          where: {
            chargerId: session.chargingStationId,
            observedAt: {
              gte: session.startedAt,
              lte: session.endedAt ?? new Date(),
            },
          },
          select: { observedAt: true, powerW: true, energyWh: true, stateId: true },
          orderBy: { observedAt: "asc" },
          take: 5000, // hard cap — operator UI; not for analytics
        })
      : Promise.resolve([]),
  ]);

  // Derive intervals (existing logic)
  let intervals: PowerInterval[] = [];
  let timeSeriesSource: SessionFullDetail["timeSeriesSource"] = null;

  // Prefer OCMF from completed-session capture (AMQP path) over the
  // imported chargehistory blob — same content but the AMQP path has it
  // first.
  if (session.ocmfSignedSession) {
    const parsed = parseOcmf(session.ocmfSignedSession);
    if (parsed && parsed.readings.length >= 2) {
      timeSeriesSource = "ocmf";
      intervals = deriveIntervals(parsed.readings);
    }
  }
  if (intervals.length === 0) {
    const raw = importedRef?.rawPayload as Record<string, unknown> | null | undefined;
    if (raw) {
      if (typeof raw["SignedSession"] === "string") {
        const parsed = parseOcmf(raw["SignedSession"] as string);
        if (parsed && parsed.readings.length >= 2) {
          timeSeriesSource = "ocmf";
          intervals = deriveIntervals(parsed.readings);
        }
      }
      if (intervals.length === 0) {
        const ed = raw["EnergyDetails"];
        if (Array.isArray(ed) && ed.length >= 2) {
          timeSeriesSource = "energyDetails";
          intervals = projectEnergyDetails(ed);
        }
      }
    }
  }

  let chargeTimeSec: number | null = null;
  let idleTimeSec: number | null = null;
  if (intervals.length > 0) {
    let charge = 0;
    let idle = 0;
    for (const iv of intervals) {
      if (iv.charging) charge += iv.durationSec;
      else idle += iv.durationSec;
    }
    chargeTimeSec = charge;
    idleTimeSec = idle;
  }

  const energyKwh = ledger?.energyKwh
    ? ledger.energyKwh.toString()
    : session.energyWh
      ? (Number(session.energyWh) / 1000).toFixed(3)
      : "0";

  const costIskMinor =
    ledger?.costIskMinor !== undefined && ledger?.costIskMinor !== null
      ? ledger.costIskMinor
      : session.costIncVatMinor;

  // Driver display
  const driverDisplayName = session.user
    ? [session.user.firstName, session.user.lastName].filter(Boolean).join(" ").trim() ||
      session.user.displayName ||
      null
    : null;

  // Identity block (only when 723 captured something meaningful)
  const hasIdentity =
    session.authIdType !== null ||
    session.authIdValue !== null ||
    session.authIdStatus !== null;

  const identity = hasIdentity
    ? {
        type: session.authIdType,
        typeLabel: identityTypeLabel(session.authIdType),
        value: session.authIdValue,
        level: session.authIdLevel,
        flags: session.authIdFlags ?? [],
        status: session.authIdStatus,
      }
    : null;

  const hasOcmfBlock =
    session.ocmfFormatVersion !== null ||
    session.ocmfGatewayId !== null ||
    session.ocmfFirstReadingKwh !== null;

  const ocmf = hasOcmfBlock
    ? {
        formatVersion: session.ocmfFormatVersion,
        gatewayId: session.ocmfGatewayId,
        gatewaySerial: session.ocmfGatewaySerial,
        gatewayVersion: session.ocmfGatewayVersion,
        firstReadingKwh: session.ocmfFirstReadingKwh?.toString() ?? null,
        lastReadingKwh: session.ocmfLastReadingKwh?.toString() ?? null,
        signedSessionKwh: session.ocmfSignedSessionKwh?.toString() ?? null,
        signedSessionRaw: opts.includeRaw ? session.ocmfSignedSession : null,
        capturedAt: session.completedSessionSeenAt?.toISOString() ?? null,
        // Distinguish live AMQP capture from after-the-fact backfill.
        // Only the AMQP 723 handler writes completedSessionRawJson; the
        // backfill script leaves it NULL. So that field is the
        // unambiguous tell.
        provenance: (session.completedSessionRawJson
          ? "live"
          : "backfilled") as "live" | "backfilled" | null,
      }
    : null;

  return {
    sessionId: session.id,
    orgId: session.orgId,
    orgDisplayName: session.organization?.displayName ?? null,
    siteId: session.siteId,
    siteDisplayName: session.site?.displayName ?? null,
    installationId: station?.installationId ?? null,
    installationDisplayName: station?.installation?.displayName ?? null,
    chargingStationId: session.chargingStationId,
    chargerDisplayName: siteAsset?.displayName ?? null,
    chargerSerial: station?.serialNumber ?? null,
    chargerVendor: station?.vendor ?? null,
    chargerModel: station?.model ?? null,
    chargerFirmware: station?.firmwareVersion ?? null,
    driverIdTag: ledger?.driverIdTag ?? session.idTag,
    driverUserId: ledger?.driverUserId ?? session.userId,
    driverDisplayName,
    driverEmail: session.user?.email ?? null,
    startedAt: session.startedAt.toISOString(),
    endedAt: session.endedAt?.toISOString() ?? null,
    durationSec: ledger?.durationSec ?? null,
    chargeTimeSec,
    idleTimeSec,
    energyKwh,
    totalEnergyWh: session.energyWh ? session.energyWh.toString() : null,
    costIskMinor:
      costIskMinor !== null && costIskMinor !== undefined
        ? costIskMinor.toString()
        : null,
    costFormatted:
      costIskMinor !== null && costIskMinor !== undefined ? formatIsk(costIskMinor) : null,
    costExVatMinor:
      session.costExVatMinor !== null && session.costExVatMinor !== undefined
        ? session.costExVatMinor.toString()
        : null,
    costIncVatMinor:
      session.costIncVatMinor !== null && session.costIncVatMinor !== undefined
        ? session.costIncVatMinor.toString()
        : null,
    status: session.status ?? null,
    stopReason: session.stopReason,
    identity,
    ocmf,
    timeSeriesSource,
    intervals,
    samples: samples.map((s) => ({
      observedAt: s.observedAt.toISOString(),
      powerW: s.powerW,
      energyWh: s.energyWh != null ? Number(s.energyWh) : null,
      stateId: s.stateId,
    })),
    rawCompletedSession:
      opts.includeRaw && session.completedSessionRawJson
        ? (session.completedSessionRawJson as object)
        : null,
  };
}

function identityTypeLabel(type: string | null): string {
  if (!type) return "Unknown";
  const map: Record<string, string> = {
    NONE: "No identification",
    DENIED: "Denied",
    UNDEFINED: "Undefined",
    ISO14443: "RFID card (ISO 14443)",
    ISO15693: "RFID card (ISO 15693)",
    EMAID: "EMAID — Plug & Charge contract",
    EVCCID: "Vehicle MAC (ISO 15118)",
    EVCOID: "EV contract OID",
    ISO7812: "Banking card (ISO 7812)",
    CARD_TXN_NR: "Card transaction number",
    CENTRAL: "Central back-office",
    CENTRAL_1: "Central back-office (1)",
    CENTRAL_2: "Central back-office (2)",
    LOCAL: "Local back-office",
    LOCAL_1: "Local back-office (1)",
    LOCAL_2: "Local back-office (2)",
    PHONE_NUMBER: "Phone number",
    KEY_CODE: "Key code",
  };
  return map[type] ?? type;
}

function projectEnergyDetails(ed: unknown[]): PowerInterval[] {
  // Same as session-detail.ts — Energy is interval-energy per
  // Sprint 9.1.1. Duplicated here to keep this repository self-
  // contained; sharing the helper between the two would invite
  // cross-import drift.
  const out: PowerInterval[] = [];
  let cumulativeKwh = 0;
  let prevTs: number | null = null;
  for (const entry of ed) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const ts = typeof e["Timestamp"] === "string" ? Date.parse(e["Timestamp"] as string) : NaN;
    const energy = typeof e["Energy"] === "number" ? (e["Energy"] as number) : NaN;
    if (!Number.isFinite(ts) || !Number.isFinite(energy)) continue;
    if (prevTs === null) {
      prevTs = ts;
      continue;
    }
    const durationMs = Math.max(0, ts - prevTs);
    const durationSec = Math.round(durationMs / 1000);
    const hours = durationMs / 3_600_000;
    const avgPowerKw = hours > 0 ? energy / hours : 0;
    cumulativeKwh += Math.max(0, energy);
    out.push({
      timestamp: new Date(ts).toISOString(),
      durationSec,
      avgPowerKw: Number(avgPowerKw.toFixed(3)),
      cumulativeKwh: Number(cumulativeKwh.toFixed(3)),
      charging: energy > 0.001,
    });
    prevTs = ts;
  }
  return out;
}

function formatIsk(minor: bigint | number): string {
  const n = typeof minor === "bigint" ? Number(minor) : minor;
  const major = n / 100;
  return `${major.toLocaleString("is-IS", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kr`;
}
