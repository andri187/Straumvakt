// Installation picker — context chip + bottom-sheet picker.
//
// Sprint 9 / 2026-05-10. Surfaces the driver's accessible installations
// as a single chip above the filter row; tapping the chip opens a
// bottom sheet sorted by relevance:
//
//   1. Right here (BLE) — the currently-detected nearby charger
//   2. Recent / All locations — every installation the driver has
//      access to, with available/total counts
//
// Derivation is client-side only: the home screen already loads
// /api/driver/chargers which carries `locationName` per charger. We
// group by locationName to produce the picker rows. No new endpoint.
//
// Single-install drivers (only one distinct locationName) see no chip
// — the home screen renders unchanged. Complexity scales with access
// scope, matching the design intent in
// docs/app/installation-picker-concept.html.

import 'package:flutter/material.dart';
import '../api/types.dart';
import '../ble/scanner.dart';
import '../theme/palette.dart';

class LocationSummary {
  const LocationSummary({
    required this.name,
    required this.total,
    required this.available,
    required this.busy,
    required this.offline,
  });

  final String name;
  final int total;
  final int available;
  final int busy;
  final int offline;

  String get countLabel {
    if (offline == total) return 'all chargers offline';
    return '$available of $total available';
  }
}

/// Build distinct location summaries from the driver's accessible
/// chargers. Caller passes the full unfiltered list (status-filter is
/// an orthogonal concern). Returns one entry per distinct locationName,
/// sorted alphabetically.
List<LocationSummary> summarizeLocations(List<DriverCharger> chargers) {
  final byName = <String, List<DriverCharger>>{};
  for (final c in chargers) {
    byName.putIfAbsent(c.locationName, () => []).add(c);
  }
  final list = byName.entries.map((entry) {
    final all = entry.value;
    final available = all.where((c) => c.status == ConnectorStatus.available).length;
    final offline = all
        .where((c) =>
            c.status == ConnectorStatus.offline ||
            c.status == ConnectorStatus.unavailable ||
            c.status == ConnectorStatus.faulted)
        .length;
    final busy = all.where((c) =>
        c.status == ConnectorStatus.charging ||
        c.status == ConnectorStatus.preparing ||
        c.status == ConnectorStatus.finishing ||
        c.status == ConnectorStatus.suspendedEv ||
        c.status == ConnectorStatus.suspendedEvse).length;
    return LocationSummary(
      name: entry.key,
      total: all.length,
      available: available,
      busy: busy,
      offline: offline,
    );
  }).toList()
    ..sort((a, b) => a.name.compareTo(b.name));
  return list;
}

/// The chip rendered above the filter row when the driver has access
/// to ≥2 installations. Single-install drivers never see this widget;
/// the parent gates rendering on `locations.length >= 2`.
class InstallationContextChip extends StatelessWidget {
  const InstallationContextChip({
    super.key,
    required this.selectedLocation,
    required this.locations,
    required this.bleNearby,
    required this.onTap,
  });

  /// `null` = "All locations" (no filter active). Otherwise the
  /// locationName the home screen is filtered to.
  final String? selectedLocation;

  /// Every installation the driver can charge at. Used to count
  /// chargers in the chip's subtext.
  final List<LocationSummary> locations;

  /// If BLE detected a charger right now, the chip can promote that
  /// signal to "Right next to [charger]". Pass null when no BLE hit.
  final NearbyCharger? bleNearby;

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    // Resolve the chip's source + label + meta in priority order:
    //   1. BLE (a charger is right here)
    //   2. Explicit selection (operator picked a location)
    //   3. Default to "All locations"
    String source;
    String label;
    String meta;
    Color sourceColor;

