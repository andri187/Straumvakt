import { describe, expect, it } from "vitest";
import {
  MAX_BULK_ATTACH,
  attachQuery,
  attachSearch,
  isZeroRating,
  moveChargerTo,
  parseAttachParams,
  pruneSelection,
  resolveAttach,
  selectAllIds,
  stillUnassigned,
  toggleSelected,
} from "./attachment-selection";

describe("parseAttachParams", () => {
  it("keeps valid ids, drops invalid and undefined ones", () => {
    expect(parseAttachParams(["ZCS1", "bad id", undefined, "", "a/b", "ok.1_2-3"])).toEqual(["ZCS1", "ok.1_2-3"]);
  });
  it("de-duplicates case-insensitively keeping the first spelling", () => {
    expect(parseAttachParams(["ZCS1", "zcs1", "ZCS2", "ZCS1"])).toEqual(["ZCS1", "ZCS2"]);
  });
  it("is bounded", () => {
    const many = Array.from({ length: 100 }, (_, i) => `c${i}`);
    expect(parseAttachParams(many)).toHaveLength(MAX_BULK_ATTACH);
  });
  it("rejects ids longer than 48", () => {
    expect(parseAttachParams(["x".repeat(49)])).toEqual([]);
  });
});

describe("resolveAttach", () => {
  const cands = [{ chargePointId: "ZCS1" }, { chargePointId: "ZCS2" }];
  it("matches only server candidates, in the server's spelling", () => {
    expect(resolveAttach(["zcs1", "ZCS9", "ZCS2"], cands)).toEqual({ matched: ["ZCS1", "ZCS2"], stale: ["ZCS9"] });
  });
  it("treats everything as stale when the server lists nothing", () => {
    expect(resolveAttach(["ZCS1"], [])).toEqual({ matched: [], stale: ["ZCS1"] });
  });
});

describe("query helpers", () => {
  it("round-trips ids", () => {
    expect(attachQuery(["A", "B.1"])).toBe("&attach=A&attach=B.1");
    expect(attachSearch(["A", "B.1"])).toBe("?attach=A&attach=B.1");
    expect(attachQuery([])).toBe("");
    expect(attachSearch([])).toBe("");
    const params = new URLSearchParams(attachSearch(["A", "B"]));
    expect(parseAttachParams(params.getAll("attach"))).toEqual(["A", "B"]);
  });
});

describe("selection", () => {
  it("prunes selected ids that are no longer visible", () => {
    expect(pruneSelection(new Set(["a", "gone", "c"]), ["a", "b", "c"])).toEqual(["a", "c"]);
  });
  it("toggles and bounds", () => {
    let s: ReadonlySet<string> = new Set();
    s = toggleSelected(s, "a");
    expect([...s]).toEqual(["a"]);
    s = toggleSelected(s, "a");
    expect(s.size).toBe(0);
    const full = new Set(Array.from({ length: MAX_BULK_ATTACH }, (_, i) => `c${i}`));
    expect(toggleSelected(full, "extra")).toBe(full);
  });
  it("select all is bounded", () => {
    expect(selectAllIds(Array.from({ length: 40 }, (_, i) => `c${i}`)).size).toBe(MAX_BULK_ATTACH);
  });
});

describe("assignment", () => {
  const rows = [
    { id: "h1", circuitId: "c1", label: "A", chargePointId: "ZCS1" },
    { id: "h2", circuitId: "c1", label: "B", chargePointId: "ZCS2" },
  ];
  it("moves only the circuit of the named charger and keeps everything else", () => {
    const next = moveChargerTo(rows, "h2", "c2");
    expect(next[0]).toBe(rows[0]);
    expect(next[1]).toEqual({ id: "h2", circuitId: "c2", label: "B", chargePointId: "ZCS2" });
  });
  it("is a no-op for the same circuit or an unknown charger", () => {
    expect(moveChargerTo(rows, "h1", "c1")[0]).toBe(rows[0]);
    expect(moveChargerTo(rows, "nope", "c2")).toEqual(rows);
  });
  it("reports pending ids not yet on a charger row", () => {
    expect(stillUnassigned(["zcs1", "ZCS3"], rows)).toEqual(["ZCS3"]);
    expect(stillUnassigned([], rows)).toEqual([]);
  });
});

describe("isZeroRating", () => {
  it("flags explicit zero only", () => {
    expect(isZeroRating("0")).toBe(true);
    expect(isZeroRating(" 00 ")).toBe(true);
    expect(isZeroRating("")).toBe(false);
    expect(isZeroRating("  ")).toBe(false);
    expect(isZeroRating("10")).toBe(false);
    expect(isZeroRating("0.5")).toBe(false);
  });
});
