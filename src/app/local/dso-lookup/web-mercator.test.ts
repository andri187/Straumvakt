// Web Mercator maths — the contract.
//
// These assert PROPERTIES (round-trips, invariants, monotonicity) plus a
// couple of externally-known anchors, rather than a wall of hand-computed
// decimals. A hand-computed expectation that is itself wrong is worse than
// no test: it locks the bug in.

import { describe, expect, it } from "vitest";
import {
  boundsCenter,
  clampLatitude,
  isWithinViewport,
  latLngToWorldUnit,
  latToMercatorY,
  lngToMercatorX,
  MAX_MERCATOR_LATITUDE,
  mercatorXToLng,
  mercatorYToLat,
  MERCATOR_WORLD_EXTENT_M,
  metresPerPixel,
  projectToViewportPx,
  tilesForViewport,
  TILE_SIZE_PX,
  viewportMercatorBBox,
  worldSizePx,
  zoomToFitBounds,
  type Viewport,
} from "./web-mercator";

const REYKJAVIK = { lat: 64.1466, lng: -21.9367 };

const viewport = (over: Partial<Viewport> = {}): Viewport => ({
  center: REYKJAVIK,
  zoom: 12,
  widthPx: 820,
  heightPx: 520,
  ...over,
});

describe("externally-known anchors", () => {
  it("matches the documented zoom-0 ground resolution", () => {
    // 156543.03392804097 m/px is the standard Web Mercator figure. If this
    // drifts, the projection constant is wrong and everything else is too.
    expect(metresPerPixel(0)).toBeCloseTo(156_543.033_928_04, 5);
  });

  it("puts the whole world in one tile at zoom 0", () => {
    expect(worldSizePx(0)).toBe(TILE_SIZE_PX);
    expect(worldSizePx(1)).toBe(512);
  });

  it("halves resolution per zoom level", () => {
    for (let z = 0; z < 18; z++) {
      expect(metresPerPixel(z + 1)).toBeCloseTo(metresPerPixel(z) / 2, 9);
    }
  });

  it("places the origin at the world centre", () => {
    expect(lngToMercatorX(0)).toBe(0);
    // Not exactly 0: Math.tan(Math.PI/4) is 0.9999999999999999, so the log
    // lands a whisker below zero. That is ~7e-10 metres — sub-nanometre, and
    // asserting exact equality would be asserting a property of the FPU.
    expect(latToMercatorY(0)).toBeCloseTo(0, 6);
    const origin = latLngToWorldUnit({ lat: 0, lng: 0 });
    expect(origin.x).toBe(0.5);
    expect(origin.y).toBeCloseTo(0.5, 12);
  });

  it("reaches exactly the world extent at 180 degrees", () => {
    expect(lngToMercatorX(180)).toBeCloseTo(MERCATOR_WORLD_EXTENT_M, 6);
    expect(lngToMercatorX(-180)).toBeCloseTo(-MERCATOR_WORLD_EXTENT_M, 6);
  });

  it("makes the world square at the Mercator cutoff latitude", () => {
    expect(latToMercatorY(MAX_MERCATOR_LATITUDE)).toBeCloseTo(MERCATOR_WORLD_EXTENT_M, 2);
  });
});

describe("round trips", () => {
  it("survives longitude round trip", () => {
    for (const lng of [-179.9, -24.9, -21.9367, 0, 13.05, 179.9]) {
      expect(mercatorXToLng(lngToMercatorX(lng))).toBeCloseTo(lng, 9);
    }
  });

  it("survives latitude round trip across Iceland and beyond", () => {
    for (const lat of [-84, -45, 0, 63.15, 64.1466, 66.75, 84]) {
      expect(mercatorYToLat(latToMercatorY(lat))).toBeCloseTo(lat, 9);
    }
  });

  it("clamps rather than returning infinity at the poles", () => {
    expect(clampLatitude(90)).toBe(MAX_MERCATOR_LATITUDE);
    expect(clampLatitude(-90)).toBe(-MAX_MERCATOR_LATITUDE);
    expect(Number.isFinite(latToMercatorY(90))).toBe(true);
    expect(Number.isFinite(latToMercatorY(-90))).toBe(true);
  });

  it("rejects non-finite input rather than producing NaN coordinates", () => {
    expect(() => lngToMercatorX(NaN)).toThrow(/must_be_finite/);
    expect(() => latToMercatorY(Infinity)).toThrow(/must_be_finite/);
  });
});

describe("orientation — the easy thing to get backwards", () => {
  it("increases world-unit y going SOUTH", () => {
    const north = latLngToWorldUnit({ lat: 66, lng: -19 });
    const south = latLngToWorldUnit({ lat: 63, lng: -19 });
    expect(south.y).toBeGreaterThan(north.y);
  });

  it("increases world-unit x going EAST", () => {
    const west = latLngToWorldUnit({ lat: 64, lng: -24 });
    const east = latLngToWorldUnit({ lat: 64, lng: -13 });
    expect(east.x).toBeGreaterThan(west.x);
  });

  it("draws a northern point ABOVE a southern one on screen", () => {
    const v = viewport();
    const north = projectToViewportPx({ lat: 64.20, lng: -21.9367 }, v);
    const south = projectToViewportPx({ lat: 64.10, lng: -21.9367 }, v);
    expect(north.y).toBeLessThan(south.y);
  });
});

