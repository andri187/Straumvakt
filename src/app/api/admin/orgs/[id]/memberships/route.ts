/**
 * GET  /api/admin/orgs/[id]/memberships — list memberships in an org
 * POST /api/admin/orgs/[id]/memberships — add a membership (userId + role)
 */
import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin, unauthorized, apiError } from "@/lib/api-auth";
import { MembershipCreateInput } from "@/lib/repositories/_inputs/memberships";
import {
  addMembership,
  listMembershipsForOrg,
} from "@/lib/repositories/memberships";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAdmin();
  if (!session) return unauthorized();
  const { id: orgId } = await params;
  try {
    const memberships = await listMembershipsForOrg(orgId);
    return NextResponse.json({ memberships });
  } catch (err) {
    return apiError(err, 500);
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAdmin();
  if (!session) return unauthorized();
  const { id: orgId } = await params;
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "malformed json" }, { status: 400 });
  }
  const parsed = MembershipCreateInput.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  try {
    const membership = await addMembership(orgId, parsed.data, null);
    return NextResponse.json({ membership }, { status: 201 });
  } catch (err) {
    return apiError(err, 500);
  }
}
