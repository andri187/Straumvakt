import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin, unauthorized, apiError } from "@/lib/api-auth";
import { ChargerCreateInput } from "@/lib/repositories/_inputs/chargers";
import { createCharger, listAllChargers } from "@/lib/repositories/chargers";

export async function GET() {
  const session = await requireAdmin();
  if (!session) return unauthorized();
  try { return NextResponse.json({ chargers: await listAllChargers() }); } catch (err) { return apiError(err, 500); }
}

export async function POST(req: NextRequest) {
  const session = await requireAdmin();
  if (!session) return unauthorized();
  let raw: unknown;
  try { raw = await req.json(); } catch { return NextResponse.json({ error: "malformed json" }, { status: 400 }); }
  const parsed = ChargerCreateInput.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "validation", issues: parsed.error.issues }, { status: 400 });
  try {
    const r = await createCharger(parsed.data, null);
    return NextResponse.json({
      ok: true, ...r,
      note: "Copy the OCPP password into the charger config — it is not stored plaintext and cannot be retrieved again.",
    }, { status: 201 });
  } catch (err) { return apiError(err, 500); }
}
