// Driver-side adapter for the shared live room (the same normalized observation the operator web UI shows).
//
// WHAT IT IS FOR: the charging screen's *observed power* and live connector status. The legacy session read model has no
// power ("powerKw" is a placeholder zero) and was polled every three seconds. This adapter receives one shared, minimal
// projection of the driver's OWN device and connector over a leased WebSocket instead. It never replaces the API: the session
// itself (energy, cost, completion) stays authoritative and is still read from /api/driver/sessions/current, only less often
// while live data is flowing.
//
// WHAT IT NEVER DOES: poll. It holds no operator, organisation, installation or placement data - the server projects those
// away before anything is sent. A driver is only ever told about devices they are charging at right now.
//
// TRUTHFUL STATES: connected / reconnecting / unavailable are explicit, an observation carries its own expiry, and "outdated"
// means "nothing recent was heard" - never "the charger is disconnected". Access is a short lease (the server closes the
// socket at 60 s); renewal re-verifies the token and the open session, so a finished session or a revoked login loses live
// access by itself. Disabled (no base URL) it is inert and the app behaves exactly as before.

import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

/// The server closes a socket with this code when its access lease ends; reconnecting is routine, not a failure.
const int liveLeaseCloseCode = 4001;
const Duration liveReconnectGrace = Duration(seconds: 8);
const Duration liveDegradedAfter = Duration(seconds: 45);
const int liveDegradedAfterFailures = 3;
const int _maxInstallations = 3;

class LiveConnectorState {
  const LiveConnectorState({this.status, this.powerW, this.energyWh});
  final String? status;
  final double? powerW;
  final double? energyWh;
}

class LiveDeviceState {
  const LiveDeviceState({
    required this.deviceId,
    required this.generation,
    required this.revision,
    required this.observedAt,
    required this.online,
    required this.onlineUntil,
    required this.connectors,
  });

  final String deviceId;
  final int generation;
  final int revision;
  final DateTime observedAt;
  final bool online;
  final DateTime onlineUntil;
  final Map<int, LiveConnectorState> connectors;

  bool isFresh(DateTime now) => onlineUntil.isAfter(now);

  /// Newer wins: a later connection generation, or a later revision within it.
  bool isNewerThan(LiveDeviceState other) =>
      generation > other.generation ||
      (generation == other.generation && revision > other.revision);

  static LiveDeviceState? tryParse(Object? raw) {
    if (raw is! Map) return null;
    final id = raw['deviceId'];
    final gen = raw['generation'];
    final rev = raw['revision'];
    final observed = raw['observedAt'];
    final until = raw['onlineUntil'];
    final online = raw['online'];
    final connectors = raw['connectors'];
    if (id is! String ||
        gen is! int ||
        rev is! int ||
        observed is! int ||
        until is! int ||
        online is! bool ||
        connectors is! Map) {
      return null;
    }
    final parsed = <int, LiveConnectorState>{};
    for (final entry in connectors.entries) {
      final number = int.tryParse('${entry.key}');
      final c = entry.value;
      if (number == null || c is! Map) return null;
      parsed[number] = LiveConnectorState(
        status: c['status'] is String ? c['status'] as String : null,
        powerW: c['powerW'] is num ? (c['powerW'] as num).toDouble() : null,
        energyWh: c['energyWh'] is num
            ? (c['energyWh'] as num).toDouble()
            : null,
      );
    }
    return LiveDeviceState(
      deviceId: id,
      generation: gen,
      revision: rev,
      observedAt: DateTime.fromMillisecondsSinceEpoch(observed, isUtc: true),
      online: online,
      onlineUntil: DateTime.fromMillisecondsSinceEpoch(until, isUtc: true),
      connectors: parsed,
    );
  }
}

/// A text-frame channel. Real code wraps dart:io's WebSocket; tests use a fake.
abstract class LiveChannel {
  Stream<String> get messages;

  /// Valid once [messages] has completed.
  int? get closeCode;
  Future<void> close();
}

