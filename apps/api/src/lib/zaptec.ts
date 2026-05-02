// Zaptec API client — minimal slice used by /api/admin/zaptec/discover
// and /api/admin/zaptec/import. No persistent state; credentials are
// exchanged for a short-lived access token per call.

const ZAPTEC_BASE = "https://api.zaptec.com";

export type ZaptecError =
  | { kind: "unreachable" }
  | { kind: "invalid_credentials" }
  | { kind: "oauth"; status: number }
  | { kind: "list"; status: number }
  | { kind: "no_token" };

export type ZaptecResult<T> = { ok: true; value: T } | { ok: false; error: ZaptecError };

export async function getZaptecAccessToken(
  username: string,
  password: string,
): Promise<ZaptecResult<string>> {
  const tokenRes = await fetch(`${ZAPTEC_BASE}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "password",
      username,
      password,
      scope: "openid",
    }),
  }).catch(() => null);

  if (!tokenRes) return { ok: false, error: { kind: "unreachable" } };
  if (!tokenRes.ok) {
    if (tokenRes.status === 400 || tokenRes.status === 401) {
      return { ok: false, error: { kind: "invalid_credentials" } };
    }
    return { ok: false, error: { kind: "oauth", status: tokenRes.status } };
  }
  const tokenJson = (await tokenRes.json().catch(() => null)) as
    | { access_token?: string }
    | null;
  if (!tokenJson?.access_token) return { ok: false, error: { kind: "no_token" } };
  return { ok: true, value: tokenJson.access_token };
}

export type ZaptecInstallationSummary = {
  Id?: string;
  Name?: string;
  Address?: string;
  City?: string;
  ZipCode?: string;
  ActiveChargerCount?: number;
  MaxCurrent?: number;
  TimeZoneIanaName?: string;
};

export type ZaptecHierarchyCharger = {
  Id?: string;
  Name?: string | null;
  SerialNo?: string | null;
  DeviceId?: string | null;
  MID?: string | null;
  Active?: boolean | null;
};

export type ZaptecHierarchyCircuit = {
  Id?: string;
  Name?: string | null;
  MaxCurrent?: number;
  IsActive?: boolean;
  Chargers?: ZaptecHierarchyCharger[] | null;
};

export type ZaptecHierarchy = {
  Id?: string;
  Circuits?: ZaptecHierarchyCircuit[] | null;
};

export async function listInstallations(
  accessToken: string,
): Promise<ZaptecResult<ZaptecInstallationSummary[]>> {
  const res = await fetch(`${ZAPTEC_BASE}/api/installation`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  }).catch(() => null);
  if (!res) return { ok: false, error: { kind: "unreachable" } };
  if (!res.ok) return { ok: false, error: { kind: "list", status: res.status } };
  const json = (await res.json().catch(() => null)) as
    | { Data?: ZaptecInstallationSummary[] }
    | null;
  return { ok: true, value: json?.Data ?? [] };
}

export async function getInstallationHierarchy(
  accessToken: string,
  installationId: string,
): Promise<ZaptecResult<ZaptecHierarchy | null>> {
  const res = await fetch(
    `${ZAPTEC_BASE}/api/installation/${installationId}/hierarchy`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  ).catch(() => null);
  if (!res) return { ok: false, error: { kind: "unreachable" } };
  if (!res.ok) return { ok: false, error: { kind: "list", status: res.status } };
  const json = (await res.json().catch(() => null)) as ZaptecHierarchy | null;
  return { ok: true, value: json };
}

/**
 * GET /api/chargers/{id} — per-charger detail. Includes the
 * (secret) OcppInitialChargePointPassword + property-level OCPP
 * config flags. Caller is responsible for stripping the password
 * before returning to clients (see Zaptec docs ADR-style note).
 *
 * Return type is unstructured Record<string, unknown> on purpose —
 * the response has ~30 fields and we don't want to define a brittle
 * full-shape type just for diagnostics.
 */
export async function getChargerDetail(
  accessToken: string,
  chargerId: string,
): Promise<ZaptecResult<Record<string, unknown> | null>> {
  const res = await fetch(`${ZAPTEC_BASE}/api/chargers/${chargerId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  }).catch(() => null);
  if (!res) return { ok: false, error: { kind: "unreachable" } };
  if (!res.ok) return { ok: false, error: { kind: "list", status: res.status } };
  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  return { ok: true, value: json };
}

/**
 * Generic GET helper that returns the raw response body and status —
 * used by the diagnostic route to probe undocumented or
 * partially-documented endpoints (e.g. /api/userGroups). Caller
 * decides how to interpret the payload.
 */
export async function rawZaptecGet(
  accessToken: string,
  path: string,
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${ZAPTEC_BASE}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  }).catch(() => null);
  if (!res) return { status: 0, body: { error: "unreachable" } };
  const text = await res.text().catch(() => "");
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* keep as text */
  }
  return { status: res.status, body };
}

