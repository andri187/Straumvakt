// API response shapes — mirrors the OpenAPI spec at
// /api/driver/* on the deployed Straumvakt API Worker.

class DriverProfile {
  const DriverProfile({
    required this.id,
    required this.email,
    required this.displayName,
    required this.locale,
    this.organizationName,
  });

  final String id;
  final String email;
  final String displayName;
  final String locale;
  final String? organizationName;

  factory DriverProfile.fromJson(Map<String, dynamic> json) {
    return DriverProfile(
      id: json['id'] as String,
      email: json['email'] as String,
      displayName: json['displayName'] as String,
      locale: json['locale'] as String,
      organizationName: json['organizationName'] as String?,
    );
  }
}

class AuthSession {
  const AuthSession({
    required this.accessToken,
    required this.refreshToken,
    required this.expiresInSeconds,
    required this.driver,
  });

  final String accessToken;
  final String refreshToken;
  final int expiresInSeconds;
  final DriverProfile driver;

  factory AuthSession.fromJson(Map<String, dynamic> json) {
    return AuthSession(
      accessToken: json['accessToken'] as String,
      refreshToken: json['refreshToken'] as String,
      expiresInSeconds: json['expiresInSeconds'] as int,
      driver: DriverProfile.fromJson(json['driver'] as Map<String, dynamic>),
    );
  }
}

enum ConnectorStatus {
  available,
  preparing,
  charging,
  suspendedEv,
  suspendedEvse,
  finishing,
  unavailable,
  faulted,
  offline,
  unknown;

  static ConnectorStatus fromString(String? raw) {
    switch (raw) {
      case 'Available':
        return ConnectorStatus.available;
      case 'Preparing':
        return ConnectorStatus.preparing;
      case 'Charging':
        return ConnectorStatus.charging;
      case 'SuspendedEV':
        return ConnectorStatus.suspendedEv;
      case 'SuspendedEVSE':
        return ConnectorStatus.suspendedEvse;
      case 'Finishing':
        return ConnectorStatus.finishing;
      case 'Unavailable':
        return ConnectorStatus.unavailable;
      case 'Faulted':
        return ConnectorStatus.faulted;
      case 'Offline':
        return ConnectorStatus.offline;
      default:
        return ConnectorStatus.unknown;
    }
  }

  String get label {
    switch (this) {
      case ConnectorStatus.available:
        return 'Available';
      case ConnectorStatus.preparing:
        return 'Preparing';
      case ConnectorStatus.charging:
        return 'Charging';
      case ConnectorStatus.suspendedEv:
        return 'Paused (vehicle)';
      case ConnectorStatus.suspendedEvse:
        return 'Paused (charger)';
      case ConnectorStatus.finishing:
        return 'Finishing';
      case ConnectorStatus.unavailable:
        return 'Unavailable';
      case ConnectorStatus.faulted:
        return 'Faulted';
      case ConnectorStatus.offline:
        return 'Offline';
      case ConnectorStatus.unknown:
        return 'Unknown';
    }
  }

  bool get canStart => this == ConnectorStatus.available;
}

class StartSessionResult {
  const StartSessionResult({
    required this.commandId,
    required this.status,
    this.tokenKind,
    this.tokenLabel,
  });

  final String commandId;
  final String status;
  // Which IdToken kind the backend used as the OCPP idTag — surfaced
  // so the UI can show "Started with virtual RFID" / "with VID RFID".
  final String? tokenKind;
  final String? tokenLabel;

  factory StartSessionResult.fromJson(Map<String, dynamic> json) {
    return StartSessionResult(
      commandId: json['commandId'] as String,
      status: json['status'] as String,
      tokenKind: json['tokenKind'] as String?,
      tokenLabel: json['tokenLabel'] as String?,
    );
  }

  String get tokenKindLabel {
    switch (tokenKind) {
      case 'evccid':
        return 'VID RFID';
      case 'rfid':
        return 'RFID card';
      case 'manual':
        return 'virtual RFID';
      default:
        return 'token';
    }
  }
}

// Result of consuming an invite (ADR 0026 §3/§5). Mirrors the
// POST /api/public/invites/consume response. The backend resolves the
// driver's email + org from the invite token; the mobile app captures
// kennitala + password at redemption time and sends them up.
class ConsumeInviteResult {
  const ConsumeInviteResult({
    required this.userId,
    required this.orgId,
    required this.email,
    this.pendingApproval = false,
  });

  final String userId;
  final String orgId;
  final String email;
  // True when the invite was configured with a host-admin allow-term
  // (ADR 0026 §3) — the membership is not active until the host approves.
  final bool pendingApproval;

