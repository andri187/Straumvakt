import { NextRequest, NextResponse } from "next/server";
import { adminSessionConfig, verifyAdminSession } from "@/lib/admin-session";

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

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (isPublicAsset(pathname)) {
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

  // "/" is the login landing now (was "/login" pre-relaunch, which is
  // parked). Already-signed-in visitors skip straight past it.
  if (pathname === "/") {
    if (session) {
      return NextResponse.redirect(new URL("/home", req.url));
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
      return NextResponse.redirect(new URL("/", req.url));
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
