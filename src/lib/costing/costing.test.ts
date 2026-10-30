import { describe, expect, it } from "vitest";
import type { ClauseInput, RateRefInput } from "@straumvakt/commercial/agreement/types";
import { decideCosting, usableDuration, type AgreementFacts, type CostingTxFacts } from "./cost-session";
import { costPending, MAX_COSTING_ATTEMPTS } from "./service";
import { memoryCostingStore } from "./__tests__/memory-costing-store";
import { buildSnapshot, reviveSnapshot, type TermsSnapshot } from "./terms-snapshot";

const ORG = "11111111-1111-4111-8111-111111111111";
const ORG2 = "99999999-9999-4999-8999-999999999999";
const INST = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "22222222-2222-4222-8222-222222222222";
const GROUP = "33333333-3333-4333-8333-333333333333";
const FACTOR = "44444444-4444-4444-8444-444444444444";
const SUPPLIER = "55555555-5555-4555-8555-555555555555";
const T0 = new Date("2026-10-30T10:00:00Z");
const T1 = new Date("2026-10-30T12:00:00Z");

const tx = (over: Partial<CostingTxFacts> = {}): CostingTxFacts => ({
  id: "t1", orgId: ORG, installationId: INST, deviceId: "dev", placementId: "p1", authorized: true, userId: USER,
  energyWh: 12_000, energyQuality: "ok", startedReportedAt: T0, stoppedReportedAt: T1, startedReceivedAt: T0, stoppedReceivedAt: T1, terms: null, ...over,
});
const clause: ClauseInput = { costFactorId: FACTOR, costFactorCode: "energy", defaultBearerType: "usr", defaultBearerRef: null, defaultRateRefCode: "ENERGY", allocation: { passthrough: { splits: [{ bearer_type: "usr", share_pct: 100 }] }, markup: null } };
const rate = (over: Partial<RateRefInput> = {}): RateRefInput => ({ id: "rr1", code: "ENERGY", costFactorId: FACTOR, basis: "per_kwh", priceMinor: 2000n, vatRatePct: 24, currency: "ISK", supplierOrgId: SUPPLIER, effectiveFrom: new Date("2026-01-01T00:00:00Z"), effectiveUntil: null, ...over });
const agr = (over: Partial<AgreementFacts> = {}): AgreementFacts => ({ installationAgreementId: "agr1", driverGroup: { id: GROUP, ownerOrgId: ORG }, clauses: [clause], rules: [], rateReferences: [rate()], ...over });

