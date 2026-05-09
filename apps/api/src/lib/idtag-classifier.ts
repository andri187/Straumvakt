// Sprint 9 / 2026-05-09 — ADR 0021 Autocharge Step D
// idTag format classifier.
//
// OCPP 1.6 carries the user's identifier in a single opaque CiString20
// field — Authorize.req.idTag and StartTransaction.req.idTag. The
// protocol doesn't distinguish between "RFID UID" and "eMAID contract"
// and "vehicle MAC" — they all flow through the same string field.
//
// Some vendors and roaming providers encode different identity types in
// idTag with no out-of-band signalling. To present them correctly to
// operators (and eventually to feed the right downstream
// classification, e.g. routing PnC sessions distinctly from RFID
// sessions), we run a pattern classifier against any idTag we observe.
//
// Confidence:
//   high    — the input matches the format unambiguously and the
//             format is rare enough that false positives are unlikely.
//   medium  — the input matches a format but the same input could
//             plausibly be a different format (12 hex chars could
//             be a MAC OR a random RFID UID).
//   low     — the input has the right shape but no corroborating
//             evidence (e.g. a 12-hex string with no recognisable
//             OUI prefix).
//
// The classifier is heuristic-only — it reports what the input *looks
// like*, not what it definitively is. Downstream code should treat the
// confidence flag as advisory.

import { lookupOuiVendor } from "./oui/lookup";

export type IdTagKind =
  | "iso14443_4byte"   // MIFARE Classic 4-byte UID — 8 hex chars
  | "iso14443_7byte"   // DESFire / Zaptec Default ID tag — 14 hex chars
  | "evccid_mac"       // EV PLC modem MAC — 12 hex chars, possibly with OUI vendor match
  | "emaid"            // ISO 15118 PnC contract identifier
  | "key_code"         // Numeric short code (e.g. 4-8 digit PIN)
  | "unknown";

export type Confidence = "high" | "medium" | "low";

export interface ClassifyResult {
  detectedKind: IdTagKind;
  confidence: Confidence;
  /** Optional metadata — populated for some kinds:
   *   evccid_mac: { vendor: "Tesla" | ... | null }
   *   emaid:      { country, provider, instance, check }
   */
  meta?: Record<string, string | null>;
}

/**
 * Strip whitespace and common separators (`:`, `-`, `.`, ` `) and
 * uppercase. Used as the first step in every classification path.
 */
function normalize(input: string): string {
  return input.replace(/[\s:.\-_]/g, "").toUpperCase();
}

/**
 * EMAID: ISO 15118 / Hubject-defined contract identifier.
 * Structure: 2 char country + 3 char provider + 9 char instance + 1 char check.
 * Total 15 alphanumeric uppercase chars after separator-stripping.
 */
const EMAID_PATTERN = /^([A-Z]{2})([A-Z0-9]{3})([A-Z0-9]{9})([A-Z0-9])$/;

/**
 * Classify an idTag string into one of the known formats. Tolerates
 * any common case / separator variation.
 *
 * Returns `{ detectedKind: "unknown", confidence: "low" }` for empty,
 * null, or unrecognisable input — never throws.
 */
export function classifyIdTagFormat(
  idTag: string | null | undefined,
): ClassifyResult {
  if (!idTag) {
    return { detectedKind: "unknown", confidence: "low" };
  }
  const stripped = normalize(idTag);
  if (stripped.length === 0) {
    return { detectedKind: "unknown", confidence: "low" };
  }

  const isHex = /^[0-9A-F]+$/.test(stripped);
  const isAlphaNum = /^[A-Z0-9]+$/.test(stripped);
  const isAllDigits = /^[0-9]+$/.test(stripped);

  // Numeric short — key codes / PINs / scratch-card numbers
  if (isAllDigits && stripped.length >= 4 && stripped.length <= 8) {
    return { detectedKind: "key_code", confidence: "medium" };
  }

  // 8 hex chars → ISO 14443 4-byte UID. Very common; what most
  // MIFARE Classic cards present and what Zaptec auto-mints from
  // mintRfidValue() in id-tokens.ts.
  if (isHex && stripped.length === 8) {
    return { detectedKind: "iso14443_4byte", confidence: "high" };
  }

  // 14 hex chars → ISO 14443 7-byte UID (DESFire). Also the format
  // Zaptec uses for the Default ID tag synthesised in free-vend mode
  // (e.g. EE43C609263CC7 at Dalvegur 10).
  if (isHex && stripped.length === 14) {
    return { detectedKind: "iso14443_7byte", confidence: "high" };
  }

  // 12 hex chars → could be a MAC. Check OUI prefix; if it matches a
  // known vendor in our table, confidence bumps up because random
  // 12-hex strings rarely collide with assigned OUIs.
  if (isHex && stripped.length === 12) {
    const oui = lookupOuiVendor(stripped);
    if (oui.vendor) {
      return {
        detectedKind: "evccid_mac",
        confidence: "high",
        meta: { vendor: oui.vendor, oui: oui.oui },
      };
    }
    // Plausible MAC but no OUI match — could also be a random 12-hex
    // RFID UID, though that's an unusual length for ISO 14443.
    return {
      detectedKind: "evccid_mac",
      confidence: "low",
      meta: { vendor: null, oui: oui.oui },
    };
  }

  // EMAID — ISO 15118 PnC contract identifier
  if (isAlphaNum && stripped.length === 15) {
    const m = EMAID_PATTERN.exec(stripped);
    if (m) {
      return {
        detectedKind: "emaid",
        confidence: "high",
        meta: {
          country: m[1] ?? null,
          provider: m[2] ?? null,
          instance: m[3] ?? null,
          check: m[4] ?? null,
        },
      };
    }
  }

  // No pattern match.
  return { detectedKind: "unknown", confidence: "low" };
}

/**
 * Convenience — humanly-readable label for a detected kind. Used by
 * the operator UI for badges.
 */
export function idTagKindLabel(kind: IdTagKind): string {
  switch (kind) {
    case "iso14443_4byte":
      return "RFID (4-byte UID)";
    case "iso14443_7byte":
      return "RFID (7-byte UID)";
    case "evccid_mac":
      return "Vehicle MAC (EVCCID)";
    case "emaid":
      return "EMAID (PnC contract)";
    case "key_code":
      return "Numeric code";
    case "unknown":
      return "Unknown format";
  }
}
