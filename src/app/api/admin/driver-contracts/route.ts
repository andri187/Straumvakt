import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin, unauthorized, apiError } from "@/lib/api-auth";
import { DriverContractCreateInput } from "@/lib/repositories/_inputs/driver-contracts";
import { createDriverContract, listAllDriverContracts } from "@/lib/repositories/driver-contracts";

export async function GET() {
  const session = await requireAdmin();
  if (!session) return unauthorized();
  try { return NextResponse.json({ driverContracts: await listAllDriverContracts() }); } catch (err) { return apiError(err, 500); }
}

export async function POST(req: NextRequest) {
  const session = await requireAdmin();
  if (!session) return unauthorized();
  let raw: unknown;
  try { raw = await req.json(); } catch { return NextResponse.json({ error: "malformed json" }, { status: 400 }); }
  const parsed = DriverContractCreateInput.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "validation", issues: parsed.error.issues }, { status: 400 });
  try { return NextResponse.json({ driverContract: await createDriverContract(parsed.data, null) }, { status: 201 }); } catch (err) { return apiError(err, 500); }
}
