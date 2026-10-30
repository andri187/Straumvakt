import { NextRequest, NextResponse } from "next/server";
import { adminSessionConfig, verifyAdminSession } from "@/lib/admin-session";
import { decideShellRoute } from "@/lib/cpo-shell-policy";
import { SHELL_COOKIE_NAME, verifyShellSession } from "@/lib/cpo-shell-session";

// 2026-08-08 relaunch — straumvakt.org was reset to a single clean login
// (src/app/page.tsx) plus one placeholder authenticated destination
// (src/app/home). This middleware used to carve out public-path exceptions
// for the invite-acceptance page, /apply, and the driver web portal; those
// routes moved to archive/straumvakt-org-console-2026-08-08/ along with the
// exceptions themselves. Re-add the matching exception here if one of them
// comes back — see the archive's README for what each one was.

const PUBLIC_PATHS = new Set(["/api/admin/login"]);

// Trusted internal header — stripped from all incoming requests so clients
// cannot spoof it, then re-set by middleware after successful verification.
const ADMIN_HEADER = "x-straumvakt-admin-verified";

function isPublicAsset(pathname: string): boolean {
  return (
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/favicon") ||
    pathname.startsWith("/icon")
  );
}

// ── Straumvakt-employee entrance (/staff) ───────────────────────────────
// Added with the employee landing page. Kept as one self-contained block
// with a single call site below, on purpose: the org-facing entrance is
// being added to this same file in parallel, and a contiguous addition
// merges next to another contiguous addition without a fight.
//
// Two rules, both scoped to this prefix and nothing else:
//
//   • "/staff" is public. It *is* the sign-in page, so it has to be
//     reachable without a session; a visitor who already has one skips
//     straight past it, exactly like the "/" special-case below.
//   • Everything under "/staff/" is session-gated and, when the session is
//     missing, bounces to "/staff" rather than the generic "/". Staff whose
//     session lapsed should get their own door back, not the org login.
//
// Note this only proves a *session* exists. Whether it carries platform
// scope is decided by GET /api/admin/me inside src/app/staff/overview —
// middleware cannot tell the two login paths apart, and shouldn't try.
//
// CAVEAT, verified 2026-08-08 and NOT introduced here: this file does not
// currently execute. Next 16 resolves the convention to src/middleware.ts
// when a src/ directory exists, so nothing below runs and /home is already
// reachable without a session on this branch. Copying this file to
// src/middleware.ts makes every rule here (including the two above) take
// effect immediately — confirmed against `next dev`. That move is left
// undone deliberately: it is a whole-file relocation, and the org-facing
// entrance is being added to this same file in parallel. /staff/overview
// therefore does not lean on middleware for its gate — it verifies the
// session server-side and renders nothing it cannot fetch.
const STAFF_LANDING = "/staff";
const STAFF_HOME = "/staff/overview";

function staffRouteResponse(
  pathname: string,
  session: Awaited<ReturnType<typeof verifyAdminSession>>,
  req: NextRequest,
  headers: Headers,
): NextResponse | null {
  if (pathname !== STAFF_LANDING && !pathname.startsWith(`${STAFF_LANDING}/`)) {
    return null; // not ours — let the existing rules run
  }
  if (pathname === STAFF_LANDING) {
    return session
      ? NextResponse.redirect(new URL(STAFF_HOME, req.url))
      : NextResponse.next({ request: { headers } });
  }
  if (!session) {
    return NextResponse.redirect(new URL(STAFF_LANDING, req.url));
  }
  headers.set(ADMIN_HEADER, "1");
  return NextResponse.next({ request: { headers } });
}

// ── Surface selection ───────────────────────────────────────────────────
// The deployable surface is the CPO test shell: only the routes listed in
// src/lib/cpo-shell-policy.ts exist, and the legacy rules below (admin
// cookie, staff, org, demo and preview routes, the preview-flag bypass)
// are never consulted. The legacy surface remains available for local
// development only: it needs STRAUMVAKT_SURFACE=legacy AND a non-production
// build, so a production deployment cannot be switched onto it by a stray
// variable.
function legacySurfaceEnabled(): boolean {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.STRAUMVAKT_SURFACE === "legacy"
  );
}

