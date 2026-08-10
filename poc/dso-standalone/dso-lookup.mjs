// Straumvakt DSO lookup — proof of concept logic.
//
// Standalone. This module is loaded by public/dso-lookup.html and by
// scripts/dso-poc.test.mjs. It touches no Straumvakt API, no tenant data and
// no session. Nothing here reads a global at import time, which is what lets
// the same file be unit-tested under Node with no DOM.
//
// ── What is authoritative and what is not ─────────────────────────────────
//
// GOOGLE provides the map shell and, optionally, address search. Google is
// NOT an authority on Icelandic distribution operators and is never consulted
// for the DSO answer.
//
// ORKUSTOFNUN's `raforkudreifing` layer is the DSO authority. The answer is
// computed by real point-in-polygon against the published vector geometry
// fetched from WFS — not sampled, and not read off a raster image.
//
// POSTAL CODE is never an input to the resolver. `resolveDso` takes a
// coordinate and a feature collection; there is nowhere to put a postnúmer.

export const OGC_BASE = "https://ogc.gis.is/geoserver/orkustofnun/ows";
export const DSO_LAYER = "raforkudreifing";
export const COMPARISON_LAYER = "orkusparsvaedi";

/** Half the world in EPSG:3857 metres. */
export const MERCATOR_HALF_WORLD_M = 20037508.342789244;
export const EARTH_RADIUS_M = 6378137;

// ── Demo gate ─────────────────────────────────────────────────────────────

export const DEMO_USER = "DSO";
export const DEMO_PASS = "map";

/**
 * The POC gate. NOT authentication.
 *
 * It issues no cookie, token or session, and everything it "protects" is
 * public data already present in the page the visitor downloaded. It exists
 * to keep the tool out of a casual visitor's way, and the UI says so.
 */
export function checkCredential(user, pass) {
  if (typeof user !== "string" || typeof pass !== "string") return false;
  return user.trim().toUpperCase() === DEMO_USER && pass === DEMO_PASS;
}

// ── Google Maps key handling ──────────────────────────────────────────────

/**
 * Where a pasted key is remembered. Deliberately the same name the earlier
 * local Google viewer used, so a key already pasted there is picked up here
 * when both are opened from the same origin.
 */
export const MAPS_KEY_STORAGE_KEY = "straumvakt-google-maps-key";

/**
 * Resolve the Maps key from runtime sources, never from source control.
 *
 * Order:
 *   1. ?key= in the URL          — explicit, one-off, wins over everything
 *   2. window.STRAUMVAKT_MAPS_KEY — deploy-time injection or local config file
 *   3. localStorage              — a key the user pasted into this page before
 *
 * Returns null when absent so the UI can ask for one rather than fail silently.
 *
 * Note what this means for deployment: because a key can be pasted at runtime
 * and kept in the browser, the deployed bundle needs NO key baked into it and
 * no Cloudflare secret. A Maps JS key is visible to the client by nature, so
 * the real protection is an HTTP-referrer restriction on the key itself, not
 * secrecy about where it is stored.
 */
export function resolveMapsKey({ search = "", injected = null, stored = null } = {}) {
  const fromQuery = new URLSearchParams(search).get("key");
  const key = (fromQuery || injected || stored || "").trim();
  return key.length > 0 ? key : null;
}

/** Read the remembered key. Safe where storage is unavailable or blocked. */
export function readStoredMapsKey(storage) {
  try {
    return storage?.getItem(MAPS_KEY_STORAGE_KEY) || null;
  } catch {
    return null; // private mode, blocked cookies, etc.
  }
}

export function writeStoredMapsKey(storage, key) {
  try {
    if (key) storage?.setItem(MAPS_KEY_STORAGE_KEY, key);
    return true;
  } catch {
    return false;
  }
}

