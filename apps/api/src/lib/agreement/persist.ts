// Sprint 9 / ADR 0019 (2026-05-08) — agreement load + persist orchestrator.
//
// Bridges the pure resolver in resolve.ts with real DB rows. Two public
// entry points:
//
//   loadAgreementContext(prisma, input)
//     Given (userId, chargingStationId, time, kwh, duration), loads the
//     applicable installation + workplace agreements + driver group(s),
//     composes a SessionContext (or returns a denial reason). Used by:
//       - /api/admin/agreements/debug-resolve (read-only debug tool)
//       - resolveAndPersistForSession (writes billing_lines)
//
//   resolveAndPersistForSession(prisma, sessionId)
//     Given a ChargeSession id, derives userId/charger/time/kwh/duration
//     from the row, runs loadAgreementContext + resolveBillingLines, and
//     inserts the result into agreements.billing_lines. Idempotent —
//     skips emit if any billing_lines already exist for the session.
//     Used by:
//       - /api/admin/agreements/sessions/:sessionId/resolve (manual)
//       - (future) cron / post-enrichment trigger
//
// No app-layer route logic in this file — only data access + assembly.
// Auth + HTTP shape live in the route handlers.

import type { PrismaClient } from "../../generated/prisma/client";
import { resolveBillingLines } from "./resolve";
import {
  agreementBillingLineKey,
  planGeneration,
} from "../billing/generation-idempotency";
import {
  allocationSchema,
  type ClauseInput,
  type RateRefInput,
  type RuleInput,
  type SessionContext,
  type BillingLineDraft,
} from "./types";

// ── Public types ──────────────────────────────────────────────────────

export type AgreementDenialReason =
  | "no_installation"      // charger not placed under an Installation row
  | "no_membership"        // driver has no DriverGroup membership covering the charger's installation
  | "no_session"           // sessionId not found
  | "session_incomplete"   // session has no endedAt / energyWh — not finalized
  | "session_user_unknown"  // session has no userId — enrichment hasn't run yet
  // The resolver emitted two lines claiming the same (session, factor, kind).
  // That is a resolver defect, not a session problem: keeping the first and
  // dropping the second would write a plausible-looking set of lines that
  // nobody could tell apart from a correct one.
  | "resolver_emitted_duplicate_lines";

export type AgreementContextMeta = {
  installationAgreement: { id: string; displayName: string } | null;
  workplaceAgreements: Array<{
    id: string;
    displayName: string;
    counterpartyOrgId: string;
    driverGroupIds: string[];
  }>;
  driverGroup: { id: string; ownerOrgId: string } | null;
  cpoOrgId: string;
  installationId: string | null;
  enlistedFactorCount: number;
  applicableRuleCount: number;
};

export type LoadAgreementResult =
  | { granted: true; ctx: SessionContext; meta: AgreementContextMeta }
  | {
      granted: false;
      reason: AgreementDenialReason;
      installationAgreement: { id: string; displayName: string } | null;
      cpoOrgId: string | null;
      installationId: string | null;
    };

export type LoadAgreementInput = {
  userId: string;
  chargingStationId: string;
  at: Date;
  energyKwh: number;
  durationMinutes: number;
  durationDays: number;
};

export type ResolveAndPersistResult =
  | { ok: true; emitted: number; alreadyExisted: false; lines: BillingLineDraft[] }
  | { ok: true; emitted: 0; alreadyExisted: true }
  | { ok: false; reason: AgreementDenialReason; details?: string };

// ── loadAgreementContext ─────────────────────────────────────────────

