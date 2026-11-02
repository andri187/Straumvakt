import 'dart:async';

import 'package:flutter/material.dart';

import '../api/auth_storage.dart';
import '../api/client.dart';
import '../api/types.dart';
import '../live/live_client.dart';
import '../theme/palette.dart';
import 'session_detail.dart';

class ActiveSessionScreen extends StatefulWidget {
  const ActiveSessionScreen({
    super.key,
    this.initialSession,
    this.sessionId,
    this.chargerName,
    this.onDone,
    this.onDoneWithSessions,
    this.pollingEnabled = true,
    this.pollInterval = const Duration(seconds: 3),
    this.liveApiPollInterval = const Duration(seconds: 30),
    this.live,
    this.api,
    this.storage,
  });

  final ActiveSession? initialSession;
  final String? sessionId;
  final String? chargerName;
  final VoidCallback? onDone;
  final ValueChanged<List<ActiveSession>>? onDoneWithSessions;
  final bool pollingEnabled;
  final Duration pollInterval;

  /// While live data is flowing the API is read this often (completion, energy and cost still come from it); the
  /// established fast cadence resumes as soon as live data is unavailable. Unused without a live client.
  final Duration liveApiPollInterval;

  /// The shared live adapter. Null = built from the build-time STRAUMVAKT_LIVE_URL, which is empty (disabled) by default.
  final DriverLiveClient? live;
  final StraumvaktApi? api;
  final SessionStorage? storage;

  @override
  State<ActiveSessionScreen> createState() => _ActiveSessionScreenState();
}

class _ActiveSessionScreenState extends State<ActiveSessionScreen> {
  late final StraumvaktApi _api = widget.api ?? StraumvaktApi();
  late final SessionStorage _storage = widget.storage ?? AuthStorage();
  late final bool _ownsApi = widget.api == null;
  Timer? _poll;
  late final DriverLiveClient? _live = widget.live ?? _defaultLive();
  late final bool _ownsLive = widget.live == null && _live != null;
  int _skippedTicks = 0;
  ActiveSession? _session;
  Future<DriverSessionDetail>? _detailFuture;
  bool _hasSeenSession = false;
  bool _stopping = false;
  bool _ended = false;
  List<ActiveSession> _remainingSessions = const [];
  String? _error;

  String? get _trackedId =>
      _session?.sessionId ??
      widget.initialSession?.sessionId ??
      widget.sessionId;

  static const _liveUrl = String.fromEnvironment('STRAUMVAKT_LIVE_URL');

  DriverLiveClient? _defaultLive() {
    if (_liveUrl.isEmpty || !widget.pollingEnabled) return null;
    return DriverLiveClient(baseUrl: _liveUrl, tokenProvider: _storage.readAccessToken);
  }

  void _onLive() {
    if (mounted) setState(() {});
  }

  @override
  void initState() {
    super.initState();
    _session = widget.initialSession;
    _hasSeenSession = _session != null;
    if (widget.pollingEnabled) {
      _tick();
      _poll = Timer.periodic(widget.pollInterval, (_) {
        // Live data is flowing: the API is only a slower cross-check (every N ticks). Otherwise the established cadence applies.
        final live = _live;
        final every = (widget.liveApiPollInterval.inMicroseconds ~/ widget.pollInterval.inMicroseconds).clamp(1, 1 << 20);
        if (live != null && live.enabled && live.isLive && !live.degraded && ++_skippedTicks < every) return;
        _skippedTicks = 0;
        _tick();
      });
      _live?.addListener(_onLive);
      if (_live?.enabled ?? false) unawaited(_live!.start());
    }
  }

  @override
  void dispose() {
    _poll?.cancel();
    _live?.removeListener(_onLive);
    if (_ownsLive) _live!.dispose();
    if (_ownsApi) _api.close();
    super.dispose();
  }

  Future<void> _tick() async {
    if (_ended) return;
    try {
      final token = await _storage.readAccessToken();
      if (token == null) throw ApiException(401, 'Please sign in again.');
      final sessions = await _api.getCurrentSessions(token);
      if (!mounted) return;

      ActiveSession? current;
      final id = _trackedId;
      if (id != null) {
        for (final session in sessions) {
          if (session.sessionId == id) {
            current = session;
            break;
          }
        }
      }
      // Once a session identity is known, never silently switch to another
      // active row. The missing tracked row is the completion signal for
      // that charge, even when the driver has another session in progress.
      if (id == null && sessions.isNotEmpty) current = sessions.first;

      if (current == null) {
        if (_hasSeenSession) await _finish(token, sessions);
        return;
      }
      setState(() {
        _session = current;
        _hasSeenSession = true;
        _error = null;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _error = error is ApiException
            ? error.message
            : 'Live information is temporarily unavailable.';
      });
    }
  }

