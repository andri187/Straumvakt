import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:straumvakt_app/api/types.dart';
import 'package:straumvakt_app/screens/active_session.dart';
import 'package:straumvakt_app/screens/my_vehicle.dart';
import 'package:straumvakt_app/theme/palette.dart';

ActiveSession _session() => ActiveSession(
  sessionId: 'session-1',
  connectorId: 'connector-1',
  chargerName: 'A very long harbour installation charger name',
  status: 'SuspendedEVSE',
  startedAt: DateTime.now().subtract(const Duration(hours: 5)),
  energyKwh: 1234.567,
  powerKw: 350.25,
  costIsk: 987654321,
);

Widget _scaled(Widget child, double scale) => MaterialApp(
  theme: AppTheme.dark(),
  home: MediaQuery(
    data: MediaQueryData(textScaler: TextScaler.linear(scale)),
    child: child,
  ),
);

void main() {
  for (final entry in <(Size, double)>[
    (const Size(320, 568), 1),
    (const Size(320, 568), 1.3),
    (const Size(360, 800), 1),
    (const Size(360, 800), 2),
    (const Size(412, 915), 1),
  ]) {
    testWidgets(
      'launch screens fit ${entry.$1.width.toInt()}x${entry.$1.height.toInt()} '
      'at ${entry.$2}x text',
      (tester) async {
        await tester.binding.setSurfaceSize(entry.$1);
        addTearDown(() => tester.binding.setSurfaceSize(null));

        await tester.pumpWidget(
          _scaled(
            ActiveSessionScreen(
              pollingEnabled: false,
              initialSession: _session(),
            ),
            entry.$2,
          ),
        );
        await tester.pump();
        expect(tester.takeException(), isNull);
        await tester.drag(find.byType(ListView).first, const Offset(0, -1000));
        await tester.pump();
        expect(find.text('Stop charging'), findsOneWidget);

        await tester.pumpWidget(_scaled(const MyVehicleScreen(), entry.$2));
        await tester.pump();
        expect(tester.takeException(), isNull);
        expect(find.text('No vehicle connected'), findsOneWidget);
      },
    );
  }

  testWidgets('charging metrics expose associated semantic labels', (
    tester,
  ) async {
    final handle = tester.ensureSemantics();
    await tester.pumpWidget(
      _scaled(
        ActiveSessionScreen(pollingEnabled: false, initialSession: _session()),
        1,
      ),
    );

    expect(
      find.bySemanticsLabel('Energy delivered: 1234.57 kWh'),
      findsOneWidget,
    );
    expect(find.bySemanticsLabel('Observed power: 350.3 kW'), findsOneWidget);
    expect(find.bySemanticsLabel('Current cost: 9876543 kr'), findsOneWidget);
    handle.dispose();
  });

  test(
    'all connector statuses map explicitly and unknown values stay unknown',
    () {
      const mappings = {
        'Available': ConnectorStatus.available,
        'Preparing': ConnectorStatus.preparing,
        'Charging': ConnectorStatus.charging,
        'SuspendedEV': ConnectorStatus.suspendedEv,
        'SuspendedEVSE': ConnectorStatus.suspendedEvse,
        'Finishing': ConnectorStatus.finishing,
        'Unavailable': ConnectorStatus.unavailable,
        'Faulted': ConnectorStatus.faulted,
        'Offline': ConnectorStatus.offline,
      };
      for (final entry in mappings.entries) {
        expect(ConnectorStatus.fromString(entry.key), entry.value);
      }
      expect(
        ConnectorStatus.fromString('FutureStatus'),
        ConnectorStatus.unknown,
      );
      expect(ConnectorStatus.fromString(null), ConnectorStatus.unknown);
      expect(ConnectorStatus.unknown.canStart, isFalse);
    },
  );
}
