// Live charging session screen (aligns with the web live screen).
//
// After a start-session request, the driver lands here. The screen polls
// GET /api/driver/sessions/current every ~3s and renders power / energy
// / cost / elapsed. A Stop button calls POST /api/driver/stop-session;
// once a stop is requested we keep polling until the session disappears
// (null) or reports a terminal status, then surface the "ended" state.

import 'dart:async';
import 'package:flutter/material.dart';
import '../api/auth_storage.dart';
import '../api/client.dart';
import '../api/types.dart';
import '../i18n/strings.dart';
import '../theme/palette.dart';

class ActiveSessionScreen extends StatefulWidget {
  const ActiveSessionScreen({
    super.key,
    this.sessionId,
    this.chargerName,
  });

  // Optional — known up-front only if a caller already has a session id.
  // The start-session flow does NOT (it returns a commandId), so the
  // screen discovers the live session id from the first /sessions/current
  // poll and uses that for the stop call.
  final String? sessionId;
  final String? chargerName;

  @override
  State<ActiveSessionScreen> createState() => _ActiveSessionScreenState();
}

class _ActiveSessionScreenState extends State<ActiveSessionScreen> {
  static const _pollInterval = Duration(seconds: 3);

  final _api = StraumvaktApi();
  final _storage = AuthStorage();

  Timer? _poll;
  ActiveSession? _session;
  bool _stopping = false;
  bool _ended = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _tick();
    _poll = Timer.periodic(_pollInterval, (_) => _tick());
  }

  @override
  void dispose() {
    _poll?.cancel();
    super.dispose();
  }

  Future<void> _tick() async {
    if (_ended) return;
    try {
      final token = await _storage.readAccessToken();
      if (token == null) return;
      final s = await _api.getCurrentSession(token);
      if (!mounted) return;
      if (s == null) {
        // No active session — either it ended on its own or our stop
        // request completed. Surface the ended state and stop polling.
        setState(() {
          _ended = true;
          _error = null;
        });
        _poll?.cancel();
        return;
      }
      setState(() {
        _session = s;
        _error = null;
      });
    } catch (e) {
      // Transient poll failures are non-fatal; keep the last snapshot.
      if (!mounted) return;
      setState(() => _error = e is ApiException ? e.message : null);
    }
  }

  Future<void> _stop() async {
    setState(() {
      _stopping = true;
      _error = null;
    });
    try {
      final token = await _storage.readAccessToken();
      if (token == null) throw ApiException(401, 'Session expired.');
      // Prefer the live polled session id; fall back to the one a caller
      // passed in. If neither exists yet, the poll hasn't landed — bail.
      final sessionId = _session?.sessionId ?? widget.sessionId;
      if (sessionId == null) {
        throw ApiException(409, tr('session.connecting'));
      }
      final result = await _api.stopSession(
        accessToken: token,
        sessionId: sessionId,
      );
      if (!mounted) return;
      // Keep the stopping flag true — we continue polling until the
      // session disappears. Adopt the snapshot the stop call returned.
      setState(() {
        if (result.session != null) _session = result.session;
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _stopping = false;
        _error = e.message;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _stopping = false;
        _error = tr('common.networkError');
      });
    }
  }

  String _fmtElapsed(DateTime? start) {
    if (start == null) return '—';
    final d = DateTime.now().difference(start);
    final h = d.inHours;
    final m = d.inMinutes % 60;
    final s = d.inSeconds % 60;
    if (h > 0) {
      return '${h}h ${m.toString().padLeft(2, '0')}m';
    }
    return '${m}m ${s.toString().padLeft(2, '0')}s';
  }

  @override
  Widget build(BuildContext context) {
    final s = _session;
    final name = s?.chargerName ?? widget.chargerName ?? tr('session.title');
    return Scaffold(
      appBar: AppBar(
        backgroundColor: BrandPalette.midnight,
        foregroundColor: Colors.white,
        elevation: 0,
        title: Text(tr('session.title')),
      ),
      body: SafeArea(
        child: _ended ? _buildEnded(context) : _buildActive(context, s, name),
      ),
    );
  }

  Widget _buildActive(BuildContext context, ActiveSession? s, String name) {
    final charging = s?.connectorStatus == ConnectorStatus.charging;
    return Padding(
      padding: const EdgeInsets.all(24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const SizedBox(height: 12),
          Center(
            child: _PulseRing(active: charging),
          ),
          const SizedBox(height: 24),
          Text(
            name,
            textAlign: TextAlign.center,
            style: const TextStyle(
              color: Colors.white,
              fontSize: 22,
              fontWeight: FontWeight.w900,
              letterSpacing: -0.4,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            s == null ? tr('session.connecting') : (s.connectorStatus.label),
            textAlign: TextAlign.center,
            style: const TextStyle(color: BrandPalette.muted, fontSize: 13),
          ),
          const SizedBox(height: 28),
          Row(
            children: [
              _Metric(
                label: tr('session.power'),
                value: s?.powerKw != null
                    ? '${s!.powerKw!.toStringAsFixed(1)} kW'
                    : '—',
                color: BrandPalette.cyan,
              ),
              _Metric(
                label: tr('session.energy'),
                value: s?.energyKwh != null
                    ? '${s!.energyKwh!.toStringAsFixed(2)} kWh'
                    : '—',
                color: BrandPalette.mint,
              ),
            ],
          ),
          const SizedBox(height: 14),
          Row(
            children: [
              _Metric(
                label: tr('session.cost'),
                value: s?.costIsk != null
                    ? '${s!.costIsk!.toStringAsFixed(0)} kr'
                    : '—',
                color: BrandPalette.amber,
              ),
              _Metric(
                label: tr('session.elapsed'),
                value: _fmtElapsed(s?.startedAt),
                color: BrandPalette.muted,
              ),
            ],
          ),
          const Spacer(),
          if (_stopping) ...[
            Text(
              tr('session.stopRequested'),
              textAlign: TextAlign.center,
              style: const TextStyle(color: BrandPalette.amber, fontSize: 13),
            ),
            const SizedBox(height: 10),
          ],
          if (_error != null) ...[
            Text(
              _error!,
              textAlign: TextAlign.center,
              style: const TextStyle(color: BrandPalette.danger, fontSize: 12),
            ),
            const SizedBox(height: 10),
          ],
          FilledButton.icon(
            onPressed: (_stopping ||
                    (s?.sessionId == null && widget.sessionId == null))
                ? null
                : _stop,
            style: FilledButton.styleFrom(
              backgroundColor: BrandPalette.danger,
              foregroundColor: Colors.white,
              padding: const EdgeInsets.symmetric(vertical: 16),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(14),
              ),
              textStyle:
                  const TextStyle(fontSize: 16, fontWeight: FontWeight.w900),
            ),
            icon: _stopping
                ? const SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      valueColor: AlwaysStoppedAnimation(Colors.white),
                    ),
                  )
                : const Icon(Icons.stop_rounded),
            label: Text(_stopping ? tr('session.stopping') : tr('session.stop')),
          ),
        ],
      ),
    );
  }

  Widget _buildEnded(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(32),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const Icon(Icons.check_circle_rounded,
              size: 72, color: BrandPalette.mint),
          const SizedBox(height: 18),
          Text(
            tr('session.ended'),
            style: const TextStyle(
              color: Colors.white,
              fontSize: 22,
              fontWeight: FontWeight.w900,
            ),
          ),
          if (_session?.energyKwh != null) ...[
            const SizedBox(height: 8),
            Text(
              '${_session!.energyKwh!.toStringAsFixed(2)} kWh'
              '${_session!.costIsk != null ? ' · ${_session!.costIsk!.toStringAsFixed(0)} kr' : ''}',
              style: const TextStyle(color: BrandPalette.muted, fontSize: 14),
            ),
          ],
          const SizedBox(height: 28),
          SizedBox(
            width: double.infinity,
            child: FilledButton(
              onPressed: () => Navigator.of(context).maybePop(),
              child: Text(tr('session.done')),
            ),
          ),
        ],
      ),
    );
  }
}

