// Charger settings — capability model.
//
// The vendor-neutral seam. Screens render from CapabilityGroups; a vendor
// descriptor maps that brand's transport into it. Zaptec is the first
// descriptor, not the shape of the model.
//
// Two rules this file exists to enforce:
//
//   1. RENDER FROM WHAT THE DEVICE EXPOSES. This firmware presents 34 of
//      the 52 characteristics the vendor app knows; other models differ.
//      A hardcoded screen shows dead controls on half a fleet.
//
//   2. SHOW ONLY WHAT A HUMAN CAN ACT ON. The first cut of this screen was
//      a raw characteristic dump — meter IDs, occupancy flags, metrology
//      test modes. Everything below earns its place or is gone.

import 'zaptec_ble.dart';

/// How much damage getting this wrong can do. Drives confirmation UX.
enum Danger { safe, caution, destructive }

/// What the driver interacts with. The screen renders one widget per kind.
enum Control {
  /// Read-only text.
  readout,

  /// On/off. Charger stores "0"/"1".
  toggle,

  /// Continuous 0..1, shown as a percentage.
  slider,

  /// Pick one of [Choice]s — from a fixed list or a companion
  /// characteristic that enumerates what is available.
  choice,

  /// Write-only secret. Never reads back; shows "saved", never a value.
  secret,

  /// Fire-and-forget command.
  action,
}

class Choice {
  const Choice(this.value, this.label, {this.danger});
  final String value;
  final String label;

  /// Overrides the field's danger for this option.
  ///
  /// Risk lives in the value, not the setting. Choosing LTE supplies no
  /// credential and cannot be "entered wrong" — warning that the charger
  /// might be stranded is simply untrue for it. Choosing Wi-Fi or PLC
  /// commits you to entering a key that can be wrong, which is where the
  /// real hazard is.
  final Danger? danger;
}

class CapabilityField {
  const CapabilityField({
    required this.id,
    required this.label,
    required this.control,
    this.danger = Danger.safe,
    this.unit,
    this.help,
    this.format,
    this.choices,
    this.choicesFrom,
    this.min,
    this.max,
    this.step,
    this.command,
    this.showWhen,
    this.onValue = '1',
    this.offValue = '0',
    this.requiresState,
    this.alternates,
    this.allowedValues,
  });

  /// Transport-level identifier (a Zaptec characteristic id here).
  final int id;
  final String label;
  final Control control;
  final Danger danger;
  final String? unit;

  /// One line under the label, for anything whose name is not self-evident.
  final String? help;

  final String Function(String raw)? format;

  /// Fixed options for [Control.choice].
  final List<Choice>? choices;

  /// Characteristic that enumerates available options at runtime (e.g.
  /// AvailableWifiNetworks). Beats a fixed list where the charger knows
  /// better than we do.
  final int? choicesFrom;

  final double? min;
  final double? max;
  final double? step;

  /// For [Control.action] — the RunCommand value to send.
  final int? command;

  /// Wire values for a toggle. Most are "1"/"0", but Standalone reads
  /// back the literal "standalone" — verified on hardware. Assuming 0/1
  /// everywhere silently no-ops the write.
  final String onValue;
  final String offValue;

  /// Hard precondition: (fieldId, value) that must hold for this control
  /// to be usable at all. Unlike showWhen the field stays VISIBLE but is
  /// disabled with a reason, so the operator learns why rather than
  /// hunting for a control that vanished.
  final (int, String)? requiresState;

  /// Alternate wire encodings to try when the primary one does not stick,
  /// keyed by the primary value.
  ///
  /// This protocol is undocumented and each field encodes differently:
  /// Standalone reads back `"standalone"`, CommunicationMode reads back
  /// `"Wifi"`, and StandalonePhase is either a phase BITMASK (1/7) or a
  /// Zaptec PhaseId (1/4/9) depending on the network family — the vendor
  /// app knows which because it also talks to the cloud, and we do not.
  ///
  /// So a write is VERIFIED by read-back, and if the charger silently
  /// ignored it the alternates are tried in order until one takes. If none
  /// do, the driver is told the charger refused — never that it worked.
  final Map<String, List<String>>? alternates;

