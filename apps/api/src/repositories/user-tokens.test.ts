// UserToken repository tests — exercises the create / consume /
// revoke / list lifecycle. Hand-rolled fake PrismaClient mirroring
// only the methods this repo touches.

import { describe, expect, it } from "vitest";
import {
  createUserToken,
  consumeUserToken,
  revokeUserToken,
  listOutstandingUserTokens,
} from "./user-tokens";
import type { PrismaClient } from "../generated/prisma/client";

interface TokenRow {
  id: string;
  userId: string;
  kind: "invite" | "magic_link" | "password_reset";
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  createdById: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

function makeFake() {
  const rows: TokenRow[] = [];
  let nextId = 1;
  const db = {
    userToken: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      create: async ({ data }: any) => {
        const row: TokenRow = {
          id: `token-${nextId++}`,
          userId: data.userId,
          kind: data.kind,
          tokenHash: data.tokenHash,
          expiresAt: data.expiresAt,
          usedAt: null,
          createdById: data.createdById ?? null,
          metadata: (data.metadata ?? {}) as Record<string, unknown>,
          createdAt: new Date(),
        };
        rows.push(row);
        return { id: row.id, expiresAt: row.expiresAt };
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      findUnique: async ({ where }: any) => {
        return rows.find((r) => r.tokenHash === where.tokenHash) ?? null;
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        for (const row of rows) {
          if (where.id && row.id !== where.id) continue;
          if (where.usedAt === null && row.usedAt !== null) continue;
          if (data.usedAt !== undefined) {
            row.usedAt = data.usedAt;
            count++;
          }
        }
        return { count };
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      findMany: async ({ where, orderBy }: any) => {
        const now = Date.now();
        const matched = rows.filter((r) => {
          if (where.userId && r.userId !== where.userId) return false;
          if (where.kind && r.kind !== where.kind) return false;
          if (where.usedAt === null && r.usedAt !== null) return false;
          if (where.expiresAt?.gt && r.expiresAt.getTime() <= now) return false;
          return true;
        });
        if (orderBy?.createdAt === "desc") {
          matched.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        }
        return matched;
      },
    },
  };
  return { db: db as unknown as PrismaClient, rows };
}

describe("createUserToken", () => {
  it("returns plaintext + persists hash, never plaintext", async () => {
    const f = makeFake();
    const result = await createUserToken(f.db, {
      userId: "user-1",
      kind: "invite",
      ttlMinutes: 60,
      metadata: { orgId: "org-1" },
    });
    expect(result.plaintext).toMatch(/^[a-km-np-z2-9]{32}$/);
    expect(result.id).toBe("token-1");
    expect(f.rows).toHaveLength(1);
    expect(f.rows[0].tokenHash).not.toBe(result.plaintext); // hashed, not literal
    expect(f.rows[0].tokenHash).toMatch(/^[0-9a-f]{64}$/); // sha256 hex
    expect(f.rows[0].metadata).toEqual({ orgId: "org-1" });
  });

  it("rejects non-positive ttlMinutes", async () => {
    const f = makeFake();
    await expect(
      createUserToken(f.db, { userId: "user-1", kind: "invite", ttlMinutes: 0 }),
    ).rejects.toThrow("ttl_minutes_must_be_positive");
  });
});

describe("consumeUserToken", () => {
  it("happy path: returns userId + metadata, marks usedAt", async () => {
    const f = makeFake();
    const created = await createUserToken(f.db, {
      userId: "user-1",
      kind: "invite",
      ttlMinutes: 60,
      metadata: { orgId: "org-1", role: "operator" },
    });

    const outcome = await consumeUserToken(f.db, created.plaintext, "invite");
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.tokenId).toBe(created.id);
      expect(outcome.userId).toBe("user-1");
      expect(outcome.kind).toBe("invite");
      expect(outcome.metadata).toEqual({ orgId: "org-1", role: "operator" });
    }
    expect(f.rows[0].usedAt).not.toBeNull();
  });

  it("rejects wrong_kind: an invite token consumed as magic_link returns wrong_kind", async () => {
    const f = makeFake();
    const created = await createUserToken(f.db, {
      userId: "user-1",
      kind: "invite",
      ttlMinutes: 60,
    });
    const outcome = await consumeUserToken(f.db, created.plaintext, "magic_link");
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe("wrong_kind");
    // Not marked used — wrong kind shouldn't burn the token.
    expect(f.rows[0].usedAt).toBeNull();
  });

  it("rejects already_used: second consume returns already_used and does not double-mark", async () => {
    const f = makeFake();
    const created = await createUserToken(f.db, {
      userId: "user-1",
      kind: "invite",
      ttlMinutes: 60,
    });
    const first = await consumeUserToken(f.db, created.plaintext, "invite");
    expect(first.ok).toBe(true);
    const firstUsedAt = f.rows[0].usedAt;

    const second = await consumeUserToken(f.db, created.plaintext, "invite");
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toBe("already_used");
    // usedAt unchanged from first consume.
    expect(f.rows[0].usedAt).toEqual(firstUsedAt);
  });

  it("rejects expired tokens", async () => {
    const f = makeFake();
    // Create with 1-minute TTL, then rewind the row's expiresAt to
    // simulate time passage.
    const created = await createUserToken(f.db, {
      userId: "user-1",
      kind: "invite",
      ttlMinutes: 1,
    });
    f.rows[0].expiresAt = new Date(Date.now() - 1000);

    const outcome = await consumeUserToken(f.db, created.plaintext, "invite");
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe("expired");
    expect(f.rows[0].usedAt).toBeNull();
  });

  it("rejects not_found: random plaintext that was never minted", async () => {
    const f = makeFake();
    const outcome = await consumeUserToken(
      f.db,
      "abcdefghijkmnpqrstuvwxyz23456789",
      "invite",
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe("not_found");
  });
});

describe("revokeUserToken", () => {
  it("marks an unused token used; returns revoked:true", async () => {
    const f = makeFake();
    const created = await createUserToken(f.db, {
      userId: "user-1",
      kind: "invite",
      ttlMinutes: 60,
    });
    const result = await revokeUserToken(f.db, created.id);
    expect(result.revoked).toBe(true);
    expect(f.rows[0].usedAt).not.toBeNull();
  });

  it("idempotent: re-revoking returns revoked:false without changing usedAt", async () => {
    const f = makeFake();
    const created = await createUserToken(f.db, {
      userId: "user-1",
      kind: "invite",
      ttlMinutes: 60,
    });
    await revokeUserToken(f.db, created.id);
    const firstUsedAt = f.rows[0].usedAt;

    const result = await revokeUserToken(f.db, created.id);
    expect(result.revoked).toBe(false);
    expect(f.rows[0].usedAt).toEqual(firstUsedAt);
  });

  it("revoked token cannot be consumed afterward", async () => {
    const f = makeFake();
    const created = await createUserToken(f.db, {
      userId: "user-1",
      kind: "invite",
      ttlMinutes: 60,
    });
    await revokeUserToken(f.db, created.id);
    const outcome = await consumeUserToken(f.db, created.plaintext, "invite");
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe("already_used");
  });
});

describe("listOutstandingUserTokens", () => {
  it("returns active (not used, not expired) tokens for a user, newest first", async () => {
    const f = makeFake();
    await createUserToken(f.db, { userId: "user-1", kind: "invite", ttlMinutes: 60 });
    await createUserToken(f.db, { userId: "user-1", kind: "magic_link", ttlMinutes: 60 });
    const expired = await createUserToken(f.db, {
      userId: "user-1",
      kind: "invite",
      ttlMinutes: 60,
    });
    f.rows[2].expiresAt = new Date(Date.now() - 1000);

    const used = await createUserToken(f.db, {
      userId: "user-1",
      kind: "invite",
      ttlMinutes: 60,
    });
    await revokeUserToken(f.db, used.id);
    void expired;

    const list = await listOutstandingUserTokens(f.db, { userId: "user-1" });
    // Two outstanding (the first two), expired + revoked filtered out.
    expect(list).toHaveLength(2);
  });

  it("filters by kind", async () => {
    const f = makeFake();
    await createUserToken(f.db, { userId: "user-1", kind: "invite", ttlMinutes: 60 });
    await createUserToken(f.db, { userId: "user-1", kind: "magic_link", ttlMinutes: 60 });
    const list = await listOutstandingUserTokens(f.db, {
      userId: "user-1",
      kind: "invite",
    });
    expect(list).toHaveLength(1);
    expect(list[0].kind).toBe("invite");
  });
});
