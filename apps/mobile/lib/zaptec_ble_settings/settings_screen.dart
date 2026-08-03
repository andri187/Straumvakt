// Charger settings — live, hardware-backed. Replaces the visual previews.
//
// Flow, per docs/app/charger-settings-ui-guide.md:
//   menu → picker (live BLE scan) → PIN → settings overview → action
//
// Every value on screen is READ FROM THE CHARGER. Nothing is hardcoded,
// nothing is placeheld: a characteristic the firmware does not expose is
// hidden, and one that returns nothing shows an em-dash. Rule 6.
//
// The screen must stay foregrounded — Android drops BLE scan results for
// backgrounded processes (measured: 45 s vs 0.5 s).

import 'dart:async';

import 'package:flutter/foundation.dart' show kDebugMode;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart' show HapticFeedback;
import 'package:flutter_blue_plus/flutter_blue_plus.dart' show BluetoothDevice;

import '../api/auth_storage.dart';
import '../api/client.dart';
import 'zaptec_ble.dart';
import 'charger_capabilities.dart';
import 'pin_store.dart';
import 'session_guard.dart';
import '../theme/palette.dart';
import 'settings_controls.dart';

// ── Picker ───────────────────────────────────────────────────────────

class ChargerPickerScreen extends StatefulWidget {
  const ChargerPickerScreen({super.key});

  @override
  State<ChargerPickerScreen> createState() => _ChargerPickerScreenState();
}

class _ChargerPickerScreenState extends State<ChargerPickerScreen> {
  final _seen = <String, ZaptecNearby>{};
  StreamSubscription<ZaptecNearby>? _sub;
  String? _error;

  @override
  void initState() {
    super.initState();
    _start();
  }

  void _start() {
    _sub = ZaptecBle.scan().listen(
      (hit) {
        if (!mounted) return;
        setState(() => _seen[hit.serial] = hit);
      },
      onError: (Object e) {
        if (mounted) setState(() => _error = '$e');
      },
    );
  }

  @override
  void dispose() {
    _sub?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final items = _seen.values.toList()
      ..sort((a, b) => b.rssi.compareTo(a.rssi));

    return Scaffold(
      backgroundColor: BrandPalette.midnight,
      appBar: AppBar(
        backgroundColor: BrandPalette.midnight,
        foregroundColor: Colors.white,
        title: const Text('Charger settings',
            style: TextStyle(fontWeight: FontWeight.w900)),
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(20, 12, 20, 28),
        children: [
          Row(
            children: [
              const SizedBox(
                width: 14,
                height: 14,
                child: CircularProgressIndicator(
                  strokeWidth: 2,
                  color: BrandPalette.cyan,
                ),
              ),
              const SizedBox(width: 12),
              Text(
                'Searching for chargers nearby…',
                style: TextStyle(color: BrandPalette.muted, fontSize: 13),
              ),
            ],
          ),
          const SizedBox(height: 18),
          if (_error != null)
            _Banner(
              icon: Icons.error_outline_rounded,
              tint: BrandPalette.amber,
              text: _error!,
            ),
          if (items.isEmpty && _error == null)
            Padding(
              padding: const EdgeInsets.only(top: 40),
              child: Center(
                child: Text(
                  'No charger found yet.\nMove closer to the charger.',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: BrandPalette.muted, fontSize: 13),
                ),
              ),
            ),
          for (final c in items) _ChargerRow(nearby: c),
        ],
      ),
    );
  }
}

class _ChargerRow extends StatelessWidget {
  const _ChargerRow({required this.nearby});
  final ZaptecNearby nearby;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      decoration: BoxDecoration(
        color: BrandPalette.surface,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: BrandPalette.border),
      ),
      child: ListTile(
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
        leading: _Bars(bars: nearby.bars),
        title: Text(
          nearby.serial,
          style: const TextStyle(
            color: Colors.white,
            fontWeight: FontWeight.w800,
          ),
        ),
        subtitle: Text(
          nearby.distanceLabel,
          style: const TextStyle(color: BrandPalette.muted, fontSize: 12),
        ),
        trailing: const Icon(Icons.chevron_right_rounded,
            color: BrandPalette.muted),
        onTap: () => _open(context, nearby),
      ),
    );
  }
}

class _Bars extends StatelessWidget {
  const _Bars({required this.bars});
  final int bars;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.end,
      children: List.generate(4, (i) {
        final on = i < bars;
        return Container(
          width: 4,
          height: 6.0 + i * 4,
          margin: const EdgeInsets.only(right: 2),
          decoration: BoxDecoration(
            color: on ? BrandPalette.cyan : BrandPalette.border,
            borderRadius: BorderRadius.circular(1),
          ),
        );
      }),
    );
  }
}