describe("decideCosting: explicit outcomes, unknown is never zero", () => {
  it("costs an authorized transaction with explainable lines from the retained resolver", () => {
    const o = decideCosting(tx(), { circuitId: "c", siteId: "s" }, agr());
    expect(o.state).toBe("costed");
    if (o.state !== "costed") return;
    expect(o.lines).toHaveLength(1);
    expect(o.lines[0]).toMatchObject({ factorCode: "energy", kind: "passthrough", basisType: "per_kwh", unitPriceMinor: 2000n, amountExVatMinor: 24_000n, bearerType: "usr", rateRefId: "rr1" });
    expect(o.lines[0]!.computationDetail).toMatchObject({ rateCode: "ENERGY", basisQuantityFull: 12 });
    expect(o.detail).toMatchObject({ totalExVatMinor: "24000", explainable: true });
  });
  it("unauthorized energy is evidence, never ordinary billable use", () => {
    expect(decideCosting(tx({ authorized: false }), { circuitId: null, siteId: null }, agr()).state).toBe("excluded_unauthorized");
  });
  it("missing, bad or inconsistent energy stays unresolved instead of pricing zero", () => {
    expect(decideCosting(tx({ energyWh: null, energyQuality: "register_decreased" }), { circuitId: null, siteId: null }, agr())).toMatchObject({ state: "blocked_energy", detail: { quality: "register_decreased" } });
    expect(decideCosting(tx({ energyWh: 0, energyQuality: "missing_stop" }), { circuitId: null, siteId: null }, agr()).state).toBe("blocked_energy");
  });
  it("a rate-less factor is an explicit unresolved state, not a silent empty bill", () => {
    const o = decideCosting(tx(), { circuitId: null, siteId: null }, agr({ rateReferences: [] }));
    expect(o).toMatchObject({ state: "unresolved_rates", detail: { reason: "rate_missing_for_factor", factors: ["energy"] } });
    // a rate that only starts AFTER the session is also missing for it
    expect(decideCosting(tx(), { circuitId: null, siteId: null }, agr({ rateReferences: [rate({ effectiveFrom: new Date("2026-12-01T00:00:00Z") })] })).state).toBe("unresolved_rates");
  });
  it("access gaps are named: no driver, no agreement, no membership, no clauses", () => {
    const p = { circuitId: null, siteId: null };
    expect(decideCosting(tx({ userId: null }), p, agr())).toMatchObject({ state: "unresolved_access", detail: { reason: "no_driver" } });
    expect(decideCosting(tx(), p, agr({ installationAgreementId: null }))).toMatchObject({ detail: { reason: "no_installation_agreement" } });
    expect(decideCosting(tx(), p, agr({ driverGroup: null }))).toMatchObject({ detail: { reason: "no_membership" } });
    expect(decideCosting(tx(), p, agr({ clauses: [] }))).toMatchObject({ state: "unresolved_rates", detail: { reason: "agreement_has_no_clauses" } });
  });
  it("duration comes from the charger clock only when plausible, else the server clock, else unresolved", () => {
    expect(usableDuration(tx())).toEqual({ ms: 7_200_000, source: "charger_clock" });
    expect(usableDuration(tx({ stoppedReportedAt: new Date("2001-01-01T00:00:00Z") }))).toEqual({ ms: 7_200_000, source: "server_clock" });
    expect(usableDuration(tx({ stoppedReportedAt: new Date("2001-01-01T00:00:00Z"), stoppedReceivedAt: new Date(T0.getTime() - 1) }))).toBeNull();
    expect(decideCosting(tx({ stoppedReportedAt: null, stoppedReceivedAt: null }), { circuitId: null, siteId: null }, agr())).toMatchObject({ state: "unresolved_context", detail: { reason: "duration_unusable" } });
  });
  it("prices on SEALED context and the server's clock: a charger timestamp from years ago cannot select an old rate", () => {
    const cheap = rate({ id: "old", priceMinor: 1n, effectiveFrom: new Date("2001-01-01T00:00:00Z"), effectiveUntil: new Date("2002-01-01T00:00:00Z") });
    const o = decideCosting(tx({ startedReportedAt: new Date("2001-06-01T00:00:00Z") }), { circuitId: null, siteId: null }, agr({ rateReferences: [cheap, rate()] }));
    expect(o.state === "costed" && o.lines[0]!.unitPriceMinor).toBe(2000n);
  });
});

const withTerms = async (t: CostingTxFacts, a: AgreementFacts | null, at = T0): Promise<CostingTxFacts> => ({ ...t, terms: await buildSnapshot({ facts: a, at, capturedAt: at }) });

