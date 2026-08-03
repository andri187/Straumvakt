// Charger settings — the actual controls.
//
// One widget per Control kind. Everything here WRITES to the charger, so
// two rules apply throughout:
//
//   • A write is confirmed by re-reading. GATT returning success means the
//     stack accepted the bytes, NOT that the charger applied them. The row
//     shows what the charger says afterwards, never what we sent.
//
//   • Danger tiers gate on confirmation, not on decoration. The previous
//     cut hung a warning triangle next to a value nobody could edit, which
//     is worse than useless — it implied risk while offering no action.
//     Destructive fields now explain the specific consequence and require
//     an explicit confirm; nothing carries a bare hazard icon.
//
// WRITE STATUS (ZPR074002, 2026-08-03). NOTE: the charger was updated
// from fw 3.3.4.5 to 6.3.2.0 mid-session, and 6.3.2.0 renamed at least
// one value under us (Standalone "standalone" -> "system") and changed
// a numeric format (Brightness "0.00" -> "0.0"). Treat anything below
// as firmware-specific until re-checked.
//   VERIFIED  HmiLedBrightness — wrote "1.00"/"0.00", read back exactly,
//             first encoding, no fallback needed.
//   REFUSED   Standalone — eight encodings tried (loadbalanced,
//             loadbalancing, LoadBalanced, LoadBalancing, cloud, zaptec,
//             false, 0); the charger returned "standalone" every time.
//             Not an encoding problem: writes demonstrably work.
//   VERIFIED  Indicate (0xFCDB) — the charger beeps. This is what the
//             vendor app does on connect; we now do it too, so the
//             driver gets physical confirmation of WHICH charger they
//             are configuring.
//   Also verified: PIN auth, all reads, RunCommand(102) reboot,
//             RunCommand(200) firmware update (took 3.3.4.5 -> 6.3.2.0).
// Everything else is still untested. Treat first use as a bench test.

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'charger_capabilities.dart';
import '../theme/palette.dart';

typedef WriteField = void Function(CapabilityField field, String value);
typedef RunAction = Future<void> Function(CapabilityField field);
typedef LabelBuilder = Widget Function({Widget? trailing});

/// A slider that says what it is setting.
///
/// Two things the previous cut got wrong, both reported from the bench:
///
///   • it showed a percentage on a bare track with no scale, no end
///     markers and no word for the value — "an empty green bubble that
///     you slide in a void";
///   • it was continuous, so maximum current could be dragged to 3 A,
///     which no EVSE can offer and the charger silently ignores.
///
/// So: discrete stops when the field declares them, the value rendered
/// through the field's own formatter (which gives "Bright · 70%" or
/// "16 A"), end captions, and — for a range with real units — a tap on the
/// value to type it exactly rather than fighting a thumb for one amp.
class _SliderRow extends StatefulWidget {
  const _SliderRow({
    required this.entry,
    required this.busy,
    required this.onWrite,
    required this.label,
  });

  final ResolvedField entry;
  final bool busy;
  final WriteField onWrite;
  final LabelBuilder label;

  @override
  State<_SliderRow> createState() => _SliderRowState();
}

class _SliderRowState extends State<_SliderRow> {
  /// Position while the thumb is down. Null means "show the charger's
  /// value" — the row never displays a number the charger has not
  /// confirmed except during an active drag.
  double? _dragging;

  CapabilityField get f => widget.entry.field;

  List<double> get _stops =>
      f.allowedValues ??
      [
        for (var v = (f.min ?? 0); v <= (f.max ?? 1); v += (f.step ?? 1)) v,
      ];

  /// Index of the charger's current value, snapped to the nearest stop.
  int get _index {
    final v = widget.entry.asDouble;
    final stops = _stops;
    var best = 0;
    for (var i = 1; i < stops.length; i++) {
      if ((stops[i] - v).abs() < (stops[best] - v).abs()) best = i;
    }
    return best;
  }

  String _render(double v) {
    final raw = f.allowedValues != null && f.unit == 'A'
        ? v.round().toString()
        : v.toStringAsFixed(2);
    final fmt = f.format;
    final base = fmt == null ? (f.unit == 'A' ? v.round().toString() : raw) : fmt(raw);
    return f.unit == null ? base : '$base ${f.unit}';
  }

  /// Wire value. Amps are whole numbers; brightness is a decimal the
  /// charger stores as "0.75".
  String _wire(double v) =>
      f.unit == 'A' ? v.round().toString() : v.toStringAsFixed(2);

