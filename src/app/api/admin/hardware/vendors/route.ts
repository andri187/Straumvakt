import { NextResponse } from "next/server";
import { requireAdmin, unauthorized, apiError } from "@/lib/api-auth";
import { listVendors } from "@/lib/repositories/installations";

export async function GET() {
  const session = await requireAdmin();
  if (!session) return unauthorized();
  try { return NextResponse.json({ vendors: await listVendors() }); } catch (err) { return apiError(err, 500); }
}
