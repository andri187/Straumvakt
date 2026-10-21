import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../theme/palette.dart';
import 'number_plate.dart';

class MyVehicleScreen extends StatefulWidget {
  const MyVehicleScreen({super.key, this.showBackButton = true});

  final bool showBackButton;

  @override
  State<MyVehicleScreen> createState() => _MyVehicleScreenState();
}

class _MyVehicleScreenState extends State<MyVehicleScreen> {
  _VehicleDefinition _vehicle = _vehicleDefinitions.first;
  _VehiclePaint _paint = _paintChoices.first;
  _PaintFinish _paintFinish = _PaintFinish.highGloss;
  String _plate = 'N1 742';
  String _nickname = 'Daily car';
  bool _isPrimary = true;
  bool _autochargeReady = false;

  Future<void> _editVehicle() async {
    final result = await showModalBottomSheet<_VehicleEditResult>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: Colors.transparent,
      builder: (context) => _EditVehicleSheet(
        vehicle: _vehicle,
        paint: _paint,
        paintFinish: _paintFinish,
        plate: _plate,
        nickname: _nickname,
      ),
    );
    if (result == null || !mounted) return;
    setState(() {
      _vehicle = result.vehicle;
      _paint = result.paint;
      _paintFinish = result.paintFinish;
      _plate = result.plate;
      _nickname = result.nickname;
    });
  }

  Future<void> _showAutocharge() async {
    final enabled = await showModalBottomSheet<bool>(
      context: context,
      useSafeArea: true,
      backgroundColor: Colors.transparent,
      builder: (context) => _AutochargeSheet(isReady: _autochargeReady),
    );
    if (enabled == true && mounted) {
      setState(() => _autochargeReady = true);
    }
  }

  void _showLastSession() {
    showModalBottomSheet<void>(
      context: context,
      useSafeArea: true,
      backgroundColor: Colors.transparent,
      builder: (context) => const _SessionSheet(),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: CustomScrollView(
        slivers: [
          SliverAppBar(
            pinned: true,
            elevation: 0,
            scrolledUnderElevation: 0,
            backgroundColor: BrandPalette.midnight,
            foregroundColor: Colors.white,
            leading: widget.showBackButton
                ? IconButton(
                    tooltip: 'Back',
                    icon: const Icon(Icons.arrow_back_rounded),
                    onPressed: () => Navigator.of(context).maybePop(),
                  )
                : const Icon(
                    Icons.directions_car_rounded,
                    color: BrandPalette.cyan,
                  ),
            title: const Text(
              'My vehicle',
              style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800),
            ),
            actions: [
              IconButton(
                key: const Key('edit-vehicle-button'),
                tooltip: 'Edit vehicle',
                icon: const Icon(Icons.edit_outlined),
                onPressed: _editVehicle,
              ),
              const SizedBox(width: 8),
            ],
          ),
          SliverToBoxAdapter(
            child: _VehicleHero(
              vehicle: _vehicle,
              paint: _paint,
              paintFinish: _paintFinish,
              plate: _plate,
              nickname: _nickname,
              isPrimary: _isPrimary,
            ),
          ),
          SliverPadding(
            padding: const EdgeInsets.fromLTRB(16, 18, 16, 28),
            sliver: SliverList.list(
              children: [
                Row(
                  children: [
                    Expanded(
                      child: _SpecTile(
                        icon: Icons.battery_charging_full_rounded,
                        value: _vehicle.batteryCapacity,
                        label: 'Battery',
                        accent: BrandPalette.mint,
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: _SpecTile(
                        icon: Icons.route_rounded,
                        value: _vehicle.estimatedRange,
                        label: 'Est. range',
                        accent: BrandPalette.cyan,
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: _SpecTile(
                        icon: Icons.bolt_rounded,
                        value: _vehicle.dcCharge,
                        label: 'DC peak',
                        accent: BrandPalette.amber,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 24),
                const _SectionTitle('Charging identity'),
                _InfoPanel(
                  children: [
                    _InfoRow(
                      key: const Key('autocharge-row'),
                      icon: Icons.ev_station_rounded,
                      title: 'Autocharge',
                      subtitle: _autochargeReady
                          ? 'Vehicle identity enrolled'
                          : 'Not set up for this vehicle',
                      trailing: _StatusPill(
                        label: _autochargeReady ? 'Ready' : 'Not set up',
                        color: _autochargeReady
                            ? BrandPalette.mint
                            : BrandPalette.amber,
                      ),
                      onTap: _showAutocharge,
                    ),
                    _InfoRow(
                      icon: Icons.key_rounded,
                      title: 'Vehicle identifier',
                      subtitle: _autochargeReady
                          ? _maskedVehicleId(_plate)
                          : 'None',
                    ),
                  ],
                ),
                const SizedBox(height: 24),
                const _SectionTitle('Vehicle details'),
                _InfoPanel(
                  children: [
                    _InfoRow(
                      icon: Icons.pin_rounded,
                      title: 'Registration',
                      subtitle: _plate,
                    ),
                    _InfoRow(
                      icon: Icons.calendar_month_rounded,
                      title: 'Model year',
                      subtitle: _vehicle.year,
                    ),
                    _InfoRow(
                      icon: Icons.speed_rounded,
                      title: 'Charging',
                      subtitle:
                          '${_vehicle.acCharge} AC | ${_vehicle.dcCharge} DC',
                    ),
                    _InfoRow(
                      icon: Icons.palette_outlined,
                      title: 'Paint',
                      subtitle:
                          '${_paint.name} | ${_paint.code} | ${_paintFinish.label}',
                      trailing: _PaintDot(
                        color: _paint.color,
                        showFinishIndicator: _paintFinish.requiresMaterial,
                      ),
                    ),
                    _InfoRow(
                      icon: Icons.person_outline_rounded,
                      title: 'Use',
                      subtitle: 'Personal vehicle',
                    ),
                  ],
                ),
                const SizedBox(height: 24),
                const _SectionTitle('Preferences'),
                _InfoPanel(
                  children: [
                    _InfoRow(
                      icon: Icons.star_rounded,
                      title: 'Primary vehicle',
                      subtitle: 'Selected automatically when charging',
                      trailing: Switch.adaptive(
                        key: const Key('primary-vehicle-switch'),
                        value: _isPrimary,
                        activeTrackColor: BrandPalette.mint,
                        onChanged: (value) =>
                            setState(() => _isPrimary = value),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 24),
                const _SectionTitle('Recent charging'),
                _InfoPanel(
                  children: [
                    _InfoRow(
                      key: const Key('last-session-row'),
                      icon: Icons.history_rounded,
                      title: 'Home | Garage',
                      subtitle: 'Yesterday, 18:42 | 24.8 kWh',
                      trailing: const Column(
                        crossAxisAlignment: CrossAxisAlignment.end,
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Text(
                            '2,486 kr',
                            style: TextStyle(
                              color: Colors.white,
                              fontSize: 14,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                          SizedBox(height: 2),
                          Icon(
                            Icons.chevron_right_rounded,
                            color: BrandPalette.muted,
                            size: 18,
                          ),
                        ],
                      ),
                      onTap: _showLastSession,
                    ),
                  ],
                ),
                const SizedBox(height: 20),
                SizedBox(
                  width: double.infinity,
                  child: OutlinedButton.icon(
                    key: const Key('edit-details-button'),
                    onPressed: _editVehicle,
                    icon: const Icon(Icons.edit_outlined),
                    label: const Text('Edit vehicle details'),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: Colors.white,
                      side: const BorderSide(color: BrandPalette.border),
                      padding: const EdgeInsets.symmetric(vertical: 14),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(8),
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _VehicleHero extends StatelessWidget {
  const _VehicleHero({
    required this.vehicle,
    required this.paint,
    required this.paintFinish,
    required this.plate,
    required this.nickname,
    required this.isPrimary,
  });

  final _VehicleDefinition vehicle;
  final _VehiclePaint paint;
  final _PaintFinish paintFinish;
  final String plate;
  final String nickname;
  final bool isPrimary;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        SizedBox(
          height: 228,
          child: Stack(
            children: [
              Positioned.fill(
                child: AnimatedSwitcher(
                  duration: const Duration(milliseconds: 260),
                  child: _PaintedVehicleImage(
                    key: ValueKey('${vehicle.assetPath}-${paint.id}'),
                    vehicle: vehicle,
                    paint: paint,
                  ),
                ),
              ),
              if (!paint.isOriginal)
                Positioned.fill(
                  child: IgnorePointer(
                    child: _VehiclePlateSurface(vehicle: vehicle),
                  ),
                ),
              Positioned.fill(
                child: IgnorePointer(
                  child: _VehiclePlateText(
                    key: const Key('vehicle-image-plate'),
                    vehicle: vehicle,
                    plate: plate,
                  ),
                ),
              ),
              if (isPrimary)
                const Positioned(top: 14, left: 16, child: _PrimaryBadge()),
            ],
          ),
        ),
        Container(
          color: BrandPalette.deepNavy,
          padding: const EdgeInsets.fromLTRB(18, 16, 18, 18),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      '${vehicle.make} ${vehicle.model}',
                      key: const Key('vehicle-name'),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 25,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      '$nickname | ${paint.name} | ${paintFinish.label}',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: BrandPalette.muted,
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 12),
              NumberPlate(value: plate),
            ],
          ),
        ),
      ],
    );
  }
}

class _PaintedVehicleImage extends StatelessWidget {
  const _PaintedVehicleImage({
    super.key,
    required this.vehicle,
    required this.paint,
  });

  final _VehicleDefinition vehicle;
  final _VehiclePaint paint;

  @override
  Widget build(BuildContext context) {
    final image = Image.asset(
      vehicle.assetPath,
      fit: BoxFit.contain,
      alignment: Alignment.center,
      filterQuality: FilterQuality.high,
      errorBuilder: (context, error, stackTrace) => const Center(
        child: Icon(
          Icons.directions_car_rounded,
          size: 72,
          color: BrandPalette.border,
        ),
      ),
    );
    if (paint.isOriginal) return image;
    return ColorFiltered(
      colorFilter: ColorFilter.matrix(
        _hueRotationMatrix(paint.hueShiftRadians),
      ),
      child: image,
    );
  }
}

class _VehiclePlateSurface extends StatelessWidget {
  const _VehiclePlateSurface({required this.vehicle});

  final _VehicleDefinition vehicle;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final canvasSize = Size(constraints.maxWidth, constraints.maxHeight);
        final fitted = applyBoxFit(
          BoxFit.contain,
          vehicle.sourceSize,
          canvasSize,
        );
        final imageRect = Alignment.center.inscribe(
          fitted.destination,
          Offset.zero & canvasSize,
        );
        final placement = vehicle.platePlacement;
        final plateRect = Rect.fromLTWH(
          imageRect.left + placement.rect.left * imageRect.width,
          imageRect.top + placement.rect.top * imageRect.height,
          placement.rect.width * imageRect.width,
          placement.rect.height * imageRect.height,
        );
        return ClipRect(
          clipper: _PlateRectClipper(plateRect),
          child: Image.asset(
            vehicle.assetPath,
            fit: BoxFit.contain,
            alignment: Alignment.center,
            filterQuality: FilterQuality.high,
          ),
        );
      },
    );
  }
}

class _PlateRectClipper extends CustomClipper<Rect> {
  const _PlateRectClipper(this.rect);

  final Rect rect;

  @override
  Rect getClip(Size size) => rect;

  @override
  bool shouldReclip(covariant _PlateRectClipper oldClipper) {
    return oldClipper.rect != rect;
  }
}

class _VehiclePlateText extends StatelessWidget {
  const _VehiclePlateText({
    super.key,
    required this.vehicle,
    required this.plate,
  });

  final _VehicleDefinition vehicle;
  final String plate;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final canvasSize = Size(constraints.maxWidth, constraints.maxHeight);
        final fitted = applyBoxFit(
          BoxFit.contain,
          vehicle.sourceSize,
          canvasSize,
        );
        final imageRect = Alignment.center.inscribe(
          fitted.destination,
          Offset.zero & canvasSize,
        );
        final placement = vehicle.platePlacement;
        final plateRect = Rect.fromLTWH(
          imageRect.left + placement.rect.left * imageRect.width,
          imageRect.top + placement.rect.top * imageRect.height,
          placement.rect.width * imageRect.width,
          placement.rect.height * imageRect.height,
        );
        final compact = plate.replaceAll(' ', '');
        final first = compact.length >= 2 ? compact.substring(0, 2) : compact;
        final second = compact.length > 2 ? compact.substring(2) : '';

        return Stack(
          children: [
            Positioned.fromRect(
              rect: plateRect,
              child: Transform.rotate(
                angle: placement.rotationRadians,
                child: _PlateCharacters(first: first, second: second),
              ),
            ),
          ],
        );
      },
    );
  }
}

class _PlateCharacters extends StatelessWidget {
  const _PlateCharacters({required this.first, required this.second});

  final String first;
  final String second;

  @override
  Widget build(BuildContext context) {
    const style = TextStyle(
      color: Color(0xFF1565C0),
      fontWeight: FontWeight.w900,
      height: 0.9,
      letterSpacing: 0,
      shadows: [Shadow(color: Color(0x33000000), blurRadius: 0.4)],
    );
    return Stack(
      children: [
        Positioned(
          left: 0,
          top: 0,
          right: 0,
          bottom: 0,
          child: LayoutBuilder(
            builder: (context, constraints) {
              return Stack(
                children: [
                  Positioned(
                    left: constraints.maxWidth * 0.18,
                    top: constraints.maxHeight * 0.11,
                    width: constraints.maxWidth * 0.28,
                    height: constraints.maxHeight * 0.75,
                    child: FittedBox(
                      fit: BoxFit.fill,
                      child: Text(first, style: style),
                    ),
                  ),
                  Positioned(
                    left: constraints.maxWidth * 0.60,
                    top: constraints.maxHeight * 0.11,
                    width: constraints.maxWidth * 0.34,
                    height: constraints.maxHeight * 0.75,
                    child: FittedBox(
                      fit: BoxFit.fill,
                      child: Text(second, style: style),
                    ),
                  ),
                ],
              );
            },
          ),
        ),
      ],
    );
  }
}

class _PrimaryBadge extends StatelessWidget {
  const _PrimaryBadge();

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 6),
      decoration: BoxDecoration(
        color: BrandPalette.midnight.withValues(alpha: 0.88),
        borderRadius: BorderRadius.circular(6),
        border: Border.all(color: BrandPalette.mint),
      ),
      child: const Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.star_rounded, color: BrandPalette.mint, size: 14),
          SizedBox(width: 5),
          Text(
            'Primary',
            style: TextStyle(
              color: Colors.white,
              fontSize: 11,
              fontWeight: FontWeight.w800,
            ),
          ),
        ],
      ),
    );
  }
}

