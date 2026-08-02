// BLE scanner — listens for charger BLE advertisements and matches
// them against the chargers list returned by /api/driver/chargers.
//
// Two matching modes (selected per-charger via bleAdvertisingKind):
//   zaptec_serial  — match Zaptec's advertised local name (e.g.
//                    'ZAP123456'); compare to the recorded id.
//   mac            — match the BLE peripheral's MAC / remoteId.
//   ibeacon_uuid   — defer; iBeacon is via Core Location on iOS
//                    (Android: regular BLE). Wire in Phase B.
//
// Emulator-friendly: BLE simply isn't available on Android emulators
// or iOS simulators. A debug-only #fakeNearby() lets us test the
// downstream UI flow without real hardware.

import 'dart:async';
import 'dart:math' as math;
import 'package:flutter/foundation.dart' show kDebugMode, debugPrint;
import 'package:flutter_blue_plus/flutter_blue_plus.dart';
import 'package:permission_handler/permission_handler.dart';
import '../api/types.dart';

// Threshold for surfacing a charger as "nearby" — tuned for Zaptec
// advertising at typical EV-station mounting heights, driver
// standing next to the charger. -71 dBm corresponds to roughly 3m
// indoors with n=2.5; further than that the driver isn't intentionally
// near *this* charger and we'd just spam NearbyCard pop-ins as they
// walk past the row.
const int kNearbyRssiThreshold = -71;

class NearbyCharger {
  const NearbyCharger({
    required this.charger,
    required this.rssi,
    required this.detectedAt,
  });

  final DriverCharger charger;
  final int rssi;
  final DateTime detectedAt;

  /// Rough distance in metres derived from RSSI using the log-distance
  /// path-loss model:
  ///
  ///   d = 10 ^ ((measured - rssi) / (10 * n))
  ///
  /// measured = -59 dBm (typical BLE peripheral RSSI at 1m)
  /// n = 2.5 (indoor path-loss exponent, accounts for walls / metal
  /// charger enclosure)
  ///
  /// Coarse — for "right here / within reach / a few steps" UX
  /// classification, not navigation.
  double get approxMetres {
    if (rssi >= 0) return 999;
    const measuredAt1m = -59.0;
    const pathLossExp = 2.5;
    final ratio = (measuredAt1m - rssi) / (10 * pathLossExp);
    final d = math.pow(10, ratio).toDouble();
    return d.clamp(0.1, 100);
  }
}

abstract class BleScanner {
  Stream<NearbyCharger> get nearbyStream;
  Future<bool> start({required List<DriverCharger> known});
  Future<void> stop();

  /// Debug-only: pretend a known charger is nearby. Lets emulator
  /// users test the nearby-card flow without real BLE hardware.
  void fakeNearby(DriverCharger charger, {int rssi = -55});

  static BleScanner instance() {
    return _RealBleScanner();
  }
}

class _RealBleScanner implements BleScanner {
  final _controller = StreamController<NearbyCharger>.broadcast();
  StreamSubscription<List<ScanResult>>? _scanSub;
  Map<String, DriverCharger> _byZaptecSerial = {};
  Map<String, DriverCharger> _byMac = {};

  @override
  Stream<NearbyCharger> get nearbyStream => _controller.stream;

  @override
  Future<bool> start({required List<DriverCharger> known}) async {
    final hasPerm = await _requestPermissions();
    if (!hasPerm) return false;

    final supported = await FlutterBluePlus.isSupported.catchError((_) => false);
    if (!supported) return false;

    // Index known chargers by what we expect to see in advertising
    _byZaptecSerial = {
      for (final c in known)
        if (c.bleAdvertisingId != null && c.bleAdvertisingKind == 'zaptec_serial')
          c.bleAdvertisingId!.toUpperCase(): c,
    };
    _byMac = {
      for (final c in known)
        if (c.bleAdvertisingId != null && c.bleAdvertisingKind == 'mac')
          c.bleAdvertisingId!.toUpperCase(): c,
    };

    if (_byZaptecSerial.isEmpty && _byMac.isEmpty) {
      // No chargers in this driver's list have BLE IDs configured yet.
      // Don't start a scan that can't possibly match — except in debug,
      // where we still scan so _onScanResults can LOG every advertisement
      // seen (diagnostic: "is the charger broadcasting anything at all?").
      if (!kDebugMode) return false;
      debugPrint('[BLE] no chargers have bleAdvertisingId — '
          'scanning anyway (debug) to log raw advertisements');
    }

    await _scanSub?.cancel();
    _scanSub = FlutterBluePlus.scanResults.listen(_onScanResults);
    await FlutterBluePlus.startScan(
      // Continuous scan — NO timeout. flutter_blue_plus reads
      // Duration(seconds: 0) as "scan for 0 seconds" and stops the scan
      // instantly, so the old value silently disabled scanning entirely
      // (zero results, no error — exactly what we saw on-device).
      // continuousUpdates streams repeated RSSI samples for the same
      // device, which the proximity gate needs (not just first-detection).
      androidUsesFineLocation: false,
      continuousUpdates: true,
      // Low-latency = frequent RSSI delivery. The default (low-power) mode
      // batches results and delivers sparsely — one burst then long gaps,
      // useless for live proximity. Higher battery cost, fine while the
      // tap UI is foregrounded.
      androidScanMode: AndroidScanMode.lowLatency,
    );
    return true;
  }