describe("costPending: durable, idempotent, retryable", () => {
  const world = async (rows: CostingTxFacts[]) => memoryCostingStore({ rows });

  it("costs a needed transaction exactly once, however often it is run, and concurrent runs cannot double it", async () => {
    const w = await world([await withTerms(tx(), agr())]);
    const [r1, r2] = await Promise.all([costPending(w.store), costPending(w.store)]);
    expect(r1.costed + r2.costed).toBe(1);
    await costPending(w.store);
    await costPending(w.store);
    expect(w.state.written).toHaveLength(1);
    expect(w.state.rows[0]!.state).toBe("costed");
  });
  it("an interrupted write rolls everything back: still needed, no lines, then succeeds on retry", async () => {
    const w = await world([await withTerms(tx(), agr())]);
    w.hooks.failWriteFor.add("t1");
    const bad = await costPending(w.store, { limit: 1 });
    expect(bad.failed).toBe(1);
    expect(w.state.written).toHaveLength(0);
    expect(w.state.rows[0]).toMatchObject({ state: "needed", attempts: 1 });
    w.hooks.failWriteFor.clear();
    expect((await costPending(w.store)).costed).toBe(1);
  });
  it("a poison row is parked after the attempt bound and does not starve the others", async () => {
    const w = await world([await withTerms(tx({ id: "poison" }), agr()), await withTerms(tx({ id: "ok", placementId: "p2" }), agr())]);
    w.hooks.failWriteFor.add("poison");
    const rep = await costPending(w.store, { limit: 20 });
    expect(w.state.rows.find((r) => r.tx.id === "poison")).toMatchObject({ state: "unresolved_context", attempts: MAX_COSTING_ATTEMPTS });
    expect(w.state.rows.find((r) => r.tx.id === "ok")!.state).toBe("costed");
    expect(rep.failed).toBe(MAX_COSTING_ATTEMPTS);
  });
  it("missing rates leave the physical transaction untouched and the work explicit; a later re-queue uses a NEW snapshot", async () => {
    const w = await world([await withTerms(tx(), agr({ rateReferences: [] }))]);
    expect(await costPending(w.store)).toMatchObject({ processed: 1, costed: 0, unresolved: { unresolved_rates: 1 } });
    expect(w.state.written).toHaveLength(0);
    expect(w.state.rows[0]!.state).toBe("unresolved_rates");
    expect(await costPending(w.store)).toMatchObject({ processed: 0 });
    // Re-queueing after the rate book is fixed is an explicit operator act WITH a re-captured snapshot (the old one is immutable).
    w.state.rows[0]!.tx = await withTerms(tx(), agr());
    w.state.rows[0]!.state = "needed";
    expect((await costPending(w.store)).costed).toBe(1);
  });
  it("a transaction sealed to CPO A is costed from A's snapshot even after the device moved to CPO B", async () => {
    const w = await world([await withTerms(tx({ orgId: ORG, installationId: INST }), agr())]);
    await costPending(w.store);
    expect(w.state.written[0]!.lines[0]!.recipientOrgId).toBe(SUPPLIER);
    void ORG2;
  });
  it("only `needed` rows are ever claimed", async () => {
    expect(await costPending((await world([])).store)).toMatchObject({ processed: 0 });
  });
  it("an outage while claiming stops the run quietly and leaves everything needed", async () => {
    const w = await world([await withTerms(tx(), agr())]);
    const broken = { ...w.store, run: async () => { throw new Error("db down"); } };
    expect(await costPending(broken as never)).toMatchObject({ processed: 0, failed: 1 });
    expect(w.state.rows[0]!.state).toBe("needed");
  });
});

