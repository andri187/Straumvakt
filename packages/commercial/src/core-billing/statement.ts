// Statements: turning settled sessions into the document a customer receives.
//
// WHY THIS EXISTS
//
// period-close.ts can decide whether a month MAY close. subscription.ts can
// price the 200/50/450 frame. settlement.ts can freeze what a session cost.
// Nothing joined them into the thing a customer is actually sent, and
// `billing.statements` — including the `content` JSONB that held the rendered
// document — was dropped in 20260807120000_drop_never_used_tables.
//
// This module is the pure join. It is deliberately NOT a database writer, and
// it does not pretend to be one: it produces a `StatementDocument` that maps
// one-to-one onto the tables proposed in the schema package, so wiring it up
// later is a persistence exercise, not a redesign.
//
// ── Two invariants this module exists to enforce ─────────────────────────
//
// 1. The total is the sum of ROUNDED lines. Rounding the sum instead lets the
//    printed total disagree with the printed lines, which is the one error a
//    customer is guaranteed to find.
//
// 2. Identity is deterministic. The same period, the same recipient and the
//    same inputs must produce the same statement id — otherwise a retried
//    "generate" produces a second document for a month that already has one,
//    and the delivery log cannot tell them apart.

import {
  roundAurarToIsk,
  sumRoundedLinesIsk,
  type Aurar,
  type Isk,
} from "./money";
import type { SettlementSnapshot } from "./settlement";
import {
  computeCoreSubscription,
  type CoreSubscriptionBreakdown,
} from "./subscription";
import {
  periodBounds,
  type BillingPeriodRef,
  type CorrectionLine,
  type PeriodState,
} from "./period-close";

export type StatementRecipientKind = "driver" | "organisation";

export type StatementLineKind =
  | "session_energy"
  | "plug_time"
  | "subscription_connector"
  | "subscription_driver"
  | "cap_relief"
  | "correction";

export interface StatementLine {
  kind: StatementLineKind;
  description: string;
  /** kWh, minutes, connector-months — whatever the line is priced per. */
  quantity: number | null;
  unit: string | null;
  /** ex-VAT unit price in aurar, where one applies. */
  unitPriceMinor: Aurar | null;
  /** The unrounded aurar figure, kept for audit. */
  amountMinor: Aurar;
  /** The BILLED figure: whole ISK, half-up. This is what sums to the total. */
  amountIsk: Isk;
  sessionId?: string;
  correctsSessionId?: string;
  reason?: string;
}

export interface StatementDocument {
  /** Deterministic. See statementIdentity. */
  statementId: string;
  period: BillingPeriodRef;
  periodStart: string;
  periodEnd: string;
  recipientKind: StatementRecipientKind;
  recipientId: string;
  lines: StatementLine[];
  /** Sum of the rounded line amounts. */
  totalIsk: Isk;
  currency: "ISK";
  /** Sessions that could not be settled and are therefore NOT on this document. */
  excludedSessionIds: string[];
  billingApplicability: "requires-admin-confirmation";
  generatedAt: string;
}

/**
 * Deterministic statement identity.
 *
 * A pure, dependency-free FNV-1a over the identifying fields. It is not a
 * cryptographic hash and does not need to be — its only job is that the same
 * inputs yield the same id, so a retried generate is recognisably the same
 * document rather than a new one.
 */
