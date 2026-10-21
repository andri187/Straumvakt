// WMS URL construction — the contract.
//
// No test in this file performs a network request. That is the point of
// separating URL construction from fetching: the map's correctness is
// checkable offline.

import { describe, expect, it } from "vitest";
import {
  buildGetFeatureInfoUrl,
  buildGetMapUrl,
  buildTileUrl,
  DSO_LAYERS,
  isDsoLayerId,
  OSM_ATTRIBUTION,
  WMS_ATTRIBUTION,
  WMS_BASE,
} from "./wms";
import { metresPerPixel, type Viewport } from "./web-mercator";

const viewport: Viewport = {
  center: { lat: 64.1466, lng: -21.9367 },
  zoom: 12,
  widthPx: 820,
  heightPx: 520,
};

const paramsOf = (url: string) => new URL(url).searchParams;

describe("GetMap", () => {
  it("targets the public Orkustofnun endpoint", () => {
    expect(buildGetMapUrl("raforkudreifing", viewport).startsWith(`${WMS_BASE}?`)).toBe(true);
  });

  it("requests WMS 1.3.0 GetMap as a transparent PNG", () => {
    const p = paramsOf(buildGetMapUrl("raforkudreifing", viewport));
    expect(p.get("SERVICE")).toBe("WMS");
    expect(p.get("VERSION")).toBe("1.3.0");
    expect(p.get("REQUEST")).toBe("GetMap");
    expect(p.get("FORMAT")).toBe("image/png");
    expect(p.get("TRANSPARENT")).toBe("TRUE");
  });

  it("requests EPSG:3857 so the overlay lines up with the tiles", () => {
    // CRS:84 would be plate carrée and would NOT align with Web Mercator
    // tiles. At Iceland's latitude that misalignment is large.
    expect(paramsOf(buildGetMapUrl("raforkudreifing", viewport)).get("CRS")).toBe("EPSG:3857");
  });

  it("sends the bbox easting-first, matching the EPSG:3857 axis order", () => {
    const bbox = paramsOf(buildGetMapUrl("raforkudreifing", viewport))
      .get("BBOX")!
      .split(",")
      .map(Number);
    expect(bbox).toHaveLength(4);
    const [minX, minY, maxX, maxY] = bbox as [number, number, number, number];
    expect(maxX).toBeGreaterThan(minX);
    expect(maxY).toBeGreaterThan(minY);
    // Iceland is west of Greenwich and well north — easting negative,
    // northing strongly positive. If these were transposed the map would
    // silently show the wrong part of the world.
    expect(maxX).toBeLessThan(0);
    expect(minY).toBeGreaterThan(9_000_000);
  });

  it("asks for an image the same size as the viewport", () => {
    const p = paramsOf(buildGetMapUrl("raforkudreifing", viewport));
    expect(p.get("WIDTH")).toBe("820");
    expect(p.get("HEIGHT")).toBe("520");
  });

  it("keeps the bbox aspect ratio equal to the image aspect ratio", () => {
    // A mismatch here is how a WMS overlay ends up subtly stretched.
    const bbox = paramsOf(buildGetMapUrl("raforkudreifing", viewport))
      .get("BBOX")!
      .split(",")
      .map(Number) as [number, number, number, number];
    const ratio = (bbox[2] - bbox[0]) / (bbox[3] - bbox[1]);
    expect(ratio).toBeCloseTo(viewport.widthPx / viewport.heightPx, 4);
  });

  it("scales the bbox with zoom", () => {
    const wide = paramsOf(buildGetMapUrl("raforkudreifing", { ...viewport, zoom: 8 }))
      .get("BBOX")!
      .split(",")
      .map(Number);
    const tight = paramsOf(buildGetMapUrl("raforkudreifing", { ...viewport, zoom: 14 }))
      .get("BBOX")!
      .split(",")
      .map(Number);
    expect(wide[2]! - wide[0]!).toBeGreaterThan(tight[2]! - tight[0]!);
    expect(wide[2]! - wide[0]!).toBeCloseTo(viewport.widthPx * metresPerPixel(8), 0);
  });

  it("serves both layers", () => {
    expect(paramsOf(buildGetMapUrl("orkusparsvaedi", viewport)).get("LAYERS")).toBe("orkusparsvaedi");
    expect(paramsOf(buildGetMapUrl("raforkudreifing", viewport)).get("LAYERS")).toBe("raforkudreifing");
  });

  it("refuses an unknown layer rather than putting it in the query string", () => {
    // @ts-expect-error deliberately wrong — the runtime guard is the subject
    expect(() => buildGetMapUrl("../../etc/passwd", viewport)).toThrow(/unknown_layer/);
    // @ts-expect-error deliberately wrong
    expect(() => buildGetMapUrl("raforkudreifing&EXTRA=1", viewport)).toThrow(/unknown_layer/);
  });

  it("refuses a zero-sized viewport", () => {
    expect(() => buildGetMapUrl("raforkudreifing", { ...viewport, widthPx: 0 })).toThrow(
      /positive_size/,
    );
  });
});

