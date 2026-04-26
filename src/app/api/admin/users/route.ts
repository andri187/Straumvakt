/**
 * GET  /api/admin/users  — list users (platform-admin)
 * POST /api/admin/users  — create user (platform-admin)
 */
import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin, unauthorized, apiError } from "@/lib/api-auth";
import { UserCreateInput } from "@/lib/repositories/_inputs/users";
import { createUser, listUsers } from "@/lib/repositories/users";

export async function GET(req: NextRequest) {
  const session = await requireAdmin();
  if (!session) return unauthorized();
  const includeDeleted = req.nextUrl.searchParams.get("includeDeleted") === "1";
  try {
    const users = await listUsers({ includeDeleted });
    return NextResponse.json({ users });
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
  const parsed = UserCreateInput.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  try {
    const user = await createUser(parsed.data);
    return NextResponse.json({ user }, { status: 201 });
  } catch (err) {
    return apiError(err, 500);
  }
}
