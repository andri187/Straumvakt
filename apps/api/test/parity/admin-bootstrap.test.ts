// bootstrapAdminUser — the four idempotency paths, against the real database.
//
// ── WHY THIS MOVED HERE 2026-08-07 ──────────────────────────────────────
//
// This lived at src/repositories/admin-bootstrap.test.ts and drove the
// repository through a hand-rolled fake PrismaClient. When the repository
// ported to Drizzle the fake stopped intercepting anything and every case
// failed — the same breakage as charging-stations.test.ts, and the same
// pattern still sitting in the remaining fake-client tests.
//
// Rather than replace one fake with another (a fake Drizzle would mean
// interpreting SQL chunk objects, which is more machinery than the code
// under test), each case now runs against real Postgres inside a
// transaction that is rolled back. That tests the actual SQL — the citext
// comparison, the unique constraints, the FK from platform_grants to users
// — none of which a fake could have caught.
//
// EVERY CASE ROLLS BACK. Nothing is left behind on the shared branch. The
// rollback is driven by throwing a sentinel out of db.transaction(), which
// is the documented Drizzle idiom; tx.rollback() throws too, but its error
// is not distinguishable from a real failure at the call site.

import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeAll, getDrizzle, hasDb } from "./_harness";
import { bootstrapAdminUser } from "../../src/repositories/admin-bootstrap";
import { platformGrants, users } from "@straumvakt/shared/db/identity";

/** Marker that unwinds the transaction without looking like a failure. */
const ROLLBACK = Symbol("rollback");

/**
 * Run `fn` inside a transaction and always roll back.
 * Returns whatever `fn` returned.
 */
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

// Emails are namespaced per run so a crashed run that somehow escaped the
// rollback cannot collide with the next one.
const stamp = Math.floor(performance.now() * 1000);
const email = (n: string) => `parity-bootstrap-${n}-${stamp}@straumvakt.invalid`;

describe.skipIf(!hasDb)("bootstrapAdminUser (real DB, rolled back)", () => {
  afterAll(closeAll);

  it("first call: creates User + PlatformGrant", async () => {
    const e = email("first");
    const { result, userRows, grantRows } = await inRollback(async (tx) => {
      const result = await bootstrapAdminUser(tx, e);
      const userRows = await (tx as never as ReturnType<typeof getDrizzle>)
        .select({ id: users.id, audience: users.audience })
        .from(users)
        .where(eq(users.email, e));
      const grantRows = await (tx as never as ReturnType<typeof getDrizzle>)
        .select({ role: platformGrants.role, status: platformGrants.status })
        .from(platformGrants)
        .where(eq(platformGrants.userId, result.userId));
      return { result, userRows, grantRows };
    });

    expect(result.email).toBe(e);
    expect(result.audience).toBe("operator");
    expect(result.createdUser).toBe(true);
    expect(result.createdGrant).toBe(true);
    expect(userRows).toHaveLength(1);
    expect(userRows[0]!.audience).toBe("operator");
    expect(grantRows).toHaveLength(1);
    expect(grantRows[0]!.role).toBe("super_user");
    expect(grantRows[0]!.status).toBe("active");
  });

  it("second call same email: finds both, no inserts", async () => {
    const e = email("second");
    const { first, second, count } = await inRollback(async (tx) => {
      const first = await bootstrapAdminUser(tx, e);
      const second = await bootstrapAdminUser(tx, e);
      const rows = await (tx as never as ReturnType<typeof getDrizzle>)
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, e));
      return { first, second, count: rows.length };
    });

    expect(second.userId).toBe(first.userId);
    expect(second.createdUser).toBe(false);
    expect(second.createdGrant).toBe(false);
    expect(count).toBe(1);
  });

  it("user exists but no grant: creates only the grant", async () => {
    const e = email("nogrant");
    const { result, preId } = await inRollback(async (tx) => {
      const d = tx as never as ReturnType<typeof getDrizzle>;
      // A user imported by some other path, with no platform grant.
      const [pre] = await d
        .insert(users)
        .values({ email: e, displayName: "Pre-existing", audience: "operator", status: "active" })
        .returning({ id: users.id });
      const result = await bootstrapAdminUser(tx, e);
      return { result, preId: pre!.id };
    });

    expect(result.userId).toBe(preId);
    expect(result.createdUser).toBe(false);
    expect(result.createdGrant).toBe(true);
  });

  it("trims surrounding whitespace from email before lookup", async () => {
    const e = email("trim");
    const { second, count } = await inRollback(async (tx) => {
      await bootstrapAdminUser(tx, `  ${e}  `);
      const second = await bootstrapAdminUser(tx, e);
      const rows = await (tx as never as ReturnType<typeof getDrizzle>)
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, e));
      return { second, count: rows.length };
    });
    // Same row both times — trim normalises before lookup.
    expect(count).toBe(1);
    expect(second.createdUser).toBe(false);
  });

  it("email lookup is case-insensitive — the column is citext", async () => {
    // A fake matching on JS string equality could never have caught this.
    const e = email("case");
    const { second } = await inRollback(async (tx) => {
      await bootstrapAdminUser(tx, e);
      const second = await bootstrapAdminUser(tx, e.toUpperCase());
      return { second };
    });
    expect(second.createdUser).toBe(false);
  });

  it("changing ADMIN_EMAIL: provisions a new pair, leaves the old in place", async () => {
    const a = email("old");
    const b = email("new");
    const { oldAdmin, newAdmin, roles } = await inRollback(async (tx) => {
      const oldAdmin = await bootstrapAdminUser(tx, a);
      const newAdmin = await bootstrapAdminUser(tx, b);
      const d = tx as never as ReturnType<typeof getDrizzle>;
      const roles = await Promise.all(
        [oldAdmin.userId, newAdmin.userId].map(async (id) => {
          const [g] = await d
            .select({ role: platformGrants.role })
            .from(platformGrants)
            .where(eq(platformGrants.userId, id));
          return g!.role;
        }),
      );
      return { oldAdmin, newAdmin, roles };
    });

    expect(oldAdmin.userId).not.toBe(newAdmin.userId);
    // Both rows are super_user — neither one revokes the other,
    // matching the documented gotcha in admin-bootstrap.ts.
    expect(roles).toEqual(["super_user", "super_user"]);
  });
});
