// Invite redemption screen (ADR 0026 §3/§5 — the going-public blocker).
//
// An invited driver lands here from the empty state. They either paste
// an invite code or scan a QR, then capture their kennitala + choose a
// password, and submit to POST /api/public/invites/consume. On success
// the app logs them in (the backend issues a session is NOT part of the
// consume contract, so we follow with a normal login using the resolved
// email + the just-set password) and lands on home.
//
// QR: scanning is handled by mobile_scanner. The scanned payload may be
// a bare code (e.g. "DAL-7Q4K") or a deep link carrying ?code=… — both
// are normalised by [_extractCode].

import 'package:flutter/material.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import '../api/auth_storage.dart';
import '../api/client.dart';
import '../i18n/strings.dart';
import '../theme/logo.dart';
import '../theme/palette.dart';
import 'home.dart';

class RedeemInviteScreen extends StatefulWidget {
  const RedeemInviteScreen({super.key, this.initialCode});

  // Pre-filled when arriving via an email deep link (?code=…). Null for
  // the manual / scan path.
  final String? initialCode;

  @override
  State<RedeemInviteScreen> createState() => _RedeemInviteScreenState();
}

enum _Phase { form, busy, pending }

class _RedeemInviteScreenState extends State<RedeemInviteScreen> {
  final _formKey = GlobalKey<FormState>();
  late final TextEditingController _code =
      TextEditingController(text: widget.initialCode ?? '');
  final _kennitala = TextEditingController();
  final _password = TextEditingController();
  final _confirm = TextEditingController();

  final _api = StraumvaktApi();
  final _storage = AuthStorage();

  _Phase _phase = _Phase.form;
  String? _error;

  @override
  void dispose() {
    _code.dispose();
    _kennitala.dispose();
    _password.dispose();
    _confirm.dispose();
    super.dispose();
  }

  // Normalise a scanned payload: accept a bare code, or pull ?code= out
  // of a deep link / URL.
  String _extractCode(String raw) {
    final trimmed = raw.trim();
    final uri = Uri.tryParse(trimmed);
    if (uri != null && uri.queryParameters['code'] != null) {
      return uri.queryParameters['code']!.trim();
    }
    return trimmed;
  }

  Future<void> _openScanner() async {
    final code = await Navigator.of(context).push<String>(
      MaterialPageRoute(builder: (_) => const _QrScanScreen()),
    );
    if (code == null || !mounted) return;
    setState(() => _code.text = _extractCode(code));
  }

