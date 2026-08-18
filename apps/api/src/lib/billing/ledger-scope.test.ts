// Who may read which ledger rows, pinned.
//
// The case that matters most is the first one: before 2026-08-18, an org
// member with billing.read who called GET /api/admin/billing/sessions with no
// query string received `{ kind: "admin" }` and therefore every tenant's
// billing ledger.

import { describe, expect, it } from "vitest";
import { decideLedgerAccess } from "./ledger-scope";

import type { OrgScope } from "../auth/org-scope";

const PLATFORM: OrgScope = { all: true };
const MEMBER_OF_A: OrgScope = { all: false, orgIds: ["org-A"] };
const MEMBER_OF_A_AND_B: OrgScope = { all: false, orgIds: ["org-A", "org-B"] };
const MEMBER_OF_NOTHING: OrgScope = { all: false, orgIds: [] };

describe("decideLedgerAccess", () => {
  it("confines an org member who asks for everything to their own orgs", () => {
    // THE regression. An empty query string used to mean "no filter".
    const d = decideLedgerAccess({}, MEMBER_OF_A);
    expect(d).toEqual({
      kind: "allow",
      access: { scope: { kind: "admin" }, restrictToOrgIds: ["org-A"] },
    });
  });

  it("leaves platform staff exactly as they were", () => {
    // resolveOrgScope returns { all: true } for a bootstrap session and for a
    // platform.tenant.read grant. No live operator workflow moves.
    expect(decideLedgerAccess({}, PLATFORM)).toEqual({
      kind: "allow",
      access: { scope: { kind: "admin" }, restrictToOrgIds: null },
    });
    expect(decideLedgerAccess({ orgId: "org-ANY" }, PLATFORM)).toEqual({
      kind: "allow",
      access: { scope: { kind: "org", orgId: "org-ANY" }, restrictToOrgIds: null },
    });
  });

  it("denies a member who names an org they do not belong to", () => {
    // Naming someone else's org is a different act from omitting the
    // parameter, and gets its own answer rather than being quietly narrowed.
    expect(decideLedgerAccess({ orgId: "org-OTHER" }, MEMBER_OF_A)).toEqual({
      kind: "deny",
      reason: "org_not_in_scope",
    });
  });

  it("allows a member who names one of their own orgs", () => {
    expect(decideLedgerAccess({ orgId: "org-B" }, MEMBER_OF_A_AND_B)).toEqual({
      kind: "allow",
      access: { scope: { kind: "org", orgId: "org-B" }, restrictToOrgIds: ["org-A", "org-B"] },
    });
  });

  it("denies a caller with no memberships and no platform grant", () => {
    // Previously this caller received the admin scope, which is the worst
    // possible answer to "you have no tenants".
    expect(decideLedgerAccess({}, MEMBER_OF_NOTHING)).toEqual({
      kind: "deny",
      reason: "no_org_scope",
    });
  });

  it("keeps the per-charger and per-site views working, confined", () => {
    // The alternative path for the six UI surfaces that consume the ledger:
    // the requested scope survives and the confinement is applied alongside
    // it, so an org member's charger tab still answers.
    expect(decideLedgerAccess({ chargingStationId: "stn-1" }, MEMBER_OF_A)).toEqual({
      kind: "allow",
      access: {
        scope: { kind: "charger", chargingStationId: "stn-1" },
        restrictToOrgIds: ["org-A"],
      },
    });
    expect(decideLedgerAccess({ siteId: "site-1" }, MEMBER_OF_A)).toEqual({
      kind: "allow",
      access: { scope: { kind: "site", siteId: "site-1" }, restrictToOrgIds: ["org-A"] },
    });
  });

  it("confines a driver view — a driver may charge at several hosts", () => {
    // Without the confinement, `?driverUserId=` is a cross-tenant read of one
    // person's entire charging history by anyone who knows their user id.
    expect(decideLedgerAccess({ driverUserId: "user-1" }, MEMBER_OF_A)).toEqual({
      kind: "allow",
      access: {
        scope: { kind: "driver", driverUserId: "user-1" },
        restrictToOrgIds: ["org-A"],
      },
    });
  });

  it("keeps the precedence the UI relies on: driver > charger > site > org", () => {
    const d = decideLedgerAccess(
      {
        orgId: "org-A",
        siteId: "site-1",
        chargingStationId: "stn-1",
        driverUserId: "user-1",
      },
      PLATFORM,
    );
    expect(d).toEqual({
      kind: "allow",
      access: { scope: { kind: "driver", driverUserId: "user-1" }, restrictToOrgIds: null },
    });
  });

  it("never returns an unconfined access for a non-platform caller", () => {
    // The property, asserted directly rather than inferred from the cases
    // above: restrictToOrgIds === null is reachable only via { all: true }.
    const requests = [
      {},
      { orgId: "org-A" },
      { siteId: "s" },
      { chargingStationId: "c" },
      { driverUserId: "u" },
    ];
    for (const req of requests) {
      const d = decideLedgerAccess(req, MEMBER_OF_A_AND_B);
      if (d.kind === "allow") {
        expect(d.access.restrictToOrgIds).not.toBeNull();
      }
    }
  });
});
