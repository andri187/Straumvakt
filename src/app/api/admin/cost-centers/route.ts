import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin, unauthorized, apiError } from "@/lib/api-auth";
import { CostCenterCreateInput } from "@/lib/repositories/_inputs/cost-centers";
import { createCostCenter, listAllCostCenters } from "@/lib/repositories/cost-centers";

export async function GET() {
  const session = await requireAdmin();
  if (!session) return unauthorized();
  try { return NextResponse.json({ costCenters: await listAllCostCenters() }); } catch (err) { return apiError(err, 500); }
}

export async function POST(req: NextRequest) {
  const session = await requireAdmin();
  if (!session) return unauthorized();
  let raw: unknown;
  try { raw = await req.json(); } catch { return NextResponse.json({ error: "malformed json" }, { status: 400 }); }
  const parsed = CostCenterCreateInput.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "validation", issues: parsed.error.issues }, { status: 400 });
  try { return NextResponse.json({ costCenter: await createCostCenter(parsed.data, null) }, { status: 201 }); } catch (err) { return apiError(err, 500); }
}
