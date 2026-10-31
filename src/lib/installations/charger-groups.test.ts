import { describe, expect, it } from "vitest";
import { groupChargers } from "./charger-groups";

const row = (installationId: string, circuitId: string | null, label: string, circuitName: string | null = circuitId ? "Circuit" : null) => ({ installationId, installationName: `Inst ${installationId}`, circuitId, circuitName, label });

describe("grouping registered chargers", () => {
  it("groups by installation id then circuit id; same-named circuits with different ids stay separate", () => {
    const g = groupChargers([row("i1", "c1", "A"), row("i1", "c2", "B"), row("i1", "c1", "C"), row("i2", "c3", "D")]);
    expect(g.map((x) => [x.installationId, x.count])).toEqual([["i1", 3], ["i2", 1]]);
    expect(g[0].circuits.map((c) => [c.circuitId, c.chargers.map((r) => r.label)])).toEqual([["c1", ["A", "C"]], ["c2", ["B"]]]);
  });

  it("puts chargers without a circuit in their own group, last", () => {
    const g = groupChargers([row("i1", null, "X"), row("i1", "c1", "Y")]);
    expect(g[0].circuits.map((c) => c.circuitId)).toEqual(["c1", null]);
  });

  it("an empty list is no groups, and installations with equal names are not merged", () => {
    expect(groupChargers([])).toEqual([]);
    const a = { ...row("i1", "c1", "A"), installationName: "Same" };
    const b = { ...row("i2", "c1", "B"), installationName: "Same" };
    expect(groupChargers([a, b])).toHaveLength(2);
  });
});
