import 'package:flutter/foundation.dart' show kDebugMode;
import 'package:flutter/material.dart';
import '../api/client.dart';
import '../api/auth_storage.dart';
import '../api/types.dart';
import '../i18n/strings.dart';
import '../theme/logo.dart';
import '../theme/palette.dart';
import 'empty_access.dart';
import 'home.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key, this.prefilledEmail});

  final String? prefilledEmail;

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

// Pilot dev shortcut — default credentials in debug builds so the
// emulator round-trips without fighting Android autofill. Stripped
// from any release build via the kDebugMode gate.
const _devDefaultEmail = 'n1@n1.is';
const _devDefaultPassword = '12345678';

class _LoginScreenState extends State<LoginScreen> {
  final _formKey = GlobalKey<FormState>();
  late final TextEditingController _email = TextEditingController(
    text: widget.prefilledEmail ?? (kDebugMode ? _devDefaultEmail : ''),
  );
  late final TextEditingController _password = TextEditingController(
    text: kDebugMode ? _devDefaultPassword : '',
  );
  final _api = StraumvaktApi();
  final _storage = AuthStorage();
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final session = await _api.login(
        email: _email.text.trim(),
        password: _password.text,
      );
      await _storage.save(
        accessToken: session.accessToken,
        refreshToken: session.refreshToken,
        email: session.driver.email,
      );
      // Adopt the driver's server-side locale.
      await _storage.saveLocale(session.driver.locale);
      localeNotifier.value = AppLocale.fromCode(session.driver.locale);

      // Branch on access: zero chargers → invite-redeem funnel
      // (ADR 0026 §5), otherwise the regular home shell.
      List<DriverCharger> chargers = const [];
      try {
        chargers = await _api.getChargers(session.accessToken);
      } catch (_) {
        // Fall through to home; its own error handling takes over.
      }
      if (!mounted) return;
      if (chargers.isEmpty) {
        Navigator.of(context).pushReplacement(
          MaterialPageRoute(
            builder: (_) => EmptyAccessScreen(driver: session.driver),
          ),
        );
      } else {
        Navigator.of(context).pushReplacement(
          MaterialPageRoute(builder: (_) => HomeScreen(driver: session.driver)),
        );
      }
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } catch (e) {
      setState(() => _error = 'Network error — try again.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      // Default true, but make it explicit — Scaffold needs to shrink
      // the body when the soft keyboard appears so the inner scroll
      // view can scroll the form into view.
      resizeToAvoidBottomInset: true,
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            // ClampingScrollPhysics avoids the iOS-style bounce on a
            // mostly-static form so the screen doesn't jitter when the
            // keyboard opens.
            physics: const ClampingScrollPhysics(),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Form(
                  key: _formKey,
                  child: Column(
                    // mainAxisSize.min lets the column size to its
                    // content so the SingleChildScrollView can scroll
                    // cleanly when the keyboard squeezes the viewport.
                    mainAxisSize: MainAxisSize.min,
                    children: [
                    const SizedBox(height: 24),
                    const LogoWordmark(height: 56),
                    const SizedBox(height: 32),
                    const Text(
                      'Driver sign-in',
                      style: TextStyle(
                        color: Colors.white,
                        fontSize: 28,
                        fontWeight: FontWeight.w900,
                        letterSpacing: -0.5,
                      ),
                    ),
                    const SizedBox(height: 8),
                    const Text(
                      'Sign in with the credentials your operator gave you.',
                      style: TextStyle(color: BrandPalette.muted),
                      textAlign: TextAlign.center,
                    ),
                    const SizedBox(height: 28),
                    TextFormField(
                      controller: _email,
                      keyboardType: TextInputType.emailAddress,
                      autofillHints: const [AutofillHints.email],
                      style: const TextStyle(color: Colors.white),
                      decoration: const InputDecoration(
                        labelText: 'Email',
                        prefixIcon: Icon(Icons.alternate_email_rounded,
                            color: BrandPalette.muted),
                      ),
                      validator: (v) {
                        final s = v?.trim() ?? '';
                        if (s.isEmpty) return 'Email required';
                        if (!s.contains('@')) return 'Enter a valid email';
                        return null;
                      },
                    ),
                    const SizedBox(height: 14),
                    TextFormField(
                      controller: _password,
                      obscureText: true,
                      autofillHints: const [AutofillHints.password],
                      style: const TextStyle(color: Colors.white),
                      decoration: const InputDecoration(
                        labelText: 'Password',
                        prefixIcon: Icon(Icons.lock_outline,
                            color: BrandPalette.muted),
                      ),
                      validator: (v) =>
                          (v ?? '').isEmpty ? 'Password required' : null,
                      onFieldSubmitted: (_) => _submit(),
                    ),
                    if (_error != null) ...[
                      const SizedBox(height: 14),
                      Container(
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: BrandPalette.danger.withValues(alpha: 0.12),
                          borderRadius: BorderRadius.circular(10),
                          border: Border.all(
                            color: BrandPalette.danger.withValues(alpha: 0.3),
                          ),
                        ),
                        child: Row(
                          children: [
                            const Icon(Icons.error_outline,
                                color: BrandPalette.danger, size: 18),
                            const SizedBox(width: 8),
                            Expanded(
                              child: Text(
                                _error!,
                                style: const TextStyle(
                                  color: BrandPalette.danger,
                                  fontSize: 13,
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                    const SizedBox(height: 22),
                    SizedBox(
                      width: double.infinity,
                      child: FilledButton.icon(
                        onPressed: _busy ? null : _submit,
                        icon: _busy
                            ? const SizedBox(
                                width: 16,
                                height: 16,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2,
                                  valueColor: AlwaysStoppedAnimation(
                                      BrandPalette.midnight),
                                ),
                              )
                            : const Icon(Icons.bolt_rounded),
                        label: Text(_busy ? 'Signing in…' : 'Sign in'),
                      ),
                    ),
                    const SizedBox(height: 18),
                    const Text(
                      'No self-signup yet — your operator creates your account.',
                      style: TextStyle(
                        color: BrandPalette.muted,
                        fontSize: 11,
                      ),
                      textAlign: TextAlign.center,
                    ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
