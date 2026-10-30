// Operational status from StatusNotification (Checkpoints B/D).
//
// Only a CHANGED connector state is written. A repeat of the same status/error
// costs no write and no counter bump, so an idle or chatty-but-unchanging fleet
// generates no database traffic and no delta. An update that is OLDER than what
// we hold (by the charger's own timestamp) never regresses state. Where the
// charger sends no timestamp, arrival order decides, which is the best the
// protocol offers and is stated as such.

import type { ConnectionContext } from "./admission";
import type { TransactionStore } from "./transactions";

export type ConnectorSnapshot = { status: string; errorCode: string; reportedAt: string | null };
export type ConnectorMap = Record<string, ConnectorSnapshot>;

export function mergeConnector(
  prev: ConnectorMap,
  connectorNo: number,
  incoming: { status: string; errorCode: string; reportedAt: Date | null },
): { changed: boolean; next: ConnectorMap } {
  const key = String(connectorNo);
  const held = prev[key];
  const reportedAt = incoming.reportedAt ? incoming.reportedAt.toISOString() : null;
  if (held?.reportedAt && reportedAt && Date.parse(reportedAt) < Date.parse(held.reportedAt)) return { changed: false, next: prev }; // older than held
  if (held && held.status === incoming.status && held.errorCode === incoming.errorCode) return { changed: false, next: prev }; // nothing new
  return { changed: true, next: { ...prev, [key]: { status: incoming.status, errorCode: incoming.errorCode, reportedAt } } };
}

export async function handleStatus(
  env: { store: TransactionStore },
  r: { ctx: ConnectionContext; connectorId: number; status: string; errorCode: string; timestamp?: string; receivedAt: Date },
): Promise<{ kind: "applied"; seq: number } | { kind: "unchanged" } | { kind: "unavailable" }> {
  try {
    const out = await env.store.run((tx) =>
      tx.applyStatus({ ctx: r.ctx, connectorNo: r.connectorId, status: r.status, errorCode: r.errorCode, reportedAt: r.timestamp ? new Date(r.timestamp) : null, receivedAt: r.receivedAt }),
    );
    return out.applied ? { kind: "applied", seq: out.seq } : { kind: "unchanged" };
  } catch {
    return { kind: "unavailable" };
  }
}
