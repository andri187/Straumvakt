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
