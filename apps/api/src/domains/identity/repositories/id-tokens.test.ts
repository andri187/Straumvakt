// IdToken repo unit tests — verify the auto-mint path, the manual
// path, the validation guards, and the collision retry.
//
// The fake is now Drizzle-shaped rather than Prisma-shaped. It implements
// exactly the two chains the repository builds and nothing else:
//
//   db.insert(table).values(v).returning(cols)
//   db.select(cols).from(table).where(cond).orderBy(...)
//
// Conditions are ignored, as they were in the Prisma fake — `eq` and
// `notExists` produce opaque SQL objects either way, so the fake reproduces
// the filter's INTENT in TypeScript. What it does model faithfully is the
// unique constraint, because the retry loop hangs off it: a duplicate value
// throws a real SQLSTATE 23505 shape so `isUniqueViolation` fires and the
// repository raises UniqueViolationError, exactly as node-postgres would.

import { describe, expect, it } from "vitest";
import {
  backfillPrimaryRfidForUsersWithoutTokens,
  createIdToken,
  mintRfidValue,
} from "./id-tokens";
import { idTokens, users } from "@straumvakt/shared/db/identity";
import type { Db } from "../../../lib/drizzle";

interface StoredRow {
  id: string;
  userId: string;
  kind: string;
  value: string;
  vendorIssuedBy: string | null;
  vendorTokenId: string | null;
  label: string | null;
  status: string;
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  scopeInstallationId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** What node-postgres raises on a unique violation. Only `code` matters to
 *  `isUniqueViolation`; `constraint` is carried for the message. */
function uniqueViolation(constraint: string) {
  return Object.assign(new Error(`duplicate key value violates unique constraint "${constraint}"`), {
    code: "23505",
    constraint,
  });
}

interface FakeState {
  tokens: StoredRow[];
  users: Array<{ id: string; email: string; createdAt: Date }>;
}

function makeFakeDb(initial?: Partial<FakeState>) {
  const state: FakeState = {
    tokens: initial?.tokens ? [...initial.tokens] : [],
    users: initial?.users ? [...initial.users] : [],
  };
  let nextId = state.tokens.length + 1;

  const db = {
    insert(table: unknown) {
      if (table !== idTokens) throw new Error("fake: only id_tokens inserts are modelled");
      return {
        values(data: Record<string, unknown>) {
          return {
            async returning() {
              const value = data.value as string;
              if (state.tokens.some((r) => r.value === value)) {
                throw uniqueViolation("id_tokens_value_key");
              }
              const now = new Date();
              const row: StoredRow = {
                id: `token-${nextId++}`,
                userId: data.userId as string,
                kind: data.kind as string,
                value,
                vendorIssuedBy: (data.vendorIssuedBy as string | null) ?? null,
                vendorTokenId: (data.vendorTokenId as string | null) ?? null,
                label: (data.label as string | null) ?? null,
                status: "active",
                expiresAt: (data.expiresAt as Date | null) ?? null,
                lastUsedAt: null,
                scopeInstallationId: (data.scopeInstallationId as string | null) ?? null,
                createdAt: now,
                updatedAt: now,
              };
              state.tokens.push(row);
              return [row];
            },
          };
        },
      };
    },
    select() {
      return {
        from(table: unknown) {
          const chain = {
            where() {
              return chain;
            },
            orderBy() {
              return chain;
            },
            // `notExists(subquery)` never awaits the subquery, so only the
            // outer chain's `then` is ever reached.
            then(resolve: (rows: unknown[]) => void) {
              if (table !== users) {
                resolve([]);
                return;
              }
              // `notExists(select 1 from id_tokens where user_id = users.id)`
              // — users with zero tokens, oldest first.
              resolve(
                state.users
                  .filter((u) => !state.tokens.some((t) => t.userId === u.id))
                  .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
                  .map((u) => ({ id: u.id, email: u.email })),
              );
            },
          };
          return chain;
        },
      };
    },
  } as unknown as Db;

  return { db, state };
}

describe("mintRfidValue", () => {
  it("returns 8 uppercase-hex characters", () => {
    for (let i = 0; i < 50; i++) {
      const v = mintRfidValue();
      expect(v).toMatch(/^[0-9A-F]{8}$/);
    }
  });

  it("doesn't repeat across 100 calls (probabilistic but firm)", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) seen.add(mintRfidValue());
    // 100 8-hex draws from 4.3B options should never collide in practice.
    expect(seen.size).toBe(100);
  });
});