  @override
  Widget build(BuildContext context) {
    final stops = _stops;
    final idx = _dragging?.round() ?? _index;
    final shown = stops[idx.clamp(0, stops.length - 1)];
    final live = _dragging != null;

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          widget.label(
            trailing: InkWell(
              // Typing beats dragging for an exact figure, and an
              // electrician setting a breaker limit wants the exact figure.
              onTap: widget.busy || f.unit != 'A' ? null : _typeValue,
              borderRadius: BorderRadius.circular(8),
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      // During a drag this is the pending value, so it is
                      // tinted differently — it is not what the charger
                      // says yet.
                      _render(shown),
                      style: TextStyle(
                        color: live ? BrandPalette.cyan : Colors.white,
                        fontSize: 14,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    if (f.unit == 'A' && !widget.busy) ...[
                      const SizedBox(width: 6),
                      const Icon(Icons.edit_rounded,
                          size: 13, color: BrandPalette.muted),
                    ],
                  ],
                ),
              ),
            ),
          ),
          Row(
            children: [
              Icon(_endIcon(low: true),
                  size: 16, color: BrandPalette.muted),
              Expanded(
                child: Slider(
                  value: idx.toDouble().clamp(0, (stops.length - 1).toDouble()),
                  min: 0,
                  max: (stops.length - 1).toDouble(),
                  divisions: stops.length - 1,
                  label: _render(shown),
                  onChanged: widget.busy
                      ? null
                      : (v) => setState(() => _dragging = v),
                  onChangeEnd: widget.busy
                      ? null
                      : (v) async {
                          final picked = stops[v.round().clamp(0, stops.length - 1)];
                          setState(() => _dragging = null);
                          widget.onWrite(f, _wire(picked));
                        },
                ),
              ),
              Icon(_endIcon(low: false),
                  size: 18, color: BrandPalette.muted),
            ],
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 4),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(_render(stops.first),
                    style: const TextStyle(
                        color: BrandPalette.muted, fontSize: 10)),
                Text(_render(stops.last),
                    style: const TextStyle(
                        color: BrandPalette.muted, fontSize: 10)),
              ],
            ),
          ),
        ],
      ),
    );
  }

  IconData _endIcon({required bool low}) => f.unit == 'A'
      ? (low ? Icons.battery_2_bar_rounded : Icons.bolt_rounded)
      : (low ? Icons.brightness_low_rounded : Icons.brightness_high_rounded);

  Future<void> _typeValue() async {
    final stops = _stops;
    final controller =
        TextEditingController(text: stops[_index].round().toString());
    final entered = await showModalBottomSheet<String>(
      context: context,
      backgroundColor: BrandPalette.surface,
      isScrollControlled: true,
      builder: (ctx) => Padding(
        padding: EdgeInsets.only(
          left: 24,
          right: 24,
          top: 24,
          bottom: 24 + MediaQuery.of(ctx).viewInsets.bottom,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(f.label,
                style: const TextStyle(
                    color: Colors.white,
                    fontSize: 16,
                    fontWeight: FontWeight.w900)),
            const SizedBox(height: 6),
            Text(
              '0 A turns charging off. Otherwise '
              '${stops.where((s) => s > 0).first.round()}–'
              '${stops.last.round()} A.',
              style: const TextStyle(color: BrandPalette.muted, fontSize: 12),
            ),
            const SizedBox(height: 16),
            TextField(
              controller: controller,
              autofocus: true,
              keyboardType: TextInputType.number,
              textAlign: TextAlign.center,
              style: const TextStyle(
                  color: Colors.white,
                  fontSize: 28,
                  fontWeight: FontWeight.w900),
              decoration: const InputDecoration(suffixText: 'A'),
            ),
            const SizedBox(height: 12),
            FilledButton(
              onPressed: () => Navigator.of(ctx).pop(controller.text.trim()),
              child: const Text('Set'),
            ),
          ],
        ),
      ),
    );
    if (entered == null || !mounted) return;
    final n = double.tryParse(entered);
    if (n == null) return;
    // Snap to a legal stop rather than refusing — 5 A becomes 6 A, which
    // is what the driver meant and what the charger can actually do.
    var best = stops.first;
    for (final s in stops) {
      if ((s - n).abs() < (best - n).abs()) best = s;
    }
    widget.onWrite(f, _wire(best));
  }
}

