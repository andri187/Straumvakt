// An in-memory `BillingOperationsPort`, backed by the real pure modules.
//
// This is not a mock. It uses the actual state machine, the actual feeder, the
// actual numbering and the actual document model — only the STORAGE is a Map.
// A mock would let the routes pass while the logic was wrong; this lets them
// fail for the same reasons production would.
//
// It exists so the API surface can be exercised with **no database and no
// socket**, which is the same reason `ActivitySourcePort` exists: neither 0002
// nor 0003 has been applied to anything, and the alternative to a fixture
// adapter is having to apply them to see whether a route works.
//
// Used by the route tests and by `scripts/dry-run-first-invoice.mts`.

import {
  applyPeriodEvent,
  countFromRows,
  generateFlatFeeStatementFromSource,
  type ActivitySourcePort,
  type BillingPeriodRef,
  type FlatFeeResult,
  type PeriodEvent,
  type PeriodLifecycleState,
  type RateRefInput,
} from "@straumvakt/commercial";
import {
  emptySequence,
  issue,
  type SequenceState,
} from "@straumvakt/contracts/invoice/number";
import type {
  BillingOperationsPort,
  IssuedDocument,
  MutationReceipt,
  ReceiptLookup,
  StatementSummary,
} from "./operations-port";

const keyOf = (p: BillingPeriodRef) => `${p.orgId}:${p.year}:${p.month}`;

export interface FixturePortSeed {
  /** Connector activity rows the aggregation would find, per period key. */
  connectorRows?: Record<string, number>;
  driverRows?: Record<string, number>;
  rateReferences: readonly RateRefInput[];
  /** Render a document. Injected so the port does not depend on a renderer. */
  render: (period: BillingPeriodRef, documentNumber: string) => string;
  /** Orgs this port may see. Anything else throws, mirroring the real guard. */
  orgIds?: string[] | null;
}

export interface FixturePortState {
  transitions: Array<{ period: string; event: PeriodEvent; to: PeriodLifecycleState; actor: string }>;
  receipts: Map<string, MutationReceipt>;
  assertions: Array<{ period: string; connectorId: string; actor: string; reason: string }>;
  documents: Map<string, IssuedDocument>;
  sequence: SequenceState;
  /** Every effect that actually ran, so a replay can be proven not to repeat. */
  effects: string[];
}

export function makeFixtureOperationsPort(seed: FixturePortSeed): {
  port: BillingOperationsPort;
  state: FixturePortState;
} {
  const state: FixturePortState = {
    transitions: [],
    receipts: new Map(),
    assertions: [],
    documents: new Map(),
    sequence: emptySequence({ orgScope: "fixture", series: "SV" }),
    effects: [],
  };

  const stateOf = (period: BillingPeriodRef): PeriodLifecycleState => {
    const mine = state.transitions.filter((t) => t.period === keyOf(period));
    return mine.length === 0 ? "not_opened" : mine[mine.length - 1]!.to;
  };

  const activityPort = (period: BillingPeriodRef): ActivitySourcePort => {
    const k = keyOf(period);
    const ps = stateOf(period);
    const connectors = seed.connectorRows?.[k] ?? 0;
    const drivers = seed.driverRows?.[k] ?? 0;
    return {
      connectorCount: async () =>
        countFromRows(connectors, { periodState: ps, source: "activity_month_table" }),
      driverCount: async () =>
        countFromRows(drivers, { periodState: ps, source: "activity_month_table" }),
    };
  };

  const port: BillingOperationsPort = {
    async lookupReceipt(orgId, scope, idempotencyKey, requestHash): Promise<ReceiptLookup> {
      const r = state.receipts.get(`${orgId}:${scope}:${idempotencyKey}`);
      if (!r) return { kind: "fresh" };
      // Same key, different request. A caller bug, and answering with the
      // first result would hide it.
      if (r.requestHash !== requestHash) {
        return { kind: "key_reused_with_different_request", receipt: r };
      }
      return { kind: "replay", receipt: r };
    },

    async recordReceipt(receipt) {
      state.receipts.set(`${receipt.orgId}:${receipt.scope}:${receipt.idempotencyKey}`, receipt);
    },

    async periodState(period) {
      return stateOf(period);
    },

    async applyPeriodEvent(input) {
      const current = stateOf(input.period);
      const decision = applyPeriodEvent({
        state: current,
        event: input.event,
        period: input.period,
        asOf: input.asOf,
        actorUserId: input.actorUserId,
      });
      if (decision.kind === "applied") {
        state.transitions.push({
          period: keyOf(input.period),
          event: input.event,
          to: decision.to,
          actor: input.actorUserId,
        });
        state.effects.push(`transition:${keyOf(input.period)}:${input.event}`);
        return { kind: "applied", from: decision.from, to: decision.to };
      }
      if (decision.kind === "noop") return { kind: "noop", state: decision.state };
      return { kind: "refused", state: decision.state, reason: decision.reason };
    },

    async recordActivity(period) {
      const k = keyOf(period);
      state.effects.push(`activity:${k}`);
      return {
        connectorRows: seed.connectorRows?.[k] ?? 0,
        driverRows: seed.driverRows?.[k] ?? 0,
      };
    },

    async assertConnector(input) {
      state.assertions.push({
        period: keyOf(input.period),
        connectorId: input.connectorId,
        actor: input.actorUserId,
        reason: input.reason,
      });
      state.effects.push(`assert:${keyOf(input.period)}:${input.connectorId}`);
      return { kind: "recorded" };
    },

    async price(period): Promise<FlatFeeResult> {
      state.effects.push(`price:${keyOf(period)}`);
      return generateFlatFeeStatementFromSource(activityPort(period), {
        period,
        rateReferences: seed.rateReferences,
      });
    },

    async listStatements(orgId) {
      const out: StatementSummary[] = [];
      for (const [k, doc] of state.documents) {
        const [o, y, m] = k.split(":");
        if (o !== orgId) continue;
        out.push({
          orgId,
          period: { orgId, year: Number(y), month: Number(m) },
          totalIsk: "0",
          currency: "ISK",
          documentNumber: doc.documentNumber,
          lineCount: 0,
        });
      }
      return out;
    },

    async issueDocument({ period, idempotencyKey }) {
      const existing = state.documents.get(keyOf(period));
      if (existing) return { kind: "issued", document: existing };

      // Allocation and issue in one step, and the sequence state is only
      // committed alongside the document. A number allocated without a
      // document is a hole in a sequence Icelandic law requires to be
      // unbroken, and there is deliberately no release operation.
      const alloc = issue(state.sequence, { idempotencyKey, year: period.year });
      const document: IssuedDocument = {
        documentNumber: alloc.documentNumber,
        rendered: seed.render(period, alloc.documentNumber),
        deliveryState: "pending",
      };
      state.sequence = alloc.state;
      state.documents.set(keyOf(period), document);
      state.effects.push(`issue:${keyOf(period)}:${alloc.documentNumber}`);
      return { kind: "issued", document };
    },

    async fetchDocument(period) {
      return state.documents.get(keyOf(period)) ?? null;
    },
  };

  return { port, state };
}
