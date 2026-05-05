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

  // Derive time series. Prefer the structured EnergyDetails (clean,
  // post-DetailLevel=1). Fall back to OCMF parsing of SignedSession
  // (older imports) so existing rows visualise the same way.
  let intervals: PowerInterval[] = [];
  let timeSeriesSource: SessionDetail["timeSeriesSource"] = null;

  const raw = importedRef?.rawPayload as Record<string, unknown> | null | undefined;
  if (raw) {
    const ed = raw["EnergyDetails"];
    if (Array.isArray(ed) && ed.length >= 2) {
      timeSeriesSource = "energyDetails";
      intervals = projectEnergyDetails(ed);
    } else if (typeof raw["SignedSession"] === "string") {
      const parsed = parseOcmf(raw["SignedSession"] as string);
      if (parsed && parsed.readings.length >= 2) {
        timeSeriesSource = "ocmf";
        intervals = deriveIntervals(parsed.readings);
      }
    }
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
    driverAvailable: Boolean(ledger?.driverIdTag ?? session.idTag),
  };
}

function projectEnergyDetails(
  ed: unknown[],
): PowerInterval[] {
  // EnergyDetails per Zaptec swagger:
  //   [{ Timestamp: ISO, Energy: number }]
  // Energy here is the cumulative kWh per Zaptec's docs.
  const points: { t: number; energy: number }[] = [];
  for (const e of ed) {
    if (!e || typeof e !== "object") continue;
    const obj = e as Record<string, unknown>;
    const ts = obj["Timestamp"] ?? obj["timestamp"];
    const en = obj["Energy"] ?? obj["energy"];
    if (typeof ts !== "string") continue;
    if (typeof en !== "number") continue;
    const t = Date.parse(ts);
    if (!Number.isFinite(t)) continue;
    points.push({ t, energy: en });
  }
  if (points.length < 2) return [];
  const e0 = points[0]!.energy;
  const out: PowerInterval[] = [];
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]!;
    const cur = points[i]!;
    const durationMs = Math.max(0, cur.t - prev.t);
    const hours = durationMs / 3_600_000;
    const deltaKwh = Math.max(0, cur.energy - prev.energy);
    const avgPowerKw = hours > 0 ? deltaKwh / hours : 0;
    out.push({
      timestamp: new Date(cur.t).toISOString(),
      durationSec: Math.round(durationMs / 1000),
      avgPowerKw: Number(avgPowerKw.toFixed(3)),
      cumulativeKwh: Number((cur.energy - e0).toFixed(3)),
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
