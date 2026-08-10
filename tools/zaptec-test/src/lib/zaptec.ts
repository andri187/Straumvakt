import { readFileSync, existsSync } from "node:fs";

// ── .env loader (no dotenv dependency) ──────────────────────────────────────
function loadEnvOnce() {
  if ((globalThis as { __zaptec_env_loaded?: boolean }).__zaptec_env_loaded) return;
  (globalThis as { __zaptec_env_loaded?: boolean }).__zaptec_env_loaded = true;
  if (!existsSync(".env")) return;
  for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*["']?(.*?)["']?\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
}

const BASE = "https://api.zaptec.com";

// ── Token cache (process-lifetime) ──────────────────────────────────────────
type Tok = { value: string; expiresAt: number };
let cached: Tok | null = null;

async function getToken(): Promise<string> {
  loadEnvOnce();
  const now = Date.now();
  if (cached && cached.expiresAt > now + 60_000) return cached.value;

  const username = process.env.ZAPTEC_USERNAME;
  const password = process.env.ZAPTEC_PASSWORD;
  if (!username || !password) {
    throw new Error("ZAPTEC_USERNAME / ZAPTEC_PASSWORD missing from .env");
  }

  const res = await fetch(`${BASE}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "password",
      username,
      password,
      scope: "openid",
    }),
  });
  if (!res.ok) {
    throw new Error(`Zaptec OAuth ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as { access_token: string; expires_in: number };
  cached = {
    value: data.access_token,
    expiresAt: now + data.expires_in * 1000,
  };
  return cached.value;
}

async function zget<T>(path: string): Promise<T> {
  const token = await getToken();
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`GET ${path} -> ${res.status}: ${await res.text()}`);
  }
  return res.json() as Promise<T>;
}

// ── Domain types ─────────────────────────────────────────────────────────────
export type Installation = {
  Id: string;
  Name: string;
  Address?: string;
  City?: string;
  ZipCode?: string;
  ActiveChargerCount?: number;
  MaxCurrent?: number;
  AvailableCurrent?: number;
  NetworkType?: number;
  IsRequiredAuthentication?: boolean;
  UseLoadBalancing?: boolean;
  OcppCloudUrl?: string;
  TimeZoneIanaName?: string;
  CreatedOnDate?: string;
  UpdatedOn?: string;
  [k: string]: unknown;
};

export type Charger = {
  Id: string;
  Name: string;
  SerialNo?: string;
  IsOnline?: boolean;
  DeviceType?: number;
  InstallationId?: string;
  InstallationName?: string;
  Active?: boolean;
  MID?: string;
  DeviceId?: string;
  CreatedOnDate?: string;
  [k: string]: unknown;
};

export type StateObservation = {
  ChargerId?: string;
  StateId: number;
  Timestamp?: string;
  ValueAsString?: string;
};

// ── High-level queries ──────────────────────────────────────────────────────
export async function listInstallations(): Promise<Installation[]> {
  const data = await zget<{ Data: Installation[] }>("/api/installation");
  return data.Data ?? [];
}

export async function getInstallation(id: string): Promise<Installation> {
  return zget<Installation>(`/api/installation/${id}`);
}

export async function listChargers(installationId?: string): Promise<Charger[]> {
  const qs = installationId ? `?InstallationId=${installationId}` : "";
  const data = await zget<{ Data: Charger[] }>(`/api/chargers${qs}`);
  return data.Data ?? [];
}

export async function getCharger(id: string): Promise<Charger> {
  return zget<Charger>(`/api/chargers/${id}`);
}

export async function getChargerState(id: string): Promise<StateObservation[]> {
  return zget<StateObservation[]>(`/api/chargers/${id}/state`);
}

// ── Hierarchy (installation → circuits → chargers) ──────────────────────────
// Note: OpenAPI spec claims lowercase, but the real response is PascalCase.
export type HierarchyCharger = {
  Id: string;
  Name?: string | null;
  DeviceId?: string | null;
  SerialNo?: string | null;
  MID?: string | null;
  Active?: boolean | null;
  DeviceType?: number | null;
};

