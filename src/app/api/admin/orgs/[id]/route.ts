/**
 * GET   /api/admin/orgs/[id]   — fetch a single org
 * PATCH /api/admin/orgs/[id]   — update org (displayName, countryCode)
 *
 * Both require an admin session.
 */
import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin, unauthorized, apiError } from "@/lib/api-auth";
import { OrgUpdateInput } from "@/lib/repositories/_inputs/orgs";
import { getOrgById, updateOrg } from "@/lib/repositories/organizations";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAdmin();
  if (!session) return unauthorized();
  const { id } = await params;
  try {
    const org = await getOrgById(id);
    if (!org) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json({ org });
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
  const parsed = OrgUpdateInput.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  try {
    const org = await updateOrg(id, parsed.data, null);
    return NextResponse.json({ org });
  } catch (err) {
    return apiError(err, 500);
  }
}