  /// Discrete stops for a [Control.slider]. When set, the slider snaps to
  /// exactly these values and nothing between them.
  ///
  /// Maximum current is the case this exists for: 0 A (off) is legal and
  /// 6–32 A is legal, but 1–5 A is not a current any EVSE may offer — a
  /// plain 0–32 slider would let a driver set a value the charger cannot
  /// honour and would silently round.
  final List<double>? allowedValues;

  /// Conditional visibility: (fieldId, value) that must currently hold.
  /// Used so PLC keys appear only when the comm mode is actually PLC.
  final (int, String)? showWhen;

  bool get isWritable => control != Control.readout;
}

class CapabilityGroup {
  const CapabilityGroup({
    required this.title,
    required this.fields,
    this.subtitle,
    this.pinned = false,
  });

  final String title;
  final String? subtitle;
  final List<CapabilityField> fields;

  /// Shown above the fold instead of inside collapsed Advanced.
  ///
  /// A charger reporting a fault must be visible the moment the screen
  /// opens. Burying State and Warnings behind a disclosure the driver has
  /// to know to expand meant the app could be connected to a faulted
  /// charger and show nothing at all — which is exactly what happened on
  /// the bench.
  final bool pinned;
}

// ── Formatting ───────────────────────────────────────────────────────

String _operationState(String raw) => switch (raw.trim()) {
      '1' => 'Ready',
      '2' => 'Waiting for authorisation',
      '3' => 'Charging',
      '5' => 'Finished',
      _ => raw,
    };

/// Zaptec's `SmartWarnings` bit flags, taken from the cloud API's own
/// constant set so app and backend name a fault identically.
///
/// The charger reports this as a decimal string of an OR'd bitmask, so a
/// real fault arrives looking like "8388608" — which is why the previous
/// cut appeared to show nothing useful when the charger was faulted.
/// Composite masks from the vendor list (WARNING_RCD = 1011712) are
/// deliberately excluded: they are roll-ups of the individual bits below
/// and would double-report.
const Map<int, String> kZaptecWarningBits = {
  1: 'Humidity',
  2: 'Temperature high',
  4: 'Temperature sensor fault',
  8: 'Energy meter not responding',
  16: 'Session restarted too many times',
  32: 'Charge overcurrent',
  64: 'Control pilot fault',
  128: 'Relay welded',
  256: 'Control pilot level low',
  512: 'FPGA communication timeout',
  1024: 'Rebooted',
  2048: 'Charger disabled',
  4096: 'Residual current (AC)',
  8192: 'Residual current (DC)',
  16384: 'Residual current peak',
  65536: 'RCD self-test failed (AC)',
  131072: 'RCD self-test failed (DC)',
  262144: 'RCD failure',
  524288: 'RCD self-test timed out',
  1048576: 'FPGA version mismatch',
  2097152: 'Unexpected relay state',
  4194304: 'Charging reset by FPGA',
  8388608: 'No proximity signal from cable',
  16777216: 'Energy meter alarm',
  33554432: 'Energy meter link lost',
  67108864: 'No voltage on L1',
  134217728: 'No voltage on L2/L3',
  268435456: 'Watchdog reset',
  536870912: 'Energy meter not calibrated',
  1073741824: 'MID meter fault',
  2147483648: 'System module fault',
  4294967296: 'MCU in bootloader',
  8589934592: 'FPGA failed to start',
  17179869184: 'Illegal phase configuration',
};

