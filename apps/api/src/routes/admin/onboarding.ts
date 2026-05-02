import { Hono } from "hono";
import { OnboardingChainInput } from "@straumvakt/shared/inputs/onboarding-chains";
import { makePrisma } from "../../lib/prisma";
import { requireAdmin, type AuthVars } from "../../lib/auth-middleware";
import { requirePermission } from "../../lib/auth/require-permission";
import { createOnboardingChain } from "../../repositories/onboarding-chains";
import type { Env } from "../../bindings";

export const adminOnboarding = new Hono<{ Bindings: Env; Variables: AuthVars }>();

adminOnboarding.use("*", requireAdmin);

adminOnboarding.post("/chains", requirePermission("charger.write"), async (c) => {
  const raw = (await c.req.json().catch(() => null)) as unknown;
  const parsed = OnboardingChainInput.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: "validation", issues: parsed.error.issues }, 400);
  }
  const db = makePrisma(c.env);
  const result = await createOnboardingChain(db, parsed.data, null);
  return c.json(
    {
      ok: true,
      ...result,
      note: "Copy the OCPP password into the charger's OCPP config — it cannot be retrieved again. Re-provision to rotate.",
    },
    201,
  );
});
