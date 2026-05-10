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
import 'package:flutter/foundation.dart' show kDebugMode;
import 'package:flutter_blue_plus/flutter_blue_plus.dart';
import 'package:permission_handler/permission_handler.dart';
import '../api/types.dart';

class NearbyCharger {
  const NearbyCharger({
    required this.charger,
    required this.rssi,
    required this.detectedAt,
  });

  final DriverCharger charger;
  final int rssi;
  final DateTime detectedAt;

  /// Rough distance in metres derived from RSSI. Coarse — for "very
  /// close / close / nearby" classification, not navigation.
  double get approxMetres {
    // RSSI → distance: d = 10 ^ ((measured - rssi) / (10 * n))
    // measured = -59 dBm at 1m (typical), n = 2 (free-space-ish).
    if (rssi >= 0) return 999;
    final ratio = (-59 - rssi) / 20;
    final d = (1 * (1 << ratio.clamp(0, 6).toInt())).toDouble();
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
      // Don't start a scan that can't possibly match.
      return false;
    }

    await _scanSub?.cancel();
    _scanSub = FlutterBluePlus.scanResults.listen(_onScanResults);
    await FlutterBluePlus.startScan(
      timeout: const Duration(seconds: 0), // continuous
      androidUsesFineLocation: false,
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
    if (!kDebugMode) {
      // Production: use the user-grant flow.
    }
    final results = await [
      Permission.bluetoothScan,
      Permission.bluetoothConnect,
      Permission.locationWhenInUse,
    ].request();
    return results.values.every((s) => s.isGranted || s.isLimited);
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
