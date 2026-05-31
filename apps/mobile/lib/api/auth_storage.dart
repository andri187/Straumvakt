// Token persistence — wraps flutter_secure_storage so tokens survive
// app restarts. Read on app boot to skip login if a valid token
// exists; cleared on logout.

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

class AuthStorage {
  static const _accessKey = 'straumvakt.driver.accessToken';
  static const _refreshKey = 'straumvakt.driver.refreshToken';
  static const _emailKey = 'straumvakt.driver.email';

  final _storage = const FlutterSecureStorage(
    aOptions: AndroidOptions(encryptedSharedPreferences: true),
  );

  Future<void> save({
    required String accessToken,
    required String refreshToken,
    required String email,
  }) async {
    await _storage.write(key: _accessKey, value: accessToken);
    await _storage.write(key: _refreshKey, value: refreshToken);
    await _storage.write(key: _emailKey, value: email);
  }

  Future<String?> readAccessToken() => _storage.read(key: _accessKey);
  Future<String?> readRefreshToken() => _storage.read(key: _refreshKey);
  Future<String?> readEmail() => _storage.read(key: _emailKey);

  Future<void> clear() async {
    await _storage.delete(key: _accessKey);
    await _storage.delete(key: _refreshKey);
    await _storage.delete(key: _emailKey);
  }
}
