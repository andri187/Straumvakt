// HTTP client — talks to /api/driver/* on the deployed Straumvakt API
// Worker. Bearer-token auth attached automatically on authed calls.

import 'dart:convert';
import 'package:http/http.dart' as http;
import 'types.dart';

class ApiException implements Exception {
  ApiException(this.statusCode, this.message);
  final int statusCode;
  final String message;
  @override
  String toString() => 'ApiException($statusCode): $message';
}

class StraumvaktApi {
  StraumvaktApi({String? baseUrl})
      : baseUrl = baseUrl ?? defaultBaseUrl;

  final String baseUrl;

  // Pinned to staging. Swap for production when that domain lands.
  // No localhost fallback — the standalone bridge is retired.
  static const defaultBaseUrl =
      'https://hlada-api-staging.straumvakt.workers.dev';

  Future<AuthSession> login({
    required String email,
    required String password,
  }) async {
    final res = await http.post(
      Uri.parse('$baseUrl/api/driver/login'),
      headers: {'content-type': 'application/json'},
      body: jsonEncode({'email': email, 'password': password}),
    );
    final body = _decode(res);
    if (res.statusCode != 200) {
      throw ApiException(
        res.statusCode,
        (body is Map && body['message'] is String)
            ? body['message'] as String
            : 'Login failed',
      );
    }
    return AuthSession.fromJson(body as Map<String, dynamic>);
  }

  Future<DriverProfile> getMe(String accessToken) async {
    final res = await http.get(
      Uri.parse('$baseUrl/api/driver/me'),
      headers: _authHeaders(accessToken),
    );
    final body = _decode(res);
    if (res.statusCode != 200) {
      throw ApiException(
        res.statusCode,
        (body is Map && body['message'] is String)
            ? body['message'] as String
            : 'Failed to load profile',
      );
    }
    return DriverProfile.fromJson(body as Map<String, dynamic>);
  }

  Future<StartSessionResult> startSession({
    required String accessToken,
    required String connectorId,
  }) async {
    final res = await http.post(
      Uri.parse('$baseUrl/api/driver/start-session'),
      headers: _authHeaders(accessToken),
      body: jsonEncode({'connectorId': connectorId}),
    );
    final body = _decode(res);
    if (res.statusCode != 202) {
      throw ApiException(
        res.statusCode,
        (body is Map && body['message'] is String)
            ? body['message'] as String
            : 'Start session failed',
      );
    }
    return StartSessionResult.fromJson(body as Map<String, dynamic>);
  }

  Future<List<DriverCharger>> getChargers(String accessToken) async {
    final res = await http.get(
      Uri.parse('$baseUrl/api/driver/chargers'),
      headers: _authHeaders(accessToken),
    );
    final body = _decode(res);
    if (res.statusCode != 200) {
      throw ApiException(
        res.statusCode,
        (body is Map && body['message'] is String)
            ? body['message'] as String
            : 'Failed to load chargers',
      );
    }
    final list = (body as Map<String, dynamic>)['chargers'] as List<dynamic>;
    return list
        .map((e) => DriverCharger.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  Map<String, String> _authHeaders(String token) => {
        'authorization': 'Bearer $token',
        'content-type': 'application/json',
      };

  dynamic _decode(http.Response r) {
    if (r.body.isEmpty) return null;
    try {
      return jsonDecode(r.body);
    } catch (_) {
      return r.body;
    }
  }
}