/// Decode a warnings bitmask into the faults it actually names.
///
/// Returns an empty list for "no fault" AND for anything unparseable —
/// callers distinguish the two by checking the raw value, because
/// inventing "no fault" from a value we failed to read is the one wrong
/// answer here.
List<String> decodeWarnings(String raw) {
  final mask = int.tryParse(raw.trim());
  if (mask == null || mask == 0) return const [];
  final out = <String>[
    for (final e in kZaptecWarningBits.entries)
      if (mask & e.key == e.key) e.value,
  ];
  // A bit we do not have a name for is still a fault. Say so rather than
  // dropping it — an unnamed fault silently disappearing is worse than an
  // ugly label.
  final named = kZaptecWarningBits.keys
      .where((b) => mask & b == b)
      .fold<int>(0, (a, b) => a | b);
  if (mask & ~named != 0) out.add('Unknown fault (0x${(mask & ~named).toRadixString(16)})');
  return out;
}

/// Grid type, e.g. "TN_3" → "TN, 3-phase". Left verbatim if the charger
/// answers with something this pattern does not cover — an unrecognised
/// grid type is information, and blanking it would hide it.
String _networkType(String raw) {
  final m = RegExp(r'^(TN|IT)_?([13])$').firstMatch(raw.trim().toUpperCase());
  if (m == null) return raw;
  return '${m.group(1)}, ${m.group(2)}-phase';
}

String _warnings(String raw) {
  final s = raw.trim();
  // Verified on ZPR074002 / fw 3.3.4.5: this characteristic reads back
  // EMPTY, not "0". That is not the same as "no faults" and must not be
  // rendered as if it were — a charger showing a fault on its own ring
  // reported nothing here. Faults for an online charger come from the
  // operator side; over BLE alone we genuinely do not know.
  if (s.isEmpty) return 'Not reported by the charger';
  final faults = decodeWarnings(s);
  if (faults.isEmpty) return int.tryParse(s) == 0 ? 'None' : s;
  return faults.join(' · ');
}

/// Brightness as a word plus a number. "70%" alone does not describe a
/// light; "Bright · 70%" does, and the word is what a driver repeats to
/// someone on the phone.
String _brightness(String raw) {
  final v = double.tryParse(raw.trim());
  if (v == null) return raw;
  final pct = (v * 100).round();
  final word = switch (v) {
    <= 0.001 => 'Off',
    < 0.2 => 'Dim',
    < 0.4 => 'Low',
    < 0.7 => 'Medium',
    < 0.95 => 'Bright',
    _ => 'Full',
  };
  return v <= 0.001 ? word : '$word · $pct%';
}

const _commModes = [
  // Wire values are NAMES, not codes — verified on hardware: 0xFCD2
  // reads back "Wifi". Writing "0"/"1"/"2" was accepted by GATT and
  // silently ignored by the charger, which is why the value never moved.
  Choice('Wifi', 'Wi-Fi', danger: Danger.destructive),
  Choice('PLC', 'Powerline (PLC)', danger: Danger.destructive),
  Choice('LTE', 'LTE', danger: Danger.caution),
];
// FALLBACK ONLY. The charger enumerates what it actually supports on
// AvailableCommunicationModes, and that answer wins — ZPR074002 reports
// `[WiFi, PLC]` with no LTE, so offering LTE here would be offering a
// mode this hardware does not have. The list above exists for a charger
// that declines to enumerate, and should be treated as a guess.

const _phases = [
  Choice('1', '1 phase'),
  Choice('7', '3 phase'),
];

/// Both plausible encodings for the phase field, tried in order and each
/// verified by read-back. Zaptec's cloud constants define `Phases`
/// (bitmask: Phase_1=1, All=7) AND `PhaseIdMap` (TN 3-phase = 4, IT
/// 3-phase = 9); the characteristic name does not say which it takes, and
/// writing the wrong one is accepted by GATT and ignored by the charger.
const _phaseAlternates = {
  '1': ['1', '8'], // bitmask Phase_1 == PhaseId 1 (TN); 8 is IT 1-phase
  '7': ['4', '9', '3'], // bitmask All, then TN/IT PhaseId, then a raw count
};

/// Currents an EVSE may actually offer: off, or 6 A upward. Nothing in
/// between exists — IEC 61851 puts the pilot's lowest duty cycle at 6 A.
const _ampSteps = <double>[
  0, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
  17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32,
];