    if (bleNearby != null) {
      source = 'RIGHT NEXT TO YOU';
      label = bleNearby!.charger.displayName;
      meta = '${bleNearby!.charger.locationName} · BLE detected';
      sourceColor = BrandPalette.mint;
    } else if (selectedLocation != null) {
      final found = locations.firstWhere(
        (l) => l.name == selectedLocation,
        orElse: () => LocationSummary(
          name: selectedLocation!,
          total: 0,
          available: 0,
          busy: 0,
          offline: 0,
        ),
      );
      source = 'SELECTED';
      label = found.name;
      meta = found.countLabel;
      sourceColor = BrandPalette.blue;
    } else if (locations.length == 1) {
      // Single-location pilot. The chip works as a "you have access
      // here" badge rather than a chooser — the bottom sheet still
      // opens (operator may want to verify scope), but the label is
      // the location name itself, not "All locations".
      final only = locations.first;
      source = 'YOUR LOCATION';
      label = only.name;
      meta = only.countLabel;
      sourceColor = BrandPalette.blue;
    } else {
      final totalChargers = locations.fold<int>(0, (a, b) => a + b.total);
      final totalAvailable = locations.fold<int>(0, (a, b) => a + b.available);
      final siteWord = locations.length == 1 ? 'site' : 'sites';
      source = 'ALL ACCESS';
      label = 'All locations';
      meta = '$totalAvailable of $totalChargers available · ${locations.length} $siteWord';
      sourceColor = BrandPalette.muted;
    }

