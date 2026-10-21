import 'package:flutter/material.dart';

import '../api/types.dart';
import '../theme/palette.dart';

class AccountPrivacyScreen extends StatelessWidget {
  const AccountPrivacyScreen({super.key, required this.driver});

  final DriverProfile driver;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Account & privacy')),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(20, 18, 20, 28),
          children: [
            const Text(
              'Account',
              style: TextStyle(
                color: Colors.white,
                fontSize: 24,
                fontWeight: FontWeight.w900,
              ),
            ),
            const SizedBox(height: 18),
            ListTile(
              contentPadding: EdgeInsets.zero,
              title: const Text(
                'Signed-in email',
                style: TextStyle(color: BrandPalette.muted),
              ),
              subtitle: Text(
                driver.email,
                style: const TextStyle(color: Colors.white),
              ),
            ),
            const Divider(color: BrandPalette.border),
            const ListTile(
              enabled: false,
              contentPadding: EdgeInsets.zero,
              leading: Icon(Icons.delete_outline_rounded),
              title: Text('Delete account'),
              subtitle: Text(
                'Self-service deletion is not available in this build. Contact support for account requests.',
              ),
            ),
          ],
        ),
      ),
    );
  }
}
