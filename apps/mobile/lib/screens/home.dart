import 'package:flutter/material.dart';
import '../api/auth_storage.dart';
import '../api/client.dart';
import '../api/types.dart';
import 'dart:async';
import '../ble/scanner.dart';
import '../theme/logo.dart';
import '../theme/palette.dart';
import 'charger_detail_sheet.dart';
import 'hero_image.dart';
import 'menu_drawer.dart';
import 'nearby_card.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key, required this.driver});

  final DriverProfile driver;

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

enum _Filter { all, available, busy, offline }

class _HomeScreenState extends State<HomeScreen> {
  final _api = StraumvaktApi();
  final _storage = AuthStorage();
  final _scanner = BleScanner.instance();
  StreamSubscription<NearbyCharger>? _scanSub;

  late Future<List<DriverCharger>> _futureChargers;
  _Filter _filter = _Filter.all;

  // All currently-detected nearby chargers (keyed by connectorId).
  // Twin-pole / quad-pole installs trigger multiple detections at
  // similar RSSI; we keep them all and let the driver pick.
  // Entries expire 8s after their last detection (driver walked away).
  final Map<String, NearbyCharger> _nearbyMap = {};
  Timer? _nearbyCleanupTimer;

  @override
  void initState() {
    super.initState();
    _futureChargers = _loadChargers();
    _futureChargers.then(_startScanning).catchError((_) {});
  }

  @override
  void dispose() {
    _scanSub?.cancel();
    _nearbyCleanupTimer?.cancel();
    _scanner.stop();
    super.dispose();
  }

  Future<void> _startScanning(List<DriverCharger> chargers) async {
    final ok = await _scanner.start(known: chargers);
    if (!ok) return;

    // Re-scan the map every 2s and drop entries older than 8s. Cheap
    // periodic GC instead of one Timer per detection (which got messy
    // with twin-pole installs constantly re-firing).
    _nearbyCleanupTimer = Timer.periodic(const Duration(seconds: 2), (_) {
      if (!mounted) return;
      final cutoff = DateTime.now().subtract(const Duration(seconds: 8));
      final stale = _nearbyMap.entries
          .where((e) => e.value.detectedAt.isBefore(cutoff))
          .map((e) => e.key)
          .toList();
      if (stale.isEmpty) return;
      setState(() {
        for (final k in stale) {
          _nearbyMap.remove(k);
        }
      });
    });

    _scanSub = _scanner.nearbyStream.listen((nearby) {
      if (!mounted) return;
      setState(() {
        _nearbyMap[nearby.charger.connectorId] = nearby;
      });
    });
  }

  /// Currently-nearby chargers sorted strongest-first (highest RSSI).
  /// Twin-pole installs may have 2-4 within range simultaneously; the
  /// driver picks which one they actually want.
  List<NearbyCharger> get _nearbySorted {
    final list = _nearbyMap.values.toList();
    list.sort((a, b) => b.rssi.compareTo(a.rssi));
    return list;
  }

  /// Opens a bottom sheet listing all currently-nearby chargers so the
  /// driver can disambiguate when several are on the same pole.
  void _showNearbyPicker() {
    showModalBottomSheet<void>(
      context: context,
      backgroundColor: Colors.transparent,
      isScrollControlled: true,
      builder: (_) => _NearbyPickerSheet(
        nearby: _nearbySorted,
        onPick: (n) {
          Navigator.of(context).pop();
          ChargerDetailSheet.show(context, n.charger);
        },
      ),
    );
  }

  Future<List<DriverCharger>> _loadChargers() async {
    final token = await _storage.readAccessToken();
    if (token == null) {
      throw ApiException(401, 'No session — please sign in again.');
    }
    return _api.getChargers(token);
  }

  Future<void> _refresh() async {
    setState(() {
      _futureChargers = _loadChargers();
    });
    await _futureChargers.catchError((_) => <DriverCharger>[]);
  }

