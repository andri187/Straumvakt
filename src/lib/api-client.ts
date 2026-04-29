// Thin client for the apps/api Worker. Two paths:
//
//   • Local dev — NEXT_PUBLIC_API_BASE_URL is empty, fetches hit the
//     same-origin Next.js API routes (still backed by Prisma in the
//     monolith). Same shape as today.
//
//   • Cloudflare Workers staging/prod — NEXT_PUBLIC_API_BASE_URL points
//     at hlada-api-staging.straumvakt.workers.dev. Fetches go directly to
//     the API Worker. credentials: "include" sends the admin session
//     cookie, which is scoped to the parent host straumvakt.workers.dev
//     so it covers both UI and API subdomains.
//
// During the monolith → API-Worker cutover the same UI code runs on both
// paths; the env var flips the destination.
//
// Once every server component + client form has been moved to call
// apiFetch (Phase 3 of ADR 0013), the local-dev fallback path can also
// repoint at the API Worker and Prisma is fully out of the Next.js
// bundle.

// Source-of-truth UI ↔ API mapping, evaluated at request time in the
// browser. We can't rely solely on NEXT_PUBLIC_API_BASE_URL because
// Next.js inlines NEXT_PUBLIC_* at build time, and the Cloudflare
// Workers build runner doesn't always thread wrangler.jsonc env-
// specific vars into the next-build process.env. The hostname switch
// below makes the cutover robust to that — production and staging UI
// hosts always land on their respective API Workers, dev/local stays
// on relative URLs.
const HOSTNAME_TO_API: Record<string, string> = {
  "hlada-staging.straumvakt.workers.dev": "https://hlada-api-staging.straumvakt.workers.dev",
  "hlada.straumvakt.workers.dev": "https://hlada-api.straumvakt.workers.dev",
};

function resolveBaseUrl(): string {
  const envBase = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (envBase) return envBase;
  if (typeof window !== "undefined") {
    return HOSTNAME_TO_API[window.location.hostname] ?? "";
  }
  return "";
}

export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  if (!path.startsWith("/")) {
    throw new Error(`apiFetch: path must start with "/" (got: ${path})`);
  }
  const url = `${resolveBaseUrl()}${path}`;
  return fetch(url, {
    ...init,
    credentials: "include",
    headers: {
      ...(init?.headers ?? {}),
      ...(init?.body ? { "content-type": "application/json" } : {}),
    },
  });
}

export type ApiError = {
  error: string;
  issues?: { path: (string | number)[]; message: string }[];
};

export async function apiFetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(path, init);
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