class _SpecTile extends StatelessWidget {
  const _SpecTile({
    required this.icon,
    required this.value,
    required this.label,
    required this.accent,
  });

  final IconData icon;
  final String value;
  final String label;
  final Color accent;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 96,
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 12),
      decoration: BoxDecoration(
        color: BrandPalette.surface,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: BrandPalette.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Icon(icon, color: accent, size: 20),
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              FittedBox(
                fit: BoxFit.scaleDown,
                alignment: Alignment.centerLeft,
                child: Text(
                  value,
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 16,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ),
              const SizedBox(height: 2),
              Text(
                label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  color: BrandPalette.muted,
                  fontSize: 10,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _SectionTitle extends StatelessWidget {
  const _SectionTitle(this.label);

  final String label;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(left: 2, bottom: 8),
      child: Text(
        label,
        style: const TextStyle(
          color: Colors.white,
          fontSize: 15,
          fontWeight: FontWeight.w800,
        ),
      ),
    );
  }
}

class _InfoPanel extends StatelessWidget {
  const _InfoPanel({required this.children});

  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: BrandPalette.surface,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: BrandPalette.border),
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        children: [
          for (var index = 0; index < children.length; index++) ...[
            children[index],
            if (index != children.length - 1)
              const Divider(height: 1, color: BrandPalette.border),
          ],
        ],
      ),
    );
  }
}