export function googleMapsScriptUrl(key, { places = true } = {}) {
  if (!key) throw new Error("maps_key_missing");
  const params = new URLSearchParams({ key, v: "weekly" });
  if (places) params.set("libraries", "places");
  return `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
}

// ── WMS overlay, tiled for Google ─────────────────────────────────────────

/**
 * EPSG:3857 bounding box of one slippy tile.
 *
 * Google's ImageMapType hands us a tile coordinate and a zoom; WMS wants a
 * bbox. Requesting EPSG:3857 keeps the overlay in the same projection as the
 * Google basemap, so the two line up exactly. Asking for CRS:84 here would
 * look approximately right and be wrong everywhere but the centre line — the
 * error is severe at Iceland's latitude.
 */
export function tileBBox3857(x, y, zoom) {
  if (!Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(zoom)) {
    throw new Error("tile_coords_must_be_integers");
  }
  const span = (2 * MERCATOR_HALF_WORLD_M) / Math.pow(2, zoom);
  const minX = -MERCATOR_HALF_WORLD_M + x * span;
  const maxY = MERCATOR_HALF_WORLD_M - y * span;
  return { minX, minY: maxY - span, maxX: minX + span, maxY };
}

export function wmsTileUrl(layer, x, y, zoom, tileSize = 256) {
  if (layer !== DSO_LAYER && layer !== COMPARISON_LAYER) {
    throw new Error(`unknown_layer:${layer}`);
  }
  const b = tileBBox3857(x, y, zoom);
  const params = new URLSearchParams({
    SERVICE: "WMS",
    VERSION: "1.3.0",
    REQUEST: "GetMap",
    LAYERS: layer,
    STYLES: "",
    CRS: "EPSG:3857",
    BBOX: [b.minX, b.minY, b.maxX, b.maxY].map((n) => n.toFixed(3)).join(","),
    WIDTH: String(tileSize),
    HEIGHT: String(tileSize),
    FORMAT: "image/png",
    TRANSPARENT: "TRUE",
  });
  return `${OGC_BASE}?${params.toString()}`;
}

/** The WFS request the page uses to load the authoritative geometry. */
export function wfsGeoJsonUrl(layer = DSO_LAYER) {
  if (layer !== DSO_LAYER && layer !== COMPARISON_LAYER) {
    throw new Error(`unknown_layer:${layer}`);
  }
  const params = new URLSearchParams({
    service: "WFS",
    version: "2.0.0",
    request: "GetFeature",
    typeNames: `orkustofnun:${layer}`,
    outputFormat: "application/json",
    srsName: "EPSG:4326",
  });
  return `${OGC_BASE}?${params.toString()}`;
}

// ── Geometry ──────────────────────────────────────────────────────────────

/**
 * Ray casting. `ring` is [[lng,lat], ...] in GeoJSON order.
 *
 * Points exactly on an edge are not guaranteed either way — that is inherent
 * to the algorithm, and it is why a point near an edge is graded
 * `near-boundary` rather than trusted.
 */
export function pointInRing(lng, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const straddles = yi > lat !== yj > lat;
    if (straddles && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** GeoJSON Polygon: [outerRing, ...holes]. */
export function pointInPolygon(lng, lat, polygon) {
  if (!polygon || polygon.length === 0) return false;
  if (!pointInRing(lng, lat, polygon[0])) return false;
  for (let h = 1; h < polygon.length; h++) {
    if (pointInRing(lng, lat, polygon[h])) return false; // in a hole
  }
  return true;
}

export function pointInGeometry(lng, lat, geometry) {
  if (!geometry) return false;
  if (geometry.type === "Polygon") return pointInPolygon(lng, lat, geometry.coordinates);
  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates.some((poly) => pointInPolygon(lng, lat, poly));
  }
  return false;
}

/** Metres per degree at a latitude — good to well under a metre locally. */
function metresPerDegree(lat) {
  const rad = (lat * Math.PI) / 180;
  return {
    lng: (Math.PI / 180) * EARTH_RADIUS_M * Math.cos(rad),
    lat: (Math.PI / 180) * EARTH_RADIUS_M,
  };
}

/** Distance from a point to a segment, in metres, locally projected. */
function distanceToSegmentM(lng, lat, a, b, mpd) {
  const px = (a[0] - lng) * mpd.lng;
  const py = (a[1] - lat) * mpd.lat;
  const qx = (b[0] - lng) * mpd.lng;
  const qy = (b[1] - lat) * mpd.lat;
  const dx = qx - px;
  const dy = qy - py;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px, py);
  let t = -(px * dx + py * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px + t * dx, py + t * dy);
}

/** Shortest distance from a coordinate to any edge of a geometry, in metres. */
export function distanceToGeometryEdgeM(lng, lat, geometry) {
  if (!geometry) return Infinity;
  const mpd = metresPerDegree(lat);
  const polygons =
    geometry.type === "MultiPolygon"
      ? geometry.coordinates
      : geometry.type === "Polygon"
        ? [geometry.coordinates]
        : [];
  let best = Infinity;
  for (const poly of polygons) {
    for (const ring of poly) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const d = distanceToSegmentM(lng, lat, ring[j], ring[i], mpd);
        if (d < best) best = d;
      }
    }
  }
  return best;
}

// ── Attributes ────────────────────────────────────────────────────────────

/**
 * The published `tegund` values, including the misspelling.
 *
 * The dataset really does carry both "Þéttbýli" and "Þéttbyli". These are
 * listed rather than accent-folded so a genuinely new value surfaces as
 * `unknown` instead of being silently absorbed.
 */
export const AREA_TYPE_LABELS = {
  "Þéttbýli": "urban",
  "Þéttbyli": "urban",
  "Dreifbýli": "rural",
  "Byggðakjarni": "settlement-core",
  "Án skilgreiningar": "undefined",
};

export function normaliseAreaType(tegund) {
  if (typeof tegund !== "string") return "unknown";
  return AREA_TYPE_LABELS[tegund.trim()] ?? "unknown";
}

/** `Án skilgreiningar` is a real value meaning the source defines no operator. */
export const UNDEFINED_OPERATOR = "Án skilgreiningar";

export function isDefinedOperator(nafn) {
  return typeof nafn === "string" && nafn.trim().length > 0 && nafn.trim() !== UNDEFINED_OPERATOR;
}

// ── Resolution ────────────────────────────────────────────────────────────

/**
 * How close to an edge counts as "near a boundary".
 *
 * Sized to the DATA, not to a wish. The published geometry carries four
 * decimal places, which at 64°N is about 5 m of longitude and 11 m of
 * latitude, so any claim tighter than roughly 15 m is not supportable. 50 m
 * gives honest headroom above that.
 */
export const NEAR_BOUNDARY_M = 50;

/**
 * Suggest the distribution operator for a coordinate.
 *
 * Takes a coordinate and a GeoJSON FeatureCollection. It cannot see a postal
 * code, a municipality or an address — that is the guarantee, not a habit.
 *
 * Confidence:
 *   exact          inside exactly one operator's area, comfortably off its edge
 *   near-boundary  inside, but within NEAR_BOUNDARY_M of this area's edge, or
 *                  inside overlapping areas naming different operators
 *   manual-review  inside an area whose operator is undefined in the source
 *   no-area        no polygon covers this coordinate
 */
export function resolveDso(lng, lat, featureCollection, { nearBoundaryM = NEAR_BOUNDARY_M } = {}) {
  const features = featureCollection?.features ?? [];
  const hits = [];
  for (const f of features) {
    if (pointInGeometry(lng, lat, f.geometry)) hits.push(f);
  }

  const base = {
    coordinates: { lng, lat },
    source: "raforkudreifing point-in-polygon (WFS vector, EPSG:4326)",
    billingApplicability: "requires-admin-confirmation",
  };

  if (hits.length === 0) {
    return {
      ...base,
      dso: null,
      serviceArea: null,
      areaType: null,
      areaId: null,
      confidence: "no-area",
      edgeDistanceM: null,
      neighbours: [],
      explanation:
        "No distribution-area polygon covers this coordinate. The published areas are " +
        "drawn tightly around served areas and do not tile the whole country, so a site " +
        "just outside one falls in a genuine gap. Confirm the operator manually.",
    };
  }

  const primary = hits[0];
  const props = primary.properties ?? {};
  const edgeDistanceM = distanceToGeometryEdgeM(lng, lat, primary.geometry);
  const operators = [...new Set(hits.map((h) => h.properties?.nafn).filter(Boolean))];

  const shared = {
    ...base,
    dso: isDefinedOperator(props.nafn) ? props.nafn : null,
    serviceArea: props.stadur ?? null,
    areaType: normaliseAreaType(props.tegund),
    rawAreaType: props.tegund ?? null,
    areaId: props.id ?? null,
    edgeDistanceM,
    neighbours: operators.slice(1),
  };

  if (!isDefinedOperator(props.nafn)) {
    return {
      ...shared,
      confidence: "manual-review",
      explanation:
        `The covering area is published as "${UNDEFINED_OPERATOR}" — the source names no ` +
        "distribution operator here. Confirm manually.",
    };
  }

  if (operators.length > 1) {
    return {
      ...shared,
      confidence: "near-boundary",
      explanation:
        `Overlapping published areas name more than one operator here (${operators.join(", ")}). ` +
        "Confirm before applying a rate.",
    };
  }

  if (edgeDistanceM < nearBoundaryM) {
    return {
      ...shared,
      confidence: "near-boundary",
      explanation:
        `Inside ${props.nafn}'s ${props.stadur} area, but only ${Math.round(edgeDistanceM)} m ` +
        `from its edge. Published geometry carries about 5-11 m of coordinate precision, so a ` +
        "point this close to a boundary must be confirmed by a human.",
    };
  }

  return {
    ...shared,
    confidence: "exact",
    explanation:
      `Inside ${props.nafn}'s ${props.stadur} area, ${formatDistance(edgeDistanceM)} from the ` +
      "nearest edge of that area.",
  };
}

