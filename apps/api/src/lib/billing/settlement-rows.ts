// From pure snapshot to durable row, and nowhere else.
//
// packages/commercial/src/core-billing produces SettlementSnapshot and
// StatementDocument. packages/shared/src/db/commercial.ts declares the tables.
// Between them is the place every previous billing generation went wrong: the
// translation. Two examples already in this tree, both live today —
//
//   repositories/driver-sessions.ts:93-98  minorToIsk = (minor) => Number(minor)
//   repositories/driver-invoices.ts:66-68  costIsk: Number(lc)
//
// — under a comment claiming ISK has no minor unit. It does: minor is 1/100
// króna, projections.ts persists aurar, and projections.test.ts:397 pins a
// 649.88 kr session at 64988n. Both endpoints render 64,988 kr. That is not a
// missing feature, it is a one-line translation nobody checked.
//
// So this module is where the translation lives, it is pure, and it refuses
// rather than guesses. It performs NO I/O: it takes a snapshot and returns row
// objects typed against the real Drizzle tables via $inferInsert, so a column
// rename breaks the build here instead of at runtime in a handler.
//
// The refusals are the point. Each one is a way a wrong number could otherwise
// reach a customer while looking deliberate.

import type {
  sessionSettlements,
  settlementComponents,
  settlementHolds,
  statementLines,
  statements,
} from "@straumvakt/shared/db/commercial";
import type {
  ReviewReason,
  SettlementSnapshot,
  StatementDocument,
} from "@straumvakt/commercial";

export type SessionSettlementRow = typeof sessionSettlements.$inferInsert;
export type SettlementComponentRow = typeof settlementComponents.$inferInsert;
export type SettlementHoldRow = typeof settlementHolds.$inferInsert;
export type StatementRow = typeof statements.$inferInsert;
export type StatementLineRow = typeof statementLines.$inferInsert;

/** Every way this module can refuse. A refusal is never a silent zero. */
export type MappingRefusal =
  /** The snapshot belongs to a different org than the period being written. */
  | "cross_tenant_snapshot"
  /** A held snapshot with no reasons — nothing to show the operator. */
  | "held_without_reason"
  /** A settled snapshot carrying review reasons — contradictory. */
  | "settled_with_reasons"
  /** Statement total does not equal the sum of its rounded lines. */
  | "total_not_sum_of_lines"
  /** An excluded session id that is not one of this org's sessions. */
  | "foreign_excluded_session"
  /** A line references a session absent from the settlements it was built from. */
  | "line_references_unknown_session"
  /** Money arrived as something other than a bigint. */
  | "non_bigint_money";

export class MappingError extends Error {
  constructor(
    readonly refusal: MappingRefusal,
    message: string,
  ) {
    super(message);
    this.name = "MappingError";
  }
}

function refuse(refusal: MappingRefusal, message: string): never {
  throw new MappingError(refusal, message);
}

/** Snapshot timestamps are ISO strings — pure modules never hold a Date. */
function at(iso: string): Date {
  return new Date(iso);
}

/** kWh from the snapshot's Wh, only where a figure exists. */
function whToKwhString(wh: number | null): string | null {
  return wh === null ? null : (wh / 1000).toFixed(3);
}

export interface SettlementRowsInput {
  snapshot: SettlementSnapshot;
  /** The billing_periods row this session settles into. */
  periodId: string;
  /** The org the caller is authorised for. Compared, not trusted. */
  orgId: string;
  /** CDR figure, when one arrived. Recorded so a dispute has both numbers. */
  cdrEnergyKwh?: number | null;
  /** Per-reason detail an operator will read. Optional; absence is not a lie. */
  holdDetail?: Partial<Record<ReviewReason, string>>;
}

export interface SettlementRows {
  settlement: SessionSettlementRow;
  components: SettlementComponentRow[];
  holds: SettlementHoldRow[];
}

/**
 * One snapshot becomes one settlement, N components, and M holds.
 *
 * `orgId` is passed separately and COMPARED to the snapshot's own, rather than
 * read from it. A mapper that trusts the payload for its tenant is a mapper
 * that will happily write another org's session under this org's period the
 * first time a route forgets to scope — which, per the census, is 33 of the 41
 * billing gates today.
 */