typedef LiveConnector =
    Future<LiveChannel> Function(Uri uri, Map<String, String> headers);

class IoLiveChannel implements LiveChannel {
  IoLiveChannel._(this._socket);
  final WebSocket _socket;

  static Future<LiveChannel> connect(
    Uri uri,
    Map<String, String> headers,
  ) async => IoLiveChannel._(await WebSocket.connect(uri.toString(), headers: headers));

  @override
  Stream<String> get messages =>
      _socket.where((frame) => frame is String).cast<String>();

  @override
  int? get closeCode => _socket.closeCode;

  @override
  Future<void> close() => _socket.close();
}

enum LiveLinkState { off, connecting, connected, reconnecting, unavailable }

class _Room {
  _Room(this.installationId);
  final String installationId;
  LiveChannel? channel;
  Timer? timer;
  int failures = 0;
  DateTime? downSince;
  DateTime? lostAt;
  Set<String>? seen;
  bool ready = false;
}

class DriverLiveClient extends ChangeNotifier {
  DriverLiveClient({
    required this.baseUrl,
    required this.tokenProvider,
    LiveConnector? connector,
    http.Client? httpClient,
    DateTime Function()? clock,
    double Function()? random,
  }) : _connector = connector ?? IoLiveChannel.connect,
       _http = httpClient ?? http.Client(),
       _ownsHttp = httpClient == null,
       _clock = clock ?? DateTime.now,
       _random = random ?? Random().nextDouble;

  /// Empty/null = disabled: nothing is requested and the app keeps its API polling unchanged.
  final String? baseUrl;
  final Future<String?> Function() tokenProvider;
  final LiveConnector _connector;
  final http.Client _http;
  final bool _ownsHttp;
  final DateTime Function() _clock;
  final double Function() _random;

  final Map<String, LiveDeviceState> _devices = {};
  final Map<String, _Room> _rooms = {};
  Timer? _expiry;
  bool _started = false;
  bool _disposed = false;
  LiveLinkState _link = LiveLinkState.off;

  bool get enabled => (baseUrl ?? '').isNotEmpty;
  LiveLinkState get link => _link;

  /// True while a room is connected, or was a moment ago (a routine lease renewal is invisible).
  bool get isLive {
    final now = _clock();
    return _rooms.values.any(
      (r) =>
          r.ready ||
          (r.lostAt != null && now.difference(r.lostAt!) < liveReconnectGrace),
    );
  }

  /// Some room cannot be reached: callers should rely on API polling at its normal pace.
  bool get degraded {
    final now = _clock();
    return _rooms.values.any(
      (r) =>
          r.failures >= liveDegradedAfterFailures ||
          (r.downSince != null &&
              now.difference(r.downSince!) >= liveDegradedAfter),
    );
  }

  List<LiveDeviceState> get devices => List.unmodifiable(_devices.values);

  /// The connector this charge is on, only when it is unambiguous: an exact connector-number match, or the single
  /// connector the driver has. A guess between two chargers would show another charge's power, so there is none.
  ({LiveDeviceState device, int connector, LiveConnectorState state})? connectorFor(
    String? connectorId,
  ) {
    final all = <({LiveDeviceState device, int connector, LiveConnectorState state})>[
      for (final d in _devices.values)
        for (final c in d.connectors.entries)
          (device: d, connector: c.key, state: c.value),
    ];
    final wanted = int.tryParse(connectorId ?? '');
    if (wanted != null) {
      final exact = all.where((e) => e.connector == wanted).toList();
      if (exact.length == 1) return exact.first;
    }
    return all.length == 1 ? all.first : null;
  }

  /// Observed power in kW for this charge, or null when unknown, outdated or ambiguous.
  double? observedPowerKw(String? connectorId) {
    final match = connectorFor(connectorId);
    if (match == null || !match.device.online) return null;
    if (!match.device.isFresh(_clock())) return null;
    final w = match.state.powerW;
    return w == null ? null : w / 1000.0;
  }

