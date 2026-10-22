import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:straumvakt_mock1/main.dart';

void main() {
  testWidgets('renders charging home mock', (tester) async {
    await tester.pumpWidget(const StraumvaktMockApp());

    expect(find.text('N1 Drivers'), findsWidgets);
    expect(find.textContaining('63.9 kWh'), findsOneWidget);
    expect(find.text('Phone tap'), findsOneWidget);
    expect(find.text('Sidasta hle\u00f0sla'), findsNothing);
    expect(find.byIcon(Icons.bolt_rounded), findsWidgets);
  });

  testWidgets('shows time and estimated cost while charging', (tester) async {
    tester.view.physicalSize = const Size(800, 1200);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(const StraumvaktMockApp());

    final startButton = find.byKey(const ValueKey('start-charge-button'));
    await tester.ensureVisible(startButton);
    await tester.tap(startButton);
    await tester.pump(const Duration(milliseconds: 300));
    await tester.tap(find.byType(CustomScrollView));
    await tester.pump(const Duration(milliseconds: 300));

    expect(find.text('42 m\u00edn'), findsOneWidget);
    expect(find.text('312 kr.'), findsOneWidget);
    expect(find.text('Stop charging'), findsOneWidget);
  });
}