class _Metric extends StatelessWidget {
  const _Metric({required this.label, required this.value, required this.color});

  final String label;
  final String value;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Container(
        margin: const EdgeInsets.symmetric(horizontal: 4),
        padding: const EdgeInsets.symmetric(vertical: 18, horizontal: 12),
        decoration: BoxDecoration(
          color: BrandPalette.surface,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: BrandPalette.border),
        ),
        child: Column(
          children: [
            Text(
              label.toUpperCase(),
              style: const TextStyle(
                color: BrandPalette.muted,
                fontSize: 10,
                fontWeight: FontWeight.w800,
                letterSpacing: 1.2,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              value,
              style: TextStyle(
                color: color,
                fontSize: 20,
                fontWeight: FontWeight.w900,
                fontFeatures: const [FontFeature.tabularFigures()],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// Decorative pulsing ring — alive while charging, static otherwise.
class _PulseRing extends StatefulWidget {
  const _PulseRing({required this.active});
  final bool active;

  @override
  State<_PulseRing> createState() => _PulseRingState();
}

class _PulseRingState extends State<_PulseRing>
    with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1600),
  )..repeat(reverse: true);

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _c,
      builder: (context, _) {
        final t = widget.active ? _c.value : 0.0;
        return Container(
          width: 150,
          height: 150,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            gradient: LinearGradient(
              colors: [BrandPalette.mint, BrandPalette.cyan],
            ),
            boxShadow: [
              BoxShadow(
                color: BrandPalette.mint.withValues(alpha: 0.25 + 0.35 * t),
                blurRadius: 24 + 24 * t,
                spreadRadius: 2 + 6 * t,
              ),
            ],
          ),
          child: const Icon(Icons.bolt_rounded,
              size: 64, color: BrandPalette.midnight),
        );
      },
    );
  }
}
