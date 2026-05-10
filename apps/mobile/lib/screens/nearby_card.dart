// Nearby-charger callout — surfaces above the chargers list when the
// BLE scanner detects a known charger nearby. Tap → opens the same
// ChargerDetailSheet, which is the existing start-session flow.
//
// Visually distinct from the regular list rows: gradient background,
// pulsing icon, distance label. The "you're here" affordance from EV
// charging apps that have BLE / location-based discovery.

import 'package:flutter/material.dart';
import '../ble/scanner.dart';
import '../theme/palette.dart';
import 'charger_detail_sheet.dart';

class NearbyCard extends StatelessWidget {
  const NearbyCard({super.key, required this.nearby});

  final NearbyCharger nearby;

  @override
  Widget build(BuildContext context) {
    final c = nearby.charger;
    final distance = _distanceLabel(nearby.approxMetres);
    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: GestureDetector(
        onTap: () => ChargerDetailSheet.show(context, c),
        child: Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
              colors: [
                BrandPalette.cyan.withValues(alpha: 0.18),
                BrandPalette.mint.withValues(alpha: 0.06),
              ],
            ),
            borderRadius: BorderRadius.circular(18),
            border: Border.all(color: BrandPalette.cyan.withValues(alpha: 0.45)),
            boxShadow: [
              BoxShadow(
                color: BrandPalette.cyan.withValues(alpha: 0.18),
                blurRadius: 20,
                offset: const Offset(0, 6),
              ),
            ],
          ),
          child: Row(
            children: [
              _PulsingDot(),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        const Icon(Icons.bluetooth_rounded,
                            size: 12, color: BrandPalette.cyan),
                        const SizedBox(width: 4),
                        Text(
                          'NEARBY · $distance',
                          style: const TextStyle(
                            color: BrandPalette.cyan,
                            fontSize: 10,
                            fontWeight: FontWeight.w900,
                            letterSpacing: 1.2,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 4),
                    Text(
                      c.displayName,
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 17,
                        fontWeight: FontWeight.w900,
                        letterSpacing: -0.2,
                      ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    const SizedBox(height: 2),
                    Text(
                      c.maxPowerKw > 0
                          ? '${c.status.label} · ${c.maxPowerKw.toStringAsFixed(1)} kW'
                          : c.status.label,
                      style: const TextStyle(
                        color: BrandPalette.muted,
                        fontSize: 12,
                      ),
                    ),
                  ],
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(
                    horizontal: 12, vertical: 8),
                decoration: BoxDecoration(
                  color: BrandPalette.mint,
                  borderRadius: BorderRadius.circular(10),
                ),
                child: const Row(
                  children: [
                    Icon(Icons.bolt_rounded,
                        color: BrandPalette.midnight, size: 14),
                    SizedBox(width: 4),
                    Text(
                      'Start',
                      style: TextStyle(
                        color: BrandPalette.midnight,
                        fontSize: 12,
                        fontWeight: FontWeight.w900,
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

  String _distanceLabel(double m) {
    // Tuned for Zaptec's "tap" UX feel — phone effectively touching
    // the charger. The log-distance model in scanner.dart maps:
    //   ~0.3m  ≈  -47 dBm   (phone in hand on the charger)
    //   ~1.0m  ≈  -59 dBm   (arm's length)
    //   ~2.5m  ≈  -69 dBm   (next station over)
    if (m < 0.3) return 'tap range';
    if (m < 1.0) return 'right here';
    if (m < 2.5) return 'within reach';
    return '~${m.round()} m';
  }
}

class _PulsingDot extends StatefulWidget {
  @override
  State<_PulsingDot> createState() => _PulsingDotState();
}

class _PulsingDotState extends State<_PulsingDot>
    with SingleTickerProviderStateMixin {
  late final AnimationController _ctrl =
      AnimationController(vsync: this, duration: const Duration(seconds: 2))
        ..repeat();

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 44,
      height: 44,
      child: AnimatedBuilder(
        animation: _ctrl,
        builder: (context, _) {
          final t = _ctrl.value;
          return Stack(
            alignment: Alignment.center,
            children: [
              Container(
                width: 44 * (0.5 + t * 0.5),
                height: 44 * (0.5 + t * 0.5),
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: BrandPalette.cyan.withValues(alpha: 0.4 * (1 - t)),
                ),
              ),
              Container(
                width: 22,
                height: 22,
                decoration: const BoxDecoration(
                  shape: BoxShape.circle,
                  color: BrandPalette.cyan,
                ),
                child: const Icon(
                  Icons.bluetooth_rounded,
                  color: BrandPalette.midnight,
                  size: 14,
                ),
              ),
            ],
          );
        },
      ),
    );
  }
}