/// The Zaptec descriptor.
///
/// **Deliberately excluded**, having been reviewed and rejected:
///   • MID / Meter ID — metrology artefact, equals the serial here
///   • OccupiedState — redundant with State
///   • TimeZone, TimeSchedule — configured centrally, not per charger
///   • MIDFieldTestMode — puts the certified meter in verification mode;
///     inspector-only and unsafe to surface
///   • AuthorizationResult, PairNfc — key enrolment belongs in Straumvakt's
///     own access management, not a charger settings screen
///   • Connect, Indicate, Authorization, LedState — internal to the
///     vendor app's own flows
///   • 0xFCD8 — present on the device, absent from the vendor app's enum,
///     purpose unknown
const List<CapabilityGroup> kZaptecCapabilities = [
  // Not pinned any more. These read reliably, but none of them is
  // actionable, and Warnings reports nothing over BLE on either firmware
  // we have tested — so keeping them above the fold spent the primary
  // screen on information the driver cannot use.
  CapabilityGroup(
    title: 'Status',
    fields: [
      CapabilityField(
        id: ZapChar.chargerOperationState,
        label: 'State',
        control: Control.readout,
        format: _operationState,
      ),
      CapabilityField(
        id: ZapChar.warnings,
        label: 'Warnings',
        control: Control.readout,
        format: _warnings,
      ),
      CapabilityField(
        id: ZapChar.firmwareVersion,
        label: 'Firmware',
        control: Control.readout,
      ),
      // "Which charger am I actually connected to?"
      //
      // Observed on the bench 2026-08-03: the Zaptec app makes the
      // charger chirp the moment it connects, and ours does not. The
      // GATT log shows a 1-byte write to the charger immediately before
      // the 4-byte PIN — consistent with a single ASCII character to
      // this characteristic, which the vendor enum names `Indicate`.
      //
      // Worth having for its own sake: in a row of identical chargers a
      // physical acknowledgement is the only way to be sure the one you
      // are about to reconfigure is the one in front of you. Safe tier —
      // it makes a noise and nothing else.
      CapabilityField(
        id: ZapChar.indicate,
        label: 'Identify this charger',
        control: Control.action,
        help: 'Makes the charger in front of you beep, so you know it is '
            'the one you are connected to.',
      ),
      // What the charger is wired into. Read as "TN_3" on the bench —
      // it is what makes the phase options meaningful, and it is the first
      // thing anyone asks when a phase change does not behave.
      CapabilityField(
        id: ZapChar.networkType,
        label: 'Grid',
        control: Control.readout,
        format: _networkType,
      ),
    ],
  ),
  CapabilityGroup(
    title: 'Charging',
    fields: [
      CapabilityField(
        id: ZapChar.standaloneCurrent,
        label: 'Maximum current',
        control: Control.slider,
        danger: Danger.caution,
        unit: 'A',
        allowedValues: _ampSteps,
        // Only bites in standalone mode. Confirmed on the bench: with
        // 0xFCD9 reading 'system' the write is accepted and ignored,
        // exactly like Phases. Zaptec setting 712 (Standalone) is 0, so
        // the installation governs current — CurrentInMaximum 32 /
        // CurrentInMinimum 6 live cloud-side, not here.
        requiresState: (ZapChar.standalone, 'standalone'),
        help: 'Must not exceed the circuit this charger is on.',
      ),
      CapabilityField(
        id: ZapChar.standalonePhase,
        label: 'Phases',
        control: Control.choice,
        danger: Danger.caution,
        choices: _phases,
        alternates: _phaseAlternates,
        // Same rule. Five encodings (7/4/9/3/7.0) all bounced while the
        // charger sat in 'system' mode — not an encoding problem, a
        // scope one. The live setting is cloud-side MaxPhases (520).
        requiresState: (ZapChar.standalone, 'standalone'),
      ),
      // WRITABLE after all. I made this a readout on the theory that
      // load balancing is installation-scoped and the charger could not
      // change it. The vendor app toggles it fine — so the theory was
      // wrong and the eight refused encodings had a duller cause: we
      // were writing the OFF value and never tried "system".
      //
      // On fw 3.3.4.5 this only ever read "standalone", so the opposite
      // had no observable name and we guessed (loadbalanced, cloud,
      // false, 0 — all ignored). 6.3.2.0 displayed "system" and the
      // answer was there all along.
      //
      // This is the master switch: with it ON the charger honours its
      // own current and phase limits; OFF and the installation governs
      // them. Hence the requiresState gates on those two fields.
      CapabilityField(
        id: ZapChar.standalone,
        label: 'Standalone mode',
        control: Control.toggle,
        danger: Danger.caution,
        onValue: 'standalone',
        offValue: 'system',
        alternates: {
          'standalone': ['standalone', 'Standalone'],
          'system': ['system', 'System'],
        },
        help: 'Charger uses its own current and phase limits instead of '
            'the ones the installation sets. Turn this on to change them '
            'here.',
      ),
      CapabilityField(
        id: ZapChar.permanentLock,
        label: 'Lock cable permanently',
        control: Control.toggle,
        danger: Danger.caution,
        // Unverified encoding — the toggle appeared to work and did not.
        // Read-back decides which of these the firmware accepts.
        alternates: {
          '1': ['1', 'true', 'locked', 'Locked'],
          '0': ['0', 'false', 'unlocked', 'Unlocked'],
        },
        help: 'Cable cannot be removed from the charger.',
      ),
    ],
  ),
  CapabilityGroup(
    title: 'Network',
    subtitle: 'Only reachable over Bluetooth',
    fields: [
      CapabilityField(
        id: ZapChar.communicationMode,
        label: 'Connection type',
        control: Control.choice,
        danger: Danger.destructive,
        choices: _commModes,
        choicesFrom: ZapChar.availableCommunicationModes,
      ),
      CapabilityField(
        id: ZapChar.wifiSsid,
        label: 'Wi-Fi network',
        control: Control.choice,
        danger: Danger.destructive,
        choicesFrom: ZapChar.availableWifiSsids,
        showWhen: (ZapChar.communicationMode, 'Wifi'),
      ),
      CapabilityField(
        id: ZapChar.wifiPsk,
        label: 'Wi-Fi password',
        control: Control.secret,
        danger: Danger.destructive,
        showWhen: (ZapChar.communicationMode, 'Wifi'),
      ),
      // PLC keys appear only when the connection type is actually PLC.
      CapabilityField(
        id: ZapChar.plcNmk,
        label: 'Powerline network key',
        control: Control.secret,
        danger: Danger.destructive,
        showWhen: (ZapChar.communicationMode, 'PLC'),
      ),
      CapabilityField(
        id: ZapChar.plcNpw,
        label: 'Powerline password',
        control: Control.secret,
        danger: Danger.destructive,
        showWhen: (ZapChar.communicationMode, 'PLC'),
      ),
    ],
  ),
  CapabilityGroup(
    title: 'Appearance',
    fields: [
      CapabilityField(
        id: ZapChar.hmiLedBrightness,
        label: 'Light brightness',
        control: Control.slider,
        min: 0,
        max: 1,
        // Snapped, and named. A bare percentage on an unlabelled track
        // tells the driver nothing about what they are about to see on a
        // charger they may be standing in the dark next to.
        allowedValues: [0, 0.1, 0.25, 0.5, 0.75, 1.0],
        format: _brightness,
        help: 'How bright the ring on the front of the charger glows.',
      ),
    ],
  ),
  CapabilityGroup(
    title: 'Diagnostics',
    fields: [
      CapabilityField(
        id: ZapChar.gridTest,
        label: 'Run grid test',
        control: Control.action,
        danger: Danger.caution,
        // Only with nothing plugged in. The test manipulates the supply;
        // running it against a connected vehicle is not something to
        // offer and then warn about. State 1 == Ready (nothing attached).
        requiresState: (ZapChar.chargerOperationState, '1'),
        // Writes "1" to its own characteristic rather than going through
        // RunCommand — hence no `command` here.
        help: 'Checks the supply and earthing. Interrupts charging.',
      ),
      CapabilityField(
        id: ZapChar.runCommand,
        // NOT a check. RunCommand(200) is UpdateFirmware — it tells the
        // charger to fetch and install, full stop. There is no BLE call
        // that reports whether a newer version exists, so the old label
        // ("Check for firmware update") promised something we cannot do.
        // Pressed on the bench 2026-08-03 it took ZPR074002 from 3.3.4.5
        // to 6.3.2.0 with no confirmation of what it was installing.
        label: 'Update firmware',
        control: Control.action,
        danger: Danger.destructive,
        command: ZapCommand.updateFirmware,
        help: 'Installs the latest firmware Zaptec has for this charger. '
            'It does not tell you first whether one is available, and it '
            'cannot be undone. Takes several minutes; charging stops.',
      ),
    ],
  ),
];

