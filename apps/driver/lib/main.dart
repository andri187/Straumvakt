// Straumvakt driver app — driver-first UX.
//
// Two-level Charge tab:
//   Site picker  ->  Charger list within a site  ->  Live charging view
//
// Snertilaust auth is NFC-only (lib/nfc_auth.dart): the phone reads a charger's
// NFC tag (<5cm) — an NDEF URL https://straumvakt.org/c/<id>, connector UUID,
// Zaptec serial, or display name. We resolve it to one of the driver's
// accessible chargers and open the confirm sheet, or show "no access". The
// read works cross-platform (iOS Core NFC + Android via nfc_manager). No BLE.
// Login/chargers/start-session run against the staging API (config.dart).
// See ADR 0024 addendum (2026-06-07).

import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/foundation.dart' show kDebugMode;
import 'package:flutter/material.dart';

import 'api.dart';
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
    required this.chargerId,
    required this.serial,
    required this.status,
    required this.priceLabel,
    required this.maxPowerKw,
    required this.connectorType,
  });

  /// Connector UUID — used for start-session and live-session matching.
  final String id;

  /// Charging-station (charger) UUID — used for the pricing endpoint.
  final String chargerId;
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
    this.perKwh,
    this.currency = 'ISK',
    this.vatRatePct = 0,
  });

  final String id;
  final String name;
  final String address;
  final String distanceLabel;
  final Color accent;
  final List<Charger> chargers;

  /// Indicative total contract price per kWh for this location (from
  /// /installations). Null when no pricing is available.
  final double? perKwh;
  final String currency;
  final double vatRatePct;

  int countWhere(bool Function(Charger) f) =>
      chargers.where(f).length;
  int get countAvailable => countWhere((c) => c.status == ChargerStatus.available);
  int get countInUse => countWhere((c) => c.status == ChargerStatus.inUse);
  int get countOffline => countWhere((c) => c.status == ChargerStatus.offline);
}


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
    text: kDebugMode ? 'driver@n1.is' : '',
  );
  late final TextEditingController _password = TextEditingController(
    text: kDebugMode ? '1234' : '',
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
          errorBuilder: (_, _, _) {
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
            errorBuilder: (_, _, _) {
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
      errorBuilder: (_, _, _) {
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
  // Default screen = Hledsla (the charge flow) on launch.
  static const _homeTab = 1; // Hledsla
  int _tab = _homeTab;
  // Tab history so the system back button steps back through visited screens
  // instead of closing the app.
  final List<int> _tabHistory = [];
  bool _phoneTapEnabled = true;

  // Drives the navigation Drawer, opened from the top-right hamburger.
  final _scaffoldKey = GlobalKey<ScaffoldState>();

  void _openMenu() => _scaffoldKey.currentState?.openDrawer();

  void _selectTab(int i) {
    if (i != _tab) {
      setState(() {
        _tabHistory.add(_tab);
        _tab = i;
      });
    }
    if (Navigator.of(context).canPop()) {
      Navigator.of(context).pop(); // close the drawer if it is open
    }
  }

  // System back: close a drilled-in site, else step back through tab history,
  // else (on the home tab with empty history) allow the app to exit.
  bool get _canPopApp => _activeSite == null && _tabHistory.isEmpty;

  void _handleBack() {
    setState(() {
      if (_activeSite != null) {
        _activeSite = null;
      } else if (_tabHistory.isNotEmpty) {
        _tab = _tabHistory.removeLast();
      }
    });
  }

  // Sites — empty until the API responds (no mock fallback).
  List<Site> _sites = const [];
  bool _loadingChargers = true;
  bool _startingSession = false;

  // ── Auth: NFC tap is the SOLE trigger — ADR 0024 addendum (2026-06-07) ──
  //
  // The phone reads a charger's NFC tag (NDEF: an https://straumvakt.org/c/<id>
  // URL, the connector UUID, the Zaptec serial, or the display name); we
  // resolve it to one of the driver's accessible chargers and open the confirm
  // sheet, or show "no access". Cross-platform (iOS Core NFC + Android, via
  // nfc_manager). No BLE — proximity is NFC range only.
  final _nfc = NfcTapReader();
  StreamSubscription<NfcTapHit>? _nfcSub;

  bool _tapPromptOpen = false;
  DateTime _tapCooldownUntil = DateTime.fromMillisecondsSinceEpoch(0);

  // Two-level Charge tab nav state:
  Site? _activeSite;

  // Live charging state — driven by the REAL session from /sessions/current,
  // not a local optimistic timer. _liveSessionId is the charge-session uuid
  // (needed to stop); _liveStartedAt / _liveEnergyKwh are the server's live
  // values. _sessionPoll confirms the start and refreshes telemetry.
  _ChargeState _chargeState = _ChargeState.idle;
  Charger? _liveCharger;
  Site? _liveSite;
  String? _liveSessionId;
  DateTime? _liveStartedAt;
  double _liveEnergyKwh = 0;
  double _livePowerKw = 0;
  double _liveCostIsk = 0;
  ChargerPricing? _livePricing;
  bool _stopping = false;
  Timer? _sessionPoll;
  Timer? _prepareTimeout;
  bool _polling = false;

  @override
  void initState() {
    super.initState();
    _nfcSub = _nfc.taps.listen(_onNfcTap);
    unawaited(_loadChargers().then((_) => _startNfc()));
  }

  @override
  void dispose() {
    _sessionPoll?.cancel();
    _prepareTimeout?.cancel();
    _nfcSub?.cancel();
    _nfc.dispose();
    super.dispose();
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
          if (kDebugMode) debugPrint('[NFC] matched ${c.serial}');
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
      // Installation pricing is additive — if it fails, the cards just show
      // no price rather than failing the whole load.
      List<DriverInstallation> installs = const [];
      try {
        installs = await widget.api.installations(widget.accessToken);
      } catch (_) {}
      final pricingByName = <String, DriverInstallation>{
        for (final i in installs) i.displayName: i,
      };
      if (!mounted) return;
      setState(() {
        _sites = _groupChargers(apiChargers, pricingByName);
        _activeSite = null; // reset any drill-down to a stale site reference
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
    } finally {
      if (mounted) setState(() => _loadingChargers = false);
    }
  }

  List<Site> _groupChargers(
    List<ApiCharger> chargers, [
    Map<String, DriverInstallation> pricingByName = const {},
  ]) {
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
      // locationName == installation.displayName (see /chargers route), which
      // is the same key /installations returns — so this match is exact.
      final inst = pricingByName[locationName];
      out.add(
        Site(
          id: 'site-api-$i-${locationName.hashCode}',
          name: locationName,
          address: inst?.siteAddress ?? '',
          distanceLabel: '',
          accent: accents[i % accents.length],
          perKwh: (inst != null && inst.perKwh > 0) ? inst.perKwh : null,
          currency: inst?.currency ?? 'ISK',
          vatRatePct: inst?.vatRatePct ?? 0,
          chargers: [
            for (final c in group)
              Charger(
                // Charger.id repurposed to carry the connector UUID for
                // start-session calls. The seed data uses local strings
                // here; API-sourced rows use real UUIDs.
                id: c.connectorId,
                chargerId: c.chargerId,
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
      _liveSessionId = null;
      _liveStartedAt = null;
      _liveEnergyKwh = 0;
      _livePowerKw = 0;
      _liveCostIsk = 0;
      _livePricing = null;
      _stopping = false;
    });
    // Indicative contract pricing for this charger — best-effort, in parallel
    // with the start command. Feeds the price card; absence just hides it.
    unawaited(_fetchPricing(charger));
    try {
      final result = await widget.api.startSession(
        widget.accessToken,
        connectorId: charger.id,
      );
      if (!mounted) return;
      // The RemoteStart command is only ENQUEUED here — the charger has not
      // confirmed anything yet. We stay on the "connecting" screen and poll
      // /sessions/current; the charging screen appears ONLY once the charger
      // actually reports the transaction. Never optimistic — otherwise we'd
      // show elapsed time / progress for a charger that isn't connected.
      setState(() => _startingSession = false);
      final tokenInfo = result.tokenKind != null
          ? ' (${result.tokenKind})'
          : '';
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Skipun send: ${result.chargerName}$tokenInfo'),
          backgroundColor: _BrandPalette.surface,
        ),
      );
      _startSessionPolling(charger);
    } on ApiException catch (e) {
      if (!mounted) return;
      _resetLiveCharge();
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
      _resetLiveCharge();
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Villa: $e'),
          backgroundColor: const Color(0xFF3A1620),
        ),
      );
    }
  }

  // Bind the live charging screen to the REAL session.
  //
  // While preparing we poll fast (every 4s) and the charging screen does NOT
  // appear until the charger actually reports a session under this connector
  // — so we never show elapsed time / progress for a charger that isn't
  // connected. If nothing reports within 90s we assume the charger didn't
  // start and return to idle. Once confirmed we drop to a 5-minute refresh
  // cadence for the live values. If a confirmed session later disappears, the
  // charge ended (remote stop, unplug, or fault) and we go back to idle.
  Future<void> _fetchPricing(Charger charger) async {
    try {
      final pricing = await widget.api.chargerPricing(
        widget.accessToken,
        chargerId: charger.chargerId,
      );
      if (!mounted) return;
      // Only apply if we're still on this charger's session.
      if (_liveCharger?.id == charger.id) {
        setState(() => _livePricing = pricing);
      }
    } catch (_) {
      // Best-effort — the card just stays hidden if pricing can't load.
    }
  }

  void _startSessionPolling(Charger charger) {
    _sessionPoll?.cancel();
    _prepareTimeout?.cancel();
    _prepareTimeout = Timer(const Duration(seconds: 90), () {
      if (!mounted || _chargeState != _ChargeState.preparing) return;
      _sessionPoll?.cancel();
      _resetLiveCharge();
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Hledslustodin svaradi ekki. Reyndu aftur.'),
          backgroundColor: Color(0xFF3A1620),
        ),
      );
    });
    _sessionPoll = Timer.periodic(
      const Duration(seconds: 4),
      (_) => unawaited(_pollSessionOnce(charger)),
    );
    unawaited(_pollSessionOnce(charger));
  }

  Future<void> _pollSessionOnce(Charger charger) async {
    if (_polling) return; // don't stack requests on the fast cadence
    if (!mounted || _chargeState == _ChargeState.idle) {
      _sessionPoll?.cancel();
      return;
    }
    _polling = true;
    List<ActiveSession> sessions;
    try {
      sessions = await widget.api.currentSessions(widget.accessToken);
    } on ApiException catch (e) {
      if (e.isAuth) {
        _sessionPoll?.cancel();
        _prepareTimeout?.cancel();
        if (mounted) widget.onAuthExpired();
      }
      return; // transient otherwise — keep waiting / keep existing values
    } catch (_) {
      return; // network blip
    } finally {
      _polling = false;
    }
    if (!mounted) return;
    // Prefer an exact connector match; fall back to the sole active session.
    ActiveSession? match;
    for (final s in sessions) {
      if (s.connectorId == charger.id) {
        match = s;
        break;
      }
    }
    match ??= sessions.length == 1 ? sessions.first : null;

    if (match != null) {
      final justConfirmed = _chargeState != _ChargeState.charging;
      setState(() {
        _chargeState = _ChargeState.charging;
        _liveSessionId = match!.sessionId;
        _liveEnergyKwh = match.energyKwh;
        _livePowerKw = match.powerKw;
        _liveCostIsk = match.costIsk;
        _liveStartedAt = match.startedAt ?? _liveStartedAt;
      });
      if (justConfirmed) {
        // Real connection confirmed → stop the fast confirm cadence and the
        // timeout, then refresh the live values AND the contract pricing every
        // 5 minutes from here (so a host price change shows mid-session).
        _prepareTimeout?.cancel();
        _sessionPoll?.cancel();
        _sessionPoll = Timer.periodic(const Duration(minutes: 5), (_) {
          unawaited(_pollSessionOnce(charger));
          unawaited(_fetchPricing(charger));
        });
      }
    } else if (_liveSessionId != null) {
      // We had a confirmed session and now it's gone → the charge ended.
      _onSessionEnded();
    }
    // else: still preparing, charger hasn't reported yet — keep waiting.
  }

  void _onSessionEnded() {
    _sessionPoll?.cancel();
    _prepareTimeout?.cancel();
    if (!mounted) return;
    _resetLiveCharge();
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text('Hledslu lokid.'),
        backgroundColor: _BrandPalette.surface,
      ),
    );
  }

  void _resetLiveCharge() {
    setState(() {
      _startingSession = false;
      _stopping = false;
      _chargeState = _ChargeState.idle;
      _liveCharger = null;
      _liveSite = null;
      _liveSessionId = null;
      _liveStartedAt = null;
      _liveEnergyKwh = 0;
      _livePowerKw = 0;
      _liveCostIsk = 0;
      _livePricing = null;
    });
  }

  // Real stop. If we don't yet have a confirmed session id (still preparing),
  // there's nothing to stop remotely — just cancel locally. Otherwise send a
  // RemoteStopTransaction and let the poller flip us to idle when the session
  // actually leaves /sessions/current.
  Future<void> _stopCharging() async {
    final sessionId = _liveSessionId;
    if (sessionId == null) {
      _sessionPoll?.cancel();
      _prepareTimeout?.cancel();
      _resetLiveCharge();
      return;
    }
    if (_stopping) return;
    setState(() => _stopping = true);
    try {
      await widget.api.stopSession(widget.accessToken, sessionId: sessionId);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Stoppa hledslu...'),
          backgroundColor: _BrandPalette.surface,
        ),
      );
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() => _stopping = false);
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
      setState(() => _stopping = false);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Villa: $e'),
          backgroundColor: const Color(0xFF3A1620),
        ),
      );
    }
  }

  void _openSupport() {
    Navigator.of(context).pop(); // close the drawer first
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => Scaffold(
          backgroundColor: _BrandPalette.midnight,
          body: SafeArea(
            child: Column(
              children: [
                _DetailHeader(title: 'Adstod'),
                const Expanded(child: _SupportTab()),
              ],
            ),
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: _canPopApp,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) _handleBack();
      },
      child: Scaffold(
      key: _scaffoldKey,
      backgroundColor: _BrandPalette.midnight,
      // Navigation lives in the top-right hamburger -> end drawer.
      drawer: _NavDrawer(
        driverEmail: widget.driverEmail,
        currentTab: _tab,
        onSelectTab: _selectTab,
        onSupport: _openSupport,
        onLogout: () {
          Navigator.of(context).pop(); // close the drawer
          widget.onLogout();
        },
      ),
      body: SafeArea(
        bottom: false,
        child: switch (_tab) {
          0 => _DashboardTab(
              driverEmail: widget.driverEmail,
              sites: _sites,
              phoneTapEnabled: _phoneTapEnabled,
              loading: _loadingChargers,
              onStartCharging: () => _selectTab(1),
              onMenu: _openMenu,
            ),
          1 => _ChargeTab(
              sites: _sites,
              activeSite: _activeSite,
              onOpenSite: _openSite,
              onCloseSite: _closeSite,
              phoneTapEnabled: _phoneTapEnabled,
              chargeState: _chargeState,
              liveCharger: _liveCharger,
              liveSite: _liveSite,
              liveStartedAt: _liveStartedAt,
              livePowerKw: _livePowerKw,
              liveEnergyKwh: _liveEnergyKwh,
              liveCostIsk: _liveCostIsk,
              livePricing: _livePricing,
              onStartCharger: (s, c) => unawaited(_enterPreparing(s, c)),
              onStopCharging: () => unawaited(_stopCharging()),
              onFetchChargerPricing: (c) => widget.api.chargerPricing(
                widget.accessToken,
                chargerId: c.chargerId,
              ),
              driverEmail: widget.driverEmail,
              loading: _loadingChargers,
              onMenu: _openMenu,
            ),
          2 => _HistoryTab(onMenu: _openMenu),
          3 => _CostTab(onMenu: _openMenu),
          _ => _SettingsTab(
              email: widget.driverEmail,
              sites: _sites,
              phoneTapEnabled: _phoneTapEnabled,
              onMenu: _openMenu,
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
        },
      ),
      ),
    );
  }
}

