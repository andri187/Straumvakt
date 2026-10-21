import 'package:flutter/material.dart';

import '../api/auth_storage.dart';
import '../api/client.dart';
import '../api/types.dart';
import '../theme/palette.dart';

class RedeemDriverInviteScreen extends StatefulWidget {
  const RedeemDriverInviteScreen({
    super.key,
    this.api,
    this.storage,
    this.initialCode,
  });

  final StraumvaktApi? api;
  final SessionStorage? storage;
  final String? initialCode;

  @override
  State<RedeemDriverInviteScreen> createState() =>
      _RedeemDriverInviteScreenState();
}

class _RedeemDriverInviteScreenState extends State<RedeemDriverInviteScreen> {
  late final StraumvaktApi _api = widget.api ?? StraumvaktApi();
  late final SessionStorage _storage = widget.storage ?? AuthStorage();
  late final bool _ownsApi = widget.api == null;
  late final TextEditingController _code = TextEditingController(
    text: widget.initialCode ?? '',
  );
  final _formKey = GlobalKey<FormState>();
  bool _busy = false;
  String? _error;
  DriverInviteRedemption? _result;

  @override
  void dispose() {
    _code.dispose();
    if (_ownsApi) _api.close();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate() || _busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final accessToken = await _storage.readAccessToken();
      if (accessToken == null) {
        throw ApiException(401, 'Please sign in again.');
      }
      final result = await _api.redeemDriverInvite(
        accessToken: accessToken,
        token: _code.text.trim(),
      );
      if (mounted) setState(() => _result = result);
    } on ApiException catch (error) {
      if (mounted) setState(() => _error = error.message);
    } catch (_) {
      if (mounted) {
        setState(() => _error = 'The invitation could not be checked.');
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final result = _result;
    return Scaffold(
      appBar: AppBar(title: const Text('Use invitation')),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(20, 18, 20, 28),
          children: [
            Text(
              result == null ? 'Join your organisation' : 'Access granted',
              style: const TextStyle(
                color: Colors.white,
                fontSize: 24,
                fontWeight: FontWeight.w900,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              result == null
                  ? 'This invitation must be addressed to the account you are signed in with.'
                  : result.installationDisplayName ??
                        result.driverGroupDisplayName,
              style: const TextStyle(color: BrandPalette.muted, height: 1.4),
            ),
            const SizedBox(height: 24),
            if (result == null) ...[
              Form(
                key: _formKey,
                child: TextFormField(
                  controller: _code,
                  textCapitalization: TextCapitalization.characters,
                  autocorrect: false,
                  decoration: const InputDecoration(
                    labelText: 'Invitation code',
                    prefixIcon: Icon(Icons.key_rounded),
                  ),
                  validator: (value) => (value?.trim().length ?? 0) < 8
                      ? 'Enter the complete invitation code'
                      : null,
                  onFieldSubmitted: (_) => _submit(),
                ),
              ),
              if (_error != null) ...[
                const SizedBox(height: 14),
                Text(
                  _error!,
                  style: const TextStyle(color: BrandPalette.danger),
                ),
              ],
              const SizedBox(height: 22),
              FilledButton.icon(
                onPressed: _busy ? null : _submit,
                icon: _busy
                    ? const SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.arrow_forward_rounded),
                label: Text(_busy ? 'Checking' : 'Redeem invitation'),
              ),
            ] else ...[
              Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: BrandPalette.mint.withValues(alpha: 0.10),
                  border: Border.all(
                    color: BrandPalette.mint.withValues(alpha: 0.35),
                  ),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Row(
                  children: [
                    const Icon(
                      Icons.check_circle_outline_rounded,
                      color: BrandPalette.mint,
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Text(
                        result.driverGroupDisplayName,
                        style: const TextStyle(
                          color: Colors.white,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 22),
              FilledButton(
                onPressed: () => Navigator.of(context).pop(true),
                child: const Text('Done'),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
