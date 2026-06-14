import 'dart:async';
import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;

import 'config.dart';

class DriverProfile {
  const DriverProfile({
    required this.id,
    required this.email,
    required this.displayName,
    this.locale,
    this.organizationName,
  });

  final String id;
  final String email;
  final String displayName;
  final String? locale;
  final String? organizationName;

  factory DriverProfile.fromJson(Map<String, dynamic> json) => DriverProfile(
    id: json['id'] as String,
    email: json['email'] as String,
    displayName: (json['displayName'] ?? json['email']) as String,
    locale: json['locale'] as String?,
    organizationName: json['organizationName'] as String?,
  );
}

class LoginResult {
  const LoginResult({
    required this.accessToken,
    required this.refreshToken,
    required this.expiresInSeconds,
    required this.driver,
  });

  final String accessToken;
  final String refreshToken;
  final int expiresInSeconds;
  final DriverProfile driver;
}

class ApiCharger {
  const ApiCharger({
    required this.chargerId,
    required this.connectorId,
    required this.displayName,
    required this.locationName,
    required this.status,
    required this.maxPowerKw,
    this.bleAdvertisingId,
    this.bleAdvertisingKind,
  });

  final String chargerId;
  final String connectorId;
  final String displayName;
  final String locationName;
  final String status;
  final double maxPowerKw;
  final String? bleAdvertisingId;
  final String? bleAdvertisingKind;

  factory ApiCharger.fromJson(Map<String, dynamic> json) => ApiCharger(
    chargerId: json['chargerId'] as String,
    connectorId: json['connectorId'] as String,
    displayName: (json['displayName'] ?? 'Charger') as String,
    locationName: (json['locationName'] ?? '') as String,
    status: (json['status'] ?? 'Available') as String,
    maxPowerKw: (json['maxPowerKw'] as num?)?.toDouble() ?? 0,
    bleAdvertisingId: json['bleAdvertisingId'] as String?,
    bleAdvertisingKind: json['bleAdvertisingKind'] as String?,
  );
}

class StartSessionResponse {
  const StartSessionResponse({
    required this.commandId,
    required this.status,
    required this.sessionId,
    required this.chargerName,
    this.tokenKind,
    this.tokenLabel,
  });

  final String commandId;
  final String status;
  final String sessionId;
  final String chargerName;
  final String? tokenKind;
  final String? tokenLabel;

  factory StartSessionResponse.fromJson(Map<String, dynamic> json) {
    final session = (json['session'] as Map<String, dynamic>?) ?? const {};
    return StartSessionResponse(
      commandId: json['commandId'] as String,
      status: (json['status'] ?? 'accepted') as String,
      sessionId: (session['sessionId'] ?? json['commandId']) as String,
      chargerName: (session['chargerName'] ?? 'Charger') as String,
      tokenKind: json['tokenKind'] as String?,
      tokenLabel: json['tokenLabel'] as String?,
    );
  }
}

/// An in-progress charge session as reported by GET /sessions/current.
/// Only [status], [startedAt] and [energyKwh] carry live values in-flight;
/// the server reports powerKw=0 (not stored on the session row) and
/// costIsk=0 until the session is stopped and billed.
class ActiveSession {
  const ActiveSession({
    required this.sessionId,
    required this.connectorId,
    required this.chargerName,
    required this.status,
    required this.startedAt,
    required this.powerKw,
    required this.energyKwh,
    required this.costIsk,
  });

  final String sessionId;
  final String? connectorId;
  final String chargerName;
  final String status;
  final DateTime? startedAt;
  final double powerKw;
  final double energyKwh;
  final double costIsk;

  factory ActiveSession.fromJson(Map<String, dynamic> json) => ActiveSession(
    sessionId: json['sessionId'] as String,
    connectorId: json['connectorId'] as String?,
    chargerName: (json['chargerName'] ?? 'Hledslustod') as String,
    status: (json['status'] ?? 'Charging') as String,
    startedAt: DateTime.tryParse((json['startedAt'] ?? '') as String)?.toLocal(),
    powerKw: (json['powerKw'] as num?)?.toDouble() ?? 0,
    energyKwh: (json['energyKwh'] as num?)?.toDouble() ?? 0,
    costIsk: (json['costIsk'] as num?)?.toDouble() ?? 0,
  );
}

