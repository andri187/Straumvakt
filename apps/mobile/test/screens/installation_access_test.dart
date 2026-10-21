import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:straumvakt_app/screens/installation_access.dart';
import 'package:straumvakt_app/theme/palette.dart';

Widget app(InstallationAccessSubmit submit) => MaterialApp(
  theme: AppTheme.dark(),
  home: InstallationAccessScreen(onSubmit: submit),
);

void main() {
  testWidgets('disabled contract disables fields and submit action', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: AppTheme.dark(),
        home: InstallationAccessScreen(
          enabled: false,
          onSubmit: (_, _) async => InstallationAccessResult.granted,
        ),
      ),
    );
    final fields = tester.widgetList<TextFormField>(find.byType(TextFormField));
    expect(fields.every((field) => field.enabled == false), isTrue);
    expect(
      tester.widget<FilledButton>(find.byType(FilledButton)).onPressed,
      isNull,
    );
  });

  testWidgets('disabled contract explains the unavailable dependency', (
    tester,
  ) async {
    final semantics = tester.ensureSemantics();
    await tester.pumpWidget(
      MaterialApp(
        theme: AppTheme.dark(),
        home: InstallationAccessScreen(
          enabled: false,
          onSubmit: (_, _) async => InstallationAccessResult.granted,
        ),
      ),
    );
    expect(
      find.bySemanticsLabel(
        'Installation access codes are unavailable. You can still use an invitation.',
      ),
      findsOneWidget,
    );
    semantics.dispose();
  });

  testWidgets('screen title is an accessibility heading', (tester) async {
    final semantics = tester.ensureSemantics();
    await tester.pumpWidget(
      app((_, _) async => InstallationAccessResult.granted),
    );
    expect(
      tester
          .getSemantics(find.text('Join an installation'))
          .getSemanticsData()
          .flagsCollection
          .isHeader,
      isTrue,
    );
    semantics.dispose();
  });

  testWidgets('requires both access credential fields', (tester) async {
    await tester.pumpWidget(
      app((_, _) async => InstallationAccessResult.granted),
    );
    await tester.tap(find.text('Continue'));
    await tester.pump();
    expect(find.text('Installation code required'), findsOneWidget);
    expect(find.text('Passphrase required'), findsOneWidget);
  });

  testWidgets('renders pending approval without inventing installation data', (
    tester,
  ) async {
    await tester.pumpWidget(
      app((code, passphrase) async {
        expect(code, 'DAL-201');
        expect(passphrase, 'correct horse');
        return InstallationAccessResult.pending;
      }),
    );
    await tester.enterText(find.byType(TextFormField).at(0), 'DAL-201');
    await tester.enterText(find.byType(TextFormField).at(1), 'correct horse');
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();
    expect(find.text('Waiting for approval'), findsOneWidget);
    expect(find.textContaining('organisation will review'), findsOneWidget);
  });

  testWidgets('pending result is announced as one live status', (tester) async {
    final semantics = tester.ensureSemantics();
    await tester.pumpWidget(
      app((_, _) async => InstallationAccessResult.pending),
    );
    await tester.enterText(find.byType(TextFormField).at(0), 'DAL-201');
    await tester.enterText(find.byType(TextFormField).at(1), 'correct horse');
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();
    expect(
      find.bySemanticsLabel(
        'Waiting for approval. The organisation will review your request.',
      ),
      findsOneWidget,
    );
    semantics.dispose();
  });

  testWidgets('network failure is announced as an error', (tester) async {
    final semantics = tester.ensureSemantics();
    await tester.pumpWidget(app((_, _) => throw Exception('offline')));
    await tester.enterText(find.byType(TextFormField).at(0), 'DAL-201');
    await tester.enterText(find.byType(TextFormField).at(1), 'correct horse');
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();
    expect(
      find.bySemanticsLabel('Error: Access could not be checked. Try again.'),
      findsOneWidget,
    );
    semantics.dispose();
  });

  testWidgets('renders rejection as a recoverable state', (tester) async {
    await tester.pumpWidget(
      app((_, _) async => InstallationAccessResult.rejected),
    );
    await tester.enterText(find.byType(TextFormField).at(0), 'NOPE');
    await tester.enterText(find.byType(TextFormField).at(1), 'wrong');
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();
    expect(find.text('Access not granted'), findsOneWidget);
    expect(find.text('Continue'), findsOneWidget);
  });
}
