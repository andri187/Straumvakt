// Sprint 9 / 2026-05-08 — ADR 0021 Autocharge Step E
// Vendor lookup helper — resolves a MAC address to its IEEE-registered
// vendor name via the OUI table.
//
// Input format flexibility: accepts MAC addresses in any common format:
//   "B4:E6:2D:09:26:3C"   (colon-separated, 6 octets)
//   "B4-E6-2D-09-26-3C"   (dash-separated)
//   "B4E6.2D09.263C"      (dotted, Cisco-style)
//   "B4E62D09263C"        (raw 12 hex chars, no separators)
//   "b4:e6:2d:09:26:3c"   (any case)
//
// All variants normalize to the first 6 hex characters uppercased
// before lookup. The remaining 6 chars (the NIC-specific portion) are
// not used for vendor identification.

import { OUI_INDEX, type OuiCategory } from "./oui-table";

export interface OuiLookupResult {
  /** First 3 bytes of the MAC, 6 uppercase hex chars (e.g. "B4E62D"). Always populated when input was a valid-looking MAC. */
  oui: string | null;
  /** Normalized vendor name (e.g. "Tesla"), null if OUI prefix not in our curated table. */
  vendor: string | null;
  /** IEEE-registered organisation name (forensic), null if not found. */
  vendorRaw: string | null;
  /** Category tag — undefined when vendor is null. */
  category: OuiCategory | null;
}

/**
 * Strip all separator characters from a MAC and uppercase. Rejects
 * inputs that don't yield exactly 12 hex chars.
 */
function normalizeMac(input: string): string | null {
  const stripped = input.replace(/[:.\-\s]/g, "").toUpperCase();
  if (!/^[0-9A-F]{12}$/.test(stripped)) return null;
  return stripped;
}

/**
 * Look up the vendor for a given MAC address. Returns OUI + vendor +
 * raw IEEE name + category, with nulls when the MAC doesn't parse or
 * the OUI prefix isn't in our curated subset.
 *
 * The returned `oui` is always populated when the input was a valid
 * 12-hex-char MAC, even when no vendor match — this lets the UI
 * display "OUI XX:YY:ZZ (unknown vendor)" for forensic reference
 * while still flagging the gap so we know to refresh the table.
 */
export function lookupOuiVendor(mac: string | null | undefined): OuiLookupResult {
  if (!mac) {
    return { oui: null, vendor: null, vendorRaw: null, category: null };
  }
  const normalized = normalizeMac(mac);
  if (!normalized) {
    return { oui: null, vendor: null, vendorRaw: null, category: null };
  }
  const oui = normalized.slice(0, 6);
  const entry = OUI_INDEX.get(oui);
  if (!entry) {
    return { oui, vendor: null, vendorRaw: null, category: null };
  }
  return {
    oui,
    vendor: entry.vendor,
    vendorRaw: entry.vendorRaw,
    category: entry.category,
  };
}

/**
 * Format a MAC for display — colon-separated, lowercase. Tolerates the
 * same input formats as `lookupOuiVendor`. Used for operator UI when
 * we want a canonical displayable form.
 */
export function formatMac(mac: string | null | undefined): string | null {
  if (!mac) return null;
  const normalized = normalizeMac(mac);
  if (!normalized) return null;
  return normalized.match(/.{2}/g)!.join(":").toLowerCase();
}

/**
 * Privacy-preserving redaction for non-privileged views. Returns the
 * MAC with the first three octets replaced by "xx:xx:xx" — preserves
 * the NIC-specific tail (which is per-vehicle but doesn't reveal the
 * vendor). Per ADR 0021 §9.
 */
export function redactMac(mac: string | null | undefined): string | null {
  if (!mac) return null;
  const normalized = normalizeMac(mac);
  if (!normalized) return null;
  const tail = normalized.slice(6).match(/.{2}/g)!.join(":").toLowerCase();
  return `xx:xx:xx:${tail}`;
}
