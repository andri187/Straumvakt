// Tap & Auth — tap-intent controller (ADR 0024 addendum 2, 2026-08-02).
//
// Why this exists, and why it looks like this:
//
// Bench work on a Zaptec Pro established that a phone held against a
// charger's RFID reader is read as a card whose UID is regenerated on
// EVERY tap. Nine consecutive taps gave nine different values, all
// prefixed 08 (ISO 14443-3's reserved "random UID" marker). No API on
// Android or iOS can fix that UID, so the phone can never carry identity
// to a charger. On Android the app cannot even learn that a tap happened
// — observe mode is unsupported on current hardware, and a registered
// HCE service is never invoked because the reader sends no SELECT AID.
//
// So this controller does NOT detect taps. It declares, in advance, that
// this driver is standing at this charger:
//
//   1. BleScanner sees the charger at tap-strength RSSI, sustained.
//   2. POST /api/driver/tap-intent — driver from the bearer token
//      (server-side), charger serial, RSSI.
//   3. The driver taps the phone on the reader. The CHARGER reports the
//      anonymous UID to our CSMS over OCPP, on its own connection.
//   4. The server joins the two and starts the session.
//
// The intent is the identity half; the charger's report is the
// proof-of-presence half. Neither authorises anything alone — which is
// what makes this safe against a phone that lies about where it is.
//
// Disarming matters as much as arming: a live intent is the window in
// which someone else's tap at that charger could be attributed to this
// driver. We drop it the moment BLE stops seeing the charger.
//
// NOTE: the server-side resolver hook that consumes an intent is a Rule 5
// change and is NOT yet implemented. Until it lands, arming is recorded
// and nothing acts on it — this controller is safe to wire up and will
// simply have no effect on session start.

import 'dart:async';
import 'dart:math';

import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../api/client.dart';
import '../ble/scanner.dart';

/// How long the charger must be seen at tap strength before arming.
/// Guards against one noisy sample from a charger being walked past —
/// RSSI jitter was measured at ±8 dB while moving.
const Duration kSustainBeforeArm = Duration(milliseconds: 1500);

/// Heartbeat cadence while armed.
///
/// This is not "keep the grant alive" — it is how often we re-state
/// "the driver is still at this charger, at this signal strength". The
/// resolver's job is to match a tap against a recent sighting, so the
/// value that matters is how STALE the newest sighting can be when a tap
/// lands. At the old 45 s cadence that was up to 45 s; a tap could be
/// matched against a sighting from a driver who had already walked away.
///
/// Five seconds bounds it to five, and the server TTL still tolerates
/// several consecutive failures. The cost is a handful of small requests
/// in a window that lasts seconds — only while the app is foregrounded
/// AND the phone is within ~20 cm of a charger.
const Duration kIntentRefresh = Duration(seconds: 5);

/// Disarm when the charger hasn't been seen at tap strength for this
/// long. Short, because this is the hijack window.
const Duration kLostAfter = Duration(seconds: 15);

/// Same threshold the server enforces (TAP_INTENT_MIN_RSSI). Duplicated
/// deliberately: the app gates to avoid pointless calls, the server gates
/// because it cannot trust the client.
const int kTapRssiThreshold = -35;

enum TapIntentPhase { idle, arming, armed, error }

/// Error codes, not messages — the UI localises via i18n/strings.dart.
enum TapIntentError { noAccess, unknownCharger, tooFar, network, unknown }

@immutable
class TapIntentState {
  const TapIntentState({
    required this.phase,
    this.chargerName,
    this.serial,
    this.expiresAt,
    this.error,
  });

  final TapIntentPhase phase;
  final String? chargerName;
  final String? serial;
  final DateTime? expiresAt;
  final TapIntentError? error;

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

  StreamSubscription<RawSighting>? _sub;
  Timer? _refresh;
  Timer? _lostWatch;

  String? _activeSerial;
  String? _activeIntentId;
  DateTime? _inRangeSince;
  DateTime _lastSeenAt = DateTime.fromMillisecondsSinceEpoch(0);

  /// Strength of the most recent qualifying sighting. Sent on every
  /// heartbeat so the stored value is evidence, not a constant.
  int _lastRssi = kTapRssiThreshold;
  bool _busy = false;

  /// Serials the server has already rejected, so we ask once and not on
  /// every scan callback. Earbuds, watches and the neighbour's TV all
  /// advertise names; without this they would each generate a 404 several
  /// times a second.
  final Set<String> _rejected = {};

  /// Start reacting to the scanner. Safe to call more than once.
  void bind(Stream<RawSighting> nearby) {
    _sub?.cancel();
    _sub = nearby.listen(_onNearby, onError: (Object e) {
      if (kDebugMode) debugPrint('[tap-intent] scanner error: $e');
    });

    _lostWatch?.cancel();
    _lostWatch = Timer.periodic(const Duration(seconds: 3), (_) {
      if (_activeSerial == null) return;
      if (DateTime.now().difference(_lastSeenAt) > kLostAfter) {
        unawaited(_disarm(reason: 'charger out of range'));
      }
    });
  }

