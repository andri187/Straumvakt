// Driver activity and billing records.
//
// One screen, two sources — /api/driver/sessions/history and
// /api/driver/invoices. Both return the same DTO; the API distinguishes
// them by whether the session went through the billing projection.
//
// Rule 6 throughout, and it matters here more than anywhere else in the
// app: this is money. A session the backend never costed comes back with
// `costIsk == null`, and that renders as "Not priced" — never as 0 kr.
// Showing an uncosted charge as free would be a false statement about a
// bill the driver may later receive.

import 'package:flutter/material.dart';

import '../api/auth_storage.dart';
import '../api/client.dart';
import '../api/types.dart';
import '../theme/palette.dart';
import 'session_detail.dart';

enum HistoryMode { history, invoices }

class ChargeHistoryScreen extends StatefulWidget {
  const ChargeHistoryScreen({super.key, this.mode = HistoryMode.history});

  final HistoryMode mode;

  @override
  State<ChargeHistoryScreen> createState() => _ChargeHistoryScreenState();
}

class _ChargeHistoryScreenState extends State<ChargeHistoryScreen> {
  final _api = StraumvaktApi();
  final _storage = AuthStorage();
  late Future<List<DriverHistorySession>> _future = _load();

  Future<List<DriverHistorySession>> _load() async {
    final token = await _storage.readAccessToken();
    if (token == null) throw ApiException(401, 'Please sign in again.');
    return widget.mode == HistoryMode.invoices
        ? _api.getInvoices(token)
        : _api.getSessionHistory(token);
  }

  Future<void> _refresh() async {
    setState(() => _future = _load());
    await _future.catchError((_) => <DriverHistorySession>[]);
  }

  @override
  Widget build(BuildContext context) {
    final title = widget.mode == HistoryMode.invoices
        ? 'Billing records'
        : 'Activity';

    return Scaffold(
      backgroundColor: BrandPalette.midnight,
      appBar: AppBar(
        backgroundColor: BrandPalette.midnight,
        foregroundColor: Colors.white,
        title: Text(title, style: const TextStyle(fontWeight: FontWeight.w900)),
      ),
      body: RefreshIndicator(
        color: BrandPalette.cyan,
        backgroundColor: BrandPalette.surface,
        onRefresh: _refresh,
        child: FutureBuilder<List<DriverHistorySession>>(
          future: _future,
          builder: (context, snap) {
            if (snap.connectionState == ConnectionState.waiting) {
              return const Center(
                child: CircularProgressIndicator(color: BrandPalette.cyan),
              );
            }
            if (snap.hasError) {
              return _Message(
                icon: Icons.error_outline_rounded,
                title: 'Could not load',
                body: snap.error is ApiException
                    ? (snap.error as ApiException).message
                    : 'Check your connection and pull to retry.',
              );
            }
            final rows = snap.data ?? const <DriverHistorySession>[];
            if (rows.isEmpty) {
              // An empty state is an empty state. No sample rows.
              return _Message(
                icon: Icons.bolt_outlined,
                title: 'Nothing yet',
                body: widget.mode == HistoryMode.invoices
                    ? 'Charges appear here once they have been billed.'
                    : 'Your completed charges will appear here.',
              );
            }
            return ListView.separated(
              padding: const EdgeInsets.fromLTRB(20, 12, 20, 28),
              itemCount: rows.length + 1,
              separatorBuilder: (_, _) => const SizedBox(height: 10),
              itemBuilder: (_, i) {
                if (i == 0) return _Summary(rows: rows);
                final session = rows[i - 1];
                return _SessionCard(
                  s: session,
                  onTap: () => Navigator.of(context).push(
                    MaterialPageRoute(
                      builder: (_) =>
                          SessionDetailScreen(sessionId: session.sessionId),
                    ),
                  ),
                );
              },
            );
          },
        ),
      ),
    );
  }
}

/// Totals across everything loaded. Energy always sums; cost only sums the
/// sessions that actually carry a price, and says how many did not — a
/// total that quietly ignores uncosted sessions would understate the bill.
class _Summary extends StatelessWidget {
  const _Summary({required this.rows});
  final List<DriverHistorySession> rows;

