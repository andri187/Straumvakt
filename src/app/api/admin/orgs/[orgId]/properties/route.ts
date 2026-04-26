import { NextResponse } from "next/server";
import { requireAdmin, unauthorized, apiError } from "@/lib/api-auth";
import { listPropertiesByOrg } from "@/lib/repositories/sites";

export async function GET(
  _req: Request,
  context: { params: Promise<{ orgId: string }> },
) {
  const session = await requireAdmin();
  if (!session) return unauthorized();
  const { orgId } = await context.params;
  try {
    return NextResponse.json({ properties: await listPropertiesByOrg(orgId) });
  } catch (err) {
    return apiError(err, 500);
  }
}
