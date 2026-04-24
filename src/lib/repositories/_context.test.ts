/**
 * Sprint 0 — proves the tenant boundary is enforced at the data-access layer.
 *
 * These tests don't touch a real database. They exercise the `withOrgContext`
 * contract: missing tenant throws, mismatched tenant throws, correctly-stamped
 * tenant passes through.
 *
 * Database-touching integration tests land in Sprint 1 once the migration
 * applies.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Stub the Prisma module before importing the context code. Vitest hoists
// vi.mock so this happens before _context.ts is evaluated.
vi.mock("@/lib/prisma", () => ({
  prisma: () => ({}) as never,
}));

import { withOrgContext } from "./_context";
import { TenantContextError } from "./_types";

describe("withOrgContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws when orgId is missing", async () => {
    await expect(
      withOrgContext(undefined, async () => "should-not-reach"),
    ).rejects.toBeInstanceOf(TenantContextError);

    await expect(
      withOrgContext(null, async () => "should-not-reach"),
    ).rejects.toBeInstanceOf(TenantContextError);

    await expect(
      withOrgContext("", async () => "should-not-reach"),
    ).rejects.toBeInstanceOf(TenantContextError);
  });

  it("hands a TenantContext to the function with the requested orgId", async () => {
    const result = await withOrgContext(
      "00000000-0000-0000-0000-000000000001",
      async (ctx) => ctx.orgId,
    );
    expect(result).toBe("00000000-0000-0000-0000-000000000001");
  });

  it("requireOrg stamps orgId onto a where-clause", async () => {
    await withOrgContext(
      "00000000-0000-0000-0000-000000000001",
      async ({ requireOrg }) => {
        const where = requireOrg({ status: "active" });
        expect(where).toEqual({
          status: "active",
          orgId: "00000000-0000-0000-0000-000000000001",
        });
      },
    );
  });

  it("requireOrg passes through if the where-clause already has the matching orgId", async () => {
    await withOrgContext(
      "00000000-0000-0000-0000-000000000001",
      async ({ requireOrg }) => {
        const where = requireOrg({
          orgId: "00000000-0000-0000-0000-000000000001",
          status: "active",
        });
        expect(where.orgId).toBe("00000000-0000-0000-0000-000000000001");
      },
    );
  });

  it("requireOrg throws if the where-clause pins a DIFFERENT orgId", async () => {
    await withOrgContext(
      "00000000-0000-0000-0000-000000000001",
      async ({ requireOrg }) => {
        expect(() =>
          requireOrg({
            orgId: "ffffffff-ffff-ffff-ffff-ffffffffffff",
            status: "active",
          }),
        ).toThrow(TenantContextError);
      },
    );
  });
});