  List<DriverCharger> _applyFilters(List<DriverCharger> chargers) {
    return chargers.where((c) {
      // Status filter
      switch (_filter) {
        case _Filter.all:
          break;
        case _Filter.available:
          if (c.status != ConnectorStatus.available) return false;
          break;
        case _Filter.busy:
          if (c.status != ConnectorStatus.charging &&
              c.status != ConnectorStatus.preparing &&
              c.status != ConnectorStatus.finishing &&
              c.status != ConnectorStatus.suspendedEv &&
              c.status != ConnectorStatus.suspendedEvse) {
            return false;
          }
          break;
        case _Filter.offline:
          if (c.status != ConnectorStatus.offline &&
              c.status != ConnectorStatus.unavailable &&
              c.status != ConnectorStatus.faulted) {
            return false;
          }
          break;
      }
      return true;
    }).toList();
  }

  int _count(List<DriverCharger> chargers, _Filter f) {
    if (f == _Filter.all) return chargers.length;
    return chargers.where((c) {
      switch (f) {
        case _Filter.available:
          return c.status == ConnectorStatus.available;
        case _Filter.busy:
          return c.status == ConnectorStatus.charging ||
              c.status == ConnectorStatus.preparing ||
              c.status == ConnectorStatus.finishing ||
              c.status == ConnectorStatus.suspendedEv ||
              c.status == ConnectorStatus.suspendedEvse;
        case _Filter.offline:
          return c.status == ConnectorStatus.offline ||
              c.status == ConnectorStatus.unavailable ||
              c.status == ConnectorStatus.faulted;
        default:
          return false;
      }
    }).length;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      drawer: MenuDrawer(driver: widget.driver),
      body: SafeArea(
        child: RefreshIndicator(
          onRefresh: _refresh,
          color: BrandPalette.mint,
          backgroundColor: BrandPalette.surface,
          child: CustomScrollView(
            slivers: [
              SliverToBoxAdapter(
                child: Builder(
                  builder: (ctx) => _Header(
                    driver: widget.driver,
                    onMenu: () => Scaffold.of(ctx).openDrawer(),
                  ),
                ),
              ),
              const SliverToBoxAdapter(child: HeroImageBanner()),
              FutureBuilder<List<DriverCharger>>(
                future: _futureChargers,
                builder: (context, snap) {
                  if (snap.connectionState == ConnectionState.waiting) {
                    return const SliverFillRemaining(
                      hasScrollBody: false,
                      child: Center(
                        child: CircularProgressIndicator(
                          color: BrandPalette.mint,
                        ),
                      ),
                    );
                  }
                  if (snap.hasError) {
                    return SliverFillRemaining(
                      hasScrollBody: false,
                      child: _ErrorState(
                        message: snap.error.toString(),
                        onRetry: _refresh,
                      ),
                    );
                  }
                  final all = snap.data ?? const <DriverCharger>[];
                  if (all.isEmpty) {
                    return const SliverFillRemaining(
                      hasScrollBody: false,
                      child: _EmptyState(),
                    );
                  }
                  final filtered = _applyFilters(all);

                  // Group filtered chargers by location. When the
                  // driver has access at multiple installations, this
                  // gives them clear sections + per-location counts.
                  // With only one location, the header is still
                  // visible — the cost is one row of label.
                  final byLocation = <String, List<DriverCharger>>{};
                  for (final c in filtered) {
                    byLocation
                        .putIfAbsent(c.locationName, () => [])
                        .add(c);
                  }

                  return SliverPadding(
                    padding: const EdgeInsets.fromLTRB(20, 4, 20, 24),
                    sliver: SliverList(
                      delegate: SliverChildListDelegate.fixed([
                        if (_nearbySorted.isNotEmpty)
                          NearbyCard(
                            nearby: _nearbySorted.first,
                            othersNearby:
                                _nearbySorted.skip(1).toList(growable: false),
                            onPickOther: _showNearbyPicker,
                          ),
                        _FilterChips(
                          selected: _filter,
                          counts: {
                            _Filter.all: _count(all, _Filter.all),
                            _Filter.available: _count(all, _Filter.available),
                            _Filter.busy: _count(all, _Filter.busy),
                            _Filter.offline: _count(all, _Filter.offline),
                          },
                          onSelect: (f) => setState(() => _filter = f),
                        ),
                        const SizedBox(height: 14),
                        if (filtered.isEmpty)
                          const _NoMatches()
                        else
                          for (final entry in byLocation.entries) ...[
                            _LocationHeader(
                              location: entry.key,
                              count: entry.value.length,
                            ),
                            ...entry.value.map((c) => _ChargerRow(
                                  charger: c,
                                  onTap: () =>
                                      ChargerDetailSheet.show(context, c),
                                )),
                            const SizedBox(height: 8),
                          ],
                      ]),
                    ),
                  );
                },
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _Header extends StatelessWidget {
  const _Header({required this.driver, required this.onMenu});

  final DriverProfile driver;
  final VoidCallback onMenu;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 12, 12, 8),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          const LogoMark(size: 40, borderRadius: 12),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  'Hello, ${driver.displayName}',
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 17,
                    fontWeight: FontWeight.w800,
                    letterSpacing: -0.2,
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                Text(
                  driver.organizationName ?? driver.email,
                  style: const TextStyle(
                    color: BrandPalette.muted,
                    fontSize: 12,
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ],
            ),
          ),
          IconButton(
            onPressed: onMenu,
            icon: const Icon(Icons.menu_rounded, color: BrandPalette.muted),
            tooltip: 'Menu',
          ),
        ],
      ),
    );
  }
}


class _FilterChips extends StatelessWidget {
  const _FilterChips({
    required this.selected,
    required this.counts,
    required this.onSelect,
  });

