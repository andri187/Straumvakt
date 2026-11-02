import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:straumvakt_app/live/live_client.dart';

const _inst = '11111111-1111-4111-8111-111111111111';
const _devA = 'aaaaaaaa-0000-4000-8000-000000000001';
const _devB = 'bbbbbbbb-0000-4000-8000-000000000002';

class FakeChannel implements LiveChannel {
  final controller = StreamController<String>();
  int? code;
  bool closed = false;

  @override
  Stream<String> get messages => controller.stream;
  @override
  int? get closeCode => code;
  @override
  Future<void> close() async {
    closed = true;
    if (!controller.isClosed) await controller.close();
  }

  void send(Map<String, Object?> m) => controller.add(jsonEncode(m));
  Future<void> drop(int? c) async {
    code = c;
    await controller.close();
  }
}

Map<String, Object?> _device(
  String id,
  int revision, {
  int gen = 1,
  required DateTime until,
  bool online = true,
  Map<String, Object?>? connectors,
}) => {
  'type': 'device',
  'value': {
    'schema': 1,
    'deviceId': id,
    'generation': gen,
    'revision': revision,
    'observedAt': DateTime.now().millisecondsSinceEpoch,
    'online': online,
    'onlineUntil': until.millisecondsSinceEpoch,
    'connectors':
        connectors ??
        {
          '1': {'status': 'Charging', 'powerW': 7200, 'energyWh': 4100},
        },
  },
};

Map<String, Object?> get _ready => {'type': 'ready', 'installationId': _inst, 'expiresAt': 0};

class Harness {
  Harness({this.base = 'https://shell.example.test', this.discovery = 200}) {
    client = DriverLiveClient(
      baseUrl: base,
      tokenProvider: () async => token,
      httpClient: MockClient((req) async {
        httpCalls.add(req);
        if (discovery != 200) return http.Response('no', discovery);
        return http.Response(
          jsonEncode({
            'installations': [
              {'installationId': _inst},
            ],
          }),
          200,
        );
      }),
      connector: (uri, headers) async {
        uris.add(uri);
        sentHeaders.add(headers);
        if (connectError != null) throw connectError!;
        final c = FakeChannel();
        channels.add(c);
        return c;
      },
      clock: () => now,
      random: () => 0.5,
    );
  }
  final String? base;
  final int discovery;
  String? token = 'driver-token';
  Object? connectError;
  DateTime now = DateTime.now();
  final httpCalls = <http.BaseRequest>[];
  final uris = <Uri>[];
  final sentHeaders = <Map<String, String>>[];
  final channels = <FakeChannel>[];
  late final DriverLiveClient client;
  FakeChannel get last => channels.last;
}

