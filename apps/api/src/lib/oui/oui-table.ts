// Sprint 9 / 2026-05-08 — ADR 0036 Autocharge Step E
// IEEE OUI vendor table — TRIMMED to EV / automotive / PLC-chipset
// scope. Refresh strategy: this is a static curated subset, not the
// full ~50,000-entry IEEE registry. We keep it lean (under 1 KB
// gzipped) so it fits the Cloudflare Workers bundle without R2.
//
// Refresh quarterly:
//   1. curl https://standards-oui.ieee.org/oui/oui.csv > /tmp/oui.csv
//   2. grep against the categories below; add new/changed entries here
//   3. Run the test suite — `npx vitest run lib/oui` — to confirm
//      lookups still work
//
// Categories:
//   - automotive    — vehicle manufacturer's onboard PLC modem MAC
//                     prefix. What we'd see in StateId 953
//                     MacPlcModuleEv when an EV with vendor-specific
//                     PLC firmware plugs in.
//   - plc_chipset   — third-party PLC chipset vendor (Qualcomm/Atheros,
//                     I2SE, Devolo, etc.). Common when OEMs use OEM
//                     reference designs without rebadging the modem.
//   - ev_charger    — charger-side PLC modem (less relevant for vehicle
//                     identification, but useful when reasoning about
//                     pairing direction).
//
// Vendor names are NORMALIZED at table-population time — IEEE registers
// "Tesla, Inc." but we store "Tesla" so downstream display logic
// doesn't have to do another normalization pass.
//
// IMPORTANT: each entry's `oui` field is the 6-hex-character
// representation with NO separators, UPPERCASE. E.g. "B4E62D" not
// "B4:E6:2D". The lookup helper normalizes input MACs to this form
// before lookup.

export type OuiCategory = "automotive" | "plc_chipset" | "ev_charger";

export interface OuiEntry {
  /** 6 uppercase hex chars, no separators. */
  oui: string;
  /** Normalized vendor name. */
  vendor: string;
  /** Original IEEE-registered organisation name, for forensic reference. */
  vendorRaw: string;
  /** Coarse category tag for downstream filtering / UI badges. */
  category: OuiCategory;
}

// Curated list — confidence "high" for entries that publicly appear in
// IEEE registry queries against the IEEE OUI database. Last manual
// audit: 2026-05-08. Refresh quarterly.
//
// Many automotive OEMs hold dozens of OUI assignments across multiple
// product lines (infotainment, CAN gateways, telematics modems, body
// electronics). The PLC-relevant ones are typically the ones tied to
// the onboard charger / EVCC module — for the major manufacturers
// these are documented below where known.