/// Open a charger's settings. The driver never types a PIN and never sees
/// one — the credential path is, in order:
///
///   1. secure store (Keystore/Keychain-backed, per charger, TTL'd)
///   2. backend, on first use for a charger the driver has access to
///   3. one-time manual entry — fallback only, and only until the backend
///      endpoint lands (Rule 5: privilege-gated credential release)
///
/// Whatever is obtained is cached, so step 3 happens at most once per
/// charger and never again.
Future<void> _open(BuildContext context, ZaptecNearby nearby) async {
  final serial = nearby.serial;
  final store = ChargerPinStore();
  final api = StraumvaktApi();
  final token = await AuthStorage().readAccessToken();

  // 0 — a driver may not open settings on a charger someone else is
  // charging on. Checked BEFORE the credential path, so a refusal never
  // costs a PIN fetch or a BLE connection. This call also reconciles the
  // PIN cache against the driver's current access list.
  if (token != null) {
    final access = await checkSettingsAccess(
      api: api,
      accessToken: token,
      serial: serial,
      pinStore: store,
    );
    // Bench: `bleAdvertisingId` is null on every charger in staging, so
    // the guard cannot map a scanned serial to the driver's list and
    // correctly refuses everything. Until that field is populated (or the
    // guard matches on serial per ADR 0024's addendum), debug builds warn
    // instead of blocking. `busyWithOtherDriver` is NEVER bypassed — that
    // one is a real answer, not a missing-data artefact.
    final bypass = kDebugMode && access.access == SettingsAccess.unknown;

    if (!access.isAllowed && !bypass) {
      if (!context.mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            access.access == SettingsAccess.busyWithOtherDriver
                ? 'This charger is in use by another driver.'
                : 'Cannot open settings for this charger right now.',
          ),
        ),
      );
      return;
    }
  }

  // 1 — already held?
  if (await store.has(serial)) {
    if (!context.mounted) return;
    _push(context, serial, store, nearby.device);
    return;
  }

  // 2 — ask the backend. Null today (endpoint not built); the call is
  // here so the flow is complete the moment it is.
  if (token != null) {
    final pin = await StraumvaktApi()
        .getChargerBlePin(accessToken: token, serial: serial);
    if (pin != null) {
      await store.put(serial, pin);
      if (!context.mounted) return;
      _push(context, serial, store, nearby.device);
      return;
    }
  }

  // 3 — no credential, no settings.
  //
  // The driver NEVER knows or types the PIN. It is released to the DEVICE
  // by the backend as part of the access grant, held in Keystore/Keychain,
  // and used without ever surfacing. If the backend has not released one,
  // local settings are simply unavailable — asking the driver for it would
  // defeat the entire model.
  if (!context.mounted) return;

  if (kDebugMode) {
    // Bench provisioning, standing in for the unbuilt release endpoint so
    // the flow can be exercised against real hardware exactly as a driver
    // would experience it — the device already holds the PIN, nothing is
    // typed.
    //
    // Supplied at BUILD time, never in source:
    //   flutter build apk --debug --dart-define=BENCH_PIN=####
    //
    // A compile-time define keeps the credential out of the repository and
    // out of release builds (kDebugMode gates it regardless). Delete this
    // branch when GET /api/driver/chargers/{serial}/ble-pin is deployed —
    // the code path above it is already the real one.
    const benchPin = String.fromEnvironment('BENCH_PIN');
    if (benchPin.isNotEmpty) {
      await store.put(serial, benchPin);
      if (!context.mounted) return;
      _push(context, serial, store, nearby.device);
      return;
    }

    // No define supplied — fall back to one-time entry so a bench without
    // the flag still works.
    final entered = await _askPin(context, serial);
    if (entered == null || entered.isEmpty || !context.mounted) return;
    await store.put(serial, entered);
    if (!context.mounted) return;
    _push(context, serial, store, nearby.device);
    return;
  }

  ScaffoldMessenger.of(context).showSnackBar(
    const SnackBar(
      content: Text('Local settings are not enabled for this charger.'),
    ),
  );
}

void _push(BuildContext context, String serial, ChargerPinStore store,
    BluetoothDevice device) {
  Navigator.of(context).push(
    MaterialPageRoute(
      builder: (_) =>
          ChargerSettingsScreen(serial: serial, pinStore: store, device: device),
    ),
  );
}

/// One-time fallback entry. Temporary: it disappears when the backend
/// serves PINs. Hardcoding one here would have been the wrong shortcut.
Future<String?> _askPin(BuildContext context, String serial) {
  final controller = TextEditingController();
  return showModalBottomSheet<String>(
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
          Text('PIN for $serial',
              style: const TextStyle(
                color: Colors.white,
                fontSize: 18,
                fontWeight: FontWeight.w900,
              )),
          const SizedBox(height: 6),
          const Text(
            'The four-digit code printed on the charger.',
            style: TextStyle(color: BrandPalette.muted, fontSize: 12),
          ),
          const SizedBox(height: 8),
          // Not decoration — a wrong PIN disables the charger's Bluetooth
          // for escalating periods, and on an offline charger that is the
          // last channel to it.
          const Text(
            'Entering it wrong repeatedly disables the charger’s Bluetooth '
            'for a while. There is no automatic retry.',
            style: TextStyle(color: BrandPalette.amber, fontSize: 11),
          ),
          const SizedBox(height: 16),
          TextField(
            controller: controller,
            autofocus: true,
            keyboardType: TextInputType.number,
            maxLength: 4,
            style: const TextStyle(
              color: Colors.white,
              fontSize: 24,
              letterSpacing: 8,
              fontWeight: FontWeight.w900,
            ),
            textAlign: TextAlign.center,
            decoration: const InputDecoration(counterText: ''),
          ),
          const SizedBox(height: 12),
          FilledButton(
            onPressed: () => Navigator.of(ctx).pop(controller.text.trim()),
            child: const Text('Connect'),
          ),
        ],
      ),
    ),
  );
}

// ── Settings overview ────────────────────────────────────────────────

class ChargerSettingsScreen extends StatefulWidget {
  const ChargerSettingsScreen({
    super.key,
    required this.serial,
    required this.pinStore,
    this.device,
  });

  final String serial;

  /// The store, not the PIN. The screen never holds the credential in a
  /// field where it could be logged, rendered, or captured in an error —
  /// it is handed to the BLE connect inside a callback and released.
  final ChargerPinStore pinStore;

