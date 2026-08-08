// Sprint 9 / ADR 0019 — agreement resolver.
//
// Pure function: given a SessionContext (already-loaded clauses + rules +
// rate references + asset path + session readings), produce the set of
// BillingLineDraft rows to write at session-stop. No I/O, no Prisma.
//
// Walk semantics, per ADR 0019:
//   - For each enlisted factor, walk most-specific to least-specific
//     across the (audience x scope) ladder, then fall through to the
//     AgreementClause default.
//   - Each override attribute (bearer, rate_ref_code, allocation) walks
//     INDEPENDENTLY. A rule that fills only `bearerType` lets `rateRefCode`
//     keep walking past it.
//   - Audience precedence: Driver beats DriverGroup beats All.
//   - Scope precedence: Charger beats Circuit beats Installation beats
//     Site beats null.
//   - Effective-date filter: rule applies iff
//     effective_from <= session.startedAt < effective_until.

import {
  type Allocation,
  type BearerCode,
  type BillingLineDraft,
  type ClauseInput,
  type RateBasis,
  type RateRefInput,
  type ResolvedFactor,
  type RuleInput,
  type SessionContext,
} from "./types";

// ── Public entrypoint ────────────────────────────────────────────────

export function resolveBillingLines(ctx: SessionContext): BillingLineDraft[] {
  const out: BillingLineDraft[] = [];
  for (const clause of ctx.clauses) {
    const resolved = resolveFactor(ctx, clause);
    out.push(...computeBillingLines(ctx, resolved));
  }
  return out;
}

// ── Per-factor resolution ────────────────────────────────────────────

export function resolveFactor(ctx: SessionContext, clause: ClauseInput): ResolvedFactor {
  const ladder = buildLadder(ctx, clause.costFactorId);

  const bearerSource = ladder.find((r) => r.bearerType !== null) ?? null;
  const rateSource = ladder.find((r) => r.rateRefCode !== null) ?? null;
  const allocSource = ladder.find((r) => r.allocation !== null) ?? null;

  const bearerType: BearerCode = bearerSource?.bearerType ?? clause.defaultBearerType;
  const bearerRef = bearerSource?.bearerRef ?? clause.defaultBearerRef;
  const rateRefCode = rateSource?.rateRefCode ?? clause.defaultRateRefCode;
  const allocation: Allocation = allocSource?.allocation ?? clause.allocation;

  const rateRef = rateRefCode === null
    ? null
    : pickActiveRate(ctx.rateReferences, rateRefCode, ctx.startedAt);

  return {
    factorCode: clause.costFactorCode,
    bearerType,
    bearerRef,
    rateRef,
    allocation,
    cascadeSource: {
      bearer: bearerSource?.id ?? null,
      rate: rateSource?.id ?? null,
      allocation: allocSource?.id ?? null,
    },
  };
}

// Build the ordered candidate list — most-specific first. The list only
// includes rules that actually match this user's audience and the asset's
// scope path; the consumer just walks linearly.
export function buildLadder(ctx: SessionContext, costFactorId: string): RuleInput[] {
  const candidates = ctx.rules.filter(
    (r) =>
      r.costFactorId === costFactorId &&
      r.effectiveFrom.getTime() <= ctx.startedAt.getTime() &&
      (r.effectiveUntil === null || r.effectiveUntil.getTime() > ctx.startedAt.getTime())
  );

  const matches: { audienceTier: number; scopeTier: number; rule: RuleInput }[] = [];

  for (const r of candidates) {
    // Skip rules whose audience doesn't match this user.
    if (r.audienceType === "user" && r.audienceId !== ctx.user.id) continue;
    if (r.audienceType === "driver_group") {
      if (!ctx.driverGroup || r.audienceId !== ctx.driverGroup.id) continue;
    }

    // Skip rules whose scope doesn't match this asset path.
    if (r.scopeType === "site" && r.scopeId !== ctx.siteId) continue;
    if (r.scopeType === "installation" && r.scopeId !== ctx.installationId) continue;
    if (r.scopeType === "circuit" && r.scopeId !== ctx.circuitId) continue;
    if (r.scopeType === "charger" && r.scopeId !== ctx.chargerId) continue;

    const audienceTier =
      r.audienceType === "user" ? 1
      : r.audienceType === "driver_group" ? 2
      : 3;
    const scopeTier =
      r.scopeType === "charger" ? 1
      : r.scopeType === "circuit" ? 2
      : r.scopeType === "installation" ? 3
      : r.scopeType === "site" ? 4
      : 5;

    matches.push({ audienceTier, scopeTier, rule: r });
  }

  matches.sort(
    (a, b) => a.audienceTier - b.audienceTier || a.scopeTier - b.scopeTier
  );
  return matches.map((m) => m.rule);
}

// Resolve the active rate for (code, time). Picks the row with the latest
// effective_from <= time and (effective_until > time OR null).
export function pickActiveRate(
  refs: RateRefInput[],
  code: string,
  at: Date
): RateRefInput | null {
  const matches = refs.filter(
    (r) =>
      r.code === code &&
      r.effectiveFrom.getTime() <= at.getTime() &&
      (r.effectiveUntil === null || r.effectiveUntil.getTime() > at.getTime())
  );
  if (matches.length === 0) return null;
  matches.sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime());
  return matches[0]!;
}

// ── BillingLineDraft computation ─────────────────────────────────────

