// Zaptec local BLE client — the real thing, not a preview.
//
// Protocol from docs/reference/integrations/zaptec-ble-protocol.md, which
// was extracted from the vendor app and then VERIFIED against hardware on
// 2026-08-02 (ZPR074002, fw 3.3.4.5): service UUID confirmed by
// enumeration, all characteristic UUIDs matched, PIN auth returned '1',
// and a reboot was issued and confirmed (uptime 62.03 → 0.0008,
// McuResetSource 22 → 1).
//
// Two things that are easy to get wrong and are load-bearing here:
//
//   • EVERY value is a UTF-8 DECIMAL STRING, not a binary integer.
//     Rebooting writes the three bytes 31 30 32 ("102"), and
//     HmiLedBrightness reads back as e.g. "0.1". Treating these as ints
//     silently corrupts writes.
//
//   • The Auth result is the CHARACTER '1' (0x31), not the number 1.
//     Consistent with the string encoding throughout.
//
// This interface is deliberately vendor-shaped rather than generic: the
// vendor-neutral layer lives above it (see charger_capabilities.dart), so
// a second brand slots in as another client behind the same capability
// model rather than by contorting this one.
//
// UNDOCUMENTED INTERFACE. Zaptec can change it in any firmware release.
// Every call path must degrade to "settings unavailable" rather than an
// error state, and the cloud path should be preferred when the charger is
// online — BLE is the fallback that works when nothing else can reach it.

import 'dart:async';
import 'dart:convert';
import 'dart:math' show pow;

import 'package:flutter/foundation.dart';
import 'package:flutter_blue_plus/flutter_blue_plus.dart';
import 'package:permission_handler/permission_handler.dart';

/// Zaptec's GATT service. Read off the device by enumeration — the vendor
/// app names only characteristics, never the parent service.
const String kZaptecServiceUuid = '10492c5a-deec-4577-a25a-6950c0b5fcd0';

/// How long to wait after stopping a scan before attempting a GATT
/// connect. `stopScan()` returns as soon as the plugin has recorded the
/// request; the controller takes longer to actually leave scan mode, and
/// connecting inside that gap is what produces GATT_ERROR(133).
const Duration _postScanSettle = Duration(milliseconds: 400);

/// Whether a GATT connect is in flight or a session is open.
///
/// Exists so background scanning (the home screen's tap-arming scan) can
/// hold off. Scanning and connecting on the same controller is what
/// produced a run of GATT_ERROR(133) on the bench, and the two features
/// have no other knowledge of each other.
int _bleBusy = 0;

/// All characteristics share this base with the 16-bit id in the tail.
/// Derived from the vendor app's `od5.s(int)`:
///   UUID(1173517946705429879, (id & 0xFFFFFFFF) - 6747965296109879296)
String zaptecCharUuid(int id) =>
    '10492c5a-deec-4577-a25a-6950c0b5${id.toRadixString(16).padLeft(4, '0')}';

/// The 34 characteristics this firmware exposes. The vendor app knows 52;
/// the rest belong to other models or firmware, which is exactly why the
/// UI renders from discovery rather than from this list.
class ZapChar {
  static const availableWifiSsids = 0xFCD1; // r
  static const communicationMode = 0xFCD2; // rw
  static const wifiSsid = 0xFCD3; // rw
  static const wifiPsk = 0xFCD4; // w  — write-only, never reads back
  static const connect = 0xFCD5; // rw
  static const mid = 0xFCD7; // r
  static const standalone = 0xFCD9; // rw
  static const authorization = 0xFCDA; // w
  static const indicate = 0xFCDB; // w
  static const chargerOperationState = 0xFCDC; // r
  static const occupiedState = 0xFCDD; // r
  static const authorizationResult = 0xFCDE; // r
  static const ledState = 0xFCDF; // r  (aliased 'Location' in the app)
  static const timeZone = 0xFCE0; // r
  static const timeSchedule = 0xFCE1; // r
  static const midFieldTestMode = 0xFCE2; // r
  static const availableCommunicationModes = 0xFCE3; // r
  static const pairNfc = 0xFCE4; // rw
  static const auth = 0xFD00; // rw — PIN in, status out
  static const availableWifiNetworks = 0xFD01; // r
  static const networkStatus = 0xFD02; // r
  static const runCommand = 0xFD03; // w
  static const standaloneCurrent = 0xFD04; // rw
  static const networkType = 0xFD05; // rw
  static const standalonePhase = 0xFD06; // rw
  static const gridTest = 0xFD07; // rw
  static const permanentLock = 0xFD08; // rw
  static const hmiLedBrightness = 0xFD09; // rw
  static const plcNmk = 0xFD0A; // rw
  static const plcNpw = 0xFD0B; // w
  static const plcPair = 0xFD0C; // rw
  static const firmwareVersion = 0xFE00; // r
  static const warnings = 0xFE01; // rw
}

