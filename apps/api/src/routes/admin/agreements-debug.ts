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
import { resolveBillingLines } from "../../lib/agreement/resolve";
import {
  allocationSchema,
  type ClauseInput,
  type RateRefInput,
  type RuleInput,
  type SessionContext,
} from "../../lib/agreement/types";
import type { Env } from "../../bindings";

export const adminAgreementsDebug = new Hono<{ Bindings: Env; Variables: AuthVars }>();
adminAgreementsDebug.use("*", requireAdmin);

const debugResolveSchema = z.object({
  userId: z.string().uuid(),
  chargingStationId: z.string().uuid(),
  at: z.string().datetime().optional(),
  energyKwh: z.number().min(0).max(1000).optional(),
  durationMinutes: z.number().min(0).max(60 * 24 * 7).optional(),
});

// BigInt → string for JSON responses (Hono's default JSON serializer
// chokes on BigInt; the UI parses these back as strings).
type BillingLineJson = {
  factorCode: string;
  kind: "passthrough" | "markup";
  basisType: "per_kwh" | "per_minute" | "per_day" | "per_session";
  basisQuantity: number;
  unitPriceMinor: string;
  amountExVatMinor: string;
  vatRatePct: number;
  vatAmountMinor: string;
  amountIncVatMinor: string;
  currency: string;
  bearerType: "org" | "usr" | "wrk" | "trd";
  bearerRef: string | null;
  recipientOrgId: string | null;
  recipientUserId: string | null;
  rateRefId: string | null;
  ruleId: string | null;
  computationDetail: Record<string, unknown>;
};

