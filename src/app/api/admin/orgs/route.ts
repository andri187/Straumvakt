/**
 * GET  /api/admin/orgs              — list orgs (platform-admin)
 * POST /api/admin/orgs              — create org (platform-admin)
 *
 * Both require an admin session (`requireAdmin`). Pilot has a single
 * admin account per CLAUDE.md operator instruction; the broader role
 * hierarchy is post-pilot per ADR 0006.
 */
import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin, unauthorized, apiError } from "@/lib/api-auth";
import { OrgCreateInput } from "@/lib/repositories/_inputs/orgs";
import { createOrg, listOrgs } from "@/lib/repositories/organizations";

export async function GET(req: NextRequest) {
  const session = await requireAdmin();
  if (!session) return unauthorized();
  const includeArchived = req.nextUrl.searchParams.get("includeArchived") === "1";
  try {
    const orgs = await listOrgs({ includeArchived });
    return NextResponse.json({ orgs });
  } catch (err) {
    return apiError(err, 500);
  }
}

export async function POST(req: NextRequest) {
  const session = await requireAdmin();
  if (!session) return unauthorized();
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "malformed json" }, { status: 400 });
  }
  const parsed = OrgCreateInput.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  try {
    // Admin session is env-var credentials, not a User row — actorUserId
    // stays null. When real user accounts land post-pilot, swap this for
    // session.userId.
    const org = await createOrg(parsed.data, null);
    return NextResponse.json({ org }, { status: 201 });
  } catch (err) {
    return apiError(err, 500);
  }
}
