// Straumvakt driver app entry point.
// Cold start: read stored token → if present, hit /me → land on home;
// otherwise, show login screen with last-known email pre-filled.

import 'package:flutter/material.dart';
import 'api/auth_storage.dart';
import 'api/client.dart';
import 'screens/home.dart';
import 'screens/login.dart';
import 'theme/logo.dart';
import 'theme/palette.dart';

void main() {
  runApp(const StraumvaktApp());
}

class StraumvaktApp extends StatelessWidget {
  const StraumvaktApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Straumvakt',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.dark(),
      home: const _Bootstrap(),
    );
  }
}

class _Bootstrap extends StatefulWidget {
  const _Bootstrap();

  @override
  State<_Bootstrap> createState() => _BootstrapState();
}

class _BootstrapState extends State<_Bootstrap> {
  final _storage = AuthStorage();
  final _api = StraumvaktApi();

  @override
  void initState() {
    super.initState();
    _resume();
  }

  Future<void> _resume() async {
    // Token + email both required to silent-resume. If either missing,
    // fall through to login.
    final token = await _storage.readAccessToken();
    final email = await _storage.readEmail();
    if (token == null) {
      _toLogin(email);
      return;
    }

    try {
      final me = await _api.getMe(token);
      if (!mounted) return;
      Navigator.of(context).pushReplacement(
        MaterialPageRoute(builder: (_) => HomeScreen(driver: me)),
      );
    } on ApiException {
      // 401 → token expired or revoked. Wipe and re-auth.
      await _storage.clear();
      _toLogin(email);
    } catch (_) {
      // Network error on cold start — let user retry from login.
      _toLogin(email);
    }
  }

  void _toLogin(String? prefilledEmail) {
    if (!mounted) return;
    Navigator.of(context).pushReplacement(
      MaterialPageRoute(
        builder: (_) => LoginScreen(prefilledEmail: prefilledEmail),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return const Scaffold(
      body: Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            LogoMark(size: 72, borderRadius: 22),
            SizedBox(height: 24),
            CircularProgressIndicator(color: BrandPalette.mint),
          ],
        ),
      ),
    );
  }
}
