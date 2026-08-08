// Sprint 9 / ADR 0019 milestone A.6 — read-only debug endpoint.
//
// Internal validation tool. Operator picks (driver, charger, optional time
// + energyKwh + duration), endpoint loads the SessionContext from real
// rows and runs resolveBillingLines() exactly as session-stop will once
// wiring lands. Surfaces:
//
//   - whether the driver has any membership covering this charger's CPO
//     (denies if not — matches the "explicit memberships only" rule)
//   - the applicable agreements (CPO + workplace)
//   - the resolved billing_lines with bearer / recipient / amount
//   - the cascadeSource per attribute (which BearerRule won the bearer,
//     which won the rate, which won the allocation)
//
// Read-only — never writes a billing_line. The intended caller is the
// admin /agreements/debug UI page; not part of the operator console.

import { Hono, type Context } from "hono";
import { z } from "zod";
import { makePrisma } from "../../lib/prisma";
import { requireAdmin, type AuthVars } from "../../lib/auth-middleware";
import { requirePermission } from "../../lib/auth/require-permission";
import { resolveBillingLines } from "../../lib/agreement/resolve";
import type { BearerCode, BillingLineKind, RateBasis } from "../../lib/agreement/types";
import { loadAgreementContext } from "../../lib/agreement/persist";
import { listAgreements, getAgreementDetail } from "../../repositories/agreements";
import type { Env } from "../../bindings";

export const adminAgreementsDebug = new Hono<{ Bindings: Env; Variables: AuthVars }>();
adminAgreementsDebug.use("*", requireAdmin);

// ── Sprint 9 / ADR 0019 milestone A.8 — list + detail (operator UI) ──

// GET /api/admin/agreements — list (filtered to pilot types: service_cpo + installation)
adminAgreementsDebug.get("/", requirePermission("billing.read"), async (c) => {
  const prisma = makePrisma(c.env);
  const agreements = await listAgreements(prisma);
  return c.json({ agreements });
});

// GET /api/admin/agreements/:id — detail with clauses, driver groups, memberships, bearer rules
adminAgreementsDebug.get("/:id", requirePermission("billing.read"), async (c) => {
  const id = c.req.param("id");
  const uuidLike = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidLike.test(id)) return c.json({ error: "invalid_id" }, 400);

  const prisma = makePrisma(c.env);
  const agreement = await getAgreementDetail(prisma, id);
  if (!agreement) return c.json({ error: "not_found" }, 404);
  return c.json({ agreement });
});

const debugResolveSchema = z.object({
  userId: z.string().uuid(),
  chargingStationId: z.string().uuid(),
  at: z.string().datetime().optional(),
  energyKwh: z.number().min(0).max(1000).optional(),
  durationMinutes: z.number().min(0).max(60 * 24 * 7).optional(),
});

// BigInt → string for JSON responses (Hono's default JSON serializer
// chokes on BigInt; the UI parses these back as strings).
//
// The enum-valued fields borrow the canonical types rather than re-listing
// their members. They used to be spelled out inline, which meant this shape
// silently forked from BillingLineDraft the moment RATE_BASES gained
// `per_connector` — the widened union stopped assigning to a copy that still
// said four values. Referencing the source keeps the drift impossible.
type BillingLineJson = {
  factorCode: string;
  kind: BillingLineKind;
  basisType: RateBasis;
  basisQuantity: number;
  unitPriceMinor: string;
  amountExVatMinor: string;
  vatRatePct: number;
  vatAmountMinor: string;
  amountIncVatMinor: string;
  currency: string;
  bearerType: BearerCode;
  bearerRef: string | null;
  recipientOrgId: string | null;
  recipientUserId: string | null;
  rateRefId: string | null;
  ruleId: string | null;
  computationDetail: Record<string, unknown>;
};

