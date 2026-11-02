// The real Drizzle adapter, with its external dependencies replaced.
//
// Issuance is unfinished: no statement writer or renderer exists. The number
// store commits an allocation in its own transaction, so an adapter that
// allocates and then refuses leaves a number marked issued for a document that
// was never written. These tests pin that the adapter refuses first.

import { beforeEach, describe, expect, it, vi } from "vitest";

const spies = vi.hoisted(() => ({
  allocate: vi.fn(),
  makeNumberStore: vi.fn(),
  dbCall: vi.fn(),
}));

vi.mock("../drizzle", () => ({
  makeDrizzle: () =>
    new Proxy(
      {},
      {
        get: (_t, prop) => {
          spies.dbCall(String(prop));
          throw new Error(`database touched: ${String(prop)}`);
        },
      },
    ),
}));

vi.mock("./number-store", () => ({
  makeDrizzleNumberStore: (...args: unknown[]) => {
    spies.makeNumberStore(...args);
    return { allocate: spies.allocate };
  },
}));

import { makeDrizzleOperationsPort } from "./drizzle-operations-port";
import { ISSUANCE_NOT_IMPLEMENTED } from "./operations-port";
import type { Env } from "../../bindings";

const ORG = "11111111-1111-1111-1111-111111111111";
const ACTOR = "user-0000-0000-0000-000000000001";
const PERIOD = { orgId: ORG, year: 2026, month: 3 };

function port(restrictToOrgIds: string[] | null = null) {
  return makeDrizzleOperationsPort({} as Env, { restrictToOrgIds });
}

beforeEach(() => {
  vi.clearAllMocks();
  spies.allocate.mockResolvedValue({
    kind: "allocated",
    documentNumber: "SV-2026-000001",
    ordinal: 1,
  });
});

describe("makeDrizzleOperationsPort().issueDocument", () => {
  it("refuses with a stable reason and allocates nothing", async () => {
    const out = await port().issueDocument({
      period: PERIOD,
      idempotencyKey: "key-1",
      actorUserId: ACTOR,
    });

    expect(out).toEqual({ kind: "refused", reason: ISSUANCE_NOT_IMPLEMENTED });
    expect(ISSUANCE_NOT_IMPLEMENTED).toBe("invoice_issuance_not_implemented");
    expect(spies.makeNumberStore).not.toHaveBeenCalled();
    expect(spies.allocate).not.toHaveBeenCalled();
    expect(spies.dbCall).not.toHaveBeenCalled();
  });

  it("refuses the same way for the same key, a different key and a scoped caller", async () => {
    const p = port([ORG]);
    for (const idempotencyKey of ["key-1", "key-1", "key-2"]) {
      const out = await p.issueDocument({ period: PERIOD, idempotencyKey, actorUserId: ACTOR });
      expect(out, idempotencyKey).toEqual({ kind: "refused", reason: ISSUANCE_NOT_IMPLEMENTED });
    }
    expect(spies.makeNumberStore).not.toHaveBeenCalled();
    expect(spies.allocate).not.toHaveBeenCalled();
    expect(spies.dbCall).not.toHaveBeenCalled();
  });

  it("does not claim a document exists afterwards", async () => {
    const p = port();
    await p.issueDocument({ period: PERIOD, idempotencyKey: "key-1", actorUserId: ACTOR });
    expect(await p.fetchDocument(PERIOD)).toBeNull();
  });
});
