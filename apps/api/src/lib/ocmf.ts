// Minimal OCMF parser for the ChargingStation Reading Data array
// (RD[]). Sprint 8.16 — extracts timestamped meter readings from
// Zaptec's SignedSession blob so the operator console can render
// per-session power + cumulative-energy charts without depending
// on EnergyDetails (which only populates with DetailLevel=1).
//
// OCMF format (from SAFE-eV/OCMF-Open-Charge-Metering-Format spec):
//
//   OCMF|<json envelope>|<json signature>
//
// We only care about the envelope — the signature half is for
// cryptographic audit, not visualisation. The envelope JSON
// contains an `RD` array of reading entries:
//
//   { TM: "2026-05-05T08:27:29,250+00:00 R",  // comma decimal, " R" suffix
//     TX: "B" | "T" | "E",                    // Begin / Tick / End
//     RV: "18904.036",                        // cumulative meter (string)
//     RI: "1-0:1.8.0",                        // OBIS code
//     RU: "kWh",
//     RT: "AC",
//     ST: "G" }                               // status: G=good
//
// Parser is permissive: malformed blobs return null, missing fields
// are tolerated, individual bad readings are skipped (no exceptions).

export interface OcmfReading {
  /** ISO-8601 timestamp normalised (comma → period, " R" stripped). */
  timestamp: string;
  /** Begin / Tick / End / unknown. */
  phase: "begin" | "tick" | "end" | "unknown";
  /** Cumulative meter reading at this timestamp (kWh). */
  cumulativeKwh: number;
  /** Reading status flag, "G" = good. */
  statusOk: boolean;
}

export interface OcmfParsed {
  /** Format version, e.g. "1.0". */
  formatVersion: string | null;
  /** Gateway identifier (vendor + model). */
  gatewayId: string | null;
  /** Gateway serial — matches DeviceId. */
  gatewaySerial: string | null;
  /** Firmware string, e.g. "3.3.5.1". */
  gatewayVersion: string | null;
  /** Reading data, ordered as in source. */
  readings: OcmfReading[];
}

export function parseOcmf(blob: string | null | undefined): OcmfParsed | null {
  if (!blob || typeof blob !== "string") return null;
  if (!blob.startsWith("OCMF|")) return null;

  const tail = blob.slice("OCMF|".length);
  // Envelope is everything up to the next pipe (signature) — but
  // the JSON itself contains no pipes, so split on first "|" if
  // present.
  const envelopeRaw = tail.includes("|") ? tail.slice(0, tail.indexOf("|")) : tail;

  let env: Record<string, unknown>;
  try {
    env = JSON.parse(envelopeRaw) as Record<string, unknown>;
  } catch {
    return null;
  }

  const rd = env["RD"];
  if (!Array.isArray(rd)) {
    return {
      formatVersion: typeof env["FV"] === "string" ? (env["FV"] as string) : null,
      gatewayId: typeof env["GI"] === "string" ? (env["GI"] as string) : null,
      gatewaySerial: typeof env["GS"] === "string" ? (env["GS"] as string) : null,
      gatewayVersion: typeof env["GV"] === "string" ? (env["GV"] as string) : null,
      readings: [],
    };
  }

  const readings: OcmfReading[] = [];
  for (const entry of rd) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const tmRaw = e["TM"];
    const rvRaw = e["RV"];
    if (typeof tmRaw !== "string" || (typeof rvRaw !== "string" && typeof rvRaw !== "number")) {
      continue;
    }
    const timestamp = normaliseOcmfTimestamp(tmRaw);
    const value = typeof rvRaw === "number" ? rvRaw : parseFloat(rvRaw);
    if (!Number.isFinite(value)) continue;

    const tx = typeof e["TX"] === "string" ? (e["TX"] as string) : "";
    const phase: OcmfReading["phase"] =
      tx === "B" ? "begin" : tx === "T" ? "tick" : tx === "E" ? "end" : "unknown";
    const status = typeof e["ST"] === "string" ? (e["ST"] as string) : "";
    readings.push({
      timestamp,
      phase,
      cumulativeKwh: value,
      statusOk: status === "G",
    });
  }

  return {
    formatVersion: typeof env["FV"] === "string" ? (env["FV"] as string) : null,
    gatewayId: typeof env["GI"] === "string" ? (env["GI"] as string) : null,
    gatewaySerial: typeof env["GS"] === "string" ? (env["GS"] as string) : null,
    gatewayVersion: typeof env["GV"] === "string" ? (env["GV"] as string) : null,
    readings,
  };
}

/**
 * Normalise OCMF timestamp ("2026-05-05T08:27:29,250+00:00 R") to
 * a standard ISO-8601 string ("2026-05-05T08:27:29.250+00:00").
 *   • Comma decimal → period
 *   • Strip trailing " R" / " S" / " I" (the "regional time" /
 *     "synchronised" / "informative" status flag)
 */
function normaliseOcmfTimestamp(tm: string): string {
  let out = tm.trim();
  // Strip any single-letter status suffix (e.g. " R")
  out = out.replace(/\s+[A-Z]$/, "");
  // Comma decimal → period (only the millisecond separator)
  out = out.replace(/,(\d{3})/, ".$1");
  return out;
}

/**
 * Project the OCMF readings into per-interval power + cumulative
 * energy. Each interval i represents charging activity from
 * readings[i-1] to readings[i].
 *
 *   • avgPowerKw = (delta kWh) / (delta hours)
 *   • cumulativeKwh = total kWh delivered since the Begin reading
 */
export interface PowerInterval {
  /** ISO-8601 of the interval END. The bar at this position
   *  represents activity DURING the preceding interval. */
  timestamp: string;
  /** Interval duration in seconds. */
  durationSec: number;
  /** Average power across the interval (kW). */
  avgPowerKw: number;
  /** Cumulative session-energy at this point (kWh). */
  cumulativeKwh: number;
  /** True when energy was incrementing (charging) — vs flat (idle). */
  charging: boolean;
}

export function deriveIntervals(readings: OcmfReading[]): PowerInterval[] {
  if (readings.length < 2) return [];
  const t0 = new Date(readings[0]!.timestamp).getTime();
  const e0 = readings[0]!.cumulativeKwh;
  const out: PowerInterval[] = [];
  for (let i = 1; i < readings.length; i++) {
    const prev = readings[i - 1]!;
    const cur = readings[i]!;
    const tPrev = new Date(prev.timestamp).getTime();
    const tCur = new Date(cur.timestamp).getTime();
    const durationMs = Math.max(0, tCur - tPrev);
    const durationSec = Math.round(durationMs / 1000);
    const deltaKwh = Math.max(0, cur.cumulativeKwh - prev.cumulativeKwh);
    const hours = durationMs / 3_600_000;
    const avgPowerKw = hours > 0 ? deltaKwh / hours : 0;
    out.push({
      timestamp: cur.timestamp,
      durationSec,
      avgPowerKw: Number(avgPowerKw.toFixed(3)),
      cumulativeKwh: Number((cur.cumulativeKwh - e0).toFixed(3)),
      charging: deltaKwh > 0.001,
    });
  }
  return out;
}