/// A location (installation) the driver can charge at, with its indicative
/// total per-kWh price — from GET /api/driver/installations. Used to enrich
/// the overview location cards (price + address + counts).
class DriverInstallation {
  const DriverInstallation({
    required this.id,
    required this.displayName,
    required this.siteAddress,
    required this.perKwh,
    required this.currency,
    required this.vatRatePct,
    required this.vatInclusive,
  });

  final String id;
  final String displayName;
  final String? siteAddress;
  final double perKwh;
  final String currency;
  final double vatRatePct;
  final bool vatInclusive;

  factory DriverInstallation.fromJson(Map<String, dynamic> json) {
    final p = (json['pricingSummary'] as Map<String, dynamic>?) ?? const {};
    return DriverInstallation(
      id: json['id'] as String,
      displayName: (json['displayName'] ?? '') as String,
      siteAddress: json['siteAddress'] as String?,
      perKwh: double.tryParse('${p['perKwhMinor'] ?? 0}') ?? 0,
      currency: (p['currency'] ?? 'ISK') as String,
      vatRatePct: double.tryParse('${p['vatRatePct'] ?? 0}') ?? 0,
      vatInclusive: p['vatInclusive'] == true,
    );
  }
}

/// One cost-factor line of the driver's contract pricing for a charger
/// (e.g. DSO grid, electricity, station service fee). Prices are
/// VAT-exclusive, in currency-minor units (ISK has no minor unit, so
/// minor == major). Only [driverPays] clauses are billed to the driver.
class PricingClause {
  const PricingClause({
    required this.factorCode,
    required this.factorName,
    required this.basis,
    required this.unitPrice,
    required this.vatRatePct,
    required this.driverPays,
    required this.notes,
  });

  final String factorCode;
  final String factorName;
  final String basis; // per_kwh | per_minute | per_day | per_session
  final double unitPrice;
  final double vatRatePct;
  final bool driverPays;
  final String? notes;

  factory PricingClause.fromJson(Map<String, dynamic> json) => PricingClause(
    factorCode: (json['factorCode'] ?? '') as String,
    factorName: (json['factorDisplayName'] ?? json['factorCode'] ?? '') as String,
    basis: (json['basisType'] ?? 'per_kwh') as String,
    unitPrice: double.tryParse('${json['unitPriceMinor'] ?? 0}') ?? 0,
    vatRatePct: double.tryParse('${json['vatRatePct'] ?? 0}') ?? 0,
    driverPays: json['driverPays'] == true,
    notes: json['notes'] as String?,
  );
}

/// The driver's indicative contract price for a charger, from
/// GET /api/driver/chargers/:id/pricing. The canonical billing math still
/// runs at session-stop; this is the "what you'd pay" preview.
class ChargerPricing {
  const ChargerPricing({
    required this.perKwh,
    required this.perMinute,
    required this.perSession,
    required this.currency,
    required this.vatInclusive,
    required this.vatRatePct,
    required this.clauses,
  });

  final double perKwh;
  final double perMinute;
  final double perSession;
  final String currency;
  final bool vatInclusive;
  final double vatRatePct;

  /// Driver-paying clauses only, in display order.
  final List<PricingClause> clauses;