class _InfoRow extends StatelessWidget {
  const _InfoRow({
    super.key,
    required this.icon,
    required this.title,
    required this.subtitle,
    this.trailing,
    this.onTap,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final Widget? trailing;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      child: ConstrainedBox(
        constraints: const BoxConstraints(minHeight: 68),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
          child: Row(
            children: [
              SizedBox(
                width: 28,
                child: Icon(icon, color: BrandPalette.cyan, size: 20),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Text(
                      title,
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 14,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      subtitle,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: BrandPalette.muted,
                        fontSize: 11,
                        height: 1.25,
                      ),
                    ),
                  ],
                ),
              ),
              if (trailing != null) ...[
                const SizedBox(width: 10),
                trailing!,
              ] else if (onTap != null) ...[
                const SizedBox(width: 8),
                const Icon(
                  Icons.chevron_right_rounded,
                  color: BrandPalette.muted,
                  size: 20,
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

class _StatusPill extends StatelessWidget {
  const _StatusPill({required this.label, required this.color});

  final String label;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(6),
        border: Border.all(color: color.withValues(alpha: 0.65)),
      ),
      child: Text(
        label,
        style: TextStyle(
          color: color,
          fontSize: 10,
          fontWeight: FontWeight.w800,
        ),
      ),
    );
  }
}

class _PaintDot extends StatelessWidget {
  const _PaintDot({required this.color, this.showFinishIndicator = false});

  final Color color;
  final bool showFinishIndicator;

  @override
  Widget build(BuildContext context) {
    return Stack(
      clipBehavior: Clip.none,
      children: [
        Container(
          width: 24,
          height: 24,
          decoration: BoxDecoration(
            color: color,
            shape: BoxShape.circle,
            border: Border.all(color: Colors.white.withValues(alpha: 0.72)),
          ),
        ),
        if (showFinishIndicator)
          const Positioned(
            right: -5,
            bottom: -5,
            child: Icon(Icons.auto_awesome, color: Colors.white, size: 13),
          ),
      ],
    );
  }
}

class _PaintPaletteSheet extends StatefulWidget {
  const _PaintPaletteSheet({required this.paint, required this.finish});

  final _VehiclePaint paint;
  final _PaintFinish finish;

  @override
  State<_PaintPaletteSheet> createState() => _PaintPaletteSheetState();
}

class _PaintPaletteSheetState extends State<_PaintPaletteSheet> {
  late _VehiclePaint _paint = widget.paint;
  late _PaintFinish _finish = widget.finish;
  final _searchController = TextEditingController();
  String _family = 'All';

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  List<_VehiclePaint> get _filteredPaints {
    final query = _searchController.text.trim().toLowerCase();
    return _paintChoices.where((paint) {
      final familyMatches = _family == 'All' || paint.family == _family;
      final queryMatches =
          query.isEmpty ||
          paint.name.toLowerCase().contains(query) ||
          paint.code.toLowerCase().contains(query) ||
          paint.system.toLowerCase().contains(query);
      return familyMatches && queryMatches;
    }).toList();
  }

  @override
  Widget build(BuildContext context) {
    final paints = _filteredPaints;
    return FractionallySizedBox(
      heightFactor: 0.94,
      child: Container(
        decoration: const BoxDecoration(
          color: BrandPalette.deepNavy,
          borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
          border: Border(top: BorderSide(color: BrandPalette.border)),
        ),
        child: Column(
          children: [
            const SizedBox(height: 10),
            const _SheetHandle(),
            Padding(
              padding: const EdgeInsets.fromLTRB(18, 14, 10, 10),
              child: Row(
                children: [
                  const Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Vehicle paint',
                          style: TextStyle(
                            color: Colors.white,
                            fontSize: 20,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                        SizedBox(height: 2),
                        Text(
                          'RAL display approximations',
                          style: TextStyle(
                            color: BrandPalette.muted,
                            fontSize: 11,
                          ),
                        ),
                      ],
                    ),
                  ),
                  IconButton(
                    tooltip: 'Close',
                    onPressed: () => Navigator.of(context).pop(),
                    icon: const Icon(Icons.close_rounded),
                  ),
                ],
              ),
            ),
            Expanded(
              child: ListView(
                key: const Key('paint-palette-scroll'),
                padding: const EdgeInsets.fromLTRB(18, 0, 18, 24),
                children: [
                  TextField(
                    key: const Key('paint-search-field'),
                    controller: _searchController,
                    onChanged: (_) => setState(() {}),
                    decoration: const InputDecoration(
                      hintText: 'Search name or RAL code',
                      prefixIcon: Icon(Icons.search_rounded),
                    ),
                  ),
                  const SizedBox(height: 12),
                  SizedBox(
                    height: 38,
                    child: ListView.separated(
                      scrollDirection: Axis.horizontal,
                      itemCount: _paintFamilies.length,
                      separatorBuilder: (context, index) =>
                          const SizedBox(width: 7),
                      itemBuilder: (context, index) {
                        final family = _paintFamilies[index];
                        return FilterChip(
                          key: Key('paint-family-$family'),
                          selected: _family == family,
                          label: Text(family),
                          onSelected: (_) => setState(() => _family = family),
                        );
                      },
                    ),
                  ),
                  const SizedBox(height: 16),
                  GridView.builder(
                    shrinkWrap: true,
                    physics: const NeverScrollableScrollPhysics(),
                    gridDelegate:
                        const SliverGridDelegateWithFixedCrossAxisCount(
                          crossAxisCount: 4,
                          mainAxisSpacing: 9,
                          crossAxisSpacing: 9,
                          childAspectRatio: 0.92,
                        ),
                    itemCount: paints.length,
                    itemBuilder: (context, index) {
                      final paint = paints[index];
                      final selected = paint == _paint;
                      return InkWell(
                        key: Key('paint-${paint.id}'),
                        onTap: () => setState(() => _paint = paint),
                        borderRadius: BorderRadius.circular(8),
                        child: Container(
                          padding: const EdgeInsets.all(6),
                          decoration: BoxDecoration(
                            color: selected
                                ? Colors.white.withValues(alpha: 0.09)
                                : BrandPalette.surface,
                            borderRadius: BorderRadius.circular(8),
                            border: Border.all(
                              color: selected
                                  ? BrandPalette.cyan
                                  : BrandPalette.border,
                              width: selected ? 2 : 1,
                            ),
                          ),
                          child: Column(
                            children: [
                              Expanded(
                                child: Container(
                                  decoration: BoxDecoration(
                                    color: paint.color,
                                    borderRadius: BorderRadius.circular(5),
                                    border: Border.all(
                                      color: Colors.white.withValues(
                                        alpha: 0.34,
                                      ),
                                    ),
                                  ),
                                  child: selected
                                      ? const Center(
                                          child: Icon(
                                            Icons.check_rounded,
                                            color: Colors.white,
                                          ),
                                        )
                                      : null,
                                ),
                              ),
                              const SizedBox(height: 5),
                              Text(
                                paint.code,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(
                                  color: Colors.white,
                                  fontSize: 9,
                                  fontWeight: FontWeight.w700,
                                ),
                              ),
                            ],
                          ),
                        ),
                      );
                    },
                  ),
                  if (paints.isEmpty)
                    const Padding(
                      padding: EdgeInsets.symmetric(vertical: 28),
                      child: Center(
                        child: Text(
                          'No colours match this search.',
                          style: TextStyle(color: BrandPalette.muted),
                        ),
                      ),
                    ),
                  const SizedBox(height: 18),
                  Container(
                    padding: const EdgeInsets.all(14),
                    decoration: BoxDecoration(
                      color: BrandPalette.surface,
                      borderRadius: BorderRadius.circular(8),
                      border: Border.all(color: BrandPalette.border),
                    ),
                    child: Row(
                      children: [
                        _PaintDot(
                          color: _paint.color,
                          showFinishIndicator: _finish.requiresMaterial,
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                _paint.name,
                                style: const TextStyle(
                                  color: Colors.white,
                                  fontWeight: FontWeight.w800,
                                ),
                              ),
                              Text(
                                '${_paint.system} | ${_paint.code} | ${_paint.hex}',
                                style: const TextStyle(
                                  color: BrandPalette.muted,
                                  fontSize: 10,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 18),
                  const Text(
                    'Paint finish',
                    style: TextStyle(
                      color: Colors.white,
                      fontSize: 13,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  const SizedBox(height: 8),
                  Wrap(
                    spacing: 7,
                    runSpacing: 7,
                    children: [
                      for (final finish in _PaintFinish.values)
                        ChoiceChip(
                          key: Key('paint-finish-${finish.name}'),
                          selected: _finish == finish,
                          label: Text(finish.label),
                          avatar: finish.requiresMaterial
                              ? const Icon(Icons.auto_awesome, size: 15)
                              : null,
                          onSelected: (_) => setState(() => _finish = finish),
                        ),
                    ],
                  ),
                  if (_finish.requiresMaterial) ...[
                    const SizedBox(height: 10),
                    const Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Icon(
                          Icons.auto_awesome,
                          size: 16,
                          color: BrandPalette.amber,
                        ),
                        SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            'This finish changes with light and cannot be represented accurately by a flat screen colour.',
                            style: TextStyle(
                              color: BrandPalette.muted,
                              fontSize: 11,
                              height: 1.35,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ],
                  const SizedBox(height: 18),
                  FilledButton.icon(
                    key: const Key('apply-paint-button'),
                    onPressed: () => Navigator.of(
                      context,
                    ).pop(_PaintSelection(paint: _paint, finish: _finish)),
                    icon: const Icon(Icons.check_rounded),
                    label: const Text('Apply paint'),
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

class _EditVehicleSheet extends StatefulWidget {
  const _EditVehicleSheet({
    required this.vehicle,
    required this.paint,
    required this.paintFinish,
    required this.plate,
    required this.nickname,
  });

  final _VehicleDefinition vehicle;
  final _VehiclePaint paint;
  final _PaintFinish paintFinish;
  final String plate;
  final String nickname;

  @override
  State<_EditVehicleSheet> createState() => _EditVehicleSheetState();
}

class _EditVehicleSheetState extends State<_EditVehicleSheet> {
  late _VehicleDefinition _vehicle = widget.vehicle;
  late _VehiclePaint _paint = widget.paint;
  late _PaintFinish _paintFinish = widget.paintFinish;
  late String _type = widget.vehicle.type;
  late final TextEditingController _plateController = TextEditingController(
    text: widget.plate,
  );
  late final TextEditingController _nicknameController = TextEditingController(
    text: widget.nickname,
  );

  @override
  void dispose() {
    _plateController.dispose();
    _nicknameController.dispose();
    super.dispose();
  }

  void _save() {
    final normalizedPlate = _normalizePlate(_plateController.text);
    if (normalizedPlate.length < 5) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Enter a valid registration number.')),
      );
      return;
    }
    Navigator.of(context).pop(
      _VehicleEditResult(
        vehicle: _vehicle,
        paint: _paint,
        paintFinish: _paintFinish,
        plate: normalizedPlate,
        nickname: _nicknameController.text.trim().isEmpty
            ? 'My vehicle'
            : _nicknameController.text.trim(),
      ),
    );
  }

  Future<void> _choosePaint() async {
    final result = await showModalBottomSheet<_PaintSelection>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: Colors.transparent,
      builder: (context) =>
          _PaintPaletteSheet(paint: _paint, finish: _paintFinish),
    );
    if (result == null || !mounted) return;
    setState(() {
      _paint = result.paint;
      _paintFinish = result.finish;
    });
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(
        color: BrandPalette.deepNavy,
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
        border: Border(top: BorderSide(color: BrandPalette.border)),
      ),
      padding: EdgeInsets.fromLTRB(
        20,
        10,
        20,
        20 + MediaQuery.viewInsetsOf(context).bottom,
      ),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const _SheetHandle(),
            const SizedBox(height: 8),
            const Text(
              'Edit vehicle',
              style: TextStyle(
                color: Colors.white,
                fontSize: 21,
                fontWeight: FontWeight.w900,
              ),
            ),
            const SizedBox(height: 18),
            DropdownButtonFormField<String>(
              key: const Key('vehicle-type-field'),
              initialValue: _type,
              dropdownColor: BrandPalette.surface,
              decoration: const InputDecoration(
                labelText: 'Type',
                prefixIcon: Icon(Icons.factory_outlined),
              ),
              items: _vehicleTypes
                  .map(
                    (type) => DropdownMenuItem(
                      value: type,
                      child: Text(_titleCase(type)),
                    ),
                  )
                  .toList(),
              onChanged: (type) {
                if (type == null) return;
                setState(() {
                  _type = type;
                  _vehicle = _vehicleDefinitions.firstWhere(
                    (vehicle) => vehicle.type == type,
                  );
                });
              },
            ),
            const SizedBox(height: 12),
            DropdownButtonFormField<_VehicleDefinition>(
              key: ValueKey('vehicle-subtype-field-$_type'),
              initialValue: _vehicle,
              dropdownColor: BrandPalette.surface,
              decoration: const InputDecoration(
                labelText: 'Subtype',
                prefixIcon: Icon(Icons.directions_car_outlined),
              ),
              items: _vehicleDefinitions
                  .where((vehicle) => vehicle.type == _type)
                  .map(
                    (vehicle) => DropdownMenuItem(
                      value: vehicle,
                      child: Text(vehicle.model),
                    ),
                  )
                  .toList(),
              onChanged: (vehicle) {
                if (vehicle != null) setState(() => _vehicle = vehicle);
              },
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 6, 4, 2),
              child: Text(
                '${_formatCount(_vehicle.sourceCount)} vehicles in traffic',
                style: const TextStyle(color: BrandPalette.muted, fontSize: 11),
              ),
            ),
            const SizedBox(height: 14),
            TextField(
              key: const Key('vehicle-plate-field'),
              controller: _plateController,
              textCapitalization: TextCapitalization.characters,
              maxLength: 6,
              decoration: const InputDecoration(
                labelText: 'Registration',
                prefixIcon: Icon(Icons.pin_outlined),
                counterText: '',
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              key: const Key('vehicle-nickname-field'),
              controller: _nicknameController,
              maxLength: 24,
              decoration: const InputDecoration(
                labelText: 'Nickname',
                prefixIcon: Icon(Icons.label_outline_rounded),
                counterText: '',
              ),
            ),
            const SizedBox(height: 18),
            InkWell(
              key: const Key('open-paint-palette'),
              onTap: _choosePaint,
              borderRadius: BorderRadius.circular(8),
              child: Container(
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: BrandPalette.surface,
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: BrandPalette.border),
                ),
                child: Row(
                  children: [
                    _PaintDot(
                      color: _paint.color,
                      showFinishIndicator: _paintFinish.requiresMaterial,
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            _paint.name,
                            key: const Key('selected-paint-name'),
                            style: const TextStyle(
                              color: Colors.white,
                              fontSize: 14,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                          const SizedBox(height: 3),
                          Text(
                            '${_paint.code} | ${_paintFinish.label}',
                            style: const TextStyle(
                              color: BrandPalette.muted,
                              fontSize: 11,
                            ),
                          ),
                        ],
                      ),
                    ),
                    const Icon(
                      Icons.chevron_right_rounded,
                      color: BrandPalette.muted,
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 22),
            FilledButton.icon(
              key: const Key('save-vehicle-button'),
              onPressed: _save,
              icon: const Icon(Icons.check_rounded),
              label: const Text('Save changes'),
            ),
          ],
        ),
      ),
    );
  }
}

class _AutochargeSheet extends StatelessWidget {
  const _AutochargeSheet({required this.isReady});

  final bool isReady;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(
        color: BrandPalette.deepNavy,
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
        border: Border(top: BorderSide(color: BrandPalette.border)),
      ),
      padding: const EdgeInsets.fromLTRB(20, 10, 20, 24),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const _SheetHandle(),
          const SizedBox(height: 10),
          Container(
            width: 48,
            height: 48,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: (isReady ? BrandPalette.mint : BrandPalette.amber)
                  .withValues(alpha: 0.12),
              shape: BoxShape.circle,
            ),
            child: Icon(
              isReady ? Icons.check_rounded : Icons.ev_station_rounded,
              color: isReady ? BrandPalette.mint : BrandPalette.amber,
              size: 26,
            ),
          ),
          const SizedBox(height: 14),
          Text(
            isReady ? 'Autocharge is ready' : 'Set up Autocharge',
            style: const TextStyle(
              color: Colors.white,
              fontSize: 21,
              fontWeight: FontWeight.w900,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            isReady
                ? 'This vehicle can be recognized at supported chargers.'
                : 'Enroll the vehicle charging identity for supported chargers.',
            style: const TextStyle(
              color: BrandPalette.muted,
              fontSize: 13,
              height: 1.4,
            ),
          ),
          const SizedBox(height: 20),
          FilledButton.icon(
            key: const Key('enable-autocharge-button'),
            onPressed: () => Navigator.of(context).pop(true),
            icon: Icon(isReady ? Icons.check_rounded : Icons.add_rounded),
            label: Text(isReady ? 'Done' : 'Enable Autocharge'),
          ),
          if (!isReady) ...[
            const SizedBox(height: 6),
            TextButton(
              onPressed: () => Navigator.of(context).pop(false),
              child: const Text('Not now'),
            ),
          ],
        ],
      ),
    );
  }
}

class _SessionSheet extends StatelessWidget {
  const _SessionSheet();

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(
        color: BrandPalette.deepNavy,
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
        border: Border(top: BorderSide(color: BrandPalette.border)),
      ),
      padding: const EdgeInsets.fromLTRB(20, 10, 20, 24),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const _SheetHandle(),
          const SizedBox(height: 8),
          const Text(
            'Last charging session',
            style: TextStyle(
              color: Colors.white,
              fontSize: 21,
              fontWeight: FontWeight.w900,
            ),
          ),
          const SizedBox(height: 4),
          const Text(
            'Home | Garage | Yesterday, 18:42',
            style: TextStyle(color: BrandPalette.muted, fontSize: 12),
          ),
          const SizedBox(height: 18),
          const _CostLine(label: 'Energy delivered', value: '24.8 kWh'),
          const _CostLine(label: 'Electricity', value: '2,188 kr'),
          const _CostLine(label: 'Plug-time fee', value: '298 kr'),
          const Divider(height: 24, color: BrandPalette.border),
          const _CostLine(label: 'Total', value: '2,486 kr', emphasized: true),
          const SizedBox(height: 18),
          FilledButton.icon(
            onPressed: () => Navigator.of(context).pop(),
            icon: const Icon(Icons.check_rounded),
            label: const Text('Done'),
          ),
        ],
      ),
    );
  }
}

class _CostLine extends StatelessWidget {
  const _CostLine({
    required this.label,
    required this.value,
    this.emphasized = false,
  });

  final String label;
  final String value;
  final bool emphasized;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        children: [
          Expanded(
            child: Text(
              label,
              style: TextStyle(
                color: emphasized ? Colors.white : BrandPalette.muted,
                fontSize: emphasized ? 15 : 13,
                fontWeight: emphasized ? FontWeight.w800 : FontWeight.w500,
              ),
            ),
          ),
          Text(
            value,
            style: TextStyle(
              color: emphasized ? BrandPalette.mint : Colors.white,
              fontSize: emphasized ? 17 : 13,
              fontWeight: FontWeight.w800,
            ),
          ),
        ],
      ),
    );
  }
}