  @override
  Future<void> stop() async {
    await _scanSub?.cancel();
    _scanSub = null;
    try {
      await FlutterBluePlus.stopScan();
    } catch (_) {
      // ignore — already stopped
    }
  }

  void _onScanResults(List<ScanResult> results) {
    final now = DateTime.now();
    for (final r in results) {
      // DIAGNOSTIC (debug only): log every advertisement we see, before
      // any filtering — so we can answer "is the charger broadcasting
      // anything, under what name, at what RSSI?" Watch the flutter
      // console with the phone on the charger.
      if (kDebugMode && r.rssi > -75) {
        final nm = r.advertisementData.advName;
        debugPrint('[BLE] ${nm.isEmpty ? "(no-name)" : nm} '
            'id=${r.device.remoteId.str} rssi=${r.rssi} dBm');
      }
      // Filter weak signals — driver isn't actually close to this
      // charger. Threshold tuned for Zaptec advertising at typical
      // mounting height; weaker than -78 dBm is "across the parking
      // lot" not "tap range".
      if (r.rssi < kNearbyRssiThreshold) continue;

      DriverCharger? hit;
      // Zaptec advertises serial in localName
      final localName = r.advertisementData.advName.toUpperCase();
      if (_byZaptecSerial.containsKey(localName)) {
        hit = _byZaptecSerial[localName];
      } else {
        // Some peripherals only expose serial inside localName as a
        // suffix — fuzzy match by 'contains'.
        for (final entry in _byZaptecSerial.entries) {
          if (localName.contains(entry.key)) {
            hit = entry.value;
            break;
          }
        }
      }
      // MAC fallback (Android only — iOS hides MAC behind a per-app UUID)
      if (hit == null) {
        final id = r.device.remoteId.str.toUpperCase();
        if (_byMac.containsKey(id)) {
          hit = _byMac[id];
        }
      }
      if (hit != null) {
        _controller.add(NearbyCharger(
          charger: hit,
          rssi: r.rssi,
          detectedAt: now,
        ));
      }
    }
  }

  Future<bool> _requestPermissions() async {
    // Android 12+ (API 31+): BLUETOOTH_SCAN is declared neverForLocation in
    // the manifest, so BLE scanning needs BLUETOOTH_SCAN (+ CONNECT) and NOT
    // location. Location is capped at maxSdkVersion=30, so on API 31+
    // Permission.locationWhenInUse resolves to a denied "no manifest entry"
    // status — requiring it (the old `.every(...)`) silently blocked the
    // scan on every modern phone. Gate on the scan permission; request the
    // others best-effort. Pass if EITHER the 31+ scan grant OR the ≤30
    // location grant succeeds.
    final scan = await Permission.bluetoothScan.request();
    await Permission.bluetoothConnect.request();
    final loc = await Permission.locationWhenInUse.request();
    final ok = scan.isGranted || scan.isLimited || loc.isGranted || loc.isLimited;
    if (kDebugMode) {
      debugPrint('[BLE] permissions: scan=$scan connect requested '
          'loc=$loc -> ${ok ? "OK (scanning)" : "BLOCKED"}');
    }
    return ok;
  }

  @override
  void fakeNearby(DriverCharger charger, {int rssi = -55}) {
    if (!kDebugMode) return;
    _controller.add(NearbyCharger(
      charger: charger,
      rssi: rssi,
      detectedAt: DateTime.now(),
    ));
  }
}
