// Símatap — tap-intent controller (ADR 0024 addendum 2, 2026-08-02).
//
// What this does, and why it looks like this:
//
// Bench work on 2026-08-02 established that a phone held against a
// charger's RFID reader is read as a card with a UID that is regenerated
// on EVERY tap. Nine consecutive taps on ZPR074002 gave nine different
// values, all prefixed 08 (ISO 14443-3's reserved "random UID" marker).
// The phone therefore cannot carry identity to the charger — and on
// Android there is no way for the app to even learn that a tap happened
// (observe mode is unsupported on current hardware; a registered HCE
// service is never invoked because the reader sends no SELECT AID).
//
// So the app's job is NOT to detect the tap. It is to declare, in
// advance, that this driver is standing at this charger:
//
//   1. BLE scanner sees the charger's serial in its advertisement at
//      tap-strength RSSI, sustained (ble_scanner.dart).
//   2. We POST a tap intent — driver (from the bearer token, server-side)
//      + charger serial + RSSI.
//   3. The driver taps the phone on the reader. The CHARGER reports the
//      anonymous UID to our CSMS over OCPP, on its own connection.
//   4. The server joins the two and starts the session.
//
// The intent is the identity half; the charger's report is the proof-of-
// presence half. Neither authorises anything alone, which is what makes
// this safe against a phone that lies about where it is.
//
// Disarming promptly matters as much as arming: the live intent is the
// window in which someone else's tap at that charger could be attributed
// to this driver. We drop it the moment BLE stops seeing the charger.

import 'dart:async';
import 'dart:math';

import 'package:flutter/foundation.dart' show kDebugMode, debugPrint;
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import 'api.dart';
import 'ble_scanner.dart';

/// How long the charger must be seen at tap strength before we arm.
/// Guards against a single noisy sample from a charger being walked past
/// — RSSI jitter was measured at ±8 dB while moving.
const Duration _sustainBeforeArm = Duration(milliseconds: 1500);

/// Re-arm cadence. Server TTL is 120s; refreshing at 45s means two
/// consecutive failures still leave headroom before the intent lapses.
const Duration _refreshInterval = Duration(seconds: 45);

/// Disarm when the charger hasn't been seen at tap strength for this
/// long. Short, because this is the hijack window.
const Duration _lostAfter = Duration(seconds: 15);

/// Same threshold the server enforces (TAP_INTENT_MIN_RSSI). Duplicated
/// deliberately: the app gates to avoid pointless calls, the server gates
/// because it cannot trust the client.
const int _minRssi = -35;

enum TapIntentPhase { idle, arming, armed, error }

class TapIntentState {
  const TapIntentState({
    required this.phase,
    this.chargerName,
    this.serial,
    this.expiresAt,
    this.message,
  });

  final TapIntentPhase phase;
  final String? chargerName;
  final String? serial;
  final DateTime? expiresAt;
  final String? message;

  bool get isArmed => phase == TapIntentPhase.armed;

  static const idle = TapIntentState(phase: TapIntentPhase.idle);
}

class TapIntentController {
  TapIntentController({
    required StraumvaktApi api,
    required Future<String?> Function() accessToken,
    FlutterSecureStorage? storage,
  })  : _api = api,
        _accessToken = accessToken,
        _storage = storage ?? const FlutterSecureStorage();

  final StraumvaktApi _api;
  final Future<String?> Function() _accessToken;
  final FlutterSecureStorage _storage;

  static const _kDeviceHandle = 'sv_device_handle';

  final _states = StreamController<TapIntentState>.broadcast();
  Stream<TapIntentState> get states => _states.stream;

  TapIntentState _state = TapIntentState.idle;
  TapIntentState get state => _state;

  StreamSubscription<TapHit>? _hitSub;
  Timer? _refresh;
  Timer? _lostWatch;

  /// Serial we are currently armed (or arming) for.
  String? _activeSerial;
  String? _activeIntentId;
  DateTime? _inRangeSince;
  DateTime _lastSeenAt = DateTime.fromMillisecondsSinceEpoch(0);
  bool _busy = false;

  /// Start reacting to BLE hits. Safe to call more than once.
  void bind(Stream<TapHit> hits) {
    _hitSub?.cancel();
    _hitSub = hits.listen(_onHit, onError: (Object e) {
      if (kDebugMode) debugPrint('[tap-intent] hit stream error: $e');
    });

    _lostWatch?.cancel();
    _lostWatch = Timer.periodic(const Duration(seconds: 3), (_) {
      if (_activeSerial == null) return;
      if (DateTime.now().difference(_lastSeenAt) > _lostAfter) {
        unawaited(_disarm(reason: 'charger out of range'));
      }
    });
  }

