import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_blue_plus/flutter_blue_plus.dart';
import 'package:nfc_manager/nfc_manager.dart';
import 'package:permission_handler/permission_handler.dart';

import 'api.dart';
import 'config.dart';

void main() {
  runApp(const StraumvaktMockApp());
}

class _BrandPalette {
  static const midnight = Color(0xFF010B13);
  static const deepNavy = Color(0xFF061522);
  static const surface = Color(0xFF0A2130);
  static const border = Color(0xFF1E5B70);
  static const mint = Color(0xFF69F2A6);
  static const cyan = Color(0xFF25C9C9);
  static const blue = Color(0xFF2098E4);
  static const muted = Color(0xFFA7BBC8);
}

class _AppTruth {
  static const driverName = 'N1 Drivers';
  static const driverEmail = 'n1@n1.is';
  static const sourceAudience = 'operator';
  static const appAudience = 'driver';
  static const primaryCharger = 'ZPR074002';
  static const primaryPlate = 'N1 742';
  static const primaryIdTag = 'EE43C609263CC7';
  static const installationName = 'Dalvegur 10 - 14';
  static const bleServiceUuid = '9f0c8b50-2c5f-4a8a-8c4f-0f5d8f5a7420';
  static const phoneTapCredentialRef = 'SV-MOBILE-N1-DRIVER';
  static const phoneTapIdTag = primaryIdTag;
}

class _DriverInstallation {
  const _DriverInstallation({
    required this.id,
    required this.name,
    required this.chargers,
  });

  final String id;
  final String name;
  final List<_DriverCharger> chargers;
}

class _DriverCharger {
  const _DriverCharger({
    required this.serial,
    required this.connectorId,
    required this.locationName,
    required this.status,
    required this.priceLabel,
    required this.estimatedSessionCost,
  });

  final String serial;
  final String connectorId;
  final String locationName;
  final String status;
  final String priceLabel;
  final String estimatedSessionCost;
}

class _ActiveSession {
  const _ActiveSession({
    required this.sessionId,
    required this.charger,
    required this.startedAtLabel,
    required this.powerKw,
    required this.energyKwh,
    required this.costIsk,
  });

  final String sessionId;
  final _DriverCharger charger;
  final String startedAtLabel;
  final double powerKw;
  final double energyKwh;
  final int costIsk;
}

const _seedInstallations = [
  _DriverInstallation(
    id: 'inst-dalvegur',
    name: _AppTruth.installationName,
    chargers: [
      _DriverCharger(
        serial: _AppTruth.primaryCharger,
        connectorId: 'connector-zpr074002-a',
        locationName: _AppTruth.installationName,
        status: 'Available',
        priceLabel: '39 kr/kWh + 12 kr/min after 90 min',
        estimatedSessionCost: '312 kr. estimate',
      ),
    ],
  ),
  _DriverInstallation(
    id: 'inst-n1-pilot',
    name: 'N1 pilot access',
    chargers: [
      _DriverCharger(
        serial: 'N1 742',
        connectorId: 'connector-n1-742-a',
        locationName: 'N1 pilot access',
        status: 'Available',
        priceLabel: 'Included pilot tariff',
        estimatedSessionCost: '0 kr. pilot',
      ),
    ],
  ),
];

class _BleTapResult {
  const _BleTapResult({
    required this.charger,
    required this.connectorId,
    required this.readerId,
    required this.rssi,
    required this.source,
    required this.idTag,
  });

  final String charger;
  final String connectorId;
  final String readerId;
  final int rssi;
  final String source;
  final String idTag;
}

class _BleTapService {
  static const _scanDuration = Duration(seconds: 5);

  Future<_BleTapResult?> scanForCharger() async {
    if (kIsWeb) {
      await Future<void>.delayed(const Duration(milliseconds: 900));
      return simulatedResult;
    }

    final supported = await FlutterBluePlus.isSupported;
    if (!supported) {
      throw const _BleTapFailure(
        'Bluetooth LE is not supported on this device.',
      );
    }

    await _requestPermissions();

    final adapterState = await FlutterBluePlus.adapterState.first;
    if (adapterState != BluetoothAdapterState.on) {
      throw const _BleTapFailure('Turn on Bluetooth to tap this charger.');
    }

    _BleTapResult? match;
    ScanResult? strongest;
    final subscription = FlutterBluePlus.scanResults.listen((results) {
      for (final result in results) {
        if (strongest == null || result.rssi > strongest!.rssi) {
          strongest = result;
        }
        match ??= _matchAdvertisement(result);
      }
    });

    try {
      await FlutterBluePlus.startScan(timeout: _scanDuration);
      await Future<void>.delayed(_scanDuration);
    } finally {
      await FlutterBluePlus.stopScan();
      await subscription.cancel();
    }

    return match ?? _fieldTestCandidate(strongest);
  }

  Future<void> _requestPermissions() async {
    final platform = defaultTargetPlatform;
    final permissions = <Permission>[];

    if (platform == TargetPlatform.android) {
      permissions.addAll([
        Permission.bluetoothScan,
        Permission.bluetoothConnect,
      ]);
    } else if (platform == TargetPlatform.iOS) {
      permissions.add(Permission.bluetooth);
    }

    if (permissions.isEmpty) return;

    final statuses = await permissions.request();
    final denied = statuses.values.any(
      (status) => status.isDenied || status.isPermanentlyDenied,
    );
    if (denied) {
      throw const _BleTapFailure(
        'Bluetooth permission is needed for phone tap.',
      );
    }
  }

  _BleTapResult? _matchAdvertisement(ScanResult result) {
    final advertisement = result.advertisementData;
    final name = advertisement.advName.isNotEmpty
        ? advertisement.advName
        : result.device.platformName;
    final hasService = advertisement.serviceUuids.any(
      (uuid) => uuid.str.toLowerCase() == _AppTruth.bleServiceUuid,
    );
    final looksLikeStraumvakt =
        name.toLowerCase().contains('straumvakt') ||
        name.toLowerCase().startsWith('sv-') ||
        hasService;

    if (!looksLikeStraumvakt) return null;

    return _BleTapResult(
      charger: _chargerFromName(name),
      connectorId: _connectorFromName(name),
      readerId: result.device.remoteId.str,
      rssi: result.rssi,
      source: name.isEmpty ? 'BLE service UUID' : name,
      idTag: _AppTruth.phoneTapIdTag,
    );
  }

  _BleTapResult? _fieldTestCandidate(ScanResult? result) {
    if (result == null || result.rssi < -90) return null;
    final advertisement = result.advertisementData;
    final name = advertisement.advName.isNotEmpty
        ? advertisement.advName
        : result.device.platformName;
    final source = name.isEmpty ? 'Nearby BLE reader' : name;

    return _BleTapResult(
      charger: _AppTruth.primaryCharger,
      connectorId: 'connector-zpr074002-a',
      readerId: result.device.remoteId.str,
      rssi: result.rssi,
      source: '$source (field test)',
      idTag: _AppTruth.phoneTapIdTag,
    );
  }

  String _chargerFromName(String name) {
    if (name.contains('ZPR074002')) return _AppTruth.primaryCharger;
    if (name.contains('IS-306')) return 'Ãsorka 306';
    if (name.contains('HOME')) return 'HeimahleÃ°slutÃ¦ki';
    return _AppTruth.primaryCharger;
  }

  String _connectorFromName(String name) {
    if (name.contains('ZPR074002')) return 'connector-zpr074002-a';
    if (name.contains('IS-306')) return 'connector-is-306-a';
    if (name.contains('HOME')) return 'connector-home-a';
    return 'connector-zpr074002-a';
  }

  static _BleTapResult get simulatedResult => const _BleTapResult(
    charger: _AppTruth.primaryCharger,
    connectorId: 'connector-zpr074002-a',
    readerId: 'SV-BLE-ZPR074002',
    rssi: -47,
    source: 'Straumvakt ZPR074002',
    idTag: _AppTruth.phoneTapIdTag,
  );
}

class _BleTapFailure implements Exception {
  const _BleTapFailure(this.message);

  final String message;

  @override
  String toString() => message;
}

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
          errorBuilder: (context, error, stackTrace) {
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

class _LogoWordmark extends StatelessWidget {
  const _LogoWordmark();

  @override
  Widget build(BuildContext context) {
    return Image.asset(
      'assets/images/straumvakt_logo_full.png',
      fit: BoxFit.contain,
      filterQuality: FilterQuality.high,
      errorBuilder: (context, error, stackTrace) {
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

class StraumvaktMockApp extends StatefulWidget {
  const StraumvaktMockApp({super.key});

  @override
  State<StraumvaktMockApp> createState() => _StraumvaktMockAppState();
}

class _StraumvaktMockAppState extends State<StraumvaktMockApp> {
  final _api = StraumvaktApi();
  final _tokenStore = TokenStore();
  String? _accessToken;
  String? _driverEmail;
  bool _previewBypass = false;
  bool _bootstrapping = true;

  bool get _isLoggedIn => _accessToken != null || _previewBypass;

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
          _driverEmail = email;
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
      _previewBypass = false;
    });
  }

  Future<void> _onLogout() async {
    await _tokenStore.clear();
    if (!mounted) return;
    setState(() {
      _accessToken = null;
      _driverEmail = null;
      _previewBypass = false;
    });
  }

  void _onAuthExpired() {
    unawaited(_onLogout());
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Session expired. Please log in again.'),
          backgroundColor: _BrandPalette.surface,
        ),
      );
    }
  }

  void _onPreviewToggle() {
    if (_accessToken != null) {
      unawaited(_onLogout());
    } else {
      setState(() => _previewBypass = !_previewBypass);
    }
  }

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
      home: _bootstrapping
          ? const Scaffold(
              backgroundColor: _BrandPalette.midnight,
              body: Center(
                child: CircularProgressIndicator(color: _BrandPalette.cyan),
              ),
            )
          : _AdaptiveAppShell(
              isLoggedIn: _isLoggedIn,
              accessToken: _accessToken,
              driverEmail: _driverEmail,
              api: _api,
              onAuthenticated: _onAuthenticated,
              onAuthExpired: _onAuthExpired,
              onLogin: _onPreviewToggle,
              onLogout: _onLogout,
            ),
    );
  }
}

class _AdaptiveAppShell extends StatelessWidget {
  const _AdaptiveAppShell({
    required this.isLoggedIn,
    required this.accessToken,
    required this.driverEmail,
    required this.api,
    required this.onAuthenticated,
    required this.onAuthExpired,
    required this.onLogin,
    required this.onLogout,
  });

  final bool isLoggedIn;
  final String? accessToken;
  final String? driverEmail;
  final StraumvaktApi api;
  final ValueChanged<LoginResult> onAuthenticated;
  final VoidCallback onAuthExpired;
  final VoidCallback onLogin;
  final VoidCallback onLogout;

  @override
  Widget build(BuildContext context) {
    final app = isLoggedIn
        ? ChargingHomeScreen(
            onLogout: onLogout,
            api: api,
            accessToken: accessToken,
            driverEmail: driverEmail,
            onAuthExpired: onAuthExpired,
          )
        : LoginScreen(api: api, onAuthenticated: onAuthenticated);

    return LayoutBuilder(
      builder: (context, constraints) {
        if (constraints.maxWidth >= 920) {
          return _StagingShowcaseShell(
            appPreview: app,
            isLoggedIn: isLoggedIn,
            onLogin: onLogin,
            onLogout: onLogout,
          );
        }

        return app;
      },
    );
  }
}

class _StagingShowcaseShell extends StatelessWidget {
  const _StagingShowcaseShell({
    required this.appPreview,
    required this.isLoggedIn,
    required this.onLogin,
    required this.onLogout,
  });

  final Widget appPreview;
  final bool isLoggedIn;
  final VoidCallback onLogin;
  final VoidCallback onLogout;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF07111E),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.symmetric(horizontal: 44, vertical: 28),
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 1180),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  _ShowcaseTopBar(
                    isLoggedIn: isLoggedIn,
                    onLogin: onLogin,
                    onLogout: onLogout,
                  ),
                  const SizedBox(height: 28),
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Expanded(flex: 5, child: _ShowcaseOverview()),
                      const SizedBox(width: 34),
                      Expanded(
                        flex: 4,
                        child: Align(
                          alignment: Alignment.topCenter,
                          child: _PhonePreviewFrame(child: appPreview),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 28),
                  const _ShowcaseFeatureGrid(),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _ShowcaseTopBar extends StatelessWidget {
  const _ShowcaseTopBar({
    required this.isLoggedIn,
    required this.onLogin,
    required this.onLogout,
  });

  final bool isLoggedIn;
  final VoidCallback onLogin;
  final VoidCallback onLogout;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Container(
          width: 42,
          height: 42,
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(12),
            gradient: const LinearGradient(
              colors: [Color(0xFF68F2A6), Color(0xFF1D9BF0)],
            ),
          ),
          child: const Icon(Icons.bolt_rounded, color: Color(0xFF06111F)),
        ),
        const SizedBox(width: 12),
        const Expanded(
          child: Text(
            'Straumvakt staging',
            style: TextStyle(
              color: Colors.white,
              fontSize: 22,
              fontWeight: FontWeight.w900,
            ),
          ),
        ),
        FilledButton.icon(
          onPressed: isLoggedIn ? onLogout : onLogin,
          style: FilledButton.styleFrom(
            backgroundColor: const Color(0xFF22D3D7),
            foregroundColor: const Color(0xFF06111F),
            padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 14),
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(14),
            ),
          ),
          icon: Icon(isLoggedIn ? Icons.logout_rounded : Icons.login_rounded),
          label: Text(
            isLoggedIn ? 'Preview logout' : 'Preview login',
            style: const TextStyle(fontWeight: FontWeight.w900),
          ),
        ),
      ],
    );
  }
}

class _ShowcaseOverview extends StatelessWidget {
  const _ShowcaseOverview();

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text(
          'EV charging control for operators and drivers',
          style: TextStyle(
            color: Colors.white,
            fontSize: 48,
            height: 1.02,
            fontWeight: FontWeight.w900,
          ),
        ),
        const SizedBox(height: 18),
        const Text(
          'A staging-ready web format that presents the real mobile flow in context: charger selection, pre-charge checks, active charging status, session history, account access, and branded charger visuals.',
          style: TextStyle(
            color: Color(0xFFB8D2DE),
            fontSize: 17,
            height: 1.5,
            fontWeight: FontWeight.w500,
          ),
        ),
        const SizedBox(height: 24),
        Wrap(
          spacing: 12,
          runSpacing: 12,
          children: const [
            _ShowcasePill(icon: Icons.ev_station_rounded, label: 'Live app'),
            _ShowcasePill(icon: Icons.security_rounded, label: 'Access checks'),
            _ShowcasePill(
              icon: Icons.history_rounded,
              label: 'Session history',
            ),
          ],
        ),
        const SizedBox(height: 28),
        const _ShowcaseStatusPanel(),
      ],
    );
  }
}

