// Verdict matrix for the OCPP authorize lookup. The resolver is the
// load-bearing function; the Hono surface is thin (header gate + JSON
// validation), so most tests drive the resolver directly with a
// hand-rolled PrismaLike mock.

import { describe, expect, it } from "vitest";
import { resolveAuthorize, type PrismaLike } from "./ocpp-authorize";

interface TokenRow {
  id: string;
  userId: string;
  status: string;
  expiresAt: Date | null;
  scopeInstallationId: string | null;
}

interface IdentityRow {
  chargingStation: { installationId: string | null } | null;
}

function makeDb({
  token = null,
  identity = null,
}: {
  token?: TokenRow | null;
  identity?: IdentityRow | null;
} = {}): PrismaLike {
  return {
    idToken: {
      findUnique: async () => token,
    },
    ocppIdentity: {
      findUnique: async () => identity,
    },
  };
}

const INPUT = {
  idTag: "DEAD-BEEF",
  identityId: "11111111-1111-1111-1111-111111111111",
  orgId: "22222222-2222-2222-2222-222222222222",
};

describe("resolveAuthorize", () => {
  it("returns Invalid/unknown_id_tag when token row is missing", async () => {
    const result = await resolveAuthorize(makeDb(), INPUT);
    expect(result).toEqual({ verdict: "Invalid", reason: "unknown_id_tag" });
  });

  it("returns Accepted with userId for an active unscoped token", async () => {
    const db = makeDb({
      token: {
        id: "token-1",
        userId: "user-1",
        status: "active",
        expiresAt: null,
        scopeInstallationId: null,
      },
    });
    const result = await resolveAuthorize(db, INPUT);
    expect(result).toEqual({
      verdict: "Accepted",
      reason: "ok",
      userId: "user-1",
      idTokenId: "token-1",
    });
  });

  it("returns Blocked/revoked for a revoked token", async () => {
    const db = makeDb({
      token: {
        id: "token-2",
        userId: "user-1",
        status: "revoked",
        expiresAt: null,
        scopeInstallationId: null,
      },
    });
    const result = await resolveAuthorize(db, INPUT);
    expect(result).toEqual({
      verdict: "Blocked",
      reason: "revoked",
      idTokenId: "token-2",
    });
  });

  it("returns Expired/expired_status for a status='expired' row", async () => {
    const db = makeDb({
      token: {
        id: "token-3",
        userId: "user-1",
        status: "expired",
        expiresAt: null,
        scopeInstallationId: null,
      },
    });
    const result = await resolveAuthorize(db, INPUT);
    expect(result).toEqual({
      verdict: "Expired",
      reason: "expired_status",
      idTokenId: "token-3",
    });
  });

  it("returns Invalid/conflict for a duplicated-token-claim row", async () => {
    const db = makeDb({
      token: {
        id: "token-4",
        userId: "user-1",
        status: "conflict",
        expiresAt: null,
        scopeInstallationId: null,
      },
    });
    const result = await resolveAuthorize(db, INPUT);
    expect(result).toEqual({
      verdict: "Invalid",
      reason: "conflict",
      idTokenId: "token-4",
    });
  });

  it("returns Invalid/pending for a not-yet-claimed row", async () => {
    const db = makeDb({
      token: {
        id: "token-5",
        userId: "user-1",
        status: "pending",
        expiresAt: null,
        scopeInstallationId: null,
      },
    });
    const result = await resolveAuthorize(db, INPUT);
    expect(result).toEqual({
      verdict: "Invalid",
      reason: "pending",
      idTokenId: "token-5",
    });
  });

  it("returns Expired/expiry_passed for an active token whose expiresAt is past", async () => {
    const db = makeDb({
      token: {
        id: "token-6",
        userId: "user-1",
        status: "active",
        expiresAt: new Date(Date.now() - 60_000),
        scopeInstallationId: null,
      },
    });
    const result = await resolveAuthorize(db, INPUT);
    expect(result).toEqual({
      verdict: "Expired",
      reason: "expiry_passed",
      idTokenId: "token-6",
    });
  });

  it("returns Accepted for an active token whose expiresAt is future", async () => {
    const db = makeDb({
      token: {
        id: "token-7",
        userId: "user-1",
        status: "active",
        expiresAt: new Date(Date.now() + 60_000),
        scopeInstallationId: null,
      },
    });
    const result = await resolveAuthorize(db, INPUT);
    expect(result.verdict).toBe("Accepted");
    expect(result.userId).toBe("user-1");
  });

  it("returns Accepted when scopeInstallationId matches the identity's installation", async () => {
    const db = makeDb({
      token: {
        id: "token-8",
        userId: "user-1",
        status: "active",
        expiresAt: null,
        scopeInstallationId: "inst-A",
      },
      identity: { chargingStation: { installationId: "inst-A" } },
    });
    const result = await resolveAuthorize(db, INPUT);
    expect(result.verdict).toBe("Accepted");
    expect(result.userId).toBe("user-1");
  });

  it("returns Invalid/scope_mismatch when scope is set but identity is at a different installation", async () => {
    const db = makeDb({
      token: {
        id: "token-9",
        userId: "user-1",
        status: "active",
        expiresAt: null,
        scopeInstallationId: "inst-A",
      },
      identity: { chargingStation: { installationId: "inst-B" } },
    });
    const result = await resolveAuthorize(db, INPUT);
    expect(result).toEqual({
      verdict: "Invalid",
      reason: "scope_mismatch",
      idTokenId: "token-9",
    });
  });

  it("returns Invalid/scope_mismatch when scope is set but the identity has no installation", async () => {
    const db = makeDb({
      token: {
        id: "token-10",
        userId: "user-1",
        status: "active",
        expiresAt: null,
        scopeInstallationId: "inst-A",
      },
      identity: { chargingStation: { installationId: null } },
    });
    const result = await resolveAuthorize(db, INPUT);
    expect(result.verdict).toBe("Invalid");
    expect(result.reason).toBe("scope_mismatch");
  });

  it("returns Invalid/scope_mismatch when scope is set but the identity isn't found at all", async () => {
    // Defensive — orphaned ocpp_identity row would be a data bug, but
    // the resolver shouldn't accept on inability to verify scope.
    const db = makeDb({
      token: {
        id: "token-11",
        userId: "user-1",
        status: "active",
        expiresAt: null,
        scopeInstallationId: "inst-A",
      },
      identity: null,
    });
    const result = await resolveAuthorize(db, INPUT);
    expect(result.verdict).toBe("Invalid");
    expect(result.reason).toBe("scope_mismatch");
  });

  it("does not look up the identity when the token has no scope", async () => {
    let identityCalls = 0;
    const db: PrismaLike = {
      idToken: {
        findUnique: async () => ({
          id: "token-12",
          userId: "user-1",
          status: "active",
          expiresAt: null,
          scopeInstallationId: null,
        }),
      },
      ocppIdentity: {
        findUnique: async () => {
          identityCalls += 1;
          return null;
        },
      },
    };
    const result = await resolveAuthorize(db, INPUT);
    expect(result.verdict).toBe("Accepted");
    expect(identityCalls).toBe(0);
  });

  it("returns Invalid/unknown_status for a status the resolver doesn't recognise", async () => {
    // Defensive — IdTokenStatus is closed today but Prisma may add
    // values; default-deny on unknown.
    const db = makeDb({
      token: {
        id: "token-13",
        userId: "user-1",
        status: "fictional_future_state",
        expiresAt: null,
        scopeInstallationId: null,
      },
    });
    const result = await resolveAuthorize(db, INPUT);
    expect(result).toEqual({
      verdict: "Invalid",
      reason: "unknown_status",
      idTokenId: "token-13",
    });
  });
});