export function formatDistance(metres) {
  if (!Number.isFinite(metres)) return "unknown distance";
  if (metres < 1000) return `${Math.round(metres)} m`;
  return `${(metres / 1000).toFixed(1)} km`;
}

// ── Boundary inspection ───────────────────────────────────────────────────

/**
 * Sample points across the Garðabær area, where Veitur and HS Veitur meet.
 *
 * This is the split the Core DSO note flags as the warning case. Probing the
 * live layer on 2026-08-10 put the change between longitude -21.930 and
 * -21.935 at latitude 64.0900 — a few hundred metres, with no postal-code
 * change across it. These points let a reviewer see that for themselves.
 */
export const BOUNDARY_SAMPLES = [
  { label: "Garðabær – Garðatorg", lat: 64.0889, lng: -21.9224 },
  { label: "Garðabær – mid", lat: 64.09, lng: -21.928 },
  { label: "Garðabær – near split (E)", lat: 64.09, lng: -21.93 },
  { label: "Garðabær – near split (W)", lat: 64.09, lng: -21.935 },
  { label: "Garðabær – Hraunsholt", lat: 64.09, lng: -21.94 },
  { label: "Hafnarfjörður", lat: 64.0671, lng: -21.9388 },
  { label: "Kópavogur", lat: 64.1122, lng: -21.913 },
];

