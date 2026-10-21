// The map's text alternative — the contract.
//
// This is the version of the map available to a screen-reader user, a phone
// in portrait, and anyone whose tiles failed to load. It has to carry the
// same conclusions the picture does.

import { describe, expect, it } from "vitest";
import { describeMap, describeMapBriefly, formatCoordinates, groundWidth } from "./map-description";
import { resolveDso } from "./dso-resolve";
import { DEMO_ADDRESSES } from "./address-fixtures";
import type { Viewport } from "./web-mercator";

const viewport: Viewport = {
  center: { lat: 64.0889, lng: -21.9224 },
  zoom: 13,
  widthPx: 820,
  heightPx: 520,
};

const addr = (id: string) => {
  const r = DEMO_ADDRESSES.find((a) => a.hnitnum === id);
  if (!r) throw new Error(`fixture_missing:${id}`);
  return r;
};

const forAddress = (id: string) => {
  const r = addr(id);
  return {
    viewport: { ...viewport, center: { lat: r.lat, lng: r.lng } },
    layer: "raforkudreifing" as const,
    showOverlay: true,
    marker: { lat: r.lat, lng: r.lng },
    markerLabel: `${r.heitiNf} ${r.husnr}`,
    suggestion: resolveDso({ lat: r.lat, lng: r.lng }),
  };
};

describe("coordinate formatting", () => {
  it("uses hemisphere letters rather than signs", () => {
    expect(formatCoordinates({ lat: 64.0889, lng: -21.9224 })).toBe("64.08890° N, 21.92240° W");
  });

  it("handles the other hemispheres", () => {
    expect(formatCoordinates({ lat: -33.9, lng: 151.2 })).toContain("S");
    expect(formatCoordinates({ lat: -33.9, lng: 151.2 })).toContain("E");
  });
});

describe("scale", () => {
  it("reports a plausible ground width and shrinks as you zoom in", () => {
    const wide = groundWidth({ ...viewport, zoom: 8 });
    const tight = groundWidth({ ...viewport, zoom: 15 });
    expect(wide).toMatch(/km/);
    expect(parseFloat(wide)).toBeGreaterThan(parseFloat(tight));
  });
});

describe("the description carries the map's conclusions", () => {
  it("names the operator and the service area", () => {
    const lines = describeMap(forAddress("demo-0005")).join(" ");
    expect(lines).toContain("Veitur");
    expect(lines).toContain("Stór-Reykjavíkursvæði");
  });

  it("states the confidence", () => {
    expect(describeMap(forAddress("demo-0005")).join(" ")).toMatch(/Confidence: near-boundary/);
  });

  it("always says an administrator must confirm before billing", () => {
    for (const record of DEMO_ADDRESSES) {
      const lines = describeMap(forAddress(record.hnitnum)).join(" ");
      expect(lines).toMatch(/administrator must confirm/i);
    }
  });

  it("says plainly when no operator could be determined", () => {
    const lines = describeMap(forAddress("demo-0026")).join(" ");
    expect(lines).toMatch(/No distribution operator could be determined/i);
    expect(lines).not.toMatch(/falls in the .* service area/);
  });

  it("mentions the nearest competing operator at a boundary", () => {
    const lines = describeMap(forAddress("demo-0006")).join(" ");
    expect(lines).toMatch(/nearest different operator is Veitur/i);
  });

  it("reports the tariff class", () => {
    expect(describeMap(forAddress("demo-0038")).join(" ")).toMatch(/rural tariff class/);
    expect(describeMap(forAddress("demo-0001")).join(" ")).toMatch(/urban tariff class/);
  });
});

describe("map state without a selection", () => {
  const base = { viewport, layer: "raforkudreifing" as const, showOverlay: true };

  it("says no address is selected", () => {
    expect(describeMap({ ...base, marker: null }).join(" ")).toMatch(/No address is selected/);
  });

  it("says when the overlay is switched off", () => {
    expect(describeMap({ ...base, showOverlay: false, marker: null }).join(" ")).toMatch(
      /overlay is currently switched off/,
    );
  });

  it("warns that the forecast layer is not an operator authority", () => {
    const lines = describeMap({ ...base, layer: "orkusparsvaedi", marker: null }).join(" ");
    expect(lines).toMatch(/does not determine which company distributes/i);
  });

  it("does not warn about the forecast layer when it is switched off", () => {
    const lines = describeMap({
      ...base, layer: "orkusparsvaedi", showOverlay: false, marker: null,
    }).join(" ");
    expect(lines).not.toMatch(/does not determine which company/i);
  });
});

describe("shape", () => {
  it("returns discrete statements, not one blob", () => {
    const lines = describeMap(forAddress("demo-0005"));
    expect(lines.length).toBeGreaterThan(3);
    for (const line of lines) expect(line.trim()).toBe(line);
  });

  it("produces unique lines, so they are safe as React keys", () => {
    for (const id of ["demo-0001", "demo-0005", "demo-0026", "demo-0038"]) {
      const lines = describeMap(forAddress(id));
      expect(new Set(lines).size).toBe(lines.length);
    }
  });

  it("collapses to a single string for an aria-label", () => {
    const brief = describeMapBriefly(forAddress("demo-0005"));
    expect(brief).not.toContain("\n");
    expect(brief.length).toBeGreaterThan(80);
  });
});
