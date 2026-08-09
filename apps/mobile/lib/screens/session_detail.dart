import 'package:flutter/material.dart';

import '../api/auth_storage.dart';
import '../api/client.dart';
import '../api/types.dart';
import '../theme/palette.dart';

class SessionDetailScreen extends StatefulWidget {
  const SessionDetailScreen({
    super.key,
    required this.sessionId,
    this.title = 'Charge details',
    this.api,
    this.storage,
  });

  final String sessionId;
  final String title;
  final StraumvaktApi? api;
  final SessionStorage? storage;

  @override
  State<SessionDetailScreen> createState() => _SessionDetailScreenState();
}

class _SessionDetailScreenState extends State<SessionDetailScreen> {
  late final StraumvaktApi _api = widget.api ?? StraumvaktApi();
  late final SessionStorage _storage = widget.storage ?? AuthStorage();
  late final bool _ownsApi = widget.api == null;
  late Future<DriverSessionDetail> _future = _load();

  @override
  void dispose() {
    if (_ownsApi) _api.close();
    super.dispose();
  }

  Future<DriverSessionDetail> _load() async {
    final token = await _storage.readAccessToken();
    if (token == null) throw ApiException(401, 'Please sign in again.');
    return _api.getSessionDetail(
      accessToken: token,
      sessionId: widget.sessionId,
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(widget.title)),
      body: FutureBuilder<DriverSessionDetail>(
        future: _future,
        builder: (context, snapshot) {
          if (snapshot.connectionState == ConnectionState.waiting) {
            return const Center(
              child: CircularProgressIndicator(color: BrandPalette.mint),
            );
          }
          if (snapshot.hasError) {
            return _DetailError(
              onRetry: () => setState(() {
                _future = _load();
              }),
            );
          }
          return SessionSettlementView(detail: snapshot.requireData);
        },
      ),
    );
  }
}

class SessionSettlementView extends StatelessWidget {
  const SessionSettlementView({super.key, required this.detail});

  final DriverSessionDetail detail;

  @override
  Widget build(BuildContext context) {
    final charger = detail.chargerName ?? 'Charger';
    final location = detail.siteName;
    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 16, 20, 32),
      children: [
        const Icon(
          Icons.check_circle_rounded,
          size: 58,
          color: BrandPalette.mint,
        ),
        const SizedBox(height: 12),
        const Text(
          'Charging finished',
          textAlign: TextAlign.center,
          style: TextStyle(
            color: Colors.white,
            fontSize: 24,
            fontWeight: FontWeight.w900,
          ),
        ),
        const SizedBox(height: 6),
        Text(
          location == null ? charger : '$charger · $location',
          textAlign: TextAlign.center,
          style: const TextStyle(color: BrandPalette.muted),
        ),
        const SizedBox(height: 24),
        Container(
          decoration: BoxDecoration(
            color: BrandPalette.surface,
            borderRadius: BorderRadius.circular(8),
            border: Border.all(color: BrandPalette.border),
          ),
          child: Column(
            children: [
              _DetailRow(
                label: 'Energy delivered',
                value: '${detail.energyKwh.toStringAsFixed(2)} kWh',
              ),
              _DetailRow(label: 'Plugged in', value: detail.durationLabel),
              _DetailRow(label: 'Charging time', value: detail.chargeTimeLabel),
              _DetailRow(label: 'Idle time', value: detail.idleTimeLabel),
              _DetailRow(
                label: 'Final cost',
                value: detail.costFormatted ?? 'Not priced yet',
                valueColor: detail.costFormatted == null
                    ? BrandPalette.amber
                    : Colors.white,
                last: detail.stopReason == null,
              ),
              if (detail.stopReason != null)
                _DetailRow(
                  label: 'Ended by',
                  value: detail.stopReason!,
                  last: true,
                ),
            ],
          ),
        ),
        if (detail.costFormatted == null) ...[
          const SizedBox(height: 12),
          const Text(
            'The billing record is still being prepared. No zero-cost '
            'assumption has been made.',
            style: TextStyle(color: BrandPalette.muted, fontSize: 12),
          ),
        ],
      ],
    );
  }
}

class _DetailRow extends StatelessWidget {
  const _DetailRow({
    required this.label,
    required this.value,
    this.valueColor = Colors.white,
    this.last = false,
  });

  final String label;
  final String value;
  final Color valueColor;
  final bool last;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 15),
      decoration: BoxDecoration(
        border: last
            ? null
            : const Border(bottom: BorderSide(color: BrandPalette.border)),
      ),
      child: Row(
        children: [
          Expanded(
            child: Text(
              label,
              style: const TextStyle(color: BrandPalette.muted),
            ),
          ),
          const SizedBox(width: 16),
          Flexible(
            child: Text(
              value,
              textAlign: TextAlign.end,
              style: TextStyle(color: valueColor, fontWeight: FontWeight.w800),
            ),
          ),
        ],
      ),
    );
  }
}

class _DetailError extends StatelessWidget {
  const _DetailError({required this.onRetry});

  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(28),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(
              Icons.receipt_long_outlined,
              color: BrandPalette.muted,
              size: 42,
            ),
            const SizedBox(height: 14),
            const Text(
              'Charge details are not available yet.',
              textAlign: TextAlign.center,
              style: TextStyle(
                color: Colors.white,
                fontWeight: FontWeight.w800,
              ),
            ),
            const SizedBox(height: 16),
            OutlinedButton.icon(
              onPressed: onRetry,
              icon: const Icon(Icons.refresh_rounded),
              label: const Text('Retry'),
            ),
          ],
        ),
      ),
    );
  }
}
