// Verdict matrix for the OCPP authorize lookup. The resolver is the
// load-bearing function; the Hono surface is thin (header gate + JSON
// validation), so most tests drive the resolver directly with a
// hand-rolled PrismaLike mock.
//
// Every result includes the per-installation `enforceAuthorize` flag
// (Sprint 4 4.6) — defaults to false when the identity / installation
// chain is missing, true only when the operator has flipped the flag.

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
  chargingStation: {
    installationId: string | null;
    installation: { enforceAuthorize: boolean } | null;
  } | null;
}

type MembershipRow = {
  id: string;
  driverGroup: { agreementId: string };
};

function makeDb({
  token = null,
  identity = null,
  membership = {
    id: "membership-default",
    driverGroup: { agreementId: "agr-default" },
  },
  /** Number of AgreementClause rows the resolver will see for the
   *  membership's agreement. Default = 1 so existing A.11 tests still
   *  pass the clause-count gate (GAP-2). Set to 0 to simulate the
   *  empty-stub agreement. */
  clauseCount = 1,
}: {
  token?: TokenRow | null;
  identity?: IdentityRow | null;
  /** Membership row returned by driverGroupMembership.findFirst.
   *  Default is a non-null stub so existing tests pass agreement check
   *  without explicit setup. Pass `null` to simulate no_contract. */
  membership?: MembershipRow | null;
  clauseCount?: number;
} = {}): PrismaLike {
  return {
    idToken: {
      findUnique: async () => token,
    },
    ocppIdentity: {
      findUnique: async () => identity,
    },
    driverGroupMembership: {
      findFirst: async () => membership,
    },
    agreementClause: {
      count: async () => clauseCount,
    },
  };
}

/** Convenience for tests: build an identity row with the given
 *  installationId + enforce flag (defaults closed). */
function id(
  installationId: string | null,
  enforceAuthorize = false,
): IdentityRow {
  return {
    chargingStation: {
      installationId,
      installation: installationId ? { enforceAuthorize } : null,
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
    expect(result).toEqual({
      verdict: "Invalid",
      reason: "unknown_id_tag",
      enforceAuthorize: false,
    });
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
      enforceAuthorize: false,
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
      enforceAuthorize: false,
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
      enforceAuthorize: false,
    });
  });

  it("returns Blocked/suspended for a temporarily-suspended token", async () => {
    const db = makeDb({
      token: {
        id: "token-4",
        userId: "user-1",
        status: "suspended",
        expiresAt: null,
        scopeInstallationId: null,
      },
    });
    const result = await resolveAuthorize(db, INPUT);
    expect(result).toEqual({
      verdict: "Blocked",
      reason: "suspended",
      idTokenId: "token-4",
      enforceAuthorize: false,
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
      enforceAuthorize: false,
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
      identity: id("inst-A"),
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
      identity: id("inst-B"),
    });
    const result = await resolveAuthorize(db, INPUT);
    expect(result).toEqual({
      verdict: "Invalid",
      reason: "scope_mismatch",
      idTokenId: "token-9",
      enforceAuthorize: false,
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
      identity: id(null),
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
      enforceAuthorize: false,
    });
  });
});

describe("resolveAuthorize — enforceAuthorize flag", () => {
  it("returns enforceAuthorize:true when the installation has the flag set", async () => {
    const db = makeDb({
      token: {
        id: "token-e1",
        userId: "user-1",
        status: "active",
        expiresAt: null,
        scopeInstallationId: null,
      },
      identity: id("inst-PROD", true),
    });
    const result = await resolveAuthorize(db, INPUT);
    expect(result.verdict).toBe("Accepted");
    expect(result.enforceAuthorize).toBe(true);
  });

  it("returns enforceAuthorize:false when identity has no installation chain", async () => {
    const db = makeDb({
      token: {
        id: "token-e2",
        userId: "user-1",
        status: "active",
        expiresAt: null,
        scopeInstallationId: null,
      },
      identity: null,
    });
    const result = await resolveAuthorize(db, INPUT);
    expect(result.enforceAuthorize).toBe(false);
  });

  it("returns enforceAuthorize:true even on a denied verdict (gateway needs flag for every reply)", async () => {
    const db = makeDb({
      token: {
        id: "token-e3",
        userId: "user-1",
        status: "revoked",
        expiresAt: null,
        scopeInstallationId: null,
      },
      identity: id("inst-PROD", true),
    });
    const result = await resolveAuthorize(db, INPUT);
    expect(result.verdict).toBe("Blocked");
    expect(result.enforceAuthorize).toBe(true);
  });

  it("returns enforceAuthorize:true for unknown_id_tag verdicts when the identity's installation enforces", async () => {
    const db = makeDb({
      // No token row at all — unknown idTag
      identity: id("inst-PROD", true),
    });
    const result = await resolveAuthorize(db, INPUT);
    expect(result.verdict).toBe("Invalid");
    expect(result.reason).toBe("unknown_id_tag");
    expect(result.enforceAuthorize).toBe(true);
  });
});

