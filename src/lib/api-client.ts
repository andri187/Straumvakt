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

const BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";

export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  if (!path.startsWith("/")) {
    throw new Error(`apiFetch: path must start with "/" (got: ${path})`);
  }
  const url = `${BASE_URL}${path}`;
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