export function statementIdentity(
  period: BillingPeriodRef,
  recipientKind: StatementRecipientKind,
  recipientId: string,
  sessionIds: readonly string[],
): string {
  const material = [
    period.orgId,
    String(period.year),
    String(period.month),
    recipientKind,
    recipientId,
    ...[...sessionIds].sort(),
  ].join("|");

  let h = 0x811c9dc5;
  for (let i = 0; i < material.length; i++) {
    h ^= material.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `stmt_${period.year}${String(period.month).padStart(2, "0")}_${recipientKind}_${h
    .toString(16)
    .padStart(8, "0")}`;
}

function line(
  kind: StatementLineKind,
  description: string,
  amountMinor: Aurar,
  extra: Partial<StatementLine> = {},
): StatementLine {
  return {
    kind,
    description,
    quantity: extra.quantity ?? null,
    unit: extra.unit ?? null,
    unitPriceMinor: extra.unitPriceMinor ?? null,
    amountMinor,
    amountIsk: roundAurarToIsk(amountMinor),
    ...(extra.sessionId ? { sessionId: extra.sessionId } : {}),
    ...(extra.correctsSessionId ? { correctsSessionId: extra.correctsSessionId } : {}),
    ...(extra.reason ? { reason: extra.reason } : {}),
  };
}

export interface DriverStatementInput {
  period: BillingPeriodRef;
  driverId: string;
  snapshots: readonly SettlementSnapshot[];
  corrections?: readonly CorrectionLine[];
  generatedAt: Date;
}

/**
 * A driver's statement for one period.
 *
 * Only `settled` snapshots become lines. A snapshot in
 * `billing_review_required` is excluded and named in `excludedSessionIds` —
 * it is never silently priced at zero, and never quietly omitted.
 *
 * Snapshots belonging to another org are dropped, not billed. Cross-tenant
 * bleed on a customer-facing document would be the worst possible place for
 * the unscoped-read problem to surface.
 */
export function buildDriverStatement(input: DriverStatementInput): StatementDocument {
  const mine = input.snapshots.filter(
    (s) => s.orgId === input.period.orgId && s.driverId === input.driverId,
  );
  const settled = mine.filter((s) => s.status === "settled");
  const excluded = mine.filter((s) => s.status !== "settled").map((s) => s.sessionId);

  const lines: StatementLine[] = [];
  for (const s of settled) {
    // A session becomes one energy line, plus a plug-time line when occupancy
    // was charged. The VAT is split between them in proportion to their
    // ex-VAT amounts, so the two lines still sum to the session's total —
    // splitting a session must not create or destroy VAT.
    const plugVat = plugVatShare(s);
    const energyPortion = s.totalIncVatMinor - s.plugTimeFeeMinor - plugVat;

    lines.push(
      line("session_energy", `Charging ${s.startedAt.slice(0, 10)}`, energyPortion, {
        quantity: s.energyWh === null ? null : s.energyWh / 1000,
        unit: "kWh",
        sessionId: s.sessionId,
      }),
    );

    if (s.plugTimeFeeMinor > 0n) {
      lines.push(
        line("plug_time", "Plug-time fee", s.plugTimeFeeMinor + plugVat, {
          quantity: s.plugTimeSeconds === null ? null : Math.floor(s.plugTimeSeconds / 60),
          unit: "min",
          sessionId: s.sessionId,
        }),
      );
    }
  }

  for (const c of input.corrections ?? []) {
    lines.push(
      line("correction", c.displayName, c.amountMinor, {
        reason: c.reason,
        ...(c.note ? {} : {}),
      }),
    );
  }

  const bounds = periodBounds(input.period);
  return {
    statementId: statementIdentity(
      input.period,
      "driver",
      input.driverId,
      settled.map((s) => s.sessionId),
    ),
    period: input.period,
    periodStart: bounds.start.toISOString(),
    periodEnd: bounds.end.toISOString(),
    recipientKind: "driver",
    recipientId: input.driverId,
    lines,
    totalIsk: sumRoundedLinesIsk(lines.map((l) => l.amountIsk)),
    currency: "ISK",
    excludedSessionIds: excluded,
    billingApplicability: "requires-admin-confirmation",
    generatedAt: input.generatedAt.toISOString(),
  };
}

/** VAT attributable to the plug-time portion, so splitting a session into an
 *  energy line and a plug-time line does not lose or duplicate VAT. */
function plugVatShare(s: SettlementSnapshot): Aurar {
  if (s.plugTimeFeeMinor === 0n || s.amountExVatMinor === 0n) return 0n;
  return (s.vatMinor * s.plugTimeFeeMinor) / s.amountExVatMinor;
}

export interface OrgStatementInput {
  period: BillingPeriodRef;
  activeConnectors: number;
  activeDrivers: number;
  /** Every settled snapshot in the org for the period. */
  snapshots: readonly SettlementSnapshot[];
  corrections?: readonly CorrectionLine[];
  generatedAt: Date;
}

export interface OrgStatementDocument extends StatementDocument {
  subscription: CoreSubscriptionBreakdown;
  sessionCount: number;
  totalEnergyKwh: number;
}

/**
 * The organisation's statement: the Core subscription plus what was charged.
 *
 * The 450 kr cap appears as its own visible `cap_relief` line rather than as a
 * quietly reduced connector charge — `computeCoreSubscription` already returns
 * it that way, and a customer who cannot see the discount cannot verify it.
 */
export function buildOrgStatement(input: OrgStatementInput): OrgStatementDocument {
  const mine = input.snapshots.filter((s) => s.orgId === input.period.orgId);
  const settled = mine.filter((s) => s.status === "settled");
  const excluded = mine.filter((s) => s.status !== "settled").map((s) => s.sessionId);

  const subscription = computeCoreSubscription({
    activeConnectors: input.activeConnectors,
    activeDrivers: input.activeDrivers,
  });

  const lines: StatementLine[] = subscription.lineItems.map((l) =>
    line(
      l.kind === "connector_subscription"
        ? "subscription_connector"
        : l.kind === "driver_subscription"
          ? "subscription_driver"
          : "cap_relief",
      l.displayName,
      l.amountMinor,
      {
        quantity: l.qty,
        unit: l.qtyUnit === "—" ? null : l.qtyUnit,
        unitPriceMinor: l.unitPriceMinor,
      },
    ),
  );

  for (const c of input.corrections ?? []) {
    lines.push(line("correction", c.displayName, c.amountMinor, { reason: c.reason }));
  }

  const bounds = periodBounds(input.period);
  return {
    statementId: statementIdentity(
      input.period,
      "organisation",
      input.period.orgId,
      settled.map((s) => s.sessionId),
    ),
    period: input.period,
    periodStart: bounds.start.toISOString(),
    periodEnd: bounds.end.toISOString(),
    recipientKind: "organisation",
    recipientId: input.period.orgId,
    lines,
    totalIsk: sumRoundedLinesIsk(lines.map((l) => l.amountIsk)),
    currency: "ISK",
    excludedSessionIds: excluded,
    billingApplicability: "requires-admin-confirmation",
    generatedAt: input.generatedAt.toISOString(),
    subscription,
    sessionCount: settled.length,
    totalEnergyKwh: settled.reduce((sum, s) => sum + (s.energyWh ?? 0) / 1000, 0),
  };
}

/** Invariant: the printed total equals the sum of the printed lines. */
export function statementTotalIsConsistent(doc: StatementDocument): boolean {
  return doc.totalIsk === sumRoundedLinesIsk(doc.lines.map((l) => l.amountIsk));
}

/** Invariant: no line references a session excluded from the document. */
export function statementExcludesReviewSessions(doc: StatementDocument): boolean {
  const excluded = new Set(doc.excludedSessionIds);
  return doc.lines.every((l) => !l.sessionId || !excluded.has(l.sessionId));
}

export type GenerationRefusal =
  | "period_not_closed"
  | "already_generated_with_different_content";

/**
 * May a statement be generated?
 *
 * A statement is issued FROM a closed period. Generating from an open one puts
 * a figure in a customer's hands that the system may still change underneath
 * them — the mirror of refusing to regenerate a closed statement.
 */
export function canGenerateStatement(
  periodState: PeriodState,
  existingStatementId: string | null,
  candidateStatementId: string,
): { allowed: boolean; reason?: GenerationRefusal; idempotentReplay: boolean } {
  if (periodState !== "closed") {
    return { allowed: false, reason: "period_not_closed", idempotentReplay: false };
  }
  if (existingStatementId === null) return { allowed: true, idempotentReplay: false };
  if (existingStatementId === candidateStatementId) {
    return { allowed: true, idempotentReplay: true };
  }
  return {
    allowed: false,
    reason: "already_generated_with_different_content",
    idempotentReplay: false,
  };
}
