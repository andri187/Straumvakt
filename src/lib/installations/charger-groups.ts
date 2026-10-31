// Groups the registered-charger list for display: installation, then circuit. Grouping is by stable id, never by name, so
// two circuits that share a name stay separate. A charger with no circuit gets its own truthful group. Pure and
// database-free; it only arranges rows the page already read (the query caps the list, so counts are of rows shown).

export type GroupableCharger = { installationId: string; installationName: string; circuitId: string | null; circuitName: string | null };

export type ChargerGroup<T extends GroupableCharger> = {
  installationId: string;
  installationName: string;
  circuits: { circuitId: string | null; circuitName: string | null; chargers: T[] }[];
  count: number;
};

export function groupChargers<T extends GroupableCharger>(rows: readonly T[]): ChargerGroup<T>[] {
  const out: ChargerGroup<T>[] = [];
  const byInstallation = new Map<string, ChargerGroup<T>>();
  for (const r of rows) {
    let g = byInstallation.get(r.installationId);
    if (!g) {
      g = { installationId: r.installationId, installationName: r.installationName, circuits: [], count: 0 };
      byInstallation.set(r.installationId, g);
      out.push(g);
    }
    let c = g.circuits.find((x) => x.circuitId === r.circuitId);
    if (!c) {
      c = { circuitId: r.circuitId, circuitName: r.circuitName, chargers: [] };
      g.circuits.push(c);
    }
    c.chargers.push(r);
    g.count++;
  }
  // Unassigned (no circuit) last within an installation; otherwise the order the rows arrived in.
  for (const g of out) g.circuits.sort((a, b) => Number(a.circuitId === null) - Number(b.circuitId === null));
  return out;
}
