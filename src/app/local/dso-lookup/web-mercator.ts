// Web Mercator projection maths for the local DSO map.
//
// WHY THIS EXISTS AS A PURE MODULE
//
// This worktree has no mapping library (no leaflet, maplibre, openlayers)
// and no DOM test environment, and no new dependency may be installed. So
// the map is built from plain <img> elements positioned by hand, and every
// piece of maths that decides WHERE something is drawn lives here, where it
// can be unit-tested under `environment: "node"`.
//
// The projection is EPSG:3857 (Web Mercator) rather than CRS:84, and that
// choice is load-bearing. OpenStreetMap tiles are Web Mercator. If a WMS
// overlay is requested in CRS:84 (plate carrée) and then stretched over
// Mercator tiles, the overlay is WRONG everywhere except the centre line —
// and at Iceland's latitude (64-66°N) the vertical error is severe, because
// Mercator stretches the far north hard. Requesting the overlay in the same
// projection as the basemap is what makes the two align exactly.
//
// The local prototype at Documents/New project/maps has this bug: it fetches
// CRS:84 and hands the image to L.imageOverlay with latLng bounds. It looks
// approximately right and is not.

/** Web Mercator's semi-major axis, metres. */
export const EARTH_RADIUS_M = 6_378_137;

/** Half the world in EPSG:3857 metres. The projection is square. */
export const MERCATOR_WORLD_EXTENT_M = Math.PI * EARTH_RADIUS_M; // 20037508.342789244

/** Standard slippy-tile edge length in pixels. */
export const TILE_SIZE_PX = 256;

/**
 * Mercator cannot represent the poles — y goes to infinity. Slippy maps cut
 * at the latitude where the world becomes square.
 */
export const MAX_MERCATOR_LATITUDE = 85.051_128_779_806_59;

export interface LatLng {
  lat: number;
  lng: number;
}

export interface Viewport {
  center: LatLng;
  zoom: number;
  widthPx: number;
  heightPx: number;
}

export interface PixelPoint {
  x: number;
  y: number;
}

function assertFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) throw new Error(`${name}_must_be_finite`);
}

/** Clamp to the Mercator-representable band rather than returning Infinity. */
export function clampLatitude(lat: number): number {
  assertFinite(lat, "lat");
  return Math.max(-MAX_MERCATOR_LATITUDE, Math.min(MAX_MERCATOR_LATITUDE, lat));
}

/** Longitude to EPSG:3857 easting, metres. */
export function lngToMercatorX(lng: number): number {
  assertFinite(lng, "lng");
  return (lng * Math.PI * EARTH_RADIUS_M) / 180;
}

/** Latitude to EPSG:3857 northing, metres. */
export function latToMercatorY(lat: number): number {
  const clamped = clampLatitude(lat);
  const rad = (clamped * Math.PI) / 180;
  return EARTH_RADIUS_M * Math.log(Math.tan(Math.PI / 4 + rad / 2));
}

export function mercatorXToLng(x: number): number {
  assertFinite(x, "x");
  return (x * 180) / (Math.PI * EARTH_RADIUS_M);
}

export function mercatorYToLat(y: number): number {
  assertFinite(y, "y");
  return (Math.atan(Math.sinh(y / EARTH_RADIUS_M)) * 180) / Math.PI;
}

/**
 * Normalised world coordinates in [0,1], origin at the top-left (north-west)
 * corner. This is the space slippy tiles are defined in.
 */
export function latLngToWorldUnit(point: LatLng): PixelPoint {
  return {
    x: (lngToMercatorX(point.lng) + MERCATOR_WORLD_EXTENT_M) / (2 * MERCATOR_WORLD_EXTENT_M),
    y: (MERCATOR_WORLD_EXTENT_M - latToMercatorY(point.lat)) / (2 * MERCATOR_WORLD_EXTENT_M),
  };
}

/** Edge length of the whole world in pixels at this zoom. */
export function worldSizePx(zoom: number): number {
  assertFinite(zoom, "zoom");
  return TILE_SIZE_PX * Math.pow(2, zoom);
}

/** Ground resolution at this zoom, metres per screen pixel. */
export function metresPerPixel(zoom: number): number {
  return (2 * MERCATOR_WORLD_EXTENT_M) / worldSizePx(zoom);
}

/** Absolute world-pixel position at a given zoom. */
export function latLngToWorldPx(point: LatLng, zoom: number): PixelPoint {
  const unit = latLngToWorldUnit(point);
  const size = worldSizePx(zoom);
  return { x: unit.x * size, y: unit.y * size };
}