class _SheetHandle extends StatelessWidget {
  const _SheetHandle();

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Container(
        width: 38,
        height: 4,
        decoration: BoxDecoration(
          color: BrandPalette.muted.withValues(alpha: 0.45),
          borderRadius: BorderRadius.circular(2),
        ),
      ),
    );
  }
}

class _VehicleEditResult {
  const _VehicleEditResult({
    required this.vehicle,
    required this.paint,
    required this.paintFinish,
    required this.plate,
    required this.nickname,
  });

  final _VehicleDefinition vehicle;
  final _VehiclePaint paint;
  final _PaintFinish paintFinish;
  final String plate;
  final String nickname;
}

class _PaintSelection {
  const _PaintSelection({required this.paint, required this.finish});

  final _VehiclePaint paint;
  final _PaintFinish finish;
}

class _VehicleDefinition {
  const _VehicleDefinition({
    required this.type,
    required this.make,
    required this.model,
    required this.trim,
    required this.year,
    required this.assetPath,
    required this.batteryCapacity,
    required this.estimatedRange,
    required this.acCharge,
    required this.dcCharge,
    required this.sourceCount,
    required this.sourceSize,
    required this.platePlacement,
  });

  final String type;
  final String make;
  final String model;
  final String trim;
  final String year;
  final String assetPath;
  final String batteryCapacity;
  final String estimatedRange;
  final String acCharge;
  final String dcCharge;
  final int sourceCount;
  final Size sourceSize;
  final _PlatePlacement platePlacement;
}