  /// True when a value exists but its observation has expired (nothing recent was heard - not a claim of disconnection).
  bool isOutdated(String? connectorId) {
    final match = connectorFor(connectorId);
    return match != null && !match.device.isFresh(_clock());
  }

  Future<void> start() async {
    if (!enabled || _started || _disposed) return;
    _started = true;
    _setLink(LiveLinkState.connecting);
    await _discover();
  }

  Future<void> _discover() async {
    if (!_started || _disposed) return;
    final token = await tokenProvider();
    if (token == null || token.isEmpty) return _giveUp();
    try {
      final res = await _http.get(
        Uri.parse('$baseUrl/api/cpo/sync'),
        headers: {'authorization': 'Bearer $token', 'accept': 'application/json'},
      );
      if (!_started || _disposed) return;
      if (res.statusCode == 401 || res.statusCode == 403 || res.statusCode == 404) {
        // No right to follow anything (no open session, signed out, or the feature is off): no retry loop.
        return _giveUp();
      }
      if (res.statusCode != 200) return _retryDiscovery();
      final body = jsonDecode(res.body);
      final list = body is Map ? body['installations'] : null;
      if (list is! List) return _retryDiscovery();
      final ids = <String>[
        for (final item in list)
          if (item is Map && item['installationId'] is String) item['installationId'] as String,
      ].take(_maxInstallations);
      for (final id in ids) {
        _rooms.putIfAbsent(id, () => _Room(id)).downSince ??= _clock();
        unawaited(_open(id));
      }
      if (_rooms.isEmpty) return _giveUp();
    } catch (_) {
      _retryDiscovery();
    }
  }

  int _discoveryFailures = 0;
  Timer? _discoveryTimer;
  void _retryDiscovery() {
    if (!_started || _disposed) return;
    _setLink(LiveLinkState.reconnecting);
    _discoveryFailures += 1;
    _discoveryTimer?.cancel();
    _discoveryTimer = Timer(_backoff(_discoveryFailures), _discover);
  }

  void _giveUp() {
    _setLink(LiveLinkState.unavailable);
    _stopRooms();
    _started = false;
  }

  Future<void> _open(String id) async {
    final room = _rooms[id];
    if (room == null || !_started || _disposed) return;
    final token = await tokenProvider();
    if (token == null || token.isEmpty) return _giveUp();
    final base = Uri.parse(baseUrl!);
    final uri = base.replace(
      scheme: base.scheme == 'http' ? 'ws' : 'wss',
      path: '/api/cpo/sync',
      queryParameters: {'installation': id},
    );
    room.seen = <String>{};
    room.ready = false;
    try {
      final channel = await _connector(uri, {'authorization': 'Bearer $token'});
      if (!_started || _disposed || _rooms[id] != room) {
        unawaited(channel.close());
        return;
      }
      room.channel = channel;
      channel.messages.listen(
        (frame) => _onFrame(room, channel, frame),
        onDone: () => _onLost(room, channel),
        onError: (_) => _onLost(room, channel),
        cancelOnError: true,
      );
    } on WebSocketException catch (e) {
      // dart:io reports a refused upgrade as "was not upgraded to websocket, HTTP status code: NNN".
      final status = int.tryParse(RegExp(r'status code: (\d{3})').firstMatch(e.message)?.group(1) ?? '');
      if (status == 401 || status == 403 || status == 404) return _giveUp();
      _failed(room);
    } catch (_) {
      _failed(room);
    }
  }

