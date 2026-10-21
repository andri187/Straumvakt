// WMS request builders for the Orkustofnun DSO service-area layers.
//
// These build URLs. They do not fetch: the <img> tag does the fetching, and
// keeping the URL construction pure is what makes it testable in a worktree
// with no DOM.
//
// The service is the public Icelandic OGC endpoint already used by the local
// prototype (Documents/New project/maps/orkusparsvaedi-local-map-2026-08-10
// .html). Verified live on 2026-08-10 via GetCapabilities: both layers are
// present, `raforkudreifing` is queryable="1", and EPSG:3857 is advertised.

import {
  type LatLng,
  type Viewport,
  viewportMercatorBBox,
} from "./web-mercator";

export const WMS_BASE = "https://ogc.gis.is/geoserver/orkustofnun/ows";

/**
 * The two layers this screen may request. An allowlist rather than a free
 * string so a caller cannot turn a layer name into an injection point in the
 * query string.
 */
export const DSO_LAYERS = {
  /** Electricity DISTRIBUTION service areas — the DSO authority layer. */
  raforkudreifing: {
    id: "raforkudreifing",
    label: "Raforkudreifing",
    description: "Electricity distribution service areas (the DSO authority layer)",
    opacity: 0.62,
  },
  /** Energy FORECAST areas. Shown only for visual comparison. */
  orkusparsvaedi: {
    id: "orkusparsvaedi",
    label: "Orkuspársvæði",
    description: "Energy forecast areas — comparison only, NOT a DSO authority",
    opacity: 0.55,
  },
} as const;

export type DsoLayerId = keyof typeof DSO_LAYERS;

export function isDsoLayerId(value: string): value is DsoLayerId {
  return Object.prototype.hasOwnProperty.call(DSO_LAYERS, value);
}

/** OpenStreetMap raster tiles. Attribution is required by the OSM licence. */
export const OSM_TILE_TEMPLATE = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
export const OSM_ATTRIBUTION = "© OpenStreetMap contributors";
export const WMS_ATTRIBUTION = "Raforkudreifing © Orkustofnun / ogc.gis.is";

export function buildTileUrl(z: number, x: number, y: number): string {
  for (const [name, value] of [["z", z], ["x", x], ["y", y]] as const) {
    if (!Number.isInteger(value)) throw new Error(`tile_${name}_must_be_integer`);
  }
  if (z < 0 || z > 22) throw new Error("tile_z_out_of_range");
  const max = Math.pow(2, z);
  if (x < 0 || x >= max || y < 0 || y >= max) throw new Error("tile_xy_out_of_range");
  return OSM_TILE_TEMPLATE.replace("{z}", String(z))
    .replace("{x}", String(x))
    .replace("{y}", String(y));
}

/**
 * A WMS 1.3.0 GetMap URL covering exactly the viewport.
 *
 * EPSG:3857 is deliberate — see the note in web-mercator.ts. In WMS 1.3.0
 * the BBOX axis order follows the CRS definition; EPSG:3857 is easting-first,
 * so minX,minY,maxX,maxY is correct here. (EPSG:4326 would be latitude-first
 * and is the classic way to get a silently transposed map.)
 */
export function buildGetMapUrl(layer: DsoLayerId, viewport: Viewport): string {
  if (!isDsoLayerId(layer)) throw new Error(`unknown_layer:${layer}`);
  if (viewport.widthPx <= 0 || viewport.heightPx <= 0) {
    throw new Error("viewport_must_have_positive_size");
  }
  const bbox = viewportMercatorBBox(viewport);
  const params = new URLSearchParams({
    SERVICE: "WMS",
    VERSION: "1.3.0",
    REQUEST: "GetMap",
    LAYERS: layer,
    STYLES: "",
    CRS: "EPSG:3857",
    BBOX: [bbox.minX, bbox.minY, bbox.maxX, bbox.maxY].map((n) => n.toFixed(3)).join(","),
    WIDTH: String(Math.round(viewport.widthPx)),
    HEIGHT: String(Math.round(viewport.heightPx)),
    FORMAT: "image/png",
    TRANSPARENT: "TRUE",
  });
  return `${WMS_BASE}?${params.toString()}`;
}

/**
 * A GetFeatureInfo URL for one coordinate.
 *
 * NOT called by this screen. It is exported because it documents — in
 * executable form — the exact request the production DSO resolver will make
 * once the polygons are imported, and because the fixture data in
 * dso-service-areas.ts was harvested with precisely this request shape. The
 * demo resolves offline; see dso-resolve.ts.
 */
export function buildGetFeatureInfoUrl(
  layer: DsoLayerId,
  point: LatLng,
  halfSpanDeg = 0.0025,
): string {
  if (!isDsoLayerId(layer)) throw new Error(`unknown_layer:${layer}`);
  const bbox = [
    point.lng - halfSpanDeg,
    point.lat - halfSpanDeg,
    point.lng + halfSpanDeg,
    point.lat + halfSpanDeg,
  ].join(",");
  const params = new URLSearchParams({
    SERVICE: "WMS",
    VERSION: "1.3.0",
    REQUEST: "GetFeatureInfo",
    LAYERS: layer,
    QUERY_LAYERS: layer,
    CRS: "CRS:84",
    BBOX: bbox,
    WIDTH: "101",
    HEIGHT: "101",
    I: "50",
    J: "50",
    INFO_FORMAT: "application/json",
    FEATURE_COUNT: "5",
  });
  return `${WMS_BASE}?${params.toString()}`;
}
