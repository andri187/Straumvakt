// Straumvakt driver app entry point.
// Cold start: read stored token → if present, hit /me → fetch chargers →
//   - has chargers   → home
//   - zero chargers  → empty-access / invite-redeem funnel (ADR 0026 §5)
// otherwise, show login screen with last-known email pre-filled.

import 'package:flutter/material.dart';
import 'api/auth_storage.dart';
import 'api/client.dart';
import 'api/types.dart';
import 'i18n/strings.dart';
import 'screens/empty_access.dart';
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
    // Rebuild the whole app when the in-app language toggle flips, so
    // every screen re-renders against the new locale.
    return ValueListenableBuilder<AppLocale>(
      valueListenable: localeNotifier,
      builder: (context, locale, child) {
        return MaterialApp(
          title: 'Straumvakt',
          debugShowCheckedModeBanner: false,
          theme: AppTheme.dark(),
          home: const _Bootstrap(),
        );
      },
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
    // Apply the stored locale before anything renders so the funnel /
    // login show in the driver's chosen language immediately.
    final storedLocale = await _storage.readLocale();
    if (storedLocale != null) {
      localeNotifier.value = AppLocale.fromCode(storedLocale);
    }

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
      // Keep the in-app locale in sync with the server-side preference.
      if (me.locale.isNotEmpty) {
        localeNotifier.value = AppLocale.fromCode(me.locale);
        await _storage.saveLocale(me.locale);
      }

      // Branch on access: a logged-in driver with zero chargers sees the
      // invite-redeem funnel, not a dead-end "no chargers" list.
      List<DriverCharger> chargers = const [];
      try {
        chargers = await _api.getChargers(token);
      } catch (_) {
        // Treat a charger-fetch failure as "go to home and let its own
        // error/retry handling take over" rather than blocking boot.
        _toHome(me);
        return;
      }
      if (!mounted) return;
      if (chargers.isEmpty) {
        _toEmptyAccess(me);
      } else {
        _toHome(me);
      }
    } on ApiException {
      // 401 → token expired or revoked. Wipe and re-auth.
      await _storage.clear();
      _toLogin(email);
    } catch (_) {
      // Network error on cold start — let user retry from login.
      _toLogin(email);
    }
  }

  void _toHome(DriverProfile me) {
    if (!mounted) return;
    Navigator.of(context).pushReplacement(
      MaterialPageRoute(builder: (_) => HomeScreen(driver: me)),
    );
  }

  void _toEmptyAccess(DriverProfile me) {
    if (!mounted) return;
    Navigator.of(context).pushReplacement(
      MaterialPageRoute(
        builder: (_) => EmptyAccessScreen(
          driver: me,
          onRefresh: () => _recheckAccess(me),
        ),
      ),
    );
  }

  // Re-fetch access from the empty-access screen; promote to home once
  // the host has granted access (e.g. after a pending-approval invite).
  Future<void> _recheckAccess(DriverProfile me) async {
    final token = await _storage.readAccessToken();
    if (token == null) return;
    try {
      final chargers = await _api.getChargers(token);
      if (!mounted || chargers.isEmpty) return;
      _toHome(me);
    } catch (_) {
      // Stay on the empty-access screen on failure.
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
