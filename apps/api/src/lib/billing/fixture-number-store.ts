// An in-memory `DocumentNumberStorePort`.
//
// Not a mock: it runs the same decision sequence the Drizzle adapter runs, in
// the same order — idempotency lookup, then statement lookup, then the
// counter — and renders through the same `renderNumber`. Only the storage is a
// Map. A mock would let the store pass while the ORDER was wrong, and the
// order is the whole correctness argument.
//
// It also models the serialisation the real adapter buys with `FOR UPDATE`:
// `allocate` takes a per-series lock, so a test can fire concurrent
// allocations and observe distinct ordinals rather than a race the fixture
// silently smooths over.

import {
  checkAllocationRequest,
  renderNumber,
  type AllocationOutcome,
  type AllocationRequest,
  type DocumentNumberStorePort,
} from "./number-store";

interface StoredNumber {
  orgId: string;
  series: string;
  year: number;
  ordinal: number;
  documentNumber: string;
  purpose: string;
  status: "issued" | "voided";
  statementId: string;
  idempotencyKey: string;
}

export interface FixtureNumberState {
  numbers: StoredNumber[];
  /** seriesKey -> next ordinal. */
  counters: Map<string, number>;
  /** Every allocation that reached the counter. A retry must not appear here. */
  counterHits: string[];
}

const seriesKey = (orgId: string, series: string, year: number) => `${orgId}:${series}:${year}`;

export function makeFixtureNumberStore(): {
  store: DocumentNumberStorePort;
  state: FixtureNumberState;
} {
  const state: FixtureNumberState = { numbers: [], counters: new Map(), counterHits: [] };

  // One promise chain per series — the fixture's stand-in for `FOR UPDATE`.
  // Concurrent allocations against one series queue; against different series
  // they do not, which is exactly the contention the real adapter has.
  const locks = new Map<string, Promise<unknown>>();
  function withSeriesLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prior = locks.get(key) ?? Promise.resolve();
    const next = prior.then(fn, fn);
    locks.set(
      key,
      next.then(
        () => undefined,
        () => undefined,
      ),
    );
    return next;
  }

  const store: DocumentNumberStorePort = {
    async allocate(req: AllocationRequest): Promise<AllocationOutcome> {
      const check = checkAllocationRequest(req);
      if (!check.ok) return { kind: "refused", reason: "idempotency_key_required" };

      const key = seriesKey(req.orgId, req.series, req.year);
      return withSeriesLock(key, async () => {
        // 1. Same key? Return the number already allocated. Must not reach the
        //    counter — asserted by `counterHits` in the tests.
        const prior = state.numbers.find(
          (n) =>
            n.orgId === req.orgId &&
            n.series === req.series &&
            n.year === req.year &&
            n.idempotencyKey === req.idempotencyKey,
        );
        if (prior) {
          return { kind: "reused", documentNumber: prior.documentNumber, ordinal: prior.ordinal };
        }

        // 2. Already numbered for this (statement, purpose)? A different key
        //    for the same logical issue. Refuse rather than spend another.
        const forStatement = state.numbers.find(
          (n) => n.statementId === req.statementId && n.purpose === req.purpose,
        );
        if (forStatement) {
          return {
            kind: "refused",
            reason: "statement_already_numbered",
            documentNumber: forStatement.documentNumber,
          };
        }

        // 3. The counter.
        state.counterHits.push(key);
        const ordinal = state.counters.get(key) ?? 1;
        state.counters.set(key, ordinal + 1);
        const documentNumber = renderNumber(req.series, req.year, ordinal, 6);
        state.numbers.push({
          orgId: req.orgId,
          series: req.series,
          year: req.year,
          ordinal,
          documentNumber,
          purpose: req.purpose,
          status: "issued",
          statementId: req.statementId,
          idempotencyKey: req.idempotencyKey,
        });
        return { kind: "allocated", documentNumber, ordinal };
      });
    },

    async voidNumber({ orgId, documentNumber, reason }) {
      void reason;
      const n = state.numbers.find(
        (x) => x.orgId === orgId && x.documentNumber === documentNumber && x.status === "issued",
      );
      if (!n) return { kind: "refused", reason: "number_not_found_or_already_voided" };
      n.status = "voided";
      return { kind: "voided" };
    },

    async findGaps(orgId, series, year) {
      // A voided ordinal is a PRESENT row, so it is not a gap. That is the
      // whole reason void is a status rather than a delete.
      const mine = state.numbers.filter(
        (n) => n.orgId === orgId && n.series === series && n.year === year,
      );
      const seen = new Set(mine.map((n) => n.ordinal));
      const highest = mine.reduce((m, n) => Math.max(m, n.ordinal), 0);
      const gaps: number[] = [];
      for (let i = 1; i < highest; i++) if (!seen.has(i)) gaps.push(i);
      return gaps;
    },
  };

  return { store, state };
}
