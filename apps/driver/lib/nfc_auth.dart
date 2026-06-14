// Snertilaust (NFC) — the <5cm tap-to-charge auth gate for the driver app.
//
// ADR 0024 addendum (2026-06-07): the NFC tap is the PRIMARY (and only) auth
// trigger. The phone must be within NFC range (~<5cm) of the charger before a
// session is authenticated. BLE (ble_scanner.dart) is demoted to discovery +
// anti-spoof cross-check and no longer starts a charge on its own — proximity
// alone (~10-15cm BLE floor) is not close enough to express intent.
//
// Reader mode: while the app is foregrounded and Snertilaust is on we keep an NFC
// reader session open. A tap on a charger's NFC tag (an NDEF target encoding
// the connector UUID, the Zaptec serial, or the charger's display name) emits
// an [NfcTapHit] carrying the readable text. The app does the charger matching
// and the access decision; this stays transport-only.
//
// NOTE on hardware: reader mode reads passive NFC TAGS. A Zaptec's own RFID
// reader is a reader, not a tag, so tapping the bare charger won't resolve
// here — deploy an NFC sticker/tag on the charger encoding its id.

import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:nfc_manager/nfc_manager.dart';

/// One NFC tap, reduced to the readable NDEF text. The app matches this against
/// the driver's accessible chargers (serial / connector UUID / display name).
class NfcTapHit {
  const NfcTapHit({required this.raw, required this.detectedAt});

  /// All NDEF text/URI payloads concatenated and upper-cased, for matching.
  /// Empty when the tag carried no readable NDEF text.
  final String raw;
  final DateTime detectedAt;
}

class NfcTapReader {
  final _controller = StreamController<NfcTapHit>.broadcast();
  Stream<NfcTapHit> get taps => _controller.stream;

  bool _running = false;
  bool get isRunning => _running;

  /// True only on a device with NFC hardware that is switched on.
  Future<bool> isAvailable() async {
    try {
      return await NfcManager.instance.isAvailable();
    } catch (_) {
      return false;
    }
  }

  /// Begin (or resume) reader mode. No-op if already running or NFC is off.
  Future<bool> start() async {
    if (_running) return true;
    if (!await isAvailable()) return false;
    _running = true;
    _begin();
    return true;
  }

  void _begin() {
    if (!_running) return;
    try {
      NfcManager.instance.startSession(
        pollingOptions: {
          NfcPollingOption.iso14443,
          NfcPollingOption.iso15693,
          NfcPollingOption.iso18092,
        },
        onDiscovered: (NfcTag tag) async {
          _controller.add(
            NfcTapHit(raw: _readText(tag), detectedAt: DateTime.now()),
          );
          // Release the tag, then resume listening after a short cooldown so a
          // tag held against the phone doesn't re-fire continuously.
          try {
            await NfcManager.instance.stopSession();
          } catch (_) {}
          if (_running) {
            Future.delayed(const Duration(seconds: 3), _begin);
          }
        },
      );
    } catch (e) {
      if (kDebugMode) debugPrint('[NFC] startSession failed: $e');
    }
  }

  String _readText(NfcTag tag) {
    try {
      final ndef = Ndef.from(tag);
      final records = ndef?.cachedMessage?.records ?? const <NdefRecord>[];
      final buf = StringBuffer();
      for (final r in records) {
        final s = _decodeRecord(r);
        if (s.isNotEmpty) {
          buf.write(s);
          buf.write(' ');
        }
      }
      return buf.toString().trim().toUpperCase();
    } catch (_) {
      return '';
    }
  }

  // NFC Forum URI Record Type Definition prefix table.
  static const _uriPrefixes = <String>[
    '', 'http://www.', 'https://www.', 'http://', 'https://', 'tel:',
    'mailto:', 'ftp://anonymous:anonymous@', 'ftp://ftp.', 'ftps://',
    'sftp://', 'smb://', 'nfs://', 'ftp://', 'dav://', 'news:',
    'telnet://', 'imap:', 'rtsp://', 'urn:', 'pop:', 'sip:', 'sips:',
    'tftp:', 'btspp://', 'btl2cap://', 'btgoep://', 'tcpobex://',
    'irdaobex://', 'file://', 'urn:epc:id:', 'urn:epc:tag:', 'urn:epc:pat:',
    'urn:epc:raw:', 'urn:epc:', 'urn:nfc:',
  ];

  String _decodeRecord(NdefRecord r) {
    try {
      final p = r.payload;
      if (p.isEmpty) return '';
      // Well-known URI record (type 'U' = 0x55).
      if (r.type.length == 1 && r.type[0] == 0x55) {
        final code = p[0];
        final pre = code < _uriPrefixes.length ? _uriPrefixes[code] : '';
        return pre + utf8.decode(p.sublist(1), allowMalformed: true);
      }
      // Well-known Text record (type 'T' = 0x54).
      if (r.type.length == 1 && r.type[0] == 0x54) {
        final status = p[0];
        final langLen = status & 0x3F;
        return utf8.decode(p.sublist(1 + langLen), allowMalformed: true);
      }
      // Anything else: best-effort UTF-8.
      return utf8.decode(p, allowMalformed: true);
    } catch (_) {
      return '';
    }
  }

  Future<void> stop() async {
    _running = false;
    try {
      await NfcManager.instance.stopSession();
    } catch (_) {}
  }

  void dispose() {
    stop();
    _controller.close();
  }
}