/** World-pixel coordinate of the viewport's top-left corner. */
export function viewportTopLeftWorldPx(viewport: Viewport): PixelPoint {
  const centre = latLngToWorldPx(viewport.center, viewport.zoom);
  return {
    x: centre.x - viewport.widthPx / 2,
    y: centre.y - viewport.heightPx / 2,
  };
}

/**
 * Where to draw a coordinate inside the viewport, in CSS pixels from the
 * top-left. Values outside [0,width]x[0,height] are off-screen; callers
 * decide whether to clamp, hide, or let it overflow.
 */
export function projectToViewportPx(point: LatLng, viewport: Viewport): PixelPoint {
  const world = latLngToWorldPx(point, viewport.zoom);
  const origin = viewportTopLeftWorldPx(viewport);
  return { x: world.x - origin.x, y: world.y - origin.y };
}

export function isWithinViewport(point: LatLng, viewport: Viewport): boolean {
  const p = projectToViewportPx(point, viewport);
  return p.x >= 0 && p.x <= viewport.widthPx && p.y >= 0 && p.y <= viewport.heightPx;
}

export interface MercatorBBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * The viewport's extent in EPSG:3857 metres — exactly what a WMS GetMap
 * request needs so the returned image lines up pixel-for-pixel with the
 * tiles underneath it.
 */
export function viewportMercatorBBox(viewport: Viewport): MercatorBBox {
  const centreX = lngToMercatorX(viewport.center.lng);
  const centreY = latToMercatorY(viewport.center.lat);
  const mpp = metresPerPixel(viewport.zoom);
  const halfW = (viewport.widthPx / 2) * mpp;
  const halfH = (viewport.heightPx / 2) * mpp;
  return {
    minX: centreX - halfW,
    minY: centreY - halfH,
    maxX: centreX + halfW,
    maxY: centreY + halfH,
  };
}

export interface TilePlacement {
  z: number;
  x: number;
  y: number;
  /** CSS pixel offset of this tile's top-left corner within the viewport. */
  left: number;
  top: number;
}

/**
 * Every slippy tile needed to cover the viewport, with its CSS offset.
 *
 * Tiles that wrap past the antimeridian or above/below the world are
 * dropped rather than requested — Iceland is nowhere near either edge, but
 * a viewport zoomed out far enough would otherwise ask for tile -1.
 */
export function tilesForViewport(viewport: Viewport): TilePlacement[] {
  const z = Math.round(viewport.zoom);
  const origin = viewportTopLeftWorldPx({ ...viewport, zoom: z });
  const tileCount = Math.pow(2, z);

  const firstX = Math.floor(origin.x / TILE_SIZE_PX);
  const firstY = Math.floor(origin.y / TILE_SIZE_PX);
  const lastX = Math.floor((origin.x + viewport.widthPx) / TILE_SIZE_PX);
  const lastY = Math.floor((origin.y + viewport.heightPx) / TILE_SIZE_PX);

  const out: TilePlacement[] = [];
  for (let x = firstX; x <= lastX; x++) {
    for (let y = firstY; y <= lastY; y++) {
      if (x < 0 || y < 0 || x >= tileCount || y >= tileCount) continue;
      out.push({
        z,
        x,
        y,
        left: x * TILE_SIZE_PX - origin.x,
        top: y * TILE_SIZE_PX - origin.y,
      });
    }
  }
  return out;
}

/**
 * The zoom at which `bounds` fits inside a viewport of this size, capped to
 * the given range. Used by the "Iceland" and "Southwest" view buttons so
 * they frame a region rather than guessing a zoom number.
 */
export function zoomToFitBounds(
  southWest: LatLng,
  northEast: LatLng,
  widthPx: number,
  heightPx: number,
  minZoom = 0,
  maxZoom = 19,
): number {
  const sw = latLngToWorldUnit({ lat: southWest.lat, lng: southWest.lng });
  const ne = latLngToWorldUnit({ lat: northEast.lat, lng: northEast.lng });
  const unitW = Math.abs(ne.x - sw.x);
  const unitH = Math.abs(sw.y - ne.y); // y grows southward
  if (unitW === 0 || unitH === 0) return maxZoom;

  const zoomX = Math.log2(widthPx / (unitW * TILE_SIZE_PX));
  const zoomY = Math.log2(heightPx / (unitH * TILE_SIZE_PX));
  return Math.max(minZoom, Math.min(maxZoom, Math.floor(Math.min(zoomX, zoomY))));
}

export function boundsCenter(southWest: LatLng, northEast: LatLng): LatLng {
  return {
    lat: (southWest.lat + northEast.lat) / 2,
    lng: (southWest.lng + northEast.lng) / 2,
  };
}
