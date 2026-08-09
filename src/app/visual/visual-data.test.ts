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

  it("adds persona-level review focus and decision prompts", () => {
    for (const family of visualFamilies) {
      expect(family.reviewFocus.length).toBeGreaterThan(50);
      expect(family.nextDecisions).toHaveLength(3);
      expect(family.nextDecisions.every((decision) => decision.length > 15)).toBe(true);
    }
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
          expect(screen.journeyStep.length).toBeGreaterThan(3);
          expect(["ready", "preview", "blocked", "future"]).toContain(screen.maturity);
          expect(screen.review.intent.length).toBeGreaterThan(25);
          expect(screen.review.real).toContain("reviewable");
          expect(screen.review.demo).toContain("local demo fixtures");
          expect(screen.review.blocked.length).toBeGreaterThan(25);
          expect(screen.review.decision).toContain("Decide");
          expect(screen.metrics).toHaveLength(4);
          expect(screen.columns.length).toBeGreaterThanOrEqual(5);
          expect(screen.rows.length).toBeGreaterThanOrEqual(3);
          expect(screen.queue.length).toBeGreaterThanOrEqual(3);
          expect(screen.tableTitle).not.toBe("");
          expect(screen.queueTitle).not.toBe("");
        });

        it(`${screen.id} keeps money-like values inside demo/provisional boundaries`, () => {
          const text = [
            screen.state,
            ...screen.metrics.flatMap((metric) => [metric.value, metric.detail]),
            ...screen.rows.flat(),
            ...screen.queue.flatMap((item) => [item.title, item.detail]),
          ].join(" ");
          if (/\bkr\b|kr\/kWh|cost/i.test(text)) {
            expect(`${screen.review.demo} ${screen.review.real} ${screen.notice ?? ""}`).toMatch(/demo|provisional|read/i);
          }
        });
      }
    });
  }
});