  /// The device the picker already discovered. Passing it avoids a second
  /// scan — Android connects unreliably while scanning.
  final BluetoothDevice? device;

  @override
  State<ChargerSettingsScreen> createState() => _ChargerSettingsScreenState();
}

enum _Phase { connecting, loaded, failed }

/// Serials already swept this app run. Process-wide, so reopening a
/// charger's settings does not pay for the diagnostic a second time.
final Set<String> _swept = <String>{};

class _ChargerSettingsScreenState extends State<ChargerSettingsScreen> {
  ZaptecBleSession? _session;
  List<ResolvedGroup> _groups = const [];

  /// Last raw read, kept so the fault banner reads the charger's own
  /// bitmask rather than re-deriving it from a rendered string.
  Map<int, String> _values = const {};

  /// Edits made but not yet written, keyed by characteristic id.
  ///
  /// This is the whole difference between "the screen shows what the
  /// charger says" and "the screen shows what you asked for". Both are
  /// rendered — the control shows the pending value, the review sheet
  /// shows current → pending — and nothing here has touched the hardware.
  final Map<int, String> _pending = {};

  /// Rebuild the rendered groups from the last read plus pending edits.
  void _rebuild() {
    final session = _session;
    if (session == null) return;
    _groups = resolveCapabilities(
      available: session.available,
      values: _values,
      pending: _pending,
    );
  }
  _Phase _phase = _Phase.connecting;
  String? _error;
  bool _busy = false;

  /// 'granted' | 'pending' | 'locked'. Starts locked and only ever opens
  /// on an explicit positive from the backend — fail closed.
  String _grant = 'locked';


  @override
  void initState() {
    super.initState();
    _connect();
  }

  Future<void> _connect() async {
    setState(() {
      _phase = _Phase.connecting;
      _error = null;
    });
    try {
      // The PIN is handed straight to the connect call inside the store's
      // callback and never lands in a field on this State object.
      // Hard deadline on the WHOLE attempt.
      //
      // The internals could otherwise run ~50 s before giving up: a 20 s
      // scan window, then two GATT attempts with a backoff between them.
      // Observed on the bench — the charger was powered off mid-connect
      // and the app sat spinning with no way out. A charger that has not
      // answered in 25 s is not going to.
      final session = await widget.pinStore
          .use(
            widget.serial,
            (pin) => ZaptecBle.connect(
                serial: widget.serial, pin: pin, device: widget.device),
          )
          .timeout(
        const Duration(seconds: 25),
        onTimeout: () =>
            throw const ZapBleException(ZapBleFailure.notFound, 'timed out'),
      );
      if (session == null) {
        // Cache expired or was cleared between picker and here.
        if (!mounted) return;
        setState(() {
          _phase = _Phase.failed;
          _error = 'Charger credentials unavailable. Try again.';
        });
        return;
      }
      // Read only what this charger actually exposes.
      // Read only what this charger actually exposes, and skip secrets —
      // WifiPSK and the PLC keys are write-only (props 0x8) and reading
      // them errors rather than returning anything.
      final wanted = _readSet(session);
      // Advanced settings require an explicit grant from a host-admin or
      // the CPO — network re-provisioning, current limits and PLC keys can
      // strand the charger, so they are not a driver capability.
      //
      // Checked BEFORE reading: if the driver cannot see Advanced there is
      // no reason to pull 30 characteristics off the charger.
      final token = await AuthStorage().readAccessToken();
      _grant = token == null
          ? 'locked'
          : await StraumvaktApi().getAdvancedSettingsGrant(
              accessToken: token,
              serial: widget.serial,
            );

      // Bench only. The grant endpoint is Rule 5 and unbuilt, so in debug
      // builds we unlock Advanced to exercise it against real hardware.
      //
      // Deliberately NOT keyed on an account: an identity-based bypass
      // compiled into the client would ship to every device, could not be
      // revoked, and would make the approval gate a fiction. Whose account
      // holds the grant is backend data, not app code.
      //
      // Release builds are unaffected — they stay locked until the backend
      // says otherwise. Delete this with the debug PIN branch.
      //
      // 2026-08-03: the bypass now needs an EXPLICIT flag rather than
      // firing on every debug build. Of everything behind Advanced, only
      // brightness, lock-cable and the beep are verified; standalone and
      // phases are governed by the installation; grid test is accepted
      // and does nothing; comm mode and the Wi-Fi/PLC credentials can
      // strand the charger and have never been exercised. Opening all of
      // that by default, to anyone running a debug build, is not a
      // defensible default while it is this unfinished.
      //
      //   flutter build apk --debug --dart-define=ADVANCED=true
      const advancedFlag = String.fromEnvironment('ADVANCED');
      final advancedUnlocked = advancedFlag == '1' || advancedFlag == 'true';
      if (kDebugMode && advancedUnlocked && _grant != 'granted') {
        _grant = 'granted';
      }

      final values =
          _grant == 'granted' ? await session.readAll(wanted) : <int, String>{};
      if (!mounted) {
        await session.close();
        return;
      }
      // Diagnostic only, and ONCE per charger per app run. It reads every
      // characteristic serially — 34 of them at 60–150 ms each, on top of
      // the descriptor read that follows — which is several seconds of
      // staring at a spinner. Useful the first time to learn what a unit
      // exposes; pure cost on every reconnect after that.
      // Measured 7.3 s on ZPR074002 — 34 serial reads, one of which
      // (AvailableWifiNetworks) alone takes 1.9 s and returns nothing.
      // Its questions are answered: we know the characteristic count and
      // what each one holds. Off unless explicitly asked for:
      //   flutter build apk --debug --dart-define=BLE_SWEEP=1
      // NB: bool.fromEnvironment only accepts 'true'/'false'. Passing
      // BLE_SWEEP=1 yields FALSE silently, which is why the sweep did not
      // run on the first 6.3.2.0 build. Use String and compare.
      const sweepFlag = String.fromEnvironment('BLE_SWEEP');
      final sweepOn = sweepFlag == '1' || sweepFlag == 'true';
      if (kDebugMode && sweepOn && _swept.add(widget.serial)) {
        await _sweep(session);
      }

      // Chirp, so the driver knows WHICH charger they just connected to.
      //
      // Verified on hardware 2026-08-03: writing Indicate (0xFCDB) makes
      // the unit beep. The vendor app does this on every connect — it was
      // the audible difference between their app and ours, spotted on the
      // bench — and in a row of identical chargers in a basement it is
      // the only confirmation that exists outside the screen.
      //
      // Fire and forget: a charger that ignores it is not a failure, and
      // failing a settings session over a missed beep would be absurd.
      try {
        await session.writeString(ZapChar.indicate, '1');
      } catch (e) {
        if (kDebugMode) debugPrint('[charger-settings] indicate failed: $e');
      }

      setState(() {
        _session = session;
        _values = values;
        _groups = _grant == 'granted'
            ? resolveCapabilities(
                available: session.available,
                values: values,
              )
            : const [];
        _phase = _Phase.loaded;
      });
    } on ZapBleException catch (e) {
      if (!mounted) return;
      setState(() {
        _phase = _Phase.failed;
        _error = switch (e.failure) {
          ZapBleFailure.bluetoothOff => 'Turn on Bluetooth to continue.',
          ZapBleFailure.permissionDenied =>
            'Bluetooth permission is needed to reach the charger.',
          ZapBleFailure.notFound =>
            'Could not find ${widget.serial}. Move closer to the charger.',
          ZapBleFailure.connectFailed => 'Could not connect. Try again.',
          ZapBleFailure.serviceMissing =>
            'This charger does not expose settings over Bluetooth.',
          ZapBleFailure.authFailed => 'Wrong PIN.',
          ZapBleFailure.disconnected => 'Connection lost.',
        };
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _phase = _Phase.failed;
        _error = 'Settings unavailable.';
      });
    }
  }