  // Keep digits only; Icelandic kennitala is 10 digits (DDMMYY-NNNN).
  String _digits(String s) => s.replaceAll(RegExp(r'\D'), '');

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() {
      _phase = _Phase.busy;
      _error = null;
    });
    final kennitala = _digits(_kennitala.text);
    final password = _password.text;
    try {
      final result = await _api.consumeInvite(
        token: _code.text.trim(),
        kennitala: kennitala,
        password: password,
      );

      // Host-admin allow-term path — membership not active yet. Park on
      // the pending screen rather than attempting a login that would
      // surface an empty charger list.
      if (result.pendingApproval) {
        if (!mounted) return;
        setState(() => _phase = _Phase.pending);
        return;
      }

      // Active immediately — log in with the resolved email + the
      // password we just set, then land on home.
      final session = await _api.login(
        email: result.email,
        password: password,
      );
      await _storage.save(
        accessToken: session.accessToken,
        refreshToken: session.refreshToken,
        email: session.driver.email,
      );
      await _storage.saveLocale(session.driver.locale);
      localeNotifier.value = AppLocale.fromCode(session.driver.locale);
      if (!mounted) return;
      Navigator.of(context).pushAndRemoveUntil(
        MaterialPageRoute(builder: (_) => HomeScreen(driver: session.driver)),
        (_) => false,
      );
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _phase = _Phase.form;
        _error = e.message;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _phase = _Phase.form;
        _error = tr('common.networkError');
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        backgroundColor: BrandPalette.midnight,
        foregroundColor: Colors.white,
        elevation: 0,
        title: Text(tr('redeem.title')),
      ),
      body: SafeArea(
        child: _phase == _Phase.pending
            ? _PendingApproval(onDone: () => Navigator.of(context).maybePop())
            : _buildForm(context),
      ),
    );
  }

  Widget _buildForm(BuildContext context) {
    final busy = _phase == _Phase.busy;
    return SingleChildScrollView(
      physics: const ClampingScrollPhysics(),
      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 460),
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Form(
              key: _formKey,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                mainAxisSize: MainAxisSize.min,
                children: [
                  const SizedBox(height: 8),
                  const Center(child: LogoMark(size: 56, borderRadius: 18)),
                  const SizedBox(height: 20),
                  Text(
                    tr('redeem.title'),
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 24,
                      fontWeight: FontWeight.w900,
                      letterSpacing: -0.4,
                    ),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    tr('redeem.subtitle'),
                    style: const TextStyle(color: BrandPalette.muted),
                  ),
                  const SizedBox(height: 22),

                  // Invite code + scan
                  TextFormField(
                    controller: _code,
                    enabled: !busy,
                    textCapitalization: TextCapitalization.characters,
                    style: const TextStyle(color: Colors.white),
                    decoration: InputDecoration(
                      labelText: tr('redeem.codeLabel'),
                      hintText: tr('redeem.codeHint'),
                      hintStyle: const TextStyle(color: BrandPalette.muted),
                      prefixIcon: const Icon(Icons.confirmation_number_outlined,
                          color: BrandPalette.muted),
                    ),
                    validator: (v) => (v == null || v.trim().isEmpty)
                        ? tr('redeem.codeRequired')
                        : null,
                  ),
                  const SizedBox(height: 10),
                  OutlinedButton.icon(
                    onPressed: busy ? null : _openScanner,
                    style: OutlinedButton.styleFrom(
                      side: const BorderSide(color: BrandPalette.border),
                      padding: const EdgeInsets.symmetric(vertical: 14),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(14),
                      ),
                    ),
                    icon: const Icon(Icons.qr_code_scanner_rounded,
                        color: BrandPalette.cyan),
                    label: Text(
                      tr('redeem.scan'),
                      style: const TextStyle(
                        color: Colors.white,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ),
                  const SizedBox(height: 18),

                  // Kennitala (captured at redemption — ADR 0026 §4)
                  TextFormField(
                    controller: _kennitala,
                    enabled: !busy,
                    keyboardType: TextInputType.number,
                    style: const TextStyle(color: Colors.white),
                    decoration: InputDecoration(
                      labelText: tr('redeem.kennitalaLabel'),
                      hintText: tr('redeem.kennitalaHint'),
                      hintStyle: const TextStyle(color: BrandPalette.muted),
                      prefixIcon: const Icon(Icons.badge_outlined,
                          color: BrandPalette.muted),
                    ),
                    validator: (v) {
                      final d = _digits(v ?? '');
                      if (d.isEmpty) return tr('redeem.kennitalaRequired');
                      if (d.length != 10) return tr('redeem.kennitalaInvalid');
                      return null;
                    },
                  ),
                  const SizedBox(height: 14),

                  // Password + confirm
                  TextFormField(
                    controller: _password,
                    enabled: !busy,
                    obscureText: true,
                    style: const TextStyle(color: Colors.white),
                    decoration: InputDecoration(
                      labelText: tr('redeem.passwordLabel'),
                      prefixIcon: const Icon(Icons.lock_outline,
                          color: BrandPalette.muted),
                    ),
                    validator: (v) => (v ?? '').length < 8
                        ? tr('redeem.passwordTooShort')
                        : null,
                  ),
                  const SizedBox(height: 14),
                  TextFormField(
                    controller: _confirm,
                    enabled: !busy,
                    obscureText: true,
                    style: const TextStyle(color: Colors.white),
                    decoration: InputDecoration(
                      labelText: tr('redeem.passwordConfirmLabel'),
                      prefixIcon: const Icon(Icons.lock_outline,
                          color: BrandPalette.muted),
                    ),
                    validator: (v) =>
                        v != _password.text ? tr('redeem.passwordMismatch') : null,
                    onFieldSubmitted: (_) => busy ? null : _submit(),
                  ),

                  if (_error != null) ...[
                    const SizedBox(height: 16),
                    _ErrorBanner(message: _error!),
                  ],

                  const SizedBox(height: 22),
                  FilledButton.icon(
                    onPressed: busy ? null : _submit,
                    icon: busy
                        ? const SizedBox(
                            width: 16,
                            height: 16,
                            child: CircularProgressIndicator(
                              strokeWidth: 2,
                              valueColor:
                                  AlwaysStoppedAnimation(BrandPalette.midnight),
                            ),
                          )
                        : const Icon(Icons.key_rounded),
                    label: Text(busy ? tr('redeem.submitting') : tr('redeem.submit')),
                  ),
                  const SizedBox(height: 14),
                  Text(
                    tr('redeem.note'),
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                        color: BrandPalette.muted, fontSize: 11),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _PendingApproval extends StatelessWidget {
  const _PendingApproval({required this.onDone});
  final VoidCallback onDone;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(32),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const Icon(Icons.hourglass_top_rounded,
              size: 64, color: BrandPalette.amber),
          const SizedBox(height: 16),
          Text(
            tr('redeem.pendingTitle'),
            textAlign: TextAlign.center,
            style: const TextStyle(
              color: Colors.white,
              fontSize: 20,
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            tr('redeem.pendingBody'),
            textAlign: TextAlign.center,
            style: const TextStyle(color: BrandPalette.muted, fontSize: 13),
          ),
          const SizedBox(height: 24),
          FilledButton(
            onPressed: onDone,
            child: Text(tr('session.done')),
          ),
        ],
      ),
    );
  }
}

