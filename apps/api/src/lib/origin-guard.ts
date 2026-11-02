// Origin / CSRF defence for cookie-authenticated admin requests.
//
// The admin session cookie is SameSite=None and scoped to the parent domain,
// so every sibling subdomain (dso., plan., test., ...) is same-site with the
// API and the browser attaches the cookie to its requests. CORS does not
// help: a "simple" cross-origin POST (text/plain body, no custom headers) is
// sent without a preflight, and the handlers parse the body as JSON whatever
// the Content-Type says. The only reliable signal is the Origin header, which
// browsers attach to every non-GET/HEAD request, same-origin or not.

import type { MiddlewareHandler } from "hono";

// Origins allowed to make credentialed requests. Shared with the CORS
// middleware in index.ts so the two lists cannot drift.
export const ALLOWED_ORIGINS: readonly string[] = [
  "http://localhost:3000",
  "https://hlada-staging.straumvakt.workers.dev",
  "https://hlada.straumvakt.workers.dev",
  // Brand domain (Option B) — the UI runs on straumvakt.org and calls the
  // API at api.straumvakt.org (same-site, credentialed).
  "https://straumvakt.org",
  "https://www.straumvakt.org",
];

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function originOf(value: string): string | null {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:" ? u.origin : null;
  } catch {
    return null;
  }
}

function originAllowed(origin: string, requestOrigin: string): boolean {
  // The request's own origin covers `wrangler dev` and direct calls to the
  // API host; the API serves no HTML, so only the API itself can send it.
  return ALLOWED_ORIGINS.includes(origin) || origin === requestOrigin;
}

/**
 * Rejects state-changing requests that a browser attributes to a foreign
 * page. Order of evidence:
 *   1. Origin — must be allowlisted (or the API's own origin). "null" fails.
 *   2. Sec-Fetch-Site (when Origin is absent) — only same-origin/none pass.
 *   3. Referer (when both above are absent) — its origin must be allowlisted.
 *   4. None of the three: not a browser request (the UI Worker's server-side
 *      fetch, curl, tests). A non-browser caller cannot be made to attach a
 *      victim's cookie, so there is no CSRF to defend against.
 */
export const requireTrustedOrigin: MiddlewareHandler = async (c, next) => {
  if (SAFE_METHODS.has(c.req.method)) return next();

  const requestOrigin = new URL(c.req.url).origin;
  const origin = c.req.header("origin");
  const fetchSite = c.req.header("sec-fetch-site");
  const referer = c.req.header("referer");

  let ok: boolean;
  if (origin !== undefined) {
    ok = originAllowed(origin, requestOrigin);
  } else if (fetchSite !== undefined) {
    ok = fetchSite === "same-origin" || fetchSite === "none";
  } else if (referer !== undefined) {
    const refOrigin = originOf(referer);
    ok = refOrigin !== null && originAllowed(refOrigin, requestOrigin);
  } else {
    ok = true;
  }

  if (!ok) {
    console.warn(
      JSON.stringify({
        ev: "admin_origin_rejected",
        method: c.req.method,
        path: new URL(c.req.url).pathname,
        origin: origin ?? null,
        fetchSite: fetchSite ?? null,
      }),
    );
    return c.json({ error: "forbidden_origin" }, 403);
  }
  return next();
};
