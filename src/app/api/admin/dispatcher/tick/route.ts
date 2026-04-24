/**
 * POST /api/admin/dispatcher/tick
 *
 * Manual dispatcher trigger — runs one `dispatchTick()` against the
 * default target registry. Useful in dev for retrying failed commands
 * or observing the outbox drain, and serves as the cron endpoint
 * substitute until we wire a real Cron Trigger (deferred past 1.4 to
 * avoid OpenNext scheduled-handler plumbing).
 *
 * Admin-session gated by middleware + defense-in-depth requireAdmin.
 */
import { NextResponse } from "next/server";
import { requireAdmin, unauthorized } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { dispatchTick } from "@/lib/ocpp/dispatcher";

export async function POST() {
  const session = await requireAdmin();
  if (!session) return unauthorized();

  const summary = await dispatchTick(prisma());
  return NextResponse.json(summary, { status: 200 });
}