  final _Filter selected;
  final Map<_Filter, int> counts;
  final ValueChanged<_Filter> onSelect;

  @override
  Widget build(BuildContext context) {
    final entries = [
      (_Filter.all, 'All', null),
      (_Filter.available, 'Available', BrandPalette.mint),
      (_Filter.busy, 'In use', BrandPalette.cyan),
      (_Filter.offline, 'Offline', BrandPalette.danger),
    ];
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Row(
        children: [
          for (final (filter, label, accent) in entries) ...[
            _Chip(
              label: label,
              count: counts[filter] ?? 0,
              accent: accent,
              selected: selected == filter,
              onTap: () => onSelect(filter),
            ),
            const SizedBox(width: 8),
          ],
        ],
      ),
    );
  }
}

class _Chip extends StatelessWidget {
  const _Chip({
    required this.label,
    required this.count,
    required this.selected,
    required this.onTap,
    this.accent,
  });

  final String label;
  final int count;
  final bool selected;
  final VoidCallback onTap;
  final Color? accent;

  @override
  Widget build(BuildContext context) {
    final tint = accent ?? BrandPalette.cyan;
    final bg = selected
        ? tint.withValues(alpha: 0.18)
        : BrandPalette.surface;
    final border = selected ? tint : BrandPalette.border;
    final fg = selected ? tint : BrandPalette.muted;
    return GestureDetector(
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 150),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
        decoration: BoxDecoration(
          color: bg,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: border),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (accent != null && !selected) ...[
              Container(
                width: 6,
                height: 6,
                decoration: BoxDecoration(
                  color: accent,
                  shape: BoxShape.circle,
                ),
              ),
              const SizedBox(width: 6),
            ],
            Text(
              label,
              style: TextStyle(
                color: fg,
                fontSize: 12,
                fontWeight: FontWeight.w800,
              ),
            ),
            const SizedBox(width: 6),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
              decoration: BoxDecoration(
                color: selected
                    ? tint.withValues(alpha: 0.25)
                    : BrandPalette.deepNavy,
                borderRadius: BorderRadius.circular(8),
              ),
              child: Text(
                '$count',
                style: TextStyle(
                  color: fg,
                  fontSize: 11,
                  fontWeight: FontWeight.w800,
                  fontFeatures: const [FontFeature.tabularFigures()],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// Compact charger row — pattern lifted from ChargePoint / Octopus
// Electroverse / Tesla detail list. ~64px tall, status dot + name +
// meta + chevron. Tap → ChargerDetailSheet (modal bottom sheet) with
// the prominent Start CTA. Keeps the list scannable at 30+ chargers.
class _ChargerRow extends StatelessWidget {
  const _ChargerRow({required this.charger, required this.onTap});

  final DriverCharger charger;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final c = charger;
    final tint = switch (c.status) {
      ConnectorStatus.available => BrandPalette.mint,
      ConnectorStatus.charging => BrandPalette.cyan,
      ConnectorStatus.preparing ||
      ConnectorStatus.finishing => BrandPalette.amber,
      ConnectorStatus.faulted ||
      ConnectorStatus.unavailable => BrandPalette.danger,
      _ => BrandPalette.muted,
    };
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(14),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        margin: const EdgeInsets.only(bottom: 6),
        decoration: BoxDecoration(
          color: BrandPalette.surface,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: BrandPalette.border),
        ),
        child: Row(
          children: [
            // Status dot
            Container(
              width: 10,
              height: 10,
              decoration: BoxDecoration(
                color: tint,
                shape: BoxShape.circle,
                boxShadow: c.status == ConnectorStatus.available
                    ? [
                        BoxShadow(
                          color: tint.withValues(alpha: 0.55),
                          blurRadius: 8,
                        ),
                      ]
                    : null,
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    c.displayName,
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 14,
                      fontWeight: FontWeight.w700,
                      letterSpacing: -0.1,
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                  const SizedBox(height: 2),
                  Text(
                    c.maxPowerKw > 0
                        ? '${c.status.label} · ${c.maxPowerKw.toStringAsFixed(1)} kW'
                        : c.status.label,
                    style: TextStyle(
                      color: tint.withValues(alpha: 0.85),
                      fontSize: 11,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ],
              ),
            ),
            const Icon(Icons.chevron_right_rounded,
                color: BrandPalette.muted, size: 20),
          ],
        ),
      ),
    );
  }
}

// Modal sheet that lists every currently-nearby charger sorted by
// RSSI. Used when twin-pole / quad-pole installs put several Zaptecs
// within tap range simultaneously and the driver needs to pick.
class _NearbyPickerSheet extends StatelessWidget {
  const _NearbyPickerSheet({required this.nearby, required this.onPick});