void main() {
  testWidgets('disabled (no base URL) is inert: nothing requested', (tester) async {
    final h = Harness(base: '');
    await h.client.start();
    await tester.pump(const Duration(minutes: 5));
    expect(h.client.enabled, isFalse);
    expect(h.httpCalls, isEmpty);
    expect(h.uris, isEmpty);
    expect(h.client.link, LiveLinkState.off);
    h.client.dispose();
  });

  testWidgets('follows the installations it is given: bearer header, installation in the query, token never in the URL', (tester) async {
    final h = Harness();
    await h.client.start();
    await tester.pump();
    expect(h.httpCalls.single.headers['authorization'], 'Bearer driver-token');
    expect(h.uris.single.scheme, 'wss');
    expect(h.uris.single.path, '/api/cpo/sync');
    expect(h.uris.single.queryParameters, {'installation': _inst});
    expect(h.uris.single.toString(), isNot(contains('driver-token')));
    expect(h.sentHeaders.single['authorization'], 'Bearer driver-token');
    h.client.dispose();
  });

  testWidgets('snapshot then ready connects; live power is only the measured value of THIS connector, in kW', (tester) async {
    final h = Harness();
    await h.client.start();
    await tester.pump();
    final until = h.now.add(const Duration(seconds: 60));
    h.last.send(_device(_devA, 1, until: until));
    await tester.pump();
    expect(h.client.link, isNot(LiveLinkState.connected)); // not before the snapshot is complete
    h.last.send(_ready);
    await tester.pump();
    expect(h.client.link, LiveLinkState.connected);
    expect(h.client.isLive, isTrue);
    expect(h.client.observedPowerKw('1'), closeTo(7.2, 1e-9));
    expect(h.client.observedPowerKw(null), closeTo(7.2, 1e-9)); // the driver's single connector is unambiguous
    h.client.dispose();
  });

  testWidgets('ambiguity is never guessed: with two connectors and no exact match there is no power to show', (tester) async {
    final h = Harness();
    await h.client.start();
    await tester.pump();
    final until = h.now.add(const Duration(seconds: 60));
    h.last.send(_device(_devA, 1, until: until, connectors: {
      '1': {'status': 'Charging', 'powerW': 3000},
      '2': {'status': 'Charging', 'powerW': 9000},
    }));
    h.last.send(_ready);
    await tester.pump();
    expect(h.client.observedPowerKw('not-a-number'), isNull);
    expect(h.client.observedPowerKw('2'), closeTo(9.0, 1e-9));
    h.client.dispose();
  });

  testWidgets('older revisions and malformed frames confer nothing', (tester) async {
    final h = Harness();
    await h.client.start();
    await tester.pump();
    final until = h.now.add(const Duration(seconds: 60));
    h.last.send(_ready);
    h.last.send(_device(_devA, 5, until: until));
    h.last.send(_device(_devA, 2, until: until, connectors: {'1': {'status': 'Faulted', 'powerW': 1}}));
    h.last.controller.add('not json');
    h.last.controller.add(jsonEncode({'type': 'device', 'value': {'deviceId': 3}}));
    await tester.pump();
    expect(h.client.devices.single.revision, 5);
    expect(h.client.observedPowerKw('1'), closeTo(7.2, 1e-9));
    h.client.dispose();
  });

  testWidgets('a routine lease renewal (close 4001) reconnects at once, keeps the value on screen, and is not a failure', (tester) async {
    final h = Harness();
    await h.client.start();
    await tester.pump();
    h.last.send(_device(_devA, 1, until: h.now.add(const Duration(seconds: 90))));
    h.last.send(_ready);
    await tester.pump();
    await h.last.drop(liveLeaseCloseCode);
    await tester.pump();
    expect(h.client.isLive, isTrue); // inside the grace window
    expect(h.client.observedPowerKw('1'), isNotNull);
    await tester.pump(const Duration(milliseconds: 300));
    await tester.pump();
    expect(h.channels, hasLength(2));
    h.last.send(_device(_devA, 2, until: h.now.add(const Duration(seconds: 90))));
    h.last.send(_ready);
    await tester.pump();
    expect(h.client.link, LiveLinkState.connected);
    expect(h.client.degraded, isFalse);
    h.client.dispose();
  });

  testWidgets('the reconnect snapshot is complete: a device that left while away disappears, and remove drops one at once', (tester) async {
    final h = Harness();
    await h.client.start();
    await tester.pump();
    final until = h.now.add(const Duration(seconds: 90));
    h.last.send(_device(_devA, 5, until: until));
    h.last.send(_device(_devB, 1, until: until));
    h.last.send(_ready);
    await tester.pump();
    expect(h.client.devices, hasLength(2));
    await h.last.drop(1006);
    await tester.pump(const Duration(seconds: 2));
    await tester.pump();
    h.last.send(_device(_devA, 2, until: until)); // the room restarted: a LOWER revision is the truth now
    h.last.send(_ready);
    await tester.pump();
    expect(h.client.devices.map((d) => d.deviceId), [_devA]);
    expect(h.client.devices.single.revision, 2);
    h.last.send({'type': 'remove', 'deviceId': _devA});
    await tester.pump();
    expect(h.client.devices, isEmpty);
    h.client.dispose();
  });

  testWidgets('an expired observation is reported as outdated by a timer alone - not as a disconnection', (tester) async {
    final h = Harness();
    var notified = 0;
    h.client.addListener(() => notified++);
    await h.client.start();
    await tester.pump();
    h.last.send(_device(_devA, 1, until: h.now.add(const Duration(seconds: 20))));
    h.last.send(_ready);
    await tester.pump();
    final before = notified;
    h.now = h.now.add(const Duration(seconds: 21));
    await tester.pump(const Duration(seconds: 21));
    expect(notified, greaterThan(before));
    expect(h.client.observedPowerKw('1'), isNull);
    expect(h.client.isOutdated('1'), isTrue);
    expect(h.client.link, LiveLinkState.connected); // the socket is still up
    h.client.dispose();
  });

  testWidgets('401/403/404 from the server ends live updates for good: no retry loop, no connection', (tester) async {
    for (final status in [401, 403, 404]) {
      final h = Harness(discovery: status);
      await h.client.start();
      await tester.pump(const Duration(minutes: 10));
      expect(h.httpCalls, hasLength(1), reason: 'status $status');
      expect(h.uris, isEmpty);
      expect(h.client.link, LiveLinkState.unavailable);
      h.client.dispose();
    }
  });

  testWidgets('a refused upgrade (403) also ends it; a transient failure backs off and reports degraded after repeated failures', (tester) async {
    final denied = Harness()..connectError = const WebSocketException('Connection to x was not upgraded to websocket, HTTP status code: 403');
    await denied.client.start();
    await tester.pump(const Duration(minutes: 5));
    expect(denied.uris, hasLength(1));
    expect(denied.client.link, LiveLinkState.unavailable);
    denied.client.dispose();

    final flaky = Harness()..connectError = const SocketException('offline');
    await flaky.client.start();
    for (var i = 0; i < 4; i++) {
      await tester.pump(const Duration(seconds: 70));
      flaky.now = flaky.now.add(const Duration(seconds: 70));
    }
    expect(flaky.client.link, LiveLinkState.reconnecting);
    expect(flaky.client.degraded, isTrue);
    // 1, 2, 4, 8, 16, 32 s then one per minute: 280 s is about ten attempts, never a tight loop.
    expect(flaky.uris.length, inInclusiveRange(8, 11));
    flaky.connectError = null;
    await tester.pump(const Duration(seconds: 70));
    flaky.last.send(_ready);
    await tester.pump();
    expect(flaky.client.degraded, isFalse);
    expect(flaky.client.link, LiveLinkState.connected);
    flaky.client.dispose();
  });

  testWidgets('stop() (sign-out) drops sockets, timers and every value', (tester) async {
    final h = Harness();
    await h.client.start();
    await tester.pump();
    h.last.send(_device(_devA, 1, until: h.now.add(const Duration(seconds: 60))));
    h.last.send(_ready);
    await tester.pump();
    h.client.stop();
    await tester.pump();
    expect(h.channels.single.closed, isTrue);
    expect(h.client.devices, isEmpty);
    expect(h.client.link, LiveLinkState.off);
    await tester.pump(const Duration(minutes: 5));
    expect(h.channels, hasLength(1));
    h.client.dispose();
  });

  test('a projection is parsed from only the fields a driver is sent', () {
    final parsed = LiveDeviceState.tryParse({
      'schema': 1,
      'deviceId': _devA,
      'generation': 2,
      'revision': 3,
      'observedAt': 1000,
      'online': true,
      'onlineUntil': 61000,
      'connectors': {
        '1': {'status': 'Charging', 'powerW': 11000.5, 'energyWh': 12},
      },
    });
    expect(parsed, isNotNull);
    expect(parsed!.connectors[1]!.powerW, 11000.5);
    expect(LiveDeviceState.tryParse({'deviceId': _devA}), isNull);
    expect(LiveDeviceState.tryParse('x'), isNull);
  });
}