class _ErrorBanner extends StatelessWidget {
  const _ErrorBanner({required this.message});
  final String message;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: BrandPalette.danger.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: BrandPalette.danger.withValues(alpha: 0.3)),
      ),
      child: Row(
        children: [
          const Icon(Icons.error_outline, color: BrandPalette.danger, size: 18),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              message,
              style: const TextStyle(color: BrandPalette.danger, fontSize: 13),
            ),
          ),
        ],
      ),
    );
  }
}

// Full-screen QR scanner. Pops with the first decoded payload string.
class _QrScanScreen extends StatefulWidget {
  const _QrScanScreen();

  @override
  State<_QrScanScreen> createState() => _QrScanScreenState();
}

class _QrScanScreenState extends State<_QrScanScreen> {
  final MobileScannerController _controller = MobileScannerController();
  bool _handled = false;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _onDetect(BarcodeCapture capture) {
    if (_handled) return;
    final raw = capture.barcodes
        .map((b) => b.rawValue)
        .firstWhere((v) => v != null && v.isNotEmpty, orElse: () => null);
    if (raw == null) return;
    _handled = true;
    Navigator.of(context).pop(raw);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        backgroundColor: Colors.black,
        foregroundColor: Colors.white,
        title: Text(tr('redeem.scan')),
        leading: IconButton(
          icon: const Icon(Icons.close_rounded),
          tooltip: tr('redeem.scanCancel'),
          onPressed: () => Navigator.of(context).pop(),
        ),
      ),
      body: Stack(
        fit: StackFit.expand,
        children: [
          MobileScanner(controller: _controller, onDetect: _onDetect),
          // Simple reticle overlay.
          Center(
            child: Container(
              width: 240,
              height: 240,
              decoration: BoxDecoration(
                border: Border.all(color: BrandPalette.mint, width: 3),
                borderRadius: BorderRadius.circular(20),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