/// `RunCommand` values. Only Reboot and UpdateFirmware were implemented
/// charger-side per the 2022 teardown; Reboot is verified working.
class ZapCommand {
  static const reboot = 102;
  static const updateFirmware = 200;
  static const stopChargingFinal = 506;
  static const startCharging = 507;
  static const runRcdTest = 808;
  static const forceUnlock = 950;
}

/// Every id the vendor app's characteristic enum defines (52). Used only
/// to flag anything a charger exposes that the app does not know about.
const Set<int> _knownIds = {
  0xFCD1, 0xFCD2, 0xFCD3, 0xFCD4, 0xFCD5, 0xFCD7, 0xFCD9, 0xFCDA, 0xFCDB,
  0xFCDC, 0xFCDD, 0xFCDE, 0xFCDF, 0xFCE0, 0xFCE1, 0xFCE2, 0xFCE3, 0xFCE4,
  0xFCE7, 0xFCE8, 0xFCE9, 0xFD00, 0xFD01, 0xFD02, 0xFD03, 0xFD04, 0xFD05,
  0xFD06, 0xFD07, 0xFD08, 0xFD09, 0xFD0A, 0xFD0B, 0xFD0C, 0xFD0D, 0xFE00,
  0xFE01, 0xFE02, 0xFE06, 0xFE07, 0xFE08, 0xFE09, 0xFE0A, 0xFE0B, 0xFE10,
  0xFE11, 0xFE12, 0xFE13, 0xFE14, 0xFE15, 0xFE16,
};

enum ZapBleFailure {
  bluetoothOff,
  permissionDenied,
  notFound,
  connectFailed,
  serviceMissing,
  authFailed,
  disconnected,
}

class ZapBleException implements Exception {
  const ZapBleException(this.failure, [this.detail]);
  final ZapBleFailure failure;
  final String? detail;

  @override
  String toString() => 'ZapBleException($failure${detail == null ? '' : ': $detail'})';
}

/// A live, PIN-authenticated connection to one charger.
///
/// Hold it while a settings screen is open and dispose on exit. Do NOT
/// reconnect per field — connect-to-authenticated was measured at ~300 ms,
/// but each reconnect is another chance to fail in front of the driver.
class ZaptecBleSession {
  ZaptecBleSession._(this._device, this._chars);

  final BluetoothDevice _device;
  final Map<int, BluetoothCharacteristic> _chars;

  /// Characteristic ids this charger actually exposes. The settings UI
  /// renders from THIS, never from a hardcoded list — firmware and model
  /// both change the set, and a hardcoded screen shows dead controls.
  Set<int> get available => _chars.keys.toSet();

  bool has(int id) => _chars.containsKey(id);

  /// Read a characteristic as its UTF-8 string value.
  /// Returns null when absent or unreadable — an absent characteristic is
  /// a normal outcome, not an error.
  Future<String?> readString(int id) async {
    final c = _chars[id];
    if (c == null) return null;
    try {
      final bytes = await c.read();
      return utf8.decode(bytes, allowMalformed: true).trim();
    } catch (e) {
      if (kDebugMode) debugPrint('[zaptec-ble] read ${id.toRadixString(16)} failed: $e');
      return null;
    }
  }

  /// Read several characteristics in sequence. GATT does not pipeline, so
  /// these are deliberately serial rather than a Future.wait — parallel
  /// reads on one connection interleave badly on Android.
  Future<Map<int, String>> readAll(Iterable<int> ids) async {
    final out = <int, String>{};
    for (final id in ids) {
      if (!has(id)) continue;
      final v = await readString(id);
      if (v != null && v.isNotEmpty) out[id] = v;
    }
    return out;
  }

  /// Write a value as its UTF-8 decimal string, matching the vendor app's
  /// `G(char, int) → String.valueOf(int) → bytes` chain.
  Future<void> writeString(int id, String value) async {
    final c = _chars[id];
    if (c == null) {
      throw ZapBleException(ZapBleFailure.serviceMissing, 'char ${id.toRadixString(16)}');
    }
    await c.write(utf8.encode(value), withoutResponse: false);
  }

