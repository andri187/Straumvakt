import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:straumvakt_app/screens/guest_welcome.dart';
import 'package:straumvakt_app/theme/palette.dart';

void main() {
  testWidgets('guest state does not imply an account or access', (
    tester,
  ) async {
    var signedIn = false;
    await tester.pumpWidget(
      MaterialApp(
        theme: AppTheme.dark(),
        home: GuestWelcomeScreen(onSignIn: () => signedIn = true),
      ),
    );

    expect(find.text('Sign in'), findsOneWidget);
    expect(find.text('Create account'), findsOneWidget);
    expect(
      find.textContaining('no driver, charger or billing data'),
      findsOneWidget,
    );

    await tester.tap(find.text('Create account'));
    await tester.pumpAndSettle();
    expect(find.text('Account creation is not available yet'), findsOneWidget);

    await tester.tapAt(const Offset(20, 20));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Sign in'));
    expect(signedIn, isTrue);
  });
}