  void _onFrame(_Room room, LiveChannel channel, String frame) {
    if (room.channel != channel || _disposed) return;
    try {
      final message = jsonDecode(frame);
      if (message is! Map) return;
      switch (message['type']) {
        case 'device':
          final value = LiveDeviceState.tryParse(message['value']);
          if (value == null) return;
          final first = room.seen != null && !room.seen!.contains(value.deviceId);
          room.seen?.add(value.deviceId);
          _owner[value.deviceId] = room.installationId;
          final held = _devices[value.deviceId];
          // The first value per device in the post-connect snapshot is the room's current truth; later ones must be newer.
          if (first || held == null || value.isNewerThan(held)) {
            _devices[value.deviceId] = value;
            _scheduleExpiry();
            notifyListeners();
          }
        case 'remove':
          final id = message['deviceId'];
          if (id is String && _devices.remove(id) != null) notifyListeners();
        case 'ready':
          if (message['installationId'] != room.installationId) return;
          // The snapshot is complete: anything held for this room that it did not repeat has left.
          final seen = room.seen ?? <String>{};
          _devices.removeWhere((id, _) => !seen.contains(id) && _belongsTo(room, id));
          room.seen = null;
          room.ready = true;
          room.failures = 0;
          room.downSince = null;
          room.lostAt = null;
          _discoveryFailures = 0;
          _setLink(LiveLinkState.connected);
          _scheduleExpiry();
          notifyListeners();
      }
    } catch (_) {
      // A malformed frame confers no state.
    }
  }

  // One driver normally follows one installation; with several, a device is attributed to the room that last delivered it.
  final Map<String, String> _owner = {};
  bool _belongsTo(_Room room, String deviceId) {
    final owner = _owner[deviceId];
    return owner == null || owner == room.installationId;
  }

  void _onLost(_Room room, LiveChannel channel) {
    if (room.channel != channel || _disposed || !_started) return;
    final wasReady = room.ready;
    room.ready = false;
    room.seen = null;
    room.channel = null;
    if (wasReady) room.lostAt = _clock();
    room.downSince ??= _clock();
    final code = channel.closeCode;
    if (code == 403 || code == 401) return _giveUp();
    final routine = wasReady && code == liveLeaseCloseCode;
    if (!routine) room.failures += 1;
    _setLink(LiveLinkState.reconnecting);
    notifyListeners();
    room.timer?.cancel();
    room.timer = Timer(
      routine ? const Duration(milliseconds: 250) : _backoff(room.failures),
      () => unawaited(_open(room.installationId)),
    );
  }

  void _failed(_Room room) {
    room.failures += 1;
    room.downSince ??= _clock();
    _setLink(LiveLinkState.reconnecting);
    notifyListeners();
    room.timer?.cancel();
    room.timer = Timer(_backoff(room.failures), () => unawaited(_open(room.installationId)));
  }

  Duration _backoff(int failures) {
    final base = min(60000, 1000 * pow(2, min(max(failures - 1, 0), 6)).toInt());
    return Duration(milliseconds: (base * (0.8 + 0.4 * _random())).round());
  }

  /// One timer for the soonest expiry, so an expired observation is reported even if nothing else arrives.
  void _scheduleExpiry() {
    _expiry?.cancel();
    final now = _clock();
    DateTime? next;
    for (final d in _devices.values) {
      if (d.onlineUntil.isAfter(now) && (next == null || d.onlineUntil.isBefore(next))) {
        next = d.onlineUntil;
      }
    }
    if (next == null || _disposed) return;
    _expiry = Timer(next.difference(now) + const Duration(milliseconds: 50), () {
      notifyListeners();
      _scheduleExpiry();
    });
  }

  void _setLink(LiveLinkState next) {
    if (_link == next) return;
    _link = next;
    if (!_disposed) notifyListeners();
  }

  void _stopRooms() {
    for (final room in _rooms.values) {
      room.timer?.cancel();
      unawaited(room.channel?.close());
      room.channel = null;
    }
    _rooms.clear();
    _discoveryTimer?.cancel();
    _expiry?.cancel();
    _devices.clear();
    _owner.clear();
  }

  /// Sign-out / screen closed: drop sockets, timers and every value.
  void stop() {
    _started = false;
    _stopRooms();
    _setLink(LiveLinkState.off);
  }

  @override
  void dispose() {
    _disposed = true;
    _started = false;
    _stopRooms();
    if (_ownsHttp) _http.close();
    super.dispose();
  }
}
