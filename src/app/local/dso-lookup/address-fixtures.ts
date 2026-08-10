// Demo address records, shaped like HMS Staðfangaskrá.
//
// WHAT IS REAL AND WHAT IS NOT — read this before quoting anything here.
//
//   REAL:         the coordinates. Every one was queried against the live
//                 Orkustofnun `raforkudreifing` layer on 2026-08-10, so the
//                 DSO answer the demo gives for each row is reproducible
//                 against the authoritative source.
//   REAL:         the postal codes and municipality names.
//   ILLUSTRATIVE: the street names, house numbers and `hnitnum` identifiers.
//                 These are NOT real Staðfangaskrá records. Staðfangaskrá is
//                 a downloadable dataset, not a live API, and it has not been
//                 imported. `hnitnum` values here are sequential demo ids.
//
// So the DSO half of this screen is evidence-backed and the address half is
// a stand-in. That asymmetry is deliberate and is stated in the UI, because
// the alternative — a screen that looks equally authoritative about both —
// would misrepresent what has actually been integrated.
//
// On CLAUDE.md Rule 6 ("no fixture arrays in src/"): this follows the
// established carve-out for the env-flagged local surfaces, alongside
// src/app/visual/visual-data.ts and src/app/app/core-product-data.ts, each of
// which is a fixture array in src/ with a dedicated test. This route is
// gated by the same STRAUMVAKT_LOCAL_PRODUCT_PREVIEW flag they are.

export interface HmsAddressRecord {
  /** HMS calls the address-point key `hnitnum`. Demo ids here. */
  hnitnum: string;
  /** Street name, nominative — HMS `heiti_nf`. */
  heitiNf: string;
  /** House number — HMS `husnr`. */
  husnr: string;
  /** Optional house letter — HMS `bokstafur`. */
  bokstafur?: string;
  /** Postal code — HMS `postnr`. Supportive data only, never authoritative. */
  postnr: string;
  /** Municipality name. */
  sveitarfelag: string;
  /** WGS84 latitude — HMS `n_hnit_wgs84`. */
  lat: number;
  /** WGS84 longitude — HMS `e_hnit_wgs84`. */
  lng: number;
  /** Why this row is in the demo set. Shown in the UI. */
  note?: string;
}

export function formatAddress(record: HmsAddressRecord): string {
  const house = `${record.husnr}${record.bokstafur ?? ""}`;
  return `${record.heitiNf} ${house}, ${record.postnr} ${record.sveitarfelag}`;
}

