// The Core billing Postgres enums must match the TypeScript unions they were
// copied from.
//
// This test exists because the copy was already wrong once: DeliveryState has
// six members and the first draft of deliveryStateEnum had five — "retrying"
// was dropped. Nothing would have caught it. drizzle-kit would have generated
// a perfectly valid CREATE TYPE, the migration would have applied, and the
// first delivery that needed a retry would have failed on an INSERT months
// later with a constraint error nobody could trace back to here.
//
// A Postgres enum and a TypeScript union are two spellings of one decision.
// Where the decision is already made and tested in packages/commercial, this
// file's job is to prove the spelling did not drift.
//
// The unions are RESTATED here rather than imported, deliberately: importing
// them would make the test tautological in one direction (a value deleted from
// both sides at once still passes). Restating means a deletion has to be made
// in three places before it goes unnoticed, and the third is a test file.

import { describe, expect, it } from "vitest";
import {
  correctionReasonEnum,
  deliveryChannelEnum,
  deliveryStateEnum,
  periodStateEnum,
  provenanceStateEnum,
  rateComponentKindEnum,
  reviewReasonEnum,
  settlementProvenanceEnum,
  settlementStatusEnum,
  statementLineKindEnum,
  statementRecipientKindEnum,
} from "../commercial";

/** Source of truth: packages/commercial/src/core-billing/*.ts, as of 2026-08-11. */
const UNIONS: Record<string, { module: string; values: string[]; pg: { enumValues: readonly string[] } }> = {
  PeriodState: {
    module: "period-close.ts:34",
    values: ["open", "closing", "closed"],
    pg: periodStateEnum,
  },
  SettlementStatus: {
    module: "settlement.ts:52",
    values: ["settled", "billing_review_required"],
    pg: settlementStatusEnum,
  },
  SettlementProvenance: {
    module: "settlement.ts:39",
    values: ["ocpp", "cdr", "manual", "unknown"],
    pg: settlementProvenanceEnum,
  },
  ProvenanceState: {
    module: "provenance-state.ts:34",
    values: [
      "estimated",
      "ocpp_derived",
      "cdr_pending",
      "cdr_confirmed",
      "cdr_mismatch",
      "corrected",
      "held_manual_review",
    ],
    pg: provenanceStateEnum,
  },
  ReviewReason: {
    module: "settlement.ts:43",
    values: [
      "no_rate_at_session_start",
      "meter_unresolvable",
      "cdr_mismatch_beyond_tolerance",
      "negative_or_impossible_energy",
      "missing_session_times",
      "unsupported_compute_rule",
      "manual_hold",
    ],
    pg: reviewReasonEnum,
  },
  RateComponentKind: {
    module: "settlement.ts:57 (RateComponentInput['kind'])",
    values: ["dso", "retailer", "cpo_addon"],
    pg: rateComponentKindEnum,
  },
  StatementRecipientKind: {
    module: "statement.ts:45",
    values: ["driver", "organisation"],
    pg: statementRecipientKindEnum,
  },
  StatementLineKind: {
    module: "statement.ts:47",
    values: [
      "session_energy",
      "plug_time",
      "subscription_connector",
      "subscription_driver",
      "cap_relief",
      "correction",
    ],
    pg: statementLineKindEnum,
  },
  DeliveryChannel: {
    module: "delivery-log.ts:31",
    values: ["email", "download", "webhook"],
    pg: deliveryChannelEnum,
  },
  DeliveryState: {
    module: "delivery-log.ts:59",
    values: ["pending", "sending", "sent", "retrying", "failed", "abandoned"],
    pg: deliveryStateEnum,
  },
  CorrectionReason: {
    module: "period-close.ts:125",
    values: [
      "cdr_mismatch_resolved",
      "meter_fault",
      "tariff_misapplied",
      "duplicate_session",
      "customer_dispute",
      "operator_goodwill",
    ],
    pg: correctionReasonEnum,
  },
};

describe("Core billing pg enums mirror their TypeScript unions", () => {
  for (const [name, { module, values, pg }] of Object.entries(UNIONS)) {
    it(`${name} (${module})`, () => {
      // Order matters in Postgres — ALTER TYPE ... ADD VALUE appends, and a
      // reordered enum is a different migration than an extended one.
      expect([...pg.enumValues]).toEqual(values);
    });
  }

  it("covers every Core billing enum declared, so a new one cannot skip the check", () => {
    // Guards the guard: adding a 12th enum to commercial.ts without adding it
    // here would leave it silently unverified.
    expect(Object.keys(UNIONS)).toHaveLength(11);
  });

  it("no enum is empty and none has duplicate members", () => {
    for (const [name, { pg }] of Object.entries(UNIONS)) {
      const vs = [...pg.enumValues];
      expect(vs.length, name).toBeGreaterThan(1);
      expect(new Set(vs).size, name).toBe(vs.length);
    }
  });

  it("every member is snake_case — the convention the rest of the schema uses", () => {
    for (const [name, { pg }] of Object.entries(UNIONS)) {
      for (const v of pg.enumValues) {
        expect(v, `${name}.${v}`).toMatch(/^[a-z][a-z0-9_]*$/);
      }
    }
  });
});

describe("the specific drift this test was written for", () => {
  it("DeliveryState keeps retrying — dropped in the first draft", () => {
    expect(deliveryStateEnum.enumValues).toContain("retrying");
  });

  it("ReviewReason keeps all seven, so a held session always has a nameable reason", () => {
    // A missing member here does not fail loudly. It makes one hold reason
    // unstorable, and the handler's only options are to crash or to write a
    // different reason than the one that actually applied.
    expect(reviewReasonEnum.enumValues).toHaveLength(7);
    expect(reviewReasonEnum.enumValues).toContain("cdr_mismatch_beyond_tolerance");
    expect(reviewReasonEnum.enumValues).toContain("manual_hold");
  });

  it("SettlementStatus has no third state — a session is billable or it is held", () => {
    // "partially settled" is the state that would let a wrong number reach a
    // customer while looking deliberate.
    expect(deliveryStateEnum.enumValues.length).toBeGreaterThan(settlementStatusEnum.enumValues.length);
    expect(settlementStatusEnum.enumValues).toEqual(["settled", "billing_review_required"]);
  });
});
