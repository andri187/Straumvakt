// Sprint 9 / ADR 0019 milestone A.8 — read-only repository for the
// operator UI list + detail pages on /agreements.
//
// Pilot scope per the 2026-05-09 addendum: only `service_cpo` and
// `installation` agreement types are surfaced in the operator UI. The
// other enum values (`service_contractor`, `service_workplace`,
// `workplace`) remain in the DB but are filtered out at this layer.

import type { PrismaClient } from "../generated/prisma/client";

const PILOT_TYPES = ["service_cpo", "installation"] as const;
type PilotAgreementType = (typeof PILOT_TYPES)[number];

export interface AgreementListRow {
  id: string;
  agreementType: PilotAgreementType;
  displayName: string;
  status: "draft" | "active" | "expired";
  effectiveFrom: string; // ISO
  effectiveUntil: string | null;
  counterpartyOrgId: string;
  counterpartyDisplayName: string;
  installationId: string | null;
  installationDisplayName: string | null;
  // Quick aggregates so the list shows shape at a glance
  clauseCount: number;
  driverGroupCount: number;
  memberCount: number; // sum across all groups
}

export interface AgreementDetail {
  id: string;
  agreementType: PilotAgreementType;
  displayName: string;
  status: "draft" | "active" | "expired";
  effectiveFrom: string;
  effectiveUntil: string | null;
  notes: string | null;
  counterparty: { id: string; displayName: string };
  installation: {
    id: string;
    displayName: string;
    installationType: string;
    enforceAuthorize: boolean;
  } | null;
  clauses: ClauseRow[];
  driverGroups: DriverGroupRow[];
  bearerRules: BearerRuleRow[];
}

export interface ClauseRow {
  id: string;
  factorCode: string;
  factorDisplayNameEn: string;
  factorDisplayNameIs: string;
  defaultBearerType: string;
  defaultRateRefCode: string | null;
  // The allocation_json is exposed as an opaque object; UI doesn't need
  // to interpret beyond showing splits at a high level.
  allocationJson: unknown;
}

export interface DriverGroupRow {
  id: string;
  displayName: string;
  ownerOrgId: string;
  ownerOrgDisplayName: string;
  members: MemberRow[];
}

export interface MemberRow {
  membershipId: string;
  userId: string;
  userEmail: string;
  userDisplayName: string | null;
  addedAt: string;
}

export interface BearerRuleRow {
  id: string;
  factorCode: string;
  scopeType: string | null;
  scopeId: string | null;
  audienceType: string | null;
  audienceId: string | null;
  bearerType: string | null;
  rateRefCode: string | null;
  effectiveFrom: string;
  effectiveUntil: string | null;
}

// ── List (operator-facing, pilot types only) ─────────────────────────

export async function listAgreements(
  prisma: PrismaClient,
): Promise<AgreementListRow[]> {
  const rows = await prisma.agreement.findMany({
    where: { agreementType: { in: ["service_cpo", "installation"] } },
    include: {
      counterpartyOrg: { select: { id: true, displayName: true } },
      installation: { select: { id: true, displayName: true } },
      _count: { select: { clauses: true, driverGroups: true } },
      driverGroups: { select: { _count: { select: { memberships: true } } } },
    },
    orderBy: [{ effectiveFrom: "desc" }],
  });

  return rows.map((r): AgreementListRow => ({
    id: r.id,
    agreementType: r.agreementType as PilotAgreementType,
    displayName: r.displayName,
    status: r.status as AgreementListRow["status"],
    effectiveFrom: r.effectiveFrom.toISOString(),
    effectiveUntil: r.effectiveUntil?.toISOString() ?? null,
    counterpartyOrgId: r.counterpartyOrg.id,
    counterpartyDisplayName: r.counterpartyOrg.displayName,
    installationId: r.installation?.id ?? null,
    installationDisplayName: r.installation?.displayName ?? null,
    clauseCount: r._count.clauses,
    driverGroupCount: r._count.driverGroups,
    memberCount: r.driverGroups.reduce((sum, g) => sum + g._count.memberships, 0),
  }));
}

// ── Detail (single agreement, full nested tree) ──────────────────────

export async function getAgreementDetail(
  prisma: PrismaClient,
  id: string,
): Promise<AgreementDetail | null> {
  const r = await prisma.agreement.findUnique({
    where: { id },
    include: {
      counterpartyOrg: { select: { id: true, displayName: true } },
      installation: {
        select: {
          id: true,
          displayName: true,
          installationType: true,
          enforceAuthorize: true,
        },
      },
      clauses: {
        include: {
          costFactor: {
            select: { code: true, displayNameEn: true, displayNameIs: true },
          },
        },
      },
      driverGroups: {
        include: {
          ownerOrg: { select: { id: true, displayName: true } },
          memberships: {
            include: {
              user: {
                select: { id: true, email: true, displayName: true },
              },
            },
            orderBy: { addedAt: "asc" },
          },
        },
        orderBy: { displayName: "asc" },
      },
      bearerRules: {
        include: {
          costFactor: { select: { code: true } },
        },
        orderBy: { effectiveFrom: "desc" },
      },
    },
  });

  if (!r) return null;
  if (!PILOT_TYPES.includes(r.agreementType as PilotAgreementType)) {
    // Hide non-pilot types from the operator UI; same filter as the list.
    return null;
  }

  return {
    id: r.id,
    agreementType: r.agreementType as PilotAgreementType,
    displayName: r.displayName,
    status: r.status as AgreementDetail["status"],
    effectiveFrom: r.effectiveFrom.toISOString(),
    effectiveUntil: r.effectiveUntil?.toISOString() ?? null,
    notes: r.notes,
    counterparty: {
      id: r.counterpartyOrg.id,
      displayName: r.counterpartyOrg.displayName,
    },
    installation: r.installation
      ? {
          id: r.installation.id,
          displayName: r.installation.displayName,
          installationType: r.installation.installationType,
          enforceAuthorize: r.installation.enforceAuthorize,
        }
      : null,
    clauses: r.clauses.map((c): ClauseRow => ({
      id: c.id,
      factorCode: c.costFactor.code,
      factorDisplayNameEn: c.costFactor.displayNameEn,
      factorDisplayNameIs: c.costFactor.displayNameIs,
      defaultBearerType: c.defaultBearerType,
      defaultRateRefCode: c.defaultRateRefCode,
      allocationJson: c.allocationJson,
    })),
    driverGroups: r.driverGroups.map((g): DriverGroupRow => ({
      id: g.id,
      displayName: g.displayName,
      ownerOrgId: g.ownerOrg.id,
      ownerOrgDisplayName: g.ownerOrg.displayName,
      members: g.memberships.map((m): MemberRow => ({
        membershipId: m.id,
        userId: m.user.id,
        userEmail: m.user.email,
        userDisplayName: m.user.displayName,
        addedAt: m.addedAt.toISOString(),
      })),
    })),
    bearerRules: r.bearerRules.map((br): BearerRuleRow => ({
      id: br.id,
      factorCode: br.costFactor.code,
      scopeType: br.scopeType,
      scopeId: br.scopeId,
      audienceType: br.audienceType,
      audienceId: br.audienceId,
      bearerType: br.bearerType,
      rateRefCode: br.rateRefCode,
      effectiveFrom: br.effectiveFrom.toISOString(),
      effectiveUntil: br.effectiveUntil?.toISOString() ?? null,
    })),
  };
}
