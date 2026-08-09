import { describe, expect, it } from "vitest";
import {
  PRODUCT_WORKFLOWS,
  readinessCounts,
  workflowsFor,
} from "./product-readiness";

describe("product readiness", () => {
  it("accounts for every workflow exactly once", () => {
    const counts = readinessCounts();
    expect(Object.values(counts).reduce((sum, value) => sum + value, 0)).toBe(
      PRODUCT_WORKFLOWS.length,
    );
  });

  it("keeps unsafe invitation work out of ready workflows", () => {
    const invite = PRODUCT_WORKFLOWS.find(
      (workflow) => workflow.id === "driver-invite",
    );
    expect(invite?.state).toBe("unsafe");
  });

  it("returns only the requested product surface", () => {
    expect(workflowsFor("cpo")).not.toHaveLength(0);
    expect(workflowsFor("cpo").every((item) => item.surface === "cpo")).toBe(
      true,
    );
  });
});
