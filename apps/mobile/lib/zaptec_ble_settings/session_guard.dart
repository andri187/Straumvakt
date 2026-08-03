// Settings access guard — a driver may not open a charger's settings
// while someone else is charging on it.
//
// The rule: settings access requires the charger to be free, OR the
// in-progress session to be the driver's own. Restarting or reconfiguring
// a charger mid-session interrupts whoever is plugged in, and over BLE
// there is no server in the loop to refuse it.
//
// WHERE THIS IS ENFORCED, AND WHERE IT MUST BE
//
// This is a CLIENT-SIDE guard. It exists so the driver gets a clear
// refusal before a connection is attempted, rather than a confusing
// failure afterwards. It is NOT the security boundary.
//
// The authoritative enforcement belongs in the backend's PIN-release
// endpoint: no PIN, no BLE session, no settings. That endpoint is a
// Rule 5 change (privilege-gated credential release) and is not built
// yet — until it is, a driver who already holds a cached PIN is bounded
// only by this check and by the cache TTL. That gap is deliberate and
// recorded, not overlooked.

import '../api/client.dart';
import '../api/types.dart';
import 'pin_store.dart';

enum SettingsAccess {
  /// Charger is free, or the running session belongs to this driver.
  allowed,

  /// Someone else is charging on it.
  busyWithOtherDriver,

  /// Could not establish the charger's state — fail closed.
  unknown,
}

class SettingsAccessResult {
  const SettingsAccessResult(this.access, [this.chargerName]);
  final SettingsAccess access;
  final String? chargerName;

  bool get isAllowed => access == SettingsAccess.allowed;
}

/// Statuses that mean a vehicle is attached and the charger is in use by
/// someone. `preparing` and `finishing` count: a session is underway even
/// if no current is flowing, and interrupting either still spoils it.
const _busy = {
  ConnectorStatus.preparing,
  ConnectorStatus.charging,
  ConnectorStatus.suspendedEv,
  ConnectorStatus.suspendedEvse,
  ConnectorStatus.finishing,
};

/// Decide whether [serial] may be opened by this driver.
///
/// Fails closed on every uncertainty — an unreachable API, a charger not
/// in the driver's list, or an unparseable state all return `unknown`
/// rather than `allowed`. A driver wrongly refused is inconvenienced; a
/// driver wrongly allowed interrupts a stranger's charge.
Future<SettingsAccessResult> checkSettingsAccess({
  required StraumvaktApi api,
  required String accessToken,
  required String serial,
  required ChargerPinStore pinStore,
}) async {
  final want = serial.trim().toUpperCase();

  try {
    final chargers = await api.getChargers(accessToken);

    // The PIN is an attribute of the access right, not of the device.
    // Every time we learn the driver's current charger set we drop the
    // cached PIN for anything no longer in it — so a revoked driver loses
    // local access on the next sync, not when a timer happens to expire.
    //
    // CRITICAL DISTINCTION. Reconciling requires knowing the driver's
    // serials. Two very different situations both yield an empty set:
    //
    //   • the driver genuinely has no chargers  → revoke everything
    //   • the API returned chargers but none carry an identifier we can
    //     match on → we simply do not know, and must not destroy
    //     credentials on the strength of missing data
    //
    // Today every charger comes back with `bleAdvertisingId = null`
    // (ADR 0024's addendum moved matching to serial-prefix, but
    // ble/scanner.dart still reads this field), so the second case is the
    // live one. Reconciling on it would wipe every stored PIN on every
    // sync. Only an EMPTY charger list is treated as "no access".
    final serials = <String>{
      for (final c in chargers)
        if ((c.bleAdvertisingId ?? '').isNotEmpty)
          c.bleAdvertisingId!.toUpperCase(),
    };
    if (chargers.isEmpty) {
      // Genuine revocation: no chargers at all.
      await pinStore.reconcile(const {});
    } else if (serials.isNotEmpty) {
      await pinStore.reconcile(serials);
    }
    // else: chargers exist but carry no matchable identifier — a data
    // gap, not a revocation. Leave the cache alone; the TTL still bounds it.

    DriverCharger? target;
    for (final c in chargers) {
      final adv = (c.bleAdvertisingId ?? '').toUpperCase();
      if (adv.isNotEmpty && (adv == want || adv.contains(want))) {
        target = c;
        break;
      }
    }

    // Not one of the driver's chargers. We cannot reason about whose
    // session is running on it, so we do not open it.
    if (target == null) {
      return const SettingsAccessResult(SettingsAccess.unknown);
    }

    if (!_busy.contains(target.status)) {
      return SettingsAccessResult(SettingsAccess.allowed, target.displayName);
    }

    // Busy — allowed only if the running session is this driver's own.
    final mine = await api.getCurrentSession(accessToken);
    if (mine != null && mine.connectorId == target.connectorId) {
      return SettingsAccessResult(SettingsAccess.allowed, target.displayName);
    }

    return SettingsAccessResult(
      SettingsAccess.busyWithOtherDriver,
      target.displayName,
    );
  } catch (_) {
    // Network failure, auth failure, anything: fail closed.
    return const SettingsAccessResult(SettingsAccess.unknown);
  }
}
