import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:straumvakt_app/api/types.dart';
import 'package:straumvakt_app/screens/session_picker.dart';
import 'package:straumvakt_app/theme/palette.dart';

ActiveSession session(String id, String charger, String connector) =>
    ActiveSession(
      sessionId: id,
      connectorId: connector,
      chargerName: charger,
      status: 'Charging',
      energyKwh: 5.25,
    );

void main() {
  testWidgets('lists every active charge and returns the selected identity', (
    tester,
  ) async {
    ActiveSession? selected;
    final sessions = [
      session('one', 'Garage', '1'),
      session('two', 'Workplace', '2'),
    ];
    await tester.pumpWidget(
      MaterialApp(
        theme: AppTheme.dark(),
        home: SessionPickerScreen(
          sessions: sessions,
          onSelected: (value) => selected = value,
        ),
      ),
    );

    expect(find.text('2 active charges'), findsNothing);
    expect(find.text('Garage'), findsOneWidget);
    expect(find.text('Workplace'), findsOneWidget);
    expect(find.textContaining('Connector 1'), findsOneWidget);

    await tester.tap(find.text('Workplace'));
    expect(selected?.sessionId, 'two');
  });
}
