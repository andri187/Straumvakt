import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin, unauthorized, apiError } from "@/lib/api-auth";
import { PropertyUpdateInput } from "@/lib/repositories/_inputs/properties";
import { getPropertyById, updateProperty } from "@/lib/repositories/properties";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireAdmin();
  if (!session) return unauthorized();
  const { id } = await ctx.params;
  try {
    const p = await getPropertyById(id);
    if (!p) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ property: p });
  } catch (err) { return apiError(err, 500); }
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireAdmin();
  if (!session) return unauthorized();
  const { id } = await ctx.params;
  let raw: unknown;
  try { raw = await req.json(); } catch { return NextResponse.json({ error: "malformed json" }, { status: 400 }); }
  const parsed = PropertyUpdateInput.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "validation", issues: parsed.error.issues }, { status: 400 });
  try {
    return NextResponse.json({ property: await updateProperty(id, parsed.data, null) });
  } catch (err) { return apiError(err, 500); }
}
