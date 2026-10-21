import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:straumvakt_app/api/client.dart';
import 'package:straumvakt_app/api/types.dart';
import 'package:straumvakt_app/screens/active_session.dart';
import 'package:straumvakt_app/theme/palette.dart';

import '../support/fake_session_storage.dart';

http.Response _json(Object body, [int status = 200]) =>
    http.Response(jsonEncode(body), status);

ActiveSession _session(String id, String charger) => ActiveSession(
  sessionId: id,
  connectorId: 'connector-$id',
  chargerName: charger,
  status: 'Charging',
  startedAt: DateTime.utc(2026, 8, 9),
  energyKwh: 4,
);

Widget _app({
  required StraumvaktApi api,
  required ActiveSession initial,
  ValueChanged<List<ActiveSession>>? onDoneWithSessions,
}) => MaterialApp(
  theme: AppTheme.dark(),
  home: ActiveSessionScreen(
    api: api,
    storage: FakeSessionStorage(accessToken: 'token'),
    initialSession: initial,
    onDoneWithSessions: onDoneWithSessions,
    pollInterval: const Duration(hours: 1),
  ),
);

void main() {
  testWidgets('tracked session stays selected when response order changes', (
    tester,
  ) async {
    final api = StraumvaktApi(
      baseUrl: 'https://example.test',
      client: MockClient(
        (request) async => _json({
          'sessions': [
            {
              'sessionId': 'other',
              'chargerName': 'Other charger',
              'status': 'Charging',
            },
            {
              'sessionId': 'tracked',
              'chargerName': 'Tracked charger updated',
              'status': 'Charging',
            },
          ],
        }),
      ),
    );

    await tester.pumpWidget(
      _app(api: api, initial: _session('tracked', 'Old')),
    );
    await tester.pumpAndSettle();

    expect(find.text('Tracked charger updated'), findsOneWidget);
    expect(find.text('Other charger'), findsNothing);
  });

  testWidgets('tracked disappearance ends it instead of switching sessions', (
    tester,
  ) async {
    final api = StraumvaktApi(
      baseUrl: 'https://example.test',
      client: MockClient((request) async {
        if (request.url.path.endsWith('/current')) {
          return _json({
            'sessions': [
              {
                'sessionId': 'other',
                'chargerName': 'Other charger',
                'status': 'Charging',
              },
            ],
          });
        }
        expect(request.url.path, '/api/driver/sessions/tracked');
        return _json({
          'session': {
            'sessionId': 'tracked',
            'startedAt': '2026-08-09T00:00:00Z',
            'endedAt': '2026-08-09T01:00:00Z',
            'energyKwh': 8.5,
            'costFormatted': '425 kr',
          },
        });
      }),
    );

    await tester.pumpWidget(
      _app(api: api, initial: _session('tracked', 'Old')),
    );
    await tester.pumpAndSettle();

    expect(find.text('Charge complete'), findsOneWidget);
    expect(find.text('425 kr'), findsOneWidget);
    expect(find.text('Other charger'), findsNothing);
  });

  testWidgets('settlement returns the remaining active session identities', (
    tester,
  ) async {
    List<ActiveSession>? remaining;
    final api = StraumvaktApi(
      baseUrl: 'https://example.test',
      client: MockClient((request) async {
        if (request.url.path.endsWith('/current')) {
          return _json({
            'sessions': [
              {
                'sessionId': 'remaining',
                'chargerName': 'Remaining charger',
                'status': 'Charging',
              },
            ],
          });
        }
        return _json({
          'session': {
            'sessionId': 'tracked',
            'startedAt': '2026-08-09T00:00:00Z',
            'endedAt': '2026-08-09T01:00:00Z',
            'energyKwh': 8.5,
          },
        });
      }),
    );

    await tester.pumpWidget(
      _app(
        api: api,
        initial: _session('tracked', 'Old'),
        onDoneWithSessions: (sessions) => remaining = sessions,
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Done'));

    expect(remaining, hasLength(1));
    expect(remaining!.single.sessionId, 'remaining');
  });

  testWidgets('transient poll error preserves the last known snapshot', (
    tester,
  ) async {
    final api = StraumvaktApi(
      baseUrl: 'https://example.test',
      client: MockClient((_) async => throw StateError('offline')),
    );

    await tester.pumpWidget(
      _app(api: api, initial: _session('tracked', 'Known charger')),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));

    expect(find.text('Known charger'), findsOneWidget);
    expect(find.text('Charge complete'), findsNothing);
  });
}
