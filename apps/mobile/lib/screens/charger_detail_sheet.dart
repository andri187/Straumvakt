// Charger detail bottom sheet — opens when the driver taps a row in
// the chargers list. Confirms the selection (so taps in scroll lists
// don't accidentally start a session) and surfaces the credential
// being used. Pattern lifted from Tesla / ChargePoint detail sheets.

import 'package:flutter/material.dart';
import '../api/auth_storage.dart';
import '../api/client.dart';
import '../api/types.dart';
import '../theme/palette.dart';
import 'active_session.dart';

class ChargerDetailSheet extends StatefulWidget {
  const ChargerDetailSheet({super.key, required this.charger});

  final DriverCharger charger;

  static Future<void> show(BuildContext context, DriverCharger charger) {
    return showModalBottomSheet(
      context: context,
      backgroundColor: Colors.transparent,
      isScrollControlled: true,
      builder: (_) => ChargerDetailSheet(charger: charger),
    );
  }

  @override
  State<ChargerDetailSheet> createState() => _ChargerDetailSheetState();
}

enum _StartState { idle, busy, started, failed }

class _ChargerDetailSheetState extends State<ChargerDetailSheet> {
  final _api = StraumvaktApi();
  final _storage = AuthStorage();
  _StartState _state = _StartState.idle;
  StartSessionResult? _result;
  String? _errorMsg;

