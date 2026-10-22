// Straumvakt driver app — driver-first UX.
//
// Two-level Charge tab:
//   Site picker  ->  Charger list within a site  ->  Live charging view
//
// Símatap auth is NFC-first (lib/nfc_auth.dart): the phone must be tapped
// (<5cm, NFC range) to a charger's tag before a session is authenticated.
// BLE (lib/ble_scanner.dart) is discovery + anti-spoof only and never starts
// a charge on its own. On a tap we resolve the tag to one of the driver's
// accessible chargers and open the confirm sheet, or show "no access".
// Login/chargers/start-session run against the staging API (config.dart).
// See ADR 0024 addendum (2026-06-07).

import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/foundation.dart' show kDebugMode;
import 'package:flutter/material.dart';

import 'api.dart';
import 'ble_scanner.dart';
import 'config.dart';
import 'nfc_auth.dart';

void main() {
  runApp(const StraumvaktDriverApp());
}

// ---------------------------------------------------------------------------
// Brand
// ---------------------------------------------------------------------------

class _BrandPalette {
  static const midnight = Color(0xFF010B13);
  static const deepNavy = Color(0xFF061522);
  static const surface = Color(0xFF0A2130);
  static const surfaceHi = Color(0xFF0E2A3D);
  static const border = Color(0xFF1E5B70);
  static const mint = Color(0xFF69F2A6);
  static const cyan = Color(0xFF25C9C9);
  static const blue = Color(0xFF2098E4);
  static const muted = Color(0xFFA7BBC8);
  static const danger = Color(0xFFFF3864);
  static const amber = Color(0xFFF6A532);
}

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

enum ChargerStatus { available, inUse, offline }

extension ChargerStatusX on ChargerStatus {
  String get label => switch (this) {
        ChargerStatus.available => 'Laus',
        ChargerStatus.inUse => 'I notkun',
        ChargerStatus.offline => 'Otengd',
      };
  Color get color => switch (this) {
        ChargerStatus.available => _BrandPalette.mint,
        ChargerStatus.inUse => _BrandPalette.amber,
        ChargerStatus.offline => _BrandPalette.muted,
      };
}

class Charger {
  const Charger({
    required this.id,
    required this.serial,
    required this.status,
    required this.priceLabel,
    required this.maxPowerKw,
    required this.connectorType,
  });

  final String id;
  final String serial;
  final ChargerStatus status;
  final String priceLabel;
  final double maxPowerKw;
  final String connectorType;
}

class Site {
  const Site({
    required this.id,
    required this.name,
    required this.address,
    required this.distanceLabel,
    required this.accent,
    required this.chargers,
  });

  final String id;
  final String name;
  final String address;
  final String distanceLabel;
  final Color accent;
  final List<Charger> chargers;

  int countWhere(bool Function(Charger) f) =>
      chargers.where(f).length;
  int get countAvailable => countWhere((c) => c.status == ChargerStatus.available);
  int get countInUse => countWhere((c) => c.status == ChargerStatus.inUse);
  int get countOffline => countWhere((c) => c.status == ChargerStatus.offline);
}

List<Charger> _dalvegurChargers() {
  // 12 stations — a realistic Dalvegur-sized hub.
  return List.generate(12, (i) {
    final n = i + 1;
    final serial = 'ZPR0740${(n + 1).toString().padLeft(2, '0')}';
    final status = switch (i % 5) {
      0 || 1 || 2 => ChargerStatus.available,
      3 => ChargerStatus.inUse,
      _ => ChargerStatus.offline,
    };
    final fast = i >= 9;
    return Charger(
      id: 'dalv-$n',
      serial: serial,
      status: status,
      priceLabel: fast ? '46 kr/kWh' : '39 kr/kWh',
      maxPowerKw: fast ? 50 : 22,
      connectorType: fast ? 'CCS' : 'Type 2',
    );
  });
}

final _seedSites = <Site>[
  Site(
    id: 'site-dalvegur',
    name: 'Dalvegur 10 - 14',
    address: 'Kopavogur',
    distanceLabel: 'Her',
    accent: _BrandPalette.cyan,
    chargers: _dalvegurChargers(),
  ),
  Site(
    id: 'site-artunsbrekka',
    name: 'N1 Artunsbrekka',
    address: 'Reykjavik',
    distanceLabel: '4 km',
    accent: _BrandPalette.mint,
    chargers: const [
      Charger(
        id: 'art-1',
        serial: 'N1-742',
        status: ChargerStatus.available,
        priceLabel: 'Innifalid',
        maxPowerKw: 11,
        connectorType: 'Type 2',
      ),
      Charger(
        id: 'art-2',
        serial: 'N1-743',
        status: ChargerStatus.available,
        priceLabel: 'Innifalid',
        maxPowerKw: 11,
        connectorType: 'Type 2',
      ),
      Charger(
        id: 'art-3',
        serial: 'N1-744',
        status: ChargerStatus.inUse,
        priceLabel: 'Innifalid',
        maxPowerKw: 11,
        connectorType: 'Type 2',
      ),
      Charger(
        id: 'art-4',
        serial: 'N1-745',
        status: ChargerStatus.available,
        priceLabel: 'Innifalid',
        maxPowerKw: 11,
        connectorType: 'Type 2',
      ),
    ],
  ),
  Site(
    id: 'site-isorka',
    name: 'Isorka midborg',
    address: 'Reykjavik',
    distanceLabel: '6 km',
    accent: _BrandPalette.blue,
    chargers: const [
      Charger(
        id: 'is-1',
        serial: 'IS-306',
        status: ChargerStatus.inUse,
        priceLabel: '46 kr/kWh',
        maxPowerKw: 50,
        connectorType: 'CCS',
      ),
      Charger(
        id: 'is-2',
        serial: 'IS-307',
        status: ChargerStatus.available,
        priceLabel: '46 kr/kWh',
        maxPowerKw: 50,
        connectorType: 'CCS',
      ),
      Charger(
        id: 'is-3',
        serial: 'IS-308',
        status: ChargerStatus.available,
        priceLabel: '46 kr/kWh',
        maxPowerKw: 50,
        connectorType: 'CCS',
      ),
      Charger(
        id: 'is-4',
        serial: 'IS-309',
        status: ChargerStatus.offline,
        priceLabel: '46 kr/kWh',
        maxPowerKw: 50,
        connectorType: 'CCS',
      ),
    ],
  ),
  Site(
    id: 'site-home',
    name: 'Heim',
    address: 'Heimahledsla',
    distanceLabel: '12 km',
    accent: _BrandPalette.amber,
    chargers: const [
      Charger(
        id: 'home-1',
        serial: 'Heimahledsla',
        status: ChargerStatus.offline,
        priceLabel: 'Eigin orka',
        maxPowerKw: 7,
        connectorType: 'Type 2',
      ),
    ],
  ),
];

class PastSession {
  const PastSession({
    required this.id,
    required this.chargerLabel,
    required this.when,
    required this.energyKwh,
    required this.costIsk,
  });

  final String id;
  final String chargerLabel;
  final String when;
  final double energyKwh;
  final int costIsk;
}

const _seedSessions = <PastSession>[
  PastSession(
    id: 's-901',
    chargerLabel: 'ZPR074002 - Dalvegur',
    when: 'I gaer 18:42',
    energyKwh: 32.4,
    costIsk: 1264,
  ),
  PastSession(
    id: 's-900',
    chargerLabel: 'N1-742 - Artunsbrekka',
    when: '29. mai 09:11',
    energyKwh: 18.0,
    costIsk: 0,
  ),
  PastSession(
    id: 's-898',
    chargerLabel: 'IS-306 - Midborg',
    when: '25. mai 14:33',
    energyKwh: 41.8,
    costIsk: 1923,
  ),
];

// ---------------------------------------------------------------------------
// App root
// ---------------------------------------------------------------------------

class StraumvaktDriverApp extends StatelessWidget {
  const StraumvaktDriverApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      title: 'Straumvakt',
      theme: ThemeData(
        brightness: Brightness.dark,
        colorScheme: ColorScheme.fromSeed(
          seedColor: _BrandPalette.cyan,
          brightness: Brightness.dark,
        ),
        scaffoldBackgroundColor: _BrandPalette.midnight,
        fontFamily: 'Roboto',
        useMaterial3: true,
      ),
      home: const _AppRoot(),
    );
  }
}

class _AppRoot extends StatefulWidget {
  const _AppRoot();

  @override
  State<_AppRoot> createState() => _AppRootState();
}

class _AppRootState extends State<_AppRoot> {
  final _api = StraumvaktApi();
  final _tokenStore = TokenStore();
  String? _accessToken;
  String _driverEmail = '';
  bool _bootstrapping = true;

  bool get _loggedIn => _accessToken != null;

  @override
  void initState() {
    super.initState();
    unawaited(_bootstrap());
  }

  @override
  void dispose() {
    _api.close();
    super.dispose();
  }

  Future<void> _bootstrap() async {
    try {
      final token = await _tokenStore.readAccess();
      final email = await _tokenStore.readEmail();
      if (token == null) {
        if (mounted) setState(() => _bootstrapping = false);
        return;
      }
      try {
        await _api.me(token);
        if (!mounted) return;
        setState(() {
          _accessToken = token;
          _driverEmail = email ?? '';
          _bootstrapping = false;
        });
      } on ApiException catch (e) {
        if (e.isAuth) {
          await _tokenStore.clear();
        }
        if (mounted) setState(() => _bootstrapping = false);
      }
    } catch (_) {
      if (mounted) setState(() => _bootstrapping = false);
    }
  }

  Future<void> _onAuthenticated(LoginResult result) async {
    await _tokenStore.save(
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      email: result.driver.email,
    );
    if (!mounted) return;
    setState(() {
      _accessToken = result.accessToken;
      _driverEmail = result.driver.email;
    });
  }

  Future<void> _onLogout() async {
    await _tokenStore.clear();
    if (!mounted) return;
    setState(() {
      _accessToken = null;
      _driverEmail = '';
    });
  }

  void _onAuthExpired() {
    unawaited(_onLogout());
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Innskrad lota rann ut. Skradu inn aftur.'),
          backgroundColor: _BrandPalette.surface,
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_bootstrapping) {
      return const Scaffold(
        backgroundColor: _BrandPalette.midnight,
        body: Center(
          child: CircularProgressIndicator(color: _BrandPalette.cyan),
        ),
      );
    }
    return _loggedIn
        ? _DriverShell(
            driverEmail: _driverEmail,
            onLogout: _onLogout,
            api: _api,
            accessToken: _accessToken!,
            onAuthExpired: _onAuthExpired,
          )
        : _LoginScreen(api: _api, onAuthenticated: _onAuthenticated);
  }
}

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

class _LoginScreen extends StatefulWidget {
  const _LoginScreen({required this.api, required this.onAuthenticated});