  final List<NearbyCharger> nearby;
  final ValueChanged<NearbyCharger> onPick;

  @override
  Widget build(BuildContext context) {
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
      padding: const EdgeInsets.fromLTRB(20, 12, 20, 24),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Center(
            child: Container(
              width: 40,
              height: 4,
              margin: const EdgeInsets.only(bottom: 14),
              decoration: BoxDecoration(
                color: BrandPalette.muted.withValues(alpha: 0.4),
                borderRadius: BorderRadius.circular(2),
              ),
            ),
          ),
          const Text(
            'Pick the charger',
            style: TextStyle(
              color: Colors.white,
              fontSize: 18,
              fontWeight: FontWeight.w900,
              letterSpacing: -0.3,
            ),
          ),
          const SizedBox(height: 4),
          const Text(
            'Multiple Zaptecs are within BLE range — common when '
            'they\'re mounted on the same pole. Sorted by signal '
            'strength (closest first).',
            style: TextStyle(color: BrandPalette.muted, fontSize: 12),
          ),
          const SizedBox(height: 14),
          ...nearby.map((n) => _NearbyPickRow(
                nearby: n,
                onTap: () => onPick(n),
              )),
        ],
      ),
    );
  }
}

class _NearbyPickRow extends StatelessWidget {
  const _NearbyPickRow({required this.nearby, required this.onTap});

