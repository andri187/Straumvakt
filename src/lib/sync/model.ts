// Shared contract for installation snapshots and incremental changes (Checkpoint D).
// Used by the server (service.ts) and by BOTH UIs through the client adapter
// (client.ts). It has no I/O and no framework imports.
//
// Two independent axes per installation, so a status update never touches the tree:
//   structure    installations.revision  - bumped by an edit; deltas come from
//                installation_changes (append-only, never pruned)
//   operational  installations.status_version - bumped (under the installation
//                row lock) by a CHANGED device status; deltas come from
//                device_operational_state.seq
// Both counters are serialised by a row lock, so commit order == counter order:
// a reader that has seen N has seen everything below N. No gap, no log scrape.

export const SYNC_SCHEMA = 1;
/** A cursor older than this is not honoured; the client refetches a snapshot. */
export const CURSOR_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_SCOPE_INSTALLATIONS = 50;
export const MAX_CHANGES_PER_INSTALLATION = 1000;
export const MAX_OPERATIONAL_PER_PAGE = 200;

export type Projection = "cpo-admin"; // a driver projection is a separate, later adapter and shares nothing with this one

export type Position = { rev: number; sv: number };
export type Cursor = {
  v: typeof SYNC_SCHEMA;
  /** Hash of the visible installation set + projection at issue time. A different set means a different scope. */
  scope: string;
  at: number;
  pos: Record<string, Position>;
};

export type CircuitView = { id: string; parentId: string | null; displayName: string; ratingAmps: number | null; phaseCount: number | null; sortOrder: number };
export type ChargerView = { id: string; circuitId: string; label: string; chargePointId: string; vendor: string | null; model: string | null; serialNumber: string | null };
export type InstallationView = { id: string; displayName: string; revision: number; mainRatingAmps: number | null; mainPhaseCount: number | null };
export type ConnectorState = { status: string; errorCode: string; reportedAt: string | null };
export type DeviceStateView = { deviceId: string; connectors: Record<string, ConnectorState>; lastReportedAt: string | null; lastReceivedAt: string; seq: number };

export type Structure = { installation: InstallationView; circuits: CircuitView[]; chargers: ChargerView[] };

export type Change =
  | { kind: "structure"; installationId: string; entity: "installation"; id: string; version: number; op: "upsert"; data: InstallationView }
  | { kind: "structure"; installationId: string; entity: "circuit"; id: string; version: number; op: "upsert"; data: CircuitView }
  | { kind: "structure"; installationId: string; entity: "charger"; id: string; version: number; op: "upsert"; data: ChargerView }
  | { kind: "structure"; installationId: string; entity: "circuit" | "charger"; id: string; version: number; op: "remove" }
  | { kind: "operational"; installationId: string; entity: "device_state"; id: string; version: number; op: "upsert"; data: DeviceStateView };

export type SnapshotResponse = {
  schema: typeof SYNC_SCHEMA;
  projection: Projection;
  cursor: string;
  installations: { structure: Structure; devices: DeviceStateView[] }[];
};

/** Lean operational snapshot: device states plus the cursor to continue from, with NO structure. A page that already holds its
 * own structure reads this instead of the full snapshot, so it never re-reads the tree just to look up a status badge. */
export type StatusResponse = {
  schema: typeof SYNC_SCHEMA;
  projection: Projection;
  cursor: string;
  installations: { id: string; devices: DeviceStateView[] }[];
};

/** Answer to a structural check: the current revision per visible installation, how fresh that is, and whether the server
 * declined to look again yet. `deferred` means "this is what was known at `checkedAt`", never "nothing changed". */
export type CheckResponse = {
  schema: typeof SYNC_SCHEMA;
  scope: string;
  revisions: Record<string, number>;
  checkedAt: number;
  /** How old this answer is on the server, so a client on a different clock can still say "checked N s ago". */
  ageMs: number;
  deferred: boolean;
  retryAfterMs: number;
};

export type ResetReason = "scope_changed" | "cursor_expired" | "cursor_invalid" | "too_many_installations";

export type ChangesResponse =
  | { schema: typeof SYNC_SCHEMA; cursor: string; changes: Change[]; hasMore: boolean }
  | { schema: typeof SYNC_SCHEMA; resetRequired: ResetReason };

export function encodeCursor(c: Cursor): string {
  const json = JSON.stringify(c);
  return btoa(json).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeCursor(s: string): Cursor | null {
  try {
    const raw = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
    const c = JSON.parse(raw) as Cursor;
    if (c.v !== SYNC_SCHEMA || typeof c.scope !== "string" || typeof c.at !== "number" || !c.pos || typeof c.pos !== "object") return null;
    for (const p of Object.values(c.pos)) if (!Number.isInteger(p.rev) || !Number.isInteger(p.sv) || p.rev < 0 || p.sv < 0) return null;
    return c;
  } catch {
    return null;
  }
}

export async function scopeHash(projection: Projection, installationIds: readonly string[]): Promise<string> {
  const text = `${projection}|${[...installationIds].sort().join(",")}`;
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(d)].slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("");
}