const _vehicleDefinitions = [
  _VehicleDefinition(
    type: 'TESLA',
    make: 'Tesla',
    model: 'Model Y',
    trim: 'Long Range AWD',
    year: '2023',
    assetPath: 'assets/images/vehicles/tesla_model_y_configurable.png',
    batteryCapacity: '75 kWh',
    estimatedRange: '418 km',
    acCharge: '11 kW',
    dcCharge: '250 kW',
    sourceCount: 7295,
    sourceSize: Size(1894, 830),
    platePlacement: _PlatePlacement(
      rect: Rect.fromLTWH(0.1008, 0.6410, 0.0987, 0.0711),
      rotationRadians: 0.043,
    ),
  ),
  _VehicleDefinition(
    type: 'TESLA',
    make: 'Tesla',
    model: 'Model 3',
    trim: 'Rear-Wheel Drive',
    year: '2023',
    assetPath: 'assets/images/vehicles/tesla_model_3_configurable.png',
    batteryCapacity: '58 kWh',
    estimatedRange: '423 km',
    acCharge: '11 kW',
    dcCharge: '170 kW',
    sourceCount: 2603,
    sourceSize: Size(1897, 829),
    platePlacement: _PlatePlacement(
      rect: Rect.fromLTWH(0.0675, 0.6622, 0.1081, 0.0748),
      rotationRadians: 0.049,
    ),
  ),
  _VehicleDefinition(
    type: 'NISSAN',
    make: 'Nissan',
    model: 'Leaf',
    trim: 'Electric',
    year: '2020',
    assetPath: 'assets/images/vehicles/nissan_leaf_configurable.png',
    batteryCapacity: '40-62 kWh',
    estimatedRange: '270 km',
    acCharge: '6.6 kW',
    dcCharge: '50 kW',
    sourceCount: 1990,
    sourceSize: Size(1890, 832),
    platePlacement: _PlatePlacement(
      rect: Rect.fromLTWH(0.1487, 0.6611, 0.1164, 0.0781),
      rotationRadians: 0.027,
    ),
  ),
  _VehicleDefinition(
    type: 'HYUNDAI',
    make: 'Hyundai',
    model: 'Kona',
    trim: 'Electric 64 kWh',
    year: '2021',
    assetPath: 'assets/images/vehicles/hyundai_kona_configurable.png',
    batteryCapacity: '64 kWh',
    estimatedRange: '484 km',
    acCharge: '11 kW',
    dcCharge: '77 kW',
    sourceCount: 1297,
    sourceSize: Size(1894, 830),
    platePlacement: _PlatePlacement(
      rect: Rect.fromLTWH(0.2138, 0.6373, 0.0993, 0.0639),
      rotationRadians: 0.016,
    ),
  ),
  _VehicleDefinition(
    type: 'NISSAN',
    make: 'Nissan',
    model: 'Leaf 40 kWh',
    trim: '40 kWh',
    year: '2020',
    assetPath: 'assets/images/vehicles/nissan_leaf_configurable.png',
    batteryCapacity: '40 kWh',
    estimatedRange: '270 km',
    acCharge: '6.6 kW',
    dcCharge: '50 kW',
    sourceCount: 1172,
    sourceSize: Size(1890, 832),
    platePlacement: _PlatePlacement(
      rect: Rect.fromLTWH(0.1487, 0.6611, 0.1164, 0.0781),
      rotationRadians: 0.027,
    ),
  ),
];

