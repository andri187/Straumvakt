// Actual transaction settings/savepoint behaviour on local PostgreSQL, without Neon.
// SQL concurrency between separate connections remains a release check.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { sql } from "drizzle-orm";
import type { Db } from "@/lib/installations/db";
import { drizzleTransactionStore } from "./drizzle-tx-store";

const probe = vi.hoisted(() => ({ fail: false, reads: [] as string[] }));
vi.mock("./drizzle-admission-store", () => ({
  drizzleAuthorizationStore: (executor: { execute: (q: unknown) => Promise<unknown> }) => ({
    facts: async () => {
      probe.reads.push("authorization");
      await executor.execute(sql`select 1`);
      return { token: null, userActive: false, hasInstallationAccess: false };
    },
  }),
}));
vi.mock("@/lib/costing/drizzle-costing-store", () => ({
  loadAgreementFacts: async (executor: { execute: (q: unknown) => Promise<unknown> }) => {
    probe.reads.push("terms");
    if (probe.fail) await executor.execute(sql`select 1 / 0`);
    else await executor.execute(sql`select 2`);
    return { installationAgreementId: null, driverGroup: null, clauses: [], rules: [], rateReferences: [] };
  },
}));

let pg: PGlite;
let db: ReturnType<typeof drizzle>;
beforeAll(async () => { pg = new PGlite(); db = drizzle(pg); });
afterAll(async () => { await pg.close(); });
const input = { idTag: "test", userId: "test", installationId: "test", orgId: "test", at: new Date() };

describe("coherent start authorization and terms read", () => {
  it("uses read-only REPEATABLE READ for the whole read and leaves the later write transaction at READ COMMITTED", async () => {
    const observed: unknown[] = [];
    const wrapped = {
      transaction: (fn: (x: unknown) => Promise<unknown>, config?: unknown) => db.transaction(async (tx) => {
        const result = await tx.execute(sql`select current_setting('transaction_isolation') as isolation, current_setting('transaction_read_only') as readonly`);
        observed.push(result.rows[0]);
        return fn(tx);
      }, config as never),
    };
    const store = drizzleTransactionStore(wrapped as unknown as Db);
    probe.fail = false; probe.reads = [];
    await store.read(async (auth, capture) => { await auth.facts(input); await capture!(input); });
    await store.run(async () => undefined);
    expect(observed).toEqual([{ isolation: "repeatable read", readonly: "on" }, { isolation: "read committed", readonly: "off" }]);
    expect(probe.reads).toEqual(["authorization", "terms"]);
  });

  it("rolls back a terms-query failure to its savepoint without invalidating the authorization snapshot", async () => {
    const store = drizzleTransactionStore(db as unknown as Db);
    probe.fail = true; probe.reads = [];
    await store.read(async (auth, capture) => {
      await auth.facts(input);
      await expect(capture!(input)).rejects.toThrow();
      await expect(auth.facts(input)).resolves.toMatchObject({ userActive: false });
    });
    expect(probe.reads).toEqual(["authorization", "terms", "authorization"]);
    probe.fail = false;
  });
});