/**
 * PUT /api/chargers/{id} — write Property* fields on a charger.
 * Body is keyed by the property name (e.g. `PropertyAuthenticationDisabled`,
 * `PropertyOcppDefaultIdTag`). Returns the updated charger detail.
 *
 * NOTE on the previously-tried POST /api/chargers/{id}/update path:
 * that endpoint accepts writes and returns 200 but silently no-ops
 * for Property* fields regardless of the body shape (probed every
 * variation: StateId-keyed, name-keyed, envelope, with/without
 * string-coerced values — none of them changed PropertyAuthenticationDisabled).
 * The Zaptec UI flips Property* via PUT, which DOES persist (verified
 * round-trip on A2 ZPR042727 — PropertyAuthenticationDisabled:
 * true → false → true). Stick with PUT for any property write.
 */
export async function putChargerProperties(
  accessToken: string,
  chargerId: string,
  body: Record<string, string | boolean | number>,
): Promise<ZaptecResult<Record<string, unknown>>> {
  const res = await fetch(`${ZAPTEC_BASE}/api/chargers/${chargerId}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  }).catch(() => null);
  if (!res) return { ok: false, error: { kind: "unreachable" } };
  if (!res.ok) return { ok: false, error: { kind: "list", status: res.status } };
  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  return { ok: true, value: json ?? {} };
}

/**
 * GET /api/chargers — bulk list of chargers visible to this token.
 * Returns ~17 fields per charger including `IsOnline`. One call per
 * credential is dramatically cheaper than per-charger detail when the
 * caller only needs Zaptec's reachability flag (e.g. for the sites
 * tree's API-active emblem). Pagination is via the `Pages` envelope
 * Zaptec returns; default page size is large enough for typical
 * fleets so we don't paginate yet.
 */
export interface ZaptecChargerLite {
  Id?: string;
  DeviceId?: string | null;
  SerialNo?: string | null;
  Name?: string | null;
  IsOnline?: boolean;
  Active?: boolean;
  InstallationId?: string;
  CircuitId?: string;
  /**
   * Reflects the AuthenticationRequired flag (StateId 120). True when
   * Zaptec is configured to send OCPP Basic-Auth on the WSS upgrade,
   * false when it connects anonymously. We write this via
   * updateChargerSettings({"120": "true|false"}) and read it via
   * IsAuthorizationRequired on the bulk + detail responses.
   */
  IsAuthorizationRequired?: boolean;
  /** Auth mode enum: 0=None, 1=Vendor app, 2=OCPP cloud, 3=Native OCPP. */
  AuthenticationType?: number;
  /**
   * ChargerOperationMode — same enum as StateId 710 on /state. Carries
   * the last-reported value even for offline chargers, which makes
   * bulk the right source for a per-charger status pill (no extra
   * round trip). Values: 0=Unknown, 1=Disconnected, 2=Requesting,
   * 3=Charging, 5=Finished, 6=Limited.
   */
  OperatingMode?: number;
}
export async function listChargers(
  accessToken: string,
): Promise<ZaptecResult<ZaptecChargerLite[]>> {
  const res = await fetch(`${ZAPTEC_BASE}/api/chargers`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  }).catch(() => null);
  if (!res) return { ok: false, error: { kind: "unreachable" } };
  if (!res.ok) return { ok: false, error: { kind: "list", status: res.status } };
  const json = (await res.json().catch(() => null)) as
    | { Data?: ZaptecChargerLite[] }
    | ZaptecChargerLite[]
    | null;
  if (Array.isArray(json)) return { ok: true, value: json };
  return { ok: true, value: json?.Data ?? [] };
}

/**
 * GET /api/chargers/{id}/state — array of `{ StateId, ValueAsString,
 * Timestamp }` observation entries. Negative IDs (-2 IsOnline, -3
 * IsOcppConnected, -100 AuthorizationCache) are synthetic. Full
 * id catalogue in docs/reference/integrations/zaptec.md §5.
 */
export interface ZaptecStateEntry {
  StateId: number;
  ValueAsString?: string | null;
  Timestamp?: string;
}
export async function getChargerState(
  accessToken: string,
  chargerId: string,
): Promise<ZaptecResult<ZaptecStateEntry[]>> {
  const res = await fetch(`${ZAPTEC_BASE}/api/chargers/${chargerId}/state`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  }).catch(() => null);
  if (!res) return { ok: false, error: { kind: "unreachable" } };
  if (!res.ok) return { ok: false, error: { kind: "list", status: res.status } };
  const json = (await res.json().catch(() => null)) as ZaptecStateEntry[] | null;
  return { ok: true, value: json ?? [] };
}

export async function getInstallationSummary(
  accessToken: string,
  installationId: string,
): Promise<ZaptecResult<ZaptecInstallationSummary | null>> {
  const res = await fetch(`${ZAPTEC_BASE}/api/installation/${installationId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  }).catch(() => null);
  if (!res) return { ok: false, error: { kind: "unreachable" } };
  if (!res.ok) return { ok: false, error: { kind: "list", status: res.status } };
  const json = (await res.json().catch(() => null)) as
    | ZaptecInstallationSummary
    | null;
  return { ok: true, value: json };
}