  void _onNearby(RawSighting hit) {
    // The backend resolves by ChargingStation.serialNumber — the leading
    // token of the advertised name. We do not decide locally whether this
    // is a charger; `resolveDriverStationBySerial` does, and it is the
    // only place that can also check access.
    final serial = hit.serialCandidate;
    if (serial.isEmpty) return;
    if (_rejected.contains(serial)) return;

    if (hit.rssi < kTapRssiThreshold) {
      // Seen, but not close enough. Deliberately do NOT refresh
      // _lastSeenAt — drifting away should let an intent lapse.
      return;
    }

    _lastSeenAt = DateTime.now();
    _lastRssi = hit.rssi;
    if (_activeSerial == serial) return; // already armed here

    if (_activeSerial != null && _activeSerial != serial) {
      // Walked from one charger to another. Drop the old intent first so
      // we never hold two live intents at once.
      unawaited(_disarm(reason: 'moved to $serial'));
    }

    _inRangeSince ??= DateTime.now();
    if (DateTime.now().difference(_inRangeSince!) < kSustainBeforeArm) {
      _emit(TapIntentState(phase: TapIntentPhase.arming, serial: serial));
      return;
    }

    // Display name comes back from the server, which knows what the
    // charger is called. The advertised name is only a fallback.
    unawaited(_arm(serial, hit.rssi, hit.name));
  }

  Future<void> _arm(String serial, int rssi, String displayName) async {
    if (_busy) return;
    _busy = true;
    try {
      final token = await _accessToken();
      if (token == null) return;

      final result = await _api.armTapIntent(
        accessToken: token,
        serial: serial,
        rssi: rssi,
        deviceHandle: await _deviceHandle(),
      );

      // Timing evidence, logged so a bench run can be measured rather
      // than eyeballed: when the heartbeat landed and at what strength.
      // The tap's own timestamp comes from the server side; the pair is
      // what tells us how fresh the presence claim was.
      if (kDebugMode) {
        debugPrint('[tap-intent] ARMED serial=$serial rssi=${rssi}dBm '
            'at=${DateTime.now().toUtc().toIso8601String()} '
            'intent=${result.intentId}');
      }

      _activeSerial = serial;
      _activeIntentId = result.intentId;
      _emit(TapIntentState(
        phase: TapIntentPhase.armed,
        chargerName: result.chargerName ?? displayName,
        serial: serial,
        expiresAt: result.expiresAt,
      ));

      _refresh?.cancel();
      _refresh = Timer.periodic(kIntentRefresh, (_) => unawaited(_refreshIntent()));
    } on ApiException catch (e) {
      // 403 no_access / 404 unknown_charger / 409 too_far are expected
      // outcomes, not faults.
      //
      // 403/404 are permanent for this serial in this session — it is not
      // a charger, or not one this driver may use. Remember it, or every
      // scan callback re-asks. 409 (too far) is transient and must NOT be
      // cached: the driver is about to walk closer.
      // Only cache a SEMANTIC rejection. A bare 404 also means "this
      // route does not exist on the server" — which is what a
      // not-yet-deployed endpoint returns, and caching that blacklists a
      // perfectly good charger for the whole session. Observed exactly
      // that on the bench: staging had no /api/driver/tap-intent, and one
      // 404 stopped the app ever trying again.
      final semantic = e.message.contains('no_access') ||
          e.message.contains('unknown_charger') ||
          e.message.contains('not have access') ||
          e.message.contains('not in the system');
      if ((e.statusCode == 403 || e.statusCode == 404) && semantic) {
        _rejected.add(serial);
        if (kDebugMode) {
          debugPrint('[tap-intent] rejected serial=$serial '
              'status=${e.statusCode} — not asking again this session');
        }
      } else if (kDebugMode) {
        debugPrint('[tap-intent] arm refused serial=$serial '
            'status=${e.statusCode} body="${e.message}" — will retry');
      }
      _activeSerial = null;
      _emit(TapIntentState(
        phase: TapIntentPhase.error,
        serial: serial,
        error: switch (e.statusCode) {
          403 => TapIntentError.noAccess,
          404 => TapIntentError.unknownCharger,
          409 => TapIntentError.tooFar,
          _ => TapIntentError.unknown,
        },
      ));
    } catch (e) {
      if (kDebugMode) debugPrint('[tap-intent] arm failed: $e');
      _emit(TapIntentState(
        phase: TapIntentPhase.error,
        serial: serial,
        error: TapIntentError.network,
      ));
    } finally {
      _busy = false;
    }
  }

  Future<void> _refreshIntent() async {
    final serial = _activeSerial;
    if (serial == null) return;
    if (DateTime.now().difference(_lastSeenAt) > kLostAfter) return;
    // Send the RSSI we ACTUALLY last measured, not the threshold. The
    // old code passed kTapRssiThreshold, so every refresh overwrote the
    // real reading with a constant -35 — which would have made the
    // stored signal strength useless as evidence.
    await _arm(serial, _lastRssi, _state.chargerName ?? '');
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
      await _api.disarmTapIntent(accessToken: token, intentId: intentId);
    } catch (e) {
      // Best-effort — the server TTL is the backstop.
      if (kDebugMode) debugPrint('[tap-intent] disarm call failed: $e');
    }
  }

  /// Stable per-install handle in the Keychain / Keystore-backed store.
  /// Audit metadata only — never an authorisation input, because the tap
  /// carries no device identity for it to be checked against.
  Future<String> _deviceHandle() async {
    final existing = await _storage.read(key: _kDeviceHandle);
    if (existing != null && existing.length >= 8) return existing;
    final rng = Random.secure();
    final bytes = List<int>.generate(16, (_) => rng.nextInt(256));
    final minted =
        'dev-${bytes.map((b) => b.toRadixString(16).padLeft(2, '0')).join()}';
    await _storage.write(key: _kDeviceHandle, value: minted);
    return minted;
  }

  void _emit(TapIntentState next) {
    _state = next;
    if (!_states.isClosed) _states.add(next);
  }

  Future<void> dispose() async {
    await _disarm(reason: 'dispose');
    await _sub?.cancel();
    _lostWatch?.cancel();
    await _states.close();
  }
}
