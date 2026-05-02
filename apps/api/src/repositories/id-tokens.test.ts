// IdToken repo unit tests — verify the auto-mint path, the manual
// path, the validation guards, and the collision retry. The repo
// works against any Prisma-shaped client so tests use a hand-rolled
// fake that mirrors the methods we actually call.

import { describe, expect, it } from "vitest";
import {
  backfillPrimaryRfidForUsersWithoutTokens,
  createIdToken,
  mintRfidValue,
} from "./id-tokens";
import type { PrismaClient } from "../generated/prisma/client";

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

/**
 * Hand-rolled in-memory IdToken table. Enforces the @unique constraint
 * on `value` by throwing the same error string Prisma uses ("Unique
 * constraint failed") so the repo's collision-retry path triggers.
 *
 * Cast to PrismaClient at the call site — we only exercise the
 * `idToken.create` method, so the rest of the surface staying typed
 * but unimplemented is fine.
 */
function makeFakeDb() {
  const rows: StoredRow[] = [];
  let nextId = 1;
  return {
    rows,
    db: {
      idToken: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        create: async ({ data }: any) => {
          if (rows.some((r) => r.value === data.value)) {
            throw new Error(
              "Unique constraint failed on the fields: (`value`)",
            );
          }
          const now = new Date();
          const row: StoredRow = {
            id: `token-${nextId++}`,
            userId: data.userId,
            kind: data.kind,
            value: data.value,
            vendorIssuedBy: data.vendorIssuedBy ?? null,
            vendorTokenId: data.vendorTokenId ?? null,
            label: data.label ?? null,
            status: "active",
            expiresAt: data.expiresAt ?? null,
            lastUsedAt: null,
            scopeInstallationId: data.scopeInstallationId ?? null,
            createdAt: now,
            updatedAt: now,
          };
          rows.push(row);
          return row;
        },
      },
    } as unknown as PrismaClient,
  };
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
    // Pre-populate the fake DB with values mintRfidValue might collide
    // against. We can't predict the random draw, but we can intercept
    // crypto.getRandomValues to force the first two calls to collide.
    const { db, rows } = makeFakeDb();
    rows.push({
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
    });

    // Patch crypto.getRandomValues to return AA AA AA AA twice, then
    // BB BB BB BB. First two attempts collide on the @unique constraint;
    // third succeeds.
    const real = crypto.getRandomValues;
    let callCount = 0;
    crypto.getRandomValues = ((arr: Uint8Array) => {
      callCount++;
      const fill = callCount <= 2 ? 0xaa : 0xbb;
      arr.fill(fill);
      return arr;
    }) as typeof crypto.getRandomValues;

    try {
      const token = await createIdToken(db, {
        userId: "user-1",
        kind: "rfid",
      });
      expect(token.value).toBe("BBBBBBBB");
      expect(callCount).toBeGreaterThanOrEqual(2);
    } finally {
      crypto.getRandomValues = real;
    }
  });

  it("surfaces P2002 when the operator-provided value is taken (no retry)", async () => {
    // Manual value collisions are NOT retried — re-minting would
    // silently swap the operator's input, which is wrong.
    const { db } = makeFakeDb();
    await createIdToken(db, {
      userId: "user-1",
      kind: "rfid",
      value: "CAFEBABE",
    });
    await expect(
      createIdToken(db, {
        userId: "user-2",
        kind: "rfid",
        value: "CAFEBABE",
      }),
    ).rejects.toThrow(/Unique constraint/);
  });
});

describe("backfillPrimaryRfidForUsersWithoutTokens", () => {
  function makeBackfillDb(state: {
    users: Array<{ id: string; email: string; createdAt: Date }>;
    initialTokens: StoredRow[];
  }) {
    const tokens = [...state.initialTokens];
    let nextId = tokens.length + 1;
    return {
      tokens,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      db: {
        user: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          findMany: async ({ where }: any) => {
            // Mirror the `idTokens: { none: {} }` filter: return only
            // users with zero token rows. Other where clauses ignored.
            const wantsNoTokens =
              where?.idTokens?.none !== undefined;
            return state.users
              .filter((u) =>
                wantsNoTokens
                  ? !tokens.some((t) => t.userId === u.id)
                  : true,
              )
              .sort(
                (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
              )
              .map((u) => ({ id: u.id, email: u.email }));
          },
        },
        idToken: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          create: async ({ data }: any) => {
            if (tokens.some((t) => t.value === data.value)) {
              throw new Error(
                "Unique constraint failed on the fields: (`value`)",
              );
            }
            const now = new Date();
            const row: StoredRow = {
              id: `bk-${nextId++}`,
              userId: data.userId,
              kind: data.kind,
              value: data.value,
              vendorIssuedBy: null,
              vendorTokenId: null,
              label: data.label ?? null,
              status: "active",
              expiresAt: null,
              lastUsedAt: null,
              scopeInstallationId: null,
              createdAt: now,
              updatedAt: now,
            };
            tokens.push(row);
            return row;
          },
        },
      } as unknown as PrismaClient,
    };
  }

  it("mints one primary RFID per user with zero tokens; skips users who already have at least one", async () => {
    const t0 = new Date("2026-01-01");
    const t1 = new Date("2026-02-01");
    const t2 = new Date("2026-03-01");
    const { db, tokens } = makeBackfillDb({
      users: [
        { id: "u-1", email: "anna@x.is", createdAt: t0 },
        { id: "u-2", email: "bjorn@x.is", createdAt: t1 },
        { id: "u-3", email: "doddi@x.is", createdAt: t2 },
      ],
      initialTokens: [
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
    expect(tokens.length).toBe(3);
    // Newly-minted tokens carry the backfill label.
    const minted = tokens.filter((t) => t.label === "Primary (backfill)");
    expect(minted.map((m) => m.userId).sort()).toEqual(["u-1", "u-3"]);
  });

  it("re-running is idempotent (no users left to mint for)", async () => {
    const { db } = makeBackfillDb({
      users: [{ id: "u-1", email: "x@y.is", createdAt: new Date() }],
      initialTokens: [
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
    // Pre-load a token whose value happens to be the FIRST value
    // mintRfidValue produces under our patched RNG, so the new-mint
    // call collides 5 times in a row → throws → captured as error,
    // backfill continues with the next user (whose RNG state advances).
    const fixedBytes = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    const real = crypto.getRandomValues;
    crypto.getRandomValues = ((arr: Uint8Array) => {
      arr.set(fixedBytes);
      return arr;
    }) as typeof crypto.getRandomValues;
    try {
      const { db } = makeBackfillDb({
        users: [
          { id: "u-1", email: "alice@x.is", createdAt: new Date(0) },
          { id: "u-2", email: "bob@x.is", createdAt: new Date(1) },
        ],
        // Pre-existing token under user-other with the same UID the
        // mint will produce — every retry collides.
        initialTokens: [
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
      const report =
        await backfillPrimaryRfidForUsersWithoutTokens(db);
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