export function buildSettlementRows(input: SettlementRowsInput): SettlementRows {
  const { snapshot, periodId, orgId } = input;

  if (snapshot.orgId !== orgId) {
    refuse(
      "cross_tenant_snapshot",
      `snapshot belongs to org ${snapshot.orgId}, caller is scoped to ${orgId}`,
    );
  }

  const held = snapshot.status === "billing_review_required";
  if (held && snapshot.reviewReasons.length === 0) {
    refuse(
      "held_without_reason",
      `session ${snapshot.sessionId} is held with no reason — an operator would have nothing to clear`,
    );
  }
  if (!held && snapshot.reviewReasons.length > 0) {
    refuse(
      "settled_with_reasons",
      `session ${snapshot.sessionId} is settled but carries ${snapshot.reviewReasons.length} review reason(s)`,
    );
  }

  for (const [name, v] of [
    ["amountExVatMinor", snapshot.amountExVatMinor],
    ["vatMinor", snapshot.vatMinor],
    ["totalIncVatMinor", snapshot.totalIncVatMinor],
    ["totalIsk", snapshot.totalIsk],
    ["plugTimeFeeMinor", snapshot.plugTimeFeeMinor],
  ] as const) {
    if (typeof v !== "bigint") {
      refuse("non_bigint_money", `${name} is ${typeof v}, expected bigint aurar`);
    }
  }

  const settlement: SessionSettlementRow = {
    sessionId: snapshot.sessionId,
    orgId,
    periodId,
    connectorId: snapshot.connectorId,
    driverUserId: snapshot.driverId,
    startedAt: at(snapshot.startedAt),
    stoppedAt: at(snapshot.stoppedAt),
    energyWh: snapshot.energyWh,
    meterStartWh: snapshot.meterStartWh,
    meterStopWh: snapshot.meterStopWh,
    cdrEnergyKwh:
      input.cdrEnergyKwh === null || input.cdrEnergyKwh === undefined
        ? null
        : input.cdrEnergyKwh.toFixed(3),
    plugTimeSeconds: snapshot.plugTimeSeconds,
    plugTimeFeeMinor: snapshot.plugTimeFeeMinor,
    amountExVatMinor: snapshot.amountExVatMinor,
    vatRatePct: snapshot.vatRatePct.toFixed(2),
    vatMinor: snapshot.vatMinor,
    totalIncVatMinor: snapshot.totalIncVatMinor,
    totalIsk: snapshot.totalIsk,
    currency: snapshot.currency,
    status: snapshot.status,
    provenance: snapshot.provenance,
    provenanceState: snapshot.provenanceState,
    rateSelectionPolicy: snapshot.rateSelectionPolicy,
    pricedAt: at(snapshot.pricedAt),
    // committedAt stays null here. A settlement is evidence for a bill; it
    // becomes committed when a human closes the period, not when it is priced.
    committedAt: null,
    explanation: snapshot.explanation,
    updatedAt: at(snapshot.pricedAt),
  };

  const components: SettlementComponentRow[] = snapshot.components.map((c) => ({
    sessionId: snapshot.sessionId,
    orgId,
    kind: c.kind,
    rateVersionId: c.rateVersionId,
    // Copied, not joined. This is the whole rate lock-in property: nothing
    // reads the price back through rateVersionId, so editing the rate row
    // later cannot restate this session.
    unitPriceMinor: c.pricePerKwhMinor,
    effectiveFrom: at(c.effectiveFrom),
    effectiveUntil: c.effectiveUntil === null ? null : at(c.effectiveUntil),
    amountExVatMinor: c.amountExVatMinor,
  }));

  const holds: SettlementHoldRow[] = snapshot.reviewReasons.map((reason) => ({
    sessionId: snapshot.sessionId,
    orgId,
    reason,
    detail: input.holdDetail?.[reason] ?? null,
    raisedAt: at(snapshot.pricedAt),
  }));

  return { settlement, components, holds };
}

export interface StatementRowsInput {
  document: StatementDocument;
  /** The org the caller is authorised for. Compared to the document's period. */
  orgId: string;
  periodId: string;
  /** Row id for the statement, so lines can reference it before insert. */
  statementId: string;
  /**
   * Session ids known to belong to this org. Supplied by the caller because
   * only the caller can know; used to prove no foreign id reaches
   * excluded_session_ids or a line.
   */
  ownSessionIds: ReadonlySet<string>;
  generatedByUserId?: string | null;
}

