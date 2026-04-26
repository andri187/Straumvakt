import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin, unauthorized, apiError } from "@/lib/api-auth";
import { CircuitCreateInput } from "@/lib/repositories/_inputs/circuits";
import { createCircuit, listAllCircuits } from "@/lib/repositories/circuits";

export async function GET() {
  const session = await requireAdmin();
  if (!session) return unauthorized();
  try { return NextResponse.json({ circuits: await listAllCircuits() }); } catch (err) { return apiError(err, 500); }
}

export async function POST(req: NextRequest) {
  const session = await requireAdmin();
  if (!session) return unauthorized();
  let raw: unknown;
  try { raw = await req.json(); } catch { return NextResponse.json({ error: "malformed json" }, { status: 400 }); }
  const parsed = CircuitCreateInput.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "validation", issues: parsed.error.issues }, { status: 400 });
  try { return NextResponse.json({ circuit: await createCircuit(parsed.data, null) }, { status: 201 }); } catch (err) { return apiError(err, 500); }
}