class _PlatePlacement {
  const _PlatePlacement({required this.rect, required this.rotationRadians});

  final Rect rect;
  final double rotationRadians;
}

class _VehiclePaint {
  const _VehiclePaint({
    required this.id,
    required this.name,
    required this.code,
    required this.system,
    required this.family,
    required this.color,
    this.isOriginal = false,
  });

  final String id;
  final String name;
  final String code;
  final String system;
  final String family;
  final Color color;
  final bool isOriginal;

  String get hex =>
      '#${color.toARGB32().toRadixString(16).substring(2).toUpperCase()}';

  double get hueShiftRadians {
    if (isOriginal) return 0;
    const sourceBlueHue = 196.0;
    final targetHue = HSVColor.fromColor(color).hue;
    var delta = targetHue - sourceBlueHue;
    if (delta > 180) delta -= 360;
    if (delta < -180) delta += 360;
    return delta * math.pi / 180;
  }
}

enum _PaintFinish {
  solid('Solid', false),
  metallic('Metallic', true),
  pearlescent('Pearlescent', true),
  matte('Matte', true),
  satin('Satin', true),
  highGloss('High gloss', false);

  const _PaintFinish(this.label, this.requiresMaterial);

  final String label;
  final bool requiresMaterial;
}

const _paintFamilies = [
  'All',
  'Neutral',
  'Red',
  'Orange',
  'Yellow',
  'Green',
  'Cyan',
  'Blue',
  'Violet',
];

