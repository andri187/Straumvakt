/**
 * POST /api/admin/orgs/[id]/archive — soft-delete (status=archived).
 */
import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin, unauthorized, apiError } from "@/lib/api-auth";
import { archiveOrg } from "@/lib/repositories/organizations";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAdmin();
  if (!session) return unauthorized();
  const { id } = await params;
  try {
    const org = await archiveOrg(id, null);
    return NextResponse.json({ org });
  } catch (err) {
    return apiError(err, 500);
  }
}