export function runBoundaryCheck(featureCollection, samples = BOUNDARY_SAMPLES) {
  return samples.map((s) => ({ ...s, result: resolveDso(s.lng, s.lat, featureCollection) }));
}

// ── Overlay styling ───────────────────────────────────────────────────────
//
// WHY THE OVERLAY IS DRAWN AS VECTORS, NOT AS A WMS IMAGE
//
// The WMS raster carries GeoServer's own SLD styling, and that styling is not
// even-handed: over Google's hybrid imagery the red/pink area reads far
// stronger than the others, so the map looks like it is making a claim about
// which operator matters. We cannot change the server's SLD.
//
// We already fetch the vector geometry for point-in-polygon, so drawing it
// through the Google Data layer costs nothing extra and puts fill and stroke
// opacity under our control. Every operator is then rendered at IDENTICAL
// opacity and stroke weight, and only hue distinguishes them.
//
// The comparison layer (orkusparsvaedi) is still a WMS raster — its vectors
// are not loaded — so it will not be weight-matched to these. It is a
// comparison aid behind an explicit toggle, and the handoff says so.

/** One opacity for every provider. Changing this changes all of them. */
export const FILL_OPACITY = 0.26;
export const STROKE_OPACITY = 0.78;
export const STROKE_WEIGHT = 1.2;