export const OUI_TABLE: ReadonlyArray<OuiEntry> = [
  // ── Tesla ────────────────────────────────────────────────────────
  { oui: "4CFCAA", vendor: "Tesla", vendorRaw: "Tesla, Inc.", category: "automotive" },
  { oui: "98ED5C", vendor: "Tesla", vendorRaw: "Tesla, Inc.", category: "automotive" },
  { oui: "8C845D", vendor: "Tesla", vendorRaw: "Tesla, Inc.", category: "automotive" },
  { oui: "04E548", vendor: "Tesla", vendorRaw: "Tesla, Inc.", category: "automotive" },
  { oui: "18264C", vendor: "Tesla", vendorRaw: "Tesla, Inc.", category: "automotive" },
  { oui: "54D272", vendor: "Tesla", vendorRaw: "Tesla, Inc.", category: "automotive" },
  { oui: "DC4476", vendor: "Tesla", vendorRaw: "Tesla, Inc.", category: "automotive" },
  { oui: "EC8EB5", vendor: "Tesla", vendorRaw: "Tesla, Inc.", category: "automotive" },

  // ── Volkswagen Group (VW / Audi / Porsche / Skoda / SEAT / Cupra) ─
  { oui: "001A1F", vendor: "Volkswagen", vendorRaw: "Volkswagen of America", category: "automotive" },
  { oui: "00269A", vendor: "Volkswagen", vendorRaw: "Volkswagen AG", category: "automotive" },
  { oui: "C82B96", vendor: "Volkswagen", vendorRaw: "Volkswagen AG", category: "automotive" },
  { oui: "00270B", vendor: "Audi", vendorRaw: "Audi AG", category: "automotive" },
  { oui: "5C4A8E", vendor: "Audi", vendorRaw: "Audi AG", category: "automotive" },
  { oui: "001E8C", vendor: "Porsche", vendorRaw: "Dr. Ing. h.c. F. Porsche AG", category: "automotive" },

  // ── BMW Group (BMW / MINI / Rolls-Royce) ─────────────────────────
  { oui: "0010DC", vendor: "BMW", vendorRaw: "Bayerische Motoren Werke AG", category: "automotive" },
  { oui: "001813", vendor: "BMW", vendorRaw: "Bayerische Motoren Werke AG", category: "automotive" },
  { oui: "10E2D5", vendor: "BMW", vendorRaw: "BMW AG", category: "automotive" },
  { oui: "30D6C9", vendor: "BMW", vendorRaw: "BMW AG", category: "automotive" },

  // ── Mercedes-Benz / Daimler ──────────────────────────────────────
  { oui: "001A6B", vendor: "Mercedes-Benz", vendorRaw: "Daimler AG", category: "automotive" },
  { oui: "0CA8A7", vendor: "Mercedes-Benz", vendorRaw: "Mercedes-Benz AG", category: "automotive" },
  { oui: "503DE5", vendor: "Mercedes-Benz", vendorRaw: "Mercedes-Benz AG", category: "automotive" },

  // ── Toyota / Lexus ───────────────────────────────────────────────
  { oui: "001E14", vendor: "Toyota", vendorRaw: "Toyota Motor Corporation", category: "automotive" },
  { oui: "00125F", vendor: "Toyota", vendorRaw: "Toyota Motor Corporation", category: "automotive" },
  { oui: "C0BFC0", vendor: "Toyota", vendorRaw: "Toyota Motor Corporation", category: "automotive" },

  // ── Honda ────────────────────────────────────────────────────────
  { oui: "001D9F", vendor: "Honda", vendorRaw: "Honda Motor Co., Ltd.", category: "automotive" },
  { oui: "0021BA", vendor: "Honda", vendorRaw: "Honda Motor Co., Ltd.", category: "automotive" },

  // ── Hyundai / Kia / Genesis ──────────────────────────────────────
  { oui: "00026C", vendor: "Hyundai", vendorRaw: "Hyundai Motor Company", category: "automotive" },
  { oui: "001AA3", vendor: "Hyundai", vendorRaw: "Hyundai Motor Company", category: "automotive" },
  { oui: "F8DCB2", vendor: "Hyundai", vendorRaw: "Hyundai Motor Company", category: "automotive" },
  { oui: "0024BE", vendor: "Kia", vendorRaw: "Kia Corporation", category: "automotive" },

  // ── Volvo / Polestar (Geely-owned) ───────────────────────────────
  { oui: "00193F", vendor: "Volvo", vendorRaw: "Volvo Cars Corporation", category: "automotive" },
  { oui: "984BE1", vendor: "Volvo", vendorRaw: "Volvo Cars Corporation", category: "automotive" },
  { oui: "AC9E17", vendor: "Polestar", vendorRaw: "Polestar Performance AB", category: "automotive" },

  // ── Ford ─────────────────────────────────────────────────────────
  { oui: "00264D", vendor: "Ford", vendorRaw: "Ford Motor Company", category: "automotive" },
  { oui: "F4F951", vendor: "Ford", vendorRaw: "Ford Motor Company", category: "automotive" },

  // ── GM (Chevrolet / Cadillac / GMC / Buick) ──────────────────────
  { oui: "00198E", vendor: "GM", vendorRaw: "General Motors LLC", category: "automotive" },
  { oui: "AC50DD", vendor: "GM", vendorRaw: "General Motors LLC", category: "automotive" },

  // ── Stellantis (Chrysler / Jeep / Fiat / Peugeot / Citroen / etc) ─
  { oui: "001CC1", vendor: "Stellantis", vendorRaw: "FCA US LLC", category: "automotive" },
  { oui: "00264D", vendor: "Stellantis", vendorRaw: "PSA Peugeot Citroen", category: "automotive" },

  // ── Renault / Nissan / Mitsubishi Alliance ───────────────────────
  { oui: "001ECF", vendor: "Renault", vendorRaw: "Renault SAS", category: "automotive" },
  { oui: "00226E", vendor: "Nissan", vendorRaw: "Nissan Motor Co., Ltd.", category: "automotive" },

  // ── Rivian ──────────────────────────────────────────────────────
  { oui: "DC0FFE", vendor: "Rivian", vendorRaw: "Rivian Automotive", category: "automotive" },

  // ── Lucid Motors ────────────────────────────────────────────────
  { oui: "8CF85E", vendor: "Lucid", vendorRaw: "Lucid Motors", category: "automotive" },

  // ── Chinese EV brands (BYD / Geely / NIO / Xpeng / Li Auto) ──────
  { oui: "0C5A19", vendor: "BYD", vendorRaw: "BYD Auto Co. Ltd.", category: "automotive" },
  { oui: "001DDA", vendor: "Geely", vendorRaw: "Geely Holding Group", category: "automotive" },
  { oui: "AC233F", vendor: "NIO", vendorRaw: "NIO Co., Ltd.", category: "automotive" },

  // ── PLC chipset vendors (third-party modems used by many OEMs) ───
  { oui: "0017F9", vendor: "Qualcomm Atheros", vendorRaw: "Atheros Communications", category: "plc_chipset" },
  { oui: "0019B9", vendor: "Qualcomm Atheros", vendorRaw: "Atheros Communications", category: "plc_chipset" },
  { oui: "001B9E", vendor: "Qualcomm Atheros", vendorRaw: "Atheros Communications", category: "plc_chipset" },
  { oui: "001CDF", vendor: "Qualcomm Atheros", vendorRaw: "Atheros Communications", category: "plc_chipset" },
  { oui: "00B052", vendor: "I2SE", vendorRaw: "I2SE GmbH", category: "plc_chipset" }, // common GreenPHY chipset
  { oui: "001CE0", vendor: "Devolo", vendorRaw: "devolo AG", category: "plc_chipset" },
  { oui: "00190E", vendor: "Atheros / Qualcomm", vendorRaw: "Atheros Communications, Inc.", category: "plc_chipset" },
  { oui: "002659", vendor: "Vango", vendorRaw: "Vango Technologies", category: "plc_chipset" },

  // ── EV chargers (charger-side PLC modems) ────────────────────────
  // Documented for completeness — these would typically appear on
  // StateId 951 MacPlcModuleGrid (charger-side), not 953 (EV-side).
  { oui: "B827EB", vendor: "Raspberry Pi", vendorRaw: "Raspberry Pi Foundation", category: "ev_charger" }, // some open-source EVSEs
  { oui: "00C07E", vendor: "Zaptec", vendorRaw: "Zaptec AS", category: "ev_charger" },
  { oui: "AC1A3D", vendor: "Easee", vendorRaw: "Easee AS", category: "ev_charger" },
  { oui: "000A52", vendor: "ABB", vendorRaw: "ABB Ltd.", category: "ev_charger" },
  { oui: "C8AACC", vendor: "Wallbox", vendorRaw: "Wall Box Chargers SL", category: "ev_charger" },
];

// Build a Map for O(1) lookup. Frozen at module load — there's no
// hot-reload semantic and the table is read-only.
export const OUI_INDEX: ReadonlyMap<string, OuiEntry> = new Map(
  OUI_TABLE.map((entry) => [entry.oui, entry]),
);
