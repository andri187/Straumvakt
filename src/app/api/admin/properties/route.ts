import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin, unauthorized, apiError } from "@/lib/api-auth";
import { PropertyCreateInput } from "@/lib/repositories/_inputs/properties";
import { createProperty, listAllProperties } from "@/lib/repositories/properties";

export async function GET() {
  const session = await requireAdmin();
  if (!session) return unauthorized();
  try {
    const properties = await listAllProperties();
    return NextResponse.json({ properties });
  } catch (err) {
    return apiError(err, 500);
  }
}

export async function POST(req: NextRequest) {
  const session = await requireAdmin();
  if (!session) return unauthorized();
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "malformed json" }, { status: 400 });
  }
  const parsed = PropertyCreateInput.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  try {
    const property = await createProperty(parsed.data, null);
    return NextResponse.json({ property }, { status: 201 });
  } catch (err) {
    return apiError(err, 500);
  }
}
