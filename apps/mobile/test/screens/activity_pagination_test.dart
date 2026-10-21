import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:straumvakt_app/api/client.dart';
import 'package:straumvakt_app/screens/charge_history.dart';
import 'package:straumvakt_app/theme/palette.dart';

import '../support/fake_session_storage.dart';

Map<String, Object?> _row(int id) => {
  'sessionId': 'session-$id',
  'startedAt': '2026-08-08T20:00:00Z',
  'durationSec': 3600,
  'energyKwh': id.toDouble(),
  'costIsk': id.isEven ? id * 100 : null,
  'chargerName': 'Charger $id',
};

http.Response _page(List<Map<String, Object?>> rows, [int status = 200]) =>
    http.Response(jsonEncode({'sessions': rows}), status);

Widget _app(StraumvaktApi api) => MaterialApp(
  theme: AppTheme.dark(),
  home: ChargeHistoryScreen(
    api: api,
    storage: FakeSessionStorage(accessToken: 'token'),
  ),
);

Future<void> _toBottom(WidgetTester tester) async {
  final state = tester.state<ScrollableState>(find.byType(Scrollable));
  state.position.jumpTo(state.position.maxScrollExtent);
  await tester.pumpAndSettle();
}

Future<void> _toTop(WidgetTester tester) async {
  final state = tester.state<ScrollableState>(find.byType(Scrollable));
  state.position.jumpTo(0);
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('loads 25 rows then deduplicates a short final page', (
    tester,
  ) async {
    final requests = <Uri>[];
    final api = StraumvaktApi(
      baseUrl: 'https://example.test',
      client: MockClient((request) async {
        requests.add(request.url);
        final skip = int.parse(request.url.queryParameters['skip']!);
        return skip == 0
            ? _page(List.generate(25, _row))
            : _page([_row(24), _row(25), _row(26)]);
      }),
    );

    await tester.pumpWidget(_app(api));
    await tester.pumpAndSettle();
    expect(requests.single.queryParameters, {'skip': '0', 'limit': '25'});
    expect(find.text('25 sessions'), findsOneWidget);

    await _toBottom(tester);
    await tester.pumpAndSettle();

    expect(requests.last.queryParameters, {'skip': '25', 'limit': '25'});
    await _toTop(tester);
    expect(find.text('27 sessions'), findsOneWidget);
    expect(find.text('Load more'), findsNothing);
  });

  testWidgets('later-page failure preserves rows and offers retry', (
    tester,
  ) async {
    final api = StraumvaktApi(
      baseUrl: 'https://example.test',
      client: MockClient((request) async {
        final skip = int.parse(request.url.queryParameters['skip']!);
        if (skip == 0) return _page(List.generate(25, _row));
        return http.Response(
          jsonEncode({'message': 'Temporarily offline'}),
          503,
        );
      }),
    );

    await tester.pumpWidget(_app(api));
    await tester.pumpAndSettle();
    await _toBottom(tester);
    await tester.pumpAndSettle();

    expect(find.text('Temporarily offline'), findsOneWidget);
    expect(find.text('Retry'), findsOneWidget);
    await _toTop(tester);
    expect(find.text('25 sessions'), findsOneWidget);
  });

  testWidgets('pull-to-refresh resets the history offset', (tester) async {
    final offsets = <String>[];
    final api = StraumvaktApi(
      baseUrl: 'https://example.test',
      client: MockClient((request) async {
        offsets.add(request.url.queryParameters['skip']!);
        return _page([_row(offsets.length)]);
      }),
    );

    await tester.pumpWidget(_app(api));
    await tester.pumpAndSettle();
    await tester.drag(find.byType(Scrollable), const Offset(0, 500));
    await tester.pump(const Duration(seconds: 1));
    await tester.pumpAndSettle();

    expect(offsets, ['0', '0']);
    expect(find.text('Charger 2'), findsOneWidget);
    expect(find.text('Charger 1'), findsNothing);
  });
}
