/**
 * PATCH  /api/admin/memberships/[orgId]/[userId] — change role
 * DELETE /api/admin/memberships/[orgId]/[userId] — remove membership
 */
import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin, unauthorized, apiError } from "@/lib/api-auth";
import { MembershipUpdateInput } from "@/lib/repositories/_inputs/memberships";
import {
  removeMembership,
  updateMembershipRole,
} from "@/lib/repositories/memberships";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ orgId: string; userId: string }> },
) {
  const session = await requireAdmin();
  if (!session) return unauthorized();
  const { orgId, userId } = await params;
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "malformed json" }, { status: 400 });
  }
  const parsed = MembershipUpdateInput.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  try {
    const membership = await updateMembershipRole(
      orgId,
      userId,
      parsed.data,
      null,
    );
    return NextResponse.json({ membership });
  } catch (err) {
    return apiError(err, 500);
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ orgId: string; userId: string }> },
) {
  const session = await requireAdmin();
  if (!session) return unauthorized();
  const { orgId, userId } = await params;
  try {
    await removeMembership(orgId, userId, null);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return apiError(err, 500);
  }
}
