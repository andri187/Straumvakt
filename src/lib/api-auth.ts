import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { adminSessionConfig, verifyAdminSession } from "@/lib/admin-session";
import type { SessionRole } from "@/lib/admin-session";

async function getSession() {
  const jar = await cookies();
  const token = jar.get(adminSessionConfig.SESSION_COOKIE_NAME)?.value;
  return verifyAdminSession(token);
}

export async function requireAdmin() {
  return getSession();
}

/** Allows admin and superuser roles — for Straumvakt staff actions. */
export async function requireStraumvaktStaff(
  roles: SessionRole[] = ["admin", "superuser"],
) {
  const session = await getSession();
  if (!session) return null;
  return roles.includes(session.role) ? session : null;
}

export function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export function apiError(err: unknown, status = 502) {
  return NextResponse.json(
    { error: err instanceof Error ? err.message : String(err) },
    { status },
  );
}