  factory ChargerPricing.fromJson(Map<String, dynamic> json) {
    final terms = (json['terms'] as Map<String, dynamic>?) ?? const {};
    final summary = (terms['summary'] as Map<String, dynamic>?) ?? const {};
    final rawClauses = (terms['clauses'] as List<dynamic>? ?? const [])
        .map((c) => PricingClause.fromJson(c as Map<String, dynamic>))
        .where((c) => c.driverPays)
        .toList();
    // Representative VAT — the highest among driver-paying clauses, so the
    // headline never under-promises (mirrors the server's list summary).
    var vat = 0.0;
    for (final c in rawClauses) {
      if (c.vatRatePct > vat) vat = c.vatRatePct;
    }
    return ChargerPricing(
      perKwh: double.tryParse('${summary['perKwhMinor'] ?? 0}') ?? 0,
      perMinute: double.tryParse('${summary['perMinuteMinor'] ?? 0}') ?? 0,
      perSession: double.tryParse('${summary['perSessionMinor'] ?? 0}') ?? 0,
      currency: (summary['currency'] ?? 'ISK') as String,
      vatInclusive: summary['vatInclusive'] == true,
      vatRatePct: vat,
      clauses: rawClauses,
    );
  }
}

class ApiException implements Exception {
  ApiException(this.statusCode, this.code, this.message);
  final int statusCode;
  final String code;
  final String message;

  bool get isAuth => statusCode == 401;

  @override
  String toString() => 'ApiException($statusCode $code): $message';
}

class StraumvaktApi {
  StraumvaktApi({http.Client? client, String? baseUrl})
    : _client = client ?? http.Client(),
      _baseUrl = baseUrl ?? Config.apiBase;

  final http.Client _client;
  final String _baseUrl;
  static const Duration _timeout = Duration(seconds: 15);

  Uri _u(String path) => Uri.parse('$_baseUrl$path');

  Map<String, String> _authHeaders(String token) => {
    'Authorization': 'Bearer $token',
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };

