import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:straumvakt_app/api/client.dart';

const _origin = 'https://api.example.test';
const _profile = {
  'id': 'driver-1',
  'email': 'driver@example.test',
  'displayName': 'Driver One',
  'locale': 'en',
};

StraumvaktApi _api(
  Future<http.Response> Function(http.Request request) handler,
) => StraumvaktApi(baseUrl: _origin, client: MockClient(handler));

http.Response _json(Object? body, int status) => http.Response(
  body == null ? '' : jsonEncode(body),
  status,
  headers: {'content-type': 'application/json'},
);

void _expectBearer(http.Request request) {
  expect(request.headers['authorization'], 'Bearer access-token');
  expect(request.headers['content-type'], 'application/json');
}

void main() {
  group('authentication and profile contracts', () {
    test('login sends credentials and parses the auth session', () async {
      final api = _api((request) async {
        expect(request.method, 'POST');
        expect(request.url, Uri.parse('$_origin/api/driver/login'));
        expect(request.headers['content-type'], 'application/json');
        expect(jsonDecode(request.body), {
          'email': 'driver@example.test',
          'password': 'secret',
        });
        return _json({
          'accessToken': 'access',
          'refreshToken': 'refresh',
          'expiresInSeconds': 900,
          'driver': _profile,
        }, 200);
      });

      final result = await api.login(
        email: 'driver@example.test',
        password: 'secret',
      );
      expect(result.accessToken, 'access');
      expect(result.driver.email, 'driver@example.test');
    });

    test('login preserves a server message and has a safe fallback', () async {
      var api = _api((_) async => _json({'message': 'Wrong password'}, 401));
      await expectLater(
        api.login(email: 'a', password: 'b'),
        throwsA(
          isA<ApiException>()
              .having((e) => e.statusCode, 'status', 401)
              .having((e) => e.message, 'message', 'Wrong password'),
        ),
      );

      api = _api((_) async => http.Response('not-json', 500));
      await expectLater(
        api.login(email: 'a', password: 'b'),
        throwsA(
          isA<ApiException>().having(
            (e) => e.message,
            'message',
            'Login failed',
          ),
        ),
      );
    });

    test('profile reads and supported updates use the same route', () async {
      final seen = <String>[];
      final api = _api((request) async {
        _expectBearer(request);
        expect(request.url.path, '/api/driver/me');
        seen.add('${request.method}:${request.body}');
        return _json(_profile, 200);
      });

      expect((await api.getMe('access-token')).displayName, 'Driver One');
      await api.updateLocale(accessToken: 'access-token', locale: 'is');
      await api.updateDisplayName(
        accessToken: 'access-token',
        displayName: 'Driver Two',
      );
      expect(seen, [
        'GET:',
        'PATCH:${jsonEncode({'locale': 'is'})}',
        'PATCH:${jsonEncode({'displayName': 'Driver Two'})}',
      ]);
    });
  });

  group('access and command contracts', () {
    test('chargers parse an empty and populated envelope', () async {
      var populated = false;
      final api = _api((request) async {
        _expectBearer(request);
        expect(request.url.path, '/api/driver/chargers');
        if (!populated) {
          populated = true;
          return _json({'chargers': []}, 200);
        }
        return _json({
          'chargers': [
            {
              'chargerId': 'charger-1',
              'connectorId': 'connector-1',
              'displayName': 'North',
              'locationName': 'Harbour',
              'status': 'Available',
              'maxPowerKw': 22,
            },
          ],
        }, 200);
      });

      expect(await api.getChargers('access-token'), isEmpty);
      final chargers = await api.getChargers('access-token');
      expect(chargers.single.displayName, 'North');
      expect(chargers.single.status.canStart, isTrue);
    });

    test(
      'invite consume serializes identity and maps machine errors',
      () async {
        var fail = false;
        final api = _api((request) async {
          expect(request.method, 'POST');
          expect(request.url.path, '/api/public/invites/consume');
          expect(jsonDecode(request.body), {
            'token': 'invite',
            'kennitala': '0101901234',
            'password': 'secret',
          });
          if (fail) return _json({'error': 'expired'}, 410);
          fail = true;
          return _json({
            'userId': 'user-1',
            'orgId': 'org-1',
            'email': 'driver@example.test',
            'pendingApproval': true,
          }, 200);
        });

        final result = await api.consumeInvite(
          token: 'invite',
          kennitala: '0101901234',
          password: 'secret',
        );
        expect(result.pendingApproval, isTrue);
        await expectLater(
          api.consumeInvite(
            token: 'invite',
            kennitala: '0101901234',
            password: 'secret',
          ),
          throwsA(
            isA<ApiException>().having(
              (e) => e.message,
              'message',
              'This invite has expired. Ask your host for a new one.',
            ),
          ),
        );
      },
    );

    test('start and stop commands preserve accepted snapshots', () async {
      var stopping = false;
      final api = _api((request) async {
        _expectBearer(request);
        expect(request.method, 'POST');
        if (!stopping) {
          stopping = true;
          expect(request.url.path, '/api/driver/start-session');
          expect(jsonDecode(request.body), {'connectorId': 'connector-1'});
          return _json({
            'commandId': 'start-1',
            'status': 'Accepted',
            'tokenKind': 'manual',
          }, 202);
        }
        expect(request.url.path, '/api/driver/stop-session');
        expect(jsonDecode(request.body), {'sessionId': 'session-1'});
        return _json({
          'commandId': 'stop-1',
          'status': 'Accepted',
          'session': {
            'sessionId': 'session-1',
            'chargerName': 'North',
            'status': 'Finishing',
          },
        }, 202);
      });

      final start = await api.startSession(
        accessToken: 'access-token',
        connectorId: 'connector-1',
      );
      expect(start.tokenKindLabel, 'virtual RFID');
      final stop = await api.stopSession(
        accessToken: 'access-token',
        sessionId: 'session-1',
      );
      expect(stop.session?.status, 'Finishing');
    });

    test(
      'tap intent arm and idempotent disarm honor the wire contract',
      () async {
        var disarming = false;
        final api = _api((request) async {
          _expectBearer(request);
          if (!disarming) {
            disarming = true;
            expect(request.method, 'POST');
            expect(request.url.path, '/api/driver/tap-intent');
            expect(jsonDecode(request.body), {
              'serial': 'ZAP123',
              'rssi': -62,
              'deviceHandle': 'ble-1',
            });
            return _json({
              'intentId': 'intent-1',
              'expiresAt': '2026-08-09T02:00:00Z',
              'ttlSeconds': 120,
            }, 201);
          }
          expect(request.method, 'DELETE');
          expect(request.url.path, '/api/driver/tap-intent/intent-1');
          return _json({'error': 'not_found'}, 404);
        });

        final intent = await api.armTapIntent(
          accessToken: 'access-token',
          serial: 'ZAP123',
          rssi: -62,
          deviceHandle: 'ble-1',
        );
        expect(intent.intentId, 'intent-1');
        await api.disarmTapIntent(
          accessToken: 'access-token',
          intentId: 'intent-1',
        );
      },
    );

    test('BLE credential and advanced grants fail closed', () async {
      var pinRequest = true;
      final api = _api((request) async {
        _expectBearer(request);
        if (pinRequest) {
          pinRequest = false;
          expect(request.url.path, '/api/driver/chargers/ZAP123/ble-pin');
          return _json({'pin': '1234'}, 200);
        }
        expect(request.url.path, '/api/driver/chargers/ZAP123/advanced-grant');
        return _json({'status': 'unexpected'}, 200);
      });

      expect(
        await api.getChargerBlePin(
          accessToken: 'access-token',
          serial: 'ZAP123',
        ),
        '1234',
      );
      expect(
        await api.getAdvancedSettingsGrant(
          accessToken: 'access-token',
          serial: 'ZAP123',
        ),
        'locked',
      );

      final offline = _api((_) async => throw StateError('offline'));
      expect(
        await offline.getChargerBlePin(
          accessToken: 'access-token',
          serial: 'ZAP123',
        ),
        isNull,
      );
      expect(
        await offline.getAdvancedSettingsGrant(
          accessToken: 'access-token',
          serial: 'ZAP123',
        ),
        'locked',
      );
    });
  });

  group('session read contracts', () {
    test(
      'current sessions preserve identity and unavailable placeholders',
      () async {
        var empty = false;
        final api = _api((request) async {
          _expectBearer(request);
          expect(request.url.path, '/api/driver/sessions/current');
          if (empty) return _json(null, 204);
          empty = true;
          return _json({
            'sessions': [
              {
                'sessionId': 'new',
                'connectorId': null,
                'chargerName': 'North',
                'status': 'FutureStatus',
                'startedAt': '2026-08-09T01:00:00Z',
                'powerKw': 0,
                'energyKwh': 4.5,
                'costIsk': 0,
              },
              {
                'sessionId': 'old',
                'chargerName': 'South',
                'status': 'Charging',
                'powerKw': 7.2,
                'costIsk': 2500,
              },
            ],
          }, 200);
        });

        final sessions = await api.getCurrentSessions('access-token');
        expect(sessions.map((s) => s.sessionId), ['new', 'old']);
        expect(sessions.first.connectorStatus.label, 'Unknown');
        expect(sessions.first.powerKw, isNull);
        expect(sessions.first.costIsk, isNull);
        expect(sessions.last.costLabel, '25 kr');
        expect(await api.getCurrentSessions('access-token'), isEmpty);
      },
    );

    test('malformed current-session envelope does not invent a row', () async {
      final api = _api((_) async => _json({'sessions': 'invalid'}, 200));
      expect(await api.getCurrentSessions('access-token'), isEmpty);
    });

    test(
      'history sends pagination and invoices remain a distinct route',
      () async {
        final paths = <String>[];
        final api = _api((request) async {
          _expectBearer(request);
          paths.add(request.url.toString());
          return _json({
            'sessions': [
              {
                'sessionId': 'session-1',
                'startedAt': '2026-08-08T20:00:00Z',
                'energyKwh': 10.25,
                'costIsk': null,
              },
            ],
          }, 200);
        });

        final history = await api.getSessionHistory(
          'access-token',
          skip: 25,
          limit: 25,
        );
        final invoices = await api.getInvoices('access-token');
        expect(history.single.costLabel, isNull);
        expect(invoices, hasLength(1));
        expect(paths, [
          '$_origin/api/driver/sessions/history?skip=25&limit=25',
          '$_origin/api/driver/invoices',
        ]);
      },
    );

    test('session detail requires the response envelope', () async {
      var incomplete = false;
      final api = _api((request) async {
        _expectBearer(request);
        expect(request.url.path, '/api/driver/sessions/session-1');
        if (incomplete) return _json({'detail': {}}, 200);
        incomplete = true;
        return _json({
          'session': {
            'sessionId': 'session-1',
            'startedAt': '2026-08-08T20:00:00Z',
            'energyKwh': '12.50',
            'costFormatted': null,
          },
        }, 200);
      });

      final detail = await api.getSessionDetail(
        accessToken: 'access-token',
        sessionId: 'session-1',
      );
      expect(detail.energyKwh, 12.5);
      expect(detail.costFormatted, isNull);
      await expectLater(
        api.getSessionDetail(
          accessToken: 'access-token',
          sessionId: 'session-1',
        ),
        throwsA(
          isA<ApiException>()
              .having((e) => e.statusCode, 'status', 502)
              .having(
                (e) => e.message,
                'message',
                'Session detail response was incomplete.',
              ),
        ),
      );
    });

    test('read errors preserve server messages', () async {
      final api = _api((_) async => _json({'message': 'Forbidden'}, 403));
      await expectLater(
        api.getSessionHistory('access-token'),
        throwsA(
          isA<ApiException>()
              .having((e) => e.statusCode, 'status', 403)
              .having((e) => e.message, 'message', 'Forbidden'),
        ),
      );
    });
  });
}
