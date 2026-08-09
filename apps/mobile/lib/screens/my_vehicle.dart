import 'package:flutter/material.dart';

import '../theme/palette.dart';

class MyVehicleScreen extends StatelessWidget {
  const MyVehicleScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('My vehicle')),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(24, 36, 24, 32),
          children: [
            Center(
              child: Container(
                width: 180,
                height: 112,
                decoration: BoxDecoration(
                  color: BrandPalette.surface,
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: BrandPalette.border),
                ),
                child: const Icon(
                  Icons.directions_car_filled_rounded,
                  color: Colors.white,
                  size: 78,
                ),
              ),
            ),
            const SizedBox(height: 28),
            const Text(
              'No vehicle connected',
              textAlign: TextAlign.center,
              style: TextStyle(
                color: Colors.white,
                fontSize: 22,
                fontWeight: FontWeight.w900,
              ),
            ),
            const SizedBox(height: 10),
            const Text(
              'A vehicle profile will appear here when one is connected '
              'to your driver account.',
              textAlign: TextAlign.center,
              style: TextStyle(
                color: BrandPalette.muted,
                fontSize: 14,
                height: 1.45,
              ),
            ),
            const SizedBox(height: 32),
            Container(
              decoration: BoxDecoration(
                border: Border.all(color: BrandPalette.border),
                borderRadius: BorderRadius.circular(8),
              ),
              child: const Column(
                children: [
                  _AvailabilityRow(
                    icon: Icons.pin_outlined,
                    label: 'Registration',
                    value: 'Not available',
                  ),
                  _AvailabilityRow(
                    icon: Icons.contactless_outlined,
                    label: 'Autocharge',
                    value: 'Not connected',
                    last: true,
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _AvailabilityRow extends StatelessWidget {
  const _AvailabilityRow({
    required this.icon,
    required this.label,
    required this.value,
    this.last = false,
  });

  final IconData icon;
  final String label;
  final String value;
  final bool last;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: BrandPalette.surface,
        border: last
            ? null
            : const Border(bottom: BorderSide(color: BrandPalette.border)),
      ),
      child: Row(
        children: [
          Icon(icon, color: BrandPalette.cyan, size: 22),
          const SizedBox(width: 12),
          Expanded(
            child: Text(
              label,
              style: const TextStyle(
                color: Colors.white,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
          Text(
            value,
            style: const TextStyle(color: BrandPalette.muted, fontSize: 12),
          ),
        ],
      ),
    );
  }
}
