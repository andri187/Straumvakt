/**
 * POST /api/admin/onboarding/chains
 *
 * Creates the full physical hierarchy (Org → Property → Site →
 * SiteAsset → ChargingStation → EVSE → Connector + OcppIdentity) in
 * one transaction. Used by /onboard to give operators a testable
 * workflow before per-tier CRUD pages land in Sprint 2 milestones
 * 2.3–2.6.
 *
 * Returns the OCPP Basic-Auth password ONCE. Same one-time-reveal
 * pattern as the Sprint 1.5 dev/provision-identity route.
 */
import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin, unauthorized, apiError } from "@/lib/api-auth";
import { OnboardingChainInput } from "@/lib/repositories/_inputs/onboarding-chains";
import { createOnboardingChain } from "@/lib/repositories/onboarding-chains";

export async function POST(req: NextRequest) {
  const session = await requireAdmin();
  if (!session) return unauthorized();

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "malformed json" }, { status: 400 });
  }

  const parsed = OnboardingChainInput.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    const result = await createOnboardingChain(parsed.data, null);
    return NextResponse.json(
      {
        ok: true,
        ...result,
        note: "Copy the OCPP password into the charger's OCPP config — it cannot be retrieved again. Re-provision to rotate.",
      },
      { status: 201 },
    );
  } catch (err) {
    return apiError(err, 500);
  }
}
