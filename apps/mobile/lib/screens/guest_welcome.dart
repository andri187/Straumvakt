import 'package:flutter/material.dart';

import '../theme/logo.dart';
import '../theme/palette.dart';

class GuestWelcomeScreen extends StatelessWidget {
  const GuestWelcomeScreen({super.key, required this.onSignIn});

  final VoidCallback onSignIn;

  void _explainRegistration(BuildContext context) {
    showModalBottomSheet<void>(
      context: context,
      backgroundColor: BrandPalette.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(8)),
      ),
      builder: (context) => const SafeArea(
        child: Padding(
          padding: EdgeInsets.fromLTRB(24, 24, 24, 32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Account creation is not available yet',
                style: TextStyle(
                  color: Colors.white,
                  fontSize: 18,
                  fontWeight: FontWeight.w800,
                ),
              ),
              SizedBox(height: 10),
              Text(
                'For now, sign in with an existing account or use the invitation instructions from your organisation.',
                style: TextStyle(color: BrandPalette.muted, height: 1.45),
              ),
            ],
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(24, 32, 24, 24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const LogoMark(size: 44, borderRadius: 12),
              const Spacer(),
              const Text(
                'Straumvakt',
                style: TextStyle(
                  color: Colors.white,
                  fontSize: 34,
                  fontWeight: FontWeight.w900,
                ),
              ),
              const SizedBox(height: 10),
              const Text(
                'Sign in to use charging access provided by an organisation.',
                style: TextStyle(
                  color: BrandPalette.muted,
                  fontSize: 16,
                  height: 1.45,
                ),
              ),
              const Spacer(),
              SizedBox(
                width: double.infinity,
                child: FilledButton(
                  onPressed: onSignIn,
                  child: const Text('Sign in'),
                ),
              ),
              const SizedBox(height: 10),
              SizedBox(
                width: double.infinity,
                child: OutlinedButton(
                  onPressed: () => _explainRegistration(context),
                  child: const Text('Create account'),
                ),
              ),
              const SizedBox(height: 10),
              const Text(
                'Without an account, no driver, charger or billing data is stored by the app.',
                textAlign: TextAlign.center,
                style: TextStyle(color: BrandPalette.muted, fontSize: 11),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