/** Explicit interaction state — the ONLY thing allowed to stand out. */
export const SELECTED_FILL_OPACITY = 0.5;
export const SELECTED_STROKE_OPACITY = 1;
export const SELECTED_STROKE_WEIGHT = 3;

/**
 * Hue per operator. Chosen to stay distinguishable over satellite imagery
 * while carrying equal visual weight; none is a "warning" colour.
 */
export const DSO_COLORS = {
  "Veitur": "#4aa3ff",
  "HS Veitur": "#3ee9a7",
  "RARIK": "#f2c465",
  "Norðurorka": "#c58cf5",
  "Orkubú Vestfjarða": "#ff8f8f",
  [UNDEFINED_OPERATOR]: "#9aa7b8",
};

export const DEFAULT_DSO_COLOR = "#9aa7b8";

export function colorForOperator(nafn) {
  return DSO_COLORS[String(nafn ?? "").trim()] ?? DEFAULT_DSO_COLOR;
}

/**
 * Google Maps Data-layer style for one area.
 *
 * Note what is NOT parameterised: opacity and stroke weight are the same
 * constants for every operator. A future edit cannot make one provider louder
 * without changing them for all, which is the property the test asserts.
 */
export function styleForFeature(nafn, { selected = false } = {}) {
  const color = colorForOperator(nafn);
  return {
    fillColor: color,
    strokeColor: color,
    fillOpacity: selected ? SELECTED_FILL_OPACITY : FILL_OPACITY,
    strokeOpacity: selected ? SELECTED_STROKE_OPACITY : STROKE_OPACITY,
    strokeWeight: selected ? SELECTED_STROKE_WEIGHT : STROKE_WEIGHT,
    zIndex: selected ? 2 : 1,
  };
}

/** Legend rows, so the map's colours are readable rather than guessed at. */
export function legendEntries() {
  return Object.entries(DSO_COLORS).map(([name, color]) => ({ name, color }));
}

// ── Control groups (parent bar -> child bar) ──────────────────────────────
//
// The child control bar is getting crowded, and it is about to hold controls
// for three unrelated data domains. So the parent bar selects the DOMAIN and
// the child bar only ever shows the controls belonging to the active one.
//
// Two kinds of child control exist and the distinction matters:
//   - GENERAL map controls (view presets, base map type) belong to no domain
//     and are always shown. Hiding the "Iceland" button because a data layer
//     is off would be a bug, not a feature.
//   - DOMAIN controls appear and disappear with their parent.
//
// Only `dso` is implemented. `bev` and `forecast` are declared here, disabled,
// so the bar has its final shape and nobody has to guess where they go — but
// they are explicitly NOT ready, and the UI must render them as inert rather
// than as buttons that silently do nothing.

/** Child controls that belong to no domain and are always visible. */
export const GENERAL_CONTROLS = ["view-southwest", "view-iceland", "type-roadmap", "type-hybrid"];

export const CONTROL_GROUPS = [
  {
    id: "dso",
    label: "Dreifiveitusvæði",
    title: "Distribution service areas (Raforkudreifing)",
    ready: true,
    children: ["overlay-toggle", "layer-raforkudreifing", "layer-orkusparsvaedi", "opacity"],
  },
  {
    id: "bev",
    label: "BEV",
    title: "Battery-electric vehicles — not implemented yet",
    ready: false,
    children: [],
  },
  {
    id: "forecast",
    label: "Orkuspá",
    title: "Energy forecast — scope not defined yet",
    ready: false,
    children: [],
  },
];

