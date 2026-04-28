import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin, unauthorized, apiError } from "@/lib/api-auth";
import { ChargerUpdateInput } from "@/lib/repositories/_inputs/chargers";
import { getChargerById, updateCharger } from "@/lib/repositories/chargers";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireAdmin();
  if (!session) return unauthorized();
  const { id: chargingStationId } = await ctx.params;
  try {
    const c = await getChargerById(chargingStationId);
    if (!c) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ charger: c });
  } catch (err) { return apiError(err, 500); }
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireAdmin();
  if (!session) return unauthorized();
  const { id: chargingStationId } = await ctx.params;
  let raw: unknown;
  try { raw = await req.json(); } catch { return NextResponse.json({ error: "malformed json" }, { status: 400 }); }
  const parsed = ChargerUpdateInput.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "validation", issues: parsed.error.issues }, { status: 400 });
  try { return NextResponse.json({ charger: await updateCharger(chargingStationId, parsed.data, null) }); } catch (err) { return apiError(err, 500); }
}
