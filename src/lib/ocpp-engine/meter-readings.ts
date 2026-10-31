// Shared pure normalization; no database or authorization dependencies.
import type { Payload } from './protocol';

export type ReadingRow = { sampledAt: Date; energyWh: number | null; powerW: number | null; other: Record<string, unknown> };

const ENERGY = "Energy.Active.Import.Register";
const POWER = "Power.Active.Import";

function num(v: string): number | null {
  if (!/^-?\d+(\.\d+)?$/.test(v)) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Wh as an integer; null if the value or unit cannot be trusted. kWh is converted, never guessed for other units. */
function toWh(value: string, unit: string | undefined): number | null {
  const n = num(value);
  if (n === null || n < 0) return null;
  const u = unit ?? "Wh"; // 1.6 default unit for this measurand is Wh
  if (u === "Wh") return Number.isSafeInteger(Math.round(n)) ? Math.round(n) : null;
  if (u === "kWh") return Math.round(n * 1000);
  return null;
}

function toW(value: string, unit: string | undefined): number | null {
  const n = num(value);
  if (n === null) return null;
  const u = unit ?? "W";
  if (u === "W") return Math.round(n);
  if (u === "kW") return Math.round(n * 1000);
  return null;
}

export function readingsFrom(payload: Payload<"MeterValues">): ReadingRow[] {
  return payload.meterValue.map((mv) => {
    let energyWh: number | null = null;
    let powerW: number | null = null;
    const other: Record<string, unknown> = {};
    for (const sv of mv.sampledValue) {
      const measurand = sv.measurand ?? ENERGY; // 1.6 default measurand
      const noPhase = sv.phase === undefined;
      if (measurand === ENERGY && noPhase && (sv.location ?? "Outlet") === "Outlet") {
        const wh = toWh(sv.value, sv.unit);
        if (wh !== null) {
          energyWh = wh;
          continue;
        }
      } else if (measurand === POWER && noPhase) {
        const w = toW(sv.value, sv.unit);
        if (w !== null) {
          powerW = w;
          continue;
        }
      }
      const key = `${measurand}${sv.phase ? `.${sv.phase}` : ""}`;
      other[key] = { value: sv.value, ...(sv.unit ? { unit: sv.unit } : {}), ...(sv.context ? { context: sv.context } : {}) };
    }
    return { sampledAt: new Date(mv.timestamp), energyWh, powerW, other };
  });
}

