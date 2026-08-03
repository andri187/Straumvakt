// Tap & Auth — random-UID classifier.
//
// Bench-established 2026-08-02 on a Zaptec Pro ZPR074002 (see
// docs/notes/2026-08-02-tap-and-auth-implementation.md):
//
// A phone held against a charger's RFID reader is read as an ISO 14443-A
// card, but the UID it presents is generated fresh on every activation.
// Nine consecutive taps produced nine distinct values:
//
//   085ACDF6  0831541B  084E1600  08C03B19  0860D1D9
//   080CD5C4  085C2D5D  080E4E80  086884C6
//
// Every one begins with 0x08. That is not coincidence: ISO/IEC 14443-3
// reserves a first UID byte of 0x08 for *randomly generated* single-size
// UIDs, and both Android and iOS card emulation use it. A genuine NXP
// MIFARE product starts with 0x04 (NXP manufacturer code); other real
// manufacturer codes are likewise never 0x08.
//
// So `08` + 6 hex chars is the wire signature of "a phone tapped this
// reader" — an anonymous presence event, never an identity. The tap
// proves someone was physically at the charger; WHO they are comes from
// the tap intent the driver's app registered (see repositories/tap-intents.ts).
//
// Kept as a standalone pure module so the rule is unit-testable without
// a database and so the one place that defines "this is a phone tap"
// cannot drift between the resolver and the operator UI.

/** Length of a random single-size UID in hex characters (4 bytes). */
const RANDOM_UID_HEX_LENGTH = 8;

/**
 * ISO 14443-3 reserved prefix for a randomly generated UID. Cards from
 * real manufacturers never use it — 0x04 is NXP, 0x02/0x05/etc. are
 * other assigned codes.
 */
const RANDOM_UID_PREFIX = "08";

const RANDOM_UID_PATTERN = /^08[0-9A-F]{6}$/;

/**
 * Normalise an idTag as it arrives on the wire. Chargers differ in case
 * and separator habits; Zaptec sends bare uppercase hex over OCPP but
 * labels the same value `nfc-085ACDF6` on its own state observations, so
 * we strip a leading vendor tag as well.
 */
export function normaliseIdTag(idTag: string): string {
  return idTag
    .trim()
    .replace(/^(nfc|rfid|ble)-/i, "")
    .replace(/[\s:.\-_]/g, "")
    .toUpperCase();
}

/**
 * True when the idTag has the shape of a phone-emulated random UID.
 *
 * A `true` result means "treat this as an anonymous tap and look for a
 * matching intent". It is deliberately NOT a claim about which phone —
 * the value is different on every tap by design, so it can never be
 * enrolled, cached, or used as a key.
 *
 * False positives are possible in principle (a card whose UID genuinely
 * starts with 08) but such a card would violate ISO 14443-3, and the
 * consequence is bounded: the resolver would look for a tap intent,
 * find none, and fall through to the normal IdToken lookup.
 */
export function isRandomEmulatedUid(idTag: string | null | undefined): boolean {
  if (!idTag) return false;
  return RANDOM_UID_PATTERN.test(normaliseIdTag(idTag));
}

/**
 * Human-readable label for the operator console, so a support engineer
 * looking at a session never has to wonder what `08C03B19` was.
 */
export function randomUidLabel(idTag: string): string {
  return isRandomEmulatedUid(idTag)
    ? `Phone tap (anonymous UID ${normaliseIdTag(idTag)})`
    : normaliseIdTag(idTag);
}

export const randomUidInternals = {
  RANDOM_UID_HEX_LENGTH,
  RANDOM_UID_PREFIX,
  RANDOM_UID_PATTERN,
} as const;
