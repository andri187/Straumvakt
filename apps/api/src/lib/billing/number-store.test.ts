// Invoice numbering, pinned.
//
// The invariant is TWO requirements, not one — unique and gap-free — and the
// tests are arranged so that each is asserted separately. A test suite that
// only checked uniqueness would pass against a Postgres SEQUENCE, which is
// exactly the mechanism this store exists to avoid.

import { describe, expect, it } from "vitest";
import { makeFixtureNumberStore } from "./fixture-number-store";
import { checkAllocationRequest, type AllocationRequest } from "./number-store";

const ORG_A = "org-a-0000-0000-0000-00000000001";
const ORG_B = "org-b-0000-0000-0000-00000000002";
const ACTOR = "user-0000-0000-0000-000000000001";
const AT = new Date("2026-04-01T09:00:00Z");

function req(over: Partial<AllocationRequest> = {}): AllocationRequest {
  return {
    orgId: ORG_A,
    series: "SV",
    year: 2026,
    purpose: "invoice",
    statementId: "stmt-1",
    idempotencyKey: "k1",
    issuedByUserId: ACTOR,
    issuedAt: AT,
    ...over,
  };
}

describe("allocation", () => {
  it("issues SV-2026-000001 first, then 000002", async () => {
    const { store } = makeFixtureNumberStore();
    const a = await store.allocate(req());
    const b = await store.allocate(req({ statementId: "stmt-2", idempotencyKey: "k2" }));
    expect(a).toEqual({ kind: "allocated", documentNumber: "SV-2026-000001", ordinal: 1 });
    expect(b).toEqual({ kind: "allocated", documentNumber: "SV-2026-000002", ordinal: 2 });
  });

  it("a MISSING idempotency key is refused, never generated", async () => {
    // A generated key makes every retry a fresh allocation, which is an
    // idempotency mechanism that guarantees the duplicate it was added to
    // prevent.
    const { store, state } = makeFixtureNumberStore();
    expect(await store.allocate(req({ idempotencyKey: "" }))).toEqual({
      kind: "refused",
      reason: "idempotency_key_required",
    });
    expect(await store.allocate(req({ idempotencyKey: "   " }))).toMatchObject({
      reason: "idempotency_key_required",
    });
    expect(state.counterHits).toEqual([]);
    expect(checkAllocationRequest(req({ idempotencyKey: "" }))).toEqual({
      ok: false,
      reason: "idempotency_key_required",
    });
  });

  it("a retry with the SAME key returns the same number without touching the counter", async () => {
    const { store, state } = makeFixtureNumberStore();
    const first = await store.allocate(req());
    const hitsAfterFirst = state.counterHits.length;

    const retry = await store.allocate(req());
    expect(retry).toEqual({ kind: "reused", documentNumber: "SV-2026-000001", ordinal: 1 });
    // The proof that matters: the counter was not reached a second time.
    expect(state.counterHits.length).toBe(hitsAfterFirst);
    expect(first).toMatchObject({ documentNumber: "SV-2026-000001" });
  });

  it("a retry with a DIFFERENT key on the same logical issue is REFUSED", async () => {
    // Two keys for one invoice is one invoice and one caller bug. Spending a
    // second ordinal would hide it and put a hole in nothing — but it would
    // put TWO numbers on one statement, which is the duplicate side of the
    // invariant.
    const { store, state } = makeFixtureNumberStore();
    await store.allocate(req());
    const second = await store.allocate(req({ idempotencyKey: "different" }));
    expect(second).toEqual({
      kind: "refused",
      reason: "statement_already_numbered",
      documentNumber: "SV-2026-000001",
    });
    expect(state.numbers).toHaveLength(1);
  });

  it("a credit note for the same statement takes its own number", async () => {
    // `purpose` is what makes the (statement, purpose) key work: a credit note
    // is a different document for the same statement and needs its own number
    // from a stated series.
    const { store } = makeFixtureNumberStore();
    await store.allocate(req());
    const credit = await store.allocate(
      req({ purpose: "credit_note", idempotencyKey: "k-credit" }),
    );
    expect(credit).toEqual({ kind: "allocated", documentNumber: "SV-2026-000002", ordinal: 2 });
  });
});

describe("concurrency", () => {
  it("concurrent allocations against one series get DISTINCT ordinals", async () => {
    // The fixture models `FOR UPDATE` with a per-series lock, so this exercises
    // the serialisation the real adapter buys rather than smoothing it over.
    const { store } = makeFixtureNumberStore();
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        store.allocate(req({ statementId: `stmt-${i}`, idempotencyKey: `key-${i}` })),
      ),
    );
    const numbers = results.map((r) => ("documentNumber" in r ? r.documentNumber : "REFUSED"));
    expect(new Set(numbers).size).toBe(10);
    const ordinals = results.map((r) => ("ordinal" in r ? r.ordinal : -1)).sort((a, b) => a - b);
    expect(ordinals).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("ten concurrent retries of ONE key yield one number and one counter hit", async () => {
    const { store, state } = makeFixtureNumberStore();
    const results = await Promise.all(
      Array.from({ length: 10 }, () => store.allocate(req())),
    );
    const numbers = new Set(
      results.map((r) => ("documentNumber" in r ? r.documentNumber : "REFUSED")),
    );
    expect(numbers).toEqual(new Set(["SV-2026-000001"]));
    expect(state.counterHits).toHaveLength(1);
    expect(state.numbers).toHaveLength(1);
  });

  it("two orgs issuing in the same instant get distinct numbers from distinct series", async () => {
    // Per-org series: both legitimately hold ordinal 1, and the numbers differ
    // because the series row differs. Nothing contends.
    const { store, state } = makeFixtureNumberStore();
    const [a, b] = await Promise.all([
      store.allocate(req({ orgId: ORG_A, statementId: "a", idempotencyKey: "ka" })),
      store.allocate(req({ orgId: ORG_B, statementId: "b", idempotencyKey: "kb" })),
    ]);
    expect(a).toMatchObject({ ordinal: 1, documentNumber: "SV-2026-000001" });
    expect(b).toMatchObject({ ordinal: 1, documentNumber: "SV-2026-000001" });
    // Same rendered string, different series — which is why the store's key is
    // (org, series, year) and the uniqueness is scoped the same way.
    expect(state.counters.get(`${ORG_A}:SV:2026`)).toBe(2);
    expect(state.counters.get(`${ORG_B}:SV:2026`)).toBe(2);
    expect(state.numbers.filter((n) => n.orgId === ORG_A)).toHaveLength(1);
    expect(state.numbers.filter((n) => n.orgId === ORG_B)).toHaveLength(1);
  });
});