export async function loadAgreementContext(
  prisma: PrismaClient,
  input: LoadAgreementInput
): Promise<LoadAgreementResult> {
  const { userId, chargingStationId, at, energyKwh, durationMinutes, durationDays } = input;

  const charger = await prisma.chargingStation.findUnique({
    where: { siteAssetId: chargingStationId },
    include: {
      siteAsset: { select: { id: true, displayName: true, siteId: true } },
    },
  });
  if (!charger) {
    return {
      granted: false,
      reason: "no_installation",
      installationAgreement: null,
      cpoOrgId: null,
      installationId: null,
    };
  }

  const cpoOrgId = charger.orgId;
  const siteId = charger.siteAsset.siteId;
  const installationId = charger.installationId;
  const circuitId = charger.circuitId;

  if (!installationId) {
    return {
      granted: false,
      reason: "no_installation",
      installationAgreement: null,
      cpoOrgId,
      installationId: null,
    };
  }

  // Resolver determinism (GAP-1, Rule 5): two installation agreements can
  // briefly coexist for the same installation during a staged supersede
  // (old still active, new just activated). Without an explicit orderBy,
  // PostgreSQL returns whichever row appears first in heap-scan order —
  // typically the older one — which can silently route a session to a
  // stale (possibly 0-clause) agreement and produce a zero-billing miss.
  // The orderBy below makes the newest staged agreement win, with `id`
  // as a stable tiebreak. The matching count query above is observability
  // only — it surfaces the silent-conflict state in Workers logs without
  // altering which row is selected.
  const installationAgreementWhere = {
    agreementType: "installation" as const,
    installationId,
    effectiveFrom: { lte: at },
    AND: [
      { status: "active" as const },
      { OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: at } }] },
    ],
  };

  const installationMatchCount = await prisma.agreement.count({
    where: installationAgreementWhere,
  });
  if (installationMatchCount > 1) {
    console.warn(
      `[agreement-resolver] multiple installation agreements matched ` +
        `installationId=${installationId} at=${at.toISOString()} count=${installationMatchCount} ` +
        `— resolver picks the most recently staged (effectiveFrom desc, id asc tiebreak); ` +
        `operator should review and supersede the stale rows.`,
    );
  }

  const installationAgreement = await prisma.agreement.findFirst({
    where: installationAgreementWhere,
    orderBy: [
      { effectiveFrom: "desc" }, // newest agreement wins
      { id: "asc" },             // stable tiebreak when effectiveFrom equal
    ],
    include: {
      clauses: { include: { costFactor: { select: { code: true } } } },
      bearerRules: true,
    },
  });

  const workplaceAgreements = await prisma.agreement.findMany({
    where: {
      agreementType: "workplace",
      cpoOrgId,
      effectiveFrom: { lte: at },
      AND: [
        { status: "active" },
        { OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: at } }] },
      ],
      driverGroups: { some: { memberships: { some: { userId } } } },
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

  const directGroupMembership = installationAgreement
    ? await prisma.driverGroupMembership.findFirst({
        where: {
          userId,
          driverGroup: { agreementId: installationAgreement.id },
        },
        include: {
          driverGroup: { select: { id: true, ownerOrgId: true, displayName: true } },
        },
      })
    : null;

  const hasMembership = !!directGroupMembership || workplaceAgreements.length > 0;
  if (!hasMembership) {
    return {
      granted: false,
      reason: "no_membership",
      installationAgreement: installationAgreement
        ? { id: installationAgreement.id, displayName: installationAgreement.displayName }
        : null,
      cpoOrgId,
      installationId,
    };
  }

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

  const allAgreements = [
    ...(installationAgreement ? [installationAgreement] : []),
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
      : await prisma.rateReference.findMany({ where: { code: { in: referencedCodes } } });

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
    agreementId: installationAgreement?.id ?? "",
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

  return {
    granted: true,
    ctx,
    meta: {
      installationAgreement: installationAgreement
        ? { id: installationAgreement.id, displayName: installationAgreement.displayName }
        : null,
      workplaceAgreements: workplaceAgreements.map((a) => ({
        id: a.id,
        displayName: a.displayName,
        counterpartyOrgId: a.counterpartyOrgId,
        driverGroupIds: a.driverGroups.map((g) => g.id),
      })),
      driverGroup,
      cpoOrgId,
      installationId,
      enlistedFactorCount: clauses.length,
      applicableRuleCount: rules.length,
    },
  };
}

// ── resolveAndPersistForSession ──────────────────────────────────────

