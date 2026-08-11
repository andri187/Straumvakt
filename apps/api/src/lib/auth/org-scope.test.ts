// Row-level tenant scope.
//
// requirePermission answers "may you call this verb". orgInScope answers
// "which tenants' rows may come back". The census found those two conflated on
// 33 of the 41 billing.* gates: an omitted orgIdParam makes requirePermission
// resolve orgId to null and skip the membership lookup entirely, so the verb is
// satisfiable only by a platform grant — and then the row layer applies no
// filter at all.
//
// This file covers the predicate itself and the decision table around it. The
// async resolveOrgScope needs a database and belongs in test/parity; the
// predicate does not, and it is the half that actually gates a row.

import { describe, expect, it } from "vitest";
import { orgInScope, type OrgScope } from "./org-scope";

const ORG_A = "3f8a1c2e-4b5d-4e6f-8a9b-0c1d2e3f4a5b";
const ORG_B = "9e8d7c6b-5a4f-4e3d-8c2b-1a0f9e8d7c6b";
const ORG_C = "5c4d3e2f-1a0b-4c9d-8e7f-6a5b4c3d2e1f";

describe("orgInScope", () => {
  it("lets a platform-wide scope see any org", () => {
    const all: OrgScope = { all: true };
    for (const org of [ORG_A, ORG_B, ORG_C]) expect(orgInScope(all, org)).toBe(true);
  });

  it("lets a member see their own org", () => {
    expect(orgInScope({ all: false, orgIds: [ORG_A] }, ORG_A)).toBe(true);
  });

  it("REFUSES a member another org's row", () => {
    expect(orgInScope({ all: false, orgIds: [ORG_A] }, ORG_B)).toBe(false);
  });

  it("handles a member of several orgs", () => {
    const s: OrgScope = { all: false, orgIds: [ORG_A, ORG_B] };
    expect(orgInScope(s, ORG_A)).toBe(true);
    expect(orgInScope(s, ORG_B)).toBe(true);
    expect(orgInScope(s, ORG_C)).toBe(false);
  });

  it("DENIES everything for an unknown caller", () => {
    // resolveOrgScope returns this for a session with no userId. Deny-all is
    // the only safe default: an empty list must not read as "no filter".
    const none: OrgScope = { all: false, orgIds: [] };
    for (const org of [ORG_A, ORG_B, ORG_C]) expect(orgInScope(none, org)).toBe(false);
  });

  it("does not match on a prefix or a case fold", () => {
    expect(orgInScope({ all: false, orgIds: [ORG_A] }, ORG_A.slice(0, 8))).toBe(false);
    expect(orgInScope({ all: false, orgIds: [ORG_A] }, ORG_A.toUpperCase())).toBe(false);
  });

  it("an empty orgIds list with all:true is still all — the flag decides, not the list", () => {
    expect(orgInScope({ all: true }, ORG_A)).toBe(true);
  });
});

describe("the decision the by-id session routes now make", () => {
  // GET /api/admin/billing/sessions/:id and /:id/full previously returned
  // findUnique({ where: { id } }) for ANY tenant's session, with the /full
  // variant additionally serving raw OCMF/723 blobs on ?include=raw. The
  // repository header says "no auth scoping here — caller (the route) checks
  // permission"; the route checked the verb and not the row. Each side
  // documented the other as the enforcement point.
  //
  // These cases pin the table the route now implements. They exercise the
  // predicate rather than the handler because the handler needs an Env, a
  // session cookie and a Prisma client — but the predicate IS the decision,
  // and getting it wrong is what the last four years of this bug looked like.
  const decide = (scope: OrgScope, rowOrgId: string) =>
    orgInScope(scope, rowOrgId) ? "200" : "404";

  it("platform staff keep reading every tenant — no live workflow moves", () => {
    expect(decide({ all: true }, ORG_B)).toBe("200");
  });

  it("an org member reading their own session gets it", () => {
    expect(decide({ all: false, orgIds: [ORG_A] }, ORG_A)).toBe("200");
  });

  it("an org member reading ANOTHER tenant's session gets 404, not 403", () => {
    // 403 would confirm that the session id exists. 404 is the same answer a
    // made-up id gets, which is the point.
    expect(decide({ all: false, orgIds: [ORG_A] }, ORG_B)).toBe("404");
  });

  it("a caller with no memberships gets 404 for everything", () => {
    expect(decide({ all: false, orgIds: [] }, ORG_A)).toBe("404");
  });
});
