// Sprint 9 / ADR 0019 — allocation_json parsing.
//
// These exist because of a three-month silent failure found on 2026-08-07.
//
// ADR 0019 §Allocation writes its JSON examples in UPPERCASE ("USR"), and
// migrate-to-agreements.ts seeded every clause in the system from those
// examples. The Postgres enum agreements."BearerType" and BEARER_CODES are
// lowercase. allocation_json is JSONB, so nothing in the database constrained
// it, and the two halves of the same ADR disagreed unchecked.
//
// The effect: allocationSchema rejected EVERY clause it was ever handed, so
// the resolver could not price anything. Nobody saw it, because no session
// carried a user_id and the resolver was never reached. The bug only became
// visible once attribution was fixed and the tick finally had input.
//
// So: assert both cases parse, and assert that a genuinely unknown code is
// still rejected — normalising case must not turn into accepting anything.

import { describe, expect, it } from "vitest";
import { allocationSchema, allocationSplitSchema } from "./types";

const driverPays = (bearer: string) => ({
  passthrough: { splits: [{ bearer_type: bearer, share_pct: 100 }] },
  markup: null,
});

describe("allocation bearer codes are case-normalised", () => {
  it("accepts the lowercase form the enum and BEARER_CODES use", () => {
    const r = allocationSchema.parse(driverPays("usr"));
    expect(r.passthrough.splits[0]!.bearer_type).toBe("usr");
  });

  it("accepts the uppercase form ADR 0019 documents and the seeder wrote", () => {
    const r = allocationSchema.parse(driverPays("USR"));
    expect(r.passthrough.splits[0]!.bearer_type).toBe("usr");
  });

  it("normalises every bearer code, not just USR", () => {
    for (const [written, expected] of [
      ["ORG", "org"],
      ["Wrk", "wrk"],
      ["tRd", "trd"],
    ] as const) {
      expect(allocationSplitSchema.parse({ bearer_type: written, share_pct: 50 }).bearer_type).toBe(
        expected
      );
    }
  });

  it("normalises markup payer_type and recipient_type too", () => {
    const r = allocationSchema.parse({
      passthrough: { splits: [{ bearer_type: "USR", share_pct: 100 }] },
      markup: { basis: "percent", value: 10, payer_type: "USR", recipient_type: "ORG" },
    });
    expect(r.markup!.payer_type).toBe("usr");
    expect(r.markup!.recipient_type).toBe("org");
  });

  it("still rejects a code that is not a bearer at all", () => {
    // Case-folding must not become "accept anything" — a typo'd or invented
    // bearer has to keep failing loudly, in either case.
    expect(() => allocationSchema.parse(driverPays("DRIVER"))).toThrow();
    expect(() => allocationSchema.parse(driverPays("user"))).toThrow();
  });

  it("still rejects a non-string bearer", () => {
    expect(() => allocationSchema.parse(driverPays(1 as never))).toThrow();
  });
});