class _ShowcasePill extends StatelessWidget {
  const _ShowcasePill({required this.icon, required this.label});

  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 11),
      decoration: BoxDecoration(
        color: const Color(0xFF0B1F34),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: const Color(0xFF24536A)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, color: const Color(0xFF75EAF2), size: 18),
          const SizedBox(width: 8),
          Text(
            label,
            style: const TextStyle(
              color: Color(0xFFEAF8FB),
              fontWeight: FontWeight.w800,
            ),
          ),
        ],
      ),
    );
  }
}

class _ShowcaseStatusPanel extends StatelessWidget {
  const _ShowcaseStatusPanel();

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: const Color(0xFF0B1F34),
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: const Color(0xFF24536A)),
      ),
      child: const Row(
        children: [
          Expanded(
            child: _ShowcaseStat(label: 'Prototype', value: 'Mobile'),
          ),
          _ShowcaseDivider(),
          Expanded(
            child: _ShowcaseStat(label: 'SOC demo', value: '68%'),
          ),
          _ShowcaseDivider(),
          Expanded(
            child: _ShowcaseStat(label: 'Output', value: '7.4 kW'),
          ),
        ],
      ),
    );
  }
}

class _ShowcaseStat extends StatelessWidget {
  const _ShowcaseStat({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: const TextStyle(color: Color(0xFF8EA6B6), fontSize: 12),
        ),
        const SizedBox(height: 6),
        Text(
          value,
          style: const TextStyle(
            color: Colors.white,
            fontSize: 22,
            fontWeight: FontWeight.w900,
          ),
        ),
      ],
    );
  }
}

class _ShowcaseDivider extends StatelessWidget {
  const _ShowcaseDivider();

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 1,
      height: 48,
      margin: const EdgeInsets.symmetric(horizontal: 18),
      color: const Color(0xFF24536A),
    );
  }
}

class _PhonePreviewFrame extends StatelessWidget {
  const _PhonePreviewFrame({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 390,
      height: 820,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: const Color(0xFF030812),
        borderRadius: BorderRadius.circular(38),
        border: Border.all(color: const Color(0xFF274760), width: 1.4),
        boxShadow: const [
          BoxShadow(
            color: Color(0x66000000),
            blurRadius: 38,
            offset: Offset(0, 24),
          ),
        ],
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(28),
        child: MediaQuery(
          data: const MediaQueryData(
            size: Size(366, 796),
            padding: EdgeInsets.only(top: 18),
            viewPadding: EdgeInsets.only(top: 18),
            devicePixelRatio: 2,
          ),
          child: child,
        ),
      ),
    );
  }
}

class _ShowcaseFeatureGrid extends StatelessWidget {
  const _ShowcaseFeatureGrid();

  static const features = [
    (
      Icons.touch_app_rounded,
      'Start flow',
      'Select a charger, start pre-flight validation, then continue into the charging state.',
    ),
    (
      Icons.electric_bolt_rounded,
      'Charging state',
      'Show output, battery state, and progress with the same controls used in the app preview.',
    ),
    (
      Icons.credit_card_rounded,
      'Driver account',
      'Profile and sign-in surfaces are included so staging can demo account access.',
    ),
    (
      Icons.branding_watermark_rounded,
      'Operator branding',
      'The charger carousel showcases Straumvakt, ON, and Isorka visual treatments.',
    ),
  ];

  @override
  Widget build(BuildContext context) {
    return GridView.builder(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      itemCount: features.length,
      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: 4,
        mainAxisExtent: 172,
        crossAxisSpacing: 14,
        mainAxisSpacing: 14,
      ),
      itemBuilder: (context, index) {
        final feature = features[index];
        return _ShowcaseFeatureCard(
          icon: feature.$1,
          title: feature.$2,
          body: feature.$3,
        );
      },
    );
  }
}

class _ShowcaseFeatureCard extends StatelessWidget {
  const _ShowcaseFeatureCard({
    required this.icon,
    required this.title,
    required this.body,
  });

  final IconData icon;
  final String title;
  final String body;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: const Color(0xFF0B1F34),
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: const Color(0xFF24536A)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, color: const Color(0xFF75EAF2), size: 27),
          const SizedBox(height: 16),
          Text(
            title,
            style: const TextStyle(
              color: Colors.white,
              fontSize: 16,
              fontWeight: FontWeight.w900,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            body,
            style: const TextStyle(
              color: Color(0xFF9FB5C5),
              fontSize: 13,
              height: 1.35,
            ),
          ),
        ],
      ),
    );
  }
}

class ChargingHomeScreen extends StatefulWidget {
  const ChargingHomeScreen({
    super.key,
    required this.onLogout,
    required this.api,
    required this.accessToken,
    required this.driverEmail,
    required this.onAuthExpired,
  });

  final VoidCallback onLogout;
  final StraumvaktApi api;
  final String? accessToken;
  final String? driverEmail;
  final VoidCallback onAuthExpired;

  @override
  State<ChargingHomeScreen> createState() => _ChargingHomeScreenState();
}

class _ChargingHomeScreenState extends State<ChargingHomeScreen> {
  static const double soc = 0.68;
  final _bleTapService = _BleTapService();
  _ChargeState chargeState = _ChargeState.idle;
  bool preparingIssueDetected = false;
  bool showPermissionBanner = false;
  int activeHeroIndex = 1;
  int selectedTabIndex = 0;
  List<_DriverInstallation> _installations = _seedInstallations;
  late String selectedInstallationId = _installations.first.id;
  late String selectedCharger = _installations.first.chargers.first.serial;
  _ActiveSession? activeSession;
  bool _starting = false;

  _DriverInstallation get selectedInstallation => _installations.firstWhere(
    (installation) => installation.id == selectedInstallationId,
    orElse: () => _installations.first,
  );

