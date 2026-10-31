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

import { readingsFrom } from './meter-readings';
export { readingsFrom, type ReadingRow } from './meter-readings';

export type MeterOutcome = { kind: "applied"; inserted: number } | { kind: "ignored_no_transaction" } | { kind: "quarantined"; reason: string } | { kind: "unavailable" };
export type MeterRequest = { ctx: ConnectionContext; payload: Payload<"MeterValues">; receivedAt: Date; requestHash: string; messageId: string };

export async function handleMeterValues(
  env: { store: TransactionStore },
  r: MeterRequest,
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