// ── Resolution ───────────────────────────────────────────────────────

class ResolvedField {
  const ResolvedField({
    required this.field,
    required this.value,
    this.runtimeChoices,
    this.blockedReason,
    this.pending,
  });
  final CapabilityField field;
  final String? value;

  /// Edited but not yet written to the charger.
  ///
  /// Kept separate from [value] so the row can show both — what the
  /// charger currently says, and what it will say if the change is
  /// applied. Nothing here has touched the hardware yet.
  final String? pending;

  bool get isDirty => pending != null && pending != value;

  /// What the control should render: the pending edit if there is one,
  /// otherwise the charger's own value.
  String? get effective => pending ?? value;

  /// Why this control cannot be used right now, in words for the driver.
  ///
  /// Null means usable. The control stays VISIBLE when blocked and says
  /// why — a control that vanishes reads as a missing feature, and the
  /// driver goes looking for it in the vendor app instead.
  final String? blockedReason;

  bool get isBlocked => blockedReason != null;

  /// Options the CHARGER enumerated (available Wi-Fi networks, supported
  /// comm modes). Preferred over any hardcoded list — the charger knows
  /// what is actually reachable and we do not.
  final List<Choice>? runtimeChoices;

  // Controls render the PENDING edit when there is one — the driver must
  // see what they just chose, not what the charger still says. The
  // charger's own value stays available via [value] so the review sheet
  // can show "32 A → 16 A".
  bool get isOn =>
      (effective ?? '').trim().toLowerCase() == field.onValue.toLowerCase();

