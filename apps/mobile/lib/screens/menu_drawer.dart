// Driver-app side drawer. Opens via the hamburger button on the home
// screen header. Sections grouped by what a driver actually cares
// about: who am I, what charges, where, history, settings, help.
//
// Items wired to live data point at /me-derived state. Items pending
// on Phase 2/3 endpoints carry a "Soon" badge but appear in the menu
// so the user sees the planned shape.

import 'package:flutter/material.dart';
import '../api/auth_storage.dart';
import '../api/types.dart';
import '../theme/palette.dart';
import 'login.dart';

class MenuDrawer extends StatelessWidget {
  const MenuDrawer({super.key, required this.driver, this.plate = 'N1 742'});

  final DriverProfile driver;
  final String plate;

  Future<void> _signOut(BuildContext context) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: BrandPalette.surface,
        shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(18),
            side: const BorderSide(color: BrandPalette.border)),
        title: const Text('Sign out?',
            style:
                TextStyle(color: Colors.white, fontWeight: FontWeight.w800)),
        content: const Text(
          'You\'ll need to enter your password again next time.',
          style: TextStyle(color: BrandPalette.muted),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancel',
                style: TextStyle(color: BrandPalette.muted)),
          ),
          FilledButton(
            style: FilledButton.styleFrom(
              backgroundColor: BrandPalette.danger,
              foregroundColor: Colors.white,
            ),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Sign out'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    await AuthStorage().clear();
    if (!context.mounted) return;
    Navigator.of(context).pushAndRemoveUntil(
      MaterialPageRoute(
        builder: (_) => LoginScreen(prefilledEmail: driver.email),
      ),
      (_) => false,
    );
  }

  @override
  Widget build(BuildContext context) {
    return Drawer(
      backgroundColor: BrandPalette.midnight,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.only(
          topRight: Radius.circular(28),
          bottomRight: Radius.circular(28),
        ),
      ),
      child: SafeArea(
        child: Column(
          children: [
            _DriverHeader(driver: driver, plate: plate),
            Expanded(
              child: ListView(
                padding: EdgeInsets.zero,
                children: [
                  const _SectionLabel('Account'),
                  _MenuTile(
                    icon: Icons.person_outline,
                    label: 'Profile',
                    subtitle: 'Name, email, password',
                    onTap: () {
                      Navigator.of(context).pop();
                      _showSnack(context, 'Profile editing — Phase 2');
                    },
                  ),
                  _MenuTile(
                    icon: Icons.directions_car_outlined,
                    label: 'My vehicle',
                    subtitle: '$plate · plate + EV identity',
                    trailing: const _SoonBadge(),
                    onTap: () {
                      Navigator.of(context).pop();
                      _showSnack(context, 'Vehicle details — Phase 2 (Autocharge)');
                    },
                  ),
                  const _SectionLabel('Charging'),
                  _MenuTile(
                    icon: Icons.credit_card_outlined,
                    label: 'RFID & tokens',
                    subtitle: 'Cards, virtual tags, vehicle ID',
                    onTap: () {
                      Navigator.of(context).pop();
                      _showSnack(context, 'Tokens list — Phase 2');
                    },
                  ),
                  _MenuTile(
                    icon: Icons.lock_open_outlined,
                    label: 'Charging access',
                    subtitle: driver.organizationName != null
                        ? 'Via ${driver.organizationName}'
                        : 'Installations you can charge at',
                    onTap: () {
                      Navigator.of(context).pop();
                      _showSnack(context, 'Access view — Phase 2');
                    },
                  ),
                  _MenuTile(
                    icon: Icons.history_rounded,
                    label: 'Charge history',
                    subtitle: 'Past sessions, kWh, cost',
                    trailing: const _SoonBadge(),
                    onTap: () {
                      Navigator.of(context).pop();
                      _showSnack(context, 'Session history — Phase 2');
                    },
                  ),
                  _MenuTile(
                    icon: Icons.receipt_long_outlined,
                    label: 'Receipts & invoices',
                    subtitle: 'Monthly statements',
                    trailing: const _SoonBadge(),
                    onTap: () {
                      Navigator.of(context).pop();
                      _showSnack(context, 'Invoices — Phase 4');
                    },
                  ),
                  const _SectionLabel('Settings'),
                  _MenuTile(
                    icon: Icons.translate_rounded,
                    label: 'Language',
                    subtitle: driver.locale == 'is' ? 'Íslenska' : 'English',
                    onTap: () {
                      Navigator.of(context).pop();
                      _showSnack(context, 'Language toggle — Phase 2');
                    },
                  ),
                  _MenuTile(
                    icon: Icons.notifications_none_rounded,
                    label: 'Notifications',
                    subtitle: 'Session start, finish, faults',
                    trailing: const _SoonBadge(),
                    onTap: () {
                      Navigator.of(context).pop();
                      _showSnack(context, 'Push notifications — Phase 4');
                    },
                  ),
                  const _SectionLabel('Help'),
                  _MenuTile(
                    icon: Icons.help_outline_rounded,
                    label: 'Help & support',
                    subtitle: 'Contact your operator',
                    onTap: () {
                      Navigator.of(context).pop();
                      _showSnack(context, 'Support contact — Phase 2');
                    },
                  ),
                  _MenuTile(
                    icon: Icons.info_outline_rounded,
                    label: 'About Straumvakt',
                    subtitle: 'Version, privacy, terms',
                    onTap: () {
                      Navigator.of(context).pop();
                      _showSnack(context, 'About / version — Phase 2');
                    },
                  ),
                ],
              ),
            ),
            const Divider(color: BrandPalette.border, height: 1),
            ListTile(
              leading: const Icon(Icons.logout_rounded,
                  color: BrandPalette.danger),
              title: const Text(
                'Sign out',
                style: TextStyle(
                  color: BrandPalette.danger,
                  fontWeight: FontWeight.w700,
                ),
              ),
              onTap: () => _signOut(context),
            ),
            const SizedBox(height: 8),
          ],
        ),
      ),
    );
  }

  void _showSnack(BuildContext context, String msg) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(msg, style: const TextStyle(color: Colors.white)),
        backgroundColor: BrandPalette.surface,
        behavior: SnackBarBehavior.floating,
        margin: const EdgeInsets.all(16),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(12),
          side: const BorderSide(color: BrandPalette.border),
        ),
      ),
    );
  }
}