  _DriverCharger get selectedChargerModel =>
      selectedInstallation.chargers.firstWhere(
        (charger) => charger.serial == selectedCharger,
        orElse: () => selectedInstallation.chargers.first,
      );

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      unawaited(_refreshPermissionBanner());
      if (widget.accessToken != null) {
        unawaited(_loadChargers());
      }
    });
  }

  Future<void> _loadChargers() async {
    final token = widget.accessToken;
    if (token == null) return;
    try {
      final apiChargers = await widget.api.chargers(token);
      if (!mounted) return;
      final grouped = _groupChargers(apiChargers);
      if (grouped.isEmpty) return;
      setState(() {
        _installations = grouped;
        selectedInstallationId = grouped.first.id;
        selectedCharger = grouped.first.chargers.first.serial;
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      if (e.isAuth) {
        widget.onAuthExpired();
        return;
      }
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Gat ekki sótt hleðslustöðvar: ${e.message}'),
          backgroundColor: const Color(0xFF3A1620),
        ),
      );
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Gat ekki sótt hleðslustöðvar: $e'),
          backgroundColor: const Color(0xFF3A1620),
        ),
      );
    }
  }

  List<_DriverInstallation> _groupChargers(List<ApiCharger> chargers) {
    if (chargers.isEmpty) return const [];
    final byLocation = <String, List<ApiCharger>>{};
    for (final c in chargers) {
      final key = c.locationName.isEmpty ? 'Hleðslustöðvar' : c.locationName;
      byLocation.putIfAbsent(key, () => []).add(c);
    }
    final installations = <_DriverInstallation>[];
    byLocation.forEach((locationName, group) {
      installations.add(
        _DriverInstallation(
          id: 'inst-${installations.length}-${locationName.hashCode}',
          name: locationName,
          chargers: [
            for (final c in group)
              _DriverCharger(
                serial: c.displayName,
                connectorId: c.connectorId,
                locationName: locationName,
                status: c.status,
                priceLabel: c.maxPowerKw > 0
                    ? '${c.maxPowerKw.toStringAsFixed(0)} kW max'
                    : 'Verð sótt við lokun',
                estimatedSessionCost: '—',
              ),
          ],
        ),
      );
    });
    return installations;
  }

  Future<void> _refreshPermissionBanner() async {
    final missing = await _missingSupportPermissions();
    if (!mounted) return;
    setState(() => showPermissionBanner = missing.isNotEmpty);
  }

  Future<List<Permission>> _missingSupportPermissions() async {
    final photoStatus = await Permission.photos.status;
    final storageStatus = await Permission.storage.status;
    final checks = <Permission, PermissionStatus>{
      Permission.bluetoothScan: await Permission.bluetoothScan.status,
      Permission.bluetoothConnect: await Permission.bluetoothConnect.status,
      Permission.camera: await Permission.camera.status,
    };

    final missing = <Permission>[
      for (final entry in checks.entries)
        if (!entry.value.isGranted) entry.key,
    ];

    if (!photoStatus.isGranted && !storageStatus.isGranted) {
      missing.add(Permission.photos);
    }

    return missing;
  }

  Future<void> _requestSupportPermissions() async {
    final missing = await _missingSupportPermissions();
    var permanentlyDenied = false;

    for (final permission in missing) {
      final status = await permission.status;
      permanentlyDenied = permanentlyDenied || status.isPermanentlyDenied;
    }

    if (missing.isEmpty) {
      await _refreshPermissionBanner();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('All requested permissions are enabled.'),
          ),
        );
      }
      return;
    }

    if (permanentlyDenied) {
      await openAppSettings();
    } else {
      await missing.request();
    }
    await _refreshPermissionBanner();
  }

  @override
  Widget build(BuildContext context) {
    final isPreparing = chargeState == _ChargeState.preparing;
    final isCharging = chargeState == _ChargeState.charging;
    return Scaffold(
      backgroundColor: _BrandPalette.midnight,
      bottomNavigationBar: _DriverBottomArea(
        selectedIndex: selectedTabIndex,
        showPermissionBanner: showPermissionBanner,
        onDestinationSelected: (index) {
          setState(() => selectedTabIndex = index);
        },
        onEnablePermissions: _requestSupportPermissions,
        onDismissPermissions: () {
          setState(() => showPermissionBanner = false);
        },
      ),
      body: selectedTabIndex == 0
          ? _buildChargingBody(isPreparing: isPreparing, isCharging: isCharging)
          : _DriverTabScreen(
              selectedIndex: selectedTabIndex,
              activeSession: activeSession,
              selectedInstallation: selectedInstallation,
              selectedCharger: selectedChargerModel,
              onLogout: widget.onLogout,
            ),
    );
  }

  Widget _buildChargingBody({
    required bool isPreparing,
    required bool isCharging,
  }) {
    return SafeArea(
      bottom: false,
      child: GestureDetector(
        behavior: HitTestBehavior.translucent,
        onTap: isPreparing && !preparingIssueDetected
            ? () => setState(_beginCharging)
            : null,
        child: CustomScrollView(
          physics: const BouncingScrollPhysics(),
          slivers: [
            SliverPersistentHeader(
              pinned: true,
              delegate: _HeaderDelegate(onLogout: widget.onLogout),
            ),
            if (isPreparing || isCharging)
              SliverFillRemaining(
                hasScrollBody: false,
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(20, 22, 20, 36),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Expanded(
                        child: isPreparing
                            ? _PreparingChargeCard(
                                selectedCharger: selectedCharger,
                                heroImage:
                                    _HeroImageSlider.images[activeHeroIndex],
                                hasIssue: preparingIssueDetected,
                                onReportIssue: _showPreparingIssue,
                              )
                            : _HeroCard(
                                isCharging: isCharging,
                                soc: soc,
                                activeHeroIndex: activeHeroIndex,
                                selectedCharger: selectedCharger,
                                activeSession: activeSession,
                                onChargerChanged: (value) {
                                  if (value != null) {
                                    setState(() => selectedCharger = value);
                                  }
                                },
                                selectedInstallationId: selectedInstallationId,
                                installations: _installations,
                                onInstallationChanged: _selectInstallation,
                                installation: selectedInstallation,
                                charger: selectedChargerModel,
                                onHeroChanged: (index) {
                                  setState(() => activeHeroIndex = index);
                                },
                                onToggle: () {
                                  setState(() {
                                    preparingIssueDetected = false;
                                    activeSession = null;
                                    chargeState = _ChargeState.idle;
                                  });
                                },
                                onBleTap: _openBleTap,
                              ),
                      ),
                    ],
                  ),
                ),
              )
            else
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(20, 22, 20, 36),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      _HeroCard(
                        isCharging: isCharging,
                        soc: soc,
                        activeHeroIndex: activeHeroIndex,
                        selectedCharger: selectedCharger,
                        activeSession: activeSession,
                        onChargerChanged: (value) {
                          if (value != null) {
                            setState(() => selectedCharger = value);
                          }
                        },
                        selectedInstallationId: selectedInstallationId,
                        installations: _installations,
                        onInstallationChanged: _selectInstallation,
                        installation: selectedInstallation,
                        charger: selectedChargerModel,
                        onHeroChanged: (index) {
                          setState(() => activeHeroIndex = index);
                        },
                        onToggle: _starting
                            ? () {}
                            : () {
                                unawaited(_requestStart());
                              },
                        onBleTap: _openBleTap,
                      ),
                      const SizedBox(height: 18),
                      _SegmentField(
                        isCharging: isCharging,
                        isPreparing: isPreparing,
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

  void _selectInstallation(String? value) {
    if (value == null) return;
    final installation = _installations.firstWhere(
      (installation) => installation.id == value,
      orElse: () => _installations.first,
    );
    setState(() {
      selectedInstallationId = installation.id;
      selectedCharger = installation.chargers.first.serial;
    });
  }

  void _beginCharging() {
    final charger = selectedChargerModel;
    activeSession ??= _ActiveSession(
      sessionId:
          'sess-${charger.serial.toLowerCase().replaceAll(' ', '-')}-live',
      charger: charger,
      startedAtLabel: 'Started now',
      powerKw: 7.4,
      energyKwh: 3.8,
      costIsk: charger.estimatedSessionCost.startsWith('0') ? 0 : 312,
    );
    chargeState = _ChargeState.charging;
  }

  Future<void> _requestStart() async {
    final token = widget.accessToken;
    final charger = selectedChargerModel;
    if (token == null) {
      setState(() {
        preparingIssueDetected = false;
        chargeState = _ChargeState.preparing;
      });
      return;
    }
    if (_starting) return;
    setState(() => _starting = true);
    try {
      final result = await widget.api.startSession(
        token,
        connectorId: charger.connectorId,
      );
      if (!mounted) return;
      setState(() {
        _starting = false;
        preparingIssueDetected = false;
        chargeState = _ChargeState.preparing;
        activeSession = _ActiveSession(
          sessionId: result.sessionId,
          charger: charger,
          startedAtLabel: 'Started now',
          powerKw: 0,
          energyKwh: 0,
          costIsk: 0,
        );
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
      setState(() => _starting = false);
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
    } on TimeoutException {
      if (!mounted) return;
      setState(() => _starting = false);
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Tenging tókst ekki — reyndu aftur.'),
          backgroundColor: Color(0xFF3A1620),
        ),
      );
    } catch (e) {
      if (!mounted) return;
      setState(() => _starting = false);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Villa: $e'),
          backgroundColor: const Color(0xFF3A1620),
        ),
      );
    }
  }

  Future<void> _openBleTap() async {
    final result = await showModalBottomSheet<_BleTapResult>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (context) => _BleTapSheet(service: _bleTapService),
    );

    if (result == null || !mounted) return;

    _DriverInstallation? matchInst;
    _DriverCharger? matchCharger;
    final needle = result.charger.toLowerCase();
    for (final inst in _installations) {
      for (final c in inst.chargers) {
        final hay = c.serial.toLowerCase();
        if (hay.contains(needle) || needle.contains(hay)) {
          matchInst = inst;
          matchCharger = c;
          break;
        }
      }
      if (matchCharger != null) break;
    }

    if (matchInst == null || matchCharger == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            'Enginn passandi hleðslustöð fyrir BLE merki "${result.charger}".',
          ),
          backgroundColor: const Color(0xFF3A1620),
        ),
      );
      return;
    }

    setState(() {
      selectedInstallationId = matchInst!.id;
      selectedCharger = matchCharger!.serial;
    });

    await _requestStart();
  }

  void _showPreparingIssue() {
    showModalBottomSheet<void>(
      context: context,
      backgroundColor: Colors.transparent,
      builder: (context) {
        return Container(
          margin: const EdgeInsets.all(16),
          padding: const EdgeInsets.all(18),
          decoration: BoxDecoration(
            color: _BrandPalette.surface,
            borderRadius: BorderRadius.circular(24),
            border: Border.all(color: _BrandPalette.border),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Text(
                'Mál í undirbúningi hleðslu',
                style: TextStyle(
                  color: Colors.white,
                  fontSize: 20,
                  fontWeight: FontWeight.w900,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                '$selectedCharger svaraði ekki öryggisprófi. Málið verður sent með stöðu, hleðslustöð og síðustu atburðum.',
                style: const TextStyle(
                  color: _BrandPalette.muted,
                  fontSize: 14,
                  height: 1.35,
                ),
              ),
              const SizedBox(height: 16),
              FilledButton.icon(
                onPressed: () => Navigator.of(context).pop(),
                style: FilledButton.styleFrom(
                  backgroundColor: const Color(0xFFFF3864),
                  foregroundColor: Colors.white,
                  padding: const EdgeInsets.symmetric(vertical: 14),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(16),
                  ),
                ),
                icon: const Icon(Icons.report_problem_rounded),
                label: const Text(
                  'Senda mál',
                  style: TextStyle(fontWeight: FontWeight.w900),
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}

enum _ChargeState { idle, preparing, charging }

class _DriverBottomArea extends StatelessWidget {
  const _DriverBottomArea({
    required this.selectedIndex,
    required this.showPermissionBanner,
    required this.onDestinationSelected,
    required this.onEnablePermissions,
    required this.onDismissPermissions,
  });

  final int selectedIndex;
  final bool showPermissionBanner;
  final ValueChanged<int> onDestinationSelected;
  final VoidCallback onEnablePermissions;
  final VoidCallback onDismissPermissions;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: const BoxDecoration(color: _BrandPalette.midnight),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (showPermissionBanner)
            _PermissionBanner(
              onEnable: onEnablePermissions,
              onDismiss: onDismissPermissions,
            ),
          NavigationBar(
            selectedIndex: selectedIndex,
            onDestinationSelected: onDestinationSelected,
            height: 72,
            backgroundColor: _BrandPalette.deepNavy,
            indicatorColor: _BrandPalette.cyan.withValues(alpha: 0.18),
            surfaceTintColor: Colors.transparent,
            labelBehavior: NavigationDestinationLabelBehavior.alwaysShow,
            destinations: const [
              NavigationDestination(
                icon: Icon(Icons.ev_station_outlined),
                selectedIcon: Icon(Icons.ev_station_rounded),
                label: 'Charge',
              ),
              NavigationDestination(
                icon: Icon(Icons.receipt_long_outlined),
                selectedIcon: Icon(Icons.receipt_long_rounded),
                label: 'Sessions',
              ),
              NavigationDestination(
                icon: Icon(Icons.support_agent_outlined),
                selectedIcon: Icon(Icons.support_agent_rounded),
                label: 'Support',
              ),
              NavigationDestination(
                icon: Icon(Icons.person_outline_rounded),
                selectedIcon: Icon(Icons.person_rounded),
                label: 'Account',
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _DriverTabScreen extends StatelessWidget {
  const _DriverTabScreen({
    required this.selectedIndex,
    required this.activeSession,
    required this.selectedInstallation,
    required this.selectedCharger,
    required this.onLogout,
  });

  final int selectedIndex;
  final _ActiveSession? activeSession;
  final _DriverInstallation selectedInstallation;
  final _DriverCharger selectedCharger;
  final VoidCallback onLogout;

  @override
  Widget build(BuildContext context) {
    final tab = switch (selectedIndex) {
      1 => (
        icon: Icons.history_rounded,
        title: 'Sessions',
        subtitle: activeSession == null
            ? 'No active charging session'
            : 'Charging at ${activeSession!.charger.serial}',
        children: <Widget>[
          _DriverInfoTile(
            icon: Icons.ev_station_rounded,
            title: selectedCharger.serial,
            subtitle: selectedInstallation.name,
            trailing: selectedCharger.status,
          ),
          if (activeSession != null)
            _DriverInfoTile(
              icon: Icons.bolt_rounded,
              title: activeSession!.sessionId,
              subtitle:
                  '${activeSession!.energyKwh.toStringAsFixed(1)} kWh so far',
              trailing: '${activeSession!.costIsk} kr.',
            ),
          const _DriverInfoTile(
            icon: Icons.check_circle_outline_rounded,
            title: 'Last session',
            subtitle: 'Dalvegur 10 - 14, 63.9 kWh',
            trailing: 'Done',
          ),
        ],
      ),
      2 => (
        icon: Icons.support_agent_rounded,
        title: 'Support',
        subtitle: 'Create a support case or attach charger photos',
        children: const <Widget>[
          _DriverInfoTile(
            icon: Icons.add_a_photo_outlined,
            title: 'Report charger issue',
            subtitle: 'Camera and gallery attachments are prepared',
            trailing: 'Draft',
          ),
          _DriverInfoTile(
            icon: Icons.qr_code_scanner_rounded,
            title: 'QR scan',
            subtitle: 'Scan or upload a QR code in a later build',
            trailing: 'Soon',
          ),
          _DriverInfoTile(
            icon: Icons.bluetooth_searching_rounded,
            title: 'Phone tap support',
            subtitle: 'BLE charger lookup and start command testing',
            trailing: 'Active',
          ),
        ],
      ),
      _ => (
        icon: Icons.person_rounded,
        title: 'Account',
        subtitle: _AppTruth.driverEmail,
        children: <Widget>[
          const _DriverInfoTile(
            icon: Icons.badge_outlined,
            title: _AppTruth.driverName,
            subtitle: 'Driver app access',
            trailing: 'Active',
          ),
          const _DriverInfoTile(
            icon: Icons.nfc_rounded,
            title: 'RFID idTag',
            subtitle: _AppTruth.primaryIdTag,
            trailing: 'BLE tap',
          ),
          _DriverInfoTile(
            icon: Icons.logout_rounded,
            title: 'Sign out',
            subtitle: 'Leave the driver app',
            trailing: 'Logout',
            onTap: onLogout,
          ),
        ],
      ),
    };

    return SafeArea(
      bottom: false,
      child: CustomScrollView(
        physics: const BouncingScrollPhysics(),
        slivers: [
          SliverPersistentHeader(
            pinned: true,
            delegate: _HeaderDelegate(onLogout: onLogout),
          ),
          SliverToBoxAdapter(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(20, 22, 20, 28),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  _DriverTabHero(
                    icon: tab.icon,
                    title: tab.title,
                    subtitle: tab.subtitle,
                  ),
                  const SizedBox(height: 14),
                  ...tab.children,
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _DriverTabHero extends StatelessWidget {
  const _DriverTabHero({
    required this.icon,
    required this.title,
    required this.subtitle,
  });

  final IconData icon;
  final String title;
  final String subtitle;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: const Color(0xFF071827),
        borderRadius: BorderRadius.circular(22),
        border: Border.all(color: _BrandPalette.border),
      ),
      child: Row(
        children: [
          Container(
            width: 48,
            height: 48,
            decoration: BoxDecoration(
              color: _BrandPalette.cyan.withValues(alpha: 0.13),
              borderRadius: BorderRadius.circular(16),
            ),
            child: Icon(icon, color: const Color(0xFF75EAF2), size: 26),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 22,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  subtitle,
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

class _DriverInfoTile extends StatelessWidget {
  const _DriverInfoTile({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.trailing,
    this.onTap,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final String trailing;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(18),
        child: Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: const Color(0xFF071724),
            borderRadius: BorderRadius.circular(18),
            border: Border.all(color: const Color(0xFF17394B)),
          ),
          child: Row(
            children: [
              Icon(icon, color: const Color(0xFF75EAF2), size: 22),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 15,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      subtitle,
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
              const SizedBox(width: 10),
              Text(
                trailing,
                style: const TextStyle(
                  color: _BrandPalette.mint,
                  fontSize: 12,
                  fontWeight: FontWeight.w900,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _PermissionBanner extends StatelessWidget {
  const _PermissionBanner({required this.onEnable, required this.onDismiss});

  final VoidCallback onEnable;
  final VoidCallback onDismiss;

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      top: false,
      child: Container(
        margin: const EdgeInsets.fromLTRB(14, 0, 14, 10),
        padding: const EdgeInsets.fromLTRB(14, 12, 12, 12),
        decoration: BoxDecoration(
          color: const Color(0xFF0B2130),
          borderRadius: BorderRadius.circular(18),
          border: Border.all(color: _BrandPalette.border),
          boxShadow: const [
            BoxShadow(
              color: Color(0x99000000),
              blurRadius: 18,
              offset: Offset(0, 10),
            ),
          ],
        ),
        child: Row(
          children: [
            const Icon(Icons.privacy_tip_outlined, color: Color(0xFF75EAF2)),
            const SizedBox(width: 10),
            const Expanded(
              child: Text(
                'Enable Bluetooth, camera, and photos for phone tap and support tickets.',
                style: TextStyle(
                  color: Colors.white,
                  fontSize: 12,
                  fontWeight: FontWeight.w800,
                  height: 1.25,
                ),
              ),
            ),
            TextButton(onPressed: onEnable, child: const Text('Enable')),
            IconButton(
              onPressed: onDismiss,
              icon: const Icon(Icons.close_rounded, size: 20),
              color: _BrandPalette.muted,
            ),
          ],
        ),
      ),
    );
  }
}

class _BleTapSheet extends StatefulWidget {
  const _BleTapSheet({required this.service});

  final _BleTapService service;

  @override
  State<_BleTapSheet> createState() => _BleTapSheetState();
}

class _BleTapSheetState extends State<_BleTapSheet> {
  bool _isScanning = false;
  bool _nfcListening = false;
  _BleTapResult? _result;
  String? _error;
  String? _nfcFeedback;

  @override
  void dispose() {
    if (_nfcListening) {
      unawaited(NfcManager.instance.stopSession());
    }
    super.dispose();
  }

  Future<void> _scan() async {
    setState(() {
      _isScanning = true;
      _result = null;
      _error = null;
    });

    try {
      final result = await widget.service.scanForCharger();
      if (!mounted) return;
      setState(() {
        _result = result;
        _error = result == null
            ? 'No Straumvakt BLE reader found nearby.'
            : null;
      });
    } on _BleTapFailure catch (error) {
      if (!mounted) return;
      setState(() => _error = error.message);
    } catch (_) {
      if (!mounted) return;
      setState(
        () => _error = 'Bluetooth scan failed. Try again near the charger.',
      );
    } finally {
      if (mounted) setState(() => _isScanning = false);
    }
  }

  void _simulate() {
    setState(() {
      _result = _BleTapService.simulatedResult;
      _error = null;
      _isScanning = false;
    });
  }

  Future<void> _listenForNfc() async {
    setState(() {
      _nfcListening = true;
      _nfcFeedback = 'Listening for NFC tags and ISO-DEP readers...';
    });

    try {
      final availability = await NfcManager.instance.checkAvailability();
      if (availability != NfcAvailability.enabled) {
        if (!mounted) return;
        setState(() {
          _nfcListening = false;
          _nfcFeedback = 'NFC is not enabled or not available on this phone.';
        });
        return;
      }

      await NfcManager.instance.startSession(
        pollingOptions: const {
          NfcPollingOption.iso14443,
          NfcPollingOption.iso15693,
        },
        onDiscovered: (tag) async {
          final raw = tag.toString();
          if (!mounted) return;
          setState(() {
            _nfcListening = false;
            _nfcFeedback = raw.length > 220
                ? '${raw.substring(0, 220)}...'
                : raw;
          });
          await NfcManager.instance.stopSession();
        },
      );
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _nfcListening = false;
        _nfcFeedback = 'NFC probe failed: $error';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final result = _result;

    return SafeArea(
      child: Container(
        margin: const EdgeInsets.all(14),
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 18),
        decoration: BoxDecoration(
          color: _BrandPalette.surface,
          borderRadius: BorderRadius.circular(24),
          border: Border.all(color: _BrandPalette.border),
          boxShadow: const [
            BoxShadow(
              color: Color(0x99000000),
              blurRadius: 28,
              offset: Offset(0, 18),
            ),
          ],
        ),
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                children: [
                  Container(
                    width: 44,
                    height: 44,
                    decoration: BoxDecoration(
                      color: const Color(0xFF0B2130),
                      borderRadius: BorderRadius.circular(14),
                      border: Border.all(color: const Color(0xFF17394B)),
                    ),
                    child: const Icon(
                      Icons.bluetooth_searching_rounded,
                      color: Color(0xFF75EAF2),
                    ),
                  ),
                  const SizedBox(width: 12),
                  const Expanded(
                    child: Text(
                      'Phone tap',
                      style: TextStyle(
                        color: Colors.white,
                        fontSize: 21,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                  ),
                  IconButton(
                    onPressed: () => Navigator.of(context).pop(),
                    icon: const Icon(Icons.close_rounded),
                  ),
                ],
              ),
              const SizedBox(height: 14),
              AnimatedSwitcher(
                duration: const Duration(milliseconds: 180),
                child: _isScanning
                    ? const _BleTapScanningState()
                    : result != null
                    ? _BleTapFoundState(result: result)
                    : _error == null
                    ? const _BleTapReadyState()
                    : _BleTapEmptyState(error: _error),
              ),
              const SizedBox(height: 14),
              FilledButton.icon(
                onPressed: result == null
                    ? (_isScanning ? null : _scan)
                    : () => Navigator.of(context).pop(result),
                style: FilledButton.styleFrom(
                  backgroundColor: result == null
                      ? _BrandPalette.cyan
                      : _BrandPalette.blue,
                  foregroundColor: _BrandPalette.midnight,
                  padding: const EdgeInsets.symmetric(vertical: 15),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(16),
                  ),
                ),
                icon: Icon(
                  result == null
                      ? Icons.search_rounded
                      : Icons.verified_user_rounded,
                ),
                label: Text(
                  result == null ? 'Scan for reader' : 'Start charge',
                  style: const TextStyle(fontWeight: FontWeight.w900),
                ),
              ),
              const SizedBox(height: 7),
              TextButton.icon(
                onPressed: _isScanning ? null : _simulate,
                icon: const Icon(Icons.science_outlined),
                label: const Text('Use staging reader'),
              ),
              const SizedBox(height: 8),
              OutlinedButton.icon(
                onPressed: _nfcListening ? null : _listenForNfc,
                style: OutlinedButton.styleFrom(
                  foregroundColor: const Color(0xFF75EAF2),
                  padding: const EdgeInsets.symmetric(vertical: 13),
                  side: const BorderSide(color: _BrandPalette.border),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(16),
                  ),
                ),
                icon: Icon(
                  _nfcListening
                      ? Icons.sensors_rounded
                      : Icons.contactless_rounded,
                ),
                label: Text(
                  _nfcListening ? 'Listening for NFC...' : 'Probe NFC',
                  style: const TextStyle(fontWeight: FontWeight.w900),
                ),
              ),
              if (_nfcFeedback != null) ...[
                const SizedBox(height: 10),
                _BleTapStatusPanel(
                  icon: Icons.contactless_rounded,
                  title: 'NFC feedback',
                  body: _nfcFeedback!,
                  showProgress: _nfcListening,
                  accent: _nfcListening
                      ? const Color(0xFF75EAF2)
                      : _BrandPalette.mint,
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

class _BleTapReadyState extends StatelessWidget {
  const _BleTapReadyState();

  @override
  Widget build(BuildContext context) {
    return const _BleTapStatusPanel(
      icon: Icons.tap_and_play_rounded,
      title: 'Ready for tap',
      body:
          'Hold the phone near a Straumvakt BLE reader, then scan. Use staging reader when testing without hardware.',
      showProgress: false,
    );
  }
}

class _BleTapScanningState extends StatelessWidget {
  const _BleTapScanningState();

  @override
  Widget build(BuildContext context) {
    return const _BleTapStatusPanel(
      icon: Icons.radar_rounded,
      title: 'Hold phone near reader',
      body: 'Scanning for a Straumvakt BLE beacon from the charger.',
      showProgress: true,
    );
  }
}

class _BleTapEmptyState extends StatelessWidget {
  const _BleTapEmptyState({required this.error});

  final String? error;

  @override
  Widget build(BuildContext context) {
    return _BleTapStatusPanel(
      icon: Icons.bluetooth_disabled_rounded,
      title: 'Reader not detected',
      body: error ?? 'Move closer to the charger and try again.',
      showProgress: false,
    );
  }
}

class _BleTapFoundState extends StatelessWidget {
  const _BleTapFoundState({required this.result});

  final _BleTapResult result;

  @override
  Widget build(BuildContext context) {
    return _BleTapStatusPanel(
      icon: Icons.verified_rounded,
      title: result.charger,
      body:
          '${result.source} -> ${result.connectorId}\nPOST /api/driver/start-session\nmethod=ble_tap idTag=${result.idTag}',
      showProgress: false,
      accent: _BrandPalette.blue,
    );
  }
}

class _BleTapStatusPanel extends StatelessWidget {
  const _BleTapStatusPanel({
    required this.icon,
    required this.title,
    required this.body,
    required this.showProgress,
    this.accent = const Color(0xFF75EAF2),
  });

  final IconData icon;
  final String title;
  final String body;
  final bool showProgress;
  final Color accent;

  @override
  Widget build(BuildContext context) {
    return Container(
      key: ValueKey(title),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: const Color(0xFF071724),
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: const Color(0xFF17394B)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, color: accent, size: 24),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  title,
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 16,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 9),
          Text(
            body,
            style: const TextStyle(
              color: _BrandPalette.muted,
              fontSize: 13,
              fontWeight: FontWeight.w700,
              height: 1.35,
            ),
          ),
          if (showProgress) ...[
            const SizedBox(height: 14),
            LinearProgressIndicator(
              minHeight: 6,
              borderRadius: BorderRadius.circular(999),
              backgroundColor: const Color(0xFF0B2130),
              color: accent,
            ),
          ],
        ],
      ),
    );
  }
}

class _HeaderDelegate extends SliverPersistentHeaderDelegate {
  _HeaderDelegate({required this.onLogout});

  final VoidCallback onLogout;

  @override
  double get minExtent => 66;

  @override
  double get maxExtent => 66;

  @override
  Widget build(
    BuildContext context,
    double shrinkOffset,
    bool overlapsContent,
  ) {
    return Container(
      color: _BrandPalette.midnight,
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
      child: Row(
        children: [
          const _LogoMark(size: 38, borderRadius: 13),
          const SizedBox(width: 11),
          const Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Text(
                  _AppTruth.driverName,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    color: Colors.white,
                    fontSize: 17,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                SizedBox(height: 1),
                Text(
                  '${_AppTruth.driverEmail} • ${_AppTruth.appAudience}',
                  style: TextStyle(
                    color: _BrandPalette.muted,
                    fontSize: 12,
                    fontWeight: FontWeight.w500,
                  ),
                ),
              ],
            ),
          ),
          _HeaderButton(icon: Icons.notifications_none_rounded, onTap: () {}),
          const SizedBox(width: 7),
          _HeaderButton(
            icon: Icons.menu_rounded,
            onTap: () {
              Navigator.of(context).push(
                MaterialPageRoute<void>(
                  builder: (_) => _RichProfileScreen(onLogout: onLogout),
                ),
              );
            },
          ),
        ],
      ),
    );
  }

  @override
  bool shouldRebuild(covariant SliverPersistentHeaderDelegate oldDelegate) {
    return oldDelegate is! _HeaderDelegate || oldDelegate.onLogout != onLogout;
  }
}

class _HeaderButton extends StatelessWidget {
  const _HeaderButton({required this.icon, required this.onTap});

  final IconData icon;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      borderRadius: BorderRadius.circular(16),
      onTap: onTap,
      child: Container(
        width: 38,
        height: 38,
        decoration: BoxDecoration(
          color: _BrandPalette.surface,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: _BrandPalette.border),
        ),
        child: Icon(icon, color: const Color(0xFFDDF7F7), size: 21),
      ),
    );
  }
}

class _HeroCard extends StatelessWidget {
  const _HeroCard({
    required this.isCharging,
    required this.soc,
    required this.activeHeroIndex,
    required this.selectedCharger,
    required this.selectedInstallationId,
    required this.installation,
    required this.installations,
    required this.charger,
    required this.activeSession,
    required this.onChargerChanged,
    required this.onInstallationChanged,
    required this.onHeroChanged,
    required this.onToggle,
    required this.onBleTap,
  });

  final bool isCharging;
  final double soc;
  final int activeHeroIndex;
  final String selectedCharger;
  final String selectedInstallationId;
  final _DriverInstallation installation;
  final List<_DriverInstallation> installations;
  final _DriverCharger charger;
  final _ActiveSession? activeSession;
  final ValueChanged<String?> onChargerChanged;
  final ValueChanged<String?> onInstallationChanged;
  final ValueChanged<int> onHeroChanged;
  final VoidCallback onToggle;
  final VoidCallback onBleTap;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(20, 22, 20, 24),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(28),
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0xFF10323B), Color(0xFF071927)],
        ),
        border: Border.all(color: _BrandPalette.border),
        boxShadow: [
          BoxShadow(
            color: _BrandPalette.blue.withValues(alpha: 0.08),
            blurRadius: 28,
            offset: const Offset(0, 14),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _HeroImageSlider(
            activeIndex: activeHeroIndex,
            onChanged: onHeroChanged,
          ),
          const SizedBox(height: 20),
          if (isCharging) ...[
            const Row(
              children: [
                Expanded(
                  child: _Metric(label: 'Hleðsluhraði', value: '7.4 kW'),
                ),
                SizedBox(width: 12),
                Expanded(
                  child: _Metric(label: 'SOC', value: '68%', alignRight: true),
                ),
              ],
            ),
            const SizedBox(height: 18),
            _SocBar(progress: soc),
            const SizedBox(height: 26),
          ],
          if (!isCharging) ...[
            const Text(
              'Veldu Hleðslustöð',
              style: TextStyle(
                color: Color(0xFFB8D2DE),
                fontSize: 14,
                fontWeight: FontWeight.w700,
              ),
            ),
            const SizedBox(height: 8),
            _InstallationDropdown(
              selectedInstallationId: selectedInstallationId,
              installations: installations,
              onChanged: onInstallationChanged,
            ),
            const SizedBox(height: 10),
            _ChargerDropdown(
              selectedCharger: selectedCharger,
              chargers: installation.chargers,
              onChanged: onChargerChanged,
            ),
            const SizedBox(height: 12),
            _PricingPreview(charger: charger),
            const SizedBox(height: 18),
          ] else
            const SizedBox(height: 6),
          Center(
            child: _StartButton(isCharging: isCharging, onPressed: onToggle),
          ),
          const SizedBox(height: 12),
          Text(
            isCharging ? 'Hleðsla virk' : 'Byrja hleðslu',
            textAlign: TextAlign.center,
            style: const TextStyle(
              color: Color(0xFFEAF8FB),
              fontSize: 18,
              fontWeight: FontWeight.w800,
            ),
          ),
          if (!isCharging) ...[
            const SizedBox(height: 12),
            OutlinedButton.icon(
              onPressed: onBleTap,
              style: OutlinedButton.styleFrom(
                foregroundColor: const Color(0xFF75EAF2),
                padding: const EdgeInsets.symmetric(vertical: 13),
                side: const BorderSide(color: _BrandPalette.border),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(16),
                ),
              ),
              icon: const Icon(Icons.bluetooth_searching_rounded),
              label: const Text(
                'Phone tap',
                style: TextStyle(fontWeight: FontWeight.w900),
              ),
            ),
          ],
          if (isCharging) ...[
            const SizedBox(height: 18),
            Row(
              children: [
                Expanded(
                  child: const _Metric(
                    label: 'Hle\u00f0slut\u00edmi',
                    value: '42 m\u00edn',
                    labelFontSize: 12,
                    valueFontSize: 20,
                  ),
                ),
                SizedBox(width: 12),
                Expanded(
                  child: _Metric(
                    label: '\u00c1\u00e6tla\u00f0ur kostn.',
                    value: '${activeSession?.costIsk ?? 312} kr.',
                    alignRight: true,
                    labelFontSize: 12,
                    valueFontSize: 20,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            _ActiveSessionPanel(session: activeSession, onStop: onToggle),
          ],
        ],
      ),
    );
  }
}

class _HeroImageSlider extends StatefulWidget {
  const _HeroImageSlider({required this.activeIndex, required this.onChanged});

  static const images = [
    'assets/images/straumvakt_hero_image.png',
    'assets/images/on_hero_image.png',
    'assets/images/isorka_hero_image.png',
  ];
  static const plates = ['SV 428', 'N1 742', 'IS 306'];

  final int activeIndex;
  final ValueChanged<int> onChanged;

  @override
  State<_HeroImageSlider> createState() => _HeroImageSliderState();
}

class _HeroImageSliderState extends State<_HeroImageSlider> {
  late final PageController _controller = PageController(
    initialPage: widget.activeIndex,
  );

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        SizedBox(
          height: 230,
          child: Stack(
            children: [
              Positioned.fill(
                top: 12,
                child: PageView.builder(
                  controller: _controller,
                  itemCount: _HeroImageSlider.images.length,
                  onPageChanged: widget.onChanged,
                  itemBuilder: (context, index) {
                    return Center(
                      child: Image.asset(
                        _HeroImageSlider.images[index],
                        width: double.infinity,
                        height: 218,
                        fit: BoxFit.contain,
                        filterQuality: FilterQuality.high,
                      ),
                    );
                  },
                ),
              ),
              Positioned(
                top: 0,
                left: 4,
                child: _NumberPlate(
                  value: _HeroImageSlider.plates[widget.activeIndex],
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 10),
        Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: List.generate(_HeroImageSlider.images.length, (index) {
            final active = index == widget.activeIndex;
            return AnimatedContainer(
              duration: const Duration(milliseconds: 180),
              width: active ? 22 : 7,
              height: 7,
              margin: const EdgeInsets.symmetric(horizontal: 4),
              decoration: BoxDecoration(
                color: active
                    ? const Color(0xFF75EAF2)
                    : const Color(0xFF31566A),
                borderRadius: BorderRadius.circular(8),
              ),
            );
          }),
        ),
      ],
    );
  }
}

class _NumberPlate extends StatelessWidget {
  const _NumberPlate({required this.value});

  final String value;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 33,
      decoration: BoxDecoration(
        color: const Color(0xFFF8FAFC),
        borderRadius: BorderRadius.circular(4),
        border: Border.all(color: const Color(0xFF111827), width: 2),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.28),
            blurRadius: 9,
            offset: const Offset(0, 5),
          ),
        ],
      ),
      clipBehavior: Clip.antiAlias,
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          const _IcelandPlateMark(),
          Padding(
            padding: const EdgeInsets.fromLTRB(9, 0, 6, 2),
            child: Text(
              value.substring(0, 2),
              style: const TextStyle(
                color: Color(0xFF1565C0),
                fontSize: 25,
                fontWeight: FontWeight.w900,
                height: 1,
                letterSpacing: 0,
              ),
            ),
          ),
          const _PlateInspectionSticker(),
          Padding(
            padding: const EdgeInsets.fromLTRB(6, 0, 9, 2),
            child: Text(
              value.substring(3),
              style: const TextStyle(
                color: Color(0xFF1565C0),
                fontSize: 25,
                fontWeight: FontWeight.w900,
                height: 1,
                letterSpacing: 0,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _IcelandPlateMark extends StatelessWidget {
  const _IcelandPlateMark();

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 26,
      height: double.infinity,
      color: const Color(0xFFF8FAFC),
      alignment: Alignment.center,
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const _IcelandFlag(),
          const SizedBox(height: 2),
          const Text(
            'IS',
            style: TextStyle(
              color: Color(0xFF111827),
              fontSize: 12,
              fontWeight: FontWeight.w900,
              height: 1,
              letterSpacing: 0,
            ),
          ),
        ],
      ),
    );
  }
}

class _IcelandFlag extends StatelessWidget {
  const _IcelandFlag();

  @override
  Widget build(BuildContext context) {
    return CustomPaint(
      size: const Size(17, 11),
      painter: _IcelandFlagPainter(),
    );
  }
}

class _IcelandFlagPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final blue = Paint()..color = const Color(0xFF02529C);
    final white = Paint()..color = Colors.white;
    final red = Paint()..color = const Color(0xFFDC1E35);
    canvas.drawRect(Offset.zero & size, blue);
    canvas.drawRect(
      Rect.fromLTWH(size.width * 0.34, 0, size.width * 0.23, size.height),
      white,
    );
    canvas.drawRect(
      Rect.fromLTWH(0, size.height * 0.34, size.width, size.height * 0.28),
      white,
    );
    canvas.drawRect(
      Rect.fromLTWH(size.width * 0.4, 0, size.width * 0.11, size.height),
      red,
    );
    canvas.drawRect(
      Rect.fromLTWH(0, size.height * 0.42, size.width, size.height * 0.13),
      red,
    );
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}

class _PlateInspectionSticker extends StatelessWidget {
  const _PlateInspectionSticker();

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 14,
      height: 25,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: const Color(0xFFE77DB4),
        borderRadius: BorderRadius.circular(2),
        border: Border.all(color: const Color(0xFFC85B98), width: 0.8),
      ),
      child: const FittedBox(
        fit: BoxFit.scaleDown,
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Text(
              '27',
              style: TextStyle(
                color: Color(0xFF111827),
                fontSize: 11,
                fontWeight: FontWeight.w900,
                height: 1,
                letterSpacing: 0,
              ),
            ),
            SizedBox(height: 1),
            Text(
              '2027',
              style: TextStyle(
                color: Color(0xFF111827),
                fontSize: 5.5,
                fontWeight: FontWeight.w900,
                height: 1,
                letterSpacing: 0,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _Metric extends StatelessWidget {
  const _Metric({
    required this.label,
    required this.value,
    this.alignRight = false,
    this.labelFontSize = 13,
    this.valueFontSize = 25,
  });

  final String label;
  final String value;
  final bool alignRight;
  final double labelFontSize;
  final double valueFontSize;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: alignRight
          ? CrossAxisAlignment.end
          : CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: const TextStyle(
            color: Color(0xFF8EA6B6),
            fontWeight: FontWeight.w600,
          ).copyWith(fontSize: labelFontSize),
        ),
        const SizedBox(height: 4),
        Text(
          value,
          style: const TextStyle(
            color: Colors.white,
            fontWeight: FontWeight.w900,
          ).copyWith(fontSize: valueFontSize),
        ),
      ],
    );
  }
}

class _SocBar extends StatefulWidget {
  const _SocBar({required this.progress});

  final double progress;

  @override
  State<_SocBar> createState() => _SocBarState();
}

class _SocBarState extends State<_SocBar> with SingleTickerProviderStateMixin {
  late final AnimationController _controller;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 2100),
    )..repeat();
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _controller,
      builder: (context, _) {
        return CustomPaint(
          painter: _SocPainter(
            progress: widget.progress,
            phase: _controller.value,
          ),
          child: const SizedBox(height: 22),
        );
      },
    );
  }
}

class _SocPainter extends CustomPainter {
  _SocPainter({required this.progress, required this.phase});

  final double progress;
  final double phase;

  @override
  void paint(Canvas canvas, Size size) {
    final rrect = RRect.fromRectAndRadius(
      Offset.zero & size,
      Radius.circular(size.height / 2),
    );
    final base = Paint()..color = const Color(0xFF071827);
    canvas.drawRRect(rrect, base);

    final activeWidth = math.max(size.height, size.width * progress);
    final activeRect = Rect.fromLTWH(0, 0, activeWidth, size.height);
    final activeRRect = RRect.fromRectAndRadius(
      activeRect,
      Radius.circular(size.height / 2),
    );
    final pulse = 0.5 + 0.5 * math.sin(phase * math.pi * 2);
    final wideGlow = Paint()
      ..color = const Color(0xFF22D3D7).withValues(alpha: 0.07 + pulse * 0.04)
      ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 14);
    canvas.drawRRect(activeRRect, wideGlow);

    final glow = Paint()
      ..color = Color.lerp(
        const Color(0xFF22D3D7),
        const Color(0xFF68F2A6),
        pulse,
      )!.withValues(alpha: 0.14 + pulse * 0.08)
      ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 8);
    canvas.drawRRect(activeRRect, glow);

    final fill = Paint()
      ..shader = const LinearGradient(
        colors: [Color(0xFF68F2A6), Color(0xFF22D3D7), Color(0xFF1D9BF0)],
      ).createShader(activeRect);
    canvas.drawRRect(activeRRect, fill);

    canvas.save();
    canvas.clipRRect(activeRRect);
    final sweepWidth = size.width * 0.28;
    final sweepX = -sweepWidth + (activeWidth + sweepWidth * 2) * phase;
    final sweepRect = Rect.fromLTWH(sweepX, 0, sweepWidth, size.height);
    final sweep = Paint()
      ..shader = LinearGradient(
        colors: [
          Colors.white.withValues(alpha: 0),
          Colors.white.withValues(alpha: 0.22),
          Colors.white.withValues(alpha: 0),
        ],
      ).createShader(sweepRect);
    canvas.drawRect(sweepRect, sweep);
    canvas.restore();

    final sparkX = (activeWidth - 16).clamp(10.0, size.width - 10);
    final spark = Paint()
      ..color = Colors.white.withValues(alpha: 0.18 + pulse * 0.18)
      ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 4);
    canvas.drawCircle(Offset(sparkX, size.height / 2), 3.4, spark);
  }

  @override
  bool shouldRepaint(covariant _SocPainter oldDelegate) {
    return oldDelegate.progress != progress || oldDelegate.phase != phase;
  }
}

class _InstallationDropdown extends StatelessWidget {
  const _InstallationDropdown({
    required this.selectedInstallationId,
    required this.installations,
    required this.onChanged,
  });

  final String selectedInstallationId;
  final List<_DriverInstallation> installations;
  final ValueChanged<String?> onChanged;

  @override
  Widget build(BuildContext context) {
    return DropdownButtonFormField<String>(
      initialValue: selectedInstallationId,
      dropdownColor: _BrandPalette.surface,
      iconEnabledColor: const Color(0xFF75EAF2),
      decoration: _dropdownDecoration(),
      style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w800),
      items: installations
          .map(
            (installation) => DropdownMenuItem(
              value: installation.id,
              child: Text(installation.name),
            ),
          )
          .toList(),
      onChanged: onChanged,
    );
  }
}

class _ChargerDropdown extends StatelessWidget {
  const _ChargerDropdown({
    required this.selectedCharger,
    required this.chargers,
    required this.onChanged,
  });

  final String selectedCharger;
  final List<_DriverCharger> chargers;
  final ValueChanged<String?> onChanged;

  @override
  Widget build(BuildContext context) {
    return DropdownButtonFormField<String>(
      initialValue: selectedCharger,
      dropdownColor: _BrandPalette.surface,
      iconEnabledColor: const Color(0xFF75EAF2),
      decoration: _dropdownDecoration(),
      style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w800),
      items: chargers
          .map(
            (charger) => DropdownMenuItem(
              value: charger.serial,
              child: Text('${charger.serial} - ${charger.status}'),
            ),
          )
          .toList(),
      /*
        DropdownMenuItem(
          value: _AppTruth.primaryCharger,
          child: Text(_AppTruth.primaryCharger),
        ),
        DropdownMenuItem(
          value: 'Heimahleðslutæki',
          child: Text('Heimahleðslutæki'),
        ),
        DropdownMenuItem(value: 'Ísorka 306', child: Text('Ísorka 306')),
      ],
*/
      onChanged: onChanged,
    );
  }
}

InputDecoration _dropdownDecoration() {
  return InputDecoration(
    filled: true,
    fillColor: _BrandPalette.deepNavy,
    contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 15),
    enabledBorder: OutlineInputBorder(
      borderRadius: BorderRadius.circular(18),
      borderSide: const BorderSide(color: _BrandPalette.border),
    ),
    focusedBorder: OutlineInputBorder(
      borderRadius: BorderRadius.circular(18),
      borderSide: const BorderSide(color: Color(0xFF22D3D7), width: 1.4),
    ),
  );
}

class _PricingPreview extends StatelessWidget {
  const _PricingPreview({required this.charger});

  final _DriverCharger charger;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: const Color(0xFF071827),
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: _BrandPalette.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Row(
            children: [
              Icon(Icons.payments_rounded, color: Color(0xFF75EAF2), size: 18),
              SizedBox(width: 8),
              Text(
                'Pricing preview',
                style: TextStyle(
                  color: Colors.white,
                  fontSize: 13,
                  fontWeight: FontWeight.w900,
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Text(
            charger.priceLabel,
            style: const TextStyle(
              color: Color(0xFFDDF7F7),
              fontSize: 13,
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              Expanded(
                child: Text(
                  charger.estimatedSessionCost,
                  style: const TextStyle(
                    color: _BrandPalette.mint,
                    fontSize: 16,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _ActiveSessionPanel extends StatelessWidget {
  const _ActiveSessionPanel({required this.session, required this.onStop});

  final _ActiveSession? session;
  final VoidCallback onStop;

  @override
  Widget build(BuildContext context) {
    final activeSession = session;
    if (activeSession == null) return const SizedBox.shrink();

    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: const Color(0xFF071827),
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: _BrandPalette.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              const Icon(
                Icons.electric_bolt_rounded,
                color: _BrandPalette.mint,
                size: 20,
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  activeSession.sessionId,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 13,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: _SessionFact(
                  label: 'Connector',
                  value: activeSession.charger.connectorId,
                ),
              ),
              const SizedBox(width: 12),
              _SessionFact(
                label: 'Energy',
                value: '${activeSession.energyKwh.toStringAsFixed(1)} kWh',
                alignRight: true,
              ),
            ],
          ),
          const SizedBox(height: 12),
          OutlinedButton.icon(
            onPressed: onStop,
            style: OutlinedButton.styleFrom(
              foregroundColor: const Color(0xFFFFB4A8),
              padding: const EdgeInsets.symmetric(vertical: 12),
              side: const BorderSide(color: Color(0xFF8A3E47)),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(16),
              ),
            ),
            icon: const Icon(Icons.stop_circle_rounded),
            label: const Text(
              'Stop charging',
              style: TextStyle(fontWeight: FontWeight.w900),
            ),
          ),
        ],
      ),
    );
  }
}

class _SessionFact extends StatelessWidget {
  const _SessionFact({
    required this.label,
    required this.value,
    this.alignRight = false,
  });

  final String label;
  final String value;
  final bool alignRight;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: alignRight
          ? CrossAxisAlignment.end
          : CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: const TextStyle(
            color: Color(0xFF8EA6B6),
            fontSize: 12,
            fontWeight: FontWeight.w700,
          ),
        ),
        const SizedBox(height: 4),
        Text(
          value,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(
            color: Color(0xFFEAF8FB),
            fontSize: 13,
            fontWeight: FontWeight.w900,
          ),
        ),
      ],
    );
  }
}

class _StartButton extends StatelessWidget {
  const _StartButton({required this.isCharging, required this.onPressed});

  final bool isCharging;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    final colors = isCharging
        ? const [Color(0xFF0E5164), Color(0xFF11849A)]
        : const [_BrandPalette.mint, _BrandPalette.cyan, _BrandPalette.blue];
    final icon = isCharging ? Icons.pause_circle_rounded : Icons.bolt_rounded;
    final foreground = isCharging
        ? const Color(0xFFEAF8FB)
        : _BrandPalette.midnight;
    return GestureDetector(
      key: const ValueKey('start-charge-button'),
      onTap: onPressed,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 220),
        width: 92,
        height: 92,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          gradient: LinearGradient(colors: colors),
          border: Border.all(
            color: isCharging
                ? const Color(0xFF75EAF2)
                : Colors.white.withValues(alpha: 0.24),
            width: 1.4,
          ),
          boxShadow: [
            BoxShadow(
              color: const Color(
                0xFF22D3D7,
              ).withValues(alpha: isCharging ? 0.28 : 0.38),
              blurRadius: isCharging ? 22 : 26,
              spreadRadius: isCharging ? 1 : 2,
            ),
          ],
        ),
        child: Icon(icon, color: foreground, size: 42),
      ),
    );
  }
}