  final StraumvaktApi api;
  final ValueChanged<LoginResult> onAuthenticated;

  @override
  State<_LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<_LoginScreen> {
  late final TextEditingController _email = TextEditingController(
    text: kDebugMode ? 'n1@n1.is' : '',
  );
  late final TextEditingController _password = TextEditingController(
    text: kDebugMode ? 'Hladan-N1-2026!' : '',
  );
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final email = _email.text.trim();
    final password = _password.text;
    if (email.isEmpty || password.isEmpty) {
      setState(() => _error = 'Slau inn netfang og lykilord.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final result = await widget.api.login(email, password);
      if (!mounted) return;
      widget.onAuthenticated(result);
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() => _error = e.message);
    } on TimeoutException {
      if (!mounted) return;
      setState(() => _error = 'Tenging tokst ekki - reyndu aftur.');
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = 'Ovaent villa: $e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: _BrandPalette.midnight,
      resizeToAvoidBottomInset: true,
      body: SafeArea(
        child: SingleChildScrollView(
          physics: const ClampingScrollPhysics(),
          padding: const EdgeInsets.fromLTRB(24, 48, 24, 48),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const SizedBox(height: 12),
              const _HeroCar(),
              const SizedBox(height: 28),
              TextField(
                controller: _email,
                enabled: !_busy,
                keyboardType: TextInputType.emailAddress,
                autocorrect: false,
                style: const TextStyle(color: Colors.white),
                decoration: _loginField(
                  label: 'Netfang',
                  icon: Icons.mail_outline_rounded,
                ),
              ),
              const SizedBox(height: 14),
              TextField(
                controller: _password,
                enabled: !_busy,
                obscureText: true,
                autocorrect: false,
                onSubmitted: (_) => _submit(),
                style: const TextStyle(color: Colors.white),
                decoration: _loginField(
                  label: 'Lykilord',
                  icon: Icons.lock_outline_rounded,
                ),
              ),
              if (_error != null) ...[
                const SizedBox(height: 14),
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 14,
                    vertical: 10,
                  ),
                  decoration: BoxDecoration(
                    color: const Color(0xFF3A1620),
                    borderRadius: BorderRadius.circular(14),
                    border: Border.all(color: _BrandPalette.danger),
                  ),
                  child: Row(
                    children: [
                      const Icon(
                        Icons.error_outline_rounded,
                        color: _BrandPalette.danger,
                        size: 18,
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          _error!,
                          style: const TextStyle(
                            color: Color(0xFFFFD3DA),
                            fontSize: 13,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ],
              const SizedBox(height: 26),
              FilledButton.icon(
                onPressed: _busy ? null : _submit,
                style: FilledButton.styleFrom(
                  backgroundColor: _BrandPalette.cyan,
                  foregroundColor: _BrandPalette.midnight,
                  padding: const EdgeInsets.symmetric(vertical: 17),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(18),
                  ),
                ),
                icon: _busy
                    ? const SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(
                          strokeWidth: 2.4,
                          color: _BrandPalette.midnight,
                        ),
                      )
                    : const Icon(Icons.login_rounded),
                label: Text(
                  _busy ? 'Skrai inn...' : 'Skra inn',
                  style: const TextStyle(
                    fontSize: 17,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ),
              const SizedBox(height: 14),
              TextButton(
                onPressed: _busy ? null : () {},
                child: const Text(
                  'Gleymt lykilord?',
                  style: TextStyle(color: _BrandPalette.cyan),
                ),
              ),
              const SizedBox(height: 12),
              Text(
                Config.apiBase,
                textAlign: TextAlign.center,
                style: const TextStyle(
                  color: _BrandPalette.muted,
                  fontSize: 11,
                  fontWeight: FontWeight.w500,
                ),
              ),
              const SizedBox(height: 28),
            ],
          ),
        ),
      ),
    );
  }

  InputDecoration _loginField({required String label, required IconData icon}) {
    return InputDecoration(
      labelText: label,
      prefixIcon: Icon(icon, color: _BrandPalette.muted),
      filled: true,
      fillColor: _BrandPalette.deepNavy,
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(18),
        borderSide: const BorderSide(color: _BrandPalette.border),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(18),
        borderSide: const BorderSide(color: _BrandPalette.cyan, width: 1.4),
      ),
      labelStyle: const TextStyle(color: _BrandPalette.muted),
    );
  }
}

// ---------------------------------------------------------------------------
// Logo widgets
// ---------------------------------------------------------------------------

class _LogoMark extends StatelessWidget {
  const _LogoMark({this.size = 46, this.borderRadius = 16});
  final double size;
  final double borderRadius;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(borderRadius),
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(borderRadius),
        child: Image.asset(
          'assets/images/straumvakt_logo_mark.png',
          fit: BoxFit.cover,
          filterQuality: FilterQuality.high,
          errorBuilder: (_, __, ___) {
            return const DecoratedBox(
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  colors: [_BrandPalette.mint, _BrandPalette.blue],
                ),
              ),
              child: Icon(Icons.bolt_rounded, color: _BrandPalette.midnight),
            );
          },
        ),
      ),
    );
  }
}

class _HeroCar extends StatelessWidget {
  const _HeroCar();

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        ConstrainedBox(
          constraints: const BoxConstraints(maxHeight: 230),
          child: Image.asset(
            'assets/images/straumvakt_hero_image.png',
            fit: BoxFit.contain,
            filterQuality: FilterQuality.high,
            errorBuilder: (_, __, ___) {
              // Fallback while the car PNG hasn't been dropped into
              // assets/images/ yet.
              return const SizedBox(
                height: 200,
                child: Center(
                  child: _LogoMark(size: 100, borderRadius: 28),
                ),
              );
            },
          ),
        ),
        const SizedBox(height: 14),
        const Text(
          'Straumvakt',
          style: TextStyle(
            color: Colors.white,
            fontSize: 38,
            fontWeight: FontWeight.w900,
            letterSpacing: -1.2,
          ),
        ),
      ],
    );
  }
}

class _LogoWordmark extends StatelessWidget {
  const _LogoWordmark();

  @override
  Widget build(BuildContext context) {
    return Image.asset(
      'assets/images/straumvakt_logo_full.png',
      fit: BoxFit.contain,
      filterQuality: FilterQuality.high,
      errorBuilder: (_, __, ___) {
        return const Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            _LogoMark(size: 92, borderRadius: 28),
            SizedBox(height: 18),
            Text(
              'Straumvakt',
              style: TextStyle(
                color: Colors.white,
                fontSize: 44,
                fontWeight: FontWeight.w900,
              ),
            ),
          ],
        );
      },
    );
  }
}

// ---------------------------------------------------------------------------
// Driver shell
// ---------------------------------------------------------------------------

class _DriverShell extends StatefulWidget {
  const _DriverShell({
    required this.driverEmail,
    required this.onLogout,
    required this.api,
    required this.accessToken,
    required this.onAuthExpired,
  });

  final String driverEmail;
  final VoidCallback onLogout;
  final StraumvaktApi api;
  final String accessToken;
  final VoidCallback onAuthExpired;

  @override
  State<_DriverShell> createState() => _DriverShellState();
}

class _DriverShellState extends State<_DriverShell> {
  int _tab = 0;
  bool _phoneTapEnabled = true;

  // Sites — seed fallback until API responds.
  List<Site> _sites = _seedSites;
  bool _startingSession = false;

  // ── Auth trigger: NFC tap (<5cm) — ADR 0024 addendum (2026-06-07) ──
  //
  // The <5cm NFC tap is the SOLE trigger that authenticates a session. BLE
  // (below) is demoted to discovery + anti-spoof cross-check and NEVER starts
  // a charge on its own — proximity alone (~10-15cm BLE floor) is not close
  // enough to express intent. A tap reads the charger's NFC tag; we resolve it
  // to one of the driver's accessible chargers and either open the confirm
  // sheet or show the "no access" dialog.
  final _nfc = NfcTapReader();
  StreamSubscription<NfcTapHit>? _nfcSub;

  // BLE is discovery + anti-spoof ONLY now. Keep a short-lived record of which
  // charger serials are physically near (so the NFC path can cross-check
  // "was this charger actually in BLE range when tapped?"). It never auths.
  final _scanner = BleTapScanner();
  StreamSubscription<TapHit>? _hitSub;
  final Map<String, DateTime> _bleNearby = {};

  bool _tapPromptOpen = false;
  DateTime _tapCooldownUntil = DateTime.fromMillisecondsSinceEpoch(0);

  // Two-level Charge tab nav state:
  Site? _activeSite;

  // Live charging state:
  _ChargeState _chargeState = _ChargeState.idle;
  Charger? _liveCharger;
  Site? _liveSite;
  DateTime? _chargingStartedAt;

  @override
  void initState() {
    super.initState();
    _hitSub = _scanner.hits.listen(_onTapHit);
    _nfcSub = _nfc.taps.listen(_onNfcTap);
    unawaited(_loadChargers().then((_) {
      _startScanner(); // BLE discovery (no auth)
      _startNfc();     // NFC tap = the auth gate
    }));
  }

  @override
  void dispose() {
    _hitSub?.cancel();
    _scanner.dispose();
    _nfcSub?.cancel();
    _nfc.dispose();
    super.dispose();
  }

  Future<void> _startScanner() async {
    if (!mounted) return;
    final targets = <TapTarget>[];
    for (final site in _sites) {
      for (final c in site.chargers) {
        // Only real (API-sourced) chargers have UUID connectorIds; seed rows
        // use short local ids and must never drive a start-session.
        if (c.id.length >= 30 && c.serial.trim().isNotEmpty) {
          targets.add(TapTarget(serial: c.serial, connectorId: c.id));
        }
      }
    }
    await _scanner.start(targets);
  }