  @override
  void dispose() {
    _session?.close();
    super.dispose();
  }

  /// Write a setting, then READ IT BACK.
  ///
  /// A GATT write returning success means the stack accepted the bytes,
  /// not that the charger applied them. The row must show what the charger
  /// says afterwards, never what we sent — otherwise the UI cheerfully
  /// reports a change that never happened.
  /// True when [got] is the charger's way of saying [wanted].
  ///
  /// Numeric where both sides parse ("32" == "32.0", "0.75" == "0.750"),
  /// case-insensitive otherwise ("Standalone" == "standalone").
  static bool _accepted(String wanted, String got) {
    final a = double.tryParse(wanted);
    final b = double.tryParse(got);
    if (a != null && b != null) return (a - b).abs() < 0.005;
    return wanted.trim().toLowerCase() == got.trim().toLowerCase();
  }

  /// Stage an edit. Nothing reaches the charger until the driver applies.
  ///
  /// Config values are batched behind an explicit review-and-apply step so
  /// several related settings can be checked together before any of them
  /// lands. Commands (reboot, grid test, firmware) are NOT staged — they
  /// are verbs, not values, and there is nothing to review.
  void _stageField(CapabilityField field, String value) {
    setState(() {
      // Choosing the value it already has clears the edit rather than
      // recording a no-op change.
      if (_sameWire((_values[field.id] ?? '').trim(), value)) {
        _pending.remove(field.id);
      } else {
        _pending[field.id] = value;
      }
      _rebuild();
    });
  }

  void _discardPending() => setState(() {
        _pending.clear();
        _rebuild();
      });

  /// Numeric-tolerant wire comparison ("32" == "32.0"), case-insensitive
  /// otherwise ("Standalone" == "standalone").
  static bool _sameWire(String a, String b) {
    final x = double.tryParse(a);
    final y = double.tryParse(b);
    if (x != null && y != null) return (x - y).abs() < 0.005;
    return a.trim().toLowerCase() == b.trim().toLowerCase();
  }

  /// Write one staged value and report what the charger reads back.
  ///
  /// Returns the value the charger holds afterwards, or null if it
  /// refused every encoding. Never assumes success: a GATT write
  /// returning OK means the stack accepted the bytes, not that the
  /// firmware applied them.
  Future<String?> _applyOne(CapabilityField field, String value) async {
    final session = _session;
    if (session == null) return null;

    // Every encoding worth trying, primary first. Numeric fields get
    // their decimal and integer spellings added automatically:
    // StandaloneCurrent reports "32.0", so it is a decimal field, and a
    // bare "16" may be parsed as a different type and dropped. Which
    // spelling this firmware wants is undocumented; read-back is the
    // only way to find out.
    final n = double.tryParse(value);
    final attempts = <String>{
      value,
      ...?field.alternates?[value],
      if (n != null) ...[n.toStringAsFixed(1), n.round().toString()],
    }.toList();

    String? lastRead;
    for (final wire in attempts) {
      await session.writeString(field.id, wire);
      // A short settle: the firmware applies asynchronously and an
      // immediate read can return the previous value.
      await Future.delayed(const Duration(milliseconds: 60));
      final got = (await session.readString(field.id))?.trim() ?? '';
      lastRead = got;
      if (kDebugMode) {
        debugPrint('[charger-settings] ${field.label}: wrote "$wire" '
            '-> read "$got"');
      }
      _values = Map<int, String>.from(_values)..[field.id] = got;
      if (_accepted(wire, got)) return got;
    }
    return lastRead == null ? null : null;
  }