class _PreparingChargeCard extends StatelessWidget {
  const _PreparingChargeCard({
    required this.selectedCharger,
    required this.heroImage,
    required this.hasIssue,
    required this.onReportIssue,
  });

  final String selectedCharger;
  final String heroImage;
  final bool hasIssue;
  final VoidCallback onReportIssue;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(22, 26, 22, 24),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(28),
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0xFF0D2A35), Color(0xFF0A1B2E)],
        ),
        border: Border.all(color: _BrandPalette.border),
        boxShadow: [
          BoxShadow(
            color: const Color(0xFF22D3D7).withValues(alpha: 0.12),
            blurRadius: 30,
            offset: const Offset(0, 16),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const SizedBox(height: 8),
          _PreparingChargeIllustration(heroImage: heroImage),
          const SizedBox(height: 24),
          const Text(
            'Undirbý hleðslu',
            textAlign: TextAlign.center,
            style: TextStyle(
              color: Colors.white,
              fontSize: 25,
              fontWeight: FontWeight.w900,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            selectedCharger,
            textAlign: TextAlign.center,
            style: const TextStyle(
              color: Color(0xFF8EA6B6),
              fontSize: 15,
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 24),
          const _CheckLine(label: 'Staðfesti aðgang'),
          const _CheckLine(label: 'Tengi við hleðslustöð'),
          _CheckLine(
            label: hasIssue
                ? 'Öryggispróf fann frávik'
                : 'Les stöðu og öryggispróf',
            issue: hasIssue,
          ),
          const Spacer(),
          FilledButton.icon(
            onPressed: onReportIssue,
            style: FilledButton.styleFrom(
              backgroundColor: hasIssue
                  ? const Color(0xFFFF3864)
                  : const Color(0xFF123246),
              foregroundColor: hasIssue
                  ? Colors.white
                  : const Color(0xFF75EAF2),
              padding: const EdgeInsets.symmetric(vertical: 16),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(18),
                side: BorderSide(
                  color: hasIssue
                      ? const Color(0xFFFF7391)
                      : _BrandPalette.border,
                ),
              ),
            ),
            icon: Icon(
              hasIssue ? Icons.report_problem_rounded : Icons.flag_outlined,
            ),
            label: Text(
              hasIssue ? 'Tilkynna mál' : 'Tilkynna vandamál',
              style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w900),
            ),
          ),
          if (!hasIssue) ...[
            const SizedBox(height: 10),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
              decoration: BoxDecoration(
                color: _BrandPalette.deepNavy,
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: _BrandPalette.border),
              ),
              child: const Text(
                'Pikkaðu á skjáinn þegar prófun er lokið',
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: Color(0xFFB8D2DE),
                  fontSize: 14,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _PreparingChargeIllustration extends StatefulWidget {
  const _PreparingChargeIllustration({required this.heroImage});

  final String heroImage;

  @override
  State<_PreparingChargeIllustration> createState() =>
      _PreparingChargeIllustrationState();
}

class _PreparingChargeIllustrationState
    extends State<_PreparingChargeIllustration>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 2400),
    )..repeat();
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 178,
      child: AnimatedBuilder(
        animation: _controller,
        builder: (context, _) {
          return CustomPaint(
            painter: const _PreparingChargeBackgroundPainter(),
            foregroundPainter: _PreparingChargePainter(
              phase: _controller.value,
            ),
            child: Stack(
              children: [
                Positioned(
                  left: 4,
                  right: 82,
                  bottom: 12,
                  top: 42,
                  child: Image.asset(
                    widget.heroImage,
                    fit: BoxFit.contain,
                    filterQuality: FilterQuality.high,
                  ),
                ),
              ],
            ),
          );
        },
      ),
    );
  }
}