export function controlGroup(id) {
  return CONTROL_GROUPS.find((g) => g.id === id) ?? null;
}

/**
 * Which child controls should be on screen, given the active parent group.
 *
 * `activeGroupId` of null means every domain is switched off — the general map
 * controls remain, because they are not part of any domain.
 */
export function visibleChildControls(activeGroupId) {
  const group = activeGroupId ? controlGroup(activeGroupId) : null;
  const domain = group && group.ready ? group.children : [];
  return [...GENERAL_CONTROLS, ...domain];
}

/** True when the DSO map layers should be drawn at all. */
export function dsoLayersActive(activeGroupId) {
  return activeGroupId === "dso";
}

/** A group the user may actually select. Unready ones are inert. */
export function isSelectable(id) {
  const g = controlGroup(id);
  return !!g && g.ready === true;
}

// ── Address fixtures (fallback when Places is unavailable) ────────────────

/**
 * Demo address records. NOT Staðfangaskrá — that dataset has not been
 * imported and there is no live HMS API here. Street names are illustrative;
 * the coordinates are real, so the DSO answer for each is reproducible.
 */
export const FIXTURE_ADDRESSES = [
  { label: "Laugavegur 26, 101 Reykjavík", postnr: "101", lat: 64.1466, lng: -21.9367 },
  { label: "Hamraborg 8, 200 Kópavogur", postnr: "200", lat: 64.1122, lng: -21.913 },
  { label: "Garðatorg 7, 210 Garðabær", postnr: "210", lat: 64.0889, lng: -21.9224 },
  { label: "Hraunsholtsbraut 14, 210 Garðabær", postnr: "210", lat: 64.09, lng: -21.94 },
  { label: "Strandgata 6, 220 Hafnarfjörður", postnr: "220", lat: 64.0671, lng: -21.9388 },
  { label: "Hafnargata 57, 230 Reykjanesbær", postnr: "230", lat: 64.0049, lng: -22.5645 },
  { label: "Austurvegur 38, 800 Selfoss", postnr: "800", lat: 63.9333, lng: -20.9972 },
  { label: "Breiðamörk 10, 810 Hveragerði", postnr: "810", lat: 64.0, lng: -21.1867 },
  { label: "Kirkjubraut 28, 300 Akranes", postnr: "300", lat: 64.3219, lng: -22.0748 },
  { label: "Heiðarvegur 12, 900 Vestmannaeyjar", postnr: "900", lat: 63.4427, lng: -20.2734 },
  { label: "Glerárgata 36, 600 Akureyri", postnr: "600", lat: 65.6835, lng: -18.0878 },
  { label: "Hafnarstræti 4, 400 Ísafjörður", postnr: "400", lat: 66.0748, lng: -23.1355 },
  { label: "Miðvangur 2, 700 Egilsstaðir", postnr: "700", lat: 65.2669, lng: -14.3948 },
  { label: "Aðalstræti 63, 450 Patreksfjörður", postnr: "450", lat: 65.596, lng: -24.008 },
];

const FOLD = {
  á: "a", ð: "d", é: "e", í: "i", ó: "o", ú: "u", ý: "y", þ: "th", æ: "ae", ö: "o",
};

export function fold(text) {
  let out = "";
  for (const ch of String(text).toLowerCase()) out += FOLD[ch] ?? ch;
  return out;
}

export function searchFixtures(query, records = FIXTURE_ADDRESSES, limit = 8) {
  const q = fold(query).replace(/[^a-z0-9]+/g, " ").trim();
  if (q.length < 2) return [];
  const terms = q.split(" ");
  return records
    .filter((r) => {
      const hay = fold(r.label);
      return terms.every((t) => hay.includes(t));
    })
    .slice(0, limit);
}
