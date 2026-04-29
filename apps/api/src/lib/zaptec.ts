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
