// TEST-ONLY in-memory CostingStore. Models row locking (a row claimed in a
// running transaction is skipped), atomic commit/rollback and the state machine.
// It proves service logic only, not PostgreSQL's FOR UPDATE SKIP LOCKED.

import type { BillingLineDraft } from "@straumvakt/commercial/agreement/types";
import type { CostingTxFacts, PlacementFacts } from "../cost-session";
import type { CostingStore, CostingTxPort } from "../service";
import { MAX_COSTING_ATTEMPTS } from "../service";

type Row = { tx: CostingTxFacts; state: string; attempts: number; detail: unknown };
type Written = { sessionId: string; agreementId: string; workplaceOrgId: string | null; lines: BillingLineDraft[] };

export function memoryCostingStore(init: { rows: CostingTxFacts[]; placements?: Record<string, PlacementFacts> }) {
  let state = { rows: init.rows.map((tx): Row => ({ tx, state: "needed", attempts: 0, detail: null })), written: [] as Written[] };
  const locked = new Set<string>();
  const hooks = { failWriteFor: new Set<string>() };
  const placements = init.placements ?? {};

  const store: CostingStore = {
    async run(fn) {
      const snap = structuredClone(state);
      const mine = new Set<string>();
      try {
        const port: CostingTxPort = {
          async claimOne(onlyId) {
            const r = state.rows.find((x) => x.state === "needed" && !locked.has(x.tx.id) && (!onlyId || x.tx.id === onlyId));
            if (!r) return null;
            locked.add(r.tx.id);
            mine.add(r.tx.id);
            return { tx: r.tx, attempts: r.attempts };
          },
          async placement(id) { return placements[id] ?? { circuitId: "circ-1", siteId: "site-1" }; },
          async linesExist(sessionId) { return state.written.some((w) => w.sessionId === sessionId); },
          async writeLines(w) {
            if (hooks.failWriteFor.has(w.sessionId)) throw new Error("write failed");
            state.written.push(w);
          },
          async mark(id, s, detail) {
            const r = state.rows.find((x) => x.tx.id === id)!;
            r.state = s;
            r.detail = detail;
          },
        };
        return await fn(port);
      } catch (e) {
        state = { ...snap, rows: snap.rows.map((r) => ({ ...r, tx: state.rows.find((x) => x.tx.id === r.tx.id)!.tx })) };
        throw e;
      } finally {
        for (const id of mine) locked.delete(id);
      }
    },
    async recordFailure(id) {
      const r = state.rows.find((x) => x.tx.id === id)!;
      r.attempts += 1;
      if (r.attempts >= MAX_COSTING_ATTEMPTS) { r.state = "unresolved_context"; r.detail = { reason: "processing_error" }; }
    },
  };
  return { store, hooks, get state() { return state; }, locked };
}
