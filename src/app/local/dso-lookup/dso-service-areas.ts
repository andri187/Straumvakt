// Icelandic DSO service-area samples — harvested from the authoritative layer.
//
// PROVENANCE (this matters; read it before trusting anything here)
//
// Every row below is a RECORDED RESPONSE from the public Orkustofnun WMS at
// https://ogc.gis.is/geoserver/orkustofnun/ows, layer `raforkudreifing`,
// queried with WMS 1.3.0 GetFeatureInfo (INFO_FORMAT=application/json) at the
// exact coordinate stored on the row, on 2026-08-10. The request shape is
// reproduced in executable form by buildGetFeatureInfoUrl() in wms.ts.
//
// So this is not invented data and it is not a guess from postal codes: it is
// a point sample of the real DSO service-area polygons. It IS still a
// fixture, because it is a finite set of samples frozen at a date, not the
// polygons themselves. The production path replaces this file with imported
// polygons and a real point-in-polygon query; nothing else has to change.
//
// WHAT THE SAMPLING TAUGHT US (each of these corrected an assumption)
//
//  1. Hveragerði and Þorlákshöfn are RARIK, not HS Veitur.
//  2. Dalvík, Húsavík and Siglufjörður are RARIK. Norðurorka's distribution
//     area is Akureyri itself — it is much smaller than "the north".
//  3. Borgarnes and Stykkishólmur are RARIK, not Veitur.
//  4. Akranes IS Veitur, but as its OWN service area (id 9), separate from
//     Stór-Reykjavíkursvæði (id 6). Same DSO, different tariff area.
//  5. Garðabær really is split. At latitude 64.0900 the boundary sits between
//     longitude -21.930 (Veitur) and -21.935 (HS Veitur) — about 250 m apart.
//     This is the case the Core DSO memo warns about, and it is why postal
//     code cannot be the deciding authority.
//  6. The polygons are drawn TIGHTLY around built-up areas and do NOT cover
//     the whole country. Patreksfjörður answers at 65.5960,-24.0080 and
//     returns nothing 400 m away. Coverage gaps are normal, not an error, and
//     an address that lands in one has no automatic answer at all.
//
// DATA QUALITY NOTE: the upstream `tegund` field is spelled "Þéttbýli" on
// some rows and "Þéttbyli" (missing accent) on others, and `stadur` carries
// upstream typos too ("Hvólsvöllur", "Neskaupsstaður"). Raw values are kept
// verbatim and normalisation happens in code — never silently correct a
// source you do not own.

/** The five electricity distribution system operators the layer returns. */
export const ICELANDIC_DSOS = [
  "Veitur",
  "HS Veitur",
  "RARIK",
  "Norðurorka",
  "Orkubú Vestfjarða",
] as const;

export type IcelandicDso = (typeof ICELANDIC_DSOS)[number];

/** Tariff class. RARIK and Orkubú Vestfjarða price urban and rural apart. */
export type AreaClass = "urban" | "rural";

export interface DsoAreaSample {
  lat: number;
  lng: number;
  /** null means: the layer returned NO polygon at this coordinate. */
  dso: IcelandicDso | null;
  /** Upstream `stadur` — the named service/tariff area. Verbatim. */
  serviceArea: string | null;
  /** Upstream `tegund`, verbatim, typos included. */
  rawAreaType: string | null;
  areaClass: AreaClass | null;
  /** Upstream `id` of the service-area feature, where one was returned. */
  areaId: number | null;
  /** Human label for the sample location. Ours, not upstream. */
  label: string;
}

/**
 * Normalise the upstream `tegund` value to a tariff class.
 *
 * Both observed spellings of the urban value are matched explicitly rather
 * than by stripping accents: the misspelling is a known property of this
 * dataset, and listing it makes the quirk visible instead of hiding it behind
 * a fold that would also swallow a genuinely new value.
 */
export const RAW_URBAN_SPELLINGS = ["Þéttbýli", "Þéttbyli"] as const;
export const RAW_RURAL_SPELLINGS = ["Dreifbýli", "Dreifbyli"] as const;

