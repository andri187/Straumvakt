// Server-component variant of apiFetch. Same shape as the client helper
// in ./api-client.ts but forwards the user's cookie header explicitly —
// `credentials: "include"` only works in a browser context. Server
// components on Workers need the Cookie header attached manually.
//
// Server-side fetch() also requires absolute URLs. If
// NEXT_PUBLIC_API_BASE_URL is set, we use it. Otherwise we derive
// scheme + host from the incoming request's headers so same-origin
// fetches resolve.

import { cookies, headers } from "next/headers";

// Same UI-host → API-host mapping as the browser client. Server
// components running in the UI Worker also need the API URL, and
// process.env.NEXT_PUBLIC_API_BASE_URL is not always populated by the
// CF build runner (NEXT_PUBLIC_* are inlined at build time). Reading
// the request's Host header at runtime gives us a robust fallback.
const HOSTNAME_TO_API: Record<string, string> = {
  "hlada-staging.straumvakt.workers.dev": "https://hlada-api-staging.straumvakt.workers.dev",
  "hlada.straumvakt.workers.dev": "https://hlada-api.straumvakt.workers.dev",
};

export async function apiFetchServer(path: string, init?: RequestInit): Promise<Response> {
  if (!path.startsWith("/")) {
    throw new Error(`apiFetchServer: path must start with "/" (got: ${path})`);
  }
  const envBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";
  let base = envBase;
  if (!base) {
    const h = await headers();
    const host = h.get("host");
    if (!host) {
      throw new Error(
        "apiFetchServer: NEXT_PUBLIC_API_BASE_URL not set and no Host header — cannot resolve absolute URL",
      );
    }
    const mapped = HOSTNAME_TO_API[host];
    if (mapped) {
      base = mapped;
    } else {
      const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
      base = `${proto}://${host}`;
    }
  }

  const jar = await cookies();
  const cookieHeader = jar
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");

  return fetch(`${base}${path}`, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...(cookieHeader ? { cookie: cookieHeader } : {}),
    },
  });
}

export type ApiError = {
  error: string;
  issues?: { path: (string | number)[]; message: string }[];
};

export async function apiFetchServerJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await apiFetchServer(path, init);
  const body = (await res.json().catch(() => null)) as T | ApiError | null;
  if (!res.ok) {
    const e = body as ApiError | null;
    const msg =
      e?.issues?.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") ||
      e?.error ||
      `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return body as T;
}
