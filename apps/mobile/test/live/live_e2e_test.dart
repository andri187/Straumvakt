// End-to-end check of the app's REAL network path: dart:io WebSocket + Authorization header + discovery request, against the real
// edge module and shared live room running in local workerd (tools/release-checks/mobile-e2e.mjs). Opt-in: skipped unless
// STRAUMVAKT_LIVE_E2E_URL names that local server. No live service is involved.
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:straumvakt_app/live/live_client.dart';

final String? _base = Platform.environment['STRAUMVAKT_LIVE_E2E_URL'];

Future<bool> _until(bool Function() ok, {Duration within = const Duration(seconds: 10)}) async {
  final end = DateTime.now().add(within);
  while (DateTime.now().isBefore(end)) {
    if (ok()) return true;
    await Future<void>.delayed(const Duration(milliseconds: 40));
  }
  return ok();
}

Future<String> _token(String user) async {
  final res = await http.get(Uri.parse('$_base/__token?user=$user'));
  return (jsonDecode(res.body) as Map)['token'] as String;
}

Future<void> _publish(int revision, int powerW) async {
  await http.post(
    Uri.parse('$_base/__publish'),
    body: jsonEncode({'revision': revision, 'powerW': powerW}),
  );
}

void main() {
  final skip = _base == null ? 'set STRAUMVAKT_LIVE_E2E_URL to the local fixture (tools/release-checks/mobile-e2e.mjs)' : false;

  test('a driver with an open session follows live power over a real WebSocket, with a minimal projection', skip: skip, () async {
    await _publish(1, 3000); // already in the room before the app connects: arrives in the snapshot
    final client = DriverLiveClient(baseUrl: _base, tokenProvider: () async => _token('with-session'));
    addTearDown(client.dispose);
    await client.start();
    expect(await _until(() => client.link == LiveLinkState.connected), isTrue, reason: 'connected after the snapshot');
    expect(client.observedPowerKw('1'), closeTo(3.0, 1e-9));
    await _publish(2, 7200);
    expect(await _until(() => (client.observedPowerKw('1') ?? 0) > 7), isTrue, reason: 'a later publication is pushed, not polled');
    expect(client.observedPowerKw('1'), closeTo(7.2, 1e-9));
    // What the server sent a driver carries no organisation, installation, placement or error detail: the client type cannot even hold them.
    final d = client.devices.single;
    expect(d.deviceId, '33333333-3333-4333-8333-333333333333');
    expect(d.connectors.keys, [1]);
  });

  test('removal of the device from the installation reaches the app at once', skip: skip, () async {
    await _publish(10, 5000);
    final client = DriverLiveClient(baseUrl: _base, tokenProvider: () async => _token('with-session'));
    addTearDown(client.dispose);
    await client.start();
    expect(await _until(() => client.devices.isNotEmpty), isTrue);
    await http.post(Uri.parse('$_base/__remove'));
    expect(await _until(() => client.devices.isEmpty), isTrue, reason: 'the remove message dropped the device');
    expect(client.observedPowerKw('1'), isNull);
  });

  test('a driver with NO open session is refused and gets nothing', skip: skip, () async {
    final client = DriverLiveClient(baseUrl: _base, tokenProvider: () async => _token('none'));
    addTearDown(client.dispose);
    await client.start();
    expect(client.link, LiveLinkState.unavailable);
    expect(client.devices, isEmpty);
  });

  test('a forged token is refused', skip: skip, () async {
    final client = DriverLiveClient(baseUrl: _base, tokenProvider: () async => 'forged.token');
    addTearDown(client.dispose);
    await client.start();
    expect(client.link, LiveLinkState.unavailable);
    expect(client.devices, isEmpty);
  });
}
