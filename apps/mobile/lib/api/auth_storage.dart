// Token persistence — wraps flutter_secure_storage so tokens survive
// app restarts. Read on app boot to skip login if a valid token
// exists; cleared on logout.

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

class AuthStorage {
  static const _accessKey = 'straumvakt.driver.accessToken';
  static const _refreshKey = 'straumvakt.driver.refreshToken';
  static const _emailKey = 'straumvakt.driver.email';
  static const _localeKey = 'straumvakt.driver.locale';

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

  // Locale ('is' | 'en') — persisted so the chosen language survives
  // restarts and is applied before the first /me round-trip on boot.
  Future<String?> readLocale() => _storage.read(key: _localeKey);
  Future<void> saveLocale(String locale) =>
      _storage.write(key: _localeKey, value: locale);

  Future<void> clear() async {
    await _storage.delete(key: _accessKey);
    await _storage.delete(key: _refreshKey);
    await _storage.delete(key: _emailKey);
    // Intentionally keep _localeKey — language is a device preference
    // that should persist across sign-out / sign-in.
  }
}