  Future<void> writeInt(int id, int value) => writeString(id, value.toString());

  /// Send a RunCommand. Reboot is the one that matters and the one
  /// verified end to end.
  Future<void> sendCommand(int command) =>
      writeInt(ZapChar.runCommand, command);

  bool _closed = false;

  Future<void> close() async {
    if (!_closed) {
      _closed = true;
      if (_bleBusy > 0) _bleBusy--;
    }
    try {
      await _device.disconnect();
    } catch (_) {
      // already gone
    }
  }
}

/// One Zaptec seen in a live scan.
class ZaptecNearby {
  const ZaptecNearby({
    required this.serial,
    required this.rssi,
    required this.name,
    required this.device,
  });

  final String serial;
  final int rssi;
  final String name;

  /// Carried through so connecting does not have to scan a second time.
  /// Android is unreliable at connecting while a scan is running, and two
  /// concurrent scans on the static FlutterBluePlus API fight each other —
  /// the second one's stopScan tears down the first.
  final BluetoothDevice device;

  /// Proximity buckets calibrated on ZPR074002, 2026-06-07: contact ~-29,
  /// 10 cm -29, 30 cm -40, 1 m -49. Never show a driver raw dBm.
  int get bars => switch (rssi) {
        >= -35 => 4,
        >= -45 => 3,
        >= -60 => 2,
        _ => 1,
      };

  /// Estimated distance in metres, log-distance path loss fitted to the
  /// 2026-06-07 field calibration of this charger model:
  ///
  ///   d = 10 ^ ((RSSI@1m − rssi) / (10·n)),  RSSI@1m = −49, n = 1.72
  ///
  /// Fitted from the measured pairs (0.3 m → −40) and (1 m → −49); it
  /// predicts −31.8 at 0.1 m against −29 measured, which is as good as
  /// RSSI ranging gets.
  ///
  /// **Precision is poor by nature.** The first ~10 cm is flat — 0, 2 and
  /// 10 cm all read −29 (near-field saturation) — and jitter is ±8 dB
  /// while moving. Below [nearFieldFloor] the number is meaningless, so
  /// the UI says "at the charger" instead of inventing a figure.
  double get estimatedMetres {
    const rssiAtOneMetre = -49.0;
    const pathLossExponent = 1.72;
    return pow(10, (rssiAtOneMetre - rssi) / (10 * pathLossExponent))
        .toDouble();
  }

  /// Below this RSSI-derived distance the estimate cannot be trusted.
  static const nearFieldFloor = 0.15;

  bool get isTouching => rssi >= -32;

  /// Human-readable distance. Deliberately coarse — a false precision
  /// like "0.37 m" would imply a measurement we cannot make.
  String get distanceLabel {
    if (isTouching) return 'At the charger';
    final d = estimatedMetres;
    if (d < nearFieldFloor) return 'At the charger';
    if (d < 1) return '~${(d * 100).round()} cm';
    if (d < 10) return '~${d.toStringAsFixed(1)} m';
    return '~${d.round()} m';
  }

}

class ZaptecBle {
  /// True while a GATT connect is in flight or a session is open.
  ///
  /// Background scanners must pause while this holds — Android cannot
  /// reliably connect and scan at once, and the failure mode is a silent
  /// GATT_ERROR(133) five seconds later rather than anything readable.
  static bool get isBusy => _bleBusy > 0;

