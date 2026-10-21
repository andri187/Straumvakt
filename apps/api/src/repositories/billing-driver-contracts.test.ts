// The driver-contracts view was confined by a QUERY PARAMETER.
//
// `?orgId=` was the only tenancy term, and it is supplied by the caller. A
// caller-supplied filter is not a tenancy control: it confines the query only
// for callers who choose to send it, which is exactly the set of callers who
// were not the threat. Omitting it returned every tenant's driver
// memberships — rows carrying `email`, `displayName` and `phone`.
//
// What is pinned here is the predicate `ownerOrgWhere` builds, because that is
// what changed. The route's half — 403 rather than a quiet narrowing — is
// `decideLedgerAccess`, which already has its own tests in ledger-scope.test.ts
// and is reused here rather than reimplemented.

import { describe, expect, it } from "vitest";
import { ownerOrgWhere } from "./billing-driver-contracts";

describe("ownerOrgWhere — the shared predicate", () => {
  it("confines to the caller's orgs when no org is requested", () => {
    expect(ownerOrgWhere(["org-a", "org-b"], null)).toEqual({
      driverGroup: { ownerOrgId: { in: ["org-a", "org-b"] } },
    });
  });

  it("NARROWS to a requested org, and never widens past the allow-list", () => {
    // The requested org has already been validated by the route. Intersecting
    // rather than replacing means a bug there cannot widen the answer here.
    expect(ownerOrgWhere(["org-a", "org-b"], "org-a")).toEqual({
      driverGroup: { ownerOrgId: { in: ["org-a"] } },
    });
    // An org outside the allow-list intersects to nothing rather than to
    // itself. Defence in depth: the route returns 403 before this is reached.
    expect(ownerOrgWhere(["org-a"], "org-elsewhere")).toEqual({
      driverGroup: { ownerOrgId: { in: [] } },
    });
  });

  it("an EMPTY allow-list matches nothing, and does not fall into `{}`", () => {
    // `{}` means everything. This is the case `resolveOrgScope` produces for a
    // caller with no memberships, and it is the one the old code turned into
    // the whole table.
    expect(ownerOrgWhere([], null)).toEqual({ driverGroup: { ownerOrgId: { in: [] } } });
    expect(ownerOrgWhere([], "org-a")).toEqual({ driverGroup: { ownerOrgId: { in: [] } } });
  });

  it("platform scope with no requested org adds NO term — unchanged behaviour", () => {
    expect(ownerOrgWhere(null, null)).toEqual({});
  });

  it("platform scope WITH a requested org filters to it", () => {
    // Platform staff asking about one tenant get that tenant, which is what
    // the query parameter was always for.
    expect(ownerOrgWhere(null, "org-a")).toEqual({
      driverGroup: { ownerOrgId: "org-a" },
    });
  });

  it("the empty allow-list and platform scope are NOT the same value", () => {
    // The bug this whole fix is about, stated as an assertion: `[]` and `null`
    // both look falsy and mean opposite things.
    expect(ownerOrgWhere([], null)).not.toEqual(ownerOrgWhere(null, null));
  });
});
