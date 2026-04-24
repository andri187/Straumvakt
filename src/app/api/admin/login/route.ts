import { NextResponse } from "next/server";
import {
  adminSessionConfig,
  createAdminSession,
  getAdminCredentials,
  timingSafeEqualText,
} from "@/lib/admin-session";

export async function POST(req: Request) {
  try {
    let email = "";
    let password = "";

    const contentType = req.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const body = (await req.json()) as { email?: string; password?: string };
      email = String(body.email ?? "")
        .trim()
        .toLowerCase();
      password = String(body.password ?? "");
    } else {
      const form = await req.formData();
      email = String(form.get("email") ?? "")
        .trim()
        .toLowerCase();
      password = String(form.get("password") ?? "");
    }

    if (!email || !password) {
      return NextResponse.json(
        { error: "Email and password are required." },
        { status: 400 },
      );
    }

    const admin = getAdminCredentials();
    const matchesEmail = timingSafeEqualText(email, admin.email.toLowerCase());
    const matchesPassword = timingSafeEqualText(password, admin.password);

    if (!matchesEmail || !matchesPassword) {
      return NextResponse.json(
        { error: "Invalid credentials." },
        { status: 401 },
      );
    }

    const token = await createAdminSession(admin.email);
    const res = NextResponse.json({ ok: true });
    res.cookies.set({
      name: adminSessionConfig.SESSION_COOKIE_NAME,
      value: token,
      httpOnly: true,
      // strict keeps the cookie off cross-site navigations — CSRF protection
      // for the admin surface. "lax" would allow top-level GETs to carry the
      // cookie, which is unnecessary for an admin-only console.
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: adminSessionConfig.SESSION_TTL_SECONDS,
    });
    return res;
  } catch (err) {
    // Log the actual error server-side for debugging, but never leak config
    // details (env var names, stack traces) to the client.
    console.error(
      JSON.stringify({
        ev: "admin_login_failed",
        err: err instanceof Error ? err.message : String(err),
      }),
    );
    return NextResponse.json(
      {
        error:
          "Login service is not configured. Contact the system administrator.",
      },
      { status: 500 },
    );
  }
}
