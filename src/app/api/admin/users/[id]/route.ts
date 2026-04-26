/**
 * GET   /api/admin/users/[id] — fetch a user
 * PATCH /api/admin/users/[id] — update displayName / status
 */
import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin, unauthorized, apiError } from "@/lib/api-auth";
import { UserUpdateInput } from "@/lib/repositories/_inputs/users";
import { getUserById, updateUser } from "@/lib/repositories/users";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAdmin();
  if (!session) return unauthorized();
  const { id } = await params;
  try {
    const user = await getUserById(id);
    if (!user) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json({ user });
  } catch (err) {
    return apiError(err, 500);
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAdmin();
  if (!session) return unauthorized();
  const { id } = await params;
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "malformed json" }, { status: 400 });
  }
  const parsed = UserUpdateInput.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  try {
    const user = await updateUser(id, parsed.data);
    return NextResponse.json({ user });
  } catch (err) {
    return apiError(err, 500);
  }
}
