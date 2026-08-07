// UserToken repository — one-shot, time-boxed auth artefacts, real database.
//
// ── WHY THIS MOVED HERE 2026-08-07 ──────────────────────────────────────
//
// Seventh conversion of the hand-rolled fake-PrismaClient pattern. Same
// resolution as the rest: real Postgres, every case inside a transaction
// that is rolled back.
//
// This one gains the most from the move. The whole point of consumeUserToken
// is that it is ATOMIC — the claim is `UPDATE … WHERE id = ? AND used_at IS
// NULL`, and its correctness is a property of Postgres, not of JavaScript. A
// fake that checked `row.usedAt === null` in JS and then assigned to it was
// asserting the shape of the code, not the guarantee. Here the conditional
// update runs for real, and the race case below is a genuine second UPDATE
// against a row the first one already claimed.
//
// EVERY CASE ROLLS BACK.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { closeAll, getDrizzle, hasDb } from "./_harness";
import { users, userTokens } from "@straumvakt/shared/db/identity";
import {
  createUserToken,
  consumeUserToken,
  revokeUserToken,
  listOutstandingUserTokens,
} from "../../src/repositories/user-tokens";
import { sha256Hex } from "../../src/lib/sha256";

const ROLLBACK = Symbol("rollback");

async function inRollback<T>(fn: (tx: never) => Promise<T>): Promise<T> {
  let captured: T;
  try {
    await getDrizzle().transaction(async (tx) => {
      captured = await fn(tx as never);
      throw ROLLBACK;
    });
  } catch (err) {
    if (err !== ROLLBACK) throw err;
  }
  return captured!;
}

