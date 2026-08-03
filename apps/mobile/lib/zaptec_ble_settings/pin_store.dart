// Charger PIN store — secure, per-charger, never user-visible.
//
// The driver never types a PIN and never sees one. When they are granted
// access to a charger the app fetches its PIN from the Straumvakt backend
// (which holds it from the vendor API, captured at onboarding by the CPO)
// and caches it here. Every BLE settings session then authenticates
// silently.
//
// WHERE THIS LIVES ON THE DEVICE
//
// flutter_secure_storage, which is:
//   • Android — EncryptedSharedPreferences under an AES key held in the
//     Android Keystore. The key material is non-exportable; the app's
//     own storage is not readable by the user or by other apps on a
//     non-rooted device.
//   • iOS — Keychain, `first_unlock_this_device` semantics.
//
// So it is in the part of the device the user cannot reach — which is the
// requirement. It is NOT proof against a rooted/jailbroken device, and it
// must not be treated as such.
//
// WHY THAT MATTERS MORE HERE THAN USUAL
//
// The Zaptec PIN is factory-set, printed on the box, and **cannot be
// rotated**. Caching it is therefore a permanent grant: revoking a
// driver's access in Straumvakt does not un-teach a PIN their device has
// already held. That is unlike every other permission in the system, all
// of which are revocable.
//
// The mitigations that follow from that, all implemented here:
//   • TTL — a cached PIN expires and must be re-fetched, so a device that
//     loses access stops working within the window rather than forever.
//   • clearAll() on logout / access change — best effort, but it closes
//     the common case.
//   • no read path that returns a PIN to the UI layer. `use()` hands it
//     to a callback and never yields it to a widget.

import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// How long a cached PIN stays usable before it must be re-fetched.
///
/// The trade: too short and an offline charger is unreachable exactly when
/// it is needed (no network to re-fetch); too long and a revoked driver
/// keeps local access. Seven days keeps a normal driver working through a
/// holiday while bounding a revoked one to a week.
const Duration kPinCacheTtl = Duration(days: 7);

@immutable
class _CachedPin {
  const _CachedPin(this.pin, this.fetchedAt);
  final String pin;
  final DateTime fetchedAt;

  bool get isFresh => DateTime.now().difference(fetchedAt) < kPinCacheTtl;

  Map<String, dynamic> toJson() =>
      {'p': pin, 't': fetchedAt.toIso8601String()};

  static _CachedPin? fromJson(String raw) {
    try {
      final m = jsonDecode(raw) as Map<String, dynamic>;
      final p = m['p'] as String?;
      final t = DateTime.tryParse((m['t'] ?? '') as String);
      if (p == null || p.isEmpty || t == null) return null;
      return _CachedPin(p, t);
    } catch (_) {
      return null;
    }
  }
}

class ChargerPinStore {
  ChargerPinStore({FlutterSecureStorage? storage})
      : _storage = storage ??
            const FlutterSecureStorage(
              aOptions: AndroidOptions(encryptedSharedPreferences: true),
              iOptions: IOSOptions(
                accessibility: KeychainAccessibility.first_unlock_this_device,
              ),
            );

  final FlutterSecureStorage _storage;

  static const _prefix = 'sv_charger_pin_';

  String _key(String serial) => '$_prefix${serial.trim().toUpperCase()}';

  /// True when a usable PIN is already held for this charger — so the UI
  /// can show "Connect" rather than asking for anything. Deliberately does
  /// not return the value.
  Future<bool> has(String serial) async => (await _read(serial)) != null;

  Future<_CachedPin?> _read(String serial) async {
    try {
      final raw = await _storage.read(key: _key(serial));
      if (raw == null) return null;
      final cached = _CachedPin.fromJson(raw);
      if (cached == null) return null;
      if (!cached.isFresh) {
        await _storage.delete(key: _key(serial));
        return null;
      }
      return cached;
    } catch (e) {
      if (kDebugMode) debugPrint('[pin-store] read failed: $e');
      return null;
    }
  }

  Future<void> put(String serial, String pin) async {
    if (pin.isEmpty) return;
    await _storage.write(
      key: _key(serial),
      value: jsonEncode(_CachedPin(pin, DateTime.now()).toJson()),
    );
  }

  /// Hand the PIN to [action] without exposing it to the caller's scope.
  ///
  /// This is the only way to reach a stored PIN. It returns whatever the
  /// action returns, never the credential — so a widget cannot
  /// accidentally render it, log it, or put it in an error message.
  Future<T?> use<T>(
    String serial,
    Future<T> Function(String pin) action,
  ) async {
    final cached = await _read(serial);
    if (cached == null) return null;
    return action(cached.pin);
  }

  Future<void> forget(String serial) =>
      _storage.delete(key: _key(serial));

  /// Bind the cache to the driver's access grant: drop the PIN for every
  /// charger they can no longer use.
  ///
  /// The PIN is not a thing the device owns, it is an attribute of the
  /// access right. Lose the right, lose the PIN. Call this on every
  /// refresh of the driver's charger list — revocation then propagates on
  /// the next sync rather than waiting out [kPinCacheTtl].
  ///
  /// [accessibleSerials] must be the COMPLETE current set. An empty set
  /// means no access at all and clears everything, which is the correct
  /// reading — a driver with no chargers holds no PINs.
  ///
  /// Still best effort: a device that never comes online cannot learn it
  /// was revoked. That is precisely what the TTL is for — reconcile is the
  /// fast path, the TTL is the backstop, and neither replaces the backend
  /// refusing to release a PIN in the first place.
  Future<int> reconcile(Set<String> accessibleSerials) async {
    final keep = accessibleSerials
        .map((s) => _key(s))
        .toSet();
    var dropped = 0;
    try {
      final all = await _storage.readAll();
      for (final k in all.keys) {
        if (!k.startsWith(_prefix)) continue;
        if (keep.contains(k)) continue;
        await _storage.delete(key: k);
        dropped++;
      }
      if (kDebugMode && dropped > 0) {
        debugPrint('[pin-store] reconcile dropped $dropped revoked charger(s)');
      }
    } catch (e) {
      if (kDebugMode) debugPrint('[pin-store] reconcile failed: $e');
    }
    return dropped;
  }

  /// Called on logout and whenever the driver's charger access changes.
  /// Best effort: it cannot un-teach a PIN already used, but it stops the
  /// device being a standing key.
  Future<void> clearAll() async {
    try {
      final all = await _storage.readAll();
      for (final k in all.keys) {
        if (k.startsWith(_prefix)) await _storage.delete(key: k);
      }
    } catch (e) {
      if (kDebugMode) debugPrint('[pin-store] clearAll failed: $e');
    }
  }
}