describe("createIdToken", () => {
  it("auto-mints when value is omitted and kind is rfid", async () => {
    const { db } = makeFakeDb();
    const token = await createIdToken(db, {
      userId: "user-1",
      kind: "rfid",
      label: "Primary",
    });
    expect(token.value).toMatch(/^[0-9A-F]{8}$/);
    expect(token.kind).toBe("rfid");
    expect(token.label).toBe("Primary");
    expect(token.status).toBe("active");
  });

  it("uses the provided value when given (no auto-mint)", async () => {
    const { db } = makeFakeDb();
    const token = await createIdToken(db, {
      userId: "user-1",
      kind: "rfid",
      value: "DEADBEEF",
      label: "manually entered",
    });
    expect(token.value).toBe("DEADBEEF");
  });

  it("trims whitespace on the provided value", async () => {
    const { db } = makeFakeDb();
    const token = await createIdToken(db, {
      userId: "user-1",
      kind: "rfid",
      value: "  CAFEBABE  ",
    });
    expect(token.value).toBe("CAFEBABE");
  });

  it("rejects empty/whitespace-only value", async () => {
    const { db } = makeFakeDb();
    await expect(
      createIdToken(db, {
        userId: "user-1",
        kind: "rfid",
        value: "   ",
      }),
    ).rejects.toThrow(/empty/);
  });

  it("rejects non-rfid kinds without an explicit value", async () => {
    const { db } = makeFakeDb();
    await expect(
      createIdToken(db, { userId: "user-1", kind: "app_jwt" }),
    ).rejects.toThrow(/auto-mint only supports rfid/);
  });

  it("retries on collision and eventually succeeds", async () => {
    // We can't predict the random draw, so intercept crypto.getRandomValues
    // to force the first two mints to collide with a pre-loaded value.
    const { db } = makeFakeDb({
      tokens: [
        {
          id: "preload-1",
          userId: "other",
          kind: "rfid",
          value: "AAAAAAAA",
          vendorIssuedBy: null,
          vendorTokenId: null,
          label: null,
          status: "active",
          expiresAt: null,
          lastUsedAt: null,
          scopeInstallationId: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
    });

    const real = crypto.getRandomValues;
    let callCount = 0;
    crypto.getRandomValues = ((arr: Uint8Array) => {
      callCount++;
      const fill = callCount <= 2 ? 0xaa : 0xbb;
      arr.fill(fill);
      return arr;
    }) as typeof crypto.getRandomValues;

    try {
      const token = await createIdToken(db, { userId: "user-1", kind: "rfid" });
      expect(token.value).toBe("BBBBBBBB");
      expect(callCount).toBeGreaterThanOrEqual(2);
    } finally {
      crypto.getRandomValues = real;
    }
  });

  it("surfaces the conflict when the operator-provided value is taken (no retry)", async () => {
    // Manual value collisions are NOT retried — re-minting would
    // silently swap the operator's input, which is wrong.
    const { db } = makeFakeDb();
    await createIdToken(db, { userId: "user-1", kind: "rfid", value: "CAFEBABE" });
    await expect(
      createIdToken(db, { userId: "user-2", kind: "rfid", value: "CAFEBABE" }),
    ).rejects.toThrow(/unique constraint violated/);
  });
});

describe("backfillPrimaryRfidForUsersWithoutTokens", () => {
  it("mints one primary RFID per user with zero tokens; skips users who already have at least one", async () => {
    const { db, state } = makeFakeDb({
      users: [
        { id: "u-1", email: "anna@x.is", createdAt: new Date("2026-01-01") },
        { id: "u-2", email: "bjorn@x.is", createdAt: new Date("2026-02-01") },
        { id: "u-3", email: "doddi@x.is", createdAt: new Date("2026-03-01") },
      ],
      tokens: [
        // u-2 already has a token; only u-1 and u-3 should get backfilled
        {
          id: "existing-1",
          userId: "u-2",
          kind: "rfid",
          value: "EXISTING1",
          vendorIssuedBy: null,
          vendorTokenId: null,
          label: "Pre-existing",
          status: "active",
          expiresAt: null,
          lastUsedAt: null,
          scopeInstallationId: null,
          createdAt: new Date("2025-12-01"),
          updatedAt: new Date("2025-12-01"),
        },
      ],
    });

    const report = await backfillPrimaryRfidForUsersWithoutTokens(db);

    expect(report.scanned).toBe(2);
    expect(report.minted).toBe(2);
    expect(report.errors).toBe(0);
    expect(report.mintedDetails.map((d) => d.email).sort()).toEqual([
      "anna@x.is",
      "doddi@x.is",
    ]);
    // u-2's pre-existing token is untouched; two new tokens created.
    expect(state.tokens.length).toBe(3);
    // Newly-minted tokens carry the backfill label.
    const minted = state.tokens.filter((t) => t.label === "Primary (backfill)");
    expect(minted.map((m) => m.userId).sort()).toEqual(["u-1", "u-3"]);
  });

  it("re-running is idempotent (no users left to mint for)", async () => {
    const { db } = makeFakeDb({
      users: [{ id: "u-1", email: "x@y.is", createdAt: new Date() }],
      tokens: [
        {
          id: "t-1",
          userId: "u-1",
          kind: "rfid",
          value: "ALREADY01",
          vendorIssuedBy: null,
          vendorTokenId: null,
          label: "Primary",
          status: "active",
          expiresAt: null,
          lastUsedAt: null,
          scopeInstallationId: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
    });
    const report = await backfillPrimaryRfidForUsersWithoutTokens(db);
    expect(report.scanned).toBe(0);
    expect(report.minted).toBe(0);
    expect(report.errors).toBe(0);
  });

  it("collects per-user errors without aborting the whole backfill", async () => {
    // Pin the RNG so every mint produces the one value already taken. All
    // five retries collide, the user is recorded as an error, and the
    // backfill carries on to the next one.
    const fixedBytes = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    const real = crypto.getRandomValues;
    crypto.getRandomValues = ((arr: Uint8Array) => {
      arr.set(fixedBytes);
      return arr;
    }) as typeof crypto.getRandomValues;
    try {
      const { db } = makeFakeDb({
        users: [
          { id: "u-1", email: "alice@x.is", createdAt: new Date(0) },
          { id: "u-2", email: "bob@x.is", createdAt: new Date(1) },
        ],
        tokens: [
          {
            id: "blocker",
            userId: "user-other",
            kind: "rfid",
            value: "DEADBEEF",
            vendorIssuedBy: null,
            vendorTokenId: null,
            label: "blocker",
            status: "active",
            expiresAt: null,
            lastUsedAt: null,
            scopeInstallationId: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      });
      const report = await backfillPrimaryRfidForUsersWithoutTokens(db);
      expect(report.scanned).toBe(2);
      expect(report.minted).toBe(0);
      expect(report.errors).toBe(2);
      expect(report.errorDetails.map((e) => e.email).sort()).toEqual([
        "alice@x.is",
        "bob@x.is",
      ]);
    } finally {
      crypto.getRandomValues = real;
    }
  });
});
