// Tap & Auth — tag-tap matching (recovered 2026-08-02).
//
// PROVENANCE. This logic was written in `apps/driver/lib/main.dart`
// (`_onNfcTap`) and was lost when that tree was removed during the
// mobile-workspace consolidation: only the transport helper
// (`nfc_auth.dart` → `nfc/tap_reader.dart`) was carried across, not the
// matching, the guards, or the three-outcome contract. Recovered here
// from git HEAD and reduced to a pure function so it can be unit-tested
// and can never again be lost inside a screen.
//
// WHICH NFC MODEL THIS IS. There are two, and conflating them is what
// caused the loss:
//
//   A. Phone reads a TAG on the charger  ← this file
//      The tag encodes a charger identifier. Works on iOS and Android
//      (reader mode is unrestricted on both). Requires a tag fitted per
//      charger. This is ADR 0024's original decision.
//
//   B. Charger's own RFID reader reads the PHONE  ← lib/tap/tap_intent.dart
//      The charger reports an anonymous, per-tap random UID over OCPP and
//      the server correlates it with a tap intent. No hardware to fit,
//      but Android-only — bench-verified 2026-08-02.
//
// They are complementary, not alternatives, and neither replaces the
// other. See docs/notes/2026-08-02-tap-and-auth-implementation.md.

import '../api/types.dart';

/// What a tag tap resolved to. The UI owes the driver a distinct
/// response for each — silently ignoring an unmatched tap is how a
/// driver ends up standing at a charger wondering if the app is broken.
sealed class TapMatch {
  const TapMatch();
}

/// Tag identified a charger the driver may use. Show the confirm sheet.
class TapMatched extends TapMatch {
  const TapMatched(this.charger);
  final DriverCharger charger;
}

/// Tag identified a real Straumvakt charger the driver has no access to.
/// [label] is the serial when we have one, for the message.
class TapNoAccess extends TapMatch {
  const TapNoAccess(this.label);
  final String? label;
}

/// Tag carried nothing recognisable as a Straumvakt charger.
class TapUnknown extends TapMatch {
  const TapUnknown();
}

/// A charger id shorter than this is a seed/fixture row, never a real
/// charger. Carried over verbatim from the original: **never authorise
/// against one.** Rule 6 in spirit — fixture data must not reach a
/// path that can start a charge.
const int kMinRealChargerIdLength = 30;

final _uuidPattern = RegExp(
  r'[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}',
);
final _serialPattern = RegExp(r'ZPR\d{4,}');

/// Resolve an NDEF payload against the driver's accessible chargers.
///
/// [raw] is the concatenated, upper-cased NDEF text from [NfcTapHit].
/// Matching accepts three encodings so a tag can be written in whichever
/// form is convenient at fitting time:
///   * a charger/connector UUID,
///   * a Zaptec serial (`ZPR074002`),
///   * the charger's exact display name.
TapMatch matchTagPayload(String raw, List<DriverCharger> accessible) {
  final uuid = _uuidPattern.firstMatch(raw)?.group(0);
  final serial = _serialPattern.firstMatch(raw)?.group(0);

  for (final c in accessible) {
    // Seed rows can never authorise a charge.
    if (c.chargerId.length < kMinRealChargerIdLength) continue;

    final advertised = (c.bleAdvertisingId ?? '').toUpperCase();
    final matched = (uuid != null && c.chargerId.toUpperCase() == uuid) ||
        (serial != null && advertised.contains(serial)) ||
        (raw.isNotEmpty && advertised == raw) ||
        (raw.isNotEmpty && c.displayName.toUpperCase() == raw);
    if (matched) return TapMatched(c);
  }

  // Recognised as a Straumvakt charger, but not one this driver may use.
  // Telling them so is a requirement — not silence, and not "unknown tag".
  if (serial != null) return TapNoAccess(serial);
  if (uuid != null) return const TapNoAccess(null);

  return const TapUnknown();
}

/// Gate for whether a tap should be acted on at all. Kept beside the
/// matcher because the original bug surface was a tap firing while a
/// prompt was already open, or repeatedly while the phone rested on a tag.
bool shouldHandleTap({
  required bool tapEnabled,
  required bool isIdle,
  required bool promptOpen,
  required DateTime now,
  required DateTime cooldownUntil,
}) {
  if (!tapEnabled || !isIdle || promptOpen) return false;
  return !now.isBefore(cooldownUntil);
}