adminAgreementsDebug.post("/debug-resolve", async (c) => {
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

  // Load charger + asset path.
  const charger = await prisma.chargingStation.findUnique({
    where: { siteAssetId: chargingStationId },
    include: {
      siteAsset: { select: { id: true, displayName: true, siteId: true } },
    },
  });
  if (!charger) {
    return c.json({ error: "charger_not_found" }, 404);
  }

  const cpoOrgId = charger.orgId;
  const siteId = charger.siteAsset.siteId;
  const installationId = charger.installationId;
  const circuitId = charger.circuitId;

  // CPO Agreement covering this charger's operator ORG.
  const cpoAgreement = await prisma.agreement.findFirst({
    where: {
      agreementType: "cpo",
      counterpartyOrgId: cpoOrgId,
      effectiveFrom: { lte: at },
      AND: [
        { status: "active" },
        { OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: at } }] },
      ],
    },
    include: {
      clauses: { include: { costFactor: { select: { code: true } } } },
      bearerRules: true,
    },
  });

  // Workplace agreements where the user is a member of a covered group
  // AND cpo_org_id == this charger's CPO.
  const workplaceAgreements = await prisma.agreement.findMany({
    where: {
      agreementType: "workplace",
      cpoOrgId,
      effectiveFrom: { lte: at },
      AND: [
        { status: "active" },
        { OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: at } }] },
      ],
      driverGroups: {
        some: {
          memberships: { some: { userId } },
        },
      },
    },
    include: {
      clauses: { include: { costFactor: { select: { code: true } } } },
      bearerRules: true,
      driverGroups: {
        where: { memberships: { some: { userId } } },
        select: { id: true, ownerOrgId: true, displayName: true },
      },
    },
  });

  // Direct membership under the CPO Agreement (if any).
  const directGroupMembership = cpoAgreement
    ? await prisma.driverGroupMembership.findFirst({
        where: {
          userId,
          driverGroup: { agreementId: cpoAgreement.id },
        },
        include: { driverGroup: { select: { id: true, ownerOrgId: true, displayName: true } } },
      })
    : null;

  // Access gate: at least one membership covering this CPO.
  const hasMembership = !!directGroupMembership || workplaceAgreements.length > 0;
  if (!hasMembership) {
    return c.json({
      granted: false,
      reason: "no_membership",
      message:
        "Driver has no DriverGroup membership covering this charger's CPO. " +
        "Per ADR 0019 addendum, access requires an explicit membership.",
      cpoAgreement: cpoAgreement
        ? { id: cpoAgreement.id, displayName: cpoAgreement.displayName }
        : null,
      cpoOrgId,
    });
  }

  // Pick driverGroup — workplace beats direct (matches the resolver's
  // audience-precedence walk; per-driver overrides on either still
  // win at attribute level).
  const driverGroup =
    workplaceAgreements[0]?.driverGroups[0]
      ? {
          id: workplaceAgreements[0].driverGroups[0].id,
          ownerOrgId: workplaceAgreements[0].driverGroups[0].ownerOrgId,
        }
      : directGroupMembership
      ? {
          id: directGroupMembership.driverGroupId,
          ownerOrgId: directGroupMembership.driverGroup.ownerOrgId,
        }
      : null;

  // Aggregate clauses + rules from all applicable agreements.
  const allAgreements = [
    ...(cpoAgreement ? [cpoAgreement] : []),
    ...workplaceAgreements,
  ];

  const clauses: ClauseInput[] = [];
  for (const agr of allAgreements) {
    for (const cl of agr.clauses) {
      clauses.push({
        costFactorId: cl.costFactorId,
        costFactorCode: cl.costFactor.code,
        defaultBearerType: cl.defaultBearerType,
        defaultBearerRef: cl.defaultBearerRef,
        defaultRateRefCode: cl.defaultRateRefCode,
        allocation: allocationSchema.parse(cl.allocationJson),
      });
    }
  }

  const rules: RuleInput[] = [];
  for (const agr of allAgreements) {
    for (const r of agr.bearerRules) {
      rules.push({
        id: r.id,
        costFactorId: r.costFactorId,
        scopeType: r.scopeType,
        scopeId: r.scopeId,
        audienceType: r.audienceType,
        audienceId: r.audienceId,
        bearerType: r.bearerType,
        bearerRef: r.bearerRef,
        rateRefCode: r.rateRefCode,
        allocation: r.allocationJson ? allocationSchema.parse(r.allocationJson) : null,
        effectiveFrom: r.effectiveFrom,
        effectiveUntil: r.effectiveUntil,
      });
    }
  }

  // Pull rate references referenced by any clause or rule.
  const referencedCodes = Array.from(
    new Set(
      [
        ...clauses.map((c) => c.defaultRateRefCode),
        ...rules.map((r) => r.rateRefCode),
      ].filter((s): s is string => s !== null)
    )
  );

  const rateReferenceRows =
    referencedCodes.length === 0
      ? []
      : await prisma.rateReference.findMany({
          where: { code: { in: referencedCodes } },
        });

  const rateReferences: RateRefInput[] = rateReferenceRows.map((r) => ({
    id: r.id,
    code: r.code,
    costFactorId: r.costFactorId,
    basis: r.basis,
    priceMinor: r.priceMinor,
    vatRatePct: Number(r.vatRatePct),
    currency: r.currency,
    supplierOrgId: r.supplierOrgId,
    effectiveFrom: r.effectiveFrom,
    effectiveUntil: r.effectiveUntil,
  }));

  const ctx: SessionContext = {
    agreementId: cpoAgreement?.id ?? "",
    cpoOrgId,
    user: { id: userId },
    driverGroup,
    chargerId: chargingStationId,
    circuitId,
    installationId,
    siteId,
    startedAt: at,
    endedAt: new Date(at.getTime() + durationMinutes * 60_000),
    energyKwh,
    durationMinutes,
    durationDays,
    clauses,
    rules,
    rateReferences,
  };

  const billingLines = resolveBillingLines(ctx);

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
    cpoAgreement: cpoAgreement
      ? { id: cpoAgreement.id, displayName: cpoAgreement.displayName }
      : null,
    workplaceAgreements: workplaceAgreements.map((a) => ({
      id: a.id,
      displayName: a.displayName,
      counterpartyOrgId: a.counterpartyOrgId,
      driverGroupIds: a.driverGroups.map((g) => g.id),
    })),
    driverGroup,
    sessionInputs: {
      at: at.toISOString(),
      energyKwh,
      durationMinutes,
      durationDays,
    },
    enlistedFactorCount: clauses.length,
    applicableRuleCount: rules.length,
    billingLines: lines,
  });
});

// Form-population helper. Lists driver users + chargers so the UI can
// render selects without separate calls.
adminAgreementsDebug.get("/debug-options", async (c: Context<{ Bindings: Env; Variables: AuthVars }>) => {
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
