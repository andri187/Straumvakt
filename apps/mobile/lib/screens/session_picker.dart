import 'package:flutter/material.dart';

import '../api/types.dart';
import '../theme/palette.dart';

class SessionPickerScreen extends StatelessWidget {
  const SessionPickerScreen({
    super.key,
    required this.sessions,
    required this.onSelected,
  });

  final List<ActiveSession> sessions;
  final ValueChanged<ActiveSession> onSelected;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Active charges')),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(20, 16, 20, 28),
          children: [
            const Text(
              'Choose a charge',
              style: TextStyle(
                color: Colors.white,
                fontSize: 24,
                fontWeight: FontWeight.w900,
              ),
            ),
            const SizedBox(height: 7),
            const Text(
              'More than one vehicle is charging. Each charge remains separate.',
              style: TextStyle(color: BrandPalette.muted, height: 1.4),
            ),
            const SizedBox(height: 22),
            ...sessions.map(
              (session) => Padding(
                padding: const EdgeInsets.only(bottom: 10),
                child: Material(
                  color: BrandPalette.surface,
                  shape: RoundedRectangleBorder(
                    side: const BorderSide(color: BrandPalette.border),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: ListTile(
                    contentPadding: const EdgeInsets.symmetric(
                      horizontal: 16,
                      vertical: 8,
                    ),
                    title: Text(
                      session.chargerName,
                      style: const TextStyle(
                        color: Colors.white,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    subtitle: Text(
                      _detail(session),
                      style: const TextStyle(color: BrandPalette.muted),
                    ),
                    trailing: const Icon(
                      Icons.chevron_right_rounded,
                      color: BrandPalette.mint,
                    ),
                    onTap: () => onSelected(session),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  String _detail(ActiveSession session) {
    final parts = <String>[session.connectorStatus.label];
    if (session.connectorId case final connector?) {
      parts.add('Connector $connector');
    }
    if (session.energyKwh case final energy?) {
      parts.add('${energy.toStringAsFixed(2)} kWh');
    }
    return parts.join(' | ');
  }
}
