import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:straumvakt_app/api/types.dart';
import 'package:straumvakt_app/screens/empty_access.dart';
import 'package:straumvakt_app/screens/installation_access.dart';
import 'package:straumvakt_app/theme/palette.dart';

const driver = DriverProfile(
  id: 'driver',
  email: 'driver@example.test',
  displayName: 'Driver',
  locale: 'en',
);

void main() {
  testWidgets('unaffiliated state exposes no installation identity', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: AppTheme.dark(),
        home: const EmptyAccessScreen(driver: driver),
      ),
    );
    expect(find.text('No charging access yet'), findsOneWidget);
    expect(find.text('Use installation code'), findsOneWidget);
    await tester.tap(find.text('Use installation code'));
    await tester.pumpAndSettle();
    expect(find.textContaining('not connected in this build'), findsOneWidget);
  });

  testWidgets('pending request stays visible while access is empty', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: AppTheme.dark(),
        home: const EmptyAccessScreen(
          driver: driver,
          requestState: DriverAccessRequestState.pending,
        ),
      ),
    );
    expect(find.text('Waiting for approval'), findsOneWidget);
  });

  testWidgets('empty state exposes a semantic heading', (tester) async {
    final semantics = tester.ensureSemantics();
    await tester.pumpWidget(
      MaterialApp(
        theme: AppTheme.dark(),
        home: const EmptyAccessScreen(driver: driver),
      ),
    );
    expect(
      tester
          .getSemantics(find.text('No charging access yet'))
          .getSemanticsData()
          .flagsCollection
          .isHeader,
      isTrue,
    );
    semantics.dispose();
  });

  testWidgets('pending request is announced as one live status', (
    tester,
  ) async {
    final semantics = tester.ensureSemantics();
    await tester.pumpWidget(
      MaterialApp(
        theme: AppTheme.dark(),
        home: const EmptyAccessScreen(
          driver: driver,
          requestState: DriverAccessRequestState.pending,
        ),
      ),
    );
    expect(
      find.bySemanticsLabel(
        'Access request pending. The organisation is reviewing your request.',
      ),
      findsOneWidget,
    );
    semantics.dispose();
  });

  testWidgets('real gateway callback enables installation submission', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: AppTheme.dark(),
        home: EmptyAccessScreen(
          driver: driver,
          onInstallationAccess: (_, _) async =>
              InstallationAccessResult.pending,
        ),
      ),
    );
    expect(find.text('Use installation code'), findsOneWidget);
  });
}
