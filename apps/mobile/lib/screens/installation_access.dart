import 'package:flutter/material.dart';

import '../theme/palette.dart';

enum InstallationAccessResult { granted, pending, rejected }

typedef InstallationAccessSubmit =
    Future<InstallationAccessResult> Function(String code, String passphrase);

class InstallationAccessScreen extends StatefulWidget {
  const InstallationAccessScreen({
    super.key,
    required this.onSubmit,
    this.onScan,
    this.enabled = true,
  });

  final InstallationAccessSubmit onSubmit;
  final Future<String?> Function()? onScan;
  final bool enabled;

  @override
  State<InstallationAccessScreen> createState() =>
      _InstallationAccessScreenState();
}

class _InstallationAccessScreenState extends State<InstallationAccessScreen> {
  final _formKey = GlobalKey<FormState>();
  final _code = TextEditingController();
  final _passphrase = TextEditingController();
  bool _busy = false;
  InstallationAccessResult? _result;
  String? _error;

  @override
  void dispose() {
    _code.dispose();
    _passphrase.dispose();
    super.dispose();
  }

  Future<void> _scan() async {
    final value = await widget.onScan?.call();
    if (value != null && mounted) {
      _code.text = value;
    }
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() {
      _busy = true;
      _error = null;
      _result = null;
    });
    try {
      final result = await widget.onSubmit(_code.text.trim(), _passphrase.text);
      if (mounted) {
        setState(() => _result = result);
      }
    } catch (_) {
      if (mounted) {
        setState(() => _error = 'Access could not be checked. Try again.');
      }
    } finally {
      if (mounted) {
        setState(() => _busy = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Installation access')),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(20, 18, 20, 28),
          children: [
            Semantics(
              header: true,
              child: const Text(
                'Join an installation',
                style: TextStyle(
                  color: Colors.white,
                  fontSize: 24,
                  fontWeight: FontWeight.w900,
                ),
              ),
            ),
            const SizedBox(height: 8),
            const Text(
              'Enter the code and passphrase supplied by the organisation.',
              style: TextStyle(color: BrandPalette.muted, height: 1.4),
            ),
            if (!widget.enabled) ...[
              const SizedBox(height: 16),
              const _UnavailableNotice(),
            ],
            const SizedBox(height: 24),
            Form(
              key: _formKey,
              child: Column(
                children: [
                  TextFormField(
                    controller: _code,
                    enabled: widget.enabled,
                    textCapitalization: TextCapitalization.characters,
                    decoration: InputDecoration(
                      labelText: 'Installation code',
                      prefixIcon: const Icon(Icons.key_rounded),
                      suffixIcon: widget.onScan == null || !widget.enabled
                          ? null
                          : IconButton(
                              onPressed: _scan,
                              tooltip: 'Scan QR code',
                              icon: const Icon(Icons.qr_code_scanner_rounded),
                            ),
                    ),
                    validator: (value) => (value?.trim().isEmpty ?? true)
                        ? 'Installation code required'
                        : null,
                  ),
                  const SizedBox(height: 14),
                  TextFormField(
                    controller: _passphrase,
                    enabled: widget.enabled,
                    obscureText: true,
                    decoration: const InputDecoration(
                      labelText: 'Passphrase',
                      prefixIcon: Icon(Icons.lock_outline_rounded),
                    ),
                    validator: (value) =>
                        (value?.isEmpty ?? true) ? 'Passphrase required' : null,
                    onFieldSubmitted: (_) => _submit(),
                  ),
                ],
              ),
            ),
            if (_result != null) ...[
              const SizedBox(height: 18),
              _Result(result: _result!),
            ],
            if (_error != null) ...[
              const SizedBox(height: 18),
              Semantics(
                liveRegion: true,
                container: true,
                label: 'Error: $_error',
                child: ExcludeSemantics(
                  child: Text(
                    _error!,
                    style: const TextStyle(color: BrandPalette.danger),
                  ),
                ),
              ),
            ],
            const SizedBox(height: 24),
            FilledButton.icon(
              onPressed: _busy || !widget.enabled ? null : _submit,
              icon: _busy
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.arrow_forward_rounded),
              label: Text(_busy ? 'Checking' : 'Continue'),
            ),
          ],
        ),
      ),
    );
  }
}

class _UnavailableNotice extends StatelessWidget {
  const _UnavailableNotice();

  @override
  Widget build(BuildContext context) {
    return Semantics(
      container: true,
      label:
          'Installation access codes are unavailable. You can still use an invitation.',
      child: ExcludeSemantics(
        child: Container(
          width: double.infinity,
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: BrandPalette.amber.withValues(alpha: 0.10),
            border: Border.all(
              color: BrandPalette.amber.withValues(alpha: 0.35),
            ),
            borderRadius: BorderRadius.circular(8),
          ),
          child: const Text(
            'Installation access codes are not connected in this build. You can still use an invitation.',
            style: TextStyle(color: BrandPalette.muted, height: 1.4),
          ),
        ),
      ),
    );
  }
}

class _Result extends StatelessWidget {
  const _Result({required this.result});
  final InstallationAccessResult result;

  @override
  Widget build(BuildContext context) {
    final (icon, color, title, body) = switch (result) {
      InstallationAccessResult.granted => (
        Icons.check_circle_outline_rounded,
        BrandPalette.mint,
        'Access granted',
        'The installation can now appear in your app.',
      ),
      InstallationAccessResult.pending => (
        Icons.schedule_rounded,
        BrandPalette.amber,
        'Waiting for approval',
        'The organisation will review your request.',
      ),
      InstallationAccessResult.rejected => (
        Icons.block_rounded,
        BrandPalette.danger,
        'Access not granted',
        'Check the details or contact the organisation.',
      ),
    };
    return Semantics(
      container: true,
      liveRegion: true,
      label: '$title. $body',
      child: ExcludeSemantics(
        child: Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: color.withValues(alpha: 0.10),
            border: Border.all(color: color.withValues(alpha: 0.35)),
            borderRadius: BorderRadius.circular(8),
          ),
          child: Row(
            children: [
              Icon(icon, color: color),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: const TextStyle(
                        color: Colors.white,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      body,
                      style: const TextStyle(
                        color: BrandPalette.muted,
                        fontSize: 13,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