describe("year rollover", () => {
  it("restarts at 1 in the new year without colliding", async () => {
    const { store } = makeFixtureNumberStore();
    await store.allocate(req({ statementId: "s1", idempotencyKey: "k1" }));
    await store.allocate(req({ statementId: "s2", idempotencyKey: "k2" }));
    const next = await store.allocate(
      req({ year: 2027, statementId: "s3", idempotencyKey: "k3" }),
    );
    expect(next).toEqual({ kind: "allocated", documentNumber: "SV-2027-000001", ordinal: 1 });
  });

  it("each year's series is independently gap-free", async () => {
    const { store } = makeFixtureNumberStore();
    for (const [y, n] of [
      [2026, 3],
      [2027, 2],
    ] as const) {
      for (let i = 0; i < n; i++) {
        await store.allocate(req({ year: y, statementId: `${y}-${i}`, idempotencyKey: `${y}-${i}` }));
      }
    }
    expect(await store.findGaps(ORG_A, "SV", 2026)).toEqual([]);
    expect(await store.findGaps(ORG_A, "SV", 2027)).toEqual([]);
  });
});

describe("gap-free, which is the half a SEQUENCE would fail", () => {
  it("a failed transaction consumes NOTHING, so no gap appears", async () => {
    // The verdict, stated: the counter increment, the document_numbers row and
    // the statement are one transaction. A crash between allocation and commit
    // rolls back all three and the next attempt takes the same ordinal.
    //
    // The fixture models this the only honest way available without a
    // database: a refused allocation never reaches the counter, so the next
    // successful one takes the ordinal the failed one would have had.
    const { store, state } = makeFixtureNumberStore();
    await store.allocate(req({ statementId: "s1", idempotencyKey: "k1" }));
    const failed = await store.allocate(req({ statementId: "s2", idempotencyKey: "" }));
    expect(failed).toMatchObject({ reason: "idempotency_key_required" });

    const after = await store.allocate(req({ statementId: "s2", idempotencyKey: "k2" }));
    expect(after).toEqual({ kind: "allocated", documentNumber: "SV-2026-000002", ordinal: 2 });
    expect(await store.findGaps(ORG_A, "SV", 2026)).toEqual([]);
    expect(state.counterHits).toHaveLength(2);
  });

  it("a VOID is not a gap — the ordinal is still accounted for", async () => {
    // There is deliberately no release operation. A released number leaves a
    // hole the documents around it have already closed over.
    const { store } = makeFixtureNumberStore();
    await store.allocate(req({ statementId: "s1", idempotencyKey: "k1" }));
    await store.allocate(req({ statementId: "s2", idempotencyKey: "k2" }));
    await store.allocate(req({ statementId: "s3", idempotencyKey: "k3" }));

    expect(await store.voidNumber({
      orgId: ORG_A,
      documentNumber: "SV-2026-000002",
      reason: "issued against the wrong host",
      at: AT,
    })).toEqual({ kind: "voided" });

    expect(await store.findGaps(ORG_A, "SV", 2026)).toEqual([]);
  });

  it("voiding twice is refused rather than silently succeeding", async () => {
    const { store } = makeFixtureNumberStore();
    await store.allocate(req());
    await store.voidNumber({ orgId: ORG_A, documentNumber: "SV-2026-000001", reason: "r", at: AT });
    expect(
      await store.voidNumber({ orgId: ORG_A, documentNumber: "SV-2026-000001", reason: "r", at: AT }),
    ).toMatchObject({ reason: "number_not_found_or_already_voided" });
  });

  it("voiding another org's number is refused", async () => {
    const { store } = makeFixtureNumberStore();
    await store.allocate(req());
    expect(
      await store.voidNumber({ orgId: ORG_B, documentNumber: "SV-2026-000001", reason: "r", at: AT }),
    ).toMatchObject({ reason: "number_not_found_or_already_voided" });
  });

  it("finds a gap if one is ever manufactured, so the guard is not vacuous", async () => {
    // A test that only ever asserts "no gaps" passes against a findGaps that
    // returns [] unconditionally. This proves it can see one.
    const { store, state } = makeFixtureNumberStore();
    await store.allocate(req({ statementId: "s1", idempotencyKey: "k1" }));
    await store.allocate(req({ statementId: "s2", idempotencyKey: "k2" }));
    await store.allocate(req({ statementId: "s3", idempotencyKey: "k3" }));
    // Reach past the store and delete ordinal 2 — something no code path can
    // do, which is the point.
    state.numbers = state.numbers.filter((n) => n.ordinal !== 2);
    expect(await store.findGaps(ORG_A, "SV", 2026)).toEqual([2]);
  });
});