class _PreparingChargeBackgroundPainter extends CustomPainter {
  const _PreparingChargeBackgroundPainter();

  @override
  void paint(Canvas canvas, Size size) {
    final bgRect = RRect.fromRectAndRadius(
      Rect.fromLTWH(0, 10, size.width, size.height - 20),
      const Radius.circular(24),
    );
    canvas.drawRRect(
      bgRect,
      Paint()
        ..shader = const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0xFF0A2132), Color(0xFF061827)],
        ).createShader(bgRect.outerRect),
    );

    final aurora = Paint()
      ..shader =
          RadialGradient(
            colors: [
              const Color(0xFF22D3D7).withValues(alpha: 0.18),
              const Color(0xFF68F2A6).withValues(alpha: 0.08),
              Colors.transparent,
            ],
          ).createShader(
            Rect.fromCircle(
              center: Offset(size.width * 0.58, size.height * 0.46),
              radius: size.width * 0.48,
            ),
          );
    canvas.drawRRect(bgRect, aurora);

    canvas.drawOval(
      Rect.fromCenter(
        center: Offset(size.width * 0.43, size.height * 0.78),
        width: size.width * 0.64,
        height: size.height * 0.14,
      ),
      Paint()
        ..color = Colors.black.withValues(alpha: 0.24)
        ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 10),
    );
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}