const _paintChoices = [
  _VehiclePaint(
    id: 'ocean-blue',
    name: 'Ocean blue',
    code: 'RAL 240 50 40',
    system: 'RAL DESIGN SYSTEM plus',
    family: 'Blue',
    color: Color(0xFF178FC2),
    isOriginal: true,
  ),
  _VehiclePaint(
    id: 'crimson',
    name: 'Crimson red',
    code: 'RAL 020 40 50',
    system: 'RAL DESIGN SYSTEM plus',
    family: 'Red',
    color: Color(0xFFC73545),
  ),
  _VehiclePaint(
    id: 'forest',
    name: 'Forest green',
    code: 'RAL 160 40 30',
    system: 'RAL DESIGN SYSTEM plus',
    family: 'Green',
    color: Color(0xFF287A5B),
  ),
  _VehiclePaint(
    id: 'violet',
    name: 'Deep violet',
    code: 'RAL 290 40 40',
    system: 'RAL DESIGN SYSTEM plus',
    family: 'Violet',
    color: Color(0xFF7452C8),
  ),
  _VehiclePaint(
    id: 'copper',
    name: 'Copper',
    code: 'RAL 060-M',
    system: 'RAL EFFECT',
    family: 'Orange',
    color: Color(0xFFC8753D),
  ),
  _VehiclePaint(
    id: 'design-black',
    name: 'Ink black',
    code: 'RAL 000 15 00',
    system: 'RAL DESIGN SYSTEM plus',
    family: 'Neutral',
    color: Color(0xFF252526),
  ),
  _VehiclePaint(
    id: 'design-graphite',
    name: 'Graphite grey',
    code: 'RAL 000 30 00',
    system: 'RAL DESIGN SYSTEM plus',
    family: 'Neutral',
    color: Color(0xFF494A4B),
  ),
  _VehiclePaint(
    id: 'design-silver',
    name: 'Silver grey',
    code: 'RAL 000 70 00',
    system: 'RAL DESIGN SYSTEM plus',
    family: 'Neutral',
    color: Color(0xFFA9ABAA),
  ),
  _VehiclePaint(
    id: 'design-white',
    name: 'Polar white',
    code: 'RAL 000 90 00',
    system: 'RAL DESIGN SYSTEM plus',
    family: 'Neutral',
    color: Color(0xFFE3E5E2),
  ),
  _VehiclePaint(
    id: 'red-wine',
    name: 'Wine red',
    code: 'RAL 010 30 30',
    system: 'RAL DESIGN SYSTEM plus',
    family: 'Red',
    color: Color(0xFF712F3A),
  ),
  _VehiclePaint(
    id: 'red-coral',
    name: 'Coral red',
    code: 'RAL 030 50 60',
    system: 'RAL DESIGN SYSTEM plus',
    family: 'Red',
    color: Color(0xFFD34C3F),
  ),
  _VehiclePaint(
    id: 'red-rose',
    name: 'Rose red',
    code: 'RAL 350 50 50',
    system: 'RAL DESIGN SYSTEM plus',
    family: 'Red',
    color: Color(0xFFC94378),
  ),
  _VehiclePaint(
    id: 'orange-burnt',
    name: 'Burnt orange',
    code: 'RAL 050 40 50',
    system: 'RAL DESIGN SYSTEM plus',
    family: 'Orange',
    color: Color(0xFFB9562C),
  ),
  _VehiclePaint(
    id: 'orange-sunset',
    name: 'Sunset orange',
    code: 'RAL 060 60 70',
    system: 'RAL DESIGN SYSTEM plus',
    family: 'Orange',
    color: Color(0xFFF08332),
  ),
  _VehiclePaint(
    id: 'yellow-ochre',
    name: 'Ochre yellow',
    code: 'RAL 080 60 50',
    system: 'RAL DESIGN SYSTEM plus',
    family: 'Yellow',
    color: Color(0xFFC99528),
  ),
  _VehiclePaint(
    id: 'yellow-signal',
    name: 'Signal yellow',
    code: 'RAL 095 80 80',
    system: 'RAL DESIGN SYSTEM plus',
    family: 'Yellow',
    color: Color(0xFFF2D22E),
  ),
  _VehiclePaint(
    id: 'green-olive',
    name: 'Olive green',
    code: 'RAL 110 40 20',
    system: 'RAL DESIGN SYSTEM plus',
    family: 'Green',
    color: Color(0xFF59613C),
  ),
  _VehiclePaint(
    id: 'green-racing',
    name: 'Racing green',
    code: 'RAL 150 30 20',
    system: 'RAL DESIGN SYSTEM plus',
    family: 'Green',
    color: Color(0xFF1E503E),
  ),
  _VehiclePaint(
    id: 'green-mint',
    name: 'Mint green',
    code: 'RAL 170 70 30',
    system: 'RAL DESIGN SYSTEM plus',
    family: 'Green',
    color: Color(0xFF69B994),
  ),
  _VehiclePaint(
    id: 'cyan-petrol',
    name: 'Petrol blue',
    code: 'RAL 190 40 30',
    system: 'RAL DESIGN SYSTEM plus',
    family: 'Cyan',
    color: Color(0xFF236C70),
  ),
  _VehiclePaint(
    id: 'cyan-glacier',
    name: 'Glacier blue',
    code: 'RAL 200 70 20',
    system: 'RAL DESIGN SYSTEM plus',
    family: 'Cyan',
    color: Color(0xFF7DB9BC),
  ),
  _VehiclePaint(
    id: 'blue-navy',
    name: 'Navy blue',
    code: 'RAL 250 30 20',
    system: 'RAL DESIGN SYSTEM plus',
    family: 'Blue',
    color: Color(0xFF2B465F),
  ),
  _VehiclePaint(
    id: 'blue-electric',
    name: 'Electric blue',
    code: 'RAL 260 50 60',
    system: 'RAL DESIGN SYSTEM plus',
    family: 'Blue',
    color: Color(0xFF2768C7),
  ),
  _VehiclePaint(
    id: 'blue-sky',
    name: 'Sky blue',
    code: 'RAL 230 70 30',
    system: 'RAL DESIGN SYSTEM plus',
    family: 'Blue',
    color: Color(0xFF70AFD1),
  ),
  _VehiclePaint(
    id: 'violet-plum',
    name: 'Plum violet',
    code: 'RAL 310 30 30',
    system: 'RAL DESIGN SYSTEM plus',
    family: 'Violet',
    color: Color(0xFF653A67),
  ),
  _VehiclePaint(
    id: 'violet-lilac',
    name: 'Lilac violet',
    code: 'RAL 300 60 30',
    system: 'RAL DESIGN SYSTEM plus',
    family: 'Violet',
    color: Color(0xFF9B77A9),
  ),
  _VehiclePaint(
    id: 'effect-anthracite',
    name: 'Anthracite effect',
    code: 'RAL 860-5',
    system: 'RAL EFFECT',
    family: 'Neutral',
    color: Color(0xFF3D4145),
  ),
  _VehiclePaint(
    id: 'effect-aluminium',
    name: 'Aluminium effect',
    code: 'RAL 9006',
    system: 'RAL EFFECT',
    family: 'Neutral',
    color: Color(0xFFA7A9A8),
  ),
  _VehiclePaint(
    id: 'effect-red',
    name: 'Performance red',
    code: 'RAL 450-M',
    system: 'RAL EFFECT',
    family: 'Red',
    color: Color(0xFF9E2638),
  ),
  _VehiclePaint(
    id: 'effect-gold',
    name: 'Warm gold',
    code: 'RAL 110-M',
    system: 'RAL EFFECT',
    family: 'Yellow',
    color: Color(0xFFB99A52),
  ),
  _VehiclePaint(
    id: 'effect-emerald',
    name: 'Emerald effect',
    code: 'RAL 750-M',
    system: 'RAL EFFECT',
    family: 'Green',
    color: Color(0xFF1E765C),
  ),
  _VehiclePaint(
    id: 'effect-teal',
    name: 'Teal effect',
    code: 'RAL 720-M',
    system: 'RAL EFFECT',
    family: 'Cyan',
    color: Color(0xFF167988),
  ),
  _VehiclePaint(
    id: 'effect-sapphire',
    name: 'Sapphire effect',
    code: 'RAL 620-M',
    system: 'RAL EFFECT',
    family: 'Blue',
    color: Color(0xFF285CA5),
  ),
  _VehiclePaint(
    id: 'effect-amethyst',
    name: 'Amethyst effect',
    code: 'RAL 540-M',
    system: 'RAL EFFECT',
    family: 'Violet',
    color: Color(0xFF704F87),
  ),
];