export async function resolveAndPersistForSession(
  prisma: PrismaClient,
  sessionId: string
): Promise<ResolveAndPersistResult> {
  const session = await prisma.chargeSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      userId: true,
      chargingStationId: true,
      startedAt: true,
      endedAt: true,
      energyWh: true,
    },
  });
  if (!session) return { ok: false, reason: "no_session" };
  if (!session.userId) return { ok: false, reason: "session_user_unknown" };
  if (!session.endedAt || session.energyWh === null) {
    return { ok: false, reason: "session_incomplete" };
  }

  // Idempotency — read the natural keys already present for this session
  // rather than counting rows.
  //
  // What stood here was `count({ where: { sessionId } })` followed, several
  // awaits later and outside any transaction, by `createMany`. Two overlapping
  // cron ticks both read zero and both insert, and agreements.billing_lines
  // has only `@@index([sessionId, factorCode, kind])` — a plain index, not
  // unique — so the database does not stop them. billing-tick.ts's header
  // calls this idempotent; it is idempotent against a SEQUENTIAL re-run and
  // not against a concurrent one, which is the only kind a cron produces.
  //
  // Reading keys instead of a count also fixes the quieter half: a batch that
  // died partway leaves some rows present, and `count > 0` then skips the
  // remainder of that session forever. That under-bills, and nothing errors.
  //
  // This closes the read-decide gap as far as application code can. The
  // remaining half is a UNIQUE constraint on (session_id, factor_code, kind),
  // which needs a dedupe-then-index migration — written up, unapplied, in
  // docs/notes/2026-08-18-migration-0002-preflight.md.
  const existingRows = await prisma.agreementBillingLine.findMany({
    where: { sessionId },
    select: { factorCode: true, kind: true },
  });
  const existingKeys = existingRows.map((r) =>
    agreementBillingLineKey(sessionId, r.factorCode, r.kind),
  );

  const startedAt = session.startedAt;
  const endedAt = session.endedAt;
  const durationMs = Math.max(0, endedAt.getTime() - startedAt.getTime());
  const durationMinutes = durationMs / 60_000;
  const durationDays = durationMs / (1000 * 60 * 60 * 24);
  const energyKwh = Number(session.energyWh) / 1000;

  const ctxResult = await loadAgreementContext(prisma, {
    userId: session.userId,
    chargingStationId: session.chargingStationId,
    at: startedAt,
    energyKwh,
    durationMinutes,
    durationDays,
  });

  if (!ctxResult.granted) {
    return { ok: false, reason: ctxResult.reason };
  }

  const resolved = resolveBillingLines(ctxResult.ctx);

  if (resolved.length === 0) {
    // Granted but no factor-rate combination produced an output — record
    // nothing. Returns ok=true, emitted=0 so caller can distinguish
    // from idempotent skip.
    return { ok: true, emitted: 0, alreadyExisted: false, lines: [] } as ResolveAndPersistResult;
  }

  // Per-key, not per-count. `alreadyPresent` is the ordinary state of a
  // re-run; `conflicting` means the resolver emitted two lines claiming the
  // same (session, factor, kind), which is a resolver bug and must not be
  // quietly deduplicated into a plausible-looking write.
  const plan = planGeneration(
    resolved,
    (l) => agreementBillingLineKey(sessionId, l.factorCode, l.kind),
    existingKeys,
  );
  if (plan.conflicting.length > 0) {
    return { ok: false, reason: "resolver_emitted_duplicate_lines" };
  }
  const lines = plan.toWrite;
  if (lines.length === 0) {
    return { ok: true, emitted: 0, alreadyExisted: true };
  }

  // BearerType in the DB enum is org | usr | trd. The resolver's
  // Allocation shape still allows "wrk" as authoring shorthand for
  // "the workplace ORG pays" — translate it at the storage boundary.
  // bearer_ref carries the workplace org id; bearer_type stores 'org'.
  const workplaceOrgId = ctxResult.ctx.driverGroup?.ownerOrgId ?? null;

  await prisma.agreementBillingLine.createMany({
    data: lines.map((l) => {
      const storageBearerType: "org" | "usr" | "trd" =
        l.bearerType === "wrk" ? "org" : l.bearerType;
      const storageBearerRef =
        l.bearerType === "wrk" ? workplaceOrgId : l.bearerRef;
      return {
        agreementId: ctxResult.ctx.agreementId,
        billableEventType: "session",
        sessionId,
        factorCode: l.factorCode,
        kind: l.kind,
        basisType: l.basisType,
        basisQuantity: l.basisQuantity,
        unitPriceMinor: l.unitPriceMinor,
        amountExVatMinor: l.amountExVatMinor,
        vatRatePct: l.vatRatePct,
        vatAmountMinor: l.vatAmountMinor,
        amountIncVatMinor: l.amountIncVatMinor,
        currency: l.currency,
        bearerType: storageBearerType,
        bearerRef: storageBearerRef,
        recipientOrgId: l.recipientOrgId,
        recipientUserId: l.recipientUserId,
        rateRefId: l.rateRefId,
        ruleId: l.ruleId,
        computationDetail: l.computationDetail as unknown as object,
      };
    }),
  });

  return { ok: true, emitted: lines.length, alreadyExisted: false, lines };
}
