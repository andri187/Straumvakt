import 'package:flutter/material.dart';
import '../api/auth_storage.dart';
import '../api/client.dart';
import '../api/types.dart';
import '../theme/logo.dart';
import '../theme/palette.dart';
import 'hero_image.dart';
import 'menu_drawer.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key, required this.driver});

  final DriverProfile driver;

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  final _api = StraumvaktApi();
  final _storage = AuthStorage();

  late Future<List<DriverCharger>> _futureChargers;

  @override
  void initState() {
    super.initState();
    _futureChargers = _loadChargers();
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
                  final chargers = snap.data ?? const <DriverCharger>[];
                  if (chargers.isEmpty) {
                    return const SliverFillRemaining(
                      hasScrollBody: false,
                      child: _EmptyState(),
                    );
                  }

                  // Group by location for visual organization.
                  final byLocation = <String, List<DriverCharger>>{};
                  for (final c in chargers) {
                    byLocation.putIfAbsent(c.locationName, () => []).add(c);
                  }

                  return SliverPadding(
                    padding: const EdgeInsets.fromLTRB(20, 0, 20, 24),
                    sliver: SliverList(
                      delegate: SliverChildBuilderDelegate(
                        (context, index) {
                          final entry = byLocation.entries.elementAt(index);
                          return _LocationGroup(
                            location: entry.key,
                            chargers: entry.value,
                          );
                        },
                        childCount: byLocation.length,
                      ),
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

class _LocationGroup extends StatelessWidget {
  const _LocationGroup({required this.location, required this.chargers});

  final String location;
  final List<DriverCharger> chargers;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.only(top: 12, bottom: 8, left: 4),
          child: Row(
            children: [
              const Icon(Icons.place_outlined,
                  size: 16, color: BrandPalette.muted),
              const SizedBox(width: 6),
              Expanded(
                child: Text(
                  location,
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 14,
                    fontWeight: FontWeight.w700,
                    letterSpacing: 0.2,
                  ),
                ),
              ),
              Text(
                '${chargers.length}',
                style: const TextStyle(
                  color: BrandPalette.muted,
                  fontSize: 12,
                ),
              ),
            ],
          ),
        ),
        ...chargers.map((c) => _ChargerCard(charger: c)),
      ],
    );
  }
}

class _ChargerCard extends StatelessWidget {
  const _ChargerCard({required this.charger});

  final DriverCharger charger;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Card(
        child: InkWell(
          borderRadius: BorderRadius.circular(18),
          onTap: () {
            // Phase 3 hook — start session flow.
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(
                content: Text(
                  'Start ${charger.displayName} — coming in Phase 3',
                ),
                backgroundColor: BrandPalette.surface,
              ),
            );
          },
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Row(
              children: [
                Container(
                  width: 44,
                  height: 44,
                  decoration: BoxDecoration(
                    color: BrandPalette.deepNavy,
                    borderRadius: BorderRadius.circular(14),
                    border: Border.all(color: BrandPalette.border),
                  ),
                  child: Icon(
                    Icons.bolt_rounded,
                    color: charger.status.canStart
                        ? BrandPalette.mint
                        : BrandPalette.muted,
                  ),
                ),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        charger.displayName,
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 15,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Row(
                        children: [
                          _StatusPill(status: charger.status),
                          if (charger.maxPowerKw > 0) ...[
                            const SizedBox(width: 8),
                            Text(
                              '${charger.maxPowerKw.toStringAsFixed(1)} kW',
                              style: const TextStyle(
                                color: BrandPalette.muted,
                                fontSize: 12,
                              ),
                            ),
                          ],
                        ],
                      ),
                    ],
                  ),
                ),
                const Icon(Icons.chevron_right_rounded,
                    color: BrandPalette.muted),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _StatusPill extends StatelessWidget {
  const _StatusPill({required this.status});

  final ConnectorStatus status;

  @override
  Widget build(BuildContext context) {
    final (Color bg, Color fg) = switch (status) {
      ConnectorStatus.available => (
          BrandPalette.mint.withValues(alpha: 0.14),
          BrandPalette.mint
        ),
      ConnectorStatus.charging => (
          BrandPalette.cyan.withValues(alpha: 0.14),
          BrandPalette.cyan
        ),
      ConnectorStatus.preparing ||
      ConnectorStatus.finishing =>
        (BrandPalette.amber.withValues(alpha: 0.14), BrandPalette.amber),
      ConnectorStatus.faulted ||
      ConnectorStatus.unavailable =>
        (BrandPalette.danger.withValues(alpha: 0.14), BrandPalette.danger),
      _ => (
          BrandPalette.muted.withValues(alpha: 0.14),
          BrandPalette.muted
        ),
    };

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Text(
        status.label,
        style: TextStyle(
          color: fg,
          fontSize: 11,
          fontWeight: FontWeight.w700,
        ),
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
