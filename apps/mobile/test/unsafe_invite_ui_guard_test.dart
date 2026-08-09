import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

String source(String path) => File(path).readAsStringSync();

void main() {
  const reachableUi = <String>[
    'lib/main.dart',
    'lib/screens/empty_access.dart',
    'lib/screens/menu_drawer.dart',
    'lib/screens/redeem_driver_invite.dart',
  ];

  test(
    'reachable driver UI does not import the parked bearer invite screen',
    () {
      for (final path in reachableUi) {
        expect(
          source(path),
          isNot(contains("'redeem_invite.dart'")),
          reason: path,
        );
      }
    },
  );

  test('reachable driver UI does not call the unsafe consume contract', () {
    for (final path in reachableUi) {
      expect(source(path), isNot(contains('consumeInvite(')), reason: path);
    }
  });

  test('identity-bound redemption remains the empty-state route', () {
    final empty = source('lib/screens/empty_access.dart');
    expect(empty, contains("'redeem_driver_invite.dart'"));
    expect(empty, contains('RedeemDriverInviteScreen'));
  });

  test('parked bearer flow remains visibly isolated', () {
    final parked = source('lib/screens/redeem_invite.dart');
    expect(parked, contains('consumeInvite('));
    expect(parked, contains('class RedeemInviteScreen'));
  });
}
