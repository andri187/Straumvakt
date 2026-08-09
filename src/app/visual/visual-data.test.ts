import { describe, expect, it } from "vitest";
import { visualFamilies, visualScreenCount } from "./visual-data";

describe("visual workspace datasets", () => {
  it("contains four distinct persona families", () => {
    expect(visualFamilies.map((family) => family.id)).toEqual([
      "admin", "organisation", "driver", "service",
    ]);
  });

  it("contains at least thirty complete screens", () => {
    expect(visualScreenCount).toBeGreaterThanOrEqual(30);
  });

  it("labels contractor service as future", () => {
    expect(visualFamilies.find((family) => family.id === "service")?.future).toBe(true);
  });

  it("uses reserved demo accounts", () => {
    for (const family of visualFamilies) expect(family.account).toMatch(/\.test$/);
  });

  it("documents intentionally absent navigation per persona", () => {
    for (const family of visualFamilies) expect(family.navigationAbsent.length).toBeGreaterThan(35);
  });

  for (const family of visualFamilies) {
    describe(family.label, () => {
      it("has a complete navigation model", () => {
        expect(family.screens.length).toBeGreaterThanOrEqual(8);
        expect(new Set(family.screens.map((screen) => screen.id)).size).toBe(family.screens.length);
      });

      for (const screen of family.screens) {
        it(`${screen.id} has a complete visual-state contract`, () => {
          expect(screen.title.length).toBeGreaterThan(5);
          expect(screen.summary.length).toBeGreaterThan(25);
          expect(screen.metrics).toHaveLength(4);
          expect(screen.columns.length).toBeGreaterThanOrEqual(5);
          expect(screen.rows.length).toBeGreaterThanOrEqual(3);
          expect(screen.queue.length).toBeGreaterThanOrEqual(3);
          expect(screen.tableTitle).not.toBe("");
          expect(screen.queueTitle).not.toBe("");
        });
      }
    });
  }
});
