import { NextResponse } from "next/server";
import { requireAdmin, unauthorized, apiError } from "@/lib/api-auth";
import { listUsersForOrg } from "@/lib/repositories/driver-contracts";

export async function GET(_req: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireAdmin();
  if (!session) return unauthorized();
  const { id } = await context.params;
  try { return NextResponse.json({ users: await listUsersForOrg(id) }); } catch (err) { return apiError(err, 500); }
}