adminAgreementsDebug.post("/debug-resolve", requirePermission("billing.read"), async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = debugResolveSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_input", details: parsed.error.format() }, 400);
  }

  const { userId, chargingStationId } = parsed.data;
  const at = parsed.data.at ? new Date(parsed.data.at) : new Date();
  const energyKwh = parsed.data.energyKwh ?? 10;
  const durationMinutes = parsed.data.durationMinutes ?? 60;
  const durationDays = durationMinutes / (60 * 24);

  const prisma = makePrisma(c.env);

  const result = await loadAgreementContext(prisma, {
    userId,
    chargingStationId,
    at,
    energyKwh,
    durationMinutes,
    durationDays,
  });

  if (!result.granted) {
    return c.json({
      granted: false,
      reason: result.reason,
      message:
        result.reason === "no_installation"
          ? "Charger is not yet placed under an Installation row — no installation contract can apply."
          : result.reason === "no_membership"
          ? "Driver has no DriverGroup membership covering this charger's installation. " +
            "Per ADR 0019 (2026-05-08 addendum), access requires an explicit membership — " +
            "either in a direct-customer group on the installation contract or in a " +
            "workplace agreement covering this CPO."
          : `Resolver denied: ${result.reason}`,
      installationAgreement: result.installationAgreement,
      cpoOrgId: result.cpoOrgId,
      installationId: result.installationId,
    });
  }

  const billingLines = resolveBillingLines(result.ctx);

  const lines: BillingLineJson[] = billingLines.map((l) => ({
    factorCode: l.factorCode,
    kind: l.kind,
    basisType: l.basisType,
    basisQuantity: l.basisQuantity,
    unitPriceMinor: l.unitPriceMinor.toString(),
    amountExVatMinor: l.amountExVatMinor.toString(),
    vatRatePct: l.vatRatePct,
    vatAmountMinor: l.vatAmountMinor.toString(),
    amountIncVatMinor: l.amountIncVatMinor.toString(),
    currency: l.currency,
    bearerType: l.bearerType,
    bearerRef: l.bearerRef,
    recipientOrgId: l.recipientOrgId,
    recipientUserId: l.recipientUserId,
    rateRefId: l.rateRefId,
    ruleId: l.ruleId,
    computationDetail: l.computationDetail,
  }));

  return c.json({
    granted: true,
    installationAgreement: result.meta.installationAgreement,
    workplaceAgreements: result.meta.workplaceAgreements,
    driverGroup: result.meta.driverGroup,
    sessionInputs: {
      at: at.toISOString(),
      energyKwh,
      durationMinutes,
      durationDays,
    },
    enlistedFactorCount: result.meta.enlistedFactorCount,
    applicableRuleCount: result.meta.applicableRuleCount,
    billingLines: lines,
  });
});

// Form-population helper. Lists driver users + chargers so the UI can
// render selects without separate calls.
adminAgreementsDebug.get("/debug-options", requirePermission("billing.read"), async (c: Context<{ Bindings: Env; Variables: AuthVars }>) => {
  const prisma = makePrisma(c.env);

  const [users, chargingStations] = await Promise.all([
    prisma.user.findMany({
      where: { audience: "driver", deletedAt: null },
      select: { id: true, displayName: true, email: true, firstName: true, lastName: true },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }, { email: "asc" }],
      take: 500,
    }),
    prisma.chargingStation.findMany({
      include: {
        siteAsset: {
          select: {
            displayName: true,
            site: { select: { displayName: true } },
          },
        },
        organization: { select: { displayName: true } },
      },
      take: 500,
    }),
  ]);

  return c.json({
    users: users.map((u) => ({
      id: u.id,
      label: pickLabel(u),
      email: u.email,
    })),
    chargers: chargingStations.map((cs) => ({
      id: cs.siteAssetId,
      label: cs.siteAsset.displayName,
      siteName: cs.siteAsset.site.displayName,
      cpoName: cs.organization.displayName,
    })),
  });
});

function pickLabel(u: {
  displayName: string | null;
  email: string;
  firstName: string | null;
  lastName: string | null;
}): string {
  const fullName = [u.firstName, u.lastName].filter(Boolean).join(" ").trim();
  if (fullName) return fullName;
  if (u.displayName) return u.displayName;
  return u.email;
}