describe("layer metadata", () => {
  it("names Raforkudreifing as the DSO authority and Orkuspársvæði as comparison only", () => {
    expect(DSO_LAYERS.raforkudreifing.description).toMatch(/authority/i);
    expect(DSO_LAYERS.orkusparsvaedi.description).toMatch(/NOT a DSO authority/i);
  });

  it("recognises exactly the two allowed layer ids", () => {
    expect(isDsoLayerId("raforkudreifing")).toBe(true);
    expect(isDsoLayerId("orkusparsvaedi")).toBe(true);
    expect(isDsoLayerId("constructor")).toBe(false);
    expect(isDsoLayerId("toString")).toBe(false);
    expect(isDsoLayerId("anything-else")).toBe(false);
  });

  it("carries the attributions both sources require", () => {
    expect(OSM_ATTRIBUTION).toMatch(/OpenStreetMap/);
    expect(WMS_ATTRIBUTION).toMatch(/Orkustofnun/);
  });
});

describe("tiles", () => {
  it("builds a standard slippy-tile URL", () => {
    expect(buildTileUrl(10, 449, 275)).toBe("https://tile.openstreetmap.org/10/449/275.png");
  });

  it("rejects out-of-range tile coordinates", () => {
    expect(() => buildTileUrl(1, 2, 0)).toThrow(/out_of_range/);
    expect(() => buildTileUrl(1, 0, -1)).toThrow(/out_of_range/);
    expect(() => buildTileUrl(30, 0, 0)).toThrow(/out_of_range/);
  });

  it("rejects non-integer tile coordinates", () => {
    expect(() => buildTileUrl(10, 1.5, 3)).toThrow(/must_be_integer/);
  });
});

describe("GetFeatureInfo — documented but not called here", () => {
  it("builds the exact request shape the fixture data was harvested with", () => {
    const p = paramsOf(buildGetFeatureInfoUrl("raforkudreifing", { lat: 64.0889, lng: -21.9224 }));
    expect(p.get("REQUEST")).toBe("GetFeatureInfo");
    expect(p.get("QUERY_LAYERS")).toBe("raforkudreifing");
    expect(p.get("INFO_FORMAT")).toBe("application/json");
    expect(p.get("CRS")).toBe("CRS:84");
    // I/J address the centre pixel of the 101x101 probe image.
    expect(p.get("I")).toBe("50");
    expect(p.get("J")).toBe("50");
    expect(p.get("WIDTH")).toBe("101");
  });

  it("centres the probe box on the queried point", () => {
    const bbox = paramsOf(buildGetFeatureInfoUrl("raforkudreifing", { lat: 64.0, lng: -21.0 }))
      .get("BBOX")!
      .split(",")
      .map(Number) as [number, number, number, number];
    expect((bbox[0] + bbox[2]) / 2).toBeCloseTo(-21.0, 9);
    expect((bbox[1] + bbox[3]) / 2).toBeCloseTo(64.0, 9);
  });
});
