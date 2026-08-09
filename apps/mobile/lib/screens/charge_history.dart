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
  const ChargeHistoryScreen({
    super.key,
    this.mode = HistoryMode.history,
    this.api,
    this.storage,
  });

  final HistoryMode mode;
  final StraumvaktApi? api;
  final SessionStorage? storage;

  @override
  State<ChargeHistoryScreen> createState() => _ChargeHistoryScreenState();
}

class _ChargeHistoryScreenState extends State<ChargeHistoryScreen> {
  static const _pageSize = 25;

  late final StraumvaktApi _api = widget.api ?? StraumvaktApi();
  late final SessionStorage _storage = widget.storage ?? AuthStorage();
  late final bool _ownsApi = widget.api == null;
  final _scrollController = ScrollController();
  final List<DriverHistorySession> _rows = [];
  bool _initialLoading = true;
  bool _loadingMore = false;
  bool _hasMore = true;
  String? _initialError;
  String? _loadMoreError;
  int _generation = 0;

  @override
  void initState() {
    super.initState();
    _scrollController.addListener(_onScroll);
    _refresh();
  }

  @override
  void dispose() {
    _scrollController.dispose();
    if (_ownsApi) _api.close();
    super.dispose();
  }

  void _onScroll() {
    if (!_scrollController.hasClients || !_hasMore || _loadingMore) return;
    if (_scrollController.position.extentAfter < 240) _loadMore();
  }

  String _message(Object error) => error is ApiException
      ? error.message
      : 'Check your connection and try again.';

  Future<List<DriverHistorySession>> _loadPage(int skip) async {
    final token = await _storage.readAccessToken();
    if (token == null) throw ApiException(401, 'Please sign in again.');
    return widget.mode == HistoryMode.invoices
        ? _api.getInvoices(token)
        : _api.getSessionHistory(token, skip: skip, limit: _pageSize);
  }

  Future<void> _refresh() async {
    final generation = ++_generation;
    setState(() {
      _initialLoading = true;
      _initialError = null;
      _loadMoreError = null;
    });
    try {
      final page = await _loadPage(0);
      if (!mounted || generation != _generation) return;
      setState(() {
        _rows
          ..clear()
          ..addAll(_deduplicated(page));
        _hasMore =
            widget.mode == HistoryMode.history && page.length >= _pageSize;
        _initialLoading = false;
      });
    } catch (error) {
      if (!mounted || generation != _generation) return;
      setState(() {
        _initialLoading = false;
        _initialError = _message(error);
      });
    }
  }

  Future<void> _loadMore() async {
    if (!_hasMore || _loadingMore || _initialLoading) return;
    final generation = _generation;
    setState(() {
      _loadingMore = true;
      _loadMoreError = null;
    });
    try {
      final page = await _loadPage(_rows.length);
      if (!mounted || generation != _generation) return;
      final known = _rows.map((row) => row.sessionId).toSet();
      setState(() {
        _rows.addAll(page.where((row) => known.add(row.sessionId)));
        _hasMore = page.length >= _pageSize;
        _loadingMore = false;
      });
    } catch (error) {
      if (!mounted || generation != _generation) return;
      setState(() {
        _loadingMore = false;
        _loadMoreError = _message(error);
      });
    }
  }

  List<DriverHistorySession> _deduplicated(List<DriverHistorySession> page) {
    final ids = <String>{};
    return page.where((row) => ids.add(row.sessionId)).toList();
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
        child: Builder(
          builder: (context) {
            if (_initialLoading) {
              return const _LoadingMessage();
            }
            if (_initialError != null) {
              return _Message(
                icon: Icons.error_outline_rounded,
                title: 'Could not load',
                body: _initialError!,
                actionLabel: 'Retry',
                onAction: _refresh,
              );
            }
            if (_rows.isEmpty) {
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
              controller: _scrollController,
              physics: const AlwaysScrollableScrollPhysics(),
              padding: const EdgeInsets.fromLTRB(20, 12, 20, 28),
              itemCount: _rows.length + 2,
              separatorBuilder: (_, _) => const SizedBox(height: 10),
              itemBuilder: (_, i) {
                if (i == 0) return _Summary(rows: _rows);
                if (i == _rows.length + 1) {
                  return _PaginationFooter(
                    hasMore: _hasMore,
                    loading: _loadingMore,
                    error: _loadMoreError,
                    onLoadMore: _loadMore,
                  );
                }
                final session = _rows[i - 1];
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
  const _Message({
    required this.icon,
    required this.title,
    required this.body,
    this.actionLabel,
    this.onAction,
  });
  final IconData icon;
  final String title;
  final String body;
  final String? actionLabel;
  final VoidCallback? onAction;

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
      if (actionLabel != null && onAction != null) ...[
        const SizedBox(height: 20),
        FilledButton(onPressed: onAction, child: Text(actionLabel!)),
      ],
    ],
  );
}

class _LoadingMessage extends StatelessWidget {
  const _LoadingMessage();

  @override
  Widget build(BuildContext context) => Center(
    child: Semantics(
      label: 'Loading activity',
      child: const CircularProgressIndicator(color: BrandPalette.cyan),
    ),
  );
}

class _PaginationFooter extends StatelessWidget {
  const _PaginationFooter({
    required this.hasMore,
    required this.loading,
    required this.error,
    required this.onLoadMore,
  });

  final bool hasMore;
  final bool loading;
  final String? error;
  final VoidCallback onLoadMore;

  @override
  Widget build(BuildContext context) {
    if (!hasMore && error == null) return const SizedBox(height: 8);
    if (loading) {
      return Center(
        child: Semantics(
          label: 'Loading more activity',
          child: const CircularProgressIndicator(color: BrandPalette.cyan),
        ),
      );
    }
    return Column(
      children: [
        if (error != null) ...[
          Text(
            error!,
            textAlign: TextAlign.center,
            style: const TextStyle(color: BrandPalette.danger),
          ),
          const SizedBox(height: 8),
        ],
        OutlinedButton(
          onPressed: onLoadMore,
          child: Text(error == null ? 'Load more' : 'Retry'),
        ),
      ],
    );
  }
}
