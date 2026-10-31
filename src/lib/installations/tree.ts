import type { InstallationListRow } from "./drizzle-store";

/** Overview rows grouped by the stable site id (never the display name), in the order the list returned them. */
export type SiteGroup = { siteId: string; siteName: string; orgId: string; orgName: string; installations: InstallationListRow[] };

export function groupSites(rows: InstallationListRow[]): SiteGroup[] {
  const groups = new Map<string, SiteGroup>();
  for (const r of rows) {
    const g = groups.get(r.siteId);
    if (g) g.installations.push(r);
    else groups.set(r.siteId, { siteId: r.siteId, siteName: r.siteName, orgId: r.orgId, orgName: r.orgName, installations: [r] });
  }
  return [...groups.values()];
}

type TreeCircuit = { id: string; parentId: string | null };
type TreeCharger = { circuitId: string };
export type CircuitNode<C extends TreeCircuit, H extends TreeCharger> = { circuit: C; children: CircuitNode<C, H>[]; chargers: H[] };

/**
 * Nests circuits by their real parent. A circuit whose parent is absent from the snapshot becomes a root rather than
 * disappearing, and a parent cycle is cut so rendering always terminates. Chargers whose circuit is not in the snapshot
 * are returned separately instead of being assigned to an invented one.
 */
export function buildCircuitTree<C extends TreeCircuit, H extends TreeCharger>(circuits: C[], chargers: H[]): { roots: CircuitNode<C, H>[]; unplaced: H[] } {
  const nodes = new Map(circuits.map((c) => [c.id, { circuit: c, children: [] as CircuitNode<C, H>[], chargers: [] as H[] }]));
  const cyclic = (id: string): boolean => {
    const seen = new Set<string>();
    for (let cur: string | null = id; cur; cur = nodes.get(cur)?.circuit.parentId ?? null) {
      if (seen.has(cur)) return true;
      seen.add(cur);
    }
    return false;
  };
  const roots: CircuitNode<C, H>[] = [];
  for (const n of nodes.values()) {
    const parent = n.circuit.parentId ? nodes.get(n.circuit.parentId) : undefined;
    if (parent && parent !== n && !cyclic(n.circuit.id)) parent.children.push(n);
    else roots.push(n);
  }
  const unplaced: H[] = [];
  for (const h of chargers) {
    const n = nodes.get(h.circuitId);
    if (n) n.chargers.push(h);
    else unplaced.push(h);
  }
  return { roots, unplaced };
}

export function countCircuitChargers<C extends TreeCircuit, H extends TreeCharger>(n: CircuitNode<C, H>): number {
  return n.chargers.length + n.children.reduce((a, c) => a + countCircuitChargers(c), 0);
}

// ── Detail loading ─────────────────────────────────────────────────────────

export type DetailView = {
  installation: { id: string; mainRatingAmps: number | null; mainPhaseCount: number | null; mainGridType: "TN" | "IT" | null };
  circuits: { id: string; parentId: string | null; displayName: string; ratingAmps: number | null; phaseCount: number | null }[];
  chargers: { id: string; circuitId: string; label: string; chargePointId: string; vendor: string | null; model: string | null }[];
};
export type DetailState =
  | { status: "loading" }
  | { status: "ready"; view: DetailView }
  /** denied = 401/403 (lost access, not an empty installation); gone = 404; failed = anything else. */
  | { status: "error"; kind: "denied" | "gone" | "failed" };

/**
 * View-local cache of installation details read through the existing GET /api/cpo/installations?id=… endpoint.
 * One in-flight request per installation, results reused until clear(), failures kept until an explicit retry().
 * Nothing here polls, persists, or fetches on its own: load() is only called for an explicit expansion.
 */
export function createDetailLoader(fetchImpl: typeof fetch, onChange: () => void) {
  const states = new Map<string, DetailState>();
  let disposed = false;
  const set = (id: string, s: DetailState) => {
    if (disposed) return;
    states.set(id, s);
    onChange();
  };
  async function run(id: string) {
    set(id, { status: "loading" });
    try {
      const res = await fetchImpl(`/api/cpo/installations?id=${encodeURIComponent(id)}`, { credentials: "same-origin", headers: { accept: "application/json" } });
      if (res.status === 401 || res.status === 403) return set(id, { status: "error", kind: "denied" });
      if (res.status === 404) return set(id, { status: "error", kind: "gone" });
      if (!res.ok) return set(id, { status: "error", kind: "failed" });
      const view = (await res.json()) as DetailView;
      if (!view || !Array.isArray(view.circuits) || !Array.isArray(view.chargers) || !view.installation) return set(id, { status: "error", kind: "failed" });
      set(id, { status: "ready", view });
    } catch {
      set(id, { status: "error", kind: "failed" });
    }
  }
  return {
    get: (id: string) => states.get(id),
    /** Reads only when nothing is loading, loaded or failed for this installation. */
    load(id: string) {
      if (!states.has(id)) void run(id);
    },
    /** The explicit Retry control: the only way a failed read is attempted again. */
    retry(id: string) {
      if (states.get(id)?.status === "error") void run(id);
    },
    clear() {
      states.clear();
    },
    dispose() {
      disposed = true;
      states.clear();
    },
  };
}