enum _ChargeState { idle, preparing, charging }

// ---------------------------------------------------------------------------
// Navigation drawer — the app's sole top-level navigation, opened from the
// top-right hamburger. Lists Yfirlit / Hledsla / Saga / Kostnadur /
// Stillingar / Adstod / Utskra. Stillingar holds its own grouped sub-sections.
// ---------------------------------------------------------------------------

class _NavDrawer extends StatelessWidget {
  const _NavDrawer({
    required this.driverEmail,
    required this.currentTab,
    required this.onSelectTab,
    required this.onSupport,
    required this.onLogout,
  });

  final String driverEmail;
  final int currentTab;
  final ValueChanged<int> onSelectTab;
  final VoidCallback onSupport;
  final VoidCallback onLogout;

  @override
  Widget build(BuildContext context) {
    return Drawer(
      backgroundColor: _BrandPalette.deepNavy,
      child: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // Header — driver identity.
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 22, 16, 18),
              child: Row(
                children: [
                  const _LogoMark(size: 44, borderRadius: 14),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          _firstName(driverEmail),
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 17,
                            fontWeight: FontWeight.w900,
                            letterSpacing: -0.3,
                          ),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          driverEmail,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            color: _BrandPalette.muted,
                            fontSize: 12.5,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            const Divider(height: 1, thickness: 1, color: _BrandPalette.border),
            const SizedBox(height: 6),
            _NavDrawerItem(
              icon: Icons.dashboard_rounded,
              label: 'Yfirlit',
              selected: currentTab == 0,
              onTap: () => onSelectTab(0),
            ),
            _NavDrawerItem(
              icon: Icons.ev_station_rounded,
              label: 'Hledsla',
              selected: currentTab == 1,
              onTap: () => onSelectTab(1),
            ),
            _NavDrawerItem(
              icon: Icons.history_rounded,
              label: 'Saga',
              selected: currentTab == 2,
              onTap: () => onSelectTab(2),
            ),
            _NavDrawerItem(
              icon: Icons.receipt_long_rounded,
              label: 'Kostnadur',
              selected: currentTab == 3,
              onTap: () => onSelectTab(3),
            ),
            _NavDrawerItem(
              icon: Icons.settings_rounded,
              label: 'Stillingar',
              selected: currentTab == 4,
              onTap: () => onSelectTab(4),
            ),
            const SizedBox(height: 6),
            const Divider(height: 1, thickness: 1, color: _BrandPalette.border),
            const SizedBox(height: 6),
            _NavDrawerItem(
              icon: Icons.support_agent_rounded,
              label: 'Adstod',
              selected: false,
              onTap: onSupport,
            ),
            _NavDrawerItem(
              icon: Icons.logout_rounded,
              label: 'Utskra',
              selected: false,
              danger: true,
              onTap: onLogout,
            ),
          ],
        ),
      ),
    );
  }
}

