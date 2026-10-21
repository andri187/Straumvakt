import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:straumvakt_app/api/client.dart';
import 'package:straumvakt_app/screens/redeem_driver_invite.dart';
import 'package:straumvakt_app/theme/palette.dart';

import '../support/fake_session_storage.dart';

void main() {
  testWidgets('redeems through the authenticated identity-bound endpoint', (
    tester,
  ) async {
    final api = StraumvaktApi(
      baseUrl: 'https://example.test',
      client: MockClient((request) async {
        expect(request.url.path, '/api/driver/redeem-invite');
        expect(request.headers['authorization'], 'Bearer access-token');
        expect(jsonDecode(request.body), {'token': 'BOUND-CODE-123'});
        return http.Response(
          jsonEncode({
            'ok': true,
            'driverGroupId': 'group-1',
            'driverGroupDisplayName': 'Demo employees',
            'installationDisplayName': 'Demo office',
          }),
          200,
        );
      }),
    );

    await tester.pumpWidget(
      MaterialApp(
        theme: AppTheme.dark(),
        home: RedeemDriverInviteScreen(
          api: api,
          storage: FakeSessionStorage(accessToken: 'access-token'),
        ),
      ),
    );
    await tester.enterText(find.byType(TextFormField), 'BOUND-CODE-123');
    await tester.tap(find.text('Redeem invitation'));
    await tester.pumpAndSettle();

    expect(find.text('Access granted'), findsOneWidget);
    expect(find.text('Demo employees'), findsOneWidget);
    expect(find.text('Demo office'), findsOneWidget);
  });

  testWidgets('does not imply access when the bound identity is rejected', (
    tester,
  ) async {
    final api = StraumvaktApi(
      baseUrl: 'https://example.test',
      client: MockClient(
        (_) async => http.Response(
          jsonEncode({'error': 'not_found', 'message': 'Invite not found.'}),
          404,
        ),
      ),
    );

    await tester.pumpWidget(
      MaterialApp(
        theme: AppTheme.dark(),
        home: RedeemDriverInviteScreen(
          api: api,
          storage: FakeSessionStorage(accessToken: 'access-token'),
        ),
      ),
    );
    await tester.enterText(find.byType(TextFormField), 'OTHER-CODE-123');
    await tester.tap(find.text('Redeem invitation'));
    await tester.pumpAndSettle();

    expect(find.text('Invite not found.'), findsOneWidget);
    expect(find.text('Access granted'), findsNothing);
  });
}