export function classifyAreaType(rawAreaType: string | null): AreaClass | null {
  if (!rawAreaType) return null;
  const trimmed = rawAreaType.trim();
  if ((RAW_URBAN_SPELLINGS as readonly string[]).includes(trimmed)) return "urban";
  if ((RAW_RURAL_SPELLINGS as readonly string[]).includes(trimmed)) return "rural";
  return null;
}

const u = "urban" as const;
const r = "rural" as const;

/**
 * Coordinates where the layer RETURNED a service area.
 * Ordered roughly southwest → north → east.
 */
export const DSO_AREA_SAMPLES: readonly DsoAreaSample[] = [
  // Capital region — Veitur, Stór-Reykjavíkursvæði (id 6)
  { lat: 64.1466, lng: -21.9367, dso: "Veitur", serviceArea: "Stór-Reykjavíkursvæði", rawAreaType: "Þéttbýli", areaClass: u, areaId: 6, label: "Reykjavík, miðborg" },
  { lat: 64.1122, lng: -21.913, dso: "Veitur", serviceArea: "Stór-Reykjavíkursvæði", rawAreaType: "Þéttbýli", areaClass: u, areaId: 6, label: "Kópavogur, Hamraborg" },
  { lat: 64.1553, lng: -22.0028, dso: "Veitur", serviceArea: "Stór-Reykjavíkursvæði", rawAreaType: "Þéttbýli", areaClass: u, areaId: 6, label: "Seltjarnarnes" },
  { lat: 64.1667, lng: -21.7, dso: "Veitur", serviceArea: "Stór-Reykjavíkursvæði", rawAreaType: "Þéttbýli", areaClass: u, areaId: 6, label: "Mosfellsbær" },
  // The Garðabær split — 250 m of longitude decides the DSO.
  { lat: 64.0889, lng: -21.9224, dso: "Veitur", serviceArea: "Stór-Reykjavíkursvæði", rawAreaType: "Þéttbýli", areaClass: u, areaId: 6, label: "Garðabær, austurhluti" },
  { lat: 64.09, lng: -21.94, dso: "HS Veitur", serviceArea: "Reykjanes", rawAreaType: "Þéttbýli", areaClass: u, areaId: 1, label: "Garðabær, vesturhluti" },

  // Reykjanes — HS Veitur (id 1)
  { lat: 64.0671, lng: -21.9388, dso: "HS Veitur", serviceArea: "Reykjanes", rawAreaType: "Þéttbýli", areaClass: u, areaId: 1, label: "Hafnarfjörður" },
  { lat: 64.0049, lng: -22.5645, dso: "HS Veitur", serviceArea: "Reykjanes", rawAreaType: "Þéttbýli", areaClass: u, areaId: 1, label: "Reykjanesbær" },
  { lat: 63.8424, lng: -22.4338, dso: "HS Veitur", serviceArea: "Reykjanes", rawAreaType: "Þéttbýli", areaClass: u, areaId: 1, label: "Grindavík" },
  { lat: 63.9819, lng: -22.3806, dso: "HS Veitur", serviceArea: "Reykjanes", rawAreaType: "Þéttbýli", areaClass: u, areaId: 1, label: "Vogar" },
  { lat: 64.0383, lng: -22.71, dso: "HS Veitur", serviceArea: "Reykjanes", rawAreaType: "Þéttbýli", areaClass: u, areaId: 1, label: "Sandgerði" },

  // South — HS Veitur at Selfoss and Vestmannaeyjar, RARIK elsewhere
  { lat: 63.9333, lng: -20.9972, dso: "HS Veitur", serviceArea: "Selfoss", rawAreaType: "Þéttbýli", areaClass: u, areaId: 3, label: "Selfoss (Árborg)" },
  { lat: 63.4427, lng: -20.2734, dso: "HS Veitur", serviceArea: "Vestmannaeyjar", rawAreaType: "Þéttbýli", areaClass: u, areaId: 8, label: "Vestmannaeyjar" },
  { lat: 64.0, lng: -21.1867, dso: "RARIK", serviceArea: "Hveragerði", rawAreaType: "Þéttbyli", areaClass: u, areaId: null, label: "Hveragerði" },
  { lat: 63.8583, lng: -21.3806, dso: "RARIK", serviceArea: "Þorlákshöfn", rawAreaType: "Þéttbyli", areaClass: u, areaId: null, label: "Þorlákshöfn" },
  { lat: 63.8333, lng: -20.4, dso: "RARIK", serviceArea: "Hella", rawAreaType: "Þéttbyli", areaClass: u, areaId: null, label: "Hella" },
  { lat: 63.75, lng: -20.2333, dso: "RARIK", serviceArea: "Hvólsvöllur", rawAreaType: "Þéttbyli", areaClass: u, areaId: null, label: "Hvolsvöllur" },
  { lat: 63.4186, lng: -19.006, dso: "RARIK", serviceArea: "Vík", rawAreaType: "Þéttbyli", areaClass: u, areaId: null, label: "Vík í Mýrdal" },
  { lat: 64.13, lng: -20.32, dso: "RARIK", serviceArea: "Flúðir", rawAreaType: "Þéttbyli", areaClass: u, areaId: null, label: "Flúðir" },

  // West — Akranes is Veitur but its own tariff area (id 9)
  { lat: 64.3219, lng: -22.0748, dso: "Veitur", serviceArea: "Akranes", rawAreaType: "Þéttbýli", areaClass: u, areaId: 9, label: "Akranes" },
  { lat: 64.5386, lng: -21.9223, dso: "RARIK", serviceArea: "Borgarnes", rawAreaType: "Þéttbyli", areaClass: u, areaId: null, label: "Borgarnes" },
  { lat: 65.0748, lng: -22.7291, dso: "RARIK", serviceArea: "Stykkishólmur", rawAreaType: "Þéttbyli", areaClass: u, areaId: null, label: "Stykkishólmur" },

  // Westfjords — Orkubú Vestfjarða
  { lat: 66.0748, lng: -23.1355, dso: "Orkubú Vestfjarða", serviceArea: "Ísafjörður", rawAreaType: "Þéttbýli", areaClass: u, areaId: 16, label: "Ísafjörður" },
  { lat: 66.152, lng: -23.255, dso: "Orkubú Vestfjarða", serviceArea: "Bolungarvík", rawAreaType: "Þéttbýli", areaClass: u, areaId: null, label: "Bolungarvík" },
  { lat: 65.596, lng: -24.008, dso: "Orkubú Vestfjarða", serviceArea: "Patreksfjörður", rawAreaType: "Þéttbýli", areaClass: u, areaId: null, label: "Patreksfjörður, þéttbýliskjarni" },
  { lat: 65.8, lng: -22.3, dso: "Orkubú Vestfjarða", serviceArea: "Vestfirðir", rawAreaType: "Dreifbýli", areaClass: r, areaId: null, label: "Vestfirðir, dreifbýli" },

  // North — Norðurorka is Akureyri only; the rest is RARIK
  { lat: 65.6835, lng: -18.0878, dso: "Norðurorka", serviceArea: "Akureyri", rawAreaType: "Þéttbýli", areaClass: u, areaId: 7, label: "Akureyri" },
  { lat: 65.9706, lng: -18.5286, dso: "RARIK", serviceArea: "Dalvík", rawAreaType: "Þéttbyli", areaClass: u, areaId: null, label: "Dalvík" },
  { lat: 66.0449, lng: -17.3389, dso: "RARIK", serviceArea: "Húsavík", rawAreaType: "Þéttbyli", areaClass: u, areaId: null, label: "Húsavík" },
  { lat: 65.7461, lng: -19.6394, dso: "RARIK", serviceArea: "Sauðárkrókur", rawAreaType: "Þéttbyli", areaClass: u, areaId: null, label: "Sauðárkrókur" },
  { lat: 65.6608, lng: -20.2828, dso: "RARIK", serviceArea: "Blönduós", rawAreaType: "Þéttbyli", areaClass: u, areaId: null, label: "Blönduós" },
  { lat: 66.1497, lng: -18.9089, dso: "RARIK", serviceArea: "Siglufjörður", rawAreaType: "Þéttbyli", areaClass: u, areaId: null, label: "Siglufjörður" },

  // East — RARIK throughout, urban cores plus the rural/highland area
  { lat: 65.2669, lng: -14.3948, dso: "RARIK", serviceArea: "Egilsstaður", rawAreaType: "Þéttbyli", areaClass: u, areaId: 71, label: "Egilsstaðir" },
  { lat: 65.1478, lng: -13.6889, dso: "RARIK", serviceArea: "Neskaupsstaður", rawAreaType: "Þéttbyli", areaClass: u, areaId: null, label: "Neskaupstaður" },
  { lat: 64.2539, lng: -15.2082, dso: "RARIK", serviceArea: "Höfn", rawAreaType: "Þéttbyli", areaClass: u, areaId: null, label: "Höfn í Hornafirði" },
  { lat: 65.0333, lng: -14.2167, dso: "RARIK", serviceArea: "Reyðarfjörður", rawAreaType: "Þéttbyli", areaClass: u, areaId: null, label: "Reyðarfjörður" },
  { lat: 65.26, lng: -14.01, dso: "RARIK", serviceArea: "Seyðisfjörður", rawAreaType: "Þéttbyli", areaClass: u, areaId: null, label: "Seyðisfjörður" },
  { lat: 65.1, lng: -15.2, dso: "RARIK", serviceArea: "Landsbyggð og hálendi", rawAreaType: "Dreifbýli", areaClass: r, areaId: null, label: "Austurland, dreifbýli" },
];

