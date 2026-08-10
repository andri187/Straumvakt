// DSO suggestion from coordinates.
//
// THE RULE THIS MODULE EXISTS TO ENFORCE
//
// Postal code is NOT the deciding authority. It is carried through for
// display and search, and it never enters the decision. The Core DSO memo
// names Garðabær as the warning case and the sampled data confirms it: at
// latitude 64.0900 the DSO changes between longitude -21.930 and -21.935,
// roughly 250 metres, while the postal code does not change at all. Any
// resolver that keyed on postnúmer would be confidently wrong there.
//
// WHAT THIS IS, EXACTLY
//
// A nearest-sample resolver over the recorded probes in dso-service-areas.ts
// — a Voronoi approximation of the real polygons. It is NOT point-in-polygon.
// It is honest about that in its `source` field and in its confidence
// grading, and it is shaped so the swap is a one-function change:
//
//   production:  coordinates -> PostGIS ST_Contains over imported polygons
//   here:        coordinates -> nearest recorded sample
//
// Both return the same DsoSuggestion, so the UI and the billing hand-off do
// not care which one answered.
//
// NOTHING HERE MAY BILL. Every result carries
// billingApplicability: "requires-admin-confirmation" — a literal, not a
// computed value — because a suggestion from a frozen sample set is evidence
// for a human decision, not a decision.

import {
  ALL_DSO_SAMPLES,
  classifyAreaType,
  type AreaClass,
  type DsoAreaSample,
  type IcelandicDso,
} from "./dso-service-areas";
import { EARTH_RADIUS_M, type LatLng } from "./web-mercator";

export type DsoConfidence = "exact" | "near-boundary" | "manual-review";

export type DsoSuggestionSource =
  /** Answered from a recorded sample of the real polygon layer. */
  | "polygon-derived-fixture"
  /** No sample close enough to answer from. */
  | "unresolved";

export interface DsoSuggestion {
  dso: IcelandicDso | null;
  /** Upstream `stadur` — the named tariff area within the DSO. */
  serviceArea: string | null;
  areaClass: AreaClass | null;
  areaId: number | null;
  confidence: DsoConfidence;
  source: DsoSuggestionSource;
  /** Always requires a human. Never computed. */
  billingApplicability: "requires-admin-confirmation";
  /** Distance to the sample that answered, metres. */
  distanceM: number | null;
  /** The nearest sample carrying a DIFFERENT DSO, if any. */
  contender: { dso: IcelandicDso; distanceM: number } | null;
  /** Plain-language reason, safe to show a user. */
  explanation: string;
  /** Label of the sample that answered. */
  matchedSampleLabel: string | null;
}

/**
 * Beyond this, a sample is too far away to speak for a coordinate. Sized to
 * the sampling density: urban samples sit within a few km of each other, so
 * 20 km means "there is genuinely nothing near this point".
 */
export const MAX_ATTRIBUTION_DISTANCE_M = 20_000;

/**
 * If the nearest DIFFERENT-DSO sample is within this much of the nearest
 * sample, the point is close to a boundary and a human must confirm it.
 * 2 km comfortably covers the Garðabær case, where the two nearest samples
 * are about 860 m apart.
 */
export const BOUNDARY_MARGIN_M = 2_000;

/** Great-circle distance in metres. */
export function haversineDistanceM(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

function rank(
  point: LatLng,
  samples: readonly DsoAreaSample[],
): { sample: DsoAreaSample; distanceM: number }[] {
  return samples
    .map((sample) => ({ sample, distanceM: haversineDistanceM(point, sample) }))
    .sort((x, y) => x.distanceM - y.distanceM);
}

const NEEDS_HUMAN = "requires-admin-confirmation" as const;

/**
 * Suggest the DSO for a coordinate.
 *
 * Note the argument: a coordinate, not an address and not a postal code.
 * That signature is the guarantee — this function CANNOT consult the postal
 * code, because it is never given one.
 */
export function resolveDso(
  point: LatLng,
  samples: readonly DsoAreaSample[] = ALL_DSO_SAMPLES,
): DsoSuggestion {
  const ranked = rank(point, samples);
  const nearest = ranked[0];

  const unresolved = (explanation: string, distanceM: number | null): DsoSuggestion => ({
    dso: null,
    serviceArea: null,
    areaClass: null,
    areaId: null,
    confidence: "manual-review",
    source: "unresolved",
    billingApplicability: NEEDS_HUMAN,
    distanceM,
    contender: null,
    explanation,
    matchedSampleLabel: nearest?.sample.label ?? null,
  });

  if (!nearest) {
    return unresolved("No service-area data is loaded.", null);
  }

  if (nearest.distanceM > MAX_ATTRIBUTION_DISTANCE_M) {
    return unresolved(
      `The nearest sampled service area is ${formatKm(nearest.distanceM)} away, ` +
        `too far to attribute a distribution operator. Confirm manually.`,
      nearest.distanceM,
    );
  }

  // The nearest recorded probe found no polygon at all. That is a real
  // property of the dataset — the polygons hug built-up areas — and it means
  // there is no automatic answer here, not that the answer is "none".
  if (nearest.sample.dso === null) {
    return unresolved(
      `The distribution-area layer returns no polygon around this location ` +
        `(nearest probe: ${nearest.sample.label}). Sites just outside a built-up ` +
        `area often fall in a gap. Confirm the operator manually.`,
      nearest.distanceM,
    );
  }

  const differing = ranked.find(
    (candidate) => candidate.sample.dso !== null && candidate.sample.dso !== nearest.sample.dso,
  );
  const contender = differing
    ? { dso: differing.sample.dso as IcelandicDso, distanceM: differing.distanceM }
    : null;

  const margin = contender ? contender.distanceM - nearest.distanceM : Infinity;
  const nearBoundary = margin < BOUNDARY_MARGIN_M;

  const base = {
    dso: nearest.sample.dso,
    serviceArea: nearest.sample.serviceArea,
    areaClass: nearest.sample.areaClass ?? classifyAreaType(nearest.sample.rawAreaType),
    areaId: nearest.sample.areaId,
    source: "polygon-derived-fixture" as const,
    billingApplicability: NEEDS_HUMAN,
    distanceM: nearest.distanceM,
    contender,
    matchedSampleLabel: nearest.sample.label,
  };

  if (nearBoundary && contender) {
    return {
      ...base,
      confidence: "near-boundary",
      explanation:
        `${nearest.sample.dso} is nearest (${formatKm(nearest.distanceM)}), but ` +
        `${contender.dso} is only ${formatKm(contender.distanceM)} away. This ` +
        `location sits close to a service-area boundary — the operator must be ` +
        `confirmed before any rate is applied.`,
    };
  }

  return {
    ...base,
    confidence: "exact",
    explanation:
      `Nearest sampled service area is ${nearest.sample.serviceArea} ` +
      `(${nearest.sample.dso}), ${formatKm(nearest.distanceM)} away. The next ` +
      `different operator is ${contender ? formatKm(contender.distanceM) + " away" : "not nearby"}.`,
  };
}

export function formatKm(metres: number): string {
  if (metres < 1000) return `${Math.round(metres)} m`;
  return `${(metres / 1000).toFixed(metres < 10_000 ? 1 : 0)} km`;
}

/** True when a human must look at this before it can reach billing. */
export function needsManualConfirmation(suggestion: DsoSuggestion): boolean {
  return suggestion.confidence !== "exact" || suggestion.dso === null;
}