class _PreparingChargePainter extends CustomPainter {
  _PreparingChargePainter({required this.phase});

  final double phase;

  @override
  void paint(Canvas canvas, Size size) {
    final cyan = const Color(0xFF22D3D7);
    final green = const Color(0xFF68F2A6);
    final blue = const Color(0xFF1D9BF0);
    final muted = const Color(0xFF244B62);
    final glowPulse = 0.5 + 0.5 * math.sin(phase * math.pi * 2);

    final centerY = size.height * 0.58;
    final carLeft = size.width * 0.12;
    final carTop = size.height * 0.46;
    final carWidth = size.width * 0.44;
    final carHeight = size.height * 0.26;
    final chargerX = size.width * 0.78;
    final chargerTop = size.height * 0.25;
    final chargerWidth = size.width * 0.12;
    final chargerHeight = size.height * 0.48;

    final cableStart = Offset(carLeft + carWidth * 0.82, centerY + 9);
    final cableEnd = Offset(chargerX, centerY - 2);
    final cablePath = Path()
      ..moveTo(cableStart.dx, cableStart.dy)
      ..cubicTo(
        size.width * 0.58,
        size.height * 0.84,
        size.width * 0.69,
        size.height * 0.3,
        cableEnd.dx,
        cableEnd.dy,
      );

    final cableBase = Paint()
      ..color = muted
      ..style = PaintingStyle.stroke
      ..strokeWidth = 5
      ..strokeCap = StrokeCap.round;
    canvas.drawPath(cablePath, cableBase);

    final cableGlow = Paint()
      ..shader = LinearGradient(colors: [green, cyan, blue]).createShader(
        Rect.fromLTWH(carLeft, carTop, chargerX - carLeft, carHeight),
      )
      ..style = PaintingStyle.stroke
      ..strokeWidth = 3.4
      ..strokeCap = StrokeCap.round
      ..maskFilter = MaskFilter.blur(BlurStyle.normal, 3 + glowPulse * 2.2);
    canvas.drawPath(cablePath, cableGlow);

    final metric = cablePath.computeMetrics().first;
    for (var i = 0; i < 4; i++) {
      final t = (phase + i * 0.25) % 1;
      final tangent = metric.getTangentForOffset(metric.length * t);
      if (tangent == null) continue;
      final alpha = math.sin(t * math.pi).clamp(0.0, 1.0);
      final pulsePaint = Paint()
        ..color = Color.lerp(green, cyan, t)!.withValues(alpha: 0.24 * alpha)
        ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 8);
      canvas.drawCircle(tangent.position, 7, pulsePaint);
      canvas.drawCircle(
        tangent.position,
        2.6,
        Paint()..color = Colors.white.withValues(alpha: 0.5 * alpha),
      );
    }

    _drawCharger(
      canvas,
      Rect.fromLTWH(chargerX, chargerTop, chargerWidth, chargerHeight),
      phase,
    );
    _drawCheckNode(
      canvas,
      Offset(size.width * 0.31, size.height * 0.26),
      'ID',
      phase,
      0,
    );
    _drawCheckNode(
      canvas,
      Offset(size.width * 0.52, size.height * 0.2),
      'OK',
      phase,
      0.22,
    );
    _drawCheckNode(
      canvas,
      Offset(size.width * 0.66, size.height * 0.28),
      'V',
      phase,
      0.44,
    );
  }

  void _drawCharger(Canvas canvas, Rect rect, double phase) {
    final rrect = RRect.fromRectAndRadius(rect, const Radius.circular(12));
    canvas.drawRRect(
      rrect.inflate(5),
      Paint()
        ..color = const Color(0xFF22D3D7).withValues(alpha: 0.15)
        ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 14),
    );
    canvas.drawRRect(
      rrect,
      Paint()
        ..shader = const LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [Color(0xFF103A46), Color(0xFF081D2C)],
        ).createShader(rect),
    );
    canvas.drawRRect(
      rrect,
      Paint()
        ..color = const Color(0xFF75EAF2).withValues(alpha: 0.88)
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1.6,
    );
    final screen = RRect.fromRectAndRadius(
      Rect.fromLTWH(
        rect.left + rect.width * 0.22,
        rect.top + rect.height * 0.15,
        rect.width * 0.56,
        rect.height * 0.22,
      ),
      const Radius.circular(5),
    );
    canvas.drawRRect(
      screen,
      Paint()..color = const Color(0xFF68F2A6).withValues(alpha: 0.85),
    );
    canvas.drawLine(
      Offset(rect.left + rect.width * 0.28, rect.top + rect.height * 0.47),
      Offset(rect.left + rect.width * 0.72, rect.top + rect.height * 0.47),
      Paint()
        ..color = const Color(0xFF75EAF2).withValues(alpha: 0.45)
        ..strokeWidth = 2
        ..strokeCap = StrokeCap.round,
    );
    canvas.drawCircle(
      Offset(rect.center.dx, rect.top + rect.height * 0.58),
      rect.width * 0.16,
      Paint()
        ..color = const Color(
          0xFF22D3D7,
        ).withValues(alpha: 0.35 + 0.25 * math.sin(phase * math.pi * 2))
        ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 4),
    );
  }

  void _drawCheckNode(
    Canvas canvas,
    Offset center,
    String label,
    double phase,
    double delay,
  ) {
    final t = ((phase - delay) % 1).clamp(0.0, 1.0);
    final pulse = 0.5 + 0.5 * math.sin(t * math.pi * 2);
    canvas.drawCircle(
      center,
      15.5,
      Paint()
        ..color = const Color(0xFF22D3D7).withValues(alpha: 0.1 + pulse * 0.07)
        ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 7),
    );
    canvas.drawCircle(center, 12, Paint()..color = const Color(0xFF123246));
    canvas.drawCircle(
      center,
      12,
      Paint()
        ..color = const Color(0xFF75EAF2).withValues(alpha: 0.88)
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1.2,
    );

    final textPainter = TextPainter(
      text: TextSpan(
        text: label,
        style: const TextStyle(
          color: Color(0xFFEAF8FB),
          fontSize: 8.5,
          fontWeight: FontWeight.w900,
          letterSpacing: 0,
        ),
      ),
      textDirection: TextDirection.ltr,
    )..layout();
    textPainter.paint(canvas, center - Offset(textPainter.width / 2, 5));
  }

  @override
  bool shouldRepaint(covariant _PreparingChargePainter oldDelegate) {
    return oldDelegate.phase != phase;
  }
}

class _CheckLine extends StatelessWidget {
  const _CheckLine({required this.label, this.issue = false});