  double get asDouble => double.tryParse((effective ?? '').trim()) ?? 0;

  /// The charger's current value, formatted. Used by the review sheet for
  /// the left-hand side of the arrow.
  String get committedDisplay => _render(value);

  String get display => _render(effective);

  String _render(String? value) {
    if (field.control == Control.secret) {
      // NEVER 'Not set'. These characteristics are write-only, so an
      // empty read means 'cannot be read', not 'has no value'. The
      // charger reported no Wi-Fi password while sitting on Wi-Fi, which
      // is the difference between not knowing and asserting a falsehood.
      return 'Hidden';
    }
    if (value == null || value.isEmpty) {
      // A formatter gets the empty read too. "Empty" is a real answer
      // from this protocol — Warnings comes back empty rather than "0" —
      // and only the field knows what that means. Short-circuiting to an
      // em-dash here is why the warnings row said nothing at all.
      return field.format?.call('') ?? '—';
    }
    final f = field.format;
    final base = f == null ? value : f(value);
    // Resolve a coded value to its label where we have one.
    final match = field.choices?.where((c) => c.value == value.trim());
    final labelled = (match != null && match.isNotEmpty) ? match.first.label : base;
    return field.unit == null ? labelled : '$labelled ${field.unit}';
  }
}

class ResolvedGroup {
  const ResolvedGroup({
    required this.title,
    required this.entries,
    this.subtitle,
    this.pinned = false,
  });
  final String title;
  final String? subtitle;
  final List<ResolvedField> entries;
  final bool pinned;
}

