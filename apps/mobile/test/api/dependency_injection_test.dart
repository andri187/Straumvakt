import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:straumvakt_app/api/auth_storage.dart';
import 'package:straumvakt_app/api/client.dart';

void main() {
  test('production API defaults remain pinned to the staging worker', () {
    final api = StraumvaktApi();
    addTearDown(api.close);

    expect(api.baseUrl, StraumvaktApi.defaultBaseUrl);
    expect(api.baseUrl, 'https://hlada-api-staging.straumvakt.workers.dev');
  });

  test('closing an API does not close an injected HTTP client', () async {
    var requests = 0;
    final client = MockClient((request) async {
      requests++;
      return http.Response(
        '{"id":"driver-1","email":"driver@example.test",'
        '"displayName":"Driver","locale":"en"}',
        200,
      );
    });
    final api = StraumvaktApi(baseUrl: 'https://example.test', client: client);

    api.close();
    await api.getMe('token');

    expect(requests, 1);
    client.close();
  });

  test('secure storage remains the production session storage', () {
    expect(AuthStorage(), isA<SessionStorage>());
  });
}
