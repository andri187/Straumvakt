import type { IncomingCharger } from "./discovery";
import { incomingVisible } from "./incoming-window";

type Knock = Pick<IncomingCharger, "state" | "lastSeenAt" | "socket">;

/**
 * The unregistered rows worth showing at `nowMs`: state "incoming" only (a "recovery" row is a known charger, not a new
 * candidate), and each one either holds a gateway-reported open pending socket or was last recorded inside the visibility
 * window. With `nowMs` null (before the browser clock is read) the window is not applied, so the first client render matches
 * the server's. One definition for the table and for the waiting count, so they cannot disagree.
 */
export function visibleIncoming<T extends Knock>(rows: readonly T[] | null, nowMs: number | null): T[] {
  const incoming = (rows ?? []).filter((r) => r.state === "incoming");
  return nowMs === null ? incoming : incoming.filter((r) => r.socket === true || incomingVisible(Date.parse(r.lastSeenAt), nowMs));
}
