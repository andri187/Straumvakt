// Driver profile.
//
// Reads /api/driver/me and writes back through PATCH /api/driver/me,
// which accepts displayName and locale ONLY. Email and password are not
// editable through that endpoint, so this screen shows them as facts and
// says where they can be changed rather than offering a field that would
// silently fail.
//
// Rule 6: every value here comes from the API. Nothing is placeheld.

import 'package:flutter/material.dart';

import '../api/auth_storage.dart';
import '../api/client.dart';
import '../api/types.dart';
import '../theme/palette.dart';

class ProfileScreen extends StatefulWidget {
  const ProfileScreen({super.key, required this.driver});

  final DriverProfile driver;

  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  final _api = StraumvaktApi();
  final _storage = AuthStorage();

  late DriverProfile _profile = widget.driver;
  bool _busy = false;

  Future<void> _editName() async {
    final controller = TextEditingController(text: _profile.displayName);
    final entered = await showModalBottomSheet<String>(
      context: context,
      backgroundColor: BrandPalette.surface,
      isScrollControlled: true,
      builder: (ctx) => Padding(
        padding: EdgeInsets.only(
          left: 24,
          right: 24,
          top: 24,
          bottom: 24 + MediaQuery.of(ctx).viewInsets.bottom,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text('Your name',
                style: TextStyle(
                    color: Colors.white,
                    fontSize: 18,
                    fontWeight: FontWeight.w900)),
            const SizedBox(height: 6),
            const Text(
              'Shown to your operator on charge records.',
              style: TextStyle(color: BrandPalette.muted, fontSize: 12),
            ),
            const SizedBox(height: 16),
            TextField(
              controller: controller,
              autofocus: true,
              textCapitalization: TextCapitalization.words,
              style: const TextStyle(color: Colors.white, fontSize: 16),
            ),
            const SizedBox(height: 12),
            FilledButton(
              onPressed: () => Navigator.of(ctx).pop(controller.text.trim()),
              child: const Text('Save'),
            ),
          ],
        ),
      ),
    );

    if (entered == null || entered.isEmpty || entered == _profile.displayName) {
      return;
    }
    if (!mounted) return;

    setState(() => _busy = true);
    try {
      final token = await _storage.readAccessToken();
      if (token == null) throw ApiException(401, 'Signed out.');
      final updated =
          await _api.updateDisplayName(accessToken: token, displayName: entered);
      if (!mounted) return;
      setState(() => _profile = updated);
    } on ApiException catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(e.message)));
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Could not save. Check your connection.')),
      );
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: BrandPalette.midnight,
      appBar: AppBar(
        backgroundColor: BrandPalette.midnight,
        foregroundColor: Colors.white,
        title: const Text('Profile',
            style: TextStyle(fontWeight: FontWeight.w900)),
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(20, 12, 20, 28),
        children: [
          _Card(children: [
            _Row(
              label: 'Name',
              value: _profile.displayName,
              onTap: _busy ? null : _editName,
            ),
            // Read-only, and the row says why rather than looking broken.
            // Changing an email needs re-verification, which is a flow
            // that exists on the API but has no driver-facing route yet.
            const _Divider(),
            _Row(
              label: 'Email',
              value: _profile.email,
              note: 'Contact your operator to change this',
            ),
            const _Divider(),
            _Row(
              label: 'Organisation',
              value: _profile.organizationName ?? 'Not assigned',
            ),
          ]),
          const SizedBox(height: 20),
          _Card(children: [
            _Row(label: 'Language', value: _localeLabel(_profile.locale)),
            const _Divider(),
            // The account id is what support will ask for, and what ties
            // this driver to their charge records.
            _Row(label: 'Account', value: _shortId(_profile.id)),
          ]),
          const SizedBox(height: 24),
          const Text(
            'Password changes are handled by your operator.',
            textAlign: TextAlign.center,
            style: TextStyle(color: BrandPalette.muted, fontSize: 12),
          ),
        ],
      ),
    );
  }

  static String _localeLabel(String code) => switch (code) {
        'is' => 'Íslenska',
        'en' => 'English',
        _ => code,
      };

  /// First segment of the uuid — enough for support to find the account,
  /// short enough to read aloud.
  static String _shortId(String id) =>
      id.contains('-') ? id.split('-').first.toUpperCase() : id;
}

class _Card extends StatelessWidget {
  const _Card({required this.children});
  final List<Widget> children;

  @override
  Widget build(BuildContext context) => Container(
        decoration: BoxDecoration(
          color: BrandPalette.surface,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: BrandPalette.border),
        ),
        child: Column(children: children),
      );
}

class _Divider extends StatelessWidget {
  const _Divider();
  @override
  Widget build(BuildContext context) =>
      const Divider(height: 1, color: BrandPalette.border);
}

class _Row extends StatelessWidget {
  const _Row({
    required this.label,
    required this.value,
    this.note,
    this.onTap,
  });

  final String label;
  final String value;
  final String? note;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(label,
                      style: const TextStyle(
                          color: BrandPalette.muted, fontSize: 12)),
                  const SizedBox(height: 2),
                  Text(value,
                      style: const TextStyle(
                          color: Colors.white,
                          fontSize: 15,
                          fontWeight: FontWeight.w700)),
                  if (note != null)
                    Padding(
                      padding: const EdgeInsets.only(top: 3),
                      child: Text(note!,
                          style: const TextStyle(
                              color: BrandPalette.muted, fontSize: 11)),
                    ),
                ],
              ),
            ),
            if (onTap != null)
              const Icon(Icons.chevron_right_rounded,
                  color: BrandPalette.muted),
          ],
        ),
      ),
    );
  }
}
