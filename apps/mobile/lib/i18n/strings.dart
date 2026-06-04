// Lightweight in-app localisation (IS/EN). The app deliberately avoids
// the full flutter_localizations / .arb pipeline for now — the driver
// surface is small and a flat string map keeps the toggle (ADR 0026
// driver experience) cheap to ship.
//
// `localeNotifier` is the single source of truth for the active locale.
// MaterialApp rebuilds on it (main.dart wraps the tree in a
// ValueListenableBuilder), so a toggle in the menu re-renders the whole
// app. The chosen locale is persisted via AuthStorage and pushed to the
// backend (PATCH /api/driver/me) on change.

import 'package:flutter/foundation.dart';

/// Supported driver-app languages.
enum AppLocale {
  en,
  is_;

  String get code => this == AppLocale.is_ ? 'is' : 'en';
  String get nativeLabel => this == AppLocale.is_ ? 'Íslenska' : 'English';

  static AppLocale fromCode(String? code) =>
      code == 'is' ? AppLocale.is_ : AppLocale.en;
}

/// App-wide active locale. Defaults to English until a stored / profile
/// locale is loaded on boot.
final ValueNotifier<AppLocale> localeNotifier =
    ValueNotifier<AppLocale>(AppLocale.en);

/// Flat string table. Each key carries an [en] / [is] pair. Lookups go
/// through [AppStrings.of] (context-free — reads the notifier directly)
/// or the [tr] shorthand.
class _Pair {
  const _Pair(this.en, this.is_);
  final String en;
  final String is_;
  String resolve(AppLocale l) => l == AppLocale.is_ ? is_ : en;
}

/// Resolve a key against the currently-active locale.
String tr(String key) {
  final pair = _table[key];
  if (pair == null) return key;
  return pair.resolve(localeNotifier.value);
}

const Map<String, _Pair> _table = {
  // ── Empty state / access funnel ──
  'empty.title': _Pair('No charging access yet', 'Enginn aðgangur enn'),
  'empty.body': _Pair(
    'You haven\'t been added to any chargers. If your housing '
        'association or workplace gave you an invite code or QR, redeem '
        'it to get access.',
    'Þú hefur ekki fengið aðgang að neinum stöðvum. Ef húsfélagið eða '
        'vinnustaðurinn gaf þér boðskóða eða QR, leystu hann inn til að '
        'fá aðgang.',
  ),
  'empty.cta': _Pair('Enter invite code or scan QR', 'Sláðu inn kóða eða skannaðu QR'),
  'empty.refresh': _Pair('Check again', 'Athuga aftur'),

  // ── Redeem screen ──
  'redeem.title': _Pair('Redeem invite', 'Leysa inn boð'),
  'redeem.subtitle': _Pair(
    'Got an invite code or QR from a housing association or workplace? '
        'Redeem it here to get charging access.',
    'Fékkstu boðskóða eða QR frá húsfélagi eða vinnustað? Leystu hann '
        'inn hér til að fá aðgang að hleðslu.',
  ),
  'redeem.codeLabel': _Pair('Invite code', 'Boðskóði'),
  'redeem.codeHint': _Pair('e.g. DAL-7Q4K', 't.d. DAL-7Q4K'),
  'redeem.scan': _Pair('Scan QR code', 'Skanna QR-kóða'),
  'redeem.scanCancel': _Pair('Cancel scan', 'Hætta við skönnun'),
  'redeem.kennitalaLabel': _Pair('Kennitala', 'Kennitala'),
  'redeem.kennitalaHint': _Pair('10 digits', '10 tölustafir'),
  'redeem.passwordLabel': _Pair('Choose a password', 'Veldu lykilorð'),
  'redeem.passwordConfirmLabel': _Pair('Confirm password', 'Staðfestu lykilorð'),
  'redeem.submit': _Pair('Redeem', 'Leysa inn'),
  'redeem.submitting': _Pair('Redeeming…', 'Leysi inn…'),
  'redeem.note': _Pair(
    'After redeeming, your host may need to approve access before '
        'charging opens.',
    'Eftir innlausn gæti húsfélagið þurft að samþykkja aðganginn áður '
        'en hleðsla opnast.',
  ),
  'redeem.pendingTitle': _Pair('Waiting for host approval', 'Bíður samþykkis'),
  'redeem.pendingBody': _Pair(
    'Your invite was redeemed. Your host needs to approve your access '
        'before chargers appear.',
    'Boðið var leyst inn. Húsfélagið þarf að samþykkja aðganginn áður '
        'en stöðvar birtast.',
  ),
  'redeem.codeRequired': _Pair('Enter an invite code', 'Sláðu inn boðskóða'),
  'redeem.kennitalaRequired': _Pair('Kennitala required', 'Kennitala vantar'),
  'redeem.kennitalaInvalid': _Pair('Enter a valid 10-digit kennitala', 'Sláðu inn gilda 10 stafa kennitölu'),
  'redeem.passwordTooShort': _Pair('At least 8 characters', 'Að minnsta kosti 8 stafir'),
  'redeem.passwordMismatch': _Pair('Passwords don\'t match', 'Lykilorð stemma ekki'),

  // ── Active session ──
  'session.title': _Pair('Charging', 'Hleðsla'),
  'session.connecting': _Pair('Connecting…', 'Tengist…'),
  'session.power': _Pair('Power', 'Afl'),
  'session.energy': _Pair('Energy', 'Orka'),
  'session.cost': _Pair('Cost', 'Kostnaður'),
  'session.elapsed': _Pair('Elapsed', 'Tími'),
  'session.stop': _Pair('Stop charging', 'Stöðva hleðslu'),
  'session.stopping': _Pair('Stopping…', 'Stöðva…'),
  'session.stopRequested': _Pair('Stop requested — finishing up.', 'Stöðvun send — að ljúka.'),
  'session.ended': _Pair('Session ended', 'Hleðslu lokið'),
  'session.noActive': _Pair('No active session', 'Engin virk hleðsla'),
  'session.done': _Pair('Done', 'Lokið'),

  // ── Menu / language ──
  'menu.language': _Pair('Language', 'Tungumál'),
  'common.cancel': _Pair('Cancel', 'Hætta við'),
  'common.retry': _Pair('Retry', 'Reyna aftur'),
  'common.networkError': _Pair('Network error — try again.', 'Nettenging brást — reyndu aftur.'),
};