  /// Review and apply every staged change.
  ///
  /// The confirmation lives HERE rather than on each control, so the
  /// driver sees the whole set at once and judges it together — a phase
  /// change and a current change are a different decision side by side
  /// than one at a time.
  ///
  /// This is a batch, NOT a transaction. GATT has no commit and no
  /// rollback, so the result screen reports each field separately and
  /// anything the charger refused stays staged for another go. Saying
  /// "Saved" over a half-applied batch would be the one genuinely
  /// dishonest thing this screen could do.
  Future<void> _applyPending() async {
    if (_pending.isEmpty || _busy) return;

    final edits = <(CapabilityField, String)>[];
    for (final g in _groups) {
      for (final e in g.entries) {
        final v = _pending[e.field.id];
        if (v != null) edits.add((e.field, v));
      }
    }
    if (edits.isEmpty) return;

    final ok = await _confirmApply(edits);
    if (ok != true || !mounted) return;

    setState(() => _busy = true);
    final refused = <CapabilityField>[];
    final applied = <CapabilityField>[];
    try {
      for (final (field, value) in edits) {
        try {
          final landed = await _applyOne(field, value);
          if (landed == null) {
            refused.add(field);
          } else {
            applied.add(field);
            _pending.remove(field.id);
          }
        } catch (e) {
          if (kDebugMode) {
            debugPrint('[charger-settings] apply ${field.label} threw: $e');
          }
          refused.add(field);
        }
      }
    } finally {
      if (mounted) {
        setState(() {
          _busy = false;
          _rebuild();
        });
      }
    }

    if (!mounted) return;
    _showApplyResult(applied: applied, refused: refused);
  }

  /// One dialog for the whole set, carrying the highest danger tier in
  /// it. A destructive field anywhere makes the whole batch destructive.
  Future<bool?> _confirmApply(List<(CapabilityField, String)> edits) {
    final worst = edits.fold<Danger>(
      Danger.safe,
      (d, e) => e.$1.danger.index > d.index ? e.$1.danger : d,
    );
    final entriesById = {
      for (final g in _groups)
        for (final e in g.entries) e.field.id: e,
    };

    return showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: BrandPalette.surface,
        title: Text(
          edits.length == 1
              ? 'Apply this change?'
              : 'Apply ${edits.length} changes?',
          style: const TextStyle(color: Colors.white),
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            for (final (field, _) in edits)
              Padding(
                padding: const EdgeInsets.only(bottom: 10),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(field.label,
                        style: const TextStyle(
                          color: BrandPalette.muted,
                          fontSize: 11,
                          fontWeight: FontWeight.w700,
                        )),
                    Row(
                      children: [
                        Text(
                          entriesById[field.id]?.committedDisplay ?? '—',
                          style: const TextStyle(
                            color: BrandPalette.muted,
                            fontSize: 13,
                            decoration: TextDecoration.lineThrough,
                          ),
                        ),
                        const Padding(
                          padding: EdgeInsets.symmetric(horizontal: 8),
                          child: Icon(Icons.arrow_forward_rounded,
                              size: 13, color: BrandPalette.muted),
                        ),
                        Flexible(
                          child: Text(
                            entriesById[field.id]?.display ?? '',
                            style: const TextStyle(
                              color: Colors.white,
                              fontSize: 13,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            const SizedBox(height: 4),
            Text(
              switch (worst) {
                Danger.destructive =>
                  'If any of this is wrong the charger loses its '
                      'connection and can only be fixed on site over '
                      'Bluetooth.',
                Danger.caution =>
                  'Charging will be interrupted while these take effect.',
                Danger.safe => '',
              },
              style: TextStyle(
                color: worst == Danger.destructive
                    ? BrandPalette.amber
                    : BrandPalette.muted,
                fontSize: 12,
              ),
            ),
            const SizedBox(height: 8),
            const Text(
              'Each change is sent and read back one at a time. If the '
              'charger refuses one, the rest still apply.',
              style: TextStyle(color: BrandPalette.muted, fontSize: 11),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () {
              HapticFeedback.mediumImpact();
              Navigator.of(ctx).pop(true);
            },
            child: Text(worst == Danger.destructive ? 'Apply anyway' : 'Apply'),
          ),
        ],
      ),
    );
  }

  /// Per-field outcome. A batch that half-lands says so.
  void _showApplyResult({
    required List<CapabilityField> applied,
    required List<CapabilityField> refused,
  }) {
    if (refused.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text(applied.length == 1
            ? '${applied.first.label} updated.'
            : '${applied.length} settings updated.'),
      ));
      return;
    }

    final names = refused.map((f) => f.label.toLowerCase()).join(', ');
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      duration: const Duration(seconds: 6),
      content: Text(
        applied.isEmpty
            ? 'The charger refused every change ($names). Nothing was '
                'altered.'
            : '${applied.length} applied. The charger refused: $names. '
                'Those are still pending.',
      ),
    ));
  }