async function shellMiddleware(req: NextRequest): Promise<NextResponse> {
  const { pathname } = req.nextUrl;

  let hasSession = false;
  try {
    const session = await verifyShellSession(
      req.cookies.get(SHELL_COOKIE_NAME)?.value,
    );
    hasSession = session !== null;
  } catch {
    hasSession = false;
  }

  const decision = decideShellRoute({ pathname, hasSession });

  if (decision.action === "redirect") {
    return NextResponse.redirect(new URL(decision.location, req.url));
  }
  if (decision.action === "unauthorized") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: { "cache-control": "no-store" } });
  }
  if (decision.action === "notFound") {
    return pathname.startsWith("/api/")
      ? NextResponse.json({ error: "Not found" }, { status: 404 })
      : new NextResponse("Not found", { status: 404 });
  }

  // Never forward a client-supplied trusted-admin header.
  const headers = new Headers(req.headers);
  headers.delete(ADMIN_HEADER);
  const response = NextResponse.next({ request: { headers } });
  if (decision.noStore) {
    response.headers.set("cache-control", "private, no-store");
  }
  return response;
}

export async function middleware(req: NextRequest) {
  if (legacySurfaceEnabled()) {
    // Legacy behaviour: static files (paths with a dot) were never matched.
    if (req.nextUrl.pathname.includes(".")) return NextResponse.next();
    return legacyMiddleware(req);
  }
  return shellMiddleware(req);
}

async function legacyMiddleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (isPublicAsset(pathname)) {
    return NextResponse.next();
  }

  if (
    (
      pathname === "/local/product-preview" ||
      pathname === "/local/dso-lookup" ||
      pathname === "/visual" ||
      pathname === "/login-demo" ||
      pathname === "/app" ||
      pathname.startsWith("/app/")
    ) &&
    process.env.STRAUMVAKT_LOCAL_PRODUCT_PREVIEW === "1"
  ) {
    return NextResponse.next();
  }

  // Strip any client-supplied spoofed header before we do anything.
  const sanitisedHeaders = new Headers(req.headers);
  sanitisedHeaders.delete(ADMIN_HEADER);

  let session: Awaited<ReturnType<typeof verifyAdminSession>> = null;
  try {
    const token = req.cookies.get(
      adminSessionConfig.SESSION_COOKIE_NAME,
    )?.value;
    session = await verifyAdminSession(token);
  } catch (err) {
    console.error(
      JSON.stringify({
        ev: "middleware_verify_failed",
        pathname,
        err: err instanceof Error ? err.message : String(err),
      }),
    );
  }

  // "/" is the login landing now (was "/login" pre-relaunch, which is
  // parked). Already-signed-in visitors skip straight past it.
  if (pathname === "/") {
    if (session) {
      return NextResponse.redirect(new URL("/home", req.url));
    }
    return NextResponse.next({ request: { headers: sanitisedHeaders } });
  }

  const staff = staffRouteResponse(pathname, session, req, sanitisedHeaders);
  if (staff) return staff;

  if (PUBLIC_PATHS.has(pathname)) {
    return NextResponse.next({ request: { headers: sanitisedHeaders } });
  }

  const isAdminApi = pathname.startsWith("/api/admin/");
  const protectedAppRoute = !pathname.startsWith("/api/");

  if (!session) {
    if (isAdminApi) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (protectedAppRoute) {
      return NextResponse.redirect(new URL("/", req.url));
    }
    return NextResponse.next({ request: { headers: sanitisedHeaders } });
  }

  // Session verified — stamp the trusted header so the layout can skip
  // a second HMAC round-trip.
  sanitisedHeaders.set(ADMIN_HEADER, "1");
  return NextResponse.next({ request: { headers: sanitisedHeaders } });
}

// Matches every path except Next's own static output, so that on the shell
// surface dotted public files (legacy HTML, images, SVG models) are also
// answered by the route policy instead of being served unchecked.
export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
