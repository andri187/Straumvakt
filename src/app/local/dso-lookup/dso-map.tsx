"use client";

// The map, built without a mapping library.
//
// There is no leaflet/maplibre/openlayers in this worktree and no new
// dependency may be installed, so the map is a stack of absolutely
// positioned <img> elements:
//
//   layer 1  OpenStreetMap raster tiles, placed by slippy-tile maths
//   layer 2  one WMS GetMap PNG of the DSO service areas, covering the
//            whole viewport in the SAME projection as the tiles
//   layer 3  a CSS-positioned marker
//
// Everything that decides a position lives in web-mercator.ts and wms.ts and
// is unit-tested. This file only turns those numbers into elements, which is
// why it holds no useEffect and no measurement: the component renders the
// same output on the server and the client, so an SSR-string test of it is
// meaningful rather than a test of an empty shell.
//
// The consequence of having no measurement is a FIXED logical viewport. On a
// narrow screen the map is cropped symmetrically rather than reflowed. The
// result panel beside it carries the full answer in text, so nothing is
// only available to someone who can see the map.

import {
  buildGetMapUrl,
  buildTileUrl,
  DSO_LAYERS,
  OSM_ATTRIBUTION,
  WMS_ATTRIBUTION,
  type DsoLayerId,
} from "./wms";
import {
  projectToViewportPx,
  tilesForViewport,
  TILE_SIZE_PX,
  type LatLng,
  type Viewport,
} from "./web-mercator";
import { describeMap, describeMapBriefly } from "./map-description";
import type { DsoSuggestion } from "./dso-resolve";

export interface DsoMapProps {
  viewport: Viewport;
  layer: DsoLayerId;
  showOverlay: boolean;
  marker?: LatLng | null;
  markerLabel?: string;
  suggestion?: DsoSuggestion | null;
}

export function DsoMap({
  viewport,
  layer,
  showOverlay,
  marker,
  markerLabel,
  suggestion,
}: DsoMapProps) {
  const tiles = tilesForViewport(viewport);
  const overlayUrl = buildGetMapUrl(layer, viewport);
  const markerPx = marker ? projectToViewportPx(marker, viewport) : null;
  const meta = DSO_LAYERS[layer];
  const description = { viewport, layer, showOverlay, marker, markerLabel, suggestion };

  return (
    <>
    <div
      className="relative overflow-hidden border border-bg-border bg-bg-surface"
      style={{ height: viewport.heightPx }}
      role="img"
      aria-label={describeMapBriefly(description)}
    >
      <div
        className="absolute top-0"
        style={{
          width: viewport.widthPx,
          height: viewport.heightPx,
          left: "50%",
          marginLeft: -viewport.widthPx / 2,
        }}
      >
        {tiles.map((tile) => (
          <img
            key={`${tile.z}/${tile.x}/${tile.y}`}
            src={buildTileUrl(tile.z, tile.x, tile.y)}
            alt=""
            aria-hidden="true"
            width={TILE_SIZE_PX}
            height={TILE_SIZE_PX}
            loading="lazy"
            className="absolute max-w-none select-none"
            style={{ left: tile.left, top: tile.top }}
          />
        ))}

        {showOverlay ? (
          <img
            src={overlayUrl}
            alt=""
            aria-hidden="true"
            width={Math.round(viewport.widthPx)}
            height={Math.round(viewport.heightPx)}
            className="absolute left-0 top-0 max-w-none select-none"
            style={{ opacity: meta.opacity }}
          />
        ) : null}

        {markerPx ? (
          <div
            className="absolute z-10"
            style={{ left: markerPx.x, top: markerPx.y, transform: "translate(-50%, -100%)" }}
          >
            <div className="flex flex-col items-center">
              <span className="whitespace-nowrap border border-brand-300/60 bg-bg-base/90 px-2 py-1 text-[11px] font-medium text-ink-50 shadow-lg">
                {markerLabel ?? "Selected address"}
              </span>
              <span className="h-3 w-px bg-brand-300" />
              <span className="-mt-[3px] h-2 w-2 rotate-45 border border-brand-300 bg-brand-300/80" />
            </div>
          </div>
        ) : null}
      </div>

      <p className="pointer-events-none absolute bottom-0 right-0 z-20 bg-bg-base/80 px-2 py-1 text-[10px] text-ink-500">
        {OSM_ATTRIBUTION} · {WMS_ATTRIBUTION}
      </p>
    </div>

    {/*
      The same content as prose. Not hidden behind a screen-reader-only
      class: the map is a fixed logical size that crops on narrow screens,
      and its imagery is remote, so a sighted user on a phone or a bad
      connection needs this just as much.
    */}
    <details className="mt-2 border border-bg-border bg-bg-surface text-xs">
      <summary className="cursor-pointer px-3 py-2 text-ink-400 hover:text-ink-50">
        Text description of this map
      </summary>
      <ul className="grid gap-1 border-t border-bg-border px-4 py-3 text-[11px] leading-relaxed text-ink-400">
        {describeMap(description).map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </details>
    </>
  );
}
