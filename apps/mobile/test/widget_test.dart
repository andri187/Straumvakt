import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:straumvakt_app/api/types.dart';
import 'package:straumvakt_app/screens/my_vehicle.dart';
import 'package:straumvakt_app/screens/active_session.dart';
import 'package:straumvakt_app/screens/hero_image.dart';
import 'package:straumvakt_app/theme/palette.dart';

void main() {
  test('current-session envelope preserves multiple sessions', () {
    final response = ActiveSessionsResponse.fromJson({
      'sessions': [
        {
          'sessionId': 'newest',
          'connectorId': null,
          'chargerName': 'North',
          'status': 'Charging',
          'startedAt': '2026-08-08T22:00:00Z',
          'powerKw': 0,
          'energyKwh': 12.5,
          'costIsk': 0,
        },
        {
          'sessionId': 'older',
          'connectorId': 'connector-2',
          'chargerName': 'South',
          'status': 'Charging',
          'startedAt': '2026-08-08T21:00:00Z',
          'powerKw': 7.2,
          'energyKwh': 4.1,
          'costIsk': 2500,
        },
      ],
    });

    expect(response.sessions, hasLength(2));
    expect(response.sessions.first.sessionId, 'newest');
    expect(response.sessions.first.connectorId, isNull);
    expect(response.sessions.first.powerKw, isNull);
    expect(response.sessions.first.costIsk, isNull);
    expect(response.sessions.last.powerKw, 7.2);
  });

  test('session detail keeps an unavailable price truthful', () {
    final detail = DriverSessionDetail.fromJson({
      'sessionId': 'session-1',
      'startedAt': '2026-08-08T20:00:00Z',
      'endedAt': '2026-08-08T21:30:00Z',
      'durationSec': 5400,
      'chargeTimeSec': 3600,
      'idleTimeSec': 1800,
      'energyKwh': '24.125',
      'costFormatted': null,
    });

    expect(detail.energyKwh, 24.125);
    expect(detail.durationLabel, '1h 30m');
    expect(detail.costFormatted, isNull);
  });

  testWidgets('vehicle screen does not fabricate a vehicle or plate', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(theme: AppTheme.dark(), home: const MyVehicleScreen()),
    );

    expect(find.text('No vehicle connected'), findsOneWidget);
    expect(find.text('Not available'), findsOneWidget);
    expect(find.text('Tesla Model Y'), findsNothing);
    expect(find.textContaining('N1 742'), findsNothing);
  });

  testWidgets('home artwork does not assert a driver plate', (tester) async {
    await tester.pumpWidget(
      MaterialApp(theme: AppTheme.dark(), home: const HeroImageBanner()),
    );

    expect(find.textContaining('N1 742'), findsNothing);
  });

  testWidgets('market screens fit a narrow mobile viewport', (tester) async {
    await tester.binding.setSurfaceSize(const Size(320, 640));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    await tester.pumpWidget(
      MaterialApp(theme: AppTheme.dark(), home: const MyVehicleScreen()),
    );
    expect(tester.takeException(), isNull);
    expect(find.text('No vehicle connected'), findsOneWidget);

    await tester.pumpWidget(
      MaterialApp(
        theme: AppTheme.dark(),
        home: ActiveSessionScreen(
          pollingEnabled: false,
          initialSession: ActiveSession(
            sessionId: 'narrow-session',
            connectorId: 'narrow-connector',
            chargerName: 'Narrow viewport charger',
            status: 'Charging',
            startedAt: DateTime(2026, 8, 8, 12),
            energyKwh: 8.25,
          ),
        ),
      ),
    );
    await tester.pump();
    expect(tester.takeException(), isNull);
    expect(find.text('Unavailable'), findsOneWidget);
    expect(find.text('Pending'), findsOneWidget);
  });
}
