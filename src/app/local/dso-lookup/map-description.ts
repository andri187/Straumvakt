// A text description of what the map is showing.
//
// WHY THIS IS NOT OPTIONAL
//
// The map is a stack of remote images. Three separate groups of people get
// nothing from it: screen-reader users, anyone on a narrow screen (the
// viewport is a fixed logical size and crops rather than reflowing), and
// anyone whose network drops the tiles or the WMS request. An `alt` string on
// each tile does not help — a tile has no individual meaning.
//
// So the map's content is also produced as prose, from the same numbers the
// map is drawn from. It is rendered visibly rather than hidden behind a
// screen-reader-only class, because "the overlay failed to load" is a state a
// sighted user needs to be able to diagnose too.
//
// Pure, and therefore testable in a worktree with no DOM.

import { DSO_LAYERS, type DsoLayerId } from "./wms";
import { metresPerPixel, type LatLng, type Viewport } from "./web-mercator";
import type { DsoSuggestion } from "./dso-resolve";
import { formatKm } from "./dso-resolve";

/** Decimal degrees to a readable N/S, E/W pair. */
export function formatCoordinates(point: LatLng): string {
  const ns = point.lat >= 0 ? "N" : "S";
  const ew = point.lng >= 0 ? "E" : "W";
  return `${Math.abs(point.lat).toFixed(5)}° ${ns}, ${Math.abs(point.lng).toFixed(5)}° ${ew}`;
}

/** Roughly how wide the visible map is on the ground. */
export function groundWidth(viewport: Viewport): string {
  return formatKm(viewport.widthPx * metresPerPixel(viewport.zoom));
}

export interface MapDescriptionInput {
  viewport: Viewport;
  layer: DsoLayerId;
  showOverlay: boolean;
  marker?: LatLng | null;
  markerLabel?: string;
  suggestion?: DsoSuggestion | null;
}

/**
 * The map as sentences. Each returned string is one statement, so the caller
 * can render them as a list without re-parsing prose.
 */
export function describeMap(input: MapDescriptionInput): string[] {
  const { viewport, layer, showOverlay, marker, markerLabel, suggestion } = input;
  const meta = DSO_LAYERS[layer];
  const lines: string[] = [];

  lines.push(
    `Map of Iceland centred on ${formatCoordinates(viewport.center)}, ` +
      `showing about ${groundWidth(viewport)} across.`,
  );

  lines.push(
    showOverlay
      ? `The ${meta.label} overlay is on. ${meta.description}.`
      : `The ${meta.label} overlay is currently switched off, so only the base map is shown.`,
  );

  if (layer === "orkusparsvaedi" && showOverlay) {
    lines.push(
      "Orkuspársvæði is a forecast layer shown for comparison only. It does not " +
        "determine which company distributes electricity to an address.",
    );
  }

  if (!marker) {
    lines.push("No address is selected, so no location is marked on the map.");
    return lines;
  }

  lines.push(
    `A marker is placed at ${formatCoordinates(marker)}` +
      (markerLabel ? `, labelled ${markerLabel}.` : "."),
  );

  if (!suggestion) return lines;

  if (suggestion.dso === null) {
    lines.push(
      "No distribution operator could be determined for this location. " +
        suggestion.explanation,
    );
  } else {
    lines.push(
      `The marked location falls in the ${suggestion.serviceArea} service area, ` +
        `distributed by ${suggestion.dso}` +
        (suggestion.areaClass
          ? ` (${suggestion.areaClass === "urban" ? "urban" : "rural"} tariff class).`
          : "."),
    );
    if (suggestion.contender) {
      lines.push(
        `The nearest different operator is ${suggestion.contender.dso}, ` +
          `${formatKm(suggestion.contender.distanceM)} away.`,
      );
    }
  }

  lines.push(`Confidence: ${suggestion.confidence}. ${suggestion.explanation}`);
  lines.push(
    "This is a suggestion only. An administrator must confirm the operator " +
      "before it can be used for billing.",
  );

  return lines;
}

/** One-line form, for an aria-label where a list would be unwieldy. */
export function describeMapBriefly(input: MapDescriptionInput): string {
  return describeMap(input).join(" ");
}