  final NearbyCharger nearby;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final c = nearby.charger;
    final cm = (nearby.approxMetres * 100).round();
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(14),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
          decoration: BoxDecoration(
            color: BrandPalette.deepNavy,
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: BrandPalette.border),
          ),
          child: Row(
            children: [
              const Icon(Icons.bluetooth_rounded,
                  color: BrandPalette.cyan, size: 18),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      c.displayName,
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 15,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      cm < 100 ? '$cm cm · ${nearby.rssi} dBm' : '~${nearby.approxMetres.toStringAsFixed(1)} m · ${nearby.rssi} dBm',
                      style: const TextStyle(
                        color: BrandPalette.muted,
                        fontSize: 11,
                        fontFeatures: [FontFeature.tabularFigures()],
                      ),
                    ),
                  ],
                ),
              ),
              const Icon(Icons.chevron_right_rounded,
                  color: BrandPalette.muted, size: 20),
            ],
          ),
        ),
      ),
    );
  }
}

class _LocationHeader extends StatelessWidget {
  const _LocationHeader({required this.location, required this.count});

  final String location;
  final int count;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(2, 4, 2, 6),
      child: Row(
        children: [
          const Icon(Icons.place_rounded,
              size: 16, color: BrandPalette.muted),
          const SizedBox(width: 6),
          Expanded(
            child: Text(
              location,
              style: const TextStyle(
                color: Colors.white,
                fontSize: 13,
                fontWeight: FontWeight.w800,
                letterSpacing: 0.2,
              ),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
          Text(
            '$count',
            style: const TextStyle(
              color: BrandPalette.muted,
              fontSize: 12,
              fontWeight: FontWeight.w700,
              fontFeatures: [FontFeature.tabularFigures()],
            ),
          ),
        ],
      ),
    );
  }
}

class _NoMatches extends StatelessWidget {
  const _NoMatches();

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 32),
      child: Column(
        children: [
          Icon(
            Icons.search_off_rounded,
            size: 36,
            color: BrandPalette.muted.withValues(alpha: 0.6),
          ),
          const SizedBox(height: 8),
          const Text(
            'No chargers match',
            style: TextStyle(
              color: Colors.white,
              fontSize: 14,
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 4),
          const Text(
            'Try a different filter.',
            style: TextStyle(color: BrandPalette.muted, fontSize: 12),
          ),
        ],
      ),
    );
  }
}


class _EmptyState extends StatelessWidget {
  const _EmptyState();

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(32),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(Icons.ev_station_outlined,
              size: 64, color: BrandPalette.muted.withValues(alpha: 0.5)),
          const SizedBox(height: 16),
          const Text(
            'No chargers yet',
            style: TextStyle(
              color: Colors.white,
              fontSize: 18,
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 6),
          const Text(
            'Your operator hasn\'t given you access to any chargers '
            'under an active agreement. Reach out to them to get added '
            'to a driver group.',
            textAlign: TextAlign.center,
            style: TextStyle(color: BrandPalette.muted, fontSize: 13),
          ),
        ],
      ),
    );
  }
}

class _ErrorState extends StatelessWidget {
  const _ErrorState({required this.message, required this.onRetry});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(32),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const Icon(Icons.error_outline,
              size: 64, color: BrandPalette.danger),
          const SizedBox(height: 16),
          const Text(
            'Something went wrong',
            style: TextStyle(
              color: Colors.white,
              fontSize: 18,
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 6),
          Text(
            message,
            textAlign: TextAlign.center,
            style: const TextStyle(color: BrandPalette.muted, fontSize: 12),
          ),
          const SizedBox(height: 18),
          FilledButton.icon(
            onPressed: onRetry,
            icon: const Icon(Icons.refresh_rounded),
            label: const Text('Retry'),
          ),
        ],
      ),
    );
  }
}