class _DriverHeader extends StatelessWidget {
  const _DriverHeader({required this.driver, required this.plate});

  final DriverProfile driver;
  final String plate;

  @override
  Widget build(BuildContext context) {
    final initials = _initials(driver.displayName);
    return Container(
      padding: const EdgeInsets.fromLTRB(20, 18, 20, 22),
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0xFF10323B), Color(0xFF071927)],
        ),
        border: Border(bottom: BorderSide(color: BrandPalette.border)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 48,
                height: 48,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  gradient: const LinearGradient(
                    colors: [BrandPalette.mint, BrandPalette.cyan],
                  ),
                  border: Border.all(
                    color: Colors.white.withValues(alpha: 0.18),
                    width: 1.4,
                  ),
                ),
                alignment: Alignment.center,
                child: Text(
                  initials,
                  style: const TextStyle(
                    color: BrandPalette.midnight,
                    fontSize: 18,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      driver.displayName,
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 16,
                        fontWeight: FontWeight.w800,
                        letterSpacing: -0.2,
                      ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    const SizedBox(height: 2),
                    Text(
                      driver.email,
                      style: const TextStyle(
                          color: BrandPalette.muted, fontSize: 12),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                ),
              ),
            ],
          ),
          if (driver.organizationName != null) ...[
            const SizedBox(height: 14),
            Row(
              children: [
                const Icon(Icons.business_rounded,
                    size: 14, color: BrandPalette.muted),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(
                    driver.organizationName!,
                    style: const TextStyle(
                        color: BrandPalette.muted, fontSize: 12),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }

  String _initials(String name) {
    final parts = name.trim().split(RegExp(r'\s+'));
    if (parts.isEmpty || parts.first.isEmpty) return '?';
    if (parts.length == 1) return parts.first[0].toUpperCase();
    return (parts.first[0] + parts.last[0]).toUpperCase();
  }
}

class _SectionLabel extends StatelessWidget {
  const _SectionLabel(this.text);
  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 18, 20, 6),
      child: Text(
        text.toUpperCase(),
        style: const TextStyle(
          color: BrandPalette.muted,
          fontSize: 10,
          fontWeight: FontWeight.w800,
          letterSpacing: 1.4,
        ),
      ),
    );
  }
}

class _MenuTile extends StatelessWidget {
  const _MenuTile({
    required this.icon,
    required this.label,
    required this.subtitle,
    required this.onTap,
    this.trailing,
  });

  final IconData icon;
  final String label;
  final String subtitle;
  final Widget? trailing;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
        child: Row(
          children: [
            Container(
              width: 36,
              height: 36,
              margin: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
              decoration: BoxDecoration(
                color: BrandPalette.surface,
                borderRadius: BorderRadius.circular(10),
                border: Border.all(color: BrandPalette.border),
              ),
              child: Icon(icon, color: BrandPalette.muted, size: 18),
            ),
            Expanded(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 6),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      label,
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 14,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      subtitle,
                      style: const TextStyle(
                        color: BrandPalette.muted,
                        fontSize: 11,
                      ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                ),
              ),
            ),
            if (trailing != null) ...[
              const SizedBox(width: 4),
              trailing!,
              const SizedBox(width: 8),
            ] else ...[
              const Icon(Icons.chevron_right_rounded,
                  color: BrandPalette.muted, size: 20),
              const SizedBox(width: 8),
            ],
          ],
        ),
      ),
    );
  }
}

class _SoonBadge extends StatelessWidget {
  const _SoonBadge();

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: BrandPalette.amber.withValues(alpha: 0.14),
        borderRadius: BorderRadius.circular(6),
      ),
      child: const Text(
        'Soon',
        style: TextStyle(
          color: BrandPalette.amber,
          fontSize: 10,
          fontWeight: FontWeight.w800,
          letterSpacing: 0.4,
        ),
      ),
    );
  }
}
