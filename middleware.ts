import { NextRequest, NextResponse } from "next/server";
import { adminSessionConfig, verifyAdminSession } from "@/lib/admin-session";

const PUBLIC_PATHS = new Set(["/api/admin/login"]);

// Sprint 5.8 — invite-flow public surfaces. The recipient page at
// /invite/<token> renders for unauthenticated users (the token IS
// the auth). The /api/public/invites/* endpoints are token-gated
// and bypass the admin-session check.
function isPublicInvitePath(pathname: string): boolean {
  return (
    pathname.startsWith("/invite/") ||
    pathname.startsWith("/api/public/invites/")
  );
}

// Sprint 9 — host application (lead capture) public surface.
// /apply is a public form for prospective customers (multi-dwelling
// or company) to request a charging-network offer. The matching
// POST /api/public/applications endpoint is rate-limited and
// anonymous; bypasses the admin-session check.
function isPublicApplyPath(pathname: string): boolean {
  return (
    pathname === "/apply" ||
    pathname === "/api/public/applications" ||
    pathname.startsWith("/api/public/applications/")
  );
}

// Sprint 9 — driver WEB portal (ADR 0033). The /driver/* surface uses
// bearer-token auth (driver access token in the browser, calls /api/driver/*)
// and gates itself client-side — it is NOT behind the admin-session cookie.
// Pages are inert shells; all data stays behind requireDriver on the API
// Worker, so exposing the routes here leaks nothing.
function isDriverPortalPath(pathname: string): boolean {
  return pathname === "/driver" || pathname.startsWith("/driver/");
}

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

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (isPublicAsset(pathname)) {
    return NextResponse.next();
  }
  if (isPublicInvitePath(pathname)) {
    return NextResponse.next();
  }
  if (isPublicApplyPath(pathname)) {
    return NextResponse.next();
  }
  if (isDriverPortalPath(pathname)) {
    return NextResponse.next();
  }

  // Strip any client-supplied spoofed header before we do anything.
  const sanitisedHeaders = new Headers(req.headers);
  sanitisedHeaders.delete(ADMIN_HEADER);

  let session: Awaited<ReturnType<typeof verifyAdminSession>> = null;
  try {
    const token = req.cookies.get(adminSessionConfig.SESSION_COOKIE_NAME)?.value;
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

  if (pathname === "/login") {
    if (session) {
      return NextResponse.redirect(new URL("/dashboard", req.url));
    }
    return NextResponse.next({ request: { headers: sanitisedHeaders } });
  }

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
      return NextResponse.redirect(new URL("/login", req.url));
    }
    return NextResponse.next({ request: { headers: sanitisedHeaders } });
  }

  // Session verified — stamp the trusted header so the layout can skip
  // a second HMAC round-trip.
  sanitisedHeaders.set(ADMIN_HEADER, "1");
  return NextResponse.next({ request: { headers: sanitisedHeaders } });
}

export const config = {
  matcher: ["/((?!.*\\..*).*)"],
};