  Future<void> _startNfc() async {
    if (!mounted || !_phoneTapEnabled) return;
    final ok = await _nfc.start();
    if (!ok && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
            'NFC er ekki virkt - kveiktu a NFC til ad hlada med tappi.',
          ),
          backgroundColor: _BrandPalette.surface,
        ),
      );
    }
  }

  // BLE discovery sink — record nearby chargers for the NFC anti-spoof
  // cross-check. Deliberately does NOT start a session: NFC is the only auth.
  void _onTapHit(TapHit hit) {
    if (hit.rssi < BleTapScanner.surfaceRssiFloor) return;
    _bleNearby[hit.serial.toUpperCase()] = hit.detectedAt;
  }

  // NFC tap (<5cm) — the real auth gate. Resolve the tag to one of the
  // driver's accessible chargers; start it, or explain why we can't.
  void _onNfcTap(NfcTapHit hit) {
    if (!_phoneTapEnabled ||
        _chargeState != _ChargeState.idle ||
        _tapPromptOpen) {
      return;
    }
    if (DateTime.now().isBefore(_tapCooldownUntil)) return;

    final raw = hit.raw;
    // Identify which charger the tag points at — by connector/charger UUID,
    // a Zaptec serial (ZPR…), or an exact charger display-name.
    final uuid = RegExp(
      r'[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}',
    ).firstMatch(raw)?.group(0);
    final serial = RegExp(r'ZPR\d{4,}').firstMatch(raw)?.group(0);

    for (final site in _sites) {
      for (final c in site.chargers) {
        if (c.id.length < 30) continue; // skip seed rows — never auth those
        final cs = c.serial.toUpperCase();
        final matched = (uuid != null && c.id.toUpperCase() == uuid) ||
            (serial != null && cs.contains(serial)) ||
            (raw.isNotEmpty && cs == raw);
        if (matched) {
          if (kDebugMode) {
            final near = _bleNearby.containsKey(cs) ||
                (serial != null && _bleNearby.containsKey(serial));
            debugPrint('[NFC] matched ${c.serial} bleCorroborated=$near');
          }
          unawaited(_promptDetectedReader(site, c));
          return;
        }
      }
    }

    // We recognised a charger identifier but it isn't in the driver's access
    // set → tell them they don't have access (requirement).
    if (serial != null) {
      unawaited(_promptNoAccess(serial));
      return;
    }
    if (uuid != null) {
      unawaited(_promptNoAccess('thessari stod'));
      return;
    }
    // Tag carried nothing we recognise as a Straumvakt charger.
    unawaited(_promptUnknownTag());
  }

  Future<void> _promptNoAccess(String serial) async {
    if (_tapPromptOpen || !mounted) return;
    setState(() => _tapPromptOpen = true);
    try {
      await showDialog<void>(
        context: context,
        builder: (_) => _NoAccessDialog(serial: serial),
      );
    } finally {
      _tapCooldownUntil = DateTime.now().add(const Duration(seconds: 20));
      if (mounted) setState(() => _tapPromptOpen = false);
    }
  }

  Future<void> _promptUnknownTag() async {
    if (_tapPromptOpen || !mounted) return;
    setState(() => _tapPromptOpen = true);
    try {
      await showDialog<void>(
        context: context,
        builder: (_) => const _UnknownTagDialog(),
      );
    } finally {
      _tapCooldownUntil = DateTime.now().add(const Duration(seconds: 6));
      if (mounted) setState(() => _tapPromptOpen = false);
    }
  }

  Future<void> _promptDetectedReader(Site site, Charger charger) async {
    if (_tapPromptOpen || !mounted) return;
    setState(() => _tapPromptOpen = true);
    bool? accepted;
    try {
      accepted = await showModalBottomSheet<bool>(
        context: context,
        backgroundColor: Colors.transparent,
        isScrollControlled: true,
        isDismissible: false,
        enableDrag: false,
        builder: (_) => _DetectedReaderSheet(site: site, charger: charger),
      );
    } finally {
      // Cool-down so a still-in-range charger (or a failed start) does not
      // immediately re-open the sheet.
      _tapCooldownUntil = DateTime.now().add(const Duration(seconds: 20));
      if (mounted) setState(() => _tapPromptOpen = false);
    }
    if (accepted == true && mounted) {
      await _enterPreparing(site, charger);
    }
  }

  Future<void> _loadChargers() async {
    try {
      final apiChargers = await widget.api.chargers(widget.accessToken);
      if (!mounted) return;
      final grouped = _groupChargers(apiChargers);
      if (grouped.isEmpty) return;
      setState(() {
        _sites = grouped;
        // Reset any active drill-down to a stale site reference.
        _activeSite = null;
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      if (e.isAuth) {
        widget.onAuthExpired();
        return;
      }
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Gat ekki sott hledslustodvar: ${e.message}'),
          backgroundColor: const Color(0xFF3A1620),
        ),
      );
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Gat ekki sott hledslustodvar: $e'),
          backgroundColor: const Color(0xFF3A1620),
        ),
      );
    }
  }

  List<Site> _groupChargers(List<ApiCharger> chargers) {
    if (chargers.isEmpty) return const [];
    final byLocation = <String, List<ApiCharger>>{};
    for (final c in chargers) {
      final key = c.locationName.isEmpty ? 'Hledslustodvar' : c.locationName;
      byLocation.putIfAbsent(key, () => []).add(c);
    }
    final accents = [
      _BrandPalette.cyan,
      _BrandPalette.mint,
      _BrandPalette.blue,
      _BrandPalette.amber,
    ];
    final out = <Site>[];
    var i = 0;
    byLocation.forEach((locationName, group) {
      out.add(
        Site(
          id: 'site-api-$i-${locationName.hashCode}',
          name: locationName,
          address: '',
          distanceLabel: '',
          accent: accents[i % accents.length],
          chargers: [
            for (final c in group)
              Charger(
                // Charger.id repurposed to carry the connector UUID for
                // start-session calls. The seed data uses local strings
                // here; API-sourced rows use real UUIDs.
                id: c.connectorId,
                serial: c.displayName,
                status: _mapStatus(c.status),
                priceLabel: c.maxPowerKw > 0
                    ? '${c.maxPowerKw.toStringAsFixed(0)} kW max'
                    : 'Verd vid lokun',
                maxPowerKw: c.maxPowerKw,
                connectorType: c.maxPowerKw >= 50 ? 'CCS' : 'Type 2',
              ),
          ],
        ),
      );
      i++;
    });
    return out;
  }

  ChargerStatus _mapStatus(String s) {
    final v = s.toLowerCase();
    if (v.contains('charg') || v.contains('prepar') || v.contains('inuse')) {
      return ChargerStatus.inUse;
    }
    if (v.contains('offline') || v.contains('fault') || v.contains('unav')) {
      return ChargerStatus.offline;
    }
    return ChargerStatus.available;
  }

  void _openSite(Site site) {
    setState(() => _activeSite = site);
  }

  void _closeSite() {
    setState(() => _activeSite = null);
  }

  Future<void> _enterPreparing(Site site, Charger charger) async {
    if (_startingSession) return;
    setState(() {
      _startingSession = true;
      _chargeState = _ChargeState.preparing;
      _liveCharger = charger;
      _liveSite = site;
    });
    try {
      final result = await widget.api.startSession(
        widget.accessToken,
        connectorId: charger.id,
      );
      if (!mounted) return;
      setState(() {
        _startingSession = false;
        _chargeState = _ChargeState.charging;
        _chargingStartedAt = DateTime.now();
      });
      final tokenInfo = result.tokenKind != null
          ? ' (${result.tokenKind})'
          : '';
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Start command sent: ${result.chargerName}$tokenInfo'),
          backgroundColor: _BrandPalette.surface,
        ),
      );
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _startingSession = false;
        _chargeState = _ChargeState.idle;
        _liveCharger = null;
        _liveSite = null;
      });
      if (e.isAuth) {
        widget.onAuthExpired();
        return;
      }
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(e.message),
          backgroundColor: const Color(0xFF3A1620),
        ),
      );
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _startingSession = false;
        _chargeState = _ChargeState.idle;
        _liveCharger = null;
        _liveSite = null;
      });
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Villa: $e'),
          backgroundColor: const Color(0xFF3A1620),
        ),
      );
    }
  }

  void _stopCharging() {
    setState(() {
      _chargeState = _ChargeState.idle;
      _liveCharger = null;
      _liveSite = null;
      _chargingStartedAt = null;
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: _BrandPalette.midnight,
      bottomNavigationBar: _BottomNav(
        index: _tab,
        onChanged: (i) => setState(() => _tab = i),
      ),
      drawer: _AccountDrawer(
        email: widget.driverEmail,
        phoneTapEnabled: _phoneTapEnabled,
        onPhoneTapToggled: (v) {
          setState(() => _phoneTapEnabled = v);
          if (v) {
            unawaited(_startNfc());
          } else {
            unawaited(_nfc.stop());
          }
        },
        onLogout: widget.onLogout,
      ),
      body: SafeArea(
        bottom: false,
        child: switch (_tab) {
          0 => _ChargeTab(
              sites: _sites,
              activeSite: _activeSite,
              onOpenSite: _openSite,
              onCloseSite: _closeSite,
              phoneTapEnabled: _phoneTapEnabled,
              chargeState: _chargeState,
              liveCharger: _liveCharger,
              liveSite: _liveSite,
              chargingStartedAt: _chargingStartedAt,
              onStartCharger: (s, c) => unawaited(_enterPreparing(s, c)),
              onStopCharging: _stopCharging,
              driverEmail: widget.driverEmail,
            ),
          _ => _TopChromedTab(
              driverEmail: widget.driverEmail,
              child: const _SupportTab(),
            ),
        },
      ),
    );
  }
}

class _TopChromedTab extends StatelessWidget {
  const _TopChromedTab({required this.driverEmail, required this.child});

  final String driverEmail;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        _AppHeader(title: _firstName(driverEmail)),
        Expanded(child: child),
      ],
    );
  }
}

enum _ChargeState { idle, preparing, charging }

class _BottomNav extends StatelessWidget {
  const _BottomNav({required this.index, required this.onChanged});

  final int index;
  final ValueChanged<int> onChanged;

  @override
  Widget build(BuildContext context) {
    return NavigationBar(
      selectedIndex: index,
      onDestinationSelected: onChanged,
      height: 70,
      backgroundColor: _BrandPalette.deepNavy,
      indicatorColor: _BrandPalette.cyan.withValues(alpha: 0.18),
      surfaceTintColor: Colors.transparent,
      labelBehavior: NavigationDestinationLabelBehavior.alwaysShow,
      destinations: const [
        NavigationDestination(
          icon: Icon(Icons.ev_station_outlined),
          selectedIcon: Icon(Icons.ev_station_rounded),
          label: 'Hlada',
        ),
        NavigationDestination(
          icon: Icon(Icons.support_agent_outlined),
          selectedIcon: Icon(Icons.support_agent_rounded),
          label: 'Adstod',
        ),
      ],
    );
  }
}

String _firstName(String email) {
  final local = email.split('@').first;
  if (local.isEmpty) return 'Driver';
  return local[0].toUpperCase() + local.substring(1);
}

// ---------------------------------------------------------------------------
// Charge tab
// ---------------------------------------------------------------------------

class _ChargeTab extends StatelessWidget {
  const _ChargeTab({
    required this.sites,
    required this.activeSite,
    required this.onOpenSite,
    required this.onCloseSite,
    required this.phoneTapEnabled,
    required this.chargeState,
    required this.liveCharger,
    required this.liveSite,
    required this.chargingStartedAt,
    required this.onStartCharger,
    required this.onStopCharging,
    required this.driverEmail,
  });