  /// Scan, connect, and PIN-authenticate.
  ///
  /// [serial] is matched against the advertised local name, which carries
  /// it in full ("ZPR074002 2305") — field-measured at 37/37
  /// advertisements, zero nameless.
  ///
  /// [pin] is the 4-digit factory PIN. It is used and discarded; it must
  /// never be persisted on the device. It cannot be rotated, so treat
  /// every use as an audited grant.
  static Future<ZaptecBleSession> connect({
    required String serial,
    required String pin,
    /// Pass the device from a picker that already found it. Avoids a
    /// second scan — Android connects unreliably while scanning, and two
    /// concurrent scans on the static API tear each other down.
    BluetoothDevice? device,
    Duration scanTimeout = const Duration(seconds: 20),
  }) async {
    if (!await FlutterBluePlus.isSupported) {
      throw const ZapBleException(ZapBleFailure.bluetoothOff, 'unsupported');
    }
    final adapter = await FlutterBluePlus.adapterState.first;
    if (adapter != BluetoothAdapterState.on) {
      throw const ZapBleException(ZapBleFailure.bluetoothOff);
    }

    // Claim the radio BEFORE stopping the scan, not after.
    //
    // Measured 2026-08-03: with the claim taken later, the home screen's
    // 3-second watchdog could restart its scan in the window between our
    // stopScan and our connect — and a 133 still occurred on attempt 1.
    // Taking the claim first makes the watchdog stand down before we
    // touch the radio at all. Released on every failure path below.
    _bleBusy++;

    // Any scan still running will fight the connection. Stop it first,
    // whether it is ours or a picker's.
    //
    // MEASURED, 2026-08-03: with the home screen's continuous
    // lowLatency scan running, every connect failed with GATT_ERROR(133)
    // after exactly 5 s, three attempts in a row. 133 on Android is
    // overwhelmingly "the controller is still scanning". stopScan alone
    // is not enough — flutter_blue_plus reported "already stopped" while
    // the platform scanner was demonstrably still delivering results, so
    // its bookkeeping and the stack's state had diverged. The settle
    // delay is what actually lets the controller leave scan mode.
    try {
      await FlutterBluePlus.stopScan();
    } catch (_) {}
    await Future.delayed(_postScanSettle);

    // _find throws notFound, which is now after the claim — release it
    // rather than leaving the radio marked busy forever.
    final BluetoothDevice target;
    try {
      target = device ?? await _find(serial, scanTimeout);
    } catch (e) {
      if (_bleBusy > 0) _bleBusy--;
      rethrow;
    }

    // _find runs a scan of its own, so settle again before connecting.
    if (device == null) {
      try {
        await FlutterBluePlus.stopScan();
      } catch (_) {}
      await Future.delayed(_postScanSettle);
    }

    // One retry. 133 is frequently transient — the controller needs a
    // moment more than we gave it, or the peripheral was mid-advertising
    // interval. Retrying once costs a second and converts most of these
    // into a successful connect; failing outright sends the driver back
    // to the picker to try the whole flow again.
    Object? firstError;
    for (var attempt = 0; attempt < 2; attempt++) {
      try {
        // 10 s, not 15. Two attempts plus a scan window has to stay
        // inside the caller's overall deadline, and a charger that has
        // not answered in ten seconds is not mid-handshake — it is off,
        // out of range, or already talking to someone else.
        await target.connect(timeout: const Duration(seconds: 10));
        firstError = null;
        break;
      } catch (e) {
        firstError ??= e;
        if (kDebugMode) {
          debugPrint('[zaptec-ble] connect attempt ${attempt + 1} failed: $e');
        }
        try {
          await target.disconnect();
        } catch (_) {}
        await Future.delayed(const Duration(milliseconds: 600));
      }
    }
    if (firstError != null) {
      if (_bleBusy > 0) _bleBusy--;
      throw ZapBleException(ZapBleFailure.connectFailed, '$firstError');
    }

    // Set once a ZaptecBleSession exists and owns the claim — from then
    // on `close()` is what releases it, and this function must not.
    var handedOff = false;

    try {
      final services = await target.discoverServices();
      final svc = services.firstWhere(
        (s) => s.uuid.str.toLowerCase() == kZaptecServiceUuid,
        orElse: () => throw const ZapBleException(ZapBleFailure.serviceMissing),
      );

      // Build the id → characteristic map from what the device actually
      // exposes. This is the capability set the UI renders from.
      final chars = <int, BluetoothCharacteristic>{};
      for (final c in svc.characteristics) {
        final u = c.uuid.str.toLowerCase();
        if (u.length < 4) continue;
        final id = int.tryParse(u.substring(u.length - 4), radix: 16);
        if (id != null) chars[id] = c;
      }

      if (kDebugMode) {
        // The authoritative capability list for this unit. Logged in full
        // because every earlier count came from a truncated shell pipe.
        final ids = chars.keys.toList()..sort();
        debugPrint('[zaptec-ble] service exposes ${ids.length} characteristics: '
            '${ids.map((i) => '0x${i.toRadixString(16).toUpperCase()}').join(' ')}');
        final unknown = ids.where((i) => !_knownIds.contains(i)).toList();
        if (unknown.isNotEmpty) {
          debugPrint('[zaptec-ble] NOT in the vendor app enum: '
              '${unknown.map((i) => '0x${i.toRadixString(16).toUpperCase()}').join(' ')}');
        }
      }

      final session = ZaptecBleSession._(target, chars);
      handedOff = true;

      // PIN auth: write the PIN as ASCII, read back a single character.
      // '1' means authenticated.
      final authChar = chars[ZapChar.auth];
      if (authChar == null) {
        throw const ZapBleException(ZapBleFailure.serviceMissing, 'Auth');
      }
      await authChar.write(utf8.encode(pin), withoutResponse: false);
      final status = await authChar.read();
      final ok = status.isNotEmpty && status.first == 0x31; // '1'
      if (!ok) {
        await session.close();
        // NEVER retry automatically. Wrong PINs disable the charger's
        // Bluetooth for escalating periods, and on an offline charger
        // that is the last channel to it.
        throw ZapBleException(
          ZapBleFailure.authFailed,
          'status=${status.isEmpty ? "empty" : status.first}',
        );
      }
      return session;
    } catch (e) {
      // Release the radio unless a session already owns the claim — in
      // the wrong-PIN path `session.close()` has released it already, and
      // decrementing twice would let a background scan start while the
      // link is still up.
      if (!handedOff && _bleBusy > 0) _bleBusy--;
      try {
        await target.disconnect();
      } catch (_) {}
      if (e is ZapBleException) rethrow;
      throw ZapBleException(ZapBleFailure.connectFailed, '$e');
    }
  }

