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
  const NearbyCard({
    super.key,
    required this.nearby,
    this.othersNearby = const [],
    this.onPickOther,
  });

  final NearbyCharger nearby;

  /// Other chargers also detected in BLE range (sorted strongest-first).
  /// Twin-pole / quad-pole installs commonly produce 2-4 simultaneous
  /// detections at similar RSSI. We surface the strongest as the
  /// primary card; this list drives the "+N more nearby" affordance.
  final List<NearbyCharger> othersNearby;

  /// Tapped when the driver wants to pick a different one of the
  /// nearby chargers (e.g. they're between two on a twin pole).
  final VoidCallback? onPickOther;

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
                    if (othersNearby.isNotEmpty) ...[
                      const SizedBox(height: 4),
                      GestureDetector(
                        onTap: onPickOther,
                        behavior: HitTestBehavior.opaque,
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            const Icon(Icons.layers_rounded,
                                size: 12, color: BrandPalette.cyan),
                            const SizedBox(width: 4),
                            Text(
                              '+${othersNearby.length} more on this pole',
                              style: const TextStyle(
                                color: BrandPalette.cyan,
                                fontSize: 11,
                                fontWeight: FontWeight.w700,
                                decoration: TextDecoration.underline,
                                decorationColor: BrandPalette.cyan,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
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
    // Centimetres for the tap-and-auth feel — drivers expect precise
    // proximity feedback when the phone is on/near the charger, not
    // a vague '0.3 m'. Switches to metres only when out of tap range.
    //
    // RSSI-to-distance reference (log-distance, n=2.5):
    //   ~10 cm ≈ -42 dBm   (phone touching the charger)
    //   ~30 cm ≈ -47 dBm
    //   ~70 cm ≈ -55 dBm   (arm's length)
    //   ~1 m   ≈ -59 dBm
    if (m < 1.0) {
      final cm = (m * 100).round().clamp(1, 99);
      if (cm <= 25) return 'tap · $cm cm';
      return '$cm cm · close';
    }
    if (m < 2.5) return '~${(m * 100).round()} cm';
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