  /// Fire an action. Two shapes: a RunCommand value, or a write of "1" to
  /// the field's own characteristic (grid test works that way).
  Future<void> _runAction(CapabilityField field) async {
    final session = _session;
    if (session == null || _busy) return;
    setState(() => _busy = true);
    try {
      if (field.command != null) {
        await session.sendCommand(field.command!);
      } else {
        await session.writeString(field.id, '1');
      }
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('${field.label} started.')),
      );
      await _refreshValues(session);
    } catch (e) {
      if (kDebugMode) debugPrint('[charger-settings] action ${field.label} failed: $e');
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('${field.label} failed.')),
      );
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// Everything worth reading off this charger.
  ///
  /// Field ids, PLUS the `choicesFrom` characteristics that enumerate
  /// options — `AvailableWifiSsids` and `AvailableCommunicationModes`.
  ///
  /// Those were missing, and it was not cosmetic. `_parseChoices` looks
  /// up `values[choicesFrom]`, which was never populated, so
  /// `runtimeChoices` was always null. The Wi-Fi picker has no static
  /// fallback, so it resolved to an empty list and the sheet closed
  /// instantly — that is the "no networks" you reported. And the
  /// comm-mode picker silently fell back to our hardcoded list, which
  /// offers LTE. This charger reports `CommunicationModes: [WiFi, PLC]`
  /// — no LTE at all. So we were offering a mode the hardware cannot do
  /// while ignoring the charger's own answer.
  ///
  /// Excluded: secrets (write-only, reading them errors) and actions
  /// (commands, not values — `RunCommand` reads have thrown in every log
  /// tonight).
  Iterable<int> _readSet(ZaptecBleSession session) {
    final fields = kZaptecCapabilities.expand((g) => g.fields);
    return <int>{
      for (final f in fields)
        if (f.control != Control.secret && f.control != Control.action) f.id,
      for (final f in fields)
        if (f.choicesFrom != null) f.choicesFrom!,
    }.where(session.has);
  }

  /// Debug-only: read EVERY characteristic the charger exposes, not just
  /// the ones in the descriptor, and log id + value.
  ///
  /// Two questions this answers and nothing else does: exactly how many
  /// characteristics this firmware exposes (the "34" in the header was
  /// counted through a truncated pipe and has never been confirmed), and
  /// where a fault the descriptor does not cover is actually reported.
  /// Write-only ids are skipped — reading them returns a GATT error, not
  /// information.
  Future<void> _sweep(ZaptecBleSession session) async {
    const writeOnly = {
      ZapChar.wifiPsk,
      ZapChar.authorization,
      ZapChar.indicate,
      ZapChar.runCommand,
      ZapChar.plcNpw,
    };
    final ids = session.available.toList()..sort();
    debugPrint('[zaptec-ble] SWEEP ${widget.serial}: '
        '${ids.length} characteristics exposed');
    for (final id in ids) {
      final hex = '0x${id.toRadixString(16).toUpperCase()}';
      if (writeOnly.contains(id)) {
        debugPrint('[zaptec-ble] SWEEP $hex = <write-only>');
        continue;
      }
      final v = await session.readString(id);
      debugPrint('[zaptec-ble] SWEEP $hex = ${v == null ? '<no read>' : '"$v"'}');
    }
  }

  Future<void> _refreshValues(ZaptecBleSession session) async {
    final wanted = _readSet(session);
    final values = await session.readAll(wanted);
    if (kDebugMode) {
      // Raw values, so undocumented formats (NetworkStatus, the
      // Available* enumerations) can be decoded from a real device rather
      // than guessed at.
      values.forEach((id, v) => debugPrint(
          '[zaptec-ble] 0x${id.toRadixString(16).toUpperCase()} = "$v"'));
    }
    if (!mounted) return;
    setState(() {
      _values = values;
      _groups = resolveCapabilities(
        available: session.available,
        values: values,
      );
    });
  }

  Future<void> _restart() async {
    final session = _session;
    if (session == null || _busy) return;

    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: BrandPalette.surface,
        title: const Text('Restart charger?',
            style: TextStyle(color: Colors.white)),
        content: const Text(
          'The charger goes offline for a minute or two. Any session in '
          'progress will stop.',
          style: TextStyle(color: BrandPalette.muted),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            child: const Text('Restart'),
          ),
        ],
      ),
    );
    if (ok != true) return;

    setState(() => _busy = true);
    try {
      // A BLE link that has been sitting idle while the driver reads the
      // screen may already be gone — the charger or the stack closes it
      // and nothing tells us until a write fails. Observed on the bench:
      // reads succeeded, the link dropped, and the reboot write landed in
      // a dead session.
      //
      // So: try, and on failure re-establish once and try again. Re-auth
      // uses the same stored PIN that already succeeded, so this cannot
      // walk into the charger's wrong-PIN lockout.
      try {
        await session.sendCommand(ZapCommand.reboot);
      } catch (first) {
        if (kDebugMode) debugPrint('[charger-settings] reboot failed, reconnecting: $first');
        await session.close();
        final fresh = await widget.pinStore.use(
          widget.serial,
          (pin) => ZaptecBle.connect(
              serial: widget.serial, pin: pin, device: widget.device),
        );
        if (fresh == null) rethrow;
        _session = fresh;
        await fresh.sendCommand(ZapCommand.reboot);
      }
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Restart sent — charger is rebooting.')),
      );
      Navigator.of(context).pop();
    } catch (e) {
      if (kDebugMode) debugPrint('[charger-settings] restart failed: $e');
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            e is ZapBleException && e.failure == ZapBleFailure.notFound
                ? 'Lost the charger. Move closer and try again.'
                : 'Restart failed — could not reach the charger.',
          ),
        ),
      );
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: BrandPalette.midnight,
      // Pinned to the bottom rather than placed at the end of the list:
      // with several groups expanded the driver would have to scroll to
      // find it, and an unapplied change that scrolls out of sight is an
      // unapplied change that gets forgotten.
      bottomNavigationBar: _pending.isEmpty
          ? null
          : _SaveBar(
              count: _pending.length,
              busy: _busy,
              onApply: _applyPending,
              onDiscard: _discardPending,
            ),
      appBar: AppBar(
        backgroundColor: BrandPalette.midnight,
        foregroundColor: Colors.white,
        titleSpacing: 0,
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(widget.serial,
                style: const TextStyle(fontWeight: FontWeight.w900)),
            const Text('Connected over Bluetooth',
                style: TextStyle(color: BrandPalette.muted, fontSize: 12)),
          ],
        ),
      ),
      body: switch (_phase) {
        // A spinner with no exit is not acceptable for something talking
        // to hardware over an unreliable link. The charger can be
        // switched off mid-connect — it was, on the bench — and the
        // driver must be able to walk away without force-quitting.
        _Phase.connecting => Center(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const CircularProgressIndicator(color: BrandPalette.cyan),
                const SizedBox(height: 20),
                Text('Connecting to ${widget.serial}…',
                    style: const TextStyle(
                        color: BrandPalette.muted, fontSize: 13)),
                const SizedBox(height: 16),
                TextButton(
                  onPressed: () => Navigator.of(context).maybePop(),
                  child: const Text('Cancel'),
                ),
              ],
            ),
          ),
        _Phase.failed => Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                _Banner(
                  icon: Icons.error_outline_rounded,
                  tint: BrandPalette.amber,
                  text: _error ?? 'Settings unavailable.',
                ),
                const SizedBox(height: 16),
                FilledButton(
                  onPressed: _connect,
                  child: const Text('Try again'),
                ),
              ],
            ),
          ),
        // Restart is the only top-level action — it is what a driver at an
        // offline charger actually came for. Everything else is diagnostic
        // or configuration and lives behind Advanced, collapsed, so the
        // primary path is one tap and the destructive surface is not
        // presented by default.
        // Pull to refresh is the full re-read. Writes only re-read the
        // field they touched, so this is how a driver asks for everything
        // — deliberately, knowing it takes a moment.
        _Phase.loaded => RefreshIndicator(
            color: BrandPalette.cyan,
            backgroundColor: BrandPalette.surface,
            onRefresh: () async {
              final s = _session;
              if (s != null) await _refreshValues(s);
            },
            child: ListView(
            padding: const EdgeInsets.fromLTRB(20, 12, 20, 28),
            children: [
              const _Banner(
                icon: Icons.bluetooth_connected_rounded,
                tint: BrandPalette.amber,
                text: 'Local connection. Keep the phone near the charger.',
              ),
              // RESTART IS THE SCREEN.
              //
              // It is the one operation verified end to end on hardware,
              // and the one a driver at a charger that has fallen off the
              // network actually came for. Everything else is either
              // unverified, governed by the installation rather than the
              // charger, or diagnostic — so it sits behind Advanced and
              // Advanced is locked.
              //
              // State / Warnings / Firmware / Grid moved down there too.
              // They read fine, but a readout the driver cannot act on is
              // not worth the space above the fold, and Warnings in
              // particular reports nothing at all over BLE on either
              // firmware we have tested.
              const SizedBox(height: 20),
              FilledButton.icon(
                onPressed: _busy ? null : _restart,
                icon: const Icon(Icons.restart_alt_rounded),
                label: const Text('Restart charger'),
                style: FilledButton.styleFrom(
                  padding: const EdgeInsets.symmetric(vertical: 16),
                ),
              ),
              const SizedBox(height: 8),
              const Text(
                'Fixes a charger that has dropped off the network.',
                textAlign: TextAlign.center,
                style: TextStyle(color: BrandPalette.muted, fontSize: 12),
              ),
              const SizedBox(height: 24),
              if (_grant == 'granted')
                _AdvancedSection(
                  groups: _groups,
                  onWrite: _stageField,
                  onAction: _runAction,
                  busy: _busy,
                )
              else
                const _AdvancedLocked(),
            ],
          ),
          ),
      },
    );
  }
}

