// Double-billing, pinned.
//
// The scenarios below are named for the operational events that produce them,
// not for the code paths they touch, because the bug this guards against was
// introduced by someone who had correctly reasoned about a sequential re-run
// and had not considered a concurrent one.

import { describe, expect, it } from "vitest";
import {
  agreementBillingLineKey,
  assignStableLineNumbers,
  classifyWriteError,
  mutationReceiptKey,
  planGeneration,
  requireIdempotencyKey,
  sessionSettlementKey,
  settlementComponentKey,
  settlementHoldKey,
  statementLineKey,
  statementNaturalKey,
  type NaturalKey,
} from "./generation-idempotency";

const ORG = "org-0000-0000-0000-000000000001";
const SESSION_A = "sess-a-0000-0000-0000-00000001";
const SESSION_B = "sess-b-0000-0000-0000-00000002";
const SESSION_C = "sess-c-0000-0000-0000-00000003";

interface Row {
  sessionId: string;
  kind: string;
}
const keyOf = (r: Row): NaturalKey => settlementComponentKey(r.sessionId, r.kind);

describe("requireIdempotencyKey", () => {
  it("accepts a fully specified run", () => {
    expect(
      requireIdempotencyKey({ orgId: ORG, scope: "settlement", idempotencyKey: "tick-1" }),
    ).toEqual({ orgId: ORG, scope: "settlement", idempotencyKey: "tick-1" });
  });

  it("refuses to proceed without a key rather than generating one", () => {
    // The whole point. `?? crypto.randomUUID()` would make every retry a fresh
    // generation — an idempotency mechanism that guarantees double-billing.
    expect(() =>
      requireIdempotencyKey({ orgId: ORG, scope: "settlement", idempotencyKey: undefined }),
    ).toThrow("generation_run_requires_idempotency_key");
    expect(() =>
      requireIdempotencyKey({ orgId: ORG, scope: "settlement", idempotencyKey: null }),
    ).toThrow("generation_run_requires_idempotency_key");
  });

  it("refuses a blank or whitespace-only key", () => {
    // "" and "   " are what a form field and a shell variable produce when
    // nobody filled them in. Both must fail like a missing key, not pass like
    // a present one.
    expect(() =>
      requireIdempotencyKey({ orgId: ORG, scope: "settlement", idempotencyKey: "" }),
    ).toThrow("generation_run_requires_idempotency_key");
    expect(() =>
      requireIdempotencyKey({ orgId: ORG, scope: "settlement", idempotencyKey: "   " }),
    ).toThrow("generation_run_requires_idempotency_key");
  });

  it("refuses a run with no tenant and no scope", () => {
    expect(() =>
      requireIdempotencyKey({ orgId: "", scope: "settlement", idempotencyKey: "tick-1" }),
    ).toThrow("generation_run_requires_org_id");
    expect(() =>
      requireIdempotencyKey({ orgId: ORG, scope: "  ", idempotencyKey: "tick-1" }),
    ).toThrow("generation_run_requires_scope");
  });

  it("trims, so 'tick-1' and ' tick-1 ' are the same run", () => {
    const a = requireIdempotencyKey({ orgId: ORG, scope: "settlement", idempotencyKey: "tick-1" });
    const b = requireIdempotencyKey({
      orgId: ` ${ORG} `,
      scope: " settlement ",
      idempotencyKey: " tick-1 ",
    });
    expect(mutationReceiptKey(a)).toBe(mutationReceiptKey(b));
  });
});