  /// Live scan for any Zaptec in range, newest RSSI wins.
  ///
  /// Serial comes from the advertised local name ("ZPR074002 2305") — the
  /// first whitespace-delimited token starting with a known prefix.
  ///
  /// The caller MUST keep the screen foregrounded: Android silently drops
  /// BLE scan results for backgrounded processes. Measured 2026-08-02 —
  /// 45 s timeout backgrounded versus 0.5 s foregrounded.
  static Stream<ZaptecNearby> scan() async* {
    if (!await requestPermissions()) {
      throw const ZapBleException(ZapBleFailure.permissionDenied);
    }
    await FlutterBluePlus.startScan(
      androidUsesFineLocation: false,
      continuousUpdates: true,
      androidScanMode: AndroidScanMode.lowLatency,
    );
    try {
      await for (final results in FlutterBluePlus.scanResults) {
        for (final r in results) {
          final name = r.advertisementData.advName.toUpperCase();
          if (name.isEmpty) continue;
          final serial = _serialFrom(name);
          if (serial == null) continue;
          yield ZaptecNearby(
            serial: serial,
            rssi: r.rssi,
            name: name,
            device: r.device,
          );
        }
      }
    } finally {
      try {
        await FlutterBluePlus.stopScan();
      } catch (_) {}
    }
  }

  /// Android 12+ gates BLE on BLUETOOTH_SCAN (declared neverForLocation),
  /// NOT on location — location is capped at maxSdkVersion=30, so
  /// requiring it silently blocks the scan on every modern phone. This
  /// mirrors ble/scanner.dart, where that bug cost a field-test session.
  static Future<bool> requestPermissions() async {
    final scan = await Permission.bluetoothScan.request();
    await Permission.bluetoothConnect.request();
    final loc = await Permission.locationWhenInUse.request();
    return scan.isGranted || scan.isLimited || loc.isGranted || loc.isLimited;
  }

  /// Zaptec serials carry a fixed three-letter prefix. Extend when another
  /// vendor's descriptor lands — this is the only vendor-specific parsing
  /// left in the settings path.
  static const _prefixes = ['ZPR', 'ZAP'];

  static String? _serialFrom(String upperName) {
    for (final tok in upperName.split(RegExp(r'\s+'))) {
      if (_prefixes.any(tok.startsWith)) return tok;
    }
    return null;
  }

  static Future<BluetoothDevice> _find(String serial, Duration timeout) async {
    final want = serial.trim().toUpperCase();
    final completer = Completer<BluetoothDevice>();
    late StreamSubscription<List<ScanResult>> sub;

    sub = FlutterBluePlus.scanResults.listen((results) {
      for (final r in results) {
        final name = r.advertisementData.advName.toUpperCase();
        if (name.isEmpty || !name.contains(want)) continue;
        if (!completer.isCompleted) completer.complete(r.device);
        return;
      }
    });

    try {
      await FlutterBluePlus.startScan(
        androidUsesFineLocation: false,
        continuousUpdates: true,
        androidScanMode: AndroidScanMode.lowLatency,
      );
      return await completer.future.timeout(
        timeout,
        onTimeout: () => throw const ZapBleException(ZapBleFailure.notFound),
      );
    } finally {
      await sub.cancel();
      try {
        await FlutterBluePlus.stopScan();
      } catch (_) {}
    }
  }
}