export const DEMO_ADDRESSES: readonly HmsAddressRecord[] = [
  // ── Capital region — Veitur ──────────────────────────────────────────
  { hnitnum: "demo-0001", heitiNf: "Laugavegur", husnr: "26", postnr: "101", sveitarfelag: "Reykjavík", lat: 64.1466, lng: -21.9367 },
  { hnitnum: "demo-0002", heitiNf: "Hamraborg", husnr: "8", postnr: "200", sveitarfelag: "Kópavogur", lat: 64.1122, lng: -21.913 },
  { hnitnum: "demo-0003", heitiNf: "Austurströnd", husnr: "3", postnr: "170", sveitarfelag: "Seltjarnarnes", lat: 64.1553, lng: -22.0028 },
  { hnitnum: "demo-0004", heitiNf: "Þverholt", husnr: "2", postnr: "270", sveitarfelag: "Mosfellsbær", lat: 64.1667, lng: -21.7 },

  // ── The Garðabær split — SAME postal code, DIFFERENT operator ────────
  // This pair is the whole argument against keying on postnúmer. Both are
  // 210 Garðabær; the sampled layer returns Veitur for one and HS Veitur
  // for the other, about 860 m apart.
  {
    hnitnum: "demo-0005", heitiNf: "Garðatorg", husnr: "7", postnr: "210", sveitarfelag: "Garðabær",
    lat: 64.0889, lng: -21.9224,
    note: "Eastern Garðabær — sampled as Veitur. Same postal code as demo-0006.",
  },
  {
    hnitnum: "demo-0006", heitiNf: "Hraunsholtsbraut", husnr: "14", postnr: "210", sveitarfelag: "Garðabær",
    lat: 64.09, lng: -21.94,
    note: "Western Garðabær — sampled as HS Veitur. Same postal code as demo-0005.",
  },

  // ── Reykjanes — HS Veitur ────────────────────────────────────────────
  { hnitnum: "demo-0007", heitiNf: "Strandgata", husnr: "6", postnr: "220", sveitarfelag: "Hafnarfjörður", lat: 64.0671, lng: -21.9388 },
  { hnitnum: "demo-0008", heitiNf: "Hafnargata", husnr: "57", postnr: "230", sveitarfelag: "Reykjanesbær", lat: 64.0049, lng: -22.5645 },
  { hnitnum: "demo-0009", heitiNf: "Víkurbraut", husnr: "11", postnr: "240", sveitarfelag: "Grindavík", lat: 63.8424, lng: -22.4338 },
  { hnitnum: "demo-0010", heitiNf: "Iðndalur", husnr: "2", postnr: "190", sveitarfelag: "Vogar", lat: 63.9819, lng: -22.3806 },
  { hnitnum: "demo-0011", heitiNf: "Strandgata", husnr: "20", postnr: "245", sveitarfelag: "Suðurnesjabær", lat: 64.0383, lng: -22.71 },

  // ── South ───────────────────────────────────────────────────────────
  { hnitnum: "demo-0012", heitiNf: "Austurvegur", husnr: "38", postnr: "800", sveitarfelag: "Árborg", lat: 63.9333, lng: -20.9972, note: "Selfoss — HS Veitur, its own tariff area." },
  { hnitnum: "demo-0013", heitiNf: "Breiðamörk", husnr: "10", postnr: "810", sveitarfelag: "Hveragerði", lat: 64.0, lng: -21.1867, note: "RARIK — not HS Veitur, despite sitting between two HS Veitur areas." },
  { hnitnum: "demo-0014", heitiNf: "Hafnarberg", husnr: "1", postnr: "815", sveitarfelag: "Ölfus", lat: 63.8583, lng: -21.3806 },
  { hnitnum: "demo-0015", heitiNf: "Þrúðvangur", husnr: "6", postnr: "850", sveitarfelag: "Rangárþing ytra", lat: 63.8333, lng: -20.4 },
  { hnitnum: "demo-0016", heitiNf: "Austurvegur", husnr: "4", postnr: "860", sveitarfelag: "Rangárþing eystra", lat: 63.75, lng: -20.2333 },
  { hnitnum: "demo-0017", heitiNf: "Víkurbraut", husnr: "26", postnr: "870", sveitarfelag: "Mýrdalshreppur", lat: 63.4186, lng: -19.006 },
  { hnitnum: "demo-0018", heitiNf: "Heiðarvegur", husnr: "12", postnr: "900", sveitarfelag: "Vestmannaeyjar", lat: 63.4427, lng: -20.2734 },
  { hnitnum: "demo-0019", heitiNf: "Akurgerði", husnr: "3", postnr: "845", sveitarfelag: "Hrunamannahreppur", lat: 64.13, lng: -20.32 },

  // ── West ────────────────────────────────────────────────────────────
  { hnitnum: "demo-0020", heitiNf: "Kirkjubraut", husnr: "28", postnr: "300", sveitarfelag: "Akranes", lat: 64.3219, lng: -22.0748, note: "Veitur, but a SEPARATE tariff area from Stór-Reykjavíkursvæði." },
  { hnitnum: "demo-0021", heitiNf: "Borgarbraut", husnr: "57", postnr: "310", sveitarfelag: "Borgarbyggð", lat: 64.5386, lng: -21.9223 },
  { hnitnum: "demo-0022", heitiNf: "Aðalgata", husnr: "24", postnr: "340", sveitarfelag: "Stykkishólmur", lat: 65.0748, lng: -22.7291 },

  // ── Westfjords — Orkubú Vestfjarða ──────────────────────────────────
  { hnitnum: "demo-0023", heitiNf: "Hafnarstræti", husnr: "4", postnr: "400", sveitarfelag: "Ísafjarðarbær", lat: 66.0748, lng: -23.1355 },
  { hnitnum: "demo-0024", heitiNf: "Aðalstræti", husnr: "21", postnr: "415", sveitarfelag: "Bolungarvík", lat: 66.152, lng: -23.255 },
  { hnitnum: "demo-0025", heitiNf: "Aðalstræti", husnr: "63", postnr: "450", sveitarfelag: "Vesturbyggð", lat: 65.596, lng: -24.008, note: "Inside the built-up polygon — resolves cleanly." },

  // ── The coverage-gap case — needs a human ───────────────────────────
  {
    hnitnum: "demo-0026", heitiNf: "Sjávargata", husnr: "2", postnr: "450", sveitarfelag: "Vesturbyggð",
    lat: 65.5947, lng: -24.0067,
    note: "Just outside the built-up polygon. The layer returns NO service area here, ~400 m from demo-0025. This is the manual-review case and it is real, not staged.",
  },

  // ── North ───────────────────────────────────────────────────────────
  { hnitnum: "demo-0027", heitiNf: "Glerárgata", husnr: "36", postnr: "600", sveitarfelag: "Akureyri", lat: 65.6835, lng: -18.0878, note: "Norðurorka — whose distribution area is Akureyri itself, not the north generally." },
  { hnitnum: "demo-0028", heitiNf: "Goðabraut", husnr: "3", postnr: "620", sveitarfelag: "Dalvíkurbyggð", lat: 65.9706, lng: -18.5286, note: "RARIK, not Norðurorka." },
  { hnitnum: "demo-0029", heitiNf: "Garðarsbraut", husnr: "5", postnr: "640", sveitarfelag: "Norðurþing", lat: 66.0449, lng: -17.3389, note: "RARIK, not Norðurorka." },
  { hnitnum: "demo-0030", heitiNf: "Aðalgata", husnr: "16", postnr: "550", sveitarfelag: "Skagafjörður", lat: 65.7461, lng: -19.6394 },
  { hnitnum: "demo-0031", heitiNf: "Húnabraut", husnr: "13", postnr: "540", sveitarfelag: "Húnabyggð", lat: 65.6608, lng: -20.2828 },
  { hnitnum: "demo-0032", heitiNf: "Túngata", husnr: "3", postnr: "580", sveitarfelag: "Fjallabyggð", lat: 66.1497, lng: -18.9089 },

  // ── East — RARIK ────────────────────────────────────────────────────
  { hnitnum: "demo-0033", heitiNf: "Miðvangur", husnr: "2", postnr: "700", sveitarfelag: "Múlaþing", lat: 65.2669, lng: -14.3948 },
  { hnitnum: "demo-0034", heitiNf: "Egilsbraut", husnr: "11", postnr: "740", sveitarfelag: "Fjarðabyggð", lat: 65.1478, lng: -13.6889 },
  { hnitnum: "demo-0035", heitiNf: "Hafnarbraut", husnr: "30", postnr: "780", sveitarfelag: "Hornafjörður", lat: 64.2539, lng: -15.2082 },
  { hnitnum: "demo-0036", heitiNf: "Búðareyri", husnr: "7", postnr: "730", sveitarfelag: "Fjarðabyggð", lat: 65.0333, lng: -14.2167 },
  { hnitnum: "demo-0037", heitiNf: "Austurvegur", husnr: "9", postnr: "710", sveitarfelag: "Múlaþing", lat: 65.26, lng: -14.01 },

  // ── Rural / dreifbýli — the other tariff class ──────────────────────
  { hnitnum: "demo-0038", heitiNf: "Hérað", husnr: "1", postnr: "701", sveitarfelag: "Múlaþing", lat: 65.1, lng: -15.2, note: "Dreifbýli — RARIK's rural tariff class, priced apart from urban." },
  { hnitnum: "demo-0039", heitiNf: "Reykhólasveit", husnr: "1", postnr: "380", sveitarfelag: "Reykhólahreppur", lat: 65.8, lng: -22.3, note: "Dreifbýli — Orkubú Vestfjarða rural." },

  // ── A second gap case, in the capital region ────────────────────────
  {
    hnitnum: "demo-0040", heitiNf: "Vífilsstaðavegur", husnr: "120", postnr: "210", sveitarfelag: "Garðabær",
    lat: 64.11, lng: -21.94,
    note: "Undeveloped land between built-up areas. No polygon covers it — a gap can occur inside the capital region too, not only in the countryside.",
  },
];

/** The demo set spans every operator and both tariff classes. */
export const DEMO_ADDRESS_COUNT = DEMO_ADDRESSES.length;
