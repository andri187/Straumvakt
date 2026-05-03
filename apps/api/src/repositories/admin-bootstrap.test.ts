// bootstrapAdminUser tests — covers the four paths:
//   1. First call ever         → creates User + PlatformGrant
//   2. Second call same email   → finds both, no inserts
//   3. User exists, no grant    → creates only the grant
//   4. Both exist               → no-op, returns existing ids
//
// The repo runs against a hand-rolled fake PrismaClient mirroring
// only the methods it touches (user.findUnique/create,
// platformGrant.findUnique/create). Same pattern as the other
// repository tests in this folder.

import { describe, expect, it } from "vitest";
import { bootstrapAdminUser } from "./admin-bootstrap";
import type { PrismaClient } from "../generated/prisma/client";

interface UserRow {
  id: string;
  email: string;
  audience: "operator" | "driver" | "service";
}

interface GrantRow {
  userId: string;
  role: "super_user" | "platform_admin" | "support_agent" | "sales_cs" | "finance_internal" | "auditor";
  status: "active" | "suspended" | "revoked";
}

function makeFake() {
  const users: UserRow[] = [];
  const grants: GrantRow[] = [];
  let nextUserId = 1;

  const db = {
    user: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      findUnique: async ({ where }: any) => {
        return users.find((u) => u.email === where.email) ?? null;
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      create: async ({ data }: any) => {
        const row: UserRow = {
          id: `user-${nextUserId++}`,
          email: data.email,
          audience: data.audience,
        };
        users.push(row);
        return row;
      },
    },
    platformGrant: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      findUnique: async ({ where }: any) => {
        return grants.find((g) => g.userId === where.userId) ?? null;
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      create: async ({ data }: any) => {
        const row: GrantRow = {
          userId: data.userId,
          role: data.role,
          status: data.status,
        };
        grants.push(row);
        return row;
      },
    },
  };

  return { db: db as unknown as PrismaClient, users, grants };
}

describe("bootstrapAdminUser", () => {
  it("first call: creates User + PlatformGrant", async () => {
    const f = makeFake();
    const result = await bootstrapAdminUser(f.db, "ops@straumvakt.is");

    expect(result.userId).toBe("user-1");
    expect(result.email).toBe("ops@straumvakt.is");
    expect(result.audience).toBe("operator");
    expect(result.createdUser).toBe(true);
    expect(result.createdGrant).toBe(true);

    expect(f.users).toHaveLength(1);
    expect(f.users[0].audience).toBe("operator");
    expect(f.grants).toHaveLength(1);
    expect(f.grants[0].role).toBe("super_user");
    expect(f.grants[0].status).toBe("active");
  });

  it("second call same email: finds both, no inserts", async () => {
    const f = makeFake();
    const first = await bootstrapAdminUser(f.db, "ops@straumvakt.is");
    const second = await bootstrapAdminUser(f.db, "ops@straumvakt.is");

    expect(second.userId).toBe(first.userId);
    expect(second.createdUser).toBe(false);
    expect(second.createdGrant).toBe(false);

    expect(f.users).toHaveLength(1);
    expect(f.grants).toHaveLength(1);
  });

  it("user exists but no grant: creates only the grant", async () => {
    const f = makeFake();
    // Pre-seed a User row without a grant (e.g. a non-admin user
    // imported via Zaptec sync who later becomes the bootstrap admin).
    f.users.push({
      id: "user-pre-existing",
      email: "ops@straumvakt.is",
      audience: "operator",
    });

    const result = await bootstrapAdminUser(f.db, "ops@straumvakt.is");

    expect(result.userId).toBe("user-pre-existing");
    expect(result.createdUser).toBe(false);
    expect(result.createdGrant).toBe(true);
    expect(f.users).toHaveLength(1);
    expect(f.grants).toHaveLength(1);
    expect(f.grants[0].userId).toBe("user-pre-existing");
  });

  it("trims surrounding whitespace from email before lookup", async () => {
    const f = makeFake();
    await bootstrapAdminUser(f.db, "  ops@straumvakt.is  ");
    const second = await bootstrapAdminUser(f.db, "ops@straumvakt.is");
    // Same row both times — trim normalises before lookup.
    expect(f.users).toHaveLength(1);
    expect(second.createdUser).toBe(false);
  });

  it("changing ADMIN_EMAIL: provisions a new pair, leaves the old in place", async () => {
    const f = makeFake();
    const oldAdmin = await bootstrapAdminUser(f.db, "old@straumvakt.is");
    const newAdmin = await bootstrapAdminUser(f.db, "new@straumvakt.is");

    expect(oldAdmin.userId).not.toBe(newAdmin.userId);
    expect(f.users).toHaveLength(2);
    expect(f.grants).toHaveLength(2);
    // Both rows are super_user — neither one revokes the other,
    // matching the documented gotcha in admin-bootstrap.ts.
    expect(f.grants.every((g) => g.role === "super_user")).toBe(true);
  });
});