  Future<void> _finish(
    String token,
    List<ActiveSession> remainingSessions,
  ) async {
    _poll?.cancel();
    final id = _trackedId;
    setState(() {
      _ended = true;
      _stopping = false;
      _error = null;
      _remainingSessions = List.unmodifiable(remainingSessions);
      if (id != null) {
        _detailFuture = _api.getSessionDetail(
          accessToken: token,
          sessionId: id,
        );
      }
    });
  }

  Future<void> _stop() async {
    final id = _trackedId;
    if (id == null || _stopping) return;
    setState(() {
      _stopping = true;
      _error = null;
    });
    try {
      final token = await _storage.readAccessToken();
      if (token == null) throw ApiException(401, 'Please sign in again.');
      final result = await _api.stopSession(accessToken: token, sessionId: id);
      if (!mounted) return;
      setState(() {
        if (result.session != null) _session = result.session;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _stopping = false;
        _error = error is ApiException
            ? error.message
            : 'The stop request could not be sent.';
      });
    }
  }

  void _done() {
    if (widget.onDoneWithSessions != null) {
      widget.onDoneWithSessions!(_remainingSessions);
    } else if (widget.onDone != null) {
      widget.onDone!();
    } else {
      Navigator.of(context).maybePop();
    }
  }

  String _elapsed(DateTime? start) {
    if (start == null) return 'Starting';
    final duration = DateTime.now().difference(start);
    final hours = duration.inHours;
    final minutes = duration.inMinutes % 60;
    return hours > 0 ? '${hours}h ${minutes}m' : '${minutes}m';
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(_ended ? 'Charge complete' : 'Charging'),
        automaticallyImplyLeading: widget.onDone == null,
      ),
      body: SafeArea(child: _ended ? _endedBody() : _activeBody()),
    );
  }

  /// Live power when a fresh measured value exists for THIS charge; the API value (normally a placeholder) otherwise. An expired
  /// observation says so - it means nothing recent was heard, not that the charger is disconnected.
  String _powerLabel(ActiveSession? session) {
    final live = _live;
    if (live != null && live.enabled) {
      final kw = live.observedPowerKw(session?.connectorId);
      if (kw != null) return '${kw.toStringAsFixed(1)} kW (live)';
      if (live.isOutdated(session?.connectorId)) return 'Outdated';
    }
    return session?.powerKw == null ? 'Unavailable' : '${session!.powerKw!.toStringAsFixed(1)} kW';
  }

  Widget _activeBody() {
    final session = _session;
    final textScale = MediaQuery.textScalerOf(context).scale(1);
    final name = session?.chargerName ?? widget.chargerName ?? 'Your charger';
    final status = session == null
        ? 'Waiting for the charger to confirm the session'
        : session.connectorStatus.label;

    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 16, 20, 28),
      children: [
        Center(
          child: Container(
            width: 116,
            height: 116,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: BrandPalette.mint.withValues(alpha: 0.12),
              border: Border.all(color: BrandPalette.mint, width: 2),
            ),
            child: const Icon(
              Icons.bolt_rounded,
              size: 52,
              color: BrandPalette.mint,
            ),
          ),
        ),
        const SizedBox(height: 20),
        Text(
          name,
          textAlign: TextAlign.center,
          style: const TextStyle(
            color: Colors.white,
            fontSize: 22,
            fontWeight: FontWeight.w900,
          ),
        ),
        const SizedBox(height: 5),
        Text(
          status,
          textAlign: TextAlign.center,
          style: const TextStyle(color: BrandPalette.muted),
        ),
        const SizedBox(height: 26),
        GridView.count(
          crossAxisCount: 2,
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          mainAxisSpacing: 10,
          crossAxisSpacing: 10,
          childAspectRatio: textScale > 1.5 ? 1.2 : 1.55,
          children: [
            _Metric(
              label: 'Energy delivered',
              value: session?.energyKwh == null
                  ? 'Waiting'
                  : '${session!.energyKwh!.toStringAsFixed(2)} kWh',
              color: BrandPalette.mint,
            ),
            _Metric(
              label: 'Elapsed',
              value: _elapsed(session?.startedAt),
              color: Colors.white,
            ),
            _Metric(
              label: 'Observed power',
              value: _powerLabel(session),
              color: BrandPalette.cyan,
            ),
            _Metric(
              label: 'Current cost',
              value: session?.costLabel ?? 'Pending',
              color: BrandPalette.amber,
            ),
          ],
        ),
        const SizedBox(height: 12),
        const Text(
          'Power is shown only when a measured live value is available. '
          'Final pricing is confirmed after the session closes.',
          style: TextStyle(color: BrandPalette.muted, fontSize: 12),
        ),
        if (_stopping) ...[
          const SizedBox(height: 18),
          const Text(
            'Stop requested. Waiting for the charger to finish safely.',
            textAlign: TextAlign.center,
            style: TextStyle(color: BrandPalette.amber),
          ),
        ],
        if (_error != null) ...[
          const SizedBox(height: 18),
          Text(
            _error!,
            textAlign: TextAlign.center,
            style: const TextStyle(color: BrandPalette.danger),
          ),
        ],
        const SizedBox(height: 24),
        FilledButton.icon(
          onPressed: _trackedId == null || _stopping ? null : _stop,
          style: FilledButton.styleFrom(
            backgroundColor: BrandPalette.danger,
            foregroundColor: Colors.white,
            padding: const EdgeInsets.symmetric(vertical: 16),
          ),
          icon: _stopping
              ? const SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(
                    strokeWidth: 2,
                    color: Colors.white,
                  ),
                )
              : const Icon(Icons.stop_rounded),
          label: Text(_stopping ? 'Stopping' : 'Stop charging'),
        ),
      ],
    );
  }

  Widget _endedBody() {
    final future = _detailFuture;
    if (future == null) {
      return _EndedFallback(onDone: _done);
    }
    return FutureBuilder<DriverSessionDetail>(
      future: future,
      builder: (context, snapshot) {
        if (snapshot.connectionState == ConnectionState.waiting) {
          return const Center(
            child: CircularProgressIndicator(color: BrandPalette.mint),
          );
        }
        if (snapshot.hasError) return _EndedFallback(onDone: _done);
        return Column(
          children: [
            Expanded(
              child: SessionSettlementView(detail: snapshot.requireData),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 0, 20, 20),
              child: SizedBox(
                width: double.infinity,
                child: FilledButton(
                  onPressed: _done,
                  child: const Text('Done'),
                ),
              ),
            ),
          ],
        );
      },
    );
  }
}