const _vehicleTypes = ['TESLA', 'NISSAN', 'HYUNDAI'];

String _normalizePlate(String raw) {
  final compact = raw.toUpperCase().replaceAll(RegExp('[^A-Z0-9]'), '');
  if (compact.length <= 2) return compact;
  final trimmed = compact.length > 5 ? compact.substring(0, 5) : compact;
  return '${trimmed.substring(0, 2)} ${trimmed.substring(2)}';
}

String _maskedVehicleId(String plate) {
  final compact = plate.replaceAll(' ', '');
  return 'EVCCID ...$compact';
}

String _titleCase(String value) {
  final lower = value.toLowerCase();
  return '${lower[0].toUpperCase()}${lower.substring(1)}';
}

String _formatCount(int value) {
  final digits = value.toString();
  final buffer = StringBuffer();
  for (var index = 0; index < digits.length; index++) {
    if (index > 0 && (digits.length - index) % 3 == 0) buffer.write(',');
    buffer.write(digits[index]);
  }
  return buffer.toString();
}

List<double> _hueRotationMatrix(double radians) {
  final cosine = math.cos(radians);
  final sine = math.sin(radians);
  return [
    0.213 + cosine * 0.787 - sine * 0.213,
    0.715 - cosine * 0.715 - sine * 0.715,
    0.072 - cosine * 0.072 + sine * 0.928,
    0,
    0,
    0.213 - cosine * 0.213 + sine * 0.143,
    0.715 + cosine * 0.285 + sine * 0.140,
    0.072 - cosine * 0.072 - sine * 0.283,
    0,
    0,
    0.213 - cosine * 0.213 - sine * 0.787,
    0.715 - cosine * 0.715 + sine * 0.715,
    0.072 + cosine * 0.928 + sine * 0.072,
    0,
    0,
    0,
    0,
    0,
    1,
    0,
  ];
}
