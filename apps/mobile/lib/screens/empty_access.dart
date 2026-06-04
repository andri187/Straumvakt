// Empty-access funnel (ADR 0026 §5). Shown to a logged-in driver who
// has zero accessible chargers. Instead of a dead-end "no chargers"
// message, the screen surfaces the single action that gets the driver
// somewhere: redeem an invite (code or QR).
//
// This is the cold-start landing for an invited-but-not-yet-redeemed
// driver, and the steady-state for a driver whose access was revoked.

import 'package:flutter/material.dart';
import '../api/types.dart';
import '../i18n/strings.dart';
import '../theme/logo.dart';
import '../theme/palette.dart';
import 'menu_drawer.dart';
import 'redeem_invite.dart';

class EmptyAccessScreen extends StatelessWidget {
  const EmptyAccessScreen({
    super.key,
    required this.driver,
    this.onRefresh,
  });

  final DriverProfile driver;
  // Re-check access (re-fetch /chargers). Wired by the host so a driver
  // whose host just approved them can pull to refresh into the app.
  final Future<void> Function()? onRefresh;

  Future<void> _toRedeem(BuildContext context) async {
    await Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => const RedeemInviteScreen()),
    );
    // On return, re-check access — the driver may have redeemed an
    // invite that activated immediately (which would have navigated past
    // this screen) or one pending approval (still empty).
    if (onRefresh != null) await onRefresh!();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      drawer: MenuDrawer(driver: driver),
      appBar: AppBar(
        backgroundColor: BrandPalette.midnight,
        elevation: 0,
        title: const LogoMark(size: 32, borderRadius: 10),
      ),
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            physics: const AlwaysScrollableScrollPhysics(),
            child: Padding(
              padding: const EdgeInsets.all(32),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Container(
                    width: 96,
                    height: 96,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: BrandPalette.mint.withValues(alpha: 0.10),
                      border: Border.all(
                        color: BrandPalette.mint.withValues(alpha: 0.35),
                      ),
                    ),
                    child: const Icon(Icons.qr_code_scanner_rounded,
                        size: 44, color: BrandPalette.mint),
                  ),
                  const SizedBox(height: 24),
                  Text(
                    tr('empty.title'),
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 22,
                      fontWeight: FontWeight.w900,
                      letterSpacing: -0.4,
                    ),
                  ),
                  const SizedBox(height: 10),
                  Text(
                    tr('empty.body'),
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                        color: BrandPalette.muted, fontSize: 14, height: 1.5),
                  ),
                  const SizedBox(height: 28),
                  SizedBox(
                    width: double.infinity,
                    child: FilledButton.icon(
                      onPressed: () => _toRedeem(context),
                      icon: const Icon(Icons.add_rounded),
                      label: Text(tr('empty.cta')),
                    ),
                  ),
                  if (onRefresh != null) ...[
                    const SizedBox(height: 12),
                    TextButton.icon(
                      onPressed: onRefresh,
                      icon: const Icon(Icons.refresh_rounded,
                          color: BrandPalette.muted, size: 18),
                      label: Text(
                        tr('empty.refresh'),
                        style: const TextStyle(color: BrandPalette.muted),
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
