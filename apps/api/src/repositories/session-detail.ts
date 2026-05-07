// Per-session detail read for /charge-log session-detail modal.
// Sprint 8.16. Pulls the ChargeSession row + its session_ledger
// totals + parsed OCMF time-series. Read-only; no auth scoping
// here — caller (the route) checks permission.

import type { PrismaClient } from "../generated/prisma/client";
import { parseOcmf, deriveIntervals, type PowerInterval } from "../lib/ocmf";

export interface SessionDetail {
  sessionId: string;
  orgId: string;
  orgDisplayName: string | null;
  siteId: string | null;
  siteDisplayName: string | null;
  chargingStationId: string | null;
  chargerDisplayName: string | null;
  chargerSerial: string | null;
  chargerFirmware: string | null;
  driverIdTag: string | null;
  driverUserId: string | null;
  startedAt: string;
  endedAt: string | null;
  durationSec: number | null;
  energyKwh: string;
  costIskMinor: string | null;
  costFormatted: string | null;
  stopReason: string | null;
  /** Source of the time-series: "ocmf" when parsed from
   *  SignedSession, "energyDetails" when from the structured
   *  EnergyDetails array (DetailLevel=1), null when neither is
   *  available for this session. */
  timeSeriesSource: "ocmf" | "energyDetails" | null;
  /** Derived per-interval power + cumulative-energy points.
   *  Empty when timeSeriesSource is null. */
  intervals: PowerInterval[];
  /** Sprint 9.2 — split of plug time into charging vs idle. Both
   *  derived by summing per-interval durations from `intervals`
   *  (charging=true vs charging=false). Null when intervals is empty
   *  (no per-interval data available; only plug time is known).
   *  The two should sum to durationSec when both are non-null. */
  chargeTimeSec: number | null;
  idleTimeSec: number | null;
  /** Anonymous markers for caller awareness — Native auth at
   *  Dalvegur means we never see a driver here regardless of
   *  channel. */
  driverAvailable: boolean;
}

export async function getSessionDetail(
  db: PrismaClient,
  sessionId: string,
): Promise<SessionDetail | null> {
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
      energyWh: true,
      costExVatMinor: true,
      costIncVatMinor: true,
      organization: { select: { displayName: true } },
      site: { select: { displayName: true } },
    },
  });
  if (!session) return null;

  const [siteAsset, station, ledger, importedRef] = await Promise.all([
    session.chargingStationId
      ? db.siteAsset.findUnique({
          where: { id: session.chargingStationId },
          select: { displayName: true },
        })
      : Promise.resolve(null),
    session.chargingStationId
      ? db.chargingStation.findUnique({
          where: { siteAssetId: session.chargingStationId },
          select: { serialNumber: true, firmwareVersion: true },
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
  ]);

  // Derive time series. Sprint 9.1.1 — prefer OCMF SignedSession over
  // EnergyDetails: OCMF.RV is unambiguously cumulative meter readings
  // (signed, defined in the OCMF spec); EnergyDetails.Energy is
  // interval-energy and was previously misinterpreted as cumulative.
  // Both projectEnergyDetails and deriveIntervals now produce the
  // same PowerInterval shape with cumulativeKwh session-relative.
  let intervals: PowerInterval[] = [];
  let timeSeriesSource: SessionDetail["timeSeriesSource"] = null;

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

  // Sprint 9.2 — split plug time into charging vs idle by summing
  // per-interval durations. Plug time = endedAt - startedAt; charge
  // time = sum where deltaKwh > threshold; idle = remainder.
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

  return {
    sessionId: session.id,
    orgId: session.orgId,
    orgDisplayName: session.organization?.displayName ?? null,
    siteId: session.siteId,
    siteDisplayName: session.site?.displayName ?? null,
    chargingStationId: session.chargingStationId,
    chargerDisplayName: siteAsset?.displayName ?? null,
    chargerSerial: station?.serialNumber ?? null,
    chargerFirmware: station?.firmwareVersion ?? null,
    driverIdTag: ledger?.driverIdTag ?? session.idTag,
    driverUserId: ledger?.driverUserId ?? session.userId,
    startedAt: session.startedAt.toISOString(),
    endedAt: session.endedAt?.toISOString() ?? null,
    durationSec: ledger?.durationSec ?? null,
    energyKwh,
    costIskMinor: costIskMinor !== null && costIskMinor !== undefined ? costIskMinor.toString() : null,
    costFormatted:
      costIskMinor !== null && costIskMinor !== undefined
        ? formatIsk(costIskMinor)
        : null,
    stopReason: session.stopReason,
    timeSeriesSource,
    intervals,
    chargeTimeSec,
    idleTimeSec,
    driverAvailable: Boolean(ledger?.driverIdTag ?? session.idTag),
  };
}

function projectEnergyDetails(
  ed: unknown[],
): PowerInterval[] {
  // EnergyDetails per Zaptec /api/chargehistory DetailLevel=1:
  //   [{ Timestamp: ISO, Energy: number }]
  //
  // Sprint 9.1.1 — Energy is INTERVAL energy (kWh delivered since the
  // previous Timestamp), NOT cumulative — earlier comment was wrong.
  // Confirmed empirically against staging session 05b1a205-3b08-... :
  //   • Values decrease from 1.012 -> 0.957 -> 0.954, which is
  //     impossible for a monotonically-rising cumulative meter.
  //   • Sum of all Energy entries equals the session total
  //     (Energy / Energy field on the CDR itself) = 12.130 kWh.
  // OCMF SignedSession.RD[].RV is the true cumulative source if present;
  // see deriveIntervals in lib/ocmf.ts.
  const points: { t: number; intervalKwh: number }[] = [];
  for (const e of ed) {
    if (!e || typeof e !== "object") continue;
    const obj = e as Record<string, unknown>;
    const ts = obj["Timestamp"] ?? obj["timestamp"];
    const en = obj["Energy"] ?? obj["energy"];
    if (typeof ts !== "string") continue;
    if (typeof en !== "number") continue;
    const t = Date.parse(ts);
    if (!Number.isFinite(t)) continue;
    points.push({ t, intervalKwh: en });
  }
  if (points.length < 2) return [];
  const out: PowerInterval[] = [];
  let cumulative = 0;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]!;
    const cur = points[i]!;
    const durationMs = Math.max(0, cur.t - prev.t);
    const hours = durationMs / 3_600_000;
    // cur.intervalKwh is energy delivered between prev.t and cur.t.
    const deltaKwh = Math.max(0, cur.intervalKwh);
    cumulative += deltaKwh;
    const avgPowerKw = hours > 0 ? deltaKwh / hours : 0;
    out.push({
      timestamp: new Date(cur.t).toISOString(),
      durationSec: Math.round(durationMs / 1000),
      avgPowerKw: Number(avgPowerKw.toFixed(3)),
      cumulativeKwh: Number(cumulative.toFixed(3)),
      charging: deltaKwh > 0.001,
    });
  }
  return out;
}

function formatIsk(minor: bigint | number | string): string {
  const n = typeof minor === "bigint" ? Number(minor) : Number(minor);
  return `${(n / 100).toLocaleString("is-IS", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} kr`;
}
