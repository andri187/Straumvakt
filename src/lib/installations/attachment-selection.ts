// Pure rules for choosing several Incoming chargers and assigning them to circuits.
//
// Dependency-free (client components use it). Nothing here registers anything: a selection is a list of OCPP ids the
// operator picked, carried in the URL as untrusted hints. The server's own Incoming list decides which of them are
// real candidates, and registration still happens only through the one installation save.

/** One bulk selection is limited so the URL stays short; 25 also matches the gateway's pending-socket cap. */
export const MAX_BULK_ATTACH = 25;

const CHARGE_POINT_ID = /^[A-Za-z0-9._-]{1,48}$/;
const key = (id: string) => id.toLowerCase();

/** Valid, de-duplicated (case-insensitive), bounded ids from repeated `attach` query values. First spelling wins. */
export function parseAttachParams(values: readonly (string | undefined)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    if (typeof v !== "string" || !CHARGE_POINT_ID.test(v) || seen.has(key(v))) continue;
    seen.add(key(v));
    out.push(v);
    if (out.length >= MAX_BULK_ATTACH) break;
  }
  return out;
}

/**
 * Splits requested ids into those the server still lists as incoming (returned in the server's spelling) and the rest.
 * A requested id is only a hint: nothing outside `candidates` is ever matched.
 */
export function resolveAttach(requested: readonly string[], candidates: readonly { chargePointId: string }[]): { matched: string[]; stale: string[] } {
  const byKey = new Map(candidates.map((c) => [key(c.chargePointId), c.chargePointId]));
  const matched: string[] = [];
  const stale: string[] = [];
  for (const id of requested) {
    const real = byKey.get(key(id));
    if (real) matched.push(real);
    else stale.push(id);
  }
  return { matched, stale };
}

/** `&attach=a&attach=b` (empty when nothing is selected), for links that carry the selection onward. */
export function attachQuery(ids: readonly string[]): string {
  return ids.map((id) => `&attach=${encodeURIComponent(id)}`).join("");
}

/** Same, but as the first query of a path: `?attach=a&attach=b`, or an empty string. */
export function attachSearch(ids: readonly string[]): string {
  const q = attachQuery(ids);
  return q ? `?${q.slice(1)}` : "";
}

/** Keeps only selected ids that are still visible, in visible order. Hidden rows are never silently carried along. */
export function pruneSelection(selected: ReadonlySet<string>, visibleIds: readonly string[]): string[] {
  return visibleIds.filter((id) => selected.has(id)).slice(0, MAX_BULK_ATTACH);
}

/** Toggles one id; adding beyond the bound is refused (returns the same set). */
export function toggleSelected(selected: ReadonlySet<string>, id: string): ReadonlySet<string> {
  const next = new Set(selected);
  if (next.has(id)) next.delete(id);
  else if (next.size < MAX_BULK_ATTACH) next.add(id);
  else return selected;
  return next;
}

/** The ids "select all" would pick: the first MAX_BULK_ATTACH visible ones. */
export function selectAllIds(visibleIds: readonly string[]): ReadonlySet<string> {
  return new Set(visibleIds.slice(0, MAX_BULK_ATTACH));
}

/** Moves one charger row to another circuit. Only `circuitId` changes: id, name, charge point id and metadata are kept. */
export function moveChargerTo<T extends { id: string; circuitId: string }>(rows: readonly T[], chargerId: string, circuitId: string): T[] {
  return rows.map((r) => (r.id === chargerId && r.circuitId !== circuitId ? { ...r, circuitId } : r));
}

/** Pending ids that are not yet on a charger row (compared case-insensitively on the charge point id). */
export function stillUnassigned(pending: readonly string[], chargers: readonly { chargePointId: string }[]): string[] {
  const used = new Set(chargers.map((c) => key(c.chargePointId.trim())));
  return pending.filter((id) => !used.has(key(id)));
}

/** True for a rating the operator has explicitly entered as zero ("0", "00"). Empty (unknown) is not zero. */
export function isZeroRating(value: string): boolean {
  return /^0+$/.test(value.trim());
}
