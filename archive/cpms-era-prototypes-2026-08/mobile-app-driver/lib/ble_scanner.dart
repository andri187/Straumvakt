// Símatap — real BLE proximity scanner for the driver app.
//
// Field-validated 2026-06-07 against a Zaptec ZPR074002 (Dalvegur). Findings
// baked in here (see ADR 0024 addendum):
//   • Zaptec advertises its serial in the BLE localName ("ZPR074002 2305"),
//     100% of advertisements — so we match the serial in the name. No
//     per-charger BLE provisioning: we match against the driver's KNOWN
//     chargers (already loaded from /api/driver/chargers).
//   • RSSI calibration: touch ~-29/-31, 10cm -29, 30cm -40, 1m -49; first
//     ~10cm is flat (near-field). BLE proximity floor ≈ 10-15cm — fine for a
//     "you're at the charger" tap gate, not <5cm (that's NFC, future).
//
// Bugs found + fixed (all four were real, all live here):
//   1. Permission gate required location → broke scanning on Android 12.
//      Gate on BLUETOOTH_SCAN only.
//   2. startScan(timeout: 0) was read as "scan 0s" → stopped instantly.
//      Use NO timeout + continuousUpdates.
//   3. Default low-power mode batches delivery (one burst then silence).
//      Use AndroidScanMode.lowLatency.
//   4. Android stops long scans after ~60s. A keep-alive watchdog restarts
//      the scan when it goes stale.

import 'dart:async';

import 'package:flutter/foundation.dart' show kDebugMode, debugPrint;
import 'package:flutter_blue_plus/flutter_blue_plus.dart';
import 'package:permission_handler/permission_handler.dart';

/// A charger the driver has access to, reduced to what BLE matching needs.
class TapTarget {
  const TapTarget({required this.serial, required this.connectorId});

  /// The charger serial as it appears in the advertised name, e.g. "ZPR074002".
  final String serial;

  /// Connector UUID used for the start-session call.
  final String connectorId;
}

/// A Zaptec charger detected nearby, with its signal strength. [target] is
/// the driver's accessible charger this matched, or null when the detected
/// Zaptec is one the driver has NO access to (→ "no access" prompt).
class TapHit {
  const TapHit({
    required this.serial,
    required this.target,
    required this.rssi,
    required this.detectedAt,
  });

  /// Zaptec serial parsed from the advertisement, e.g. "ZPR074002".
  final String serial;

  /// The matched accessible charger, or null if the driver has no access.
  final TapTarget? target;
  final int rssi;
  final DateTime detectedAt;

  bool get hasAccess => target != null;
}

class BleTapScanner {
  // Zaptec serials carry a fixed 3-letter prefix; used as a cheap "is this a
  // Zaptec?" pre-filter before the contains-match. Extend if more vendors are
  // added.
  static const zaptecPrefixes = ['ZPR'];

  // RSSI gate for "tap range" — must be genuinely AT the charger. Calibrated:
  // contact ~-29, 10cm -29, 30cm -40, 0.5m ~-44, 1m -49. -35 ≈ within
  // ~15-20cm and firmly excludes 0.5m+ (which was firing false starts). The
  // app additionally requires this to be SUSTAINED before acting.
  static const tapRssiThreshold = -35;

  // Below this we don't even surface it (across the lot, not "here").
  static const surfaceRssiFloor = -65;

  final _controller = StreamController<TapHit>.broadcast();
  StreamSubscription<List<ScanResult>>? _scanSub;
  Timer? _watchdog;
  DateTime _lastResultAt = DateTime.fromMillisecondsSinceEpoch(0);
  List<TapTarget> _targets = const [];
  bool _running = false;

  Stream<TapHit> get hits => _controller.stream;
  bool get isRunning => _running;

  Future<bool> start(List<TapTarget> targets) async {
    _targets = targets
        .where((t) => t.serial.trim().isNotEmpty && t.connectorId.isNotEmpty)
        .toList(growable: false);
    // No empty-targets gate: we scan for ANY Zaptec so a driver who taps a
    // charger they can't access still gets the "no access" prompt.

    if (!await _requestPermissions()) return false;
    final supported =
        await FlutterBluePlus.isSupported.catchError((_) => false);
    if (!supported) return false;

    _running = true;
    await _restartScan();

    // Keep-alive: Android silently stops long scans (~60s). If no result has
    // arrived recently (or the platform reports not scanning), restart.
    _watchdog?.cancel();
    _watchdog = Timer.periodic(const Duration(seconds: 6), (_) async {
      if (!_running) return;
      final stale = DateTime.now().difference(_lastResultAt) >
          const Duration(seconds: 10);
      final scanning = FlutterBluePlus.isScanningNow;
      if (stale || !scanning) {
        if (kDebugMode) {
          debugPrint('[BLE] watchdog restart (stale=$stale scanning=$scanning)');
        }
        await _restartScan();
      }
    });
    return true;
  }

  Future<void> _restartScan() async {
    try {
      await FlutterBluePlus.stopScan();
    } catch (_) {/* already stopped */}
    await _scanSub?.cancel();
    _scanSub = FlutterBluePlus.scanResults.listen(_onResults);
    try {
      await FlutterBluePlus.startScan(
        androidUsesFineLocation: false,
        continuousUpdates: true,
        androidScanMode: AndroidScanMode.lowLatency,
      );
    } catch (e) {
      if (kDebugMode) debugPrint('[BLE] startScan failed: $e');
    }
  }

  void _onResults(List<ScanResult> results) {
    _lastResultAt = DateTime.now();
    for (final r in results) {
      if (r.rssi < surfaceRssiFloor) continue;
      final name = r.advertisementData.advName.toUpperCase();
      if (name.isEmpty) continue;
      if (!zaptecPrefixes.any(name.startsWith) &&
          !zaptecPrefixes.any(name.contains)) {
        continue; // not a Zaptec advertisement
      }
      // Matched against one of the driver's accessible chargers?
      TapTarget? matched;
      for (final t in _targets) {
        if (name.contains(t.serial.toUpperCase())) {
          matched = t;
          break;
        }
      }
      _controller.add(TapHit(
        serial: _parseSerial(name),
        target: matched, // null => a Zaptec in range the driver can't access
        rssi: r.rssi,
        detectedAt: DateTime.now(),
      ));
    }
  }

  /// The Zaptec serial token from a localName like "ZPR074002 2305".
  String _parseSerial(String upperName) {
    for (final tok in upperName.split(RegExp(r'\s+'))) {
      if (zaptecPrefixes.any(tok.startsWith)) return tok;
    }
    return upperName.split(RegExp(r'\s+')).first;
  }

  Future<bool> _requestPermissions() async {
    // Android 12+ : BLUETOOTH_SCAN (declared neverForLocation) is the gate;
    // location is capped at sdk30 and requesting it would FAIL the check on
    // modern phones. Pass if scan OR legacy location is granted.
    final scan = await Permission.bluetoothScan.request();
    await Permission.bluetoothConnect.request();
    final loc = await Permission.locationWhenInUse.request();
    return scan.isGranted ||
        scan.isLimited ||
        loc.isGranted ||
        loc.isLimited;
  }

  Future<void> stop() async {
    _running = false;
    _watchdog?.cancel();
    _watchdog = null;
    await _scanSub?.cancel();
    _scanSub = null;
    try {
      await FlutterBluePlus.stopScan();
    } catch (_) {/* already stopped */}
  }

  void dispose() {
    stop();
    _controller.close();
  }
}
