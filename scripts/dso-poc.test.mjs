// DSO lookup POC — focused checks.
//
// Offline by construction, like the rest of the main suite. The geometry
// tests use small synthetic polygons so they are exact and fast; agreement
// with the real 109-area dataset was verified separately against live WFS and
// is recorded in the handoff note.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  checkCredential, resolveMapsKey, googleMapsScriptUrl,
  tileBBox3857, wmsTileUrl, wfsGeoJsonUrl,
  pointInRing, pointInPolygon, pointInGeometry, distanceToGeometryEdgeM,
  normaliseAreaType, isDefinedOperator, resolveDso, runBoundaryCheck,
  searchFixtures, fold, formatDistance,
  MERCATOR_HALF_WORLD_M, NEAR_BOUNDARY_M, UNDEFINED_OPERATOR,
  BOUNDARY_SAMPLES, FIXTURE_ADDRESSES,
  styleForFeature, colorForOperator, legendEntries,
  DSO_COLORS, DEFAULT_DSO_COLOR, FILL_OPACITY, STROKE_OPACITY,
} from "../public/dso-lookup.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "../public/dso-lookup.html"), "utf8");
const mjs = readFileSync(join(here, "../public/dso-lookup.mjs"), "utf8");
const landing = readFileSync(join(here, "../src/app/page.tsx"), "utf8");
const landingCss = readFileSync(join(here, "../src/app/landing.css"), "utf8");
const gitignore = readFileSync(join(here, "../.gitignore"), "utf8");
/**
 * Copy text as a reader sees it: HTML entities decoded and whitespace
 * collapsed. Asserting against raw source would fail on `&ndash;` and on
 * prose that JSX/JS has split across a string concatenation, which tests the
 * formatter rather than the wording.
 */
const prose = html
  .replace(/&ndash;/g, "–")
  .replace(/&mdash;/g, "—")
  .replace(/&hellip;/g, "…")
  .replace(/&rsquo;/g, "’")
  .replace(/&deg;/g, "°")
  .replace(/"\s*\+\s*"/g, "")
  .replace(/\s+/g, " ");

// A unit square around (0,0) and a neighbour to its east, as a stand-in for
// two adjoining service areas.
const square = (west, east, south, north) => [[
  [west, south], [east, south], [east, north], [west, north], [west, south],
]];
const fc = (features) => ({ type: "FeatureCollection", features });
const feat = (props, coordinates, type = "Polygon") => ({
  type: "Feature", properties: props, geometry: { type, coordinates },
});

// Roughly Garðabær's latitude, so metre conversions are realistic.
const LAT = 64.09;
const WEST = feat({ id: 1, nafn: "Veitur", stadur: "Stór-Reykjavíkursvæði", tegund: "Þéttbýli" },
  square(-21.94, -21.93, LAT - 0.01, LAT + 0.01));
const EAST = feat({ id: 2, nafn: "HS Veitur", stadur: "Reykjanes", tegund: "Þéttbýli" },
  square(-21.93, -21.92, LAT - 0.01, LAT + 0.01));
const AREAS = fc([WEST, EAST]);