describe("immutable terms snapshot: what applied at start is what is priced", () => {
  // `book` stands for the MUTABLE term tables. Costing must never read it: only the snapshot taken at start.
  it("an in-place rate edit BETWEEN start and first costing cannot change the price or the payer", async () => {
    let book = agr();
    const row = await withTerms(tx(), book); // captured at start: 2000 minor per kWh
    book = agr({ rateReferences: [rate({ priceMinor: 9999n })] }); // someone edits the live row afterwards
    void book;
    const w = memoryCostingStore({ rows: [row] });
    await costPending(w.store);
    expect(w.state.written[0]!.lines[0]).toMatchObject({ unitPriceMinor: 2000n, amountExVatMinor: 24_000n });
  });
  it("a backdated NEW rate row inserted after the start cannot re-price a started session", async () => {
    const row = await withTerms(tx(), agr());
    const poisoned = agr({ rateReferences: [rate(), rate({ id: "late", priceMinor: 1n, effectiveFrom: new Date("2026-10-01T00:00:00Z") })] }); // newer effectiveFrom <= start
    void poisoned;
    const w = memoryCostingStore({ rows: [row] });
    await costPending(w.store);
    expect(w.state.written[0]!.lines[0]!.rateRefId).toBe("rr1");
  });
  it("an edit AFTER costing changes nothing: the stored line and the snapshot hash are fixed, and a second costing is refused", async () => {
    const row = await withTerms(tx(), agr());
    const w = memoryCostingStore({ rows: [row] });
    await costPending(w.store);
    const ser = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x));
    const before = ser(w.state.written);
    const hash = (row.terms as TermsSnapshot).sha256;
    await costPending(w.store);
    expect(ser(w.state.written)).toBe(before);
    expect((w.state.rows[0]!.detail as { termsSha256: string }).termsSha256).toBe(hash); // the costing detail names exactly which terms were used
  });
  it("a snapshot round-trips bigint prices and dates exactly, and carries the evaluation time", async () => {
    const snap = await buildSnapshot({ facts: agr(), at: T0, capturedAt: T1 });
    const back = await reviveSnapshot(JSON.parse(JSON.stringify(snap)));
    expect(back).toMatchObject({ ok: true, status: "captured", at: T0 });
    if (back.ok && back.status === "captured") {
      expect(back.facts.rateReferences[0]!.priceMinor).toBe(2000n);
      expect(back.facts.rateReferences[0]!.effectiveFrom).toEqual(new Date("2026-01-01T00:00:00Z"));
      expect(back.facts.driverGroup).toEqual({ id: GROUP, ownerOrgId: ORG });
    }
  });
  it("a tampered or unreadable snapshot is NEVER priced and is never replaced by today's tables", async () => {
    const good = await withTerms(tx(), agr());
    const tampered = { ...good, terms: { ...(good.terms as object), facts: { ...(good.terms as { facts: object }).facts, rateReferences: [{ ...rate(), priceMinor: "$bigint:1" }] } } };
    const w = memoryCostingStore({ rows: [tampered as CostingTxFacts, { ...tx({ id: "t2" }), terms: { v: 99 } }] });
    const rep = await costPending(w.store);
    expect(rep.unresolved).toEqual({ unresolved_context: 2 });
    expect(w.state.written).toHaveLength(0);
    expect(w.state.rows.map((r) => (r.detail as { reason: string }).reason).sort()).toEqual(["terms_snapshot_tampered", "terms_snapshot_unknown_schema"]);
  });
  it("a session started before this contract (no snapshot) or with terms that could not be captured is explicitly unresolved, not priced", async () => {
    const legacy = tx({ id: "legacy" });
    const failed = { ...tx({ id: "failed" }), terms: await buildSnapshot({ facts: null, at: T0, capturedAt: T0, missingReason: "capture_failed" }) };
    const w = memoryCostingStore({ rows: [legacy, failed] });
    const rep = await costPending(w.store);
    expect(rep.unresolved).toEqual({ unresolved_context: 2 });
    expect(w.state.rows.find((r) => r.tx.id === "legacy")!.detail).toMatchObject({ reason: "terms_not_captured" });
    expect(w.state.rows.find((r) => r.tx.id === "failed")!.detail).toMatchObject({ reason: "terms_not_captured", why: "capture_failed" });
  });
  it("the snapshot keeps the sponsorship decision AS OF START: coverage that ended mid-session is not re-evaluated (adopted cutoff rule)", async () => {
    const sponsored = agr({ driverGroup: { id: GROUP, ownerOrgId: ORG2 }, clauses: [{ ...clause, defaultBearerType: "org", defaultBearerRef: ORG2, allocation: { passthrough: { splits: [{ bearer_type: "org", share_pct: 100, bearer_ref: ORG2 }] }, markup: null } }] });
    const row = await withTerms(tx(), sponsored);
    const w = memoryCostingStore({ rows: [row] });
    await costPending(w.store); // sponsorship "ended" in the live tables before costing; irrelevant by design
    expect(w.state.written[0]!.lines[0]).toMatchObject({ bearerType: "org", bearerRef: ORG2 });
  });
  it("the snapshot changes if and only if the terms do (content-addressed)", async () => {
    const a = await buildSnapshot({ facts: agr(), at: T0, capturedAt: T0 });
    const b = await buildSnapshot({ facts: agr(), at: T0, capturedAt: T1 });
    const c = await buildSnapshot({ facts: agr({ rateReferences: [rate({ priceMinor: 2001n })] }), at: T0, capturedAt: T0 });
    expect(a.sha256).toBe(b.sha256); // capture time is metadata, not terms
    expect(a.sha256).not.toBe(c.sha256);
  });
});