// ── Shared bits ──────────────────────────────────────────────────────

/// Advanced without approval. Shown instead of the section — not a greyed
/// version of it, because a driver should not be able to see what they
/// cannot touch, and the values are never read from the charger at all.
/// Advanced, locked.
///
/// Looks like the real section — same card, same chevron — so the
/// driver can see it exists and that it is not for them. Tapping says
/// so rather than doing nothing, because a control that swallows taps
/// silently reads as broken.
///
/// No "request access" affordance: there is no endpoint behind it, and
/// a button that pretends to file a request nobody receives is worse
/// than no button. Access is granted operator-side.
class _AdvancedLocked extends StatelessWidget {
  const _AdvancedLocked();

  @override
  Widget build(BuildContext context) {
    return InkWell(
      borderRadius: BorderRadius.circular(14),
      onTap: () {
        HapticFeedback.mediumImpact();
        showDialog<void>(
          context: context,
          builder: (ctx) => AlertDialog(
            backgroundColor: BrandPalette.surface,
            title: const Text('Access restricted',
                style: TextStyle(color: Colors.white)),
            content: const Text(
              'Advanced settings change how the charger connects and how '
              'much current it delivers. Some of them can take it offline '
              'until someone visits it.\n\n'
              'Your operator or site admin can give you access.',
              style: TextStyle(color: BrandPalette.muted),
            ),
            actions: [
              FilledButton(
                onPressed: () => Navigator.of(ctx).pop(),
                child: const Text('OK'),
              ),
            ],
          ),
        );
      },
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
        decoration: BoxDecoration(
          color: BrandPalette.surface,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: BrandPalette.border),
        ),
        child: Row(
          children: [
            const Icon(Icons.lock_outline_rounded,
                color: BrandPalette.muted, size: 20),
            const SizedBox(width: 12),
            const Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Advanced settings',
                      style: TextStyle(
                        color: Colors.white,
                        fontWeight: FontWeight.w800,
                        fontSize: 15,
                      )),
                  Text('Restricted',
                      style: TextStyle(
                          color: BrandPalette.muted, fontSize: 12)),
                ],
              ),
            ),
            const Icon(Icons.chevron_right_rounded,
                color: BrandPalette.muted),
          ],
        ),
      ),
    );
  }
}

