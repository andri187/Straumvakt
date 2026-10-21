import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:straumvakt_app/screens/my_vehicle.dart';
import 'package:straumvakt_app/theme/palette.dart';

void main() {
  Widget buildSubject() {
    return MaterialApp(
      theme: AppTheme.dark(),
      home: const MyVehicleScreen(showBackButton: false),
    );
  }

  testWidgets('shows the vehicle summary and local states', (tester) async {
    await tester.pumpWidget(buildSubject());

    expect(find.text('My vehicle'), findsOneWidget);
    expect(find.text('Tesla Model Y'), findsOneWidget);
    expect(find.text('N1'), findsNWidgets(2));
    expect(find.text('742'), findsNWidgets(2));
    expect(find.text('75 kWh'), findsOneWidget);
    expect(find.text('Not set up'), findsOneWidget);
  });

  testWidgets('offers the top five subtypes through the type cascade', (
    tester,
  ) async {
    await tester.pumpWidget(buildSubject());
    await tester.tap(find.byKey(const Key('edit-vehicle-button')));
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('vehicle-subtype-field-TESLA')));
    await tester.pumpAndSettle();
    expect(find.text('Model Y'), findsWidgets);
    expect(find.text('Model 3'), findsOneWidget);
    await tester.tap(find.text('Model Y').last);
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('vehicle-type-field')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Nissan').last);
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('vehicle-subtype-field-NISSAN')));
    await tester.pumpAndSettle();
    expect(find.text('Leaf'), findsWidgets);
    expect(find.text('Leaf 40 kWh'), findsOneWidget);
    await tester.tap(find.text('Leaf').last);
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('vehicle-type-field')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Hyundai').last);
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('vehicle-subtype-field-HYUNDAI')));
    await tester.pumpAndSettle();
    expect(find.text('Kona'), findsWidgets);
  });

  testWidgets('selects type, subtype, paint, plate, and nickname', (
    tester,
  ) async {
    await tester.pumpWidget(buildSubject());
    await tester.tap(find.byKey(const Key('edit-vehicle-button')));
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('vehicle-type-field')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Nissan').last);
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('vehicle-subtype-field-NISSAN')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Leaf 40 kWh').last);
    await tester.pumpAndSettle();

    await tester.enterText(
      find.byKey(const Key('vehicle-plate-field')),
      'EV314',
    );
    await tester.enterText(
      find.byKey(const Key('vehicle-nickname-field')),
      'Commuter',
    );
    await tester.ensureVisible(find.byKey(const Key('open-paint-palette')));
    await tester.tap(find.byKey(const Key('open-paint-palette')));
    await tester.pumpAndSettle();
    expect(find.text('RAL display approximations'), findsOneWidget);
    await tester.ensureVisible(find.byKey(const Key('paint-crimson')));
    await tester.tap(find.byKey(const Key('paint-crimson')));
    await tester.pumpAndSettle();
    await tester.scrollUntilVisible(
      find.byKey(const Key('paint-finish-metallic')),
      420,
      scrollable: find
          .descendant(
            of: find.byKey(const Key('paint-palette-scroll')),
            matching: find.byType(Scrollable),
          )
          .first,
    );
    await tester.tap(find.byKey(const Key('paint-finish-metallic')));
    await tester.scrollUntilVisible(
      find.byKey(const Key('apply-paint-button')),
      300,
      scrollable: find
          .descendant(
            of: find.byKey(const Key('paint-palette-scroll')),
            matching: find.byType(Scrollable),
          )
          .first,
    );
    await tester.tap(find.byKey(const Key('apply-paint-button')));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.byKey(const Key('save-vehicle-button')));
    await tester.tap(find.byKey(const Key('save-vehicle-button')));
    await tester.pumpAndSettle();

    expect(find.text('Nissan Leaf 40 kWh'), findsOneWidget);
    expect(find.text('EV'), findsNWidgets(2));
    expect(find.text('314'), findsNWidgets(2));
    expect(find.textContaining('Commuter'), findsOneWidget);
    expect(find.text('40 kWh'), findsOneWidget);
    expect(find.textContaining('Crimson'), findsWidgets);
    expect(find.textContaining('Metallic'), findsWidgets);
  });

  testWidgets('enables the Autocharge presentation state', (tester) async {
    await tester.pumpWidget(buildSubject());
    await tester.ensureVisible(find.byKey(const Key('autocharge-row')));
    await tester.tap(find.byKey(const Key('autocharge-row')));
    await tester.pumpAndSettle();

    expect(find.text('Set up Autocharge'), findsOneWidget);
    await tester.tap(find.byKey(const Key('enable-autocharge-button')));
    await tester.pumpAndSettle();

    expect(find.text('Vehicle identity enrolled'), findsOneWidget);
    expect(find.text('Ready'), findsOneWidget);
    expect(find.text('EVCCID ...N1742'), findsOneWidget);
  });
}