    // Width matches the charger-row cards: parent SliverPadding gives
    // 20px horizontal already, so the chip itself only adds bottom
    // spacing. No internal horizontal padding wrapper.
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Material(
        color: BrandPalette.surface,
        borderRadius: BorderRadius.circular(14),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(14),
          child: Container(
            padding: const EdgeInsets.fromLTRB(12, 8, 10, 8),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(14),
              border: Border.all(color: BrandPalette.border),
            ),
            child: Row(
              children: [
                Container(
                  width: 26,
                  height: 26,
                  decoration: BoxDecoration(
                    color: sourceColor.withValues(alpha: 0.18),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Icon(
                    bleNearby != null
                        ? Icons.bluetooth_searching_rounded
                        : Icons.place_rounded,
                    color: sourceColor,
                    size: 15,
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        source,
                        style: TextStyle(
                          color: sourceColor,
                          fontSize: 8.5,
                          letterSpacing: 1.1,
                          fontWeight: FontWeight.w700,
                          height: 1.1,
                        ),
                      ),
                      const SizedBox(height: 1),
                      Text(
                        label,
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 13.5,
                          fontWeight: FontWeight.w600,
                          letterSpacing: -0.1,
                          height: 1.2,
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                      Text(
                        meta,
                        style: const TextStyle(
                          color: BrandPalette.muted,
                          fontSize: 10.5,
                          height: 1.2,
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ],
                  ),
                ),
                const Icon(
                  Icons.expand_more_rounded,
                  color: BrandPalette.muted,
                  size: 18,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Bottom sheet that opens from the chip. Shows the BLE-detected
/// charger (if any), then every accessible installation, then a
/// "Show all locations" reset row.
///
/// Returns the selected locationName via the [onSelect] callback —
/// pass `null` when the driver picks "Show all locations" so the home
/// screen clears its filter.
class InstallationPickerSheet extends StatefulWidget {
  const InstallationPickerSheet({
    super.key,
    required this.locations,
    required this.selectedLocation,
    required this.bleNearby,
    required this.onSelect,
    required this.onTapBle,
  });

  final List<LocationSummary> locations;
  final String? selectedLocation;
  final NearbyCharger? bleNearby;
  final ValueChanged<String?> onSelect;

  /// Tapping the BLE row goes straight to the charger detail sheet
  /// (one-tap start) rather than filtering by location. The home
  /// screen wires this to its existing ChargerDetailSheet.show flow.
  final VoidCallback onTapBle;

  static Future<void> show(
    BuildContext context, {
    required List<LocationSummary> locations,
    required String? selectedLocation,
    required NearbyCharger? bleNearby,
    required ValueChanged<String?> onSelect,
    required VoidCallback onTapBle,
  }) {
    return showModalBottomSheet<void>(
      context: context,
      backgroundColor: Colors.transparent,
      isScrollControlled: true,
      builder: (_) => InstallationPickerSheet(
        locations: locations,
        selectedLocation: selectedLocation,
        bleNearby: bleNearby,
        onSelect: onSelect,
        onTapBle: onTapBle,
      ),
    );
  }

  @override
  State<InstallationPickerSheet> createState() =>
      _InstallationPickerSheetState();
}

class _InstallationPickerSheetState extends State<InstallationPickerSheet> {
  String _query = '';

  @override
  Widget build(BuildContext context) {
    final filtered = _query.isEmpty
        ? widget.locations
        : widget.locations
            .where((l) => l.name.toLowerCase().contains(_query.toLowerCase()))
            .toList();

    return DraggableScrollableSheet(
      initialChildSize: 0.7,
      minChildSize: 0.4,
      maxChildSize: 0.92,
      expand: false,
      builder: (context, scrollController) {
        return Container(
          decoration: const BoxDecoration(
            color: BrandPalette.surface,
            borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
            border: Border(
              top: BorderSide(color: BrandPalette.border),
              left: BorderSide(color: BrandPalette.border),
              right: BorderSide(color: BrandPalette.border),
            ),
          ),
          child: Column(
            children: [
              const SizedBox(height: 8),
              Container(
                width: 36,
                height: 4,
                decoration: BoxDecoration(
                  color: BrandPalette.border,
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(20, 12, 16, 12),
                child: Row(
                  children: [
                    const Expanded(
                      child: Text(
                        'Where do you want to charge?',
                        style: TextStyle(
                          color: Colors.white,
                          fontSize: 15,
                          fontWeight: FontWeight.w700,
                          letterSpacing: -0.1,
                        ),
                      ),
                    ),
                    IconButton(
                      onPressed: () => Navigator.of(context).pop(),
                      icon: const Icon(
                        Icons.close_rounded,
                        color: BrandPalette.muted,
                        size: 22,
                      ),
                    ),
                  ],
                ),
              ),
              Container(height: 1, color: BrandPalette.border),
              Expanded(
                child: ListView(
                  controller: scrollController,
                  padding: const EdgeInsets.only(bottom: 16),
                  children: [
                    if (widget.bleNearby != null) ...[
                      const _SheetSectionLabel(label: 'Right here'),
                      _SheetRow(
                        iconData: Icons.bluetooth_searching_rounded,
                        iconColor: BrandPalette.mint,
                        title: widget.bleNearby!.charger.displayName,
                        subtitle:
                            '${widget.bleNearby!.charger.locationName} · BLE',
                        statsHighlight: 'Tap to start',
                        statsColor: BrandPalette.mint,
                        onTap: () {
                          Navigator.of(context).pop();
                          widget.onTapBle();
                        },
                      ),
                    ],
                    _SheetSectionLabel(
                      label: filtered.length == widget.locations.length
                          ? 'All locations (${widget.locations.length})'
                          : 'Matching (${filtered.length})',
                    ),
                    if (filtered.isEmpty)
                      const Padding(
                        padding:
                            EdgeInsets.symmetric(horizontal: 20, vertical: 24),
                        child: Text(
                          'No locations match.',
                          style: TextStyle(
                            color: BrandPalette.muted,
                            fontSize: 13,
                          ),
                        ),
                      )
                    else
                      for (final loc in filtered)
                        _SheetRow(
                          iconData: Icons.place_rounded,
                          iconColor: loc.offline == loc.total
                              ? BrandPalette.danger
                              : BrandPalette.blue,
                          title: loc.name,
                          subtitle: loc.busy > 0
                              ? '${loc.busy} in use · ${loc.total} total'
                              : '${loc.total} chargers',
                          statsHighlight: loc.offline == loc.total
                              ? '0 free'
                              : '${loc.available} free',
                          statsSecondary: '/ ${loc.total}',
                          statsColor: loc.offline == loc.total
                              ? BrandPalette.danger
                              : (loc.available > 0
                                  ? BrandPalette.mint
                                  : BrandPalette.amber),
                          isSelected: widget.selectedLocation == loc.name,
                          onTap: () {
                            Navigator.of(context).pop();
                            widget.onSelect(loc.name);
                          },
                        ),
                    if (widget.selectedLocation != null) ...[
                      const SizedBox(height: 4),
                      _SheetRow(
                        iconData: Icons.grid_view_rounded,
                        iconColor: BrandPalette.muted,
                        title: 'Show all locations',
                        subtitle: 'Group by installation',
                        statsHighlight: '',
                        onTap: () {
                          Navigator.of(context).pop();
                          widget.onSelect(null);
                        },
                      ),
                    ],
                  ],
                ),
              ),
              Container(height: 1, color: BrandPalette.border),
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 10, 16, 14),
                child: TextField(
                  onChanged: (v) => setState(() => _query = v),
                  style: const TextStyle(color: Colors.white, fontSize: 13),
                  decoration: InputDecoration(
                    hintText: 'Search locations…',
                    hintStyle: const TextStyle(
                      color: BrandPalette.muted,
                      fontSize: 13,
                    ),
                    prefixIcon: const Icon(
                      Icons.search_rounded,
                      color: BrandPalette.muted,
                      size: 18,
                    ),
                    isDense: true,
                    contentPadding:
                        const EdgeInsets.symmetric(vertical: 10, horizontal: 12),
                  ),
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}

class _SheetSectionLabel extends StatelessWidget {
  const _SheetSectionLabel({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 14, 20, 6),
      child: Text(
        label.toUpperCase(),
        style: const TextStyle(
          color: BrandPalette.muted,
          fontSize: 10,
          fontWeight: FontWeight.w700,
          letterSpacing: 1.2,
        ),
      ),
    );
  }
}

class _SheetRow extends StatelessWidget {
  const _SheetRow({
    required this.iconData,
    required this.iconColor,
    required this.title,
    required this.subtitle,
    required this.statsHighlight,
    this.statsSecondary,
    this.statsColor,
    this.isSelected = false,
    required this.onTap,
  });

  final IconData iconData;
  final Color iconColor;
  final String title;
  final String subtitle;
  final String statsHighlight;
  final String? statsSecondary;
  final Color? statsColor;
  final bool isSelected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
        decoration: BoxDecoration(
          color: isSelected
              ? BrandPalette.blue.withValues(alpha: 0.06)
              : Colors.transparent,
          border: const Border(
            bottom: BorderSide(color: BrandPalette.border, width: 0.5),
          ),
        ),
        child: Row(
          children: [
            Container(
              width: 36,
              height: 36,
              decoration: BoxDecoration(
                color: iconColor.withValues(alpha: 0.15),
                borderRadius: BorderRadius.circular(10),
              ),
              child: Icon(iconData, color: iconColor, size: 18),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    title,
                    style: TextStyle(
                      color: Colors.white,
                      fontSize: 14,
                      fontWeight: isSelected ? FontWeight.w700 : FontWeight.w500,
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                  const SizedBox(height: 2),
                  Text(
                    subtitle,
                    style: const TextStyle(
                      color: BrandPalette.muted,
                      fontSize: 11,
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
              ),
            ),
            if (statsHighlight.isNotEmpty)
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    statsHighlight,
                    style: TextStyle(
                      color: statsColor ?? Colors.white,
                      fontSize: 12,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  if (statsSecondary != null)
                    Text(
                      statsSecondary!,
                      style: const TextStyle(
                        color: BrandPalette.muted,
                        fontSize: 11,
                      ),
                    ),
                ],
              ),
          ],
        ),
      ),
    );
  }
}