class _AdvancedSection extends StatefulWidget {
  const _AdvancedSection({
    required this.groups,
    required this.onWrite,
    required this.onAction,
    required this.busy,
  });
  final List<ResolvedGroup> groups;
  final WriteField onWrite;
  final RunAction onAction;
  final bool busy;

  @override
  State<_AdvancedSection> createState() => _AdvancedSectionState();
}

class _AdvancedSectionState extends State<_AdvancedSection> {
  bool _open = false;

  @override
  Widget build(BuildContext context) {
    final fieldCount =
        widget.groups.fold<int>(0, (n, g) => n + g.entries.length);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        InkWell(
          onTap: () => setState(() => _open = !_open),
          borderRadius: BorderRadius.circular(14),
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
            decoration: BoxDecoration(
              color: BrandPalette.surface,
              borderRadius: BorderRadius.circular(14),
              border: Border.all(color: BrandPalette.border),
            ),
            child: Row(
              children: [
                const Icon(Icons.tune_rounded,
                    color: BrandPalette.muted, size: 20),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        'Advanced settings',
                        style: TextStyle(
                          color: Colors.white,
                          fontWeight: FontWeight.w800,
                          fontSize: 15,
                        ),
                      ),
                      Text(
                        // Read from the charger, so it says what this
                        // firmware actually exposes — not a fixed number.
                        '$fieldCount values read from this charger',
                        style: const TextStyle(
                            color: BrandPalette.muted, fontSize: 12),
                      ),
                    ],
                  ),
                ),
                Icon(
                  _open
                      ? Icons.keyboard_arrow_up_rounded
                      : Icons.keyboard_arrow_down_rounded,
                  color: BrandPalette.muted,
                ),
              ],
            ),
          ),
        ),
        if (_open) ...[
          const SizedBox(height: 18),
          for (final g in widget.groups) ...[
            _SectionLabel(g.title, subtitle: g.subtitle),
            const SizedBox(height: 8),
            CapabilityGroupPanel(
              group: g,
              onWrite: widget.onWrite,
              onAction: widget.onAction,
              busy: widget.busy,
            ),
            const SizedBox(height: 20),
          ],
        ],
      ],
    );
  }
}

class _SectionLabel extends StatelessWidget {
  const _SectionLabel(this.text, {this.subtitle});
  final String text;
  final String? subtitle;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          text.toUpperCase(),
          style: const TextStyle(
            color: BrandPalette.muted,
            fontSize: 11,
            fontWeight: FontWeight.w900,
            letterSpacing: 1.1,
          ),
        ),
        if (subtitle != null)
          Text(subtitle!,
              style: const TextStyle(
                  color: BrandPalette.muted, fontSize: 11)),
      ],
    );
  }
}

class _Banner extends StatelessWidget {
  const _Banner({required this.icon, required this.tint, required this.text});
  final IconData icon;
  final Color tint;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: tint.withValues(alpha: 0.10),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: tint.withValues(alpha: 0.55)),
      ),
      child: Row(
        children: [
          Icon(icon, color: tint, size: 18),
          const SizedBox(width: 10),
          Expanded(
            child: Text(text,
                style: const TextStyle(color: Colors.white, fontSize: 12)),
          ),
        ],
      ),
    );
  }
}

/// Pending-changes bar.
///
/// Appears only when something is staged, and states the count plainly.
/// "Discard" is deliberately as prominent as "Apply": backing out of a
/// half-considered configuration change should not be the hard path.
class _SaveBar extends StatelessWidget {
  const _SaveBar({
    required this.count,
    required this.busy,
    required this.onApply,
    required this.onDiscard,
  });

  final int count;
  final bool busy;
  final Future<void> Function() onApply;
  final VoidCallback onDiscard;

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      top: false,
      child: Container(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
        decoration: const BoxDecoration(
          color: BrandPalette.surface,
          border: Border(top: BorderSide(color: BrandPalette.border)),
        ),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    count == 1 ? '1 change not applied' : '$count changes not applied',
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 14,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  const Text(
                    'Nothing has been sent to the charger yet.',
                    style: TextStyle(color: BrandPalette.muted, fontSize: 11),
                  ),
                ],
              ),
            ),
            TextButton(
              onPressed: busy ? null : onDiscard,
              child: const Text('Discard'),
            ),
            const SizedBox(width: 6),
            FilledButton(
              onPressed: busy ? null : () => onApply(),
              child: busy
                  ? const SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: Colors.white,
                      ),
                    )
                  : const Text('Apply'),
            ),
          ],
        ),
      ),
    );
  }
}