  final String label;
  final bool issue;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Row(
        children: [
          Container(
            width: 26,
            height: 26,
            decoration: BoxDecoration(
              color: issue ? const Color(0xFF3A1421) : const Color(0xFF123246),
              borderRadius: BorderRadius.circular(9),
              border: Border.all(
                color: issue
                    ? const Color(0xFFFF5D80)
                    : const Color(0xFF22D3D7),
              ),
            ),
            child: Icon(
              issue ? Icons.priority_high_rounded : Icons.check_rounded,
              color: issue ? const Color(0xFFFF5D80) : const Color(0xFF68F2A6),
              size: 18,
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Text(
              label,
              style: const TextStyle(
                color: Color(0xFFEAF8FB),
                fontSize: 15,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _SegmentField extends StatelessWidget {
  const _SegmentField({required this.isCharging, required this.isPreparing});

  final bool isCharging;
  final bool isPreparing;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: _BrandPalette.surface,
        borderRadius: BorderRadius.circular(24),
        border: Border.all(color: _BrandPalette.border),
      ),
      child: Column(
        children: [
          Row(
            children: [
              _TabButton(label: 'Hleðslusaga', active: true),
              _TabButton(label: 'Tilkynna mál', active: false),
            ],
          ),
          Container(
            width: double.infinity,
            padding: const EdgeInsets.fromLTRB(16, 14, 16, 16),
            decoration: const BoxDecoration(
              color: Color(0xFF071B28),
              borderRadius: BorderRadius.vertical(bottom: Radius.circular(24)),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _CdrMonthTotalRow(
                  sessions: isCharging ? '4 lotur + virk' : '4 lotur',
                ),
                const SizedBox(height: 10),
                if (isPreparing)
                  const _CdrRow(
                    title: 'Í gangi',
                    subtitle: '${_AppTruth.primaryCharger} • forprófun',
                    energy: '--',
                    cost: '--',
                    time: 'núna',
                    active: true,
                  )
                else if (isCharging)
                  const _CdrRow(
                    title: 'Í gangi',
                    subtitle:
                        '${_AppTruth.primaryCharger} • ${_AppTruth.primaryPlate}',
                    energy: '5.2 kWh',
                    cost: '312 kr.',
                    time: '42 mín',
                    active: true,
                  ),
                const _CdrRow(
                  title: '28. apr',
                  subtitle:
                      '${_AppTruth.primaryCharger} • ${_AppTruth.primaryPlate}',
                  energy: '18.6 kWh',
                  cost: '1.116 kr.',
                  time: '2:14',
                ),
                const _CdrRow(
                  title: '22. apr',
                  subtitle:
                      '${_AppTruth.installationName} • ${_AppTruth.primaryPlate}',
                  energy: '11.8 kWh',
                  cost: '708 kr.',
                  time: '1:36',
                ),
                const _CdrRow(
                  title: '14. apr',
                  subtitle: 'Almenn stöð • IS 306',
                  energy: '28.4 kWh',
                  cost: '2.272 kr.',
                  time: '0:48',
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _TabButton extends StatelessWidget {
  const _TabButton({required this.label, required this.active});

  final String label;
  final bool active;

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Container(
        height: 54,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: active ? const Color(0xFF0E2A34) : Colors.transparent,
          borderRadius: const BorderRadius.vertical(top: Radius.circular(24)),
        ),
        child: Text(
          label,
          style: TextStyle(
            color: active ? const Color(0xFF75EAF2) : const Color(0xFF8EA6B6),
            fontWeight: FontWeight.w800,
            fontSize: 14,
          ),
        ),
      ),
    );
  }
}

class _CdrMonthTotalRow extends StatelessWidget {
  const _CdrMonthTotalRow({required this.sessions});

  final String sessions;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(
        color: const Color(0xFF0B2A35),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: _BrandPalette.border.withValues(alpha: 0.8)),
      ),
      child: Row(
        children: [
          const Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Þessi mánuður',
                  style: TextStyle(
                    color: Colors.white,
                    fontSize: 15,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                SizedBox(height: 2),
                Text(
                  '63.9 kWh • 4.408 kr.',
                  style: TextStyle(color: _BrandPalette.muted, fontSize: 13),
                ),
              ],
            ),
          ),
          Text(
            sessions,
            style: const TextStyle(
              color: _BrandPalette.cyan,
              fontSize: 13,
              fontWeight: FontWeight.w900,
            ),
          ),
        ],
      ),
    );
  }
}

class _CdrRow extends StatelessWidget {
  const _CdrRow({
    required this.title,
    required this.subtitle,
    required this.energy,
    required this.cost,
    required this.time,
    this.active = false,
  });

  final String title;
  final String subtitle;
  final String energy;
  final String cost;
  final String time;
  final bool active;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 10),
      decoration: BoxDecoration(
        border: Border(
          bottom: BorderSide(
            color: _BrandPalette.border.withValues(alpha: 0.36),
          ),
        ),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: TextStyle(
                    color: active ? _BrandPalette.cyan : Colors.white,
                    fontSize: 14,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  subtitle,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: _BrandPalette.muted,
                    fontSize: 12,
                    fontWeight: FontWeight.w500,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: 10),
          Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Text(
                energy,
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 13,
                  fontWeight: FontWeight.w900,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                '$cost • $time',
                style: const TextStyle(
                  color: _BrandPalette.muted,
                  fontSize: 11,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
          if (active) ...[
            const SizedBox(width: 8),
            Container(
              width: 7,
              height: 7,
              decoration: const BoxDecoration(
                color: _BrandPalette.mint,
                shape: BoxShape.circle,
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class LoginScreen extends StatefulWidget {
  const LoginScreen({
    super.key,
    required this.api,
    required this.onAuthenticated,
  });

  final StraumvaktApi api;
  final ValueChanged<LoginResult> onAuthenticated;

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();
  bool _submitting = false;
  String? _errorMessage;

  @override
  void dispose() {
    _emailController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final email = _emailController.text.trim();
    final password = _passwordController.text;
    if (email.isEmpty || password.isEmpty) {
      setState(() => _errorMessage = 'Sláðu inn netfang og lykilorð.');
      return;
    }
    setState(() {
      _submitting = true;
      _errorMessage = null;
    });
    try {
      final result = await widget.api.login(email, password);
      if (!mounted) return;
      widget.onAuthenticated(result);
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() => _errorMessage = e.message);
    } on TimeoutException {
      if (!mounted) return;
      setState(() => _errorMessage = 'Tenging tókst ekki — reyndu aftur.');
    } catch (e) {
      if (!mounted) return;
      setState(() => _errorMessage = 'Óvænt villa: $e');
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: _BrandPalette.midnight,
      // Default true, but make it explicit — Scaffold needs to shrink
      // the body when the soft keyboard appears so the scroll view
      // can scroll the password field into view.
      resizeToAvoidBottomInset: true,
      body: SafeArea(
        child: SingleChildScrollView(
          physics: const ClampingScrollPhysics(),
          padding: const EdgeInsets.all(24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const SizedBox(height: 48),
              Center(
                child: Container(
                  height: 286,
                  padding: const EdgeInsets.symmetric(horizontal: 4),
                  child: const _LogoWordmark(),
                ),
              ),
              const SizedBox(height: 34),
              TextField(
                controller: _emailController,
                enabled: !_submitting,
                keyboardType: TextInputType.emailAddress,
                autocorrect: false,
                autofillHints: const [AutofillHints.email],
                textInputAction: TextInputAction.next,
                style: const TextStyle(color: Colors.white),
                decoration: _loginInputDecoration(
                  label: 'Netfang',
                  icon: Icons.mail_outline_rounded,
                ),
              ),
              const SizedBox(height: 14),
              TextField(
                controller: _passwordController,
                enabled: !_submitting,
                obscureText: true,
                autocorrect: false,
                autofillHints: const [AutofillHints.password],
                textInputAction: TextInputAction.done,
                onSubmitted: (_) => _submit(),
                style: const TextStyle(color: Colors.white),
                decoration: _loginInputDecoration(
                  label: 'Lykilorð',
                  icon: Icons.lock_outline_rounded,
                ),
              ),
              if (_errorMessage != null) ...[
                const SizedBox(height: 14),
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 14,
                    vertical: 10,
                  ),
                  decoration: BoxDecoration(
                    color: const Color(0xFF3A1620),
                    borderRadius: BorderRadius.circular(14),
                    border: Border.all(color: const Color(0xFFFF6B8A)),
                  ),
                  child: Row(
                    children: [
                      const Icon(
                        Icons.error_outline_rounded,
                        color: Color(0xFFFF8FA3),
                        size: 18,
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          _errorMessage!,
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
              const SizedBox(height: 24),
              FilledButton.icon(
                onPressed: _submitting ? null : _submit,
                style: FilledButton.styleFrom(
                  backgroundColor: _BrandPalette.cyan,
                  foregroundColor: _BrandPalette.midnight,
                  padding: const EdgeInsets.symmetric(vertical: 17),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(18),
                  ),
                ),
                icon: _submitting
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
                  _submitting ? 'Skrái inn…' : 'Skrá inn',
                  style: const TextStyle(
                    fontSize: 17,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ),
              const SizedBox(height: 14),
              TextButton(
                onPressed: _submitting ? null : () {},
                child: const Text('Gleymt lykilorð?'),
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
              const SizedBox(height: 48),
            ],
          ),
        ),
      ),
    );
  }

  InputDecoration _loginInputDecoration({
    required String label,
    required IconData icon,
  }) {
    return InputDecoration(
      labelText: label,
      prefixIcon: Icon(icon),
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
    );
  }
}

// ignore: unused_element
class _ProfileScreen extends StatelessWidget {
  const _ProfileScreen({required this.onLogout});

  final VoidCallback onLogout;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: _BrandPalette.midnight,
      appBar: AppBar(
        backgroundColor: _BrandPalette.midnight,
        actions: const [
          Padding(
            padding: EdgeInsets.only(right: 16),
            child: _LogoMark(size: 36, borderRadius: 12),
          ),
        ],
        title: const Text('Prófíll'),
      ),
      body: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              _AppTruth.driverName,
              style: TextStyle(fontSize: 28, fontWeight: FontWeight.w900),
            ),
            const SizedBox(height: 10),
            const Text(
              'Notendastillingar, RFID auðkenni og reikningsstillingar birtast hér.',
              style: TextStyle(color: Color(0xFFB8D2DE), fontSize: 16),
            ),
            const SizedBox(height: 28),
            SizedBox(
              width: double.infinity,
              child: FilledButton.icon(
                onPressed: () {
                  Navigator.of(context).pop();
                  onLogout();
                },
                style: FilledButton.styleFrom(
                  backgroundColor: const Color(0xFFFF3864),
                  foregroundColor: Colors.white,
                  padding: const EdgeInsets.symmetric(vertical: 16),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(18),
                  ),
                ),
                icon: const Icon(Icons.logout_rounded),
                label: const Text(
                  'Skrá út',
                  style: TextStyle(fontSize: 16, fontWeight: FontWeight.w800),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _RichProfileScreen extends StatefulWidget {
  const _RichProfileScreen({required this.onLogout});

  final VoidCallback onLogout;

  @override
  State<_RichProfileScreen> createState() => _RichProfileScreenState();
}

class _RichProfileScreenState extends State<_RichProfileScreen> {
  final _bleTapService = _BleTapService();
  final List<_LinkedRfidToken> _linkedTokens = [
    const _LinkedRfidToken(
      label: 'N1 driver token',
      idTag: _AppTruth.primaryIdTag,
      charger: _AppTruth.primaryCharger,
    ),
  ];

  Future<void> _openRfidWizard() async {
    final token = await Navigator.of(context).push<_LinkedRfidToken>(
      MaterialPageRoute<_LinkedRfidToken>(
        builder: (_) => const _RfidTokenWizardScreen(),
      ),
    );

    if (token == null) return;
    setState(() {
      _linkedTokens.removeWhere((existing) => existing.idTag == token.idTag);
      _linkedTokens.add(token);
    });
  }

  Future<void> _openPhoneTap() async {
    await showModalBottomSheet<_BleTapResult>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (context) => _BleTapSheet(service: _bleTapService),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: _BrandPalette.midnight,
      appBar: AppBar(
        backgroundColor: _BrandPalette.midnight,
        surfaceTintColor: Colors.transparent,
        centerTitle: false,
        titleSpacing: 0,
        title: const Text(
          'Menu',
          style: TextStyle(fontWeight: FontWeight.w900),
        ),
      ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 6, 16, 22),
          children: [
            _ProfileAccountHeader(linkedTokenCount: _linkedTokens.length),
            const SizedBox(height: 12),
            _ProfileQuickActions(
              onAddRfid: _openRfidWizard,
              onPhoneTap: _openPhoneTap,
            ),
            const SizedBox(height: 14),
            const _ProfileGroupLabel('Profile'),
            const _ProfileSectionCard(
              icon: Icons.person_outline_rounded,
              title: 'Personal information',
              initiallyExpanded: true,
              children: [
                _ProfileInfoTile(
                  icon: Icons.person_outline_rounded,
                  title: 'Name',
                  subtitle:
                      '${_AppTruth.driverName} • identity.users.display_name',
                  trailing: 'active',
                ),
                _ProfileInfoTile(
                  icon: Icons.email_outlined,
                  title: 'Email',
                  subtitle: _AppTruth.driverEmail,
                ),
                _ProfileInfoTile(
                  icon: Icons.phone_iphone_rounded,
                  title: 'Phone and language',
                  subtitle: '+354 770 4280 • is',
                ),
                _ProfileInfoTile(
                  icon: Icons.fingerprint_rounded,
                  title: 'Kennitala',
                  subtitle:
                      'Optional pilot field • captured by admin when known',
                ),
              ],
            ),
            const SizedBox(height: 14),
            const _ProfileSectionCard(
              icon: Icons.badge_outlined,
              title: 'Driver profile',
              initiallyExpanded: true,
              children: [
                _ProfileInfoTile(
                  icon: Icons.badge_outlined,
                  title: 'Driver record',
                  subtitle: 'Admin-created identity.users row',
                  trailing: 'driver',
                ),
                _ProfileInfoTile(
                  icon: Icons.business_rounded,
                  title: 'Organization membership',
                  subtitle:
                      'N1 • source audience=${_AppTruth.sourceAudience} • app=${_AppTruth.appAudience}',
                ),
                _ProfileInfoTile(
                  icon: Icons.verified_user_outlined,
                  title: 'Pilot access model',
                  subtitle: 'No signup, no invite email, no self-onboarding',
                ),
              ],
            ),
            const SizedBox(height: 10),
            const _ProfileGroupLabel('Access'),
            _ProfileSectionCard(
              icon: Icons.nfc_rounded,
              title: 'RFID and charger access',
              children: [
                _ProfileInfoTile(
                  icon: Icons.bluetooth_searching_rounded,
                  title: 'Phone tap',
                  subtitle:
                      '${_AppTruth.phoneTapCredentialRef} â€¢ BLE reader handshake',
                  trailing: 'BLE',
                  onTap: _openPhoneTap,
                ),
                _ProfileInfoTile(
                  icon: Icons.add_card_rounded,
                  title: 'Add RFID token',
                  subtitle: 'Verify by presenting the same token 3 times',
                  trailing: 'New',
                  onTap: _openRfidWizard,
                ),
                ..._linkedTokens.map(
                  (token) => _ProfileInfoTile(
                    icon: Icons.nfc_rounded,
                    title: token.label,
                    subtitle: '${token.idTag} • ${token.charger}',
                    trailing: 'RFID',
                  ),
                ),
                _ProfileInfoTile(
                  icon: Icons.ev_station_outlined,
                  title: 'Authorize path',
                  subtitle: 'Card presented • OCPP Authorize • user resolved',
                ),
                _ProfileInfoTile(
                  icon: Icons.link_rounded,
                  title: 'System table',
                  subtitle:
                      'identity.id_tokens.value → ${_AppTruth.primaryIdTag}',
                ),
              ],
            ),
            const _ProfileSectionCard(
              icon: Icons.lock_outline_rounded,
              title: 'Security and privacy',
              children: [
                _ProfileInfoTile(
                  icon: Icons.lock_outline_rounded,
                  title: 'Credentials',
                  subtitle: 'Pilot driver record may have credentials null',
                  trailing: 'pilot',
                ),
                _ProfileInfoTile(
                  icon: Icons.manage_accounts_outlined,
                  title: 'Profile ownership',
                  subtitle: 'Changes are handled in the operator admin console',
                ),
                _ProfileInfoTile(
                  icon: Icons.privacy_tip_outlined,
                  title: 'Personal data fields',
                  subtitle:
                      'Email, phone, locale, notes, and optional kennitala',
                ),
              ],
            ),
            const SizedBox(height: 10),
            const _ProfileGroupLabel('Activity'),
            const _ProfileSectionCard(
              icon: Icons.bolt_rounded,
              title: 'Charging context',
              children: [
                _ProfileInfoTile(
                  icon: Icons.directions_car_filled_outlined,
                  title: 'Demo vehicle',
                  subtitle:
                      '${_AppTruth.primaryPlate} • 63.9 kWh shown in charging flow',
                ),
                _ProfileInfoTile(
                  icon: Icons.bolt_rounded,
                  title: 'Default site asset',
                  subtitle:
                      '${_AppTruth.primaryCharger} • ${_AppTruth.installationName}',
                ),
                _ProfileInfoTile(
                  icon: Icons.history_rounded,
                  title: 'Session projection',
                  subtitle: '42 mín • 312 kr. from latest mock session',
                ),
              ],
            ),
            const SizedBox(height: 14),
            _ProfileLogoutRow(onLogout: widget.onLogout),
          ],
        ),
      ),
    );
  }
}

class _LinkedRfidToken {
  const _LinkedRfidToken({
    required this.label,
    required this.idTag,
    required this.charger,
  });

  final String label;
  final String idTag;
  final String charger;
}

class _ProfileAccountHeader extends StatelessWidget {
  const _ProfileAccountHeader({required this.linkedTokenCount});

  final int linkedTokenCount;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: const Color(0xFF071724),
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: const Color(0xFF17394B)),
      ),
      child: Row(
        children: [
          Stack(
            clipBehavior: Clip.none,
            children: [
              Container(
                width: 66,
                height: 66,
                padding: const EdgeInsets.all(2),
                decoration: const BoxDecoration(
                  shape: BoxShape.circle,
                  gradient: LinearGradient(
                    colors: [_BrandPalette.mint, _BrandPalette.blue],
                  ),
                ),
                child: Container(
                  decoration: const BoxDecoration(
                    color: _BrandPalette.midnight,
                    shape: BoxShape.circle,
                  ),
                  child: const Center(
                    child: Text(
                      'N1',
                      style: TextStyle(
                        color: Colors.white,
                        fontSize: 20,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                  ),
                ),
              ),
              const Positioned(
                right: -2,
                bottom: 2,
                child: _ProfileOnlineDot(),
              ),
            ],
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  _AppTruth.driverName,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    color: Colors.white,
                    fontSize: 21,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(height: 3),
                const Text(
                  '${_AppTruth.driverEmail} • ${_AppTruth.appAudience} test mode',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    color: _BrandPalette.muted,
                    fontSize: 13,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 10),
                Wrap(
                  spacing: 7,
                  runSpacing: 7,
                  children: [
                    const _ProfileMiniPill(label: 'active'),
                    const _ProfileMiniPill(label: 'is'),
                    _ProfileMiniPill(label: '$linkedTokenCount RFID'),
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          const _LogoMark(size: 42, borderRadius: 14),
        ],
      ),
    );
  }
}

class _ProfileOnlineDot extends StatelessWidget {
  const _ProfileOnlineDot();

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 17,
      height: 17,
      decoration: BoxDecoration(
        color: _BrandPalette.mint,
        shape: BoxShape.circle,
        border: Border.all(color: _BrandPalette.midnight, width: 3),
      ),
    );
  }
}

class _ProfileQuickActions extends StatelessWidget {
  const _ProfileQuickActions({
    required this.onAddRfid,
    required this.onPhoneTap,
  });

  final VoidCallback onAddRfid;
  final VoidCallback onPhoneTap;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(
          child: _ProfileActionPill(
            icon: Icons.qr_code_2_rounded,
            label: 'Add RFID',
            onTap: onAddRfid,
          ),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: _ProfileActionPill(
            icon: Icons.bluetooth_searching_rounded,
            label: 'Phone tap',
            onTap: onPhoneTap,
          ),
        ),
        const SizedBox(width: 8),
        const Expanded(
          child: _ProfileActionPill(
            icon: Icons.lock_outline_rounded,
            label: 'Privacy',
          ),
        ),
      ],
    );
  }
}

class _ProfileActionPill extends StatelessWidget {
  const _ProfileActionPill({
    required this.icon,
    required this.label,
    this.onTap,
  });

  final IconData icon;
  final String label;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      borderRadius: BorderRadius.circular(14),
      onTap: onTap,
      child: Container(
        height: 44,
        decoration: BoxDecoration(
          color: const Color(0xFF0B2130),
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: const Color(0xFF17394B)),
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(icon, color: const Color(0xFF75EAF2), size: 18),
            const SizedBox(width: 7),
            Flexible(
              child: Text(
                label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 12,
                  fontWeight: FontWeight.w900,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ProfileGroupLabel extends StatelessWidget {
  const _ProfileGroupLabel(this.label);

  final String label;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(4, 10, 4, 7),
      child: Text(
        label,
        style: const TextStyle(
          color: _BrandPalette.muted,
          fontSize: 12,
          fontWeight: FontWeight.w900,
        ),
      ),
    );
  }
}

class _ProfileMiniPill extends StatelessWidget {
  const _ProfileMiniPill({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 5),
      decoration: BoxDecoration(
        color: const Color(0xFF0B2130),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: const Color(0xFF24536A)),
      ),
      child: Text(
        label,
        style: const TextStyle(
          color: Color(0xFF75EAF2),
          fontSize: 11,
          fontWeight: FontWeight.w900,
        ),
      ),
    );
  }
}

class _ProfileLogoutRow extends StatelessWidget {
  const _ProfileLogoutRow({required this.onLogout});

  final VoidCallback onLogout;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      borderRadius: BorderRadius.circular(17),
      onTap: () {
        Navigator.of(context).pop();
        onLogout();
      },
      child: Container(
        height: 56,
        padding: const EdgeInsets.symmetric(horizontal: 14),
        decoration: BoxDecoration(
          color: const Color(0xFF160B16),
          borderRadius: BorderRadius.circular(17),
          border: Border.all(color: const Color(0xFF54304B)),
        ),
        child: const Row(
          children: [
            Icon(Icons.logout_rounded, color: Color(0xFFFF5D80), size: 22),
            SizedBox(width: 13),
            Expanded(
              child: Text(
                'Skrá út',
                style: TextStyle(
                  color: Color(0xFFFF5D80),
                  fontSize: 15,
                  fontWeight: FontWeight.w900,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _RfidTokenWizardScreen extends StatefulWidget {
  const _RfidTokenWizardScreen();

  @override
  State<_RfidTokenWizardScreen> createState() => _RfidTokenWizardScreenState();
}

class _RfidTokenWizardScreenState extends State<_RfidTokenWizardScreen> {
  static const _chargers = ['N1 742', 'Heimahleðslutæki', 'Ísorka 306'];
  static const _codesByCharger = {
    'Heimahleðslutæki': 'RFID-SV-4287',
    'N1 742': _AppTruth.primaryIdTag,
    'Ísorka 306': 'RFID-IS-3060',
  };

  final List<String> _reads = [];
  String _selectedCharger = _chargers.first;
  String _tokenLabel = 'N1 driver token';
  String? _message;

  String get _expectedCode => _codesByCharger[_selectedCharger]!;
  bool get _isAccepted =>
      _reads.length == 3 && _reads.every((read) => read == _reads.first);

  void _readToken({bool mismatch = false}) {
    final code = mismatch
        ? 'RFID-MISMATCH-${_reads.length + 1}'
        : _expectedCode;
    setState(() {
      if (_reads.isNotEmpty && code != _reads.first) {
        _reads
          ..clear()
          ..add(code);
        _message =
            'Different RFID detected. Verification restarted from read 1.';
        return;
      }

      if (_reads.length < 3) {
        _reads.add(code);
      }
      _message = _isAccepted
          ? 'RFID verified. The same idTag was read 3 times.'
          : 'Read ${_reads.length}/3 captured. Present the same token again.';
    });
  }

  void _linkToken() {
    if (!_isAccepted) return;
    Navigator.of(context).pop(
      _LinkedRfidToken(
        label: _tokenLabel.trim().isEmpty ? 'RFID token' : _tokenLabel.trim(),
        idTag: _reads.first,
        charger: _selectedCharger,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final progress = _reads.length / 3;

    return Scaffold(
      backgroundColor: _BrandPalette.midnight,
      appBar: AppBar(
        backgroundColor: _BrandPalette.midnight,
        surfaceTintColor: Colors.transparent,
        title: const Text(
          'Add RFID token',
          style: TextStyle(fontWeight: FontWeight.w900),
        ),
      ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 22),
          children: [
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: const Color(0xFF071724),
                borderRadius: BorderRadius.circular(20),
                border: Border.all(color: const Color(0xFF17394B)),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Row(
                    children: [
                      _LogoMark(size: 42, borderRadius: 14),
                      SizedBox(width: 12),
                      Expanded(
                        child: Text(
                          'Verify token with charger',
                          style: TextStyle(
                            color: Colors.white,
                            fontSize: 20,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  const Text(
                    'Ask the driver to present the chosen RFID token to the selected charger three times. Straumvakt links the idTag only when all reads match.',
                    style: TextStyle(
                      color: _BrandPalette.muted,
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                      height: 1.35,
                    ),
                  ),
                  const SizedBox(height: 16),
                  LinearProgressIndicator(
                    value: progress,
                    minHeight: 7,
                    borderRadius: BorderRadius.circular(999),
                    backgroundColor: const Color(0xFF0B2130),
                    color: _isAccepted
                        ? _BrandPalette.mint
                        : _BrandPalette.cyan,
                  ),
                ],
              ),
            ),
            const SizedBox(height: 14),
            _WizardPanel(
              child: Column(
                children: [
                  TextFormField(
                    initialValue: _tokenLabel,
                    onChanged: (value) => _tokenLabel = value,
                    decoration: _wizardDecoration(
                      label: 'Token label',
                      icon: Icons.label_outline_rounded,
                    ),
                  ),
                  const SizedBox(height: 12),
                  DropdownButtonFormField<String>(
                    initialValue: _selectedCharger,
                    decoration: _wizardDecoration(
                      label: 'Verification charger',
                      icon: Icons.ev_station_outlined,
                    ),
                    dropdownColor: _BrandPalette.surface,
                    items: _chargers
                        .map(
                          (charger) => DropdownMenuItem<String>(
                            value: charger,
                            child: Text(charger),
                          ),
                        )
                        .toList(),
                    onChanged: (value) {
                      if (value == null) return;
                      setState(() {
                        _selectedCharger = value;
                        _reads.clear();
                        _message = 'Charger changed. Verification reset.';
                      });
                    },
                  ),
                ],
              ),
            ),
            const SizedBox(height: 14),
            _WizardPanel(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'Read sequence',
                    style: TextStyle(
                      color: Colors.white,
                      fontSize: 16,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                  const SizedBox(height: 12),
                  for (var index = 0; index < 3; index++) ...[
                    _RfidReadStep(
                      number: index + 1,
                      code: index < _reads.length ? _reads[index] : null,
                      active: index == _reads.length && !_isAccepted,
                    ),
                    if (index < 2) const SizedBox(height: 8),
                  ],
                  if (_message != null) ...[
                    const SizedBox(height: 14),
                    Text(
                      _message!,
                      style: TextStyle(
                        color: _isAccepted
                            ? _BrandPalette.mint
                            : _BrandPalette.muted,
                        fontSize: 12,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ],
                ],
              ),
            ),
            const SizedBox(height: 14),
            FilledButton.icon(
              onPressed: _isAccepted ? _linkToken : () => _readToken(),
              style: FilledButton.styleFrom(
                backgroundColor: _isAccepted
                    ? _BrandPalette.mint
                    : _BrandPalette.cyan,
                foregroundColor: _BrandPalette.midnight,
                padding: const EdgeInsets.symmetric(vertical: 16),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(16),
                ),
              ),
              icon: Icon(_isAccepted ? Icons.link_rounded : Icons.nfc_rounded),
              label: Text(
                _isAccepted ? 'Link RFID token' : 'Read from $_selectedCharger',
                style: const TextStyle(
                  fontSize: 15,
                  fontWeight: FontWeight.w900,
                ),
              ),
            ),
            const SizedBox(height: 8),
            TextButton.icon(
              onPressed: _isAccepted ? null : () => _readToken(mismatch: true),
              icon: const Icon(Icons.sync_problem_rounded),
              label: const Text('Simulate different token'),
            ),
          ],
        ),
      ),
    );
  }

  InputDecoration _wizardDecoration({
    required String label,
    required IconData icon,
  }) {
    return InputDecoration(
      labelText: label,
      prefixIcon: Icon(icon),
      filled: true,
      fillColor: const Color(0xFF0B2130),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(16),
        borderSide: const BorderSide(color: Color(0xFF17394B)),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(16),
        borderSide: const BorderSide(color: _BrandPalette.cyan, width: 1.4),
      ),
    );
  }
}

class _WizardPanel extends StatelessWidget {
  const _WizardPanel({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: const Color(0xFF071724),
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: const Color(0xFF17394B)),
      ),
      child: child,
    );
  }
}

class _RfidReadStep extends StatelessWidget {
  const _RfidReadStep({
    required this.number,
    required this.code,
    required this.active,
  });

  final int number;
  final String? code;
  final bool active;

  @override
  Widget build(BuildContext context) {
    final complete = code != null;
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: active ? const Color(0xFF0D2A35) : const Color(0xFF0B2130),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(
          color: active ? _BrandPalette.cyan : const Color(0xFF17394B),
        ),
      ),
      child: Row(
        children: [
          CircleAvatar(
            radius: 16,
            backgroundColor: complete
                ? _BrandPalette.mint
                : const Color(0xFF123246),
            child: Icon(
              complete ? Icons.check_rounded : Icons.nfc_rounded,
              color: complete ? _BrandPalette.midnight : _BrandPalette.cyan,
              size: 18,
            ),
          ),
          const SizedBox(width: 11),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Read $number',
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 13,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(height: 3),
                Text(
                  code ?? 'Waiting for charger idTag read',
                  maxLines: 1,
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
        ],
      ),
    );
  }
}

class _ProfileSectionCard extends StatelessWidget {
  const _ProfileSectionCard({
    required this.icon,
    required this.title,
    required this.children,
    this.initiallyExpanded = false,
  });

  final IconData icon;
  final String title;
  final List<Widget> children;
  final bool initiallyExpanded;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      container: true,
      label: '$title profile section',
      child: Container(
        margin: const EdgeInsets.only(bottom: 8),
        decoration: BoxDecoration(
          color: const Color(0xFF071724),
          borderRadius: BorderRadius.circular(18),
          border: Border.all(color: const Color(0xFF17394B)),
        ),
        child: Theme(
          data: Theme.of(context).copyWith(
            dividerColor: Colors.transparent,
            splashColor: const Color(0x3325C9C9),
            highlightColor: const Color(0x1A25C9C9),
          ),
          child: ExpansionTile(
            initiallyExpanded: initiallyExpanded,
            minTileHeight: 58,
            tilePadding: const EdgeInsets.fromLTRB(13, 2, 10, 2),
            childrenPadding: const EdgeInsets.only(bottom: 6),
            collapsedIconColor: _BrandPalette.muted,
            iconColor: const Color(0xFF75EAF2),
            leading: Container(
              width: 36,
              height: 36,
              decoration: BoxDecoration(
                color: const Color(0xFF0B2130),
                borderRadius: BorderRadius.circular(11),
              ),
              child: Icon(icon, color: const Color(0xFF75EAF2), size: 19),
            ),
            title: Text(
              title,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                color: Color(0xFFEAF8FB),
                fontSize: 15.5,
                fontWeight: FontWeight.w900,
              ),
            ),
            subtitle: Text(
              '${children.length} items',
              style: const TextStyle(
                color: _BrandPalette.muted,
                fontSize: 11.5,
                fontWeight: FontWeight.w700,
              ),
            ),
            children: [
              for (var index = 0; index < children.length; index++) ...[
                if (index > 0)
                  const Divider(
                    height: 1,
                    indent: 62,
                    color: Color(0xFF143D50),
                  ),
                children[index],
              ],
            ],
          ),
        ),
      ),
    );
  }
}

class _ProfileInfoTile extends StatelessWidget {
  const _ProfileInfoTile({
    required this.icon,
    required this.title,
    required this.subtitle,
    this.trailing,
    this.onTap,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final String? trailing;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: '$title, $subtitle',
      button: onTap != null,
      readOnly: onTap == null,
      child: InkWell(
        borderRadius: BorderRadius.circular(14),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(13, 10, 11, 10),
          child: Row(
            children: [
              Container(
                width: 34,
                height: 34,
                decoration: BoxDecoration(
                  color: const Color(0xFF0B2130),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Icon(icon, color: const Color(0xFF75EAF2), size: 18),
              ),
              const SizedBox(width: 11),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 13.5,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      subtitle,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: _BrandPalette.muted,
                        fontSize: 11.5,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ],
                ),
              ),
              if (trailing != null) ...[
                const SizedBox(width: 8),
                _ProfileChip(label: trailing!),
              ],
              if (onTap != null) ...[
                const SizedBox(width: 6),
                const Icon(
                  Icons.chevron_right_rounded,
                  color: _BrandPalette.muted,
                  size: 22,
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

class _ProfileChip extends StatelessWidget {
  const _ProfileChip({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      constraints: const BoxConstraints(maxWidth: 78),
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
      decoration: BoxDecoration(
        color: const Color(0xFF0E2A34),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: const Color(0xFF2A7384)),
      ),
      child: Text(
        label,
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: const TextStyle(
          color: Color(0xFF75EAF2),
          fontSize: 11,
          fontWeight: FontWeight.w900,
        ),
      ),
    );
  }
}
