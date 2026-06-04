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

  // ── Invite redemption (ADR 0026 §3/§5) ────────────────────────────
  //
  // Consume an invite token (code or QR payload), capturing the
  // driver's kennitala + chosen password. The backend resolves email +
  // org from the token. No bearer auth — possession of the invite token
  // is the authorisation. 200 → membership active (or pending host
  // approval when the invite carried an allow-term).
  Future<ConsumeInviteResult> consumeInvite({
    required String token,
    required String kennitala,
    required String password,
  }) async {
    final res = await http.post(
      Uri.parse('$baseUrl/api/public/invites/consume'),
      headers: {'content-type': 'application/json'},
      body: jsonEncode({
        'token': token,
        'kennitala': kennitala,
        'password': password,
      }),
    );
    final body = _decode(res);
    if (res.statusCode != 200) {
      throw ApiException(
        res.statusCode,
        (body is Map && body['error'] is String)
            ? _inviteErrorMessage(body['error'] as String)
            : (body is Map && body['message'] is String)
                ? body['message'] as String
                : 'Could not redeem invite',
      );
    }
    return ConsumeInviteResult.fromJson(body as Map<String, dynamic>);
  }

  // Translate the backend's machine error codes into driver-facing text.
  String _inviteErrorMessage(String code) {
    switch (code) {
      case 'not_found':
        return 'That invite code isn\'t recognised. Check it and try again.';
      case 'already_used':
        return 'This invite has already been redeemed.';
      case 'expired':
        return 'This invite has expired. Ask your host for a new one.';
      case 'validation':
        return 'Check the code, kennitala and password and try again.';
      case 'malformed_metadata':
        return 'This invite is misconfigured — contact your host.';
      default:
        return 'Could not redeem invite ($code).';
    }
  }

  // ── Live session (aligns with the web live screen) ────────────────
  //
  // Poll the driver's current active session. Returns null on 204 / 404
  // (no active session) so callers can render an idle state.
  Future<ActiveSession?> getCurrentSession(String accessToken) async {
    final res = await http.get(
      Uri.parse('$baseUrl/api/driver/sessions/current'),
      headers: _authHeaders(accessToken),
    );
    if (res.statusCode == 204 || res.statusCode == 404) return null;
    final body = _decode(res);
    if (res.statusCode != 200) {
      throw ApiException(
        res.statusCode,
        (body is Map && body['message'] is String)
            ? body['message'] as String
            : 'Failed to load session',
      );
    }
    if (body == null) return null;
    return ActiveSession.fromJson(body as Map<String, dynamic>);
  }

  // Request a remote stop. 202 Accepted with the command id + the
  // session snapshot (now finishing).
  Future<StopSessionResult> stopSession({
    required String accessToken,
    required String sessionId,
  }) async {
    final res = await http.post(
      Uri.parse('$baseUrl/api/driver/stop-session'),
      headers: _authHeaders(accessToken),
      body: jsonEncode({'sessionId': sessionId}),
    );
    final body = _decode(res);
    if (res.statusCode != 202) {
      throw ApiException(
        res.statusCode,
        (body is Map && body['message'] is String)
            ? body['message'] as String
            : 'Stop session failed',
      );
    }
    return StopSessionResult.fromJson(body as Map<String, dynamic>);
  }

  // ── Profile mutation ──────────────────────────────────────────────
  //
  // Persist a locale preference. Returns the updated profile.
  Future<DriverProfile> updateLocale({
    required String accessToken,
    required String locale,
  }) async {
    final res = await http.patch(
      Uri.parse('$baseUrl/api/driver/me'),
      headers: _authHeaders(accessToken),
      body: jsonEncode({'locale': locale}),
    );
    final body = _decode(res);
    if (res.statusCode != 200) {
      throw ApiException(
        res.statusCode,
        (body is Map && body['message'] is String)
            ? body['message'] as String
            : 'Failed to update profile',
      );
    }
    return DriverProfile.fromJson(body as Map<String, dynamic>);
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
