// What shape does a constraint violation actually have under Drizzle?
//
// errors.ts asserts "the driver does not wrap it, so this is the raw pg
// error". The org-email-domains 409 path stopped working after its port, so
// that assumption needs checking rather than trusting — every SQLSTATE-based
// branch in the codebase depends on it, including the id-token delete path
// that turns 23503 into a 409.
//
// Rolls back.

import { afterAll, describe, expect, it } from "vitest";
import { closeAll, getDrizzle, hasDb } from "./_harness";
import { orgEmailDomains } from "@straumvakt/shared/db/identity";
import { driverGroups } from "@straumvakt/shared/db/commercial";
import { isUniqueViolation } from "../../src/domains/identity/repositories/errors";

const ROLLBACK = Symbol("rollback");

describe.skipIf(!hasDb)("driver error shape", () => {
  afterAll(closeAll);

  it("a UNIQUE violation is detectable by isUniqueViolation", async () => {
    let captured: unknown;
    try {
      await getDrizzle().transaction(async (tx) => {
        const [g] = await tx
          .select({ ownerOrgId: driverGroups.ownerOrgId })
          .from(driverGroups)
          .limit(1);
        const domain = `probe-${Math.floor(performance.now() * 1e6)}.is`;
        const row = { orgId: g!.ownerOrgId, domain, policy: "disabled" as const };
        await tx.insert(orgEmailDomains).values(row);
        try {
          await tx.insert(orgEmailDomains).values(row);
        } catch (err) {
          captured = err;
        }
        throw ROLLBACK;
      });
    } catch (err) {
      if (err !== ROLLBACK) throw err;
    }

    expect(captured, "no error was raised by the duplicate insert").toBeDefined();

    // Report the shape so a future change to Drizzle's error handling shows
    // up here as a readable diff rather than a mystery 500.
    const e = captured as { name?: string; code?: unknown; cause?: { code?: unknown } };
    console.log("[probe] error shape:", {
      name: e.name,
      topLevelCode: e.code,
      causeCode: e.cause?.code,
    });

    // The thing that actually matters: does the shared detector see it?
    expect(
      isUniqueViolation(captured),
      "isUniqueViolation missed a real 23505 — every SQLSTATE branch in the " +
        "codebase is affected, not just this one",
    ).toBe(true);
  });
});