  void _onHit(TapHit hit) {
    // Only chargers the driver actually has access to. A Zaptec in range
    // that isn't theirs is a "no access" prompt elsewhere, not an arm.
    if (!hit.hasAccess) return;
    if (hit.rssi < _minRssi) {
      // Seen, but not close enough. Don't refresh _lastSeenAt — being
      // across the car park should let an existing intent lapse.
      return;
    }

    final serial = hit.serial;
    _lastSeenAt = DateTime.now();

    if (_activeSerial == serial) return; // already armed here

    if (_activeSerial != null && _activeSerial != serial) {
      // Walked from one charger to another. Drop the old intent first so
      // we never hold two live intents at once.
      unawaited(_disarm(reason: 'moved to $serial'));
    }

    _inRangeSince ??= DateTime.now();
    if (DateTime.now().difference(_inRangeSince!) < _sustainBeforeArm) {
      _emit(TapIntentState(phase: TapIntentPhase.arming, serial: serial));
      return;
    }

    unawaited(_arm(serial, hit.rssi));
  }

  Future<void> _arm(String serial, int rssi) async {
    if (_busy) return;
    _busy = true;
    try {
      final token = await _accessToken();
      if (token == null) return;
      final handle = await _deviceHandle();

      final result = await _api.armTapIntent(
        token,
        serial: serial,
        rssi: rssi,
        deviceHandle: handle,
      );

      _activeSerial = serial;
      _activeIntentId = result.intentId;
      _emit(TapIntentState(
        phase: TapIntentPhase.armed,
        chargerName: result.chargerName,
        serial: serial,
        expiresAt: result.expiresAt,
      ));

      _refresh?.cancel();
      _refresh = Timer.periodic(_refreshInterval, (_) => unawaited(_refreshIntent()));
    } on ApiException catch (e) {
      // 403 no_access / 404 unknown_charger / 409 too_far are all
      // expected outcomes, not faults — surface the server's message.
      _activeSerial = null;
      _emit(TapIntentState(
        phase: TapIntentPhase.error,
        serial: serial,
        message: e.message,
      ));
    } catch (e) {
      _emit(TapIntentState(
        phase: TapIntentPhase.error,
        serial: serial,
        message: 'Could not arm tap: $e',
      ));
    } finally {
      _busy = false;
    }
  }

  Future<void> _refreshIntent() async {
    final serial = _activeSerial;
    if (serial == null) return;
    if (DateTime.now().difference(_lastSeenAt) > _lostAfter) return;
    await _arm(serial, _minRssi);
  }

  Future<void> _disarm({String? reason}) async {
    final intentId = _activeIntentId;
    _activeSerial = null;
    _activeIntentId = null;
    _inRangeSince = null;
    _refresh?.cancel();
    _refresh = null;
    _emit(TapIntentState.idle);
    if (kDebugMode && reason != null) debugPrint('[tap-intent] disarm: $reason');

    if (intentId == null) return;
    try {
      final token = await _accessToken();
      if (token == null) return;
      await _api.disarmTapIntent(token, intentId: intentId);
    } catch (e) {
      // Best-effort. The server TTL is the backstop.
      if (kDebugMode) debugPrint('[tap-intent] disarm call failed: $e');
    }
  }

  /// Stable per-install handle, minted locally and kept in the Keychain /
  /// Android Keystore-backed store. Audit metadata only — it is never an
  /// authorisation input, because the tap itself carries no device
  /// identity for it to be checked against.
  Future<String> _deviceHandle() async {
    final existing = await _storage.read(key: _kDeviceHandle);
    if (existing != null && existing.length >= 8) return existing;
    final minted = _mintHandle();
    await _storage.write(key: _kDeviceHandle, value: minted);
    return minted;
  }

  String _mintHandle() {
    // Random.secure() so the handle can't be guessed from install time.
    final rng = Random.secure();
    final bytes = List<int>.generate(16, (_) => rng.nextInt(256));
    return 'dev-${bytes.map((b) => b.toRadixString(16).padLeft(2, '0')).join()}';
  }

  void _emit(TapIntentState next) {
    _state = next;
    if (!_states.isClosed) _states.add(next);
  }

  Future<void> dispose() async {
    await _disarm(reason: 'dispose');
    await _hitSub?.cancel();
    _lostWatch?.cancel();
    await _states.close();
  }
}