describe("natural keys mirror the database constraints", () => {
  it("distinguishes components of the same session by kind", () => {
    expect(settlementComponentKey(SESSION_A, "energy")).not.toBe(
      settlementComponentKey(SESSION_A, "plug_time"),
    );
  });

  it("cannot be spoofed by shifting a boundary between components", () => {
    // With "-" or ":" as the separator, ("a-b", "c") and ("a", "b-c") collapse
    // to one key and two different rows silently become the same row.
    expect(statementNaturalKey("p1", "driver", "r1")).not.toBe(
      statementNaturalKey("p1", "driver-r1", ""),
    );
    expect(agreementBillingLineKey("s1", "f-1", "energy")).not.toBe(
      agreementBillingLineKey("s1", "f", "1-energy"),
    );
  });

  it("refuses a line number that is not a positive integer", () => {
    // 0 and 1.5 both mean the caller derived it from a count or an index and
    // got it wrong.
    expect(() => statementLineKey("st-1", 0)).toThrow(
      "statement_line_no_must_be_a_positive_integer",
    );
    expect(() => statementLineKey("st-1", -1)).toThrow(
      "statement_line_no_must_be_a_positive_integer",
    );
    expect(() => statementLineKey("st-1", 1.5)).toThrow(
      "statement_line_no_must_be_a_positive_integer",
    );
    expect(statementLineKey("st-1", 1)).toBeTypeOf("string");
  });

  it("keeps session settlement and hold keys distinct per reason", () => {
    expect(sessionSettlementKey(SESSION_A)).not.toBe(sessionSettlementKey(SESSION_B));
    expect(settlementHoldKey(SESSION_A, "meter_unresolvable")).not.toBe(
      settlementHoldKey(SESSION_A, "rate_missing"),
    );
  });
});

describe("planGeneration — the five ways a run repeats", () => {
  it("two overlapping generation runs: the second writes nothing", () => {
    // Tick 1 wrote everything. Tick 2 starts before tick 1's report is read.
    const candidates: Row[] = [
      { sessionId: SESSION_A, kind: "energy" },
      { sessionId: SESSION_B, kind: "energy" },
    ];
    const afterFirstRun = candidates.map(keyOf);

    const second = planGeneration(candidates, keyOf, afterFirstRun);

    expect(second.toWrite).toEqual([]);
    expect(second.alreadyPresent).toHaveLength(2);
    expect(second.conflicting).toEqual([]);
  });

  it("a retried commit re-plans to exactly the same set", () => {
    const candidates: Row[] = [{ sessionId: SESSION_A, kind: "energy" }];
    const first = planGeneration(candidates, keyOf, []);
    const retryBeforeCommitLanded = planGeneration(candidates, keyOf, []);
    const retryAfterCommitLanded = planGeneration(candidates, keyOf, first.toWrite.map(keyOf));

    expect(retryBeforeCommitLanded.toWrite).toEqual(first.toWrite);
    expect(retryAfterCommitLanded.toWrite).toEqual([]);
    expect(retryAfterCommitLanded.alreadyPresent).toEqual(candidates);
  });

  it("a partial failure mid-batch resumes the REMAINDER, not nothing", () => {
    // This is the case a count-based check gets catastrophically wrong. Two of
    // three rows landed before the process died. `count > 0` reads "some
    // exist" and skips the whole session forever — silent under-billing, no
    // error anywhere.
    const candidates: Row[] = [
      { sessionId: SESSION_A, kind: "energy" },
      { sessionId: SESSION_A, kind: "plug_time" },
      { sessionId: SESSION_A, kind: "subscription_connector" },
    ];
    const landedBeforeCrash = [
      settlementComponentKey(SESSION_A, "energy"),
      settlementComponentKey(SESSION_A, "plug_time"),
    ];

    const resume = planGeneration(candidates, keyOf, landedBeforeCrash);

    expect(resume.toWrite).toEqual([{ sessionId: SESSION_A, kind: "subscription_connector" }]);
    expect(resume.alreadyPresent).toHaveLength(2);

    const countBasedAnswer = landedBeforeCrash.length > 0 ? [] : candidates;
    expect(countBasedAnswer).toEqual([]);
    expect(resume.toWrite).not.toEqual(countBasedAnswer);
  });

  it("a re-run after a crash with nothing committed writes everything once", () => {
    const candidates: Row[] = [
      { sessionId: SESSION_A, kind: "energy" },
      { sessionId: SESSION_B, kind: "energy" },
      { sessionId: SESSION_C, kind: "energy" },
    ];
    const plan = planGeneration(candidates, keyOf, []);
    expect(plan.toWrite).toHaveLength(3);
    expect(plan.alreadyPresent).toEqual([]);

    const afterwards = planGeneration(candidates, keyOf, plan.toWrite.map(keyOf));
    expect(afterwards.toWrite).toEqual([]);
  });

  it("out-of-order arrival produces the same write set as in-order", () => {
    const inOrder: Row[] = [
      { sessionId: SESSION_A, kind: "energy" },
      { sessionId: SESSION_B, kind: "energy" },
      { sessionId: SESSION_C, kind: "energy" },
    ];
    const shuffled: Row[] = [inOrder[2]!, inOrder[0]!, inOrder[1]!];
    const existing = [settlementComponentKey(SESSION_B, "energy")];

    const a = planGeneration(inOrder, keyOf, existing);
    const b = planGeneration(shuffled, keyOf, existing);

    expect(new Set(a.toWrite.map(keyOf))).toEqual(new Set(b.toWrite.map(keyOf)));
    expect(a.toWrite).toHaveLength(2);
  });

  it("separates an in-batch duplicate instead of silently keeping the first", () => {
    // Two candidate rows claiming one natural key means the generator produced
    // contradictory input. Deduplicating it away hides a generator bug behind
    // a correct-looking write.
    const candidates: Row[] = [
      { sessionId: SESSION_A, kind: "energy" },
      { sessionId: SESSION_A, kind: "energy" },
    ];
    const plan = planGeneration(candidates, keyOf, []);
    expect(plan.toWrite).toHaveLength(1);
    expect(plan.conflicting).toHaveLength(1);
  });
});

