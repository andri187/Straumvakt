import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:straumvakt_app/api/client.dart';
import 'package:straumvakt_app/screens/session_detail.dart';
import 'package:straumvakt_app/theme/palette.dart';

import '../support/fake_session_storage.dart';

Widget _app(StraumvaktApi api) => MaterialApp(
  theme: AppTheme.dark(),
  home: SessionDetailScreen(
    sessionId: 'session-1',
    api: api,
    storage: FakeSessionStorage(accessToken: 'token'),
  ),
);

void main() {
  testWidgets('detail stays loading until the projection arrives', (
    tester,
  ) async {
    final response = Completer<http.Response>();
    final api = StraumvaktApi(
      baseUrl: 'https://example.test',
      client: MockClient((_) => response.future),
    );

    await tester.pumpWidget(_app(api));
    await tester.pump();
    expect(find.byType(CircularProgressIndicator), findsOneWidget);
    expect(find.textContaining('0 kr'), findsNothing);

    response.complete(
      http.Response(
        jsonEncode({
          'session': {
            'sessionId': 'session-1',
            'startedAt': '2026-08-09T00:00:00Z',
            'energyKwh': 6.25,
            'costFormatted': null,
          },
        }),
        200,
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Not priced yet'), findsOneWidget);
    expect(find.text('6.25 kWh'), findsOneWidget);
  });

  testWidgets('detail error exposes a working retry', (tester) async {
    var attempts = 0;
    final api = StraumvaktApi(
      baseUrl: 'https://example.test',
      client: MockClient((_) async {
        attempts++;
        if (attempts == 1) {
          return http.Response(jsonEncode({'message': 'Not ready'}), 404);
        }
        return http.Response(
          jsonEncode({
            'session': {
              'sessionId': 'session-1',
              'startedAt': '2026-08-09T00:00:00Z',
              'energyKwh': 7,
              'costFormatted': '350 kr',
            },
          }),
          200,
        );
      }),
    );

    await tester.pumpWidget(_app(api));
    await tester.pumpAndSettle();
    expect(find.text('Retry'), findsOneWidget);
    await tester.tap(find.text('Retry'));
    await tester.pumpAndSettle();
    expect(find.text('350 kr'), findsOneWidget);
    expect(attempts, 2);
  });
}