export type HierarchyCircuit = {
  Id: string;
  Name?: string | null;
  MaxCurrent?: number;
  IsActive?: boolean;
  InstallationId: string;
  InstallationName?: string | null;
  Chargers?: HierarchyCharger[] | null;
};

export type Hierarchy = {
  Id: string;
  Name?: string | null;
  NetworkType?: number | null;
  Circuits?: HierarchyCircuit[] | null;
};

export async function getInstallationHierarchy(id: string): Promise<Hierarchy> {
  return zget<Hierarchy>(`/api/installation/${id}/hierarchy`);
}

// ── Charge history (sessions) ───────────────────────────────────────────────
export type ChargeFirmwareVersion = {
  Major: number;
  Minor: number;
  Build: number;
  Revision: number;
  MajorRevision: number;
  MinorRevision: number;
};

export type ChargeHistoryEntry = {
  Id: string;
  ChargerId: string;
  DeviceId?: string;
  DeviceName?: string;
  StartDateTime: string;
  EndDateTime?: string;
  CommitEndDateTime?: string;
  Energy: number; // kWh
  CommitMetadata?: number;
  ExternalId?: string;
  ExternallyEnded?: boolean;
  ChargerFirmwareVersion?: ChargeFirmwareVersion;
  SignedSession?: string; // OCMF blob
};

export async function listChargeHistory(opts: {
  chargerId?: string;
  installationId?: string;
  pageSize?: number;
  pageIndex?: number;
}): Promise<{ Pages: number; Data: ChargeHistoryEntry[] }> {
  const qs = new URLSearchParams();
  if (opts.chargerId) qs.set("ChargerId", opts.chargerId);
  if (opts.installationId) qs.set("InstallationId", opts.installationId);
  qs.set("PageSize", String(opts.pageSize ?? 10));
  qs.set("PageIndex", String(opts.pageIndex ?? 0));
  qs.set("SortDescending", "true");
  qs.set("SortProperty", "StartDateTime");
  return zget<{ Pages: number; Data: ChargeHistoryEntry[] }>(
    `/api/chargehistory?${qs.toString()}`,
  );
}

// ── Firmware status (per installation) ──────────────────────────────────────
export type ChargerFirmwareEntry = {
  ChargerId: string;
  DeviceId?: string;
  IsOnline?: boolean;
  CurrentVersion?: string;
  AvailableVersion?: string;
  DeviceType?: number;
  IsUpToDate?: boolean;
};

export async function getInstallationFirmware(
  installationId: string,
): Promise<ChargerFirmwareEntry[]> {
  return zget<ChargerFirmwareEntry[]>(
    `/api/chargerFirmware/installation/${installationId}`,
  );
}

// ── Messaging connection details (Azure Service Bus AMQP) ───────────────────
// Returned credentials are Service Bus shared-access — never display the
// Password value to users. Only surface Host / Topic to demonstrate that
// real-time push is available.
export type MessagingConnectionDetails = {
  Type: number;
  Host: string;
  Port: number;
  UseSSL: boolean;
  Username: string;
  Password: string; // SECRET — do not render
  Topic: string;
  Subscription: string;
};

export async function getInstallationMessaging(
  installationId: string,
): Promise<MessagingConnectionDetails> {
  return zget<MessagingConnectionDetails>(
    `/api/installation/${installationId}/messagingConnectionDetails`,
  );
}

// ── Charger commands ────────────────────────────────────────────────────────
export const ChargerCommandId = {
  Restart: 102,
  UpgradeFirmware: 200,
  StopOrPause: 506,
  Resume: 507,
  DeauthorizeAndStop: 10001,
} as const;

export type ChargerCommandId = (typeof ChargerCommandId)[keyof typeof ChargerCommandId];

export async function sendChargerCommand(
  chargerId: string,
  commandId: number,
): Promise<{ ok: boolean; status: number; body: string }> {
  const token = await getToken();
  const res = await fetch(
    `${BASE}/api/chargers/${chargerId}/sendCommand/${commandId}`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    },
  );
  const body = await res.text();
  return { ok: res.ok, status: res.status, body };
}