/** A throwaway user inside the current transaction. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function makeUser(tx: any): Promise<string> {
  const [u] = await tx
    .insert(users)
    .values({
      email: `parity-token-${Math.floor(performance.now() * 1e6)}@straumvakt.invalid`,
      displayName: "Parity token holder",
      audience: "operator",
      status: "active",
    })
    .returning({ id: users.id });
  return u.id as string;
}

describe.skipIf(!hasDb)("user tokens (real DB, rolled back)", () => {
  afterAll(closeAll);

  beforeAll(async () => {
    if (!hasDb) return;
  });

  it("returns plaintext + persists the hash, never the plaintext", async () => {
    const { plaintext, stored } = await inRollback(async (tx) => {
      const userId = await makeUser(tx);
      const r = await createUserToken(tx, { userId, kind: "invite", ttlMinutes: 60 });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const [stored] = await (tx as any)
        .select({ tokenHash: userTokens.tokenHash })
        .from(userTokens)
        .where(eq(userTokens.id, r.id));
      return { plaintext: r.plaintext, stored };
    });

    expect(plaintext).toHaveLength(32);
    expect(stored.tokenHash).toBe(await sha256Hex(plaintext));
    expect(stored.tokenHash).not.toBe(plaintext);
  });

  it("rejects non-positive ttlMinutes", async () => {
    await inRollback(async (tx) => {
      const userId = await makeUser(tx);
      await expect(
        createUserToken(tx, { userId, kind: "invite", ttlMinutes: 0 }),
      ).rejects.toThrow("ttl_minutes_must_be_positive");
    });
  });

  it("happy path: returns userId + metadata and marks usedAt", async () => {
    const { outcome, usedAt } = await inRollback(async (tx) => {
      const userId = await makeUser(tx);
      const r = await createUserToken(tx, {
        userId,
        kind: "invite",
        ttlMinutes: 60,
        metadata: { orgId: "abc", role: "host_admin" },
      });
      const outcome = await consumeUserToken(tx, r.plaintext, "invite");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const [row] = await (tx as any)
        .select({ usedAt: userTokens.usedAt })
        .from(userTokens)
        .where(eq(userTokens.id, r.id));
      return { outcome, usedAt: row.usedAt };
    });

    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.metadata).toEqual({ orgId: "abc", role: "host_admin" });
    }
    expect(usedAt).not.toBeNull();
  });

  it("rejects wrong_kind", async () => {
    const outcome = await inRollback(async (tx) => {
      const userId = await makeUser(tx);
      const r = await createUserToken(tx, { userId, kind: "invite", ttlMinutes: 60 });
      return consumeUserToken(tx, r.plaintext, "magic_link");
    });
    expect(outcome).toEqual({ ok: false, reason: "wrong_kind" });
  });

  it("is genuinely one-shot — the second consume loses the conditional UPDATE", async () => {
    // The claim is `UPDATE … WHERE id = ? AND used_at IS NULL`. This is the
    // case a JS fake could only pretend to cover.
    const { first, second } = await inRollback(async (tx) => {
      const userId = await makeUser(tx);
      const r = await createUserToken(tx, { userId, kind: "invite", ttlMinutes: 60 });
      const first = await consumeUserToken(tx, r.plaintext, "invite");
      const second = await consumeUserToken(tx, r.plaintext, "invite");
      return { first, second };
    });
    expect(first.ok).toBe(true);
    expect(second).toEqual({ ok: false, reason: "already_used" });
  });

  it("rejects expired tokens", async () => {
    const outcome = await inRollback(async (tx) => {
      const userId = await makeUser(tx);
      const r = await createUserToken(tx, { userId, kind: "invite", ttlMinutes: 60 });
      // Expire it directly — createUserToken refuses a non-positive ttl.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (tx as any)
        .update(userTokens)
        .set({ expiresAt: new Date(Date.now() - 60_000) })
        .where(eq(userTokens.id, r.id));
      return consumeUserToken(tx, r.plaintext, "invite");
    });
    expect(outcome).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects not_found for a plaintext that was never minted", async () => {
    const outcome = await inRollback(async (tx) =>
      consumeUserToken(tx, "abcdefghijkmnpqrstuvwxyz23456789", "invite"),
    );
    expect(outcome).toEqual({ ok: false, reason: "not_found" });
  });

  it("revoke marks an unused token used and is idempotent", async () => {
    const { first, second } = await inRollback(async (tx) => {
      const userId = await makeUser(tx);
      const r = await createUserToken(tx, { userId, kind: "invite", ttlMinutes: 60 });
      const first = await revokeUserToken(tx, r.id);
      const second = await revokeUserToken(tx, r.id);
      return { first, second };
    });
    expect(first).toEqual({ revoked: true });
    expect(second).toEqual({ revoked: false });
  });

  it("a revoked token cannot then be consumed", async () => {
    const outcome = await inRollback(async (tx) => {
      const userId = await makeUser(tx);
      const r = await createUserToken(tx, { userId, kind: "invite", ttlMinutes: 60 });
      await revokeUserToken(tx, r.id);
      return consumeUserToken(tx, r.plaintext, "invite");
    });
    expect(outcome).toEqual({ ok: false, reason: "already_used" });
  });

  it("lists active tokens for a user, newest first, and filters by kind", async () => {
    const { forUser, invitesOnly, userId } = await inRollback(async (tx) => {
      const userId = await makeUser(tx);
      const a = await createUserToken(tx, { userId, kind: "invite", ttlMinutes: 60 });
      const b = await createUserToken(tx, { userId, kind: "magic_link", ttlMinutes: 60 });
      // created_at defaults to now(), which is TRANSACTION-stable — every row
      // written here shares a timestamp, so ordering is set explicitly.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (tx as any)
        .update(userTokens)
        .set({ createdAt: new Date("2020-01-01T00:00:00Z") })
        .where(eq(userTokens.id, a.id));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (tx as any)
        .update(userTokens)
        .set({ createdAt: new Date("2020-06-01T00:00:00Z") })
        .where(eq(userTokens.id, b.id));
      return {
        userId,
        forUser: await listOutstandingUserTokens(tx, { userId }),
        invitesOnly: await listOutstandingUserTokens(tx, { userId, kind: "invite" }),
      };
    });

    expect(forUser).toHaveLength(2);
    expect(forUser[0]!.kind).toBe("magic_link"); // newest first
    expect(forUser.every((r) => r.userId === userId)).toBe(true);
    expect(invitesOnly).toHaveLength(1);
    expect(invitesOnly[0]!.kind).toBe("invite");
  });

  it("omits used and expired tokens from the outstanding list", async () => {
    const rows = await inRollback(async (tx) => {
      const userId = await makeUser(tx);
      const used = await createUserToken(tx, { userId, kind: "invite", ttlMinutes: 60 });
      const expired = await createUserToken(tx, { userId, kind: "invite", ttlMinutes: 60 });
      const live = await createUserToken(tx, { userId, kind: "invite", ttlMinutes: 60 });
      await revokeUserToken(tx, used.id);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (tx as any)
        .update(userTokens)
        .set({ expiresAt: new Date(Date.now() - 60_000) })
        .where(and(eq(userTokens.id, expired.id)));
      const rows = await listOutstandingUserTokens(tx, { userId });
      return rows.map((r) => r.id).concat(`live:${live.id}`);
    });
    const live = rows.pop()!.slice(5);
    expect(rows).toEqual([live]);
  });
});
