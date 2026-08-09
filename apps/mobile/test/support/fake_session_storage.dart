import 'package:straumvakt_app/api/auth_storage.dart';

class FakeSessionStorage implements SessionStorage {
  FakeSessionStorage({
    this.accessToken,
    this.refreshToken,
    this.email,
    this.locale,
  });

  String? accessToken;
  String? refreshToken;
  String? email;
  String? locale;
  int clearCount = 0;

  @override
  Future<void> save({
    required String accessToken,
    required String refreshToken,
    required String email,
  }) async {
    this.accessToken = accessToken;
    this.refreshToken = refreshToken;
    this.email = email;
  }

  @override
  Future<String?> readAccessToken() async => accessToken;

  @override
  Future<String?> readRefreshToken() async => refreshToken;

  @override
  Future<String?> readEmail() async => email;

  @override
  Future<String?> readLocale() async => locale;

  @override
  Future<void> saveLocale(String locale) async => this.locale = locale;

  @override
  Future<void> clear() async {
    clearCount++;
    accessToken = null;
    refreshToken = null;
    email = null;
  }
}