describe("assignStableLineNumbers", () => {
  it("numbers from content, so a reordered regenerate produces the same lines", () => {
    const lines = [{ id: "c" }, { id: "a" }, { id: "b" }];
    const reordered = [{ id: "b" }, { id: "c" }, { id: "a" }];
    const d = (l: { id: string }) => l.id;

    expect(assignStableLineNumbers(lines, d)).toEqual(assignStableLineNumbers(reordered, d));
    expect(assignStableLineNumbers(lines, d).map((x) => `${x.line.id}${x.lineNo}`)).toEqual([
      "a1",
      "b2",
      "c3",
    ]);
  });

  it("starts at 1, because (statement_id, line_no) is a document's numbering", () => {
    expect(assignStableLineNumbers([{ id: "only" }], (l) => l.id)[0]!.lineNo).toBe(1);
  });

  it("breaks discriminator ties by input order rather than arbitrarily", () => {
    const lines = [
      { id: "same", tag: "first" },
      { id: "same", tag: "second" },
    ];
    const out = assignStableLineNumbers(lines, (l) => l.id);
    expect(out.map((x) => x.line.tag)).toEqual(["first", "second"]);
  });
});

describe("classifyWriteError", () => {
  it("reads a unique violation as a duplicate, not as a failure", () => {
    // Once the constraint exists, the loser of a race MUST error. If that
    // error surfaces as a failed billing run, a correctly-prevented double
    // write looks exactly like a broken one and the operator learns to ignore
    // both.
    expect(classifyWriteError({ code: "23505" })).toBe("duplicate");
    expect(classifyWriteError({ code: "P2002" })).toBe("duplicate");
  });

  it("unwraps a wrapped driver error", () => {
    expect(classifyWriteError(Object.assign(new Error("wrapped"), { cause: { code: "23505" } }))).toBe(
      "duplicate",
    );
  });

  it("does not swallow an unrelated failure", () => {
    // A connection reset must never be reported as "already billed".
    expect(classifyWriteError({ code: "08006" })).toBe("failed");
    expect(classifyWriteError(new Error("boom"))).toBe("failed");
    expect(classifyWriteError(null)).toBe("failed");
  });
});
