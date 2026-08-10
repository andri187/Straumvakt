import { NextResponse } from "next/server";
import { sendChargerCommand, ChargerCommandId } from "@/lib/zaptec";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED = new Set<number>(Object.values(ChargerCommandId));

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { commandId?: number };
  const commandId = Number(body.commandId);

  if (!Number.isFinite(commandId) || !ALLOWED.has(commandId)) {
    return NextResponse.json(
      { ok: false, error: `Unsupported commandId: ${body.commandId}` },
      { status: 400 },
    );
  }

  const result = await sendChargerCommand(id, commandId);
  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}
