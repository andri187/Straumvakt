// MeterValues handling (Checkpoint B).
//
// MeterValues does not gate any reply, so it rides the queue/outbox path and is
// applied idempotently here. Only what billing and operations need becomes a
// column: the active-energy import register and active power. Every other
// sampled value is kept verbatim in `other` (bounded), so nothing a charger
// reported is silently dropped, but no per-measurand row explosion either.
//
// A reading is attached to a transaction only through its transaction id and
// only if that transaction belongs to the SAME permanent device. Anything else
// is quarantined, not guessed.

import type { ConnectionContext } from "./admission";
import type { Payload } from "./protocol";
import type { TransactionStore } from "./transactions";

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

export type MeterOutcome = { kind: "applied"; inserted: number } | { kind: "ignored_no_transaction" } | { kind: "quarantined"; reason: string } | { kind: "unavailable" };

export async function handleMeterValues(
  env: { store: TransactionStore },
  r: { ctx: ConnectionContext; payload: Payload<"MeterValues">; receivedAt: Date; requestHash: string; messageId: string },
): Promise<MeterOutcome> {
  // Clock-aligned samples outside a transaction are operational telemetry, not billing evidence.
  if (r.payload.transactionId === undefined) return { kind: "ignored_no_transaction" };
  const rows = readingsFrom(r.payload);
  try {
    return await env.store.run(async (tx) => {
      const row = await tx.byNumber(r.payload.transactionId!);
      if (!row || row.deviceId !== r.ctx.deviceId) {
        const rec = await tx.receipt({ ctx: r.ctx, action: "MeterValues", messageId: r.messageId, requestHash: r.requestHash, payload: r.payload, receivedAt: r.receivedAt });
        if (rec.created) await tx.quarantine({ ctx: r.ctx, receiptId: rec.id, reason: row ? "meter_for_other_device" : "meter_unknown_transaction", transactionNo: r.payload.transactionId!, receivedAt: r.receivedAt });
        return { kind: "quarantined", reason: row ? "meter_for_other_device" : "meter_unknown_transaction" } as const;
      }
      const inserted = await tx.upsertReadings(row.id, rows, r.receivedAt);
      return { kind: "applied", inserted } as const;
    });
  } catch {
    return { kind: "unavailable" };
  }
}