  final List<Site> sites;
  final Site? activeSite;
  final ValueChanged<Site> onOpenSite;
  final VoidCallback onCloseSite;
  final bool phoneTapEnabled;
  final _ChargeState chargeState;
  final Charger? liveCharger;
  final Site? liveSite;
  final DateTime? chargingStartedAt;
  final void Function(Site site, Charger charger) onStartCharger;
  final VoidCallback onStopCharging;
  final String driverEmail;

  Future<void> _simulatePhoneTap(BuildContext context) async {
    // Pick a site + charger that look "available" so the sheet flow is happy.
    final site = sites.firstWhere(
      (s) => s.countAvailable > 0,
      orElse: () => sites.first,
    );
    final charger = site.chargers.firstWhere(
      (c) => c.status == ChargerStatus.available,
      orElse: () => site.chargers.first,
    );
    final accepted = await showModalBottomSheet<bool>(
      context: context,
      backgroundColor: Colors.transparent,
      isScrollControlled: true,
      isDismissible: false,
      enableDrag: false,
      builder: (_) => _DetectedReaderSheet(site: site, charger: charger),
    );
    if (accepted == true) {
      onStartCharger(site, charger);
    }
  }

  @override
  Widget build(BuildContext context) {
    final isLive = chargeState != _ChargeState.idle;
    return Column(
      children: [
        _AppHeader(
          onBack: !isLive && activeSite != null ? onCloseSite : null,
          title: _firstName(driverEmail),
        ),
        Expanded(
          child: isLive
              ? _LiveChargingView(
                  state: chargeState,
                  charger: liveCharger!,
                  site: liveSite!,
                  startedAt: chargingStartedAt,
                  onStop: onStopCharging,
                )
              : activeSite == null
                  ? _SitesPicker(sites: sites, onOpen: onOpenSite)
                  : _ChargersList(
                      site: activeSite!,
                      onChangeSite: onCloseSite,
                      onStart: (c) => onStartCharger(activeSite!, c),
                    ),
        ),
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// App header
// ---------------------------------------------------------------------------

class _AppHeader extends StatelessWidget {
  const _AppHeader({
    required this.title,
    this.onBack,
  });

  final VoidCallback? onBack;
  final String title;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(8, 14, 12, 8),
      child: Row(
        children: [
          if (onBack != null)
            IconButton(
              onPressed: onBack,
              icon: const Icon(Icons.arrow_back_rounded, color: Colors.white),
            )
          else
            const Padding(
              padding: EdgeInsets.fromLTRB(12, 0, 0, 0),
              child: _LogoMark(size: 36, borderRadius: 12),
            ),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              title,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                color: Colors.white,
                fontSize: 20,
                fontWeight: FontWeight.w900,
                letterSpacing: -0.4,
              ),
            ),
          ),
          Builder(
            builder: (ctx) => IconButton(
              tooltip: 'Valmynd',
              onPressed: () => Scaffold.of(ctx).openDrawer(),
              icon: const Icon(Icons.menu_rounded, color: Colors.white),
            ),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Símatap banner — single visual affordance for BLE auto-tap.
// In debug builds, tapping it simulates a reader detection sheet.
// ---------------------------------------------------------------------------

class _PhoneTapBanner extends StatefulWidget {
  const _PhoneTapBanner({this.onSimulate});

  final VoidCallback? onSimulate;

  @override
  State<_PhoneTapBanner> createState() => _PhoneTapBannerState();
}

class _PhoneTapBannerState extends State<_PhoneTapBanner>
    with SingleTickerProviderStateMixin {
  late final AnimationController _pulse = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1500),
  )..repeat();

  @override
  void dispose() {
    _pulse.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(18, 6, 18, 6),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: widget.onSimulate,
          borderRadius: BorderRadius.circular(18),
          child: Ink(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
            decoration: BoxDecoration(
              color: _BrandPalette.surface,
              borderRadius: BorderRadius.circular(18),
              border: Border.all(
                color: _BrandPalette.cyan.withValues(alpha: 0.5),
              ),
            ),
            child: Row(
              children: [
                AnimatedBuilder(
                  animation: _pulse,
                  builder: (_, __) {
                    final t = (math.sin(_pulse.value * math.pi * 2) + 1) / 2;
                    return Container(
                      width: 36,
                      height: 36,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        color: _BrandPalette.cyan
                            .withValues(alpha: 0.18 + 0.25 * t),
                      ),
                      child: const Icon(
                        Icons.bluetooth_audio_rounded,
                        color: _BrandPalette.cyan,
                        size: 20,
                      ),
                    );
                  },
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        'Simatap virkt',
                        style: TextStyle(
                          color: Colors.white,
                          fontSize: 14,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        widget.onSimulate != null
                            ? 'Smelltu til ad likja eftir tappi (debug).'
                            : 'Haltu simanum ad hledslustodinni til ad hefja hledslu.',
                        style: const TextStyle(
                          color: _BrandPalette.muted,
                          fontSize: 12,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Sites picker (Hlaða default view)
// ---------------------------------------------------------------------------

class _SitesPicker extends StatelessWidget {
  const _SitesPicker({required this.sites, required this.onOpen});

  final List<Site> sites;
  final ValueChanged<Site> onOpen;

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 8, 20, 24),
      children: [
        const SizedBox(height: 4),
        const Text(
          'Veldu stadsetningu',
          style: TextStyle(
            color: Colors.white,
            fontSize: 22,
            fontWeight: FontWeight.w900,
            letterSpacing: -0.3,
          ),
        ),
        const SizedBox(height: 4),
        const Text(
          'Hledslustadir sem thinn adgangur naer til.',
          style: TextStyle(color: _BrandPalette.muted, fontSize: 13),
        ),
        const SizedBox(height: 16),
        for (final site in sites) ...[
          _SiteCard(site: site, onTap: () => onOpen(site)),
          const SizedBox(height: 8),
        ],
      ],
    );
  }
}

class _SiteCard extends StatelessWidget {
  const _SiteCard({required this.site, required this.onTap});

  final Site site;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(18),
        child: Ink(
          padding: const EdgeInsets.fromLTRB(12, 12, 12, 12),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(18),
            color: _BrandPalette.surface,
            border: Border.all(
              color: site.accent.withValues(alpha: 0.5),
            ),
          ),
          child: Row(
            children: [
              Container(
                width: 38,
                height: 38,
                decoration: BoxDecoration(
                  color: site.accent.withValues(alpha: 0.15),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Icon(
                  Icons.location_on_rounded,
                  color: site.accent,
                  size: 20,
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      site.name,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 15,
                        fontWeight: FontWeight.w900,
                        letterSpacing: -0.2,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Row(
                      children: [
                        Text(
                          '${site.chargers.length} stodvar',
                          style: const TextStyle(
                            color: _BrandPalette.muted,
                            fontSize: 11,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                        const SizedBox(width: 8),
                        _MiniDot(color: _BrandPalette.mint),
                        const SizedBox(width: 3),
                        Text(
                          '${site.countAvailable}',
                          style: const TextStyle(
                            color: _BrandPalette.mint,
                            fontSize: 11,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                        const SizedBox(width: 8),
                        _MiniDot(color: _BrandPalette.amber),
                        const SizedBox(width: 3),
                        Text(
                          '${site.countInUse}',
                          style: const TextStyle(
                            color: _BrandPalette.amber,
                            fontSize: 11,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              Text(
                site.distanceLabel,
                style: TextStyle(
                  color: site.accent,
                  fontSize: 12,
                  fontWeight: FontWeight.w900,
                ),
              ),
              const SizedBox(width: 4),
              const Icon(
                Icons.chevron_right_rounded,
                color: _BrandPalette.muted,
                size: 22,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _MiniDot extends StatelessWidget {
  const _MiniDot({required this.color});
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 6,
      height: 6,
      decoration: BoxDecoration(color: color, shape: BoxShape.circle),
    );
  }
}

// ---------------------------------------------------------------------------
// Chargers list (after a site is selected)
// ---------------------------------------------------------------------------

enum _ChargerFilter { all, available, fast, ccs }

extension _ChargerFilterX on _ChargerFilter {
  String get label => switch (this) {
        _ChargerFilter.all => 'Allar',
        _ChargerFilter.available => 'Lausar',
        _ChargerFilter.fast => 'Hradar',
        _ChargerFilter.ccs => 'CCS',
      };

  bool matches(Charger c) => switch (this) {
        _ChargerFilter.all => true,
        _ChargerFilter.available => c.status == ChargerStatus.available,
        _ChargerFilter.fast => c.maxPowerKw >= 22,
        _ChargerFilter.ccs => c.connectorType == 'CCS',
      };
}

class _ChargersList extends StatefulWidget {
  const _ChargersList({
    required this.site,
    required this.onChangeSite,
    required this.onStart,
  });

  final Site site;
  final VoidCallback onChangeSite;
  final ValueChanged<Charger> onStart;

  @override
  State<_ChargersList> createState() => _ChargersListState();
}

class _ChargersListState extends State<_ChargersList> {
  _ChargerFilter _filter = _ChargerFilter.all;

  @override
  Widget build(BuildContext context) {
    final filtered = widget.site.chargers.where(_filter.matches).toList();

    return Column(
      children: [
        _LocationSelector(site: widget.site, onTap: widget.onChangeSite),
        _FilterChips(
          active: _filter,
          onChange: (f) => setState(() => _filter = f),
        ),
        if (filtered.isEmpty)
          const Expanded(
            child: Center(
              child: Padding(
                padding: EdgeInsets.all(40),
                child: Text(
                  'Engar hledslustodvar passa vid leit eda siu.',
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    color: _BrandPalette.muted,
                    fontSize: 14,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
            ),
          )
        else
          Expanded(
            child: ListView.separated(
              padding: const EdgeInsets.fromLTRB(20, 4, 20, 24),
              itemCount: filtered.length,
              separatorBuilder: (_, __) => const SizedBox(height: 8),
              itemBuilder: (_, i) => _ChargerRow(
                charger: filtered[i],
                accent: widget.site.accent,
                onStart: () => widget.onStart(filtered[i]),
              ),
            ),
          ),
      ],
    );
  }
}

class _LocationSelector extends StatelessWidget {
  const _LocationSelector({required this.site, required this.onTap});

  final Site site;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 6, 20, 4),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(20),
          child: Ink(
            padding: const EdgeInsets.fromLTRB(14, 12, 12, 12),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(20),
              gradient: LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: [
                  site.accent.withValues(alpha: 0.18),
                  _BrandPalette.surface,
                ],
              ),
              border: Border.all(
                color: site.accent.withValues(alpha: 0.55),
                width: 1.2,
              ),
            ),
            child: Row(
              children: [
                Container(
                  width: 40,
                  height: 40,
                  decoration: BoxDecoration(
                    color: site.accent.withValues(alpha: 0.18),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Icon(
                    Icons.location_on_rounded,
                    color: site.accent,
                    size: 22,
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        site.name,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 18,
                          fontWeight: FontWeight.w900,
                          letterSpacing: -0.3,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        '${site.chargers.length} stodvar - ${site.countAvailable} lausar - ${site.countInUse} i notkun',
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          color: _BrandPalette.muted,
                          fontSize: 12,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 8),
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 10,
                    vertical: 6,
                  ),
                  decoration: BoxDecoration(
                    color: _BrandPalette.midnight.withValues(alpha: 0.4),
                    borderRadius: BorderRadius.circular(99),
                    border: Border.all(
                      color: site.accent.withValues(alpha: 0.4),
                    ),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        'Skipta',
                        style: TextStyle(
                          color: site.accent,
                          fontSize: 11,
                          fontWeight: FontWeight.w900,
                          letterSpacing: 0.2,
                        ),
                      ),
                      const SizedBox(width: 4),
                      Icon(
                        Icons.swap_horiz_rounded,
                        color: site.accent,
                        size: 14,
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _FilterChips extends StatelessWidget {
  const _FilterChips({required this.active, required this.onChange});

  final _ChargerFilter active;
  final ValueChanged<_ChargerFilter> onChange;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 44,
      child: ListView(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.fromLTRB(20, 8, 20, 4),
        children: [
          for (final f in _ChargerFilter.values) ...[
            _FilterChip(
              label: f.label,
              isActive: f == active,
              onTap: () => onChange(f),
            ),
            const SizedBox(width: 8),
          ],
        ],
      ),
    );
  }
}

class _FilterChip extends StatelessWidget {
  const _FilterChip({
    required this.label,
    required this.isActive,
    required this.onTap,
  });

  final String label;
  final bool isActive;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(99),
        child: Ink(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(99),
            color: isActive
                ? _BrandPalette.cyan.withValues(alpha: 0.18)
                : _BrandPalette.surface,
            border: Border.all(
              color: isActive ? _BrandPalette.cyan : _BrandPalette.border,
            ),
          ),
          child: Text(
            label,
            style: TextStyle(
              color: isActive ? _BrandPalette.cyan : _BrandPalette.muted,
              fontSize: 12,
              fontWeight: FontWeight.w900,
              letterSpacing: 0.3,
            ),
          ),
        ),
      ),
    );
  }
}

class _ChargerRow extends StatelessWidget {
  const _ChargerRow({
    required this.charger,
    required this.accent,
    required this.onStart,
  });

  final Charger charger;
  final Color accent;
  final VoidCallback onStart;

  @override
  Widget build(BuildContext context) {
    final isUsable = charger.status == ChargerStatus.available;
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: isUsable ? onStart : null,
        borderRadius: BorderRadius.circular(18),
        child: Ink(
          padding: const EdgeInsets.fromLTRB(14, 12, 12, 12),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(18),
            color: _BrandPalette.surface,
            border: Border.all(
              color: isUsable
                  ? accent.withValues(alpha: 0.45)
                  : _BrandPalette.border,
            ),
          ),
          child: Row(
            children: [
              Container(
                width: 42,
                height: 42,
                decoration: BoxDecoration(
                  color: accent.withValues(alpha: 0.13),
                  borderRadius: BorderRadius.circular(13),
                ),
                child: Icon(
                  Icons.ev_station_rounded,
                  color: isUsable ? accent : _BrandPalette.muted,
                  size: 22,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      charger.serial,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 15,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      '${charger.maxPowerKw.toStringAsFixed(0)} kW - ${charger.connectorType} - ${charger.priceLabel}',
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: _BrandPalette.muted,
                        fontSize: 12,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              _StatusPill(status: charger.status),
              const SizedBox(width: 4),
              Icon(
                Icons.chevron_right_rounded,
                color: isUsable ? accent : _BrandPalette.muted,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _StatusPill extends StatelessWidget {
  const _StatusPill({required this.status});
  final ChargerStatus status;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: status.color.withValues(alpha: 0.13),
        borderRadius: BorderRadius.circular(99),
        border: Border.all(color: status.color.withValues(alpha: 0.45)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 7,
            height: 7,
            decoration: BoxDecoration(
              color: status.color,
              shape: BoxShape.circle,
            ),
          ),
          const SizedBox(width: 6),
          Text(
            status.label,
            style: TextStyle(
              color: status.color,
              fontSize: 11,
              fontWeight: FontWeight.w900,
            ),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// No-access dialog — shown when the driver taps a Zaptec in range that is
// NOT among their accessible chargers.
// ---------------------------------------------------------------------------

class _NoAccessDialog extends StatelessWidget {
  const _NoAccessDialog({required this.serial});

  final String serial;

  @override
  Widget build(BuildContext context) {
    return Dialog(
      backgroundColor: _BrandPalette.surface,
      insetPadding: const EdgeInsets.symmetric(horizontal: 28),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(24),
        side: BorderSide(color: _BrandPalette.amber.withValues(alpha: 0.55)),
      ),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(22, 24, 22, 16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 64,
              height: 64,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: _BrandPalette.amber.withValues(alpha: 0.15),
              ),
              child: const Icon(
                Icons.lock_outline_rounded,
                color: _BrandPalette.amber,
                size: 32,
              ),
            ),
            const SizedBox(height: 16),
            const Text(
              'Enginn adgangur',
              style: TextStyle(
                color: Colors.white,
                fontSize: 20,
                fontWeight: FontWeight.w900,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              'Thu hefur ekki adgang ad hledslustodinni $serial. '
              'Hafdu samband vid eiganda stodvarinnar til ad fa adgang.',
              textAlign: TextAlign.center,
              style: const TextStyle(
                color: _BrandPalette.muted,
                fontSize: 14,
                height: 1.4,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 20),
            SizedBox(
              width: double.infinity,
              child: FilledButton(
                onPressed: () => Navigator.of(context).pop(),
                style: FilledButton.styleFrom(
                  backgroundColor: _BrandPalette.cyan,
                  foregroundColor: _BrandPalette.midnight,
                  padding: const EdgeInsets.symmetric(vertical: 14),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(14),
                  ),
                ),
                child: const Text(
                  'I lagi',
                  style: TextStyle(fontWeight: FontWeight.w900, fontSize: 15),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Unknown-tag dialog — shown when an NFC tap reads a tag we can't tie to a
// Straumvakt charger (foreign tag, or NDEF that carried no charger id).
// ---------------------------------------------------------------------------

class _UnknownTagDialog extends StatelessWidget {
  const _UnknownTagDialog();

  @override
  Widget build(BuildContext context) {
    return Dialog(
      backgroundColor: _BrandPalette.surface,
      insetPadding: const EdgeInsets.symmetric(horizontal: 28),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(24),
        side: const BorderSide(color: _BrandPalette.border),
      ),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(22, 24, 22, 16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 64,
              height: 64,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: _BrandPalette.cyan.withValues(alpha: 0.15),
              ),
              child: const Icon(
                Icons.nfc_rounded,
                color: _BrandPalette.cyan,
                size: 32,
              ),
            ),
            const SizedBox(height: 16),
            const Text(
              'Thekkti ekki stod',
              style: TextStyle(
                color: Colors.white,
                fontSize: 20,
                fontWeight: FontWeight.w900,
              ),
            ),
            const SizedBox(height: 8),
            const Text(
              'Thetta merki tilheyrir ekki Straumvakt hledslustod, eda ekki '
              'tokst ad lesa hana. Berdu simann (<5cm) ad merki stodvarinnar '
              'og reyndu aftur.',
              textAlign: TextAlign.center,
              style: TextStyle(
                color: _BrandPalette.muted,
                fontSize: 14,
                height: 1.4,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 20),
            SizedBox(
              width: double.infinity,
              child: FilledButton(
                onPressed: () => Navigator.of(context).pop(),
                style: FilledButton.styleFrom(
                  backgroundColor: _BrandPalette.cyan,
                  foregroundColor: _BrandPalette.midnight,
                  padding: const EdgeInsets.symmetric(vertical: 14),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(14),
                  ),
                ),
                child: const Text(
                  'I lagi',
                  style: TextStyle(fontWeight: FontWeight.w900, fontSize: 15),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Detected reader sheet — opened by an NFC tap on an accessible charger.
// ---------------------------------------------------------------------------

class _DetectedReaderSheet extends StatefulWidget {
  const _DetectedReaderSheet({required this.site, required this.charger});

  final Site site;
  final Charger charger;

  @override
  State<_DetectedReaderSheet> createState() => _DetectedReaderSheetState();
}

class _DetectedReaderSheetState extends State<_DetectedReaderSheet>
    with SingleTickerProviderStateMixin {
  late final AnimationController _ring = AnimationController(
    vsync: this,
    duration: const Duration(seconds: 1),
  )..forward();

  // No auto-start: BLE proximity surfaces the charger; the driver confirms
  // explicitly with the Start button. (Auto-firing on proximity sent
  // repeated RemoteStart commands from >0.5m — never again.)

  @override
  void dispose() {
    _ring.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final accent = widget.site.accent;
    return SafeArea(
      top: false,
      child: Container(
        margin: const EdgeInsets.all(16),
        padding: const EdgeInsets.fromLTRB(20, 22, 20, 18),
        decoration: BoxDecoration(
          color: _BrandPalette.surface,
          borderRadius: BorderRadius.circular(28),
          border: Border.all(
            color: accent.withValues(alpha: 0.55),
            width: 1.2,
          ),
          boxShadow: [
            BoxShadow(
              color: accent.withValues(alpha: 0.25),
              blurRadius: 30,
              offset: const Offset(0, 12),
            ),
          ],
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Stack(
              alignment: Alignment.center,
              children: [
                SizedBox(
                  width: 110,
                  height: 110,
                  child: AnimatedBuilder(
                    animation: _ring,
                    builder: (_, __) => CircularProgressIndicator(
                      value: _ring.value,
                      strokeWidth: 5,
                      color: accent,
                      backgroundColor: _BrandPalette.border,
                    ),
                  ),
                ),
                Icon(Icons.bolt_rounded, color: accent, size: 44),
              ],
            ),
            const SizedBox(height: 18),
            Text(
              widget.charger.serial,
              style: const TextStyle(
                color: Colors.white,
                fontSize: 22,
                fontWeight: FontWeight.w900,
                letterSpacing: -0.3,
              ),
            ),
            const SizedBox(height: 4),
            Text(
              widget.site.name,
              style: const TextStyle(
                color: _BrandPalette.muted,
                fontSize: 13,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 14),
            const Text(
              'Stod fundin - stadfestu til ad hefja hledslu',
              textAlign: TextAlign.center,
              style: TextStyle(
                color: _BrandPalette.muted,
                fontSize: 13,
                fontWeight: FontWeight.w700,
              ),
            ),
            const SizedBox(height: 16),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    onPressed: () => Navigator.of(context).pop(false),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: _BrandPalette.muted,
                      side: const BorderSide(color: _BrandPalette.border),
                      padding: const EdgeInsets.symmetric(vertical: 14),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(16),
                      ),
                    ),
                    child: const Text(
                      'Haetta vid',
                      style: TextStyle(fontWeight: FontWeight.w900),
                    ),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: FilledButton(
                    onPressed: () => Navigator.of(context).pop(true),
                    style: FilledButton.styleFrom(
                      backgroundColor: accent,
                      foregroundColor: _BrandPalette.midnight,
                      padding: const EdgeInsets.symmetric(vertical: 14),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(16),
                      ),
                    ),
                    child: const Text(
                      'Hefja nuna',
                      style: TextStyle(fontWeight: FontWeight.w900),
                    ),
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

// ---------------------------------------------------------------------------
// Live charging view
// ---------------------------------------------------------------------------

// Design palette for the charging-session view — exact hex from the
// approved ChargingSession spec (slightly brighter than _BrandPalette).
const _csText = Color(0xFFF5F7FA);
const _csMuted = Color(0xFFA8B2BC);
const _csDivider = Color(0x24FFFFFF); // rgba(255,255,255,0.14)
const _csMint = Color(0xFF52F0A0);
const _csCyan = Color(0xFF14C7D9);
const _csBlue = Color(0xFF1E9BFF);
const _csTrack = Color(0xFF13242E);

// Charging-active screen. The header (logo + name + hamburger) and the
// bottom nav are supplied by the surrounding _ChargeTab shell, so this
// view renders only the session body. Values are hardwired to the
// approved design for now; they bind to the Straumvakt DB later.
class _LiveChargingView extends StatelessWidget {
  const _LiveChargingView({
    required this.state,
    required this.charger,
    required this.site,
    required this.startedAt,
    required this.onStop,
  });

  final _ChargeState state;
  final Charger charger;
  final Site site;
  final DateTime? startedAt;
  final VoidCallback onStop;

  @override
  Widget build(BuildContext context) {
    if (state == _ChargeState.preparing) {
      return _PreparingBlock(accent: site.accent, onCancel: onStop);
    }
    return Padding(
      padding: const EdgeInsets.fromLTRB(24, 4, 24, 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // Location
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Icon(Icons.location_on_rounded, color: _csMint, size: 18),
              const SizedBox(width: 6),
              Text(
                site.name,
                style: const TextStyle(
                  color: _csMuted,
                  fontSize: 14,
                  fontWeight: FontWeight.w500,
                ),
              ),
            ],
          ),
          const Spacer(flex: 2),
          // Top metrics — AFL / TÍMI
          Row(
            children: const [
              Expanded(
                child: _CsMetric(
                  label: 'AFL',
                  icon: Icons.bolt_rounded,
                  value: '11,2 kW',
                ),
              ),
              Expanded(
                child: _CsMetric(
                  label: 'TÍMI',
                  icon: Icons.schedule_rounded,
                  value: '00:16:48',
                ),
              ),
            ],
          ),
          const SizedBox(height: 20),
          // SOC ring
          const _CsSocRing(progress: 0.67),
          const SizedBox(height: 18),
          // Summary
          Row(
            children: const [
              Expanded(
                child: _CsSummary(value: '18,42 kWh', label: 'bætt í rafhlöðu'),
              ),
              Expanded(
                child: _CsSummary(value: '1.017 kr.', label: 'kostnaður'),
              ),
            ],
          ),
          const Spacer(flex: 2),
          // Price card
          const _CsPriceCard(),
          const SizedBox(height: 16),
          // Stop button
          _CsStopButton(onStop: onStop),
        ],
      ),
    );
  }
}

class _CsMetric extends StatelessWidget {
  const _CsMetric({
    required this.label,
    required this.icon,
    required this.value,
  });

  final String label;
  final IconData icon;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Text(
          label,
          style: const TextStyle(
            color: _csMuted,
            fontSize: 12,
            fontWeight: FontWeight.w700,
            letterSpacing: 1.6,
          ),
        ),
        const SizedBox(height: 8),
        Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(icon, color: _csMint, size: 20),
            const SizedBox(width: 6),
            Flexible(
              child: FittedBox(
                fit: BoxFit.scaleDown,
                child: Text(
                  value,
                  maxLines: 1,
                  style: const TextStyle(
                    color: _csText,
                    fontSize: 24,
                    fontWeight: FontWeight.w700,
                    letterSpacing: -0.5,
                    fontFeatures: [FontFeature.tabularFigures()],
                  ),
                ),
              ),
            ),
          ],
        ),
      ],
    );
  }
}

class _PreparingBlock extends StatelessWidget {
  const _PreparingBlock({required this.accent, required this.onCancel});

  final Color accent;
  final VoidCallback onCancel;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(24, 4, 24, 16),
      child: Column(
        children: [
          const Spacer(),
          SizedBox(
            width: 80,
            height: 80,
            child: CircularProgressIndicator(
              color: accent,
              strokeWidth: 5,
              backgroundColor: _BrandPalette.border,
            ),
          ),
          const SizedBox(height: 20),
          const Text(
            'Tengist hleðslustöð…',
            style: TextStyle(
              color: Colors.white,
              fontSize: 18,
              fontWeight: FontWeight.w900,
            ),
          ),
          const SizedBox(height: 6),
          const Text(
            'Bíddu meðan við opnum tengilinn.',
            style: TextStyle(color: _BrandPalette.muted, fontSize: 13),
          ),
          const Spacer(),
          _CsStopButton(onStop: onCancel, label: 'Hætta við'),
        ],
      ),
    );
  }
}

class _CsSocRing extends StatelessWidget {
  const _CsSocRing({required this.progress});

  final double progress; // 0..1

  @override
  Widget build(BuildContext context) {
    const size = 240.0;
    return Center(
      child: SizedBox(
        width: size,
        height: size,
        child: CustomPaint(
          painter: _CsRingPainter(progress: progress),
          child: Center(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  '${(progress * 100).round()}%',
                  style: const TextStyle(
                    color: _csText,
                    fontSize: 68,
                    fontWeight: FontWeight.w800,
                    letterSpacing: -2,
                    height: 1.0,
                  ),
                ),
                const SizedBox(height: 6),
                const Text(
                  'HLAÐIÐ',
                  style: TextStyle(
                    color: _csMuted,
                    fontSize: 13,
                    fontWeight: FontWeight.w700,
                    letterSpacing: 3,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _CsRingPainter extends CustomPainter {
  _CsRingPainter({required this.progress});

  final double progress;
  static const _stroke = 12.0;

  @override
  void paint(Canvas canvas, Size size) {
    final center = Offset(size.width / 2, size.height / 2);
    final radius = (size.width - _stroke) / 2;
    final rect = Rect.fromCircle(center: center, radius: radius);

    // Empty track.
    final track = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = _stroke
      ..strokeCap = StrokeCap.round
      ..color = _csTrack;
    canvas.drawCircle(center, radius, track);

    // Progress arc — gradient blue (lower-left) → cyan → mint (upper-right).
    const startAngle = -math.pi / 2; // 12 o'clock
    final sweep = 2 * math.pi * progress.clamp(0.0, 1.0);

    final shader = const SweepGradient(
      startAngle: -math.pi / 2,
      endAngle: 3 * math.pi / 2,
      colors: [_csBlue, _csCyan, _csMint],
      stops: [0.0, 0.5, 1.0],
      transform: GradientRotation(-math.pi / 2),
    ).createShader(rect);

    final arc = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = _stroke
      ..strokeCap = StrokeCap.round
      ..shader = shader;

    canvas.drawArc(rect, startAngle, sweep, false, arc);
  }

  @override
  bool shouldRepaint(covariant _CsRingPainter old) => old.progress != progress;
}

class _CsSummary extends StatelessWidget {
  const _CsSummary({required this.value, required this.label});

  final String value;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        FittedBox(
          fit: BoxFit.scaleDown,
          child: Text(
            value,
            maxLines: 1,
            style: const TextStyle(
              color: _csText,
              fontSize: 22,
              fontWeight: FontWeight.w700,
              letterSpacing: -0.5,
              fontFeatures: [FontFeature.tabularFigures()],
            ),
          ),
        ),
        const SizedBox(height: 4),
        Text(
          label,
          style: const TextStyle(
            color: _csMuted,
            fontSize: 12,
            fontWeight: FontWeight.w500,
          ),
        ),
      ],
    );
  }
}

class _CsPriceCard extends StatelessWidget {
  const _CsPriceCard();

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(18, 16, 18, 16),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: _csDivider),
      ),
      child: Column(
        children: [
          Row(
            children: [
              Container(
                width: 38,
                height: 38,
                decoration: BoxDecoration(
                  color: _csMint.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(11),
                ),
                child: const Icon(Icons.sell_rounded, color: _csMint, size: 20),
              ),
              const SizedBox(width: 14),
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: const [
                  Text(
                    '55 kr/kWh',
                    style: TextStyle(
                      color: _csText,
                      fontSize: 18,
                      fontWeight: FontWeight.w700,
                      letterSpacing: -0.3,
                    ),
                  ),
                  SizedBox(height: 2),
                  Text(
                    '15 kr/klst eftir frítíma',
                    style: TextStyle(
                      color: _csMuted,
                      fontSize: 12.5,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                ],
              ),
            ],
          ),
          const Padding(
            padding: EdgeInsets.symmetric(vertical: 14),
            child: Divider(height: 1, thickness: 1, color: _csDivider),
          ),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: const [
              Text(
                'Frítími eftir:',
                style: TextStyle(
                  color: _csMuted,
                  fontSize: 14,
                  fontWeight: FontWeight.w500,
                ),
              ),
              Text(
                '07:43',
                style: TextStyle(
                  color: _csMint,
                  fontSize: 22,
                  fontWeight: FontWeight.w800,
                  letterSpacing: -0.5,
                  fontFeatures: [FontFeature.tabularFigures()],
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _CsStopButton extends StatelessWidget {
  const _CsStopButton({required this.onStop, this.label = 'Stöðva hleðslu'});

  final VoidCallback onStop;
  final String label;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 64,
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: onStop,
          borderRadius: BorderRadius.circular(20),
          child: Ink(
            decoration: BoxDecoration(
              gradient: const LinearGradient(
                begin: Alignment.centerLeft,
                end: Alignment.centerRight,
                colors: [_csMint, _csBlue],
              ),
              borderRadius: BorderRadius.circular(20),
            ),
            child: Center(
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Container(
                    width: 16,
                    height: 16,
                    decoration: BoxDecoration(
                      color: _BrandPalette.midnight,
                      borderRadius: BorderRadius.circular(3),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Text(
                    label,
                    style: const TextStyle(
                      color: _BrandPalette.midnight,
                      fontSize: 17,
                      fontWeight: FontWeight.w800,
                      letterSpacing: -0.2,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Sessions / Support / Account tabs (unchanged from v1)
// ---------------------------------------------------------------------------

class _SessionsTab extends StatelessWidget {
  const _SessionsTab({required this.sessions});

  final List<PastSession> sessions;

  @override
  Widget build(BuildContext context) {
    final totalKwh = sessions.fold<double>(0, (a, s) => a + s.energyKwh);
    final totalCost = sessions.fold<int>(0, (a, s) => a + s.costIsk);
    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(20, 16, 20, 32),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Text(
            'Hledslur',
            style: TextStyle(
              color: Colors.white,
              fontSize: 22,
              fontWeight: FontWeight.w900,
              letterSpacing: -0.3,
            ),
          ),
          const SizedBox(height: 4),
          const Text(
            'Yfirlit yfir nylegar hledslur og kostnad.',
            style: TextStyle(color: _BrandPalette.muted, fontSize: 13),
          ),
          const SizedBox(height: 20),
          Container(
            padding: const EdgeInsets.all(18),
            decoration: BoxDecoration(
              color: _BrandPalette.surface,
              borderRadius: BorderRadius.circular(22),
              border: Border.all(color: _BrandPalette.border),
            ),
            child: Row(
              children: [
                Expanded(
                  child: _SummaryStat(
                    label: 'Sidustu 30 dagar',
                    value: '${totalKwh.toStringAsFixed(1)} kWh',
                  ),
                ),
                Container(
                  width: 1,
                  height: 40,
                  margin: const EdgeInsets.symmetric(horizontal: 14),
                  color: _BrandPalette.border,
                ),
                Expanded(
                  child: _SummaryStat(
                    label: 'Heildarkostnadur',
                    value: '$totalCost kr.',
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 20),
          for (final s in sessions) ...[
            _SessionTile(session: s),
            const SizedBox(height: 10),
          ],
        ],
      ),
    );
  }
}

class _SummaryStat extends StatelessWidget {
  const _SummaryStat({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: const TextStyle(
            color: _BrandPalette.muted,
            fontSize: 11,
            fontWeight: FontWeight.w800,
            letterSpacing: 0.4,
          ),
        ),
        const SizedBox(height: 4),
        Text(
          value,
          style: const TextStyle(
            color: Colors.white,
            fontSize: 20,
            fontWeight: FontWeight.w900,
            letterSpacing: -0.3,
          ),
        ),
      ],
    );
  }
}

class _SessionTile extends StatelessWidget {
  const _SessionTile({required this.session});

  final PastSession session;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: _BrandPalette.surface,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: _BrandPalette.border),
      ),
      child: Row(
        children: [
          Container(
            width: 42,
            height: 42,
            decoration: BoxDecoration(
              color: _BrandPalette.mint.withValues(alpha: 0.13),
              borderRadius: BorderRadius.circular(13),
            ),
            child: const Icon(
              Icons.bolt_rounded,
              color: _BrandPalette.mint,
              size: 22,
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  session.chargerLabel,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 14,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  '${session.when} - ${session.energyKwh.toStringAsFixed(1)} kWh',
                  style: const TextStyle(
                    color: _BrandPalette.muted,
                    fontSize: 12,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          Text(
            session.costIsk == 0 ? 'Innifalid' : '${session.costIsk} kr.',
            style: const TextStyle(
              color: _BrandPalette.mint,
              fontSize: 13,
              fontWeight: FontWeight.w900,
            ),
          ),
        ],
      ),
    );
  }
}

class _SupportTab extends StatelessWidget {
  const _SupportTab();

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(20, 16, 20, 32),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: const [
          Text(
            'Adstod',
            style: TextStyle(
              color: Colors.white,
              fontSize: 22,
              fontWeight: FontWeight.w900,
              letterSpacing: -0.3,
            ),
          ),
          SizedBox(height: 4),
          Text(
            'Tilkynna vandamal eda bidja um adstod.',
            style: TextStyle(color: _BrandPalette.muted, fontSize: 13),
          ),
          SizedBox(height: 20),
          // HARDWIRE: Issue Engine /api/driver/issues POST when ready.
          _SupportTile(
            icon: Icons.report_problem_rounded,
            accent: _BrandPalette.amber,
            title: 'Tilkynna bilun',
            subtitle: 'Hledslustodin svarar ekki eda er bilud.',
          ),
          SizedBox(height: 10),
          _SupportTile(
            icon: Icons.help_outline_rounded,
            accent: _BrandPalette.cyan,
            title: 'Reikningur eda verd',
            subtitle: 'Spurningar um reikning, verdskra eda notkun.',
          ),
          SizedBox(height: 10),
          _SupportTile(
            icon: Icons.qr_code_scanner_rounded,
            accent: _BrandPalette.blue,
            title: 'Skanna QR a hledslustod',
            subtitle: 'Finna stod med QR-koda (kemur fljotlega).',
          ),
          SizedBox(height: 22),
          _SupportFooter(),
        ],
      ),
    );
  }
}

class _SupportFooter extends StatelessWidget {
  const _SupportFooter();

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: _BrandPalette.surface,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: _BrandPalette.border),
      ),
      child: const Row(
        children: [
          Icon(Icons.info_outline_rounded, color: _BrandPalette.muted),
          SizedBox(width: 10),
          Expanded(
            child: Text(
              'Mal sem tilkynnt eru her rata sjalfkrafa i rekstrarteymid.',
              style: TextStyle(
                color: _BrandPalette.muted,
                fontSize: 12,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _SupportTile extends StatelessWidget {
  const _SupportTile({
    required this.icon,
    required this.accent,
    required this.title,
    required this.subtitle,
  });

  final IconData icon;
  final Color accent;
  final String title;
  final String subtitle;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: () {},
        borderRadius: BorderRadius.circular(20),
        child: Ink(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: _BrandPalette.surface,
            borderRadius: BorderRadius.circular(20),
            border: Border.all(color: _BrandPalette.border),
          ),
          child: Row(
            children: [
              Container(
                width: 42,
                height: 42,
                decoration: BoxDecoration(
                  color: accent.withValues(alpha: 0.13),
                  borderRadius: BorderRadius.circular(13),
                ),
                child: Icon(icon, color: accent, size: 22),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 15,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      subtitle,
                      style: const TextStyle(
                        color: _BrandPalette.muted,
                        fontSize: 12,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ],
                ),
              ),
              const Icon(
                Icons.chevron_right_rounded,
                color: _BrandPalette.muted,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _AccountDrawer extends StatelessWidget {
  const _AccountDrawer({
    required this.email,
    required this.phoneTapEnabled,
    required this.onPhoneTapToggled,
    required this.onLogout,
  });

  final String email;
  final bool phoneTapEnabled;
  final ValueChanged<bool> onPhoneTapToggled;
  final VoidCallback onLogout;

  @override
  Widget build(BuildContext context) {
    return Drawer(
      backgroundColor: _BrandPalette.midnight,
      child: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(20, 16, 20, 32),
          child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Container(
            padding: const EdgeInsets.all(20),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(24),
              gradient: const LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: [_BrandPalette.surfaceHi, _BrandPalette.surface],
              ),
              border: Border.all(color: _BrandPalette.border),
            ),
            child: Row(
              children: [
                Container(
                  width: 60,
                  height: 60,
                  decoration: BoxDecoration(
                    color: _BrandPalette.cyan.withValues(alpha: 0.15),
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: const Icon(
                    Icons.person_rounded,
                    color: _BrandPalette.cyan,
                    size: 32,
                  ),
                ),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        'N1 Drivers',
                        style: TextStyle(
                          color: Colors.white,
                          fontSize: 20,
                          fontWeight: FontWeight.w900,
                          letterSpacing: -0.3,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        email,
                        style: const TextStyle(
                          color: _BrandPalette.muted,
                          fontSize: 13,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 22),
          const Text(
            'Stillingar',
            style: TextStyle(
              color: Colors.white,
              fontSize: 18,
              fontWeight: FontWeight.w900,
              letterSpacing: -0.2,
            ),
          ),
          const SizedBox(height: 10),
          _SettingsToggle(
            icon: Icons.nfc_rounded,
            title: 'Simatap (NFC)',
            subtitle:
                'Haltu simanum (<5cm) ad merki stodvarinnar til ad hefja hledslu.',
            value: phoneTapEnabled,
            onChanged: onPhoneTapToggled,
          ),
          const SizedBox(height: 10),
          _SettingsRow(
            icon: Icons.receipt_long_rounded,
            title: 'Hledslusaga',
            value: '${_seedSessions.length} hledslur',
            onTap: () {
              Navigator.of(context).pop();
              Navigator.of(context).push(
                MaterialPageRoute(
                  builder: (_) => const _SessionsScreen(),
                ),
              );
            },
          ),
          const SizedBox(height: 10),
          _SettingsRow(
            icon: Icons.credit_card_rounded,
            title: 'Greidsluskilmalar',
            value: '1 virkur',
            onTap: () {
              Navigator.of(context).pop();
              Navigator.of(context).push(
                MaterialPageRoute(
                  builder: (_) => const _PaymentTermsScreen(),
                ),
              );
            },
          ),
          const SizedBox(height: 10),
          const _SettingsRow(
            icon: Icons.translate_rounded,
            title: 'Tungumal',
            value: 'Islenska',
          ),
          const SizedBox(height: 10),
          const _SettingsRow(
            icon: Icons.nfc_rounded,
            title: 'RFID',
            value: 'EE43C609263CC7',
          ),
          const SizedBox(height: 24),
          OutlinedButton.icon(
            onPressed: onLogout,
            style: OutlinedButton.styleFrom(
              foregroundColor: _BrandPalette.danger,
              side: const BorderSide(color: _BrandPalette.danger),
              padding: const EdgeInsets.symmetric(vertical: 16),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(18),
              ),
            ),
            icon: const Icon(Icons.logout_rounded),
            label: const Text(
              'Utskra',
              style: TextStyle(fontSize: 16, fontWeight: FontWeight.w900),
            ),
          ),
          const SizedBox(height: 14),
          const Center(
            child: Text(
              'Straumvakt-driver - v0.3.0',
              style: TextStyle(
                color: _BrandPalette.muted,
                fontSize: 11,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
        ],
      ),
        ),
      ),
    );
  }
}

class _SettingsRow extends StatelessWidget {
  const _SettingsRow({
    required this.icon,
    required this.title,
    required this.value,
    this.onTap,
  });

  final IconData icon;
  final String title;
  final String value;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final body = Padding(
      padding: const EdgeInsets.all(14),
      child: Row(
        children: [
          Icon(icon, color: _BrandPalette.cyan, size: 22),
          const SizedBox(width: 12),
          Expanded(
            child: Text(
              title,
              style: const TextStyle(
                color: Colors.white,
                fontSize: 14,
                fontWeight: FontWeight.w900,
              ),
            ),
          ),
          Text(
            value,
            style: const TextStyle(
              color: _BrandPalette.muted,
              fontSize: 12,
              fontWeight: FontWeight.w800,
            ),
          ),
          if (onTap != null) ...[
            const SizedBox(width: 4),
            const Icon(
              Icons.chevron_right_rounded,
              color: _BrandPalette.muted,
              size: 20,
            ),
          ],
        ],
      ),
    );
    final decoration = BoxDecoration(
      color: _BrandPalette.surface,
      borderRadius: BorderRadius.circular(18),
      border: Border.all(color: _BrandPalette.border),
    );
    if (onTap == null) {
      return DecoratedBox(decoration: decoration, child: body);
    }
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(18),
        child: Ink(decoration: decoration, child: body),
      ),
    );
  }
}

class _SettingsToggle extends StatelessWidget {
  const _SettingsToggle({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.value,
    required this.onChanged,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final bool value;
  final ValueChanged<bool> onChanged;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(14, 10, 8, 10),
      decoration: BoxDecoration(
        color: _BrandPalette.surface,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(
          color: value
              ? _BrandPalette.cyan.withValues(alpha: 0.5)
              : _BrandPalette.border,
        ),
      ),
      child: Row(
        children: [
          Icon(
            icon,
            color: value ? _BrandPalette.cyan : _BrandPalette.muted,
            size: 22,
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 14,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  subtitle,
                  style: const TextStyle(
                    color: _BrandPalette.muted,
                    fontSize: 12,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ],
            ),
          ),
          Switch.adaptive(
            value: value,
            activeColor: _BrandPalette.cyan,
            onChanged: onChanged,
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Payment terms screen — invoked from drawer.
// "My Company Pays my bill" request is a stub; HARDWIRE later via the
// Issue Engine / driver-billing flow when it ships.
// ---------------------------------------------------------------------------

class _PaymentTerm {
  const _PaymentTerm({
    required this.label,
    required this.detail,
    required this.scope,
    required this.isActive,
  });

  final String label;
  final String detail;
  final String scope;
  final bool isActive;
}

const _seedPaymentTerms = <_PaymentTerm>[
  _PaymentTerm(
    label: 'N1 fyrirtaekjareikningur',
    detail: 'Manadarleg innheimta a kennitolu N1 ehf.',
    scope: 'Allar hledslur',
    isActive: true,
  ),
  _PaymentTerm(
    label: 'Personulegur korthald',
    detail: 'Visa **** 4291 - sjalfgefin greidslulei  d.',
    scope: 'Heimahledsla og opin svaedi',
    isActive: false,
  ),
];

class _PaymentTermsScreen extends StatefulWidget {
  const _PaymentTermsScreen();

  @override
  State<_PaymentTermsScreen> createState() => _PaymentTermsScreenState();
}

class _PaymentTermsScreenState extends State<_PaymentTermsScreen> {
  bool _requestSent = false;

  void _sendCompanyRequest() {
    setState(() => _requestSent = true);
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        backgroundColor: _BrandPalette.surface,
        content: Text(
          'Beidni mottekin - vid setjum okkur i samband.',
          style: TextStyle(color: Colors.white, fontWeight: FontWeight.w800),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: _BrandPalette.midnight,
      body: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(8, 14, 12, 8),
              child: Row(
                children: [
                  IconButton(
                    onPressed: () => Navigator.of(context).pop(),
                    icon: const Icon(
                      Icons.arrow_back_rounded,
                      color: Colors.white,
                    ),
                  ),
                  const SizedBox(width: 6),
                  const Expanded(
                    child: Text(
                      'Greidsluskilmalar',
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        color: Colors.white,
                        fontSize: 20,
                        fontWeight: FontWeight.w900,
                        letterSpacing: -0.4,
                      ),
                    ),
                  ),
                ],
              ),
            ),
            Expanded(
              child: SingleChildScrollView(
                padding: const EdgeInsets.fromLTRB(20, 8, 20, 32),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    const Text(
                      'Skilmalar tengdir tinum adgangi',
                      style: TextStyle(
                        color: Colors.white,
                        fontSize: 16,
                        fontWeight: FontWeight.w900,
                        letterSpacing: -0.2,
                      ),
                    ),
                    const SizedBox(height: 4),
                    const Text(
                      'Yfirlit yfir hverjir greida fyrir hverja hledslu.',
                      style: TextStyle(
                        color: _BrandPalette.muted,
                        fontSize: 13,
                      ),
                    ),
                    const SizedBox(height: 14),
                    for (final t in _seedPaymentTerms) ...[
                      _PaymentTermTile(term: t),
                      const SizedBox(height: 10),
                    ],
                    const SizedBox(height: 18),
                    _CompanyRequestCard(
                      sent: _requestSent,
                      onSend: _sendCompanyRequest,
                    ),
                    const SizedBox(height: 16),
                    Container(
                      padding: const EdgeInsets.all(14),
                      decoration: BoxDecoration(
                        color: _BrandPalette.surface,
                        borderRadius: BorderRadius.circular(18),
                        border: Border.all(color: _BrandPalette.border),
                      ),
                      child: const Row(
                        children: [
                          Icon(
                            Icons.info_outline_rounded,
                            color: _BrandPalette.muted,
                            size: 20,
                          ),
                          SizedBox(width: 10),
                          Expanded(
                            child: Text(
                              'Skilmalar eru sjalfvirkt valdir eftir tegund hledslu og samningi vid rekstraradila.',
                              style: TextStyle(
                                color: _BrandPalette.muted,
                                fontSize: 12,
                                fontWeight: FontWeight.w700,
                                height: 1.35,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _PaymentTermTile extends StatelessWidget {
  const _PaymentTermTile({required this.term});

  final _PaymentTerm term;

  @override
  Widget build(BuildContext context) {
    final statusColor =
        term.isActive ? _BrandPalette.mint : _BrandPalette.muted;
    final statusLabel = term.isActive ? 'Virkur' : 'Ovirkur';
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: _BrandPalette.surface,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(
          color: term.isActive
              ? _BrandPalette.cyan.withValues(alpha: 0.4)
              : _BrandPalette.border,
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Container(
                width: 40,
                height: 40,
                decoration: BoxDecoration(
                  color: _BrandPalette.cyan.withValues(alpha: 0.13),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: const Icon(
                  Icons.receipt_long_rounded,
                  color: _BrandPalette.cyan,
                  size: 22,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Text(
                  term.label,
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 15,
                    fontWeight: FontWeight.w900,
                    letterSpacing: -0.2,
                  ),
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 10,
                  vertical: 6,
                ),
                decoration: BoxDecoration(
                  color: statusColor.withValues(alpha: 0.13),
                  borderRadius: BorderRadius.circular(99),
                  border: Border.all(
                    color: statusColor.withValues(alpha: 0.45),
                  ),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Container(
                      width: 7,
                      height: 7,
                      decoration: BoxDecoration(
                        color: statusColor,
                        shape: BoxShape.circle,
                      ),
                    ),
                    const SizedBox(width: 6),
                    Text(
                      statusLabel,
                      style: TextStyle(
                        color: statusColor,
                        fontSize: 11,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Text(
            term.detail,
            style: const TextStyle(
              color: _BrandPalette.muted,
              fontSize: 12,
              fontWeight: FontWeight.w700,
              height: 1.4,
            ),
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              const Icon(
                Icons.layers_rounded,
                color: _BrandPalette.muted,
                size: 14,
              ),
              const SizedBox(width: 4),
              Text(
                term.scope,
                style: const TextStyle(
                  color: _BrandPalette.muted,
                  fontSize: 11,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _CompanyRequestCard extends StatelessWidget {
  const _CompanyRequestCard({required this.sent, required this.onSend});

  final bool sent;
  final VoidCallback onSend;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(22),
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            _BrandPalette.cyan.withValues(alpha: 0.18),
            _BrandPalette.surface,
          ],
        ),
        border: Border.all(
          color: _BrandPalette.cyan.withValues(alpha: 0.5),
          width: 1.2,
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Container(
                width: 40,
                height: 40,
                decoration: BoxDecoration(
                  color: _BrandPalette.cyan.withValues(alpha: 0.18),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: const Icon(
                  Icons.business_center_rounded,
                  color: _BrandPalette.cyan,
                  size: 22,
                ),
              ),
              const SizedBox(width: 12),
              const Expanded(
                child: Text(
                  'Lattu fyrirtaekid borga',
                  style: TextStyle(
                    color: Colors.white,
                    fontSize: 16,
                    fontWeight: FontWeight.w900,
                    letterSpacing: -0.3,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          const Text(
            'Bidja vinnuveitanda thinn um ad taka yfir reikninga fyrir hledslur a starfstengdum ferdum.',
            style: TextStyle(
              color: _BrandPalette.muted,
              fontSize: 13,
              fontWeight: FontWeight.w600,
              height: 1.4,
            ),
          ),
          const SizedBox(height: 14),
          SizedBox(
            width: double.infinity,
            child: FilledButton.icon(
              onPressed: sent ? null : onSend,
              style: FilledButton.styleFrom(
                backgroundColor: _BrandPalette.cyan,
                foregroundColor: _BrandPalette.midnight,
                disabledBackgroundColor:
                    _BrandPalette.mint.withValues(alpha: 0.2),
                disabledForegroundColor: _BrandPalette.mint,
                padding: const EdgeInsets.symmetric(vertical: 14),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(16),
                ),
              ),
              icon: Icon(
                sent ? Icons.check_circle_rounded : Icons.send_rounded,
              ),
              label: Text(
                sent ? 'Beidni send' : 'Senda beidni',
                style: const TextStyle(
                  fontSize: 15,
                  fontWeight: FontWeight.w900,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Sessions (Hledslusaga) — pushed from the drawer.
// ---------------------------------------------------------------------------

class _SessionsScreen extends StatelessWidget {
  const _SessionsScreen();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: _BrandPalette.midnight,
      body: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(8, 14, 12, 8),
              child: Row(
                children: [
                  IconButton(
                    onPressed: () => Navigator.of(context).pop(),
                    icon: const Icon(
                      Icons.arrow_back_rounded,
                      color: Colors.white,
                    ),
                  ),
                  const SizedBox(width: 6),
                  const Expanded(
                    child: Text(
                      'Hledslusaga',
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        color: Colors.white,
                        fontSize: 20,
                        fontWeight: FontWeight.w900,
                        letterSpacing: -0.4,
                      ),
                    ),
                  ),
                ],
              ),
            ),
            const Expanded(child: _SessionsTab(sessions: _seedSessions)),
          ],
        ),
      ),
    );
  }
}