  @override
  Widget build(BuildContext context) {
    final kwh = rows.fold<double>(0, (a, s) => a + s.energyKwh);
    final priced = rows.where((s) => s.costIsk != null);
    final aurar = priced.fold<int>(0, (a, s) => a + s.costIsk!);
    final unpriced = rows.length - priced.length;

    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: BrandPalette.surface,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: BrandPalette.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: _Stat(
                  label: '${rows.length} sessions',
                  value: '${kwh.toStringAsFixed(1)} kWh',
                ),
              ),
              Expanded(
                child: _Stat(
                  label: unpriced == 0 ? 'Total' : '${priced.length} priced',
                  value: '${(aurar / 100).round()} kr',
                ),
              ),
            ],
          ),
          if (unpriced > 0) ...[
            const SizedBox(height: 10),
            Text(
              '$unpriced ${unpriced == 1 ? 'session has' : 'sessions have'} '
              'no price yet, so the total above is not final.',
              style: const TextStyle(color: BrandPalette.amber, fontSize: 11),
            ),
          ],
        ],
      ),
    );
  }
}

class _Stat extends StatelessWidget {
  const _Stat({required this.label, required this.value});
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Text(
        label,
        style: const TextStyle(color: BrandPalette.muted, fontSize: 11),
      ),
      const SizedBox(height: 2),
      Text(
        value,
        style: const TextStyle(
          color: Colors.white,
          fontSize: 20,
          fontWeight: FontWeight.w900,
        ),
      ),
    ],
  );
}

class _SessionCard extends StatelessWidget {
  const _SessionCard({required this.s, required this.onTap});
  final DriverHistorySession s;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final cost = s.costLabel;
    return Material(
      color: BrandPalette.surface,
      borderRadius: BorderRadius.circular(8),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(8),
        child: Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(8),
            border: Border.all(color: BrandPalette.border),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          s.chargerName ?? 'Charger',
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 15,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                        if (s.siteName != null)
                          Text(
                            s.siteName!,
                            style: const TextStyle(
                              color: BrandPalette.muted,
                              fontSize: 12,
                            ),
                          ),
                      ],
                    ),
                  ),
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      Text(
                        // Null cost is a real state, not a zero.
                        cost ?? 'Not priced',
                        style: TextStyle(
                          color: cost == null
                              ? BrandPalette.amber
                              : Colors.white,
                          fontSize: 15,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                      Text(
                        '${s.energyKwh.toStringAsFixed(1)} kWh',
                        style: const TextStyle(
                          color: BrandPalette.muted,
                          fontSize: 12,
                        ),
                      ),
                    ],
                  ),
                ],
              ),
              const SizedBox(height: 10),
              Row(
                children: [
                  const Icon(
                    Icons.schedule_rounded,
                    size: 13,
                    color: BrandPalette.muted,
                  ),
                  const SizedBox(width: 5),
                  Text(
                    '${_date(s.startedAt)} · ${s.durationLabel}',
                    style: const TextStyle(
                      color: BrandPalette.muted,
                      fontSize: 11,
                    ),
                  ),
                  const Spacer(),
                  if (s.billingHomeName != null)
                    Flexible(
                      child: Text(
                        s.billingHomeName!,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          color: BrandPalette.muted,
                          fontSize: 11,
                        ),
                      ),
                    ),
                  const SizedBox(width: 6),
                  const Icon(
                    Icons.chevron_right_rounded,
                    color: BrandPalette.muted,
                    size: 18,
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  static String _date(DateTime d) {
    two(int n) => n.toString().padLeft(2, '0');
    return '${two(d.day)}.${two(d.month)}.${d.year} ${two(d.hour)}:${two(d.minute)}';
  }
}

class _Message extends StatelessWidget {
  const _Message({required this.icon, required this.title, required this.body});
  final IconData icon;
  final String title;
  final String body;

  @override
  Widget build(BuildContext context) => ListView(
    padding: const EdgeInsets.fromLTRB(32, 90, 32, 32),
    children: [
      Icon(icon, size: 40, color: BrandPalette.muted),
      const SizedBox(height: 16),
      Text(
        title,
        textAlign: TextAlign.center,
        style: const TextStyle(
          color: Colors.white,
          fontSize: 17,
          fontWeight: FontWeight.w900,
        ),
      ),
      const SizedBox(height: 8),
      Text(
        body,
        textAlign: TextAlign.center,
        style: const TextStyle(color: BrandPalette.muted, fontSize: 13),
      ),
    ],
  );
}