  Future<LoginResult> login(String email, String password) async {
    final res = await _client
        .post(
          _u('/api/driver/login'),
          headers: const {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          body: jsonEncode({'email': email, 'password': password}),
        )
        .timeout(_timeout);
    final body = _decode(res);
    if (res.statusCode != 200) {
      throw ApiException(
        res.statusCode,
        (body['error'] ?? 'error') as String,
        (body['message'] ?? 'Login failed.') as String,
      );
    }
    return LoginResult(
      accessToken: body['accessToken'] as String,
      refreshToken: body['refreshToken'] as String,
      expiresInSeconds: (body['expiresInSeconds'] as num).toInt(),
      driver: DriverProfile.fromJson(body['driver'] as Map<String, dynamic>),
    );
  }

  Future<DriverProfile> me(String token) async {
    final res = await _client
        .get(_u('/api/driver/me'), headers: _authHeaders(token))
        .timeout(_timeout);
    final body = _decode(res);
    if (res.statusCode != 200) {
      throw ApiException(
        res.statusCode,
        (body['error'] ?? 'error') as String,
        (body['message'] ?? 'Failed to load profile.') as String,
      );
    }
    return DriverProfile.fromJson(body);
  }

  Future<List<ApiCharger>> chargers(String token) async {
    final res = await _client
        .get(_u('/api/driver/chargers'), headers: _authHeaders(token))
        .timeout(_timeout);
    final body = _decode(res);
    if (res.statusCode != 200) {
      throw ApiException(
        res.statusCode,
        (body['error'] ?? 'error') as String,
        (body['message'] ?? 'Failed to load chargers.') as String,
      );
    }
    final rows = (body['chargers'] as List<dynamic>? ?? const []);
    return [
      for (final r in rows) ApiCharger.fromJson(r as Map<String, dynamic>),
    ];
  }

  Future<StartSessionResponse> startSession(
    String token, {
    required String connectorId,
  }) async {
    final res = await _client
        .post(
          _u('/api/driver/start-session'),
          headers: _authHeaders(token),
          body: jsonEncode({'connectorId': connectorId}),
        )
        .timeout(_timeout);
    final body = _decode(res);
    if (res.statusCode != 202 && res.statusCode != 200) {
      throw ApiException(
        res.statusCode,
        (body['error'] ?? 'error') as String,
        (body['message'] ?? 'Failed to start session.') as String,
      );
    }
    return StartSessionResponse.fromJson(body);
  }

  /// The driver's in-progress sessions. Empty list when not charging. The
  /// app polls this after a start command to confirm the charger actually
  /// began the transaction (real confirmation, not the 202-accepted echo).
  Future<List<ActiveSession>> currentSessions(String token) async {
    final res = await _client
        .get(_u('/api/driver/sessions/current'), headers: _authHeaders(token))
        .timeout(_timeout);
    final body = _decode(res);
    if (res.statusCode != 200) {
      throw ApiException(
        res.statusCode,
        (body['error'] ?? 'error') as String,
        (body['message'] ?? 'Failed to load session.') as String,
      );
    }
    final rows = (body['sessions'] as List<dynamic>? ?? const []);
    return [
      for (final r in rows) ActiveSession.fromJson(r as Map<String, dynamic>),
    ];
  }

  /// Request a real RemoteStopTransaction on one of the driver's own
  /// in-progress sessions. [sessionId] is the charge-session uuid from
  /// [currentSessions] — NOT the start command id.
  Future<void> stopSession(String token, {required String sessionId}) async {
    final res = await _client
        .post(
          _u('/api/driver/stop-session'),
          headers: _authHeaders(token),
          body: jsonEncode({'sessionId': sessionId}),
        )
        .timeout(_timeout);
    if (res.statusCode == 202 || res.statusCode == 200) return;
    final body = _decode(res);
    throw ApiException(
      res.statusCode,
      (body['error'] ?? 'error') as String,
      (body['message'] ?? 'Failed to stop session.') as String,
    );
  }

  /// Locations the driver can charge at right now, each with its indicative
  /// total per-kWh price + address. Powers the overview location cards.
  Future<List<DriverInstallation>> installations(String token) async {
    final res = await _client
        .get(_u('/api/driver/installations'), headers: _authHeaders(token))
        .timeout(_timeout);
    final body = _decode(res);
    if (res.statusCode != 200) {
      throw ApiException(
        res.statusCode,
        (body['error'] ?? 'error') as String,
        (body['message'] ?? 'Failed to load installations.') as String,
      );
    }
    final rows = (body['installations'] as List<dynamic>? ?? const []);
    return [
      for (final r in rows) DriverInstallation.fromJson(r as Map<String, dynamic>),
    ];
  }

  /// The driver's indicative contract pricing for a charger. Returns null
  /// on 404 (no access / unknown charger) so the UI simply omits the card.
  Future<ChargerPricing?> chargerPricing(
    String token, {
    required String chargerId,
  }) async {
    final res = await _client
        .get(
          _u('/api/driver/chargers/$chargerId/pricing'),
          headers: _authHeaders(token),
        )
        .timeout(_timeout);
    if (res.statusCode == 404) return null;
    final body = _decode(res);
    if (res.statusCode != 200) {
      throw ApiException(
        res.statusCode,
        (body['error'] ?? 'error') as String,
        (body['message'] ?? 'Failed to load pricing.') as String,
      );
    }
    return ChargerPricing.fromJson(body);
  }

  Map<String, dynamic> _decode(http.Response res) {
    if (res.body.isEmpty) return const {};
    try {
      final decoded = jsonDecode(res.body);
      if (decoded is Map<String, dynamic>) return decoded;
      return const {};
    } on FormatException {
      return const {};
    }
  }

  void close() => _client.close();
}

class TokenStore {
  TokenStore({FlutterSecureStorage? storage})
    : _storage = storage ?? const FlutterSecureStorage();

  final FlutterSecureStorage _storage;

  static const _kAccess = 'sv_access_token';
  static const _kRefresh = 'sv_refresh_token';
  static const _kEmail = 'sv_driver_email';

  Future<void> save({
    required String accessToken,
    required String refreshToken,
    required String email,
  }) async {
    await _storage.write(key: _kAccess, value: accessToken);
    await _storage.write(key: _kRefresh, value: refreshToken);
    await _storage.write(key: _kEmail, value: email);
  }

  Future<String?> readAccess() => _storage.read(key: _kAccess);
  Future<String?> readEmail() => _storage.read(key: _kEmail);

  Future<void> clear() async {
    await _storage.delete(key: _kAccess);
    await _storage.delete(key: _kRefresh);
    await _storage.delete(key: _kEmail);
  }
}
