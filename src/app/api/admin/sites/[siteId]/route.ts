import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin, unauthorized, apiError } from "@/lib/api-auth";
import { SiteUpdateInput } from "@/lib/repositories/_inputs/sites";
import { getSiteById, updateSite } from "@/lib/repositories/sites";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ siteId: string }> }) {
  const session = await requireAdmin();
  if (!session) return unauthorized();
  const { siteId } = await ctx.params;
  const id = siteId;
  try {
    const s = await getSiteById(id);
    if (!s) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ site: s });
  } catch (err) { return apiError(err, 500); }
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ siteId: string }> }) {
  const session = await requireAdmin();
  if (!session) return unauthorized();
  const { siteId } = await ctx.params;
  const id = siteId;
  let raw: unknown;
  try { raw = await req.json(); } catch { return NextResponse.json({ error: "malformed json" }, { status: 400 }); }
  const parsed = SiteUpdateInput.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "validation", issues: parsed.error.issues }, { status: 400 });
  try {
    return NextResponse.json({ site: await updateSite(id, parsed.data, null) });
  } catch (err) { return apiError(err, 500); }
}
