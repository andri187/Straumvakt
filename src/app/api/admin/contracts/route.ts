import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin, unauthorized, apiError } from "@/lib/api-auth";
import { ContractCreateInput } from "@/lib/repositories/_inputs/contracts";
import { createContract, listAllContracts } from "@/lib/repositories/contracts";

export async function GET() {
  const session = await requireAdmin();
  if (!session) return unauthorized();
  try { return NextResponse.json({ contracts: await listAllContracts() }); } catch (err) { return apiError(err, 500); }
}

export async function POST(req: NextRequest) {
  const session = await requireAdmin();
  if (!session) return unauthorized();
  let raw: unknown;
  try { raw = await req.json(); } catch { return NextResponse.json({ error: "malformed json" }, { status: 400 }); }
  const parsed = ContractCreateInput.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "validation", issues: parsed.error.issues }, { status: 400 });
  try { return NextResponse.json({ contract: await createContract(parsed.data, null) }, { status: 201 }); } catch (err) { return apiError(err, 500); }
}
