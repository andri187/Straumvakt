"use client";

// Driver web auth — bearer-token, browser-side (ADR 0033). Reuses the same
// /api/driver/* endpoints as the mobile app. The access token lives in
// localStorage; there is no cookie session for drivers.

const TOKEN_KEY = "sv_driver_access";

const HOSTMAP: Record<string, string> = {
  "straumvakt.org": "https://api.straumvakt.org",
  "www.straumvakt.org": "https://api.straumvakt.org",
  "hlada-staging.straumvakt.workers.dev": "https://hlada-api-staging.straumvakt.workers.dev",
  "hlada.straumvakt.workers.dev": "https://hlada-api.straumvakt.workers.dev",
};

function apiBase(): string {
  if (typeof window === "undefined") return "";
  return HOSTMAP[window.location.hostname] ?? "";
}

export class DriverAuthError extends Error {
  constructor() {
    super("driver_unauthenticated");
    this.name = "DriverAuthError";
  }
}

export function getDriverToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY);
}
export function setDriverToken(t: string): void {
  window.localStorage.setItem(TOKEN_KEY, t);
}
export function clearDriverToken(): void {
  window.localStorage.removeItem(TOKEN_KEY);
}

export type DriverProfile = {
  id: string;
  email: string;
  displayName: string;
  locale?: string | null;
  organizationName?: string | null;
};

export async function driverLogin(email: string, password: string): Promise<DriverProfile> {
  const res = await fetch(`${apiBase()}/api/driver/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = (await res.json().catch(() => null)) as
    | { accessToken: string; driver: DriverProfile }
    | { error?: string; message?: string }
    | null;
  if (!res.ok || !body || !("accessToken" in body)) {
    const e = body as { error?: string; message?: string } | null;
    throw new Error(e?.message || e?.error || "Innskráning mistókst");
  }
  setDriverToken(body.accessToken);
  return body.driver;
}

export async function driverFetch<T>(path: string): Promise<T> {
  const token = getDriverToken();
  const res = await fetch(`${apiBase()}${path}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  if (res.status === 401) {
    clearDriverToken();
    throw new DriverAuthError();
  }
  const body = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) {
    const e = body as { error?: string; message?: string } | null;
    throw new Error(e?.message || e?.error || `HTTP ${res.status}`);
  }
  return body as T;
}

export async function driverPost<T>(path: string, body: unknown): Promise<T> {
  const token = getDriverToken();
  const res = await fetch(`${apiBase()}${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (res.status === 401) {
    clearDriverToken();
    throw new DriverAuthError();
  }
  const parsed = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) {
    const e = parsed as { error?: string; message?: string } | null;
    throw new Error(e?.message || e?.error || `HTTP ${res.status}`);
  }
  return parsed as T;
}