class CapabilityGroupPanel extends StatelessWidget {
  const CapabilityGroupPanel({
    super.key,
    required this.group,
    required this.onWrite,
    required this.onAction,
    required this.busy,
  });

  final ResolvedGroup group;
  final WriteField onWrite;
  final RunAction onAction;
  final bool busy;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: BrandPalette.surface,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: BrandPalette.border),
      ),
      child: Column(
        children: [
          for (var i = 0; i < group.entries.length; i++)
            CapabilityRow(
              entry: group.entries[i],
              isLast: i == group.entries.length - 1,
              onWrite: onWrite,
              onAction: onAction,
              busy: busy,
            ),
        ],
      ),
    );
  }
}

class CapabilityRow extends StatelessWidget {
  const CapabilityRow({
    super.key,
    required this.entry,
    required this.isLast,
    required this.onWrite,
    required this.onAction,
    required this.busy,
  });

  final ResolvedField entry;
  final bool isLast;
  final WriteField onWrite;
  final RunAction onAction;
  final bool busy;

  CapabilityField get f => entry.field;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
      decoration: BoxDecoration(
        border: isLast
            ? null
            : const Border(bottom: BorderSide(color: BrandPalette.border)),
      ),
      child: entry.isBlocked
          ? _blocked()
          : switch (f.control) {
        Control.toggle => _toggle(context),
        Control.slider => _slider(context),
        Control.choice => _tappable(context, entry.display, () => _pickChoice(context)),
        Control.secret => _tappable(context, entry.display, () => _enterSecret(context)),
        Control.action => _action(context),
        Control.readout => _readout(),
      },
    );
  }

  Widget _label({Widget? trailing}) => Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Text(f.label,
                        style: const TextStyle(
                            color: Colors.white,
                            fontSize: 14,
                            fontWeight: FontWeight.w600)),
                    // Edited but not sent. Marked on the row itself so the
                    // driver can see at a glance which values are theirs
                    // and which are the charger's — otherwise a staged
                    // change is indistinguishable from an applied one.
                    if (entry.isDirty) ...[
                      const SizedBox(width: 8),
                      Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 6, vertical: 1),
                        decoration: BoxDecoration(
                          color: BrandPalette.cyan.withValues(alpha: 0.16),
                          borderRadius: BorderRadius.circular(4),
                        ),
                        child: const Text('not applied',
                            style: TextStyle(
                                color: BrandPalette.cyan,
                                fontSize: 9,
                                fontWeight: FontWeight.w900)),
                      ),
                    ],
                  ],
                ),
                ?(f.help == null
                    ? null
                    : Padding(
                        padding: const EdgeInsets.only(top: 2),
                        child: Text(f.help!,
                            style: const TextStyle(
                                color: BrandPalette.muted, fontSize: 11)),
                      )),
              ],
            ),
          ),
          ?trailing,
        ],
      );

  /// A control the charger's current state forbids. Present, greyed, and
  /// explained — the driver learns the precondition instead of hunting for
  /// a control that disappeared.
  Widget _blocked() => Padding(
        padding: const EdgeInsets.symmetric(vertical: 10),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(f.label,
                      style: const TextStyle(
                          color: BrandPalette.muted,
                          fontSize: 14,
                          fontWeight: FontWeight.w600)),
                  const SizedBox(height: 3),
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Icon(Icons.block_rounded,
                          size: 13, color: BrandPalette.amber),
                      const SizedBox(width: 6),
                      Expanded(
                        child: Text(entry.blockedReason!,
                            style: const TextStyle(
                                color: BrandPalette.amber, fontSize: 11)),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),
      );

  Widget _readout() => Padding(
        padding: const EdgeInsets.symmetric(vertical: 8),
        child: _label(
          trailing: Text(entry.display,
              style: const TextStyle(
                  color: Colors.white,
                  fontSize: 13,
                  fontWeight: FontWeight.w700)),
        ),
      );

  Widget _toggle(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 2),
        child: _label(
          trailing: Switch(
            value: entry.isOn,
            onChanged: busy
                ? null
                : (v) async {
                    onWrite(f, v ? f.onValue : f.offValue);
                  },
          ),
        ),
      );

  Widget _slider(BuildContext context) => _SliderRow(
        entry: entry,
        busy: busy,
        onWrite: onWrite,
        label: _label,
      );

  Widget _tappable(BuildContext context, String value, VoidCallback onTap) =>
      InkWell(
        onTap: busy ? null : onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 10),
          child: _label(
            trailing: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(value,
                    style: const TextStyle(
                        color: Colors.white,
                        fontSize: 13,
                        fontWeight: FontWeight.w700)),
                const SizedBox(width: 6),
                const Icon(Icons.chevron_right_rounded,
                    color: BrandPalette.muted, size: 18),
              ],
            ),
          ),
        ),
      );

  /// Confirmation for a command. Safe-tier actions run without a prompt.
  Future<bool> _confirmAction(BuildContext context) async {
    if (f.danger == Danger.safe) return true;
    final destructive = f.danger == Danger.destructive;
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: BrandPalette.surface,
        title: Text('${f.label}?',
            style: const TextStyle(color: Colors.white)),
        content: Text(
          f.help ??
              (destructive
                  ? 'This interrupts charging and takes several minutes.'
                  : 'Charging will be interrupted.'),
          style: const TextStyle(color: BrandPalette.muted),
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.of(ctx).pop(false),
              child: const Text('Cancel')),
          FilledButton(
            onPressed: () {
              HapticFeedback.mediumImpact();
              Navigator.of(ctx).pop(true);
            },
            child: const Text('Run'),
          ),
        ],
      ),
    );
    return ok ?? false;
  }

  Widget _action(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 10),
        child: _label(
          trailing: OutlinedButton(
            // Actions are NOT staged — a reboot or a grid test is a verb,
            // not a value, so there is nothing to review and it confirms
            // here and runs immediately.
            onPressed: busy
                ? null
                : () async {
                    if (!await _confirmAction(context)) return;
                    await onAction(f);
                  },
            child: const Text('Run'),
          ),
        ),
      );

  // ── Editors ────────────────────────────────────────────────────────

  Future<void> _pickChoice(BuildContext context) async {
    // Prefer what the charger enumerates over anything we hardcode — it
    // knows which Wi-Fi networks and comm modes are actually available.
    final options = entry.runtimeChoices ??
        f.choices ??
        (f.min != null ? numericChoices(f) : const <Choice>[]);
    if (options.isEmpty) return;

    final picked = await showModalBottomSheet<String>(
      context: context,
      backgroundColor: BrandPalette.surface,
      isScrollControlled: true,
      builder: (ctx) => SafeArea(
        child: ListView(
          shrinkWrap: true,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 18, 20, 8),
              child: Text(f.label,
                  style: const TextStyle(
                      color: Colors.white,
                      fontSize: 16,
                      fontWeight: FontWeight.w900)),
            ),
            for (final o in options)
              ListTile(
                title: Text(o.label,
                    style: const TextStyle(color: Colors.white)),
                trailing: (entry.value ?? '').trim() == o.value
                    ? const Icon(Icons.check_rounded, color: BrandPalette.cyan)
                    : null,
                onTap: () => Navigator.of(ctx).pop(o.value),
              ),
          ],
        ),
      ),
    );
    if (picked == null || !context.mounted) return;
    onWrite(f, picked);
  }

  Future<void> _enterSecret(BuildContext context) async {
    final controller = TextEditingController();
    final entered = await showModalBottomSheet<String>(
      context: context,
      backgroundColor: BrandPalette.surface,
      isScrollControlled: true,
      builder: (ctx) => Padding(
        padding: EdgeInsets.only(
          left: 24,
          right: 24,
          top: 24,
          bottom: 24 + MediaQuery.of(ctx).viewInsets.bottom,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(f.label,
                style: const TextStyle(
                    color: Colors.white,
                    fontSize: 16,
                    fontWeight: FontWeight.w900)),
            const SizedBox(height: 6),
            const Text(
              'The charger cannot read this back, so it can only be '
              'replaced, never checked.',
              style: TextStyle(color: BrandPalette.muted, fontSize: 12),
            ),
            const SizedBox(height: 16),
            TextField(
              controller: controller,
              autofocus: true,
              obscureText: true,
              style: const TextStyle(color: Colors.white),
            ),
            const SizedBox(height: 12),
            FilledButton(
              onPressed: () => Navigator.of(ctx).pop(controller.text),
              child: const Text('Save'),
            ),
          ],
        ),
      ),
    );
    if (entered == null || entered.isEmpty || !context.mounted) return;
    onWrite(f, entered);
  }

}