class _NavDrawerItem extends StatelessWidget {
  const _NavDrawerItem({
    required this.icon,
    required this.label,
    required this.selected,
    required this.onTap,
    this.danger = false,
  });

  final IconData icon;
  final String label;
  final bool selected;
  final VoidCallback onTap;
  final bool danger;

  @override
  Widget build(BuildContext context) {
    final accent = danger ? _BrandPalette.danger : _BrandPalette.cyan;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 2),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(14),
          child: Ink(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(14),
              color: selected
                  ? _BrandPalette.cyan.withValues(alpha: 0.14)
                  : Colors.transparent,
              border: Border.all(
                color: selected
                    ? _BrandPalette.cyan.withValues(alpha: 0.5)
                    : Colors.transparent,
              ),
            ),
            child: Row(
              children: [
                Icon(icon, color: accent, size: 22),
                const SizedBox(width: 14),
                Text(
                  label,
                  style: TextStyle(
                    color: danger ? _BrandPalette.danger : Colors.white,
                    fontSize: 15,
                    fontWeight: FontWeight.w900,
                    letterSpacing: -0.2,
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
    required this.liveStartedAt,
    required this.livePowerKw,
    required this.liveEnergyKwh,
    required this.liveCostIsk,
    required this.livePricing,
    required this.onStartCharger,
    required this.onStopCharging,
    required this.onFetchChargerPricing,
    required this.driverEmail,
    required this.loading,
    required this.onMenu,
  });

  final List<Site> sites;
  final Site? activeSite;
  final ValueChanged<Site> onOpenSite;
  final VoidCallback onCloseSite;
  final bool phoneTapEnabled;
  final _ChargeState chargeState;
  final Charger? liveCharger;
  final Site? liveSite;
  final DateTime? liveStartedAt;
  final double livePowerKw;
  final double liveEnergyKwh;
  final double liveCostIsk;
  final ChargerPricing? livePricing;
  final void Function(Site site, Charger charger) onStartCharger;
  final VoidCallback onStopCharging;
  final Future<ChargerPricing?> Function(Charger charger) onFetchChargerPricing;
  final String driverEmail;
  final bool loading;
  final VoidCallback onMenu;

  @override
  Widget build(BuildContext context) {
    final isLive = chargeState != _ChargeState.idle;
    return Column(
      children: [
        _AppHeader(
          onBack: !isLive && activeSite != null ? onCloseSite : null,
          title: _firstName(driverEmail),
          onMenu: onMenu,
        ),
        Expanded(
          child: isLive
              ? _LiveChargingView(
                  state: chargeState,
                  charger: liveCharger!,
                  site: liveSite!,
                  startedAt: liveStartedAt,
                  powerKw: livePowerKw,
                  energyKwh: liveEnergyKwh,
                  costIsk: liveCostIsk,
                  pricing: livePricing,
                  onStop: onStopCharging,
                )
              : activeSite == null
                  ? (loading && sites.isEmpty
                      ? const Center(
                          child: CircularProgressIndicator(
                            color: _BrandPalette.cyan,
                          ),
                        )
                      : _SitesPicker(sites: sites, onOpen: onOpenSite))
                  : _ChargersList(
                      site: activeSite!,
                      onChangeSite: onCloseSite,
                      onStart: (c) => onStartCharger(activeSite!, c),
                      onFetchPricing: onFetchChargerPricing,
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
    this.onMenu,
  });

  final VoidCallback? onBack;
  // When set, a hamburger icon is shown on the TOP-RIGHT that opens the
  // navigation drawer. This is the app's sole top-level navigation control.
  final VoidCallback? onMenu;
  final String title;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(8, 14, 4, 8),
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
          if (onMenu != null)
            IconButton(
              onPressed: onMenu,
              tooltip: 'Valmynd',
              icon: const Icon(Icons.menu_rounded, color: Colors.white),
            ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Snertilaust banner — single visual affordance for BLE auto-tap.
// In debug builds, tapping it simulates a reader detection sheet.
// ---------------------------------------------------------------------------

class _PhoneTapBanner extends StatefulWidget {
  const _PhoneTapBanner();

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
                  builder: (_, _) {
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
                        'Snertilaust virkt',
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
        if (sites.isEmpty)
          const Padding(
            padding: EdgeInsets.only(top: 40),
            child: Center(
              child: Text(
                'Engar hledslustodvar i thinum adgangi enn.',
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: _BrandPalette.muted,
                  fontSize: 14,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
          )
        else
          for (final site in sites) ...[
            _SiteCard(site: site, onTap: () => onOpen(site)),
            const SizedBox(height: 8),
          ],
      ],
    );
  }
}

// ISK money is stored in aurar (1/100 króna) everywhere in Straumvakt — the
// web portal divides by 100 for display (src/app/driver/*). The mobile app
// must match: ÷100, two decimals, is-IS style (',' decimal, '.' thousands).
// e.g. 1747 → "17,47", 864 → "8,64", 1234567 → "12.345,67".
String _krFromAurar(double aurarValue) {
  final aurar = aurarValue.round();
  final neg = aurar < 0;
  final a = aurar.abs();
  final whole = a ~/ 100;
  final frac = (a % 100).toString().padLeft(2, '0');
  final ws = whole.toString();
  final b = StringBuffer();
  for (var i = 0; i < ws.length; i++) {
    if (i > 0 && (ws.length - i) % 3 == 0) b.write('.');
    b.write(ws[i]);
  }
  return '${neg ? '-' : ''}$b,$frac';
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
                        fontSize: 15,
                        fontWeight: FontWeight.w900,
                        letterSpacing: -0.2,
                      ),
                    ),
                    if (site.address.isNotEmpty) ...[
                      const SizedBox(height: 1),
                      Text(
                        site.address,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          color: _BrandPalette.muted,
                          fontSize: 11.5,
                          fontWeight: FontWeight.w500,
                        ),
                      ),
                    ],
                    const SizedBox(height: 3),
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
              // Total contract price per kWh — the location's headline number,
              // slightly larger, on the RIGHT edge of the card.
              if (site.perKwh != null) ...[
                const SizedBox(width: 10),
                SizedBox(
                  width: 70,
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      FittedBox(
                        fit: BoxFit.scaleDown,
                        child: Text(
                          // VAT-inclusive, to match the expanded card total.
                          _krFromAurar(
                            site.perKwh! * (1 + site.vatRatePct / 100),
                          ),
                          maxLines: 1,
                          style: TextStyle(
                            color: site.accent,
                            fontSize: 23,
                            fontWeight: FontWeight.w900,
                            letterSpacing: -0.5,
                            fontFeatures: const [FontFeature.tabularFigures()],
                          ),
                        ),
                      ),
                      const Text(
                        'kr/kWh',
                        style: TextStyle(
                          color: _BrandPalette.muted,
                          fontSize: 10,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
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
    required this.onFetchPricing,
  });

  final Site site;
  final VoidCallback onChangeSite;
  final ValueChanged<Charger> onStart;
  final Future<ChargerPricing?> Function(Charger charger) onFetchPricing;

  @override
  State<_ChargersList> createState() => _ChargersListState();
}

class _ChargersListState extends State<_ChargersList> {
  _ChargerFilter _filter = _ChargerFilter.all;

  // Tap-to-expand: the currently open charger (by connector id), plus a lazy
  // per-charger pricing cache keyed by chargerId.
  String? _expandedId;
  final Map<String, ChargerPricing?> _pricingCache = {};
  final Set<String> _pricingLoading = {};

  void _toggle(Charger c) {
    setState(() {
      _expandedId = _expandedId == c.id ? null : c.id;
    });
    if (_expandedId != c.id) return; // collapsing — nothing to fetch
    if (_pricingCache.containsKey(c.chargerId) ||
        _pricingLoading.contains(c.chargerId)) {
      return; // already have it / in flight
    }
    setState(() => _pricingLoading.add(c.chargerId));
    widget.onFetchPricing(c).then((p) {
      if (!mounted) return;
      setState(() {
        _pricingLoading.remove(c.chargerId);
        _pricingCache[c.chargerId] = p;
      });
    }).catchError((_) {
      if (!mounted) return;
      setState(() => _pricingLoading.remove(c.chargerId));
    });
  }

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
              separatorBuilder: (_, _) => const SizedBox(height: 8),
              itemBuilder: (_, i) {
                final c = filtered[i];
                return _ChargerRow(
                  charger: c,
                  accent: widget.site.accent,
                  expanded: _expandedId == c.id,
                  pricing: _pricingCache[c.chargerId],
                  pricingLoading: _pricingLoading.contains(c.chargerId),
                  fallbackPerKwh: widget.site.perKwh,
                  fallbackVatPct: widget.site.vatRatePct,
                  onToggle: () => _toggle(c),
                  onStart: () => widget.onStart(c),
                );
              },
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

// A charger row that expands on tap into a dropdown showing the driver's
// contract pricing (lazily fetched) + a "start charge" button. Tapping the
// header toggles; pricing reuses the in-session _CsPriceCard breakdown.
class _ChargerRow extends StatelessWidget {
  const _ChargerRow({
    required this.charger,
    required this.accent,
    required this.expanded,
    required this.pricing,
    required this.pricingLoading,
    required this.fallbackPerKwh,
    required this.fallbackVatPct,
    required this.onToggle,
    required this.onStart,
  });

  final Charger charger;
  final Color accent;
  final bool expanded;
  final ChargerPricing? pricing;
  final bool pricingLoading;
  final double? fallbackPerKwh;
  final double fallbackVatPct;
  final VoidCallback onToggle;
  final VoidCallback onStart;

  @override
  Widget build(BuildContext context) {
    final isUsable = charger.status == ChargerStatus.available;
    return Material(
      color: Colors.transparent,
      child: Ink(
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(18),
          color: _BrandPalette.surface,
          border: Border.all(
            color: expanded
                ? accent.withValues(alpha: 0.8)
                : (isUsable
                    ? accent.withValues(alpha: 0.45)
                    : _BrandPalette.border),
          ),
        ),
        child: Column(
          children: [
            // Header — tap toggles the dropdown.
            InkWell(
              onTap: onToggle,
              borderRadius: BorderRadius.circular(18),
              child: Padding(
                padding: const EdgeInsets.fromLTRB(14, 12, 12, 12),
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
                            '${charger.maxPowerKw.toStringAsFixed(0)} kW · ${charger.connectorType}',
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
                      expanded
                          ? Icons.expand_less_rounded
                          : Icons.expand_more_rounded,
                      color: isUsable ? accent : _BrandPalette.muted,
                    ),
                  ],
                ),
              ),
            ),
            // Dropdown — contract pricing + start button.
            AnimatedCrossFade(
              firstChild: const SizedBox(width: double.infinity),
              secondChild: Padding(
                padding: const EdgeInsets.fromLTRB(14, 0, 14, 14),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    _pricingBlock(),
                    const SizedBox(height: 12),
                    _StartChargeButton(
                      enabled: isUsable,
                      onStart: onStart,
                      status: charger.status,
                    ),
                  ],
                ),
              ),
              crossFadeState: expanded
                  ? CrossFadeState.showSecond
                  : CrossFadeState.showFirst,
              duration: const Duration(milliseconds: 180),
            ),
          ],
        ),
      ),
    );
  }

  Widget _pricingBlock() {
    if (pricingLoading) {
      return const Padding(
        padding: EdgeInsets.symmetric(vertical: 18),
        child: Center(
          child: SizedBox(
            width: 22,
            height: 22,
            child: CircularProgressIndicator(strokeWidth: 2.4, color: _csCyan),
          ),
        ),
      );
    }
    if (pricing != null) {
      return _CsPriceCard(pricing: pricing!);
    }
    // Per-charger fetch returned nothing — fall back to the installation
    // headline price if we have it.
    if (fallbackPerKwh != null) {
      return Container(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: _csDivider),
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            const Text(
              'Verð (m. VSK)',
              style: TextStyle(
                color: _csText,
                fontSize: 14,
                fontWeight: FontWeight.w700,
              ),
            ),
            Text(
              '${_krFromAurar(fallbackPerKwh! * (1 + fallbackVatPct / 100))} kr/kWh',
              style: const TextStyle(
                color: _csMint,
                fontSize: 15,
                fontWeight: FontWeight.w800,
              ),
            ),
          ],
        ),
      );
    }
    return const Padding(
      padding: EdgeInsets.symmetric(vertical: 10),
      child: Text(
        'Verð ekki tiltækt',
        style: TextStyle(
          color: _BrandPalette.muted,
          fontSize: 13,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }
}

class _StartChargeButton extends StatelessWidget {
  const _StartChargeButton({
    required this.enabled,
    required this.onStart,
    required this.status,
  });

  final bool enabled;
  final VoidCallback onStart;
  final ChargerStatus status;

  @override
  Widget build(BuildContext context) {
    if (!enabled) {
      return Container(
        height: 52,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(16),
          color: _BrandPalette.midnight.withValues(alpha: 0.4),
          border: Border.all(color: _BrandPalette.border),
        ),
        child: Text(
          'Ekki laus · ${status.label}',
          style: const TextStyle(
            color: _BrandPalette.muted,
            fontSize: 14,
            fontWeight: FontWeight.w800,
          ),
        ),
      );
    }
    return SizedBox(
      height: 52,
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: onStart,
          borderRadius: BorderRadius.circular(16),
          child: Ink(
            decoration: BoxDecoration(
              gradient: const LinearGradient(
                begin: Alignment.centerLeft,
                end: Alignment.centerRight,
                colors: [_csMint, _csBlue],
              ),
              borderRadius: BorderRadius.circular(16),
            ),
            child: const Center(
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(Icons.bolt_rounded, color: _BrandPalette.midnight, size: 20),
                  SizedBox(width: 8),
                  Text(
                    'Hefja hledslu',
                    style: TextStyle(
                      color: _BrandPalette.midnight,
                      fontSize: 16,
                      fontWeight: FontWeight.w800,
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
                    builder: (_, _) => CircularProgressIndicator(
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

// Charging-active screen. The header (logo + name + hamburger) is supplied
// by the surrounding _ChargeTab shell, so this view renders only the session
// body. The DESIGN is unchanged; only the values are now bound to the real
// session: power / energy / cost come from the parent's 5-minute
// /sessions/current poll, and the elapsed clock ticks locally from the
// session's startedAt. (The SOC ring fills by elapsed time — OCPP reports no
// battery %.) The price card stays static until a tariff surface is wired.
class _LiveChargingView extends StatefulWidget {
  const _LiveChargingView({
    required this.state,
    required this.charger,
    required this.site,
    required this.startedAt,
    required this.powerKw,
    required this.energyKwh,
    required this.costIsk,
    required this.pricing,
    required this.onStop,
  });

  final _ChargeState state;
  final Charger charger;
  final Site site;
  final DateTime? startedAt;
  final double powerKw;
  final double energyKwh;
  final double costIsk;
  final ChargerPricing? pricing;
  final VoidCallback onStop;

  @override
  State<_LiveChargingView> createState() => _LiveChargingViewState();
}

class _LiveChargingViewState extends State<_LiveChargingView> {
  Timer? _ticker;

  @override
  void initState() {
    super.initState();
    // Advance the elapsed clock every second. The polled values (power /
    // energy / cost) refresh independently via the parent every 5 minutes.
    _ticker = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) setState(() {});
    });
  }

  @override
  void dispose() {
    _ticker?.cancel();
    super.dispose();
  }

  Duration get _elapsed {
    final s = widget.startedAt;
    if (s == null) return Duration.zero;
    final d = DateTime.now().difference(s);
    return d.isNegative ? Duration.zero : d;
  }

  String _fmtTime(Duration d) {
    final h = d.inHours.toString().padLeft(2, '0');
    final m = (d.inMinutes % 60).toString().padLeft(2, '0');
    final s = (d.inSeconds % 60).toString().padLeft(2, '0');
    return '$h:$m:$s';
  }

  String _fmtPower(double kw) =>
      '${kw.toStringAsFixed(1).replaceAll('.', ',')} kW';

  String _fmtKwh(double kwh) =>
      '${kwh.toStringAsFixed(2).replaceAll('.', ',')} kWh';

  String _fmtIsk(double iskAurar) => '${_krFromAurar(iskAurar)} kr.';

  @override
  Widget build(BuildContext context) {
    if (widget.state == _ChargeState.preparing) {
      return _PreparingBlock(
        accent: widget.site.accent,
        onCancel: widget.onStop,
      );
    }
    final elapsed = _elapsed;
    final ringProgress = (elapsed.inSeconds % 3600) / 3600;
    // Only surface metrics the session actually reports — no fake zeros.
    final showPower = widget.powerKw > 0;
    final showCost = widget.costIsk > 0;
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
              Flexible(
                child: Text(
                  widget.site.name,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: _csMuted,
                    fontSize: 14,
                    fontWeight: FontWeight.w500,
                  ),
                ),
              ),
            ],
          ),
          const Spacer(flex: 2),
          // Top metrics — TÍMI always; AFL only when the session reports power.
          Row(
            children: [
              if (showPower)
                Expanded(
                  child: _CsMetric(
                    label: 'AFL',
                    icon: Icons.bolt_rounded,
                    value: _fmtPower(widget.powerKw),
                  ),
                ),
              Expanded(
                child: _CsMetric(
                  label: 'TÍMI',
                  icon: Icons.schedule_rounded,
                  value: _fmtTime(elapsed),
                ),
              ),
            ],
          ),
          const SizedBox(height: 20),
          // SOC ring
          _CsSocRing(progress: ringProgress),
          const SizedBox(height: 18),
          // Summary — energy always; cost only once the session reports one.
          Row(
            children: [
              Expanded(
                child: _CsSummary(
                  value: _fmtKwh(widget.energyKwh),
                  label: 'bætt í rafhlöðu',
                ),
              ),
              if (showCost)
                Expanded(
                  child: _CsSummary(
                    value: _fmtIsk(widget.costIsk),
                    label: 'kostnaður',
                  ),
                ),
            ],
          ),
          const Spacer(flex: 2),
          // Price card — the driver's indicative contract price, per cost
          // factor. Hidden entirely when no pricing is available.
          if (widget.pricing != null) ...[
            _CsPriceCard(pricing: widget.pricing!),
            const SizedBox(height: 16),
          ],
          // Stop button
          _CsStopButton(onStop: widget.onStop),
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

// The driver's contract price for this charger, broken down per provider —
// the actual DSO (e.g. Veitur) and electric retailer (e.g. N1), plus any
// station/access fees. Each line is a driver-paying clause. Prices are shown
// WITH VAT (the final price the driver pays). Bound to
// GET /api/driver/chargers/:id/pricing.
class _CsPriceCard extends StatelessWidget {
  const _CsPriceCard({required this.pricing});

  final ChargerPricing pricing;

  static String _unit(String basis) {
    switch (basis) {
      case 'per_minute':
        return 'kr/mín';
      case 'per_session':
        return 'kr/skipti';
      case 'per_day':
        return 'kr/dag';
      default:
        return 'kr/kWh';
    }
  }

  // VAT-inclusive aurar for a clause (price the driver actually pays).
  static double _incVat(double exVatAurar, double vatPct) =>
      exVatAurar * (1 + vatPct / 100);

  @override
  Widget build(BuildContext context) {
    // Totals, VAT-inclusive, summed per basis from the driver-paying clauses.
    var perKwhInc = 0.0;
    var perMinInc = 0.0;
    var perSessInc = 0.0;
    for (final c in pricing.clauses) {
      final inc = _incVat(c.unitPrice, c.vatRatePct);
      switch (c.basis) {
        case 'per_minute':
          perMinInc += inc;
          break;
        case 'per_session':
          perSessInc += inc;
          break;
        case 'per_kwh':
          perKwhInc += inc;
          break;
      }
    }
    return Container(
      padding: const EdgeInsets.fromLTRB(18, 14, 18, 14),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: _csDivider),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: [
          // Header
          Row(
            children: [
              Container(
                width: 36,
                height: 36,
                decoration: BoxDecoration(
                  color: _csMint.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(11),
                ),
                child: const Icon(Icons.sell_rounded, color: _csMint, size: 19),
              ),
              const SizedBox(width: 12),
              const Expanded(
                child: Text(
                  'Verð',
                  style: TextStyle(
                    color: _csText,
                    fontSize: 15,
                    fontWeight: FontWeight.w700,
                    letterSpacing: -0.3,
                  ),
                ),
              ),
            ],
          ),
          const Padding(
            padding: EdgeInsets.symmetric(vertical: 10),
            child: Divider(height: 1, thickness: 1, color: _csDivider),
          ),
          // Per-provider clause lines — DSO / retailer / fees (VAT-inclusive).
          for (final c in pricing.clauses)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 3),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Flexible(
                    child: Text(
                      c.displayLabel,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: _csMuted,
                        fontSize: 13.5,
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Text(
                    '${_krFromAurar(_incVat(c.unitPrice, c.vatRatePct))} ${_unit(c.basis)}',
                    style: const TextStyle(
                      color: _csText,
                      fontSize: 14,
                      fontWeight: FontWeight.w600,
                      fontFeatures: [FontFeature.tabularFigures()],
                    ),
                  ),
                ],
              ),
            ),
          const Padding(
            padding: EdgeInsets.symmetric(vertical: 10),
            child: Divider(height: 1, thickness: 1, color: _csDivider),
          ),
          // Total (per-kWh, VAT-inclusive) + "VAT included" note.
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            crossAxisAlignment: CrossAxisAlignment.baseline,
            textBaseline: TextBaseline.alphabetic,
            children: [
              const Text(
                'Samtals',
                style: TextStyle(
                  color: _csText,
                  fontSize: 15,
                  fontWeight: FontWeight.w700,
                ),
              ),
              Text(
                '${_krFromAurar(perKwhInc)} kr/kWh',
                style: const TextStyle(
                  color: _csMint,
                  fontSize: 20,
                  fontWeight: FontWeight.w800,
                  letterSpacing: -0.5,
                  fontFeatures: [FontFeature.tabularFigures()],
                ),
              ),
            ],
          ),
          if (perMinInc > 0 || perSessInc > 0)
            Padding(
              padding: const EdgeInsets.only(top: 3),
              child: Align(
                alignment: Alignment.centerRight,
                child: Text(
                  [
                    if (perMinInc > 0) '${_krFromAurar(perMinInc)} kr/mín',
                    if (perSessInc > 0) '${_krFromAurar(perSessInc)} kr/skipti',
                  ].join(' · '),
                  style: const TextStyle(
                    color: _csMuted,
                    fontSize: 12.5,
                    fontWeight: FontWeight.w500,
                  ),
                ),
              ),
            ),
          const Padding(
            padding: EdgeInsets.only(top: 4),
            child: Text(
              'VSK innifalin',
              style: TextStyle(
                color: _csMuted,
                fontSize: 12.5,
                fontWeight: FontWeight.w500,
              ),
            ),
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
// Support tab (reused inside Stillingar -> Adstod)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Yfirlit (Dashboard)
// ---------------------------------------------------------------------------

class _DashboardTab extends StatelessWidget {
  const _DashboardTab({
    required this.driverEmail,
    required this.sites,
    required this.phoneTapEnabled,
    required this.loading,
    required this.onStartCharging,
    required this.onMenu,
  });

  final String driverEmail;
  final List<Site> sites;
  final bool phoneTapEnabled;
  final bool loading;
  final VoidCallback onStartCharging;
  final VoidCallback onMenu;

  int get _chargerCount =>
      sites.fold<int>(0, (a, s) => a + s.chargers.length);

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        _AppHeader(title: _firstName(driverEmail), onMenu: onMenu),
        Expanded(
          child: ListView(
            padding: const EdgeInsets.fromLTRB(20, 8, 20, 28),
            children: [
              const SizedBox(height: 4),
              Text(
                'Hae, ${_firstName(driverEmail)}',
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 26,
                  fontWeight: FontWeight.w900,
                  letterSpacing: -0.5,
                ),
              ),
              const SizedBox(height: 4),
              const Text(
                'Tilbuin ad hlada?',
                style: TextStyle(color: _BrandPalette.muted, fontSize: 14),
              ),
              const SizedBox(height: 18),
              _DashboardAccessCard(
                loading: loading,
                chargerCount: _chargerCount,
                siteCount: sites.length,
              ),
              const SizedBox(height: 12),
              if (phoneTapEnabled) ...[
                const _DashboardStatusChip(),
                const SizedBox(height: 12),
              ],
              _DashboardCtaButton(onTap: onStartCharging),
            ],
          ),
        ),
      ],
    );
  }
}

class _DashboardAccessCard extends StatelessWidget {
  const _DashboardAccessCard({
    required this.loading,
    required this.chargerCount,
    required this.siteCount,
  });

  final bool loading;
  final int chargerCount;
  final int siteCount;

  @override
  Widget build(BuildContext context) {
    return Container(
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
            width: 54,
            height: 54,
            decoration: BoxDecoration(
              color: _BrandPalette.cyan.withValues(alpha: 0.15),
              borderRadius: BorderRadius.circular(16),
            ),
            child: const Icon(
              Icons.ev_station_rounded,
              color: _BrandPalette.cyan,
              size: 28,
            ),
          ),
          const SizedBox(width: 16),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (loading)
                  const Text(
                    'Sae...',
                    style: TextStyle(
                      color: Colors.white,
                      fontSize: 22,
                      fontWeight: FontWeight.w900,
                    ),
                  )
                else
                  Text(
                    '$chargerCount',
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 30,
                      fontWeight: FontWeight.w900,
                      letterSpacing: -0.6,
                    ),
                  ),
                const SizedBox(height: 2),
                Text(
                  loading
                      ? 'Sae hledslustodvar'
                      : 'hledslustodvar i thinum adgangi'
                          '${siteCount > 0 ? ' - $siteCount stadir' : ''}',
                  style: const TextStyle(
                    color: _BrandPalette.muted,
                    fontSize: 12.5,
                    fontWeight: FontWeight.w700,
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

class _DashboardStatusChip extends StatelessWidget {
  const _DashboardStatusChip();

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(
        color: _BrandPalette.surface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: _BrandPalette.mint.withValues(alpha: 0.45)),
      ),
      child: Row(
        children: [
          Container(
            width: 8,
            height: 8,
            decoration: const BoxDecoration(
              color: _BrandPalette.mint,
              shape: BoxShape.circle,
            ),
          ),
          const SizedBox(width: 10),
          const Expanded(
            child: Text(
              'Snertilaust virkt - berdu simann ad merki stodvarinnar.',
              style: TextStyle(
                color: _BrandPalette.muted,
                fontSize: 12.5,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _DashboardCtaButton extends StatelessWidget {
  const _DashboardCtaButton({required this.onTap});

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 60,
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(20),
          child: Ink(
            decoration: BoxDecoration(
              gradient: const LinearGradient(
                begin: Alignment.centerLeft,
                end: Alignment.centerRight,
                colors: [_BrandPalette.mint, _BrandPalette.blue],
              ),
              borderRadius: BorderRadius.circular(20),
            ),
            child: const Center(
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(Icons.bolt_rounded, color: _BrandPalette.midnight),
                  SizedBox(width: 10),
                  Text(
                    'Hefja hledslu',
                    style: TextStyle(
                      color: _BrandPalette.midnight,
                      fontSize: 17,
                      fontWeight: FontWeight.w900,
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
// Saga (History) + Kostnadur (Cost) — clean empty states (no history/cost API)
// ---------------------------------------------------------------------------

class _EmptyState extends StatelessWidget {
  const _EmptyState({
    required this.icon,
    required this.title,
    required this.subtitle,
  });

  final IconData icon;
  final String title;
  final String subtitle;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 40),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 76,
              height: 76,
              decoration: BoxDecoration(
                color: _BrandPalette.surface,
                shape: BoxShape.circle,
                border: Border.all(color: _BrandPalette.border),
              ),
              child: Icon(icon, color: _BrandPalette.muted, size: 34),
            ),
            const SizedBox(height: 18),
            Text(
              title,
              textAlign: TextAlign.center,
              style: const TextStyle(
                color: Colors.white,
                fontSize: 18,
                fontWeight: FontWeight.w900,
                letterSpacing: -0.2,
              ),
            ),
            const SizedBox(height: 6),
            Text(
              subtitle,
              textAlign: TextAlign.center,
              style: const TextStyle(
                color: _BrandPalette.muted,
                fontSize: 13.5,
                fontWeight: FontWeight.w600,
                height: 1.4,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _HistoryTab extends StatelessWidget {
  const _HistoryTab({required this.onMenu});

  final VoidCallback onMenu;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        _AppHeader(title: 'Saga', onMenu: onMenu),
        const Expanded(
          child: _EmptyState(
            icon: Icons.history_rounded,
            title: 'Engin hledslusaga enn.',
            subtitle:
                'Hledslurnar thinar birtast her um leid og thu klarar fyrstu lotuna.',
          ),
        ),
      ],
    );
  }
}

class _CostTab extends StatelessWidget {
  const _CostTab({required this.onMenu});

  final VoidCallback onMenu;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        _AppHeader(title: 'Kostnadur', onMenu: onMenu),
        const Expanded(
          child: _EmptyState(
            icon: Icons.receipt_long_rounded,
            title: 'Enginn kostnadur skradur enn.',
            subtitle:
                'Kostnadur og reikningar birtast her thegar hledslur eru gjaldfaerdar.',
          ),
        ),
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// Stillingar (Settings) — grouped, scrollable, functional rows + placeholders
// ---------------------------------------------------------------------------

class _SettingsTab extends StatefulWidget {
  const _SettingsTab({
    required this.email,
    required this.sites,
    required this.phoneTapEnabled,
    required this.onPhoneTapToggled,
    required this.onLogout,
    required this.onMenu,
  });

  final String email;
  final List<Site> sites;
  final bool phoneTapEnabled;
  final ValueChanged<bool> onPhoneTapToggled;
  final VoidCallback onLogout;
  final VoidCallback onMenu;

  @override
  State<_SettingsTab> createState() => _SettingsTabState();
}

class _SettingsTabState extends State<_SettingsTab> {
  // Local-only language selection. Does not re-localize the app yet — it
  // just records the driver's choice for when localization lands.
  String _language = 'IS';

  void _openPlaceholder(String title) {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => _PlaceholderDetailScreen(title: title),
      ),
    );
  }

  void _openMyAccess() {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => _MyAccessScreen(sites: widget.sites),
      ),
    );
  }

  void _openSupport() {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => Scaffold(
          backgroundColor: _BrandPalette.midnight,
          body: SafeArea(
            child: Column(
              children: [
                _DetailHeader(title: 'Adstod'),
                const Expanded(child: _SupportTab()),
              ],
            ),
          ),
        ),
      ),
    );
  }

  void _pickLanguage() async {
    final picked = await showModalBottomSheet<String>(
      context: context,
      backgroundColor: _BrandPalette.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (_) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const SizedBox(height: 14),
            const Text(
              'Tungumal',
              style: TextStyle(
                color: Colors.white,
                fontSize: 16,
                fontWeight: FontWeight.w900,
              ),
            ),
            const SizedBox(height: 8),
            for (final lang in const [
              ('IS', 'Islenska'),
              ('EN', 'English'),
            ])
              ListTile(
                title: Text(
                  lang.$2,
                  style: const TextStyle(
                    color: Colors.white,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                trailing: _language == lang.$1
                    ? const Icon(Icons.check_rounded, color: _BrandPalette.mint)
                    : null,
                onTap: () => Navigator.of(context).pop(lang.$1),
              ),
            const SizedBox(height: 10),
          ],
        ),
      ),
    );
    if (picked != null && mounted) setState(() => _language = picked);
  }

  String get _languageLabel => _language == 'EN' ? 'English' : 'Islenska';

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        _AppHeader(title: 'Stillingar', onMenu: widget.onMenu),
        Expanded(
          child: ListView(
            padding: const EdgeInsets.fromLTRB(20, 4, 20, 32),
            children: [
              _SettingsAccountCard(email: widget.email),
              const SizedBox(height: 18),
              const _SettingsSectionHeader('Adgangur & audkenni'),
              _SettingsNavRow(
                icon: Icons.ev_station_rounded,
                title: 'Minir adgangar',
                onTap: _openMyAccess,
              ),
              _SettingsNavRow(
                icon: Icons.mark_email_unread_rounded,
                title: 'Bodslykill',
                onTap: () => _openPlaceholder('Bodslykill'),
              ),
              _SettingsNavRow(
                icon: Icons.nfc_rounded,
                title: 'RFID',
                onTap: () => _openPlaceholder('RFID'),
              ),
              _SettingsNavRow(
                icon: Icons.family_restroom_rounded,
                title: 'Fjolskylda',
                onTap: () => _openPlaceholder('Fjolskylda'),
              ),
              const SizedBox(height: 18),
              const _SettingsSectionHeader('Greidslur'),
              _SettingsNavRow(
                icon: Icons.credit_card_rounded,
                title: 'Greidsluskilmalar',
                onTap: () => _openPlaceholder('Greidsluskilmalar'),
              ),
              const SizedBox(height: 18),
              const _SettingsSectionHeader('Appid'),
              _SettingsNavRow(
                icon: Icons.translate_rounded,
                title: 'Tungumal',
                trailing: _languageLabel,
                onTap: _pickLanguage,
              ),
              const SizedBox(height: 8),
              _SettingsToggle(
                icon: Icons.nfc_rounded,
                title: 'Snertilaust (NFC)',
                subtitle:
                    'Haltu simanum (<5cm) ad merki stodvarinnar til ad hefja hledslu.',
                value: widget.phoneTapEnabled,
                onChanged: widget.onPhoneTapToggled,
              ),
              const SizedBox(height: 18),
              const _SettingsSectionHeader('Annad'),
              _SettingsNavRow(
                icon: Icons.support_agent_rounded,
                title: 'Adstod',
                onTap: _openSupport,
              ),
              _SettingsNavRow(
                icon: Icons.logout_rounded,
                title: 'Utskra',
                danger: true,
                onTap: widget.onLogout,
              ),
              const SizedBox(height: 18),
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
      ],
    );
  }
}

class _SettingsAccountCard extends StatelessWidget {
  const _SettingsAccountCard({required this.email});

  final String email;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(18),
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
            width: 56,
            height: 56,
            decoration: BoxDecoration(
              color: _BrandPalette.cyan.withValues(alpha: 0.15),
              borderRadius: BorderRadius.circular(18),
            ),
            child: const Icon(
              Icons.person_rounded,
              color: _BrandPalette.cyan,
              size: 30,
            ),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  _firstName(email),
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 18,
                    fontWeight: FontWeight.w900,
                    letterSpacing: -0.3,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  email,
                  overflow: TextOverflow.ellipsis,
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
    );
  }
}

class _SettingsSectionHeader extends StatelessWidget {
  const _SettingsSectionHeader(this.label);

  final String label;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(4, 0, 4, 8),
      child: Text(
        label.toUpperCase(),
        style: const TextStyle(
          color: _BrandPalette.muted,
          fontSize: 11.5,
          fontWeight: FontWeight.w900,
          letterSpacing: 1.2,
        ),
      ),
    );
  }
}

class _SettingsNavRow extends StatelessWidget {
  const _SettingsNavRow({
    required this.icon,
    required this.title,
    required this.onTap,
    this.trailing,
    this.danger = false,
  });

  final IconData icon;
  final String title;
  final VoidCallback onTap;
  final String? trailing;
  final bool danger;

  @override
  Widget build(BuildContext context) {
    final accent = danger ? _BrandPalette.danger : _BrandPalette.cyan;
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(18),
          child: Ink(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: _BrandPalette.surface,
              borderRadius: BorderRadius.circular(18),
              border: Border.all(color: _BrandPalette.border),
            ),
            child: Row(
              children: [
                Icon(icon, color: accent, size: 22),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(
                    title,
                    style: TextStyle(
                      color: danger ? _BrandPalette.danger : Colors.white,
                      fontSize: 14,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                ),
                if (trailing != null) ...[
                  Text(
                    trailing!,
                    style: const TextStyle(
                      color: _BrandPalette.muted,
                      fontSize: 12,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  const SizedBox(width: 4),
                ],
                Icon(
                  Icons.chevron_right_rounded,
                  color: danger
                      ? _BrandPalette.danger.withValues(alpha: 0.7)
                      : _BrandPalette.muted,
                  size: 20,
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
// Detail screens reached from Stillingar
// ---------------------------------------------------------------------------

class _DetailHeader extends StatelessWidget {
  const _DetailHeader({required this.title});

  final String title;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(8, 14, 12, 8),
      child: Row(
        children: [
          IconButton(
            onPressed: () => Navigator.of(context).pop(),
            icon: const Icon(Icons.arrow_back_rounded, color: Colors.white),
          ),
          const SizedBox(width: 6),
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
        ],
      ),
    );
  }
}

class _PlaceholderDetailScreen extends StatelessWidget {
  const _PlaceholderDetailScreen({required this.title});

  final String title;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: _BrandPalette.midnight,
      body: SafeArea(
        child: Column(
          children: [
            _DetailHeader(title: title),
            Expanded(
              child: Center(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      title,
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 18,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    const SizedBox(height: 8),
                    const Text(
                      'Vaentanlegt',
                      style: TextStyle(
                        color: _BrandPalette.muted,
                        fontSize: 14,
                        fontWeight: FontWeight.w700,
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

class _MyAccessScreen extends StatelessWidget {
  const _MyAccessScreen({required this.sites});

  final List<Site> sites;

  @override
  Widget build(BuildContext context) {
    final chargers = [
      for (final s in sites)
        for (final c in s.chargers) (s, c),
    ];
    return Scaffold(
      backgroundColor: _BrandPalette.midnight,
      body: SafeArea(
        child: Column(
          children: [
            _DetailHeader(title: 'Minir adgangar'),
            Expanded(
              child: chargers.isEmpty
                  ? const _EmptyState(
                      icon: Icons.ev_station_rounded,
                      title: 'Engar hledslustodvar i thinum adgangi enn.',
                      subtitle:
                          'Eigandi stodvar tharf ad veita ther adgang adur en hun birtist her.',
                    )
                  : ListView.separated(
                      padding: const EdgeInsets.fromLTRB(20, 8, 20, 28),
                      itemCount: chargers.length,
                      separatorBuilder: (_, _) => const SizedBox(height: 8),
                      itemBuilder: (_, i) {
                        final site = chargers[i].$1;
                        final charger = chargers[i].$2;
                        return Container(
                          padding: const EdgeInsets.all(14),
                          decoration: BoxDecoration(
                            color: _BrandPalette.surface,
                            borderRadius: BorderRadius.circular(18),
                            border: Border.all(color: _BrandPalette.border),
                          ),
                          child: Row(
                            children: [
                              Container(
                                width: 42,
                                height: 42,
                                decoration: BoxDecoration(
                                  color: site.accent.withValues(alpha: 0.13),
                                  borderRadius: BorderRadius.circular(13),
                                ),
                                child: Icon(
                                  Icons.ev_station_rounded,
                                  color: site.accent,
                                  size: 22,
                                ),
                              ),
                              const SizedBox(width: 12),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment:
                                      CrossAxisAlignment.start,
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
                                    const SizedBox(height: 2),
                                    Text(
                                      site.name,
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
                              _StatusPill(status: charger.status),
                            ],
                          ),
                        );
                      },
                    ),
            ),
          ],
        ),
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