export function computeBillingLines(
  ctx: SessionContext,
  resolved: ResolvedFactor
): BillingLineDraft[] {
  const rate = resolved.rateRef;
  if (!rate) {
    // No rate → nothing to bill for this factor on this session.
    return [];
  }

  const out: BillingLineDraft[] = [];
  const basisQuantity = basisQuantityFor(rate.basis, ctx);
  const rawExVat = multiplyMinorByDecimal(rate.priceMinor, basisQuantity);

  // Passthrough — one line per non-zero split.
  for (const split of resolved.allocation.passthrough.splits) {
    if (split.share_pct === 0) continue;
    const splitMinor = halfUpDiv(rawExVat * BigInt(Math.round(split.share_pct * 100)), 10000n);
    out.push(
      finalizeLine({
        factorCode: resolved.factorCode,
        kind: "passthrough",
        basisType: rate.basis,
        basisQuantity: roundDecimal(basisQuantity * (split.share_pct / 100), 4),
        unitPriceMinor: rate.priceMinor,
        amountExVatMinor: splitMinor,
        vatRatePct: rate.vatRatePct,
        currency: rate.currency,
        bearerType: split.bearer_type,
        bearerRef: split.bearer_ref ?? null,
        recipientOrgId: rate.supplierOrgId,
        recipientUserId: null,
        rateRefId: rate.id,
        ruleId: resolved.cascadeSource.bearer,
        computationDetail: {
          factorCode: resolved.factorCode,
          kind: "passthrough",
          sharePct: split.share_pct,
          basisQuantityFull: basisQuantity,
          rateCode: rate.code,
          cascadeSource: resolved.cascadeSource,
        },
      })
    );
  }

  // Markup — at most one line.
  if (resolved.allocation.markup) {
    const m = resolved.allocation.markup;
    const markupMinor = computeMarkupMinor(m, rawExVat, ctx);
    if (markupMinor > 0n) {
      const recipientOrgId = resolveRecipientOrgId(ctx, m.recipient_type);
      out.push(
        finalizeLine({
          factorCode: resolved.factorCode,
          kind: "markup",
          basisType: rate.basis,
          basisQuantity,
          unitPriceMinor: 0n,
          amountExVatMinor: markupMinor,
          vatRatePct: rate.vatRatePct,
          currency: rate.currency,
          bearerType: m.payer_type,
          bearerRef: m.payer_ref ?? null,
          recipientOrgId,
          recipientUserId: null,
          rateRefId: rate.id,
          ruleId: resolved.cascadeSource.allocation,
          computationDetail: {
            factorCode: resolved.factorCode,
            kind: "markup",
            markup: m,
            rawExVat: rawExVat.toString(),
            basisQuantity,
            cascadeSource: resolved.cascadeSource,
          },
        })
      );
    }
  }

  return out;
}

// ── Helpers ──────────────────────────────────────────────────────────

function basisQuantityFor(basis: RateBasis, ctx: SessionContext): number {
  switch (basis) {
    case "per_kwh": return ctx.energyKwh;
    case "per_minute": return ctx.durationMinutes;
    case "per_day": return ctx.durationDays;
    case "per_session": return 1;
  }
}

function computeMarkupMinor(
  m: NonNullable<Allocation["markup"]>,
  rawExVat: bigint,
  ctx: SessionContext
): bigint {
  switch (m.basis) {
    case "percent":
      return halfUpDiv(rawExVat * BigInt(Math.round(m.value * 100)), 10000n);
    case "fixed_per_kwh":
      return multiplyMinorByDecimal(BigInt(Math.round(m.value * 100)), ctx.energyKwh);
    case "fixed_per_minute":
      return multiplyMinorByDecimal(BigInt(Math.round(m.value * 100)), ctx.durationMinutes);
    case "fixed_per_session":
      return BigInt(Math.round(m.value * 100));
  }
}

function resolveRecipientOrgId(ctx: SessionContext, recipient: "org" | "wrk"): string | null {
  if (recipient === "org") return ctx.cpoOrgId;
  if (recipient === "wrk") return ctx.driverGroup?.ownerOrgId ?? null;
  return null;
}

// Multiply a BigInt minor amount by a JS-Number decimal with half-up
// rounding at 6 fractional digits of intermediate precision. Matches the
// semantics of the legacy compute-session-cost.ts helpers.
export function multiplyMinorByDecimal(minor: bigint, decimal: number): bigint {
  const SCALE = 1_000_000n;
  const scaled = BigInt(Math.round(decimal * 1_000_000));
  const product = minor * scaled;
  return halfUpDiv(product, SCALE);
}

// Half-up division: (a + b/2) / b, but careful with sign (we only deal with
// non-negative amounts here).
export function halfUpDiv(a: bigint, b: bigint): bigint {
  return (a + b / 2n) / b;
}

function vatOf(amountMinor: bigint, vatRatePct: number): bigint {
  // vatRatePct is a Decimal(4,2) — at most 2 decimal places, e.g. 24.00.
  return halfUpDiv(amountMinor * BigInt(Math.round(vatRatePct * 100)), 10000n);
}

function roundDecimal(n: number, places: number): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

function finalizeLine(
  line: Omit<BillingLineDraft, "vatAmountMinor" | "amountIncVatMinor">
): BillingLineDraft {
  const vatAmountMinor = vatOf(line.amountExVatMinor, line.vatRatePct);
  return {
    ...line,
    vatAmountMinor,
    amountIncVatMinor: line.amountExVatMinor + vatAmountMinor,
  };
}