class _Metric extends StatelessWidget {
  const _Metric({
    required this.label,
    required this.value,
    required this.color,
  });

  final String label;
  final String value;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: '$label: $value',
      excludeSemantics: true,
      child: Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: BrandPalette.surface,
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: BrandPalette.border),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Text(
              label,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(color: BrandPalette.muted, fontSize: 11),
            ),
            const SizedBox(height: 7),
            FittedBox(
              fit: BoxFit.scaleDown,
              alignment: Alignment.centerLeft,
              child: Text(
                value,
                style: TextStyle(
                  color: color,
                  fontSize: 18,
                  fontWeight: FontWeight.w900,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _EndedFallback extends StatelessWidget {
  const _EndedFallback({required this.onDone});

  final VoidCallback onDone;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(28),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(
              Icons.check_circle_rounded,
              size: 64,
              color: BrandPalette.mint,
            ),
            const SizedBox(height: 16),
            const Text(
              'Charging finished',
              style: TextStyle(
                color: Colors.white,
                fontSize: 22,
                fontWeight: FontWeight.w900,
              ),
            ),
            const SizedBox(height: 8),
            const Text(
              'Final energy and pricing are still being prepared. '
              'They will appear in Activity when available.',
              textAlign: TextAlign.center,
              style: TextStyle(color: BrandPalette.muted),
            ),
            const SizedBox(height: 24),
            SizedBox(
              width: double.infinity,
              child: FilledButton(onPressed: onDone, child: const Text('Done')),
            ),
          ],
        ),
      ),
    );
  }
}