describe("the demo gate", () => {
  it("accepts DSO/map", () => {
    expect(checkCredential("DSO", "map")).toBe(true);
    expect(checkCredential("dso", "map")).toBe(true);
    expect(checkCredential("  DSO ", "map")).toBe(true);
  });

  it("rejects anything else", () => {
    for (const [u, p] of [["DSO", "MAP"], ["DSO", ""], ["admin", "map"], ["", ""], ["DSO", "map "]]) {
      expect(checkCredential(u, p)).toBe(false);
    }
  });

  it("does not fall over on non-strings", () => {
    for (const [u, p] of [[null, null], [undefined, undefined], [{}, []], [true, true]]) {
      expect(checkCredential(u, p)).toBe(false);
    }
  });

  it("issues nothing — no cookie, storage, token or session anywhere in the POC", () => {
    for (const src of [html, mjs]) {
      expect(src).not.toMatch(/document\.cookie|localStorage|setItem\(/);
      expect(src).not.toMatch(/\bjwt\b|Bearer |Authorization/i);
    }
  });

  it("is currently UNGATED, and says so in the source", () => {
    // Deliberate: the page is open until a gate is applied. Everything on it
    // is public reference data, so there is nothing behind it to protect.
    expect(html).not.toMatch(/id="gate-form"/);
    expect(html).toMatch(/No gate\./);
    expect(html).toMatch(/A credential gate is planned but has not been applied yet/);
  });

  it("still tells the reader it is a POC and not a login", () => {
    // Losing the gate must not lose the labelling — it moved into the page.
    expect(prose).toMatch(/not a Straumvakt product page and not a\s*login/i);
    expect(prose).toMatch(/Public-data POC/);
  });

  it("keeps checkCredential available for when gating returns", () => {
    expect(checkCredential("DSO", "map")).toBe(true);
    expect(mjs).toMatch(/export function checkCredential/);
  });
});

describe("the Google key is never committed", () => {
  it("contains no key-shaped literal", () => {
    for (const src of [html, mjs]) {
      expect(src).not.toMatch(/AIza[0-9A-Za-z_-]{20,}/);
      expect(src).not.toMatch(/["'][A-Za-z0-9_-]{39}["']/);
    }
  });

  it("reads the key from the query string at runtime", () => {
    expect(resolveMapsKey({ search: "?key=abc123" })).toBe("abc123");
  });

  it("falls back to an injected global", () => {
    expect(resolveMapsKey({ search: "", injected: "xyz" })).toBe("xyz");
    expect(resolveMapsKey({ search: "?key=fromurl", injected: "xyz" })).toBe("fromurl");
  });

  it("returns null when absent, so the UI can say so", () => {
    expect(resolveMapsKey({ search: "" })).toBeNull();
    expect(resolveMapsKey({ search: "?key=", injected: "  " })).toBeNull();
    expect(resolveMapsKey()).toBeNull();
  });

  it("refuses to build a script URL without a key", () => {
    expect(() => googleMapsScriptUrl(null)).toThrow(/maps_key_missing/);
    expect(() => googleMapsScriptUrl("")).toThrow(/maps_key_missing/);
  });

  it("builds a Maps JS URL with the key as a parameter", () => {
    const u = new URL(googleMapsScriptUrl("K123"));
    expect(u.origin + u.pathname).toBe("https://maps.googleapis.com/maps/api/js");
    expect(u.searchParams.get("key")).toBe("K123");
    expect(u.searchParams.get("libraries")).toBe("places");
  });

  it("tells the user exactly which Google APIs are needed", () => {
    expect(prose).toMatch(/Maps JavaScript API/);
    expect(prose).toMatch(/Places API/);
  });

  it("actually LOADS the local key file it tells the user to create", () => {
    // The page documented public/dso-lookup-config.js but had no script tag
    // for it, so window.STRAUMVAKT_MAPS_KEY could never be set that way.
    expect(html).toMatch(/<script src="\.\/dso-lookup-config\.js"/);
    // Relative, so it works from a subdomain root too.
    expect(html).not.toMatch(/<script src="\/dso-lookup-config\.js"/);
  });

  it("keeps that key file out of git", () => {
    expect(gitignore).toMatch(/dso-lookup-config\.js/);
  });
});

describe("WMS tiles are requested safely and in the right projection", () => {
  it("covers the whole world at zoom 0", () => {
    const b = tileBBox3857(0, 0, 0);
    expect(b.minX).toBeCloseTo(-MERCATOR_HALF_WORLD_M, 6);
    expect(b.maxX).toBeCloseTo(MERCATOR_HALF_WORLD_M, 6);
    expect(b.maxY).toBeCloseTo(MERCATOR_HALF_WORLD_M, 6);
  });

  it("makes tiles square and adjacent", () => {
    const a = tileBBox3857(3, 5, 4);
    const right = tileBBox3857(4, 5, 4);
    expect(a.maxX).toBeCloseTo(right.minX, 6);
    expect(a.maxX - a.minX).toBeCloseTo(a.maxY - a.minY, 6);
  });

  it("requests EPSG:3857 so the overlay aligns with the Google basemap", () => {
    // CRS:84 would be plate carrée over a Mercator basemap: wrong everywhere
    // but the centre line, and badly wrong at Iceland's latitude.
    const p = new URL(wmsTileUrl("raforkudreifing", 1, 1, 4)).searchParams;
    expect(p.get("CRS")).toBe("EPSG:3857");
    expect(p.get("VERSION")).toBe("1.3.0");
    expect(p.get("TRANSPARENT")).toBe("TRUE");
    expect(p.get("WIDTH")).toBe("256");
  });

  it("only serves the two known layers", () => {
    expect(() => wmsTileUrl("../secret", 0, 0, 0)).toThrow(/unknown_layer/);
    expect(() => wmsTileUrl("raforkudreifing&X=1", 0, 0, 0)).toThrow(/unknown_layer/);
    expect(() => wfsGeoJsonUrl("nope")).toThrow(/unknown_layer/);
  });

  it("rejects non-integer tile coordinates", () => {
    expect(() => tileBBox3857(1.5, 0, 4)).toThrow(/must_be_integers/);
  });

  it("asks WFS for GeoJSON in EPSG:4326", () => {
    const p = new URL(wfsGeoJsonUrl()).searchParams;
    expect(p.get("outputFormat")).toBe("application/json");
    expect(p.get("srsName")).toBe("EPSG:4326");
    expect(p.get("typeNames")).toBe("orkustofnun:raforkudreifing");
  });
});

describe("point-in-polygon", () => {
  it("finds a point inside and rejects one outside", () => {
    const ring = square(0, 1, 0, 1)[0];
    expect(pointInRing(0.5, 0.5, ring)).toBe(true);
    expect(pointInRing(1.5, 0.5, ring)).toBe(false);
    expect(pointInRing(0.5, 1.5, ring)).toBe(false);
  });

  it("respects holes", () => {
    const withHole = [square(0, 10, 0, 10)[0], square(4, 6, 4, 6)[0]];
    expect(pointInPolygon(1, 1, withHole)).toBe(true);
    expect(pointInPolygon(5, 5, withHole)).toBe(false); // in the hole
  });

  it("handles MultiPolygon", () => {
    const mp = { type: "MultiPolygon", coordinates: [square(0, 1, 0, 1), square(5, 6, 0, 1)] };
    expect(pointInGeometry(0.5, 0.5, mp)).toBe(true);
    expect(pointInGeometry(5.5, 0.5, mp)).toBe(true);
    expect(pointInGeometry(3, 0.5, mp)).toBe(false);
  });

  it("returns false for absent or unsupported geometry", () => {
    expect(pointInGeometry(0, 0, null)).toBe(false);
    expect(pointInGeometry(0, 0, { type: "LineString", coordinates: [] })).toBe(false);
  });

  it("measures distance to an edge in plausible metres", () => {
    // 0.001° of longitude at 64°N is about 48.7 m.
    const d = distanceToGeometryEdgeM(-21.931, LAT, WEST.geometry);
    expect(d).toBeGreaterThan(40);
    expect(d).toBeLessThan(60);
  });
});

describe("resolution — and postal code is structurally absent", () => {
  it("names the operator whose area contains the point", () => {
    expect(resolveDso(-21.935, LAT, AREAS).dso).toBe("Veitur");
    expect(resolveDso(-21.925, LAT, AREAS).dso).toBe("HS Veitur");
  });

  it("keeps two adjoining areas distinct — the Garðabær case", () => {
    const west = resolveDso(-21.9375, LAT, AREAS);
    const east = resolveDso(-21.9225, LAT, AREAS);
    expect(west.dso).not.toBe(east.dso);
    expect(west.serviceArea).toBe("Stór-Reykjavíkursvæði");
    expect(east.serviceArea).toBe("Reykjanes");
  });

  it("cannot be given a postal code", () => {
    // The signature is (lng, lat, featureCollection, opts). There is nowhere
    // to pass a postnúmer, so no later edit can quietly start keying on one.
    expect(resolveDso.length).toBeLessThanOrEqual(4);
    const r = resolveDso(-21.935, LAT, AREAS);
    expect(Object.keys(r)).not.toContain("postnr");
    expect(Object.keys(r)).not.toContain("postalCode");
  });

  it("never passes a postal code into the resolver from the page", () => {
    expect(html).not.toMatch(/resolveDso\([^)]*post/i);
  });

  it("labels the postal code as supporting only in the UI", () => {
    expect(prose).toMatch(/supporting only .{0,20}not the authority/i);
  });

  it("flags a point close to an edge as near-boundary", () => {
    // ~10 m inside the shared edge at -21.93.
    const r = resolveDso(-21.9302, LAT, AREAS);
    expect(r.confidence).toBe("near-boundary");
    expect(r.edgeDistanceM).toBeLessThan(NEAR_BOUNDARY_M);
  });

  it("calls a comfortably interior point exact", () => {
    const r = resolveDso(-21.935, LAT, AREAS);
    expect(r.confidence).toBe("exact");
    expect(r.edgeDistanceM).toBeGreaterThan(NEAR_BOUNDARY_M);
  });

  it("returns no-area where nothing covers the point", () => {
    const r = resolveDso(-19.0, 65.0, AREAS);
    expect(r.confidence).toBe("no-area");
    expect(r.dso).toBeNull();
    expect(r.explanation).toMatch(/do not tile the whole country/i);
  });

  it("returns manual-review where the source names no operator", () => {
    const undef = fc([feat(
      { id: 9, nafn: UNDEFINED_OPERATOR, stadur: "-", tegund: "Án skilgreiningar" },
      square(-22, -21, 63, 65),
    )]);
    const r = resolveDso(-21.5, 64, undef);
    expect(r.confidence).toBe("manual-review");
    expect(r.dso).toBeNull();
  });

  it("flags overlapping areas that name different operators", () => {
    const overlap = fc([
      feat({ id: 1, nafn: "Veitur", stadur: "A", tegund: "Þéttbýli" }, square(-22, -21, 63, 65)),
      feat({ id: 2, nafn: "RARIK", stadur: "B", tegund: "Dreifbýli" }, square(-22, -21, 63, 65)),
    ]);
    const r = resolveDso(-21.5, 64, overlap);
    expect(r.confidence).toBe("near-boundary");
    expect(r.neighbours).toContain("RARIK");
  });

  it("ALWAYS requires admin confirmation, whatever the confidence", () => {
    for (const lng of [-21.935, -21.9302, -19.0]) {
      expect(resolveDso(lng, LAT, AREAS).billingApplicability).toBe("requires-admin-confirmation");
    }
  });

  it("records that the answer came from raforkudreifing, not Google", () => {
    expect(resolveDso(-21.935, LAT, AREAS).source).toMatch(/raforkudreifing point-in-polygon/);
  });
});

describe("published attribute values", () => {
  it("normalises both spellings of Þéttbýli, and the other two classes", () => {
    expect(normaliseAreaType("Þéttbýli")).toBe("urban");
    expect(normaliseAreaType("Þéttbyli")).toBe("urban");   // real misspelling upstream
    expect(normaliseAreaType("Dreifbýli")).toBe("rural");
    expect(normaliseAreaType("Byggðakjarni")).toBe("settlement-core");
    expect(normaliseAreaType("Án skilgreiningar")).toBe("undefined");
  });

  it("does not silently absorb an unknown value", () => {
    expect(normaliseAreaType("Eitthvað nýtt")).toBe("unknown");
    expect(normaliseAreaType(null)).toBe("unknown");
  });

  it("treats 'Án skilgreiningar' as no operator", () => {
    expect(isDefinedOperator("Veitur")).toBe(true);
    expect(isDefinedOperator(UNDEFINED_OPERATOR)).toBe(false);
    expect(isDefinedOperator("")).toBe(false);
    expect(isDefinedOperator(null)).toBe(false);
  });
});

describe("boundary check panel", () => {
  it("ships at least five Garðabær-area sample points", () => {
    const gardabaer = BOUNDARY_SAMPLES.filter((s) => /Garðabær/.test(s.label));
    expect(gardabaer.length).toBeGreaterThanOrEqual(5);
  });

  it("resolves every sample and keeps the two sides distinct", () => {
    const rows = runBoundaryCheck(AREAS);
    expect(rows).toHaveLength(BOUNDARY_SAMPLES.length);
    const operators = new Set(rows.map((r) => r.result.dso).filter(Boolean));
    expect(operators.size).toBeGreaterThanOrEqual(2);
  });

  it("states the precision limit rather than overclaiming", () => {
    expect(prose).toMatch(/5.{0,3}11 m/);
    expect(prose).toMatch(/cannot settle a metre-level boundary dispute/i);
  });
});

describe("address fixtures", () => {
  it("folds Icelandic characters so plain-ASCII typing works", () => {
    expect(fold("Garðatorg")).toBe("gardatorg");
    expect(fold("Þverholt")).toBe("thverholt");
  });

  it("finds a fixture by folded name and by postal code", () => {
    expect(searchFixtures("gardatorg")[0].postnr).toBe("210");
    expect(searchFixtures("210").length).toBeGreaterThanOrEqual(2);
  });

  it("ignores a too-short query", () => {
    expect(searchFixtures("")).toEqual([]);
    expect(searchFixtures("a")).toEqual([]);
  });

  it("gives the two Garðabær fixtures the SAME postal code", () => {
    // The point of the pair: same postnúmer, different operator.
    const g = FIXTURE_ADDRESSES.filter((a) => a.label.includes("Garðabær"));
    expect(g).toHaveLength(2);
    expect(g[0].postnr).toBe(g[1].postnr);
  });

  it("labels the fixtures as not Staðfangaskrá", () => {
    expect(prose).toMatch(/not Staðfangaskrá records/i);
    expect(mjs).toMatch(/NOT Staðfangaskrá/);
  });
});

describe("containment — this POC touches nothing of Straumvakt's", () => {
  it("calls no Straumvakt API", () => {
    for (const src of [html, mjs]) {
      expect(src).not.toMatch(/["'`]\/api\//);
      expect(src).not.toMatch(/api-client|apiFetch|StraumvaktApi|admin-session/);
    }
  });

  it("reaches only the three expected hosts", () => {
    const hosts = new Set(
      [...(html + mjs).matchAll(/https:\/\/([a-z0-9.-]+)/g)].map((m) => m[1]),
    );
    expect(hosts).toEqual(new Set(["ogc.gis.is", "maps.googleapis.com"]));
  });

  it("says Google is not the DSO authority", () => {
    expect(prose).toMatch(/Google is not a DSO authority/i);
  });

  it("warns that Orkuspársvæði does not define operators", () => {
    expect(html).toMatch(/does NOT define distribution operators/);
  });

  it("asks search engines not to index it", () => {
    expect(html).toMatch(/name="robots" content="noindex/);
  });
});

describe("the standalone bundle stays in sync with the site copy", () => {
  // poc/dso-standalone/ is what gets deployed to a subdomain (Pages serves
  // index.html at the root). It is a copy, so the only real risk is drift —
  // someone edits public/ and the subdomain quietly serves something older.
  const standaloneHtml = readFileSync(join(here, "../poc/dso-standalone/index.html"), "utf8");
  const standaloneMjs = readFileSync(join(here, "../poc/dso-standalone/dso-lookup.mjs"), "utf8");

  it("index.html is byte-identical to public/dso-lookup.html", () => {
    expect(standaloneHtml).toBe(html);
  });

  it("dso-lookup.mjs is byte-identical to public/dso-lookup.mjs", () => {
    expect(standaloneMjs).toBe(mjs);
  });

  it("resolves its module by a relative path, so it works at any origin", () => {
    // "./dso-lookup.mjs" — not "/dso-lookup.mjs". An absolute path would
    // break the moment the page is served from a subdomain root.
    expect(standaloneHtml).toMatch(/from "\.\/dso-lookup\.mjs"/);
    expect(standaloneHtml).not.toMatch(/from "\/dso-lookup\.mjs"/);
  });
});

describe("formatting", () => {
  it("uses metres below a kilometre", () => {
    expect(formatDistance(36)).toBe("36 m");
    expect(formatDistance(1500)).toBe("1.5 km");
    expect(formatDistance(Infinity)).toBe("unknown distance");
  });
});

describe("the straumvakt.org top-right button", () => {
  it("REPLACED the Admin link and points at the standalone page", () => {
    expect(landing).toMatch(/<a className="admin-link" href="\/dso-lookup\.html">/);
    expect(landing).toMatch(/DSO map/);
    expect(landing).not.toMatch(/href="\/login"/);
  });

  it("reuses the existing style hook, so no CSS change was needed", () => {
    // Keeping className="admin-link" is why landing.css is untouched and the
    // whole landing-page diff is a few lines.
    expect(landingCss).toMatch(/\.straumvakt-landing \.admin-link \{[^}]*position:\s*absolute/);
    expect(landingCss).not.toMatch(/\.dso-link/);
    expect(landingCss).not.toMatch(/\.top-right/);
  });

  it("records that /login still exists and only the shortcut went", () => {
    // Staff are not locked out; the route is unchanged. The comment is the
    // decision record for whoever wonders where the Admin link went.
    expect(landing).toMatch(/still sign in at \/login/);
  });

  it("does not touch the login flow", () => {
    // A plain anchor: no handler, no state, no auth call.
    expect(landing).not.toMatch(/onClick=\{[^}]*dso/i);
  });

  it("leaves the rest of the landing page alone", () => {
    for (const kept of ["Innskráning", "Auðkenni", "Netfang", "Lykilorð", "handleLogin"]) {
      expect(landing).toContain(kept);
    }
  });
});

describe("overlay styling — no provider may look louder than another", () => {
  it("gives EVERY operator identical fill and stroke opacity", () => {
    // This is the whole fix. The WMS raster made the red/pink area dominate;
    // drawing vectors ourselves means one constant governs all of them.
    const styles = Object.keys(DSO_COLORS).map((n) => styleForFeature(n));
    expect(new Set(styles.map((s) => s.fillOpacity)).size).toBe(1);
    expect(new Set(styles.map((s) => s.strokeOpacity)).size).toBe(1);
    expect(new Set(styles.map((s) => s.strokeWeight)).size).toBe(1);
  });

  it("keeps the defaults inside the agreed ranges", () => {
    expect(FILL_OPACITY).toBeGreaterThanOrEqual(0.22);
    expect(FILL_OPACITY).toBeLessThanOrEqual(0.32);
    expect(STROKE_OPACITY).toBeGreaterThanOrEqual(0.7);
    expect(STROKE_OPACITY).toBeLessThanOrEqual(0.85);
  });

  it("gives each operator a distinct hue", () => {
    const colors = Object.values(DSO_COLORS);
    expect(new Set(colors).size).toBe(colors.length);
    for (const c of colors) expect(c).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("covers every operator the dataset publishes, including the undefined one", () => {
    for (const n of ["Veitur", "HS Veitur", "RARIK", "Norðurorka", "Orkubú Vestfjarða", UNDEFINED_OPERATOR]) {
      expect(DSO_COLORS[n]).toBeDefined();
    }
  });

  it("falls back to a neutral colour for an unknown operator", () => {
    expect(colorForOperator("Something New")).toBe(DEFAULT_DSO_COLOR);
    expect(colorForOperator(null)).toBe(DEFAULT_DSO_COLOR);
  });

  it("only stands out as an explicit interaction state", () => {
    const normal = styleForFeature("Veitur");
    const picked = styleForFeature("Veitur", { selected: true });
    expect(picked.fillOpacity).toBeGreaterThan(normal.fillOpacity);
    expect(picked.strokeWeight).toBeGreaterThan(normal.strokeWeight);
    expect(picked.fillColor).toBe(normal.fillColor); // hue never changes
  });

  it("draws the DSO layer as vectors, not as the unevenly-styled raster", () => {
    expect(html).toMatch(/map\.data\.addGeoJson/);
    expect(html).toMatch(/map\.data\.setStyle/);
    // The raster is retained only for the comparison layer.
    expect(html).not.toMatch(/ImageMapType[\s\S]{0,400}DSO_LAYER/);
  });

  it("publishes a legend so the colours are readable", () => {
    const entries = legendEntries();
    expect(entries.length).toBe(Object.keys(DSO_COLORS).length);
    expect(entries[0]).toHaveProperty("color");
    expect(html).toMatch(/id="legend"/);
  });
});
