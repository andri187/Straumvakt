import { NextResponse } from "next/server";
import { requireAdmin, unauthorized, apiError } from "@/lib/api-auth";
import { listPropertiesByOrg } from "@/lib/repositories/sites";

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const session = await requireAdmin();
  if (!session) return unauthorized();
  const { id } = await context.params;
  try {
    return NextResponse.json({ properties: await listPropertiesByOrg(id) });
  } catch (err) {
    return apiError(err, 500);
  }
}
