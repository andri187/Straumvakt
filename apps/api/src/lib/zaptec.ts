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
 * POST /api/chargers/{id}/update — write a subset of observation IDs.
 * Body is a flat object keyed by Zaptec StateId number → string value
 * (e.g. `{ "120": "true" }` to flip AuthenticationRequired). The
 * settable IDs are listed in `docs/reference/integrations/zaptec.md`
 * §13.16. Zaptec applies the change asynchronously — the response is
 * accept-only; verify by re-fetching detail or state after a few
 * seconds.
 */
export async function updateChargerSettings(
  accessToken: string,
  chargerId: string,
  body: Record<string, string | boolean | number>,
): Promise<ZaptecResult<true>> {
  const res = await fetch(`${ZAPTEC_BASE}/api/chargers/${chargerId}/update`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  }).catch(() => null);
  if (!res) return { ok: false, error: { kind: "unreachable" } };
  if (!res.ok) return { ok: false, error: { kind: "list", status: res.status } };
  return { ok: true, value: true };
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
