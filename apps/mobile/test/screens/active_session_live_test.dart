import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:straumvakt_app/api/client.dart';
import 'package:straumvakt_app/api/types.dart';
import 'package:straumvakt_app/live/live_client.dart';
import 'package:straumvakt_app/screens/active_session.dart';
import 'package:straumvakt_app/theme/palette.dart';

import '../support/fake_session_storage.dart';

const _inst = '11111111-1111-4111-8111-111111111111';
const _dev = 'aaaaaaaa-0000-4000-8000-000000000001';

class _Channel implements LiveChannel {
  final controller = StreamController<String>();
  int? code;
  @override
  Stream<String> get messages => controller.stream;
  @override
  int? get closeCode => code;
  @override
  Future<void> close() async {
    if (!controller.isClosed) await controller.close();
  }
}

void main() {
  late int sessionReads;
  late List<_Channel> channels;
  late DriverLiveClient live;
  late DateTime now;

  setUp(() {
    sessionReads = 0;
    channels = [];
    now = DateTime.now();
  });

  StraumvaktApi api() => StraumvaktApi(
    baseUrl: 'https://api.example.test',
    client: MockClient((request) async {
      sessionReads++;
      return http.Response(
        jsonEncode({
          'sessions': [
            {'sessionId': 's1', 'connectorId': '1', 'chargerName': 'Bay 1', 'status': 'Charging', 'energyKwh': 4.2, 'powerKw': 0},
          ],
        }),
        200,
      );
    }),
  );

  DriverLiveClient makeLive({bool failConnect = false}) => DriverLiveClient(
    baseUrl: 'https://shell.example.test',
    tokenProvider: () async => 'token',
    httpClient: MockClient((_) async => http.Response(jsonEncode({'installations': [{'installationId': _inst}]}), 200)),
    connector: (uri, headers) async {
      if (failConnect) throw Exception('offline');
      final c = _Channel();
      channels.add(c);
      return c;
    },
    clock: () => now,
    random: () => 0.5,
  );

  Widget app({required DriverLiveClient? liveClient}) => MaterialApp(
    theme: AppTheme.dark(),
    home: ActiveSessionScreen(
      api: api(),
      storage: FakeSessionStorage(accessToken: 'token'),
      initialSession: const ActiveSession(sessionId: 's1', connectorId: '1', chargerName: 'Bay 1', status: 'Charging', energyKwh: 4),
      pollInterval: const Duration(seconds: 3),
      liveApiPollInterval: const Duration(seconds: 30),
      live: liveClient,
    ),
  );

  void deliver(_Channel c, {int power = 7200, Duration life = const Duration(seconds: 60)}) {
    c.controller.add(jsonEncode({
      'type': 'device',
      'value': {
        'schema': 1, 'deviceId': _dev, 'generation': 1, 'revision': 1, 'observedAt': now.millisecondsSinceEpoch, 'online': true,
        'onlineUntil': now.add(life).millisecondsSinceEpoch,
        'connectors': {'1': {'status': 'Charging', 'powerW': power}},
      },
    }));
    c.controller.add(jsonEncode({'type': 'ready', 'installationId': _inst, 'expiresAt': 0}));
  }

  testWidgets('without a live client the screen behaves exactly as before: API cadence, placeholder power is "Unavailable"', (tester) async {
    await tester.pumpWidget(app(liveClient: null));
    await tester.pump();
    final first = sessionReads;
    await tester.pump(const Duration(seconds: 30));
    expect(sessionReads - first, greaterThanOrEqualTo(9)); // every 3 s
    expect(find.text('Unavailable'), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets('with live data flowing: measured power is shown, and the API is read far less often', (tester) async {
    live = makeLive();
    await tester.pumpWidget(app(liveClient: live));
    await tester.pump();
    await tester.pump();
    deliver(channels.single);
    await tester.pump();
    await tester.pump();
    expect(find.text('7.2 kW (live)'), findsOneWidget);
    final before = sessionReads;
    await tester.pump(const Duration(seconds: 27));
    expect(sessionReads - before, lessThanOrEqualTo(1)); // not ~9 reads
    // Energy and completion still come from the API, which is still read.
    await tester.pump(const Duration(seconds: 10));
    expect(sessionReads - before, greaterThanOrEqualTo(1));
    await tester.pumpWidget(const SizedBox());
    live.dispose();
  });

  testWidgets('when live data stops being available the established fast cadence resumes, and an expired observation says so', (tester) async {
    live = makeLive();
    await tester.pumpWidget(app(liveClient: live));
    await tester.pump();
    await tester.pump();
    deliver(channels.single, life: const Duration(seconds: 10));
    await tester.pump();
    await tester.pump();
    expect(find.text('7.2 kW (live)'), findsOneWidget);
    now = now.add(const Duration(seconds: 11));
    await tester.pump(const Duration(seconds: 11));
    expect(find.text('Outdated'), findsOneWidget);
    expect(find.textContaining('7.2'), findsNothing);
    // The socket drops and cannot come back: past the grace and the failure limit, the API is polled at its normal pace.
    await channels.single.controller.close();
    now = now.add(const Duration(minutes: 2));
    await tester.pump(const Duration(minutes: 2));
    final before = sessionReads;
    await tester.pump(const Duration(seconds: 30));
    expect(sessionReads - before, greaterThanOrEqualTo(9));
    await tester.pumpWidget(const SizedBox());
    live.dispose();
  });

  testWidgets('leaving the screen closes the live connection', (tester) async {
    live = makeLive();
    await tester.pumpWidget(app(liveClient: live));
    await tester.pump();
    await tester.pump();
    expect(channels, hasLength(1));
    await tester.pumpWidget(const SizedBox());
    // The injected client is owned by the caller; the screen only stops listening.
    live.stop();
    await tester.pump(const Duration(minutes: 5));
    expect(channels, hasLength(1));
    expect(live.devices, isEmpty);
  });
}