/// Build the screen model from what the device exposes plus what it
/// returned. Never invents a field, never shows a value it did not read,
/// and honours conditional visibility so PLC keys stay hidden on Wi-Fi.
List<ResolvedGroup> resolveCapabilities({
  required Set<int> available,
  required Map<int, String> values,
  Map<int, String> pending = const {},
  List<CapabilityGroup> descriptor = kZaptecCapabilities,
}) {
  final out = <ResolvedGroup>[];
  for (final g in descriptor) {
    final entries = <ResolvedField>[];
    for (final f in g.fields) {
      if (!available.contains(f.id)) continue;
      final cond = f.showWhen;
      // Case-insensitive: the charger answers "Wifi", and gating on a
      // literal match against our own spelling is how the Wi-Fi network
      // and password rows came to be permanently hidden.
      if (cond != null &&
          (values[cond.$1] ?? '').trim().toLowerCase() !=
              cond.$2.toLowerCase()) {
        continue;
      }
      entries.add(ResolvedField(
        field: f,
        value: values[f.id],
        pending: pending[f.id],
        runtimeChoices: _parseChoices(f, values),
        blockedReason: _blockedReason(f, values),
      ));
    }
    if (entries.isEmpty) continue;
    out.add(ResolvedGroup(
      title: g.title,
      subtitle: g.subtitle,
      pinned: g.pinned,
      entries: entries,
    ));
  }
  return out;
}

/// Why [f] is unusable given what the charger currently reports, or null.
///
/// Today this only encodes the vehicle-connected precondition, but it is
/// the seam every "not while X" rule belongs in: stated in the descriptor,
/// resolved from live values, rendered as a sentence the driver can act on.
String? _blockedReason(CapabilityField f, Map<int, String> values) {
  final req = f.requiresState;
  if (req == null) return null;
  final actual = (values[req.$1] ?? '').trim();
  if (actual == req.$2) return null;

  // The one precondition that exists so far. Named specifically, because
  // "unavailable" tells a driver standing at a charger nothing.
  if (req.$1 == ZapChar.chargerOperationState) {
    return actual.isEmpty
        ? 'Charger state unknown — cannot run this safely.'
        : 'Unplug the vehicle first. Charger is: ${_operationState(actual).toLowerCase()}.';
  }
  // The standalone gate. Naming the reason matters here: the charger
  // ACCEPTS these writes and silently ignores them, so without an
  // explanation the control looks broken rather than out of scope.
  if (req.$1 == ZapChar.standalone) {
    return 'Set by the installation, not here. This charger is managed '
        'centrally, so its own current and phase limits are ignored.';
  }
  return 'Not available in the charger’s current state.';
}

/// Options the charger enumerated for [f], if it exposes such a list.
///
/// The wire format of `AvailableWifiNetworks` / `AvailableCommunicationModes`
/// is undocumented and unverified, so this parses permissively — split on
/// any plausible delimiter, trim, drop blanks. If the entries look like
/// codes we already have labels for, use the labels; otherwise show the
/// raw entry, which is right for SSIDs.
///
/// Returns null when the charger gave us nothing, so the caller falls back
/// to the fixed list rather than showing an empty picker.
List<Choice>? _parseChoices(CapabilityField f, Map<int, String> values) {
  final src = f.choicesFrom;
  if (src == null) return null;
  final raw = values[src];
  if (raw == null || raw.trim().isEmpty) return null;

  final parts = raw
      .split(RegExp(r'[\n,;|]+'))
      .map((s) => s.trim())
      .where((s) => s.isNotEmpty)
      .toSet()
      .toList();
  if (parts.isEmpty) return null;

  return [
    for (final p in parts)
      Choice(
        p,
        f.choices?.where((c) => c.value == p).firstOrNull?.label ?? p,
      ),
  ];
}

/// Current-choice list for a numeric range field (6–32 A).
List<Choice> numericChoices(CapabilityField f) {
  final min = (f.min ?? 0).round();
  final max = (f.max ?? 0).round();
  final step = (f.step ?? 1).round();
  return [
    for (var v = min; v <= max; v += step) Choice('$v', '$v${f.unit ?? ''}'),
  ];
}