describe("viewport projection", () => {
  it("puts the centre exactly in the middle", () => {
    const v = viewport();
    const p = projectToViewportPx(v.center, v);
    expect(p.x).toBeCloseTo(v.widthPx / 2, 9);
    expect(p.y).toBeCloseTo(v.heightPx / 2, 9);
  });

  it("agrees with the WMS bbox it will be drawn over", () => {
    // The overlay image spans the bbox exactly, so the centre of the bbox
    // must be the centre of the viewport. If these disagree the overlay is
    // offset from the tiles — the whole point of using one projection.
    const v = viewport();
    const bbox = viewportMercatorBBox(v);
    expect((bbox.minX + bbox.maxX) / 2).toBeCloseTo(lngToMercatorX(v.center.lng), 6);
    expect((bbox.minY + bbox.maxY) / 2).toBeCloseTo(latToMercatorY(v.center.lat), 6);
  });

  it("sizes the bbox to the viewport at the current resolution", () => {
    const v = viewport();
    const bbox = viewportMercatorBBox(v);
    expect(bbox.maxX - bbox.minX).toBeCloseTo(v.widthPx * metresPerPixel(v.zoom), 6);
    expect(bbox.maxY - bbox.minY).toBeCloseTo(v.heightPx * metresPerPixel(v.zoom), 6);
  });

  it("knows what is on screen and what is not", () => {
    const v = viewport();
    expect(isWithinViewport(v.center, v)).toBe(true);
    expect(isWithinViewport({ lat: 66.5, lng: -14 }, v)).toBe(false);
  });

  it("scales one screen pixel to one ground resolution unit", () => {
    const v = viewport({ zoom: 10 });
    const mpp = metresPerPixel(10);
    const a = projectToViewportPx(v.center, v);
    const eastOfCentre = mercatorXToLng(lngToMercatorX(v.center.lng) + mpp * 100);
    const b = projectToViewportPx({ lat: v.center.lat, lng: eastOfCentre }, v);
    expect(b.x - a.x).toBeCloseTo(100, 6);
  });
});

describe("tiling", () => {
  it("covers the whole viewport", () => {
    const v = viewport();
    const tiles = tilesForViewport(v);
    expect(tiles.length).toBeGreaterThan(0);
    const minLeft = Math.min(...tiles.map((t) => t.left));
    const minTop = Math.min(...tiles.map((t) => t.top));
    const maxRight = Math.max(...tiles.map((t) => t.left + TILE_SIZE_PX));
    const maxBottom = Math.max(...tiles.map((t) => t.top + TILE_SIZE_PX));
    expect(minLeft).toBeLessThanOrEqual(0);
    expect(minTop).toBeLessThanOrEqual(0);
    expect(maxRight).toBeGreaterThanOrEqual(v.widthPx);
    expect(maxBottom).toBeGreaterThanOrEqual(v.heightPx);
  });

  it("never asks for a tile outside the world", () => {
    for (const zoom of [0, 1, 2, 6]) {
      const tiles = tilesForViewport(viewport({ zoom, widthPx: 2000, heightPx: 1400 }));
      const max = Math.pow(2, zoom);
      for (const t of tiles) {
        expect(t.x).toBeGreaterThanOrEqual(0);
        expect(t.y).toBeGreaterThanOrEqual(0);
        expect(t.x).toBeLessThan(max);
        expect(t.y).toBeLessThan(max);
      }
    }
  });

  it("emits no duplicate tiles", () => {
    const tiles = tilesForViewport(viewport());
    const keys = tiles.map((t) => `${t.z}/${t.x}/${t.y}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("places tiles on a 256px lattice relative to each other", () => {
    const tiles = tilesForViewport(viewport());
    const lefts = [...new Set(tiles.map((t) => t.left))].sort((a, b) => a - b);
    for (let i = 1; i < lefts.length; i++) {
      expect(lefts[i]! - lefts[i - 1]!).toBeCloseTo(TILE_SIZE_PX, 6);
    }
  });

  it("puts Reykjavík in the tile column its longitude implies", () => {
    // tileX depends only on longitude: floor(((lng+180)/360) * 2^z).
    const zoom = 10;
    const expectedX = Math.floor(((REYKJAVIK.lng + 180) / 360) * Math.pow(2, zoom));
    const tiles = tilesForViewport(viewport({ zoom, widthPx: 256, heightPx: 256 }));
    expect(tiles.some((t) => t.x === expectedX)).toBe(true);
  });
});

describe("fitting a region", () => {
  it("picks a zoom that fits Iceland in the viewport", () => {
    const sw = { lat: 63.15, lng: -24.95 };
    const ne = { lat: 66.75, lng: -13.05 };
    const zoom = zoomToFitBounds(sw, ne, 820, 520);
    const v: Viewport = { center: boundsCenter(sw, ne), zoom, widthPx: 820, heightPx: 520 };
    expect(isWithinViewport(sw, v)).toBe(true);
    expect(isWithinViewport(ne, v)).toBe(true);
  });

  it("zooms in further for a smaller region", () => {
    const iceland = zoomToFitBounds({ lat: 63.15, lng: -24.95 }, { lat: 66.75, lng: -13.05 }, 820, 520);
    const southwest = zoomToFitBounds({ lat: 63.58, lng: -23.2 }, { lat: 64.38, lng: -20.45 }, 820, 520);
    expect(southwest).toBeGreaterThan(iceland);
  });

  it("respects the zoom ceiling", () => {
    const z = zoomToFitBounds({ lat: 64.0, lng: -21.9 }, { lat: 64.0001, lng: -21.8999 }, 820, 520, 0, 14);
    expect(z).toBe(14);
  });

  it("centres a bounding box between its corners", () => {
    expect(boundsCenter({ lat: 63, lng: -24 }, { lat: 67, lng: -14 })).toEqual({ lat: 65, lng: -19 });
  });
});
