import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:nfc_manager/nfc_manager.dart';

/// Transport-only NFC reader for an explicit driver tap.
///
/// The app resolves [NfcTapHit.raw] against the driver's authorized chargers.
/// Reading a tag never starts a charging session on its own.
class NfcTapHit {
  const NfcTapHit({required this.raw, required this.detectedAt});

  final String raw;
  final DateTime detectedAt;
}

class NfcTapReader {
  final _controller = StreamController<NfcTapHit>.broadcast();

  Stream<NfcTapHit> get taps => _controller.stream;

  bool _running = false;
  bool get isRunning => _running;

  Future<bool> isAvailable() async {
    try {
      return await NfcManager.instance.isAvailable();
    } catch (_) {
      return false;
    }
  }

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
          try {
            await NfcManager.instance.stopSession();
          } catch (_) {}
          if (_running) {
            Future.delayed(const Duration(seconds: 3), _begin);
          }
        },
      );
    } catch (error) {
      if (kDebugMode) debugPrint('[NFC] startSession failed: $error');
    }
  }

  String _readText(NfcTag tag) {
    try {
      final records =
          Ndef.from(tag)?.cachedMessage?.records ?? const <NdefRecord>[];
      final text = StringBuffer();
      for (final record in records) {
        final decoded = _decodeRecord(record);
        if (decoded.isNotEmpty) text.write('$decoded ');
      }
      return text.toString().trim().toUpperCase();
    } catch (_) {
      return '';
    }
  }

  static const _uriPrefixes = <String>[
    '',
    'http://www.',
    'https://www.',
    'http://',
    'https://',
    'tel:',
    'mailto:',
    'ftp://anonymous:anonymous@',
    'ftp://ftp.',
    'ftps://',
    'sftp://',
    'smb://',
    'nfs://',
    'ftp://',
    'dav://',
    'news:',
    'telnet://',
    'imap:',
    'rtsp://',
    'urn:',
    'pop:',
    'sip:',
    'sips:',
    'tftp:',
    'btspp://',
    'btl2cap://',
    'btgoep://',
    'tcpobex://',
    'irdaobex://',
    'file://',
    'urn:epc:id:',
    'urn:epc:tag:',
    'urn:epc:pat:',
    'urn:epc:raw:',
    'urn:epc:',
    'urn:nfc:',
  ];

  String _decodeRecord(NdefRecord record) {
    try {
      final payload = record.payload;
      if (payload.isEmpty) return '';
      if (record.type.length == 1 && record.type[0] == 0x55) {
        final prefixCode = payload[0];
        final prefix = prefixCode < _uriPrefixes.length
            ? _uriPrefixes[prefixCode]
            : '';
        return prefix + utf8.decode(payload.sublist(1), allowMalformed: true);
      }
      if (record.type.length == 1 && record.type[0] == 0x54) {
        final languageLength = payload[0] & 0x3F;
        return utf8.decode(
          payload.sublist(1 + languageLength),
          allowMalformed: true,
        );
      }
      return utf8.decode(payload, allowMalformed: true);
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