/**
 * Coordinates where the layer returned NOTHING.
 *
 * These are not failures of the query — they are real gaps between tightly
 * drawn polygons, and they are kept because they are the honest source of the
 * `manual-review` outcome. Deleting them would make the demo look more
 * confident than the underlying data supports.
 */
export const DSO_COVERAGE_GAPS: readonly DsoAreaSample[] = [
  { lat: 64.12, lng: -21.94, dso: null, serviceArea: null, rawAreaType: null, areaClass: null, areaId: null, label: "Heiðmörk / Vífilsstaðahlíð" },
  { lat: 64.11, lng: -21.94, dso: null, serviceArea: null, rawAreaType: null, areaClass: null, areaId: null, label: "Vífilsstaðir, óbyggt" },
  { lat: 64.1, lng: -21.94, dso: null, serviceArea: null, rawAreaType: null, areaClass: null, areaId: null, label: "Garðaholt, óbyggt" },
  { lat: 64.1, lng: -22.0, dso: null, serviceArea: null, rawAreaType: null, areaClass: null, areaId: null, label: "Álftanes, vesturströnd" },
  { lat: 64.08, lng: -22.0, dso: null, serviceArea: null, rawAreaType: null, areaClass: null, areaId: null, label: "Arnarnesvogur, óbyggt" },
  { lat: 65.5947, lng: -24.0067, dso: null, serviceArea: null, rawAreaType: null, areaClass: null, areaId: null, label: "Patreksfjörður, utan þéttbýlis" },
  { lat: 65.593, lng: -24.0, dso: null, serviceArea: null, rawAreaType: null, areaClass: null, areaId: null, label: "Patreksfjörður, austan byggðar" },
  { lat: 65.6, lng: -24.02, dso: null, serviceArea: null, rawAreaType: null, areaClass: null, areaId: null, label: "Patreksfjörður, norðan byggðar" },
];

/** Everything the resolver may consult: hits and misses together. */
export const ALL_DSO_SAMPLES: readonly DsoAreaSample[] = [
  ...DSO_AREA_SAMPLES,
  ...DSO_COVERAGE_GAPS,
];

/** When the samples were taken. Surfaced in the UI so the age is visible. */
export const DSO_SAMPLE_HARVEST_DATE = "2026-08-10";
export const DSO_SAMPLE_SOURCE_LAYER = "raforkudreifing";
export const DSO_SAMPLE_SOURCE_SERVICE = "https://ogc.gis.is/geoserver/orkustofnun/ows";