  factory ConsumeInviteResult.fromJson(Map<String, dynamic> json) {
    return ConsumeInviteResult(
      userId: json['userId'] as String,
      orgId: json['orgId'] as String,
      email: json['email'] as String,
      pendingApproval: json['pendingApproval'] as bool? ?? false,
    );
  }
}

// Live charging session snapshot — polled from
// GET /api/driver/sessions/current every ~3s while a session is active.
class ActiveSession {
  const ActiveSession({
    required this.sessionId,
    required this.connectorId,
    required this.chargerName,
    required this.status,
    this.startedAt,
    this.powerKw,
    this.energyKwh,
    this.costIsk,
  });

  final String sessionId;
  final String connectorId;
  final String chargerName;
  // Raw OCPP-ish session status string, e.g. 'Charging', 'Preparing'.
  final String status;
  final DateTime? startedAt;
  final double? powerKw;
  final double? energyKwh;
  final double? costIsk;

  factory ActiveSession.fromJson(Map<String, dynamic> json) {
    return ActiveSession(
      sessionId: json['sessionId'] as String,
      connectorId: json['connectorId'] as String,
      chargerName: json['chargerName'] as String? ?? 'Charger',
      status: json['status'] as String? ?? 'Unknown',
      startedAt: json['startedAt'] != null
          ? DateTime.tryParse(json['startedAt'] as String)
          : null,
      powerKw: (json['powerKw'] as num?)?.toDouble(),
      energyKwh: (json['energyKwh'] as num?)?.toDouble(),
      costIsk: (json['costIsk'] as num?)?.toDouble(),
    );
  }

  ConnectorStatus get connectorStatus => ConnectorStatus.fromString(status);
}

// Result of POST /api/driver/stop-session — 202 accepted with the
// command id and the (now finishing) session snapshot.
class StopSessionResult {
  const StopSessionResult({
    required this.commandId,
    required this.status,
    this.session,
  });

  final String commandId;
  final String status;
  final ActiveSession? session;

  factory StopSessionResult.fromJson(Map<String, dynamic> json) {
    return StopSessionResult(
      commandId: json['commandId'] as String,
      status: json['status'] as String,
      session: json['session'] != null
          ? ActiveSession.fromJson(json['session'] as Map<String, dynamic>)
          : null,
    );
  }
}

class DriverCharger {
  const DriverCharger({
    required this.chargerId,
    required this.connectorId,
    required this.displayName,
    required this.locationName,
    required this.status,
    required this.maxPowerKw,
    this.priceLabel,
    this.bleAdvertisingId,
    this.bleAdvertisingKind,
  });

  final String chargerId;
  final String connectorId;
  final String displayName;
  final String locationName;
  final ConnectorStatus status;
  final double maxPowerKw;
  final String? priceLabel;

  // BLE tap-and-access (Sprint 9 / 2026-05-10)
  // bleAdvertisingId is what the charger broadcasts; the Flutter
  // scanner matches BLE devices by id and surfaces nearby chargers.
  // bleAdvertisingKind discriminates: 'zaptec_serial' | 'ibeacon_uuid' | 'mac'.
  final String? bleAdvertisingId;
  final String? bleAdvertisingKind;

  factory DriverCharger.fromJson(Map<String, dynamic> json) {
    return DriverCharger(
      chargerId: json['chargerId'] as String,
      connectorId: json['connectorId'] as String,
      displayName: json['displayName'] as String,
      locationName: json['locationName'] as String,
      status: ConnectorStatus.fromString(json['status'] as String?),
      maxPowerKw: (json['maxPowerKw'] as num).toDouble(),
      priceLabel: json['priceLabel'] as String?,
      bleAdvertisingId: json['bleAdvertisingId'] as String?,
      bleAdvertisingKind: json['bleAdvertisingKind'] as String?,
    );
  }
}

/// Tap & Auth — result of arming a tap intent (ADR 0024 addendum 2).
///
/// Arming declares "this driver is at this charger, now". It grants
/// nothing on its own: a session starts only when the charger
/// independently reports a physical tap over OCPP and the server joins
/// the two. See lib/tap/tap_intent.dart.
class TapIntentResult {
  const TapIntentResult({
    required this.intentId,
    required this.expiresAt,
    this.chargerName,
    this.ttlSeconds,
  });

  final String intentId;
  final DateTime expiresAt;
  final String? chargerName;
  final int? ttlSeconds;

  factory TapIntentResult.fromJson(Map<String, dynamic> json) {
    return TapIntentResult(
      intentId: json['intentId'] as String,
      expiresAt:
          DateTime.tryParse((json['expiresAt'] ?? '') as String)?.toLocal() ??
              DateTime.now().add(const Duration(seconds: 120)),
      chargerName: json['chargerName'] as String?,
      ttlSeconds: (json['ttlSeconds'] as num?)?.toInt(),
    );
  }
}