  Future<void> _start() async {
    setState(() {
      _state = _StartState.busy;
      _errorMsg = null;
    });
    try {
      final token = await _storage.readAccessToken();
      if (token == null) throw ApiException(401, 'Session expired.');
      final result = await _api.startSession(
        accessToken: token,
        connectorId: widget.charger.connectorId,
      );
      if (!mounted) return;
      setState(() {
        _state = _StartState.started;
        _result = result;
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _state = _StartState.failed;
        _errorMsg = e.message;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _state = _StartState.failed;
        _errorMsg = 'Network error — try again.';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = widget.charger;
    return Container(
      decoration: const BoxDecoration(
        color: BrandPalette.surface,
        borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
        border: Border(
          top: BorderSide(color: BrandPalette.border),
          left: BorderSide(color: BrandPalette.border),
          right: BorderSide(color: BrandPalette.border),
        ),
      ),
      padding: EdgeInsets.only(
        left: 24,
        right: 24,
        top: 12,
        bottom: 24 + MediaQuery.of(context).viewInsets.bottom,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // Drag handle
          Center(
            child: Container(
              width: 40,
              height: 4,
              margin: const EdgeInsets.only(bottom: 16),
              decoration: BoxDecoration(
                color: BrandPalette.muted.withValues(alpha: 0.4),
                borderRadius: BorderRadius.circular(2),
              ),
            ),
          ),
          Row(
            children: [
              _ChargerBadge(status: c.status),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      c.displayName,
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 20,
                        fontWeight: FontWeight.w900,
                        letterSpacing: -0.4,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      c.locationName,
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
          const SizedBox(height: 18),

          // Stats row
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
            decoration: BoxDecoration(
              color: BrandPalette.deepNavy,
              borderRadius: BorderRadius.circular(14),
              border: Border.all(color: BrandPalette.border),
            ),
            child: Row(
              children: [
                _Stat(
                  label: 'Status',
                  value: c.status.label,
                  color: _statusTint(c.status),
                ),
                _Divider(),
                _Stat(
                  label: 'Power',
                  value: c.maxPowerKw > 0
                      ? '${c.maxPowerKw.toStringAsFixed(1)} kW'
                      : '—',
                ),
                _Divider(),
                _Stat(label: 'Price', value: c.priceLabel ?? '—'),
              ],
            ),
          ),
          const SizedBox(height: 18),

          // Result / error banners
          if (_state == _StartState.started && _result != null) ...[
            Container(
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: BrandPalette.cyan.withValues(alpha: 0.08),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(
                  color: BrandPalette.cyan.withValues(alpha: 0.4),
                ),
              ),
              child: Row(
                children: [
                  const Icon(
                    Icons.check_circle_rounded,
                    color: BrandPalette.cyan,
                    size: 22,
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'Start request sent',
                          style: TextStyle(
                            color: BrandPalette.cyan,
                            fontSize: 14,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          'Plug in within 60s — Straumvakt is using your '
                          '${_result!.tokenKindLabel}.',
                          style: const TextStyle(
                            color: BrandPalette.muted,
                            fontSize: 12,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 14),
          ],
          if (_state == _StartState.failed && _errorMsg != null) ...[
            Container(
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: BrandPalette.danger.withValues(alpha: 0.1),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(
                  color: BrandPalette.danger.withValues(alpha: 0.3),
                ),
              ),
              child: Row(
                children: [
                  const Icon(
                    Icons.error_outline,
                    color: BrandPalette.danger,
                    size: 20,
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      _errorMsg!,
                      style: const TextStyle(
                        color: BrandPalette.danger,
                        fontSize: 13,
                      ),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 14),
          ],

          // Primary CTA
          if (_state != _StartState.started)
            FilledButton(
              onPressed: (c.status.canStart && _state != _StartState.busy)
                  ? _start
                  : null,
              style: FilledButton.styleFrom(
                backgroundColor: BrandPalette.blue,
                foregroundColor: BrandPalette.midnight,
                disabledBackgroundColor: BrandPalette.surface,
                disabledForegroundColor: BrandPalette.muted,
                padding: const EdgeInsets.symmetric(vertical: 18),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(14),
                ),
                textStyle: const TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w900,
                ),
              ),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  if (_state == _StartState.busy) ...[
                    const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        valueColor: AlwaysStoppedAnimation(
                          BrandPalette.midnight,
                        ),
                      ),
                    ),
                    const SizedBox(width: 12),
                    const Text('Starting…'),
                  ] else if (c.status.canStart) ...[
                    const Icon(Icons.bolt_rounded, size: 22),
                    const SizedBox(width: 8),
                    Text(
                      _state == _StartState.failed
                          ? 'Try again'
                          : 'Start charging',
                    ),
                  ] else ...[
                    Text('Charger is ${c.status.label.toLowerCase()}'),
                  ],
                ],
              ),
            )
          else ...[
            // Start request was accepted — offer the live session screen
            // (polls /sessions/current, exposes Stop).
            FilledButton.icon(
              onPressed: () {
                Navigator.of(context).pop();
                Navigator.of(context).push(
                  MaterialPageRoute(
                    builder: (_) =>
                        ActiveSessionScreen(chargerName: c.displayName),
                  ),
                );
              },
              style: FilledButton.styleFrom(
                backgroundColor: BrandPalette.cyan,
                foregroundColor: BrandPalette.midnight,
                padding: const EdgeInsets.symmetric(vertical: 16),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(14),
                ),
                textStyle: const TextStyle(
                  fontSize: 15,
                  fontWeight: FontWeight.w900,
                ),
              ),
              icon: const Icon(Icons.electric_bolt_rounded, size: 20),
              label: const Text('View charging'),
            ),
            const SizedBox(height: 10),
            OutlinedButton(
              onPressed: () => Navigator.of(context).pop(),
              style: OutlinedButton.styleFrom(
                side: const BorderSide(color: BrandPalette.border),
                padding: const EdgeInsets.symmetric(vertical: 16),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(14),
                ),
              ),
              child: const Text(
                'Done',
                style: TextStyle(
                  color: Colors.white,
                  fontWeight: FontWeight.w800,
                  fontSize: 15,
                ),
              ),
            ),
          ],
          if (c.status.canStart && _state == _StartState.idle) ...[
            const SizedBox(height: 10),
            const Text(
              'Straumvakt picks your best credential automatically '
              '(Vehicle ID › RFID › Virtual RFID).',
              textAlign: TextAlign.center,
              style: TextStyle(color: BrandPalette.muted, fontSize: 11),
            ),
          ],
        ],
      ),
    );
  }
}

Color _statusTint(ConnectorStatus s) => switch (s) {
  ConnectorStatus.available => BrandPalette.mint,
  ConnectorStatus.charging => BrandPalette.cyan,
  ConnectorStatus.preparing || ConnectorStatus.finishing => BrandPalette.amber,
  ConnectorStatus.faulted || ConnectorStatus.unavailable => BrandPalette.danger,
  _ => BrandPalette.muted,
};

class _ChargerBadge extends StatelessWidget {
  const _ChargerBadge({required this.status});
  final ConnectorStatus status;

  @override
  Widget build(BuildContext context) {
    final tint = _statusTint(status);
    return Container(
      width: 56,
      height: 56,
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [tint.withValues(alpha: 0.20), tint.withValues(alpha: 0.05)],
        ),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: tint.withValues(alpha: 0.5)),
      ),
      child: Icon(Icons.ev_station_rounded, color: tint, size: 30),
    );
  }
}

class _Stat extends StatelessWidget {
  const _Stat({required this.label, required this.value, this.color});

  final String label;
  final String value;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Column(
        children: [
          Text(
            label.toUpperCase(),
            style: const TextStyle(
              color: BrandPalette.muted,
              fontSize: 9,
              fontWeight: FontWeight.w800,
              letterSpacing: 1.2,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            value,
            style: TextStyle(
              color: color ?? Colors.white,
              fontSize: 14,
              fontWeight: FontWeight.w800,
            ),
          ),
        ],
      ),
    );
  }
}

class _Divider extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return Container(
      width: 1,
      height: 28,
      margin: const EdgeInsets.symmetric(horizontal: 8),
      color: BrandPalette.border,
    );
  }
}