// ADR 0019 milestone A.11 — agreement-membership gate at OCPP Authorize.
//
// Gated by the per-installation `enforceAuthorize` flag. While the flag
// is OFF (the default at every installation until an operator flips it),
// the resolver does not compute any denial for missing membership —
// existing behaviour is preserved. When the flag is ON, missing
// membership produces Blocked/no_contract.
describe("resolveAuthorize — agreement membership (A.11)", () => {
  // (1) Flag OFF (default) → Authorize succeeds for a token with no
  // membership at this installation. Existing behaviour preserved.
  it("flag OFF: returns Accepted even when membership is missing (existing behaviour preserved)", async () => {
    const db = makeDb({
      token: {
        id: "token-c1",
        userId: "user-1",
        status: "active",
        expiresAt: null,
        scopeInstallationId: null,
      },
      identity: id("inst-PROD", false),
      membership: null,
    });
    const result = await resolveAuthorize(db, INPUT);
    expect(result).toEqual({
      verdict: "Accepted",
      reason: "ok",
      userId: "user-1",
      idTokenId: "token-c1",
      enforceAuthorize: false,
    });
  });

  // (2) Flag ON, membership present → Authorize succeeds.
  it("flag ON: returns Accepted when a matching DriverGroupMembership exists", async () => {
    const db = makeDb({
      token: {
        id: "token-c2",
        userId: "user-1",
        status: "active",
        expiresAt: null,
        scopeInstallationId: null,
      },
      identity: id("inst-PROD", true),
      membership: { id: "m-1", driverGroup: { agreementId: "agr-1" } },
    });
    const result = await resolveAuthorize(db, INPUT);
    expect(result.verdict).toBe("Accepted");
    expect(result.reason).toBe("ok");
    expect(result.userId).toBe("user-1");
    expect(result.enforceAuthorize).toBe(true);
  });

  // (3) Flag ON, membership missing → Authorize returns Blocked /
  // no_contract. Wire-level still Blocked; no_contract is metadata.
  it("flag ON: returns Blocked/no_contract when membership is missing at this installation", async () => {
    const db = makeDb({
      token: {
        id: "token-c3",
        userId: "user-1",
        status: "active",
        expiresAt: null,
        scopeInstallationId: null,
      },
      identity: id("inst-PROD", true),
      membership: null,
    });
    const result = await resolveAuthorize(db, INPUT);
    expect(result).toEqual({
      verdict: "Blocked",
      reason: "no_contract",
      idTokenId: "token-c3",
      enforceAuthorize: true,
    });
  });

  // (4) Flag ON, membership exists but for a different installation →
  // findFirst (scoped by installationId in WHERE) returns null →
  // Blocked/no_contract. Simulated by passing membership=null while the
  // charger's installation is inst-PROD.
  it("flag ON: returns Blocked/no_contract when membership matches a different installation", async () => {
    // Driver has a DriverGroupMembership but it's anchored under an
    // Agreement at inst-OTHER, not inst-PROD where this charger lives.
    // The Prisma where-clause filters by installationId, so findFirst
    // returns null — same outcome as no membership at all.
    const db = makeDb({
      token: {
        id: "token-c4",
        userId: "user-1",
        status: "active",
        expiresAt: null,
        scopeInstallationId: null,
      },
      identity: id("inst-PROD", true),
      membership: null,
    });
    const result = await resolveAuthorize(db, INPUT);
    expect(result.verdict).toBe("Blocked");
    expect(result.reason).toBe("no_contract");
    expect(result.enforceAuthorize).toBe(true);
  });

  // (5) Token unknown → still Blocked path (Invalid/unknown_id_tag) and
  // the membership check is never reached. Existing behaviour preserved.
  it("flag ON: unknown token short-circuits before membership check", async () => {
    let membershipCalls = 0;
    const baseDb = makeDb({
      // No token row at all
      identity: id("inst-PROD", true),
    });
    const db: PrismaLike = {
      ...baseDb,
      driverGroupMembership: {
        findFirst: async () => {
          membershipCalls += 1;
          return null;
        },
      },
    };
    const result = await resolveAuthorize(db, INPUT);
    expect(result.verdict).toBe("Invalid");
    expect(result.reason).toBe("unknown_id_tag");
    expect(result.enforceAuthorize).toBe(true);
    expect(membershipCalls).toBe(0);
  });

  // Defence-in-depth — identity has no installation chain (orphan).
  // The membership check can't anchor to an installationId, so the
  // resolver preserves Accept. enforceAuthorize remains false because
  // the identity has no Installation row to read the flag from.
  it("does NOT enforce membership when the identity has no installation chain", async () => {
    const db = makeDb({
      token: {
        id: "token-c6",
        userId: "user-1",
        status: "active",
        expiresAt: null,
        scopeInstallationId: null,
      },
      identity: null,
      membership: null,
    });
    const result = await resolveAuthorize(db, INPUT);
    expect(result.verdict).toBe("Accepted");
    expect(result.enforceAuthorize).toBe(false);
  });
});