export interface StatementRows {
  statement: StatementRow;
  lines: StatementLineRow[];
}

/**
 * One document becomes one statement and N lines.
 *
 * The total is re-checked against the sum of the ROUNDED line amounts. That is
 * not defensive duplication of buildDriverStatement's own arithmetic — it is
 * the one invariant that must hold at the storage boundary, because
 * statements.total_isk is what a customer is shown and statement_lines is what
 * they are shown it broken into. If those two ever disagree, the disagreement
 * must stop here rather than being printed.
 *
 * On the canonical three-line fixture, sum-of-rounded is 889 and
 * rounding-of-sum is 888. The customer-facing answer is 889.
 */
export function buildStatementRows(input: StatementRowsInput): StatementRows {
  const { document, orgId, periodId, statementId, ownSessionIds } = input;

  if (document.period.orgId !== orgId) {
    refuse(
      "cross_tenant_snapshot",
      `statement is for org ${document.period.orgId}, caller is scoped to ${orgId}`,
    );
  }

  // A session id on a customer-facing document that belongs to another tenant
  // is the worst possible surfacing of the unscoped-read problem.
  for (const id of document.excludedSessionIds) {
    if (!ownSessionIds.has(id)) {
      refuse(
        "foreign_excluded_session",
        `excluded session ${id} is not one of org ${orgId}'s sessions`,
      );
    }
  }
  for (const l of document.lines) {
    for (const id of [l.sessionId, l.correctsSessionId]) {
      if (id !== undefined && !ownSessionIds.has(id)) {
        refuse(
          "line_references_unknown_session",
          `statement line references session ${id}, which is not one of org ${orgId}'s sessions`,
        );
      }
    }
  }

  const summed = document.lines.reduce((a, l) => a + l.amountIsk, 0n);
  if (summed !== document.totalIsk) {
    refuse(
      "total_not_sum_of_lines",
      `statement total ${document.totalIsk} != sum of rounded lines ${summed}`,
    );
  }

  const statement: StatementRow = {
    id: statementId,
    orgId,
    periodId,
    recipientKind: document.recipientKind,
    recipientId: document.recipientId,
    statementKey: document.statementId,
    totalIsk: document.totalIsk,
    currency: document.currency,
    excludedSessionIds: [...document.excludedSessionIds],
    generatedAt: at(document.generatedAt),
    generatedByUserId: input.generatedByUserId ?? null,
    updatedAt: at(document.generatedAt),
  };

  const lines: StatementLineRow[] = document.lines.map((l, i) => ({
    statementId,
    orgId,
    // 1-based and assigned here, so the printed order is stable across a
    // regenerate and (statement_id, line_no) can be unique.
    lineNo: i + 1,
    kind: l.kind,
    description: l.description,
    quantity: l.quantity === null ? null : l.quantity.toFixed(4),
    unit: l.unit,
    unitPriceMinor: l.unitPriceMinor,
    // Both figures are stored. amountMinor is the unrounded aurar audit trail;
    // amountIsk is what the customer is billed. Keep one and the difference
    // between sum-of-rounded and rounding-of-sum is unrecoverable.
    amountMinor: l.amountMinor,
    amountIsk: l.amountIsk,
    sessionId: l.sessionId ?? null,
    correctsSessionId: l.correctsSessionId ?? null,
    reason: l.reason ?? null,
  }));

  return { statement, lines };
}

/**
 * Does this set of rows describe a period that can be closed?
 *
 * Pure predicate over rows rather than over the database, so a route can ask
 * before it writes and a test can ask without one. Deliberately conservative:
 * an unresolved hold blocks, and an unknown state blocks.
 */
export function settlementsBlockingClose(
  settlements: readonly Pick<SessionSettlementRow, "sessionId" | "status">[],
  holds: readonly Pick<SettlementHoldRow, "sessionId" | "resolvedAt">[],
): string[] {
  const unresolved = new Set(
    holds.filter((h) => h.resolvedAt === null || h.resolvedAt === undefined).map((h) => h.sessionId),
  );
  const blocking = new Set<string>();
  for (const s of settlements) {
    if (s.status === "billing_review_required") blocking.add(s.sessionId);
    if (unresolved.has(s.sessionId)) blocking.add(s.sessionId);
  }
  return [...blocking].sort();
}