// GAP-2 — strengthen A.11 with a clause-count gate. A driver with an
// active DriverGroupMembership under an active installation-Agreement
// would historically have Accepted, even when the parent Agreement
// carried zero billable clauses. That empty-stub case still produces a
// successful charge but no billing_lines at session-stop → silent
// zero-cost invoice. Block Authorize at the gate with the metadata
// reason `no_billable_clauses` (wire-level still Blocked).
describe("resolveAuthorize — agreement clause-count gate (GAP-2)", () => {
  // Flag ON, membership present, agreement has clauses → Accepted.
  // (Same as A.11 case (2), repeated here for explicitness in case the
  // existing helper defaults shift.)
  it("flag ON: returns Accepted when membership exists and agreement has clauses", async () => {
    const db = makeDb({
      token: {
        id: "token-g1",
        userId: "user-1",
        status: "active",
        expiresAt: null,
        scopeInstallationId: null,
      },
      identity: id("inst-PROD", true),
      membership: { id: "m-g1", driverGroup: { agreementId: "agr-g1" } },
      clauseCount: 3,
    });
    const result = await resolveAuthorize(db, INPUT);
    expect(result.verdict).toBe("Accepted");
    expect(result.reason).toBe("ok");
    expect(result.userId).toBe("user-1");
    expect(result.enforceAuthorize).toBe(true);
  });

  // Flag ON, membership present, agreement has ZERO clauses (empty stub)
  // → Blocked / no_billable_clauses. Wire-level remains Blocked; the
  // metadata reason distinguishes empty-stub from missing-contract for
  // operator triage.
  it("flag ON: returns Blocked/no_billable_clauses when membership exists but the agreement has zero clauses", async () => {
    const db = makeDb({
      token: {
        id: "token-g2",
        userId: "user-1",
        status: "active",
        expiresAt: null,
        scopeInstallationId: null,
      },
      identity: id("inst-PROD", true),
      membership: { id: "m-g2", driverGroup: { agreementId: "agr-empty-stub" } },
      clauseCount: 0,
    });
    const result = await resolveAuthorize(db, INPUT);
    expect(result).toEqual({
      verdict: "Blocked",
      reason: "no_billable_clauses",
      idTokenId: "token-g2",
      enforceAuthorize: true,
    });
  });

  // Flag ON, NO membership at all → still no_contract (clause-count gate
  // is never reached). The clause count would also be 0 in this case but
  // the resolver must short-circuit on missing membership first so the
  // metadata reason stays meaningful for operator triage.
  it("flag ON: missing membership still returns no_contract (not no_billable_clauses) regardless of clause count", async () => {
    const db = makeDb({
      token: {
        id: "token-g3",
        userId: "user-1",
        status: "active",
        expiresAt: null,
        scopeInstallationId: null,
      },
      identity: id("inst-PROD", true),
      membership: null,
      clauseCount: 0,
    });
    const result = await resolveAuthorize(db, INPUT);
    expect(result.verdict).toBe("Blocked");
    expect(result.reason).toBe("no_contract");
  });

  // Flag OFF — clause-count gate must not fire even when the agreement
  // would have failed it. Default behaviour preserved at every
  // installation that hasn't opted in.
  it("flag OFF: returns Accepted even when the agreement has zero clauses (default behaviour preserved)", async () => {
    const db = makeDb({
      token: {
        id: "token-g4",
        userId: "user-1",
        status: "active",
        expiresAt: null,
        scopeInstallationId: null,
      },
      identity: id("inst-PROD", false),
      membership: { id: "m-g4", driverGroup: { agreementId: "agr-empty-stub" } },
      clauseCount: 0,
    });
    const result = await resolveAuthorize(db, INPUT);
    expect(result.verdict).toBe("Accepted");
    expect(result.reason).toBe("ok");
    expect(result.enforceAuthorize).toBe(false);
  });

  // Defence-in-depth — the clause-count query must not fire when the
  // membership check itself returns null. (Prevents wasted DB roundtrips
  // and keeps the no_contract reason from being shadowed.)
  it("flag ON: agreementClause.count is never called when membership is missing", async () => {
    let clauseCalls = 0;
    const baseDb = makeDb({
      token: {
        id: "token-g5",
        userId: "user-1",
        status: "active",
        expiresAt: null,
        scopeInstallationId: null,
      },
      identity: id("inst-PROD", true),
      membership: null,
    });
    const db: PrismaLike = {
      ...baseDb,
      agreementClause: {
        count: async () => {
          clauseCalls += 1;
          return 0;
        },
      },
    };
    const result = await resolveAuthorize(db, INPUT);
    expect(result.verdict).toBe("Blocked");
    expect(result.reason).toBe("no_contract");
    expect(clauseCalls).toBe(0);
  });
});
