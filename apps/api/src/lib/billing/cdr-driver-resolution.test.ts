// Cross-tenant CDR attribution, pinned.
//
// Every token value here is synthetic. No real idTag, RFID UID, e-mail or
// vendor UUID appears in this file, in a fixture, or in an assertion message.

import { describe, expect, it } from "vitest";
import {
  cdrCandidatesFromVendorFields,
  resolveCdrDriver,
  type CdrMembership,
  type CdrTokenRow,
} from "./cdr-driver-resolution";

const NOW = new Date("2026-08-18T12:00:00Z");

const ORG_HOST = "org-host-0000-0000-0000-000000000001";
const ORG_OTHER = "org-other-0000-0000-0000-00000000002";

const USER_LOCAL = "user-local-0000-0000-0000-00000001";
const USER_FOREIGN = "user-foreign-0000-0000-0000-00002";

function token(over: Partial<CdrTokenRow> = {}): CdrTokenRow {
  return {
    value: "SYNTH-TOKEN-AAAA1111",
    userId: USER_LOCAL,
    status: "active",
    expiresAt: null,
    ...over,
  };
}

const MEMBER_LOCAL: CdrMembership = { userId: USER_LOCAL, orgId: ORG_HOST };

describe("resolveCdrDriver", () => {
  it("attributes when the token is usable and its owner belongs to the charger's org", () => {
    const out = resolveCdrDriver({
      chargerOrgId: ORG_HOST,
      candidates: [{ field: "token_name", value: "SYNTH-TOKEN-AAAA1111" }],
      tokens: [token()],
      memberships: [MEMBER_LOCAL],
      now: NOW,
    });
    expect(out).toEqual({ kind: "attributed", userId: USER_LOCAL, matchedOn: "token_name" });
  });

  // ── The tenancy cases ──────────────────────────────────────────────────

  it("refuses a token whose owner is not a member of the charger's org", () => {
    // The token is real, active, and belongs to a real driver — just not one
    // this host has any relationship with. This is the case that used to bill
    // a stranger, and it needs no coincidence to happen.
    const out = resolveCdrDriver({
      chargerOrgId: ORG_HOST,
      candidates: [{ field: "token_name", value: "SYNTH-TOKEN-BBBB2222" }],
      tokens: [token({ value: "SYNTH-TOKEN-BBBB2222", userId: USER_FOREIGN })],
      memberships: [{ userId: USER_FOREIGN, orgId: ORG_OTHER }],
      now: NOW,
    });
    expect(out).toEqual({ kind: "unattributed", reason: "driver_outside_charger_org" });
  });

  it("refuses when the charger's org and the token's org disagree, even if the user has other memberships", () => {
    // The driver is a member of somewhere — just not here. A membership list
    // that is non-empty must not read as "yes".
    const out = resolveCdrDriver({
      chargerOrgId: ORG_HOST,
      candidates: [{ field: "vendor_user_id", value: "SYNTH-VENDOR-CCCC3333" }],
      tokens: [token({ value: "SYNTH-VENDOR-CCCC3333", userId: USER_FOREIGN })],
      memberships: [
        { userId: USER_FOREIGN, orgId: ORG_OTHER },
        { userId: USER_LOCAL, orgId: ORG_HOST },
      ],
      now: NOW,
    });
    expect(out).toEqual({ kind: "unattributed", reason: "driver_outside_charger_org" });
  });

  it("refuses when one token value resolves to two different users", () => {
    // identity.id_tokens.value is globally UNIQUE today, so two rows cannot
    // share a value and the 2026-08-11 census's "token collision across
    // tenants" is not currently reachable. This test models the input shape
    // anyway: the day that index is relaxed for multi-tenant token issuance,
    // the guard is already in place and this test is what proves it.
    const shared = "SYNTH-TOKEN-DDDD4444";
    const out = resolveCdrDriver({
      chargerOrgId: ORG_HOST,
      candidates: [
        { field: "token_name", value: shared },
        { field: "username", value: shared },
      ],
      tokens: [
        token({ value: shared, userId: USER_LOCAL }),
        token({ value: shared, userId: USER_FOREIGN }),
      ],
      memberships: [MEMBER_LOCAL, { userId: USER_FOREIGN, orgId: ORG_HOST }],
      now: NOW,
    });
    // Both are members of the host org here, so membership cannot save us —
    // only refusing to pick can.
    expect(out).toEqual({ kind: "unattributed", reason: "ambiguous_candidates" });
  });

  it("refuses when two different candidate fields point at two different users", () => {
    // A username that happens to equal someone else's idTag. The old
    // findFirst(value IN (...)) returned whichever row Postgres reached
    // first, so the same import could attribute differently on a re-run.
    const out = resolveCdrDriver({
      chargerOrgId: ORG_HOST,
      candidates: [
        { field: "vendor_user_id", value: "SYNTH-VENDOR-EEEE5555" },
        { field: "email", value: "SYNTH-EMAIL-FFFF6666" },
      ],
      tokens: [
        token({ value: "SYNTH-VENDOR-EEEE5555", userId: USER_LOCAL }),
        token({ value: "SYNTH-EMAIL-FFFF6666", userId: USER_FOREIGN }),
      ],
      memberships: [MEMBER_LOCAL, { userId: USER_FOREIGN, orgId: ORG_HOST }],
      now: NOW,
    });
    expect(out).toEqual({ kind: "unattributed", reason: "ambiguous_candidates" });
  });

  it("refuses an unknown token rather than falling back to any driver", () => {
    const out = resolveCdrDriver({
      chargerOrgId: ORG_HOST,
      candidates: [{ field: "token_name", value: "SYNTH-TOKEN-NOT-HELD" }],
      tokens: [],
      memberships: [MEMBER_LOCAL],
      now: NOW,
    });
    expect(out).toEqual({ kind: "unattributed", reason: "no_matching_token" });
  });

  it("refuses a revoked token even when its owner is a member", () => {
    const out = resolveCdrDriver({
      chargerOrgId: ORG_HOST,
      candidates: [{ field: "token_name", value: "SYNTH-TOKEN-AAAA1111" }],
      tokens: [token({ status: "revoked" })],
      memberships: [MEMBER_LOCAL],
      now: NOW,
    });
    expect(out).toEqual({ kind: "unattributed", reason: "token_not_usable" });
  });

  it("refuses an expired token even when its status still reads active", () => {
    // status and expires_at are independent columns and nothing keeps them in
    // step, so a token can be 'active' and long past its expiry.
    const out = resolveCdrDriver({
      chargerOrgId: ORG_HOST,
      candidates: [{ field: "token_name", value: "SYNTH-TOKEN-AAAA1111" }],
      tokens: [token({ expiresAt: new Date("2026-08-17T23:59:59Z") })],
      memberships: [MEMBER_LOCAL],
      now: NOW,
    });
    expect(out).toEqual({ kind: "unattributed", reason: "token_not_usable" });
  });

  it("treats a pre-Authorize historical CDR as unattributable, not as an error", () => {
    // ADR 0049's amendment: sessions predating Authorize carry no identifier
    // at all. They are structurally unattributable. The resolver must say so
    // with its own reason code and must not throw, so the importer records
    // them in `imported`, never in `errors`.
    const out = resolveCdrDriver({
      chargerOrgId: ORG_HOST,
      candidates: [],
      tokens: [],
      memberships: [],
      now: NOW,
    });
    expect(out).toEqual({ kind: "unattributed", reason: "no_candidates" });
  });

  it("throws when the charger's org is missing rather than matching unscoped", () => {
    // A caller that does not know which org owns the charger must not be able
    // to fall through to the old behaviour. This is the one case that fails
    // loudly: it means the repository is broken, not that the session is
    // unattributable, and the two must not look alike in a report.
    expect(() =>
      resolveCdrDriver({
        chargerOrgId: "",
        candidates: [{ field: "token_name", value: "SYNTH-TOKEN-AAAA1111" }],
        tokens: [token()],
        memberships: [MEMBER_LOCAL],
        now: NOW,
      }),
    ).toThrow("cdr_driver_resolution_requires_charger_org");
  });

  it("is deterministic: candidate order in the input does not change the answer", () => {
    const tokens = [token({ value: "SYNTH-VENDOR-GGGG7777", userId: USER_LOCAL })];
    const a = resolveCdrDriver({
      chargerOrgId: ORG_HOST,
      candidates: [
        { field: "email", value: "SYNTH-EMAIL-UNKNOWN" },
        { field: "vendor_user_id", value: "SYNTH-VENDOR-GGGG7777" },
      ],
      tokens,
      memberships: [MEMBER_LOCAL],
      now: NOW,
    });
    const b = resolveCdrDriver({
      chargerOrgId: ORG_HOST,
      candidates: [
        { field: "vendor_user_id", value: "SYNTH-VENDOR-GGGG7777" },
        { field: "email", value: "SYNTH-EMAIL-UNKNOWN" },
      ],
      tokens,
      memberships: [MEMBER_LOCAL],
      now: NOW,
    });
    expect(a).toEqual(b);
    expect(a).toEqual({
      kind: "attributed",
      userId: USER_LOCAL,
      matchedOn: "vendor_user_id",
    });
  });

  it("reports the strongest matching field when several candidates agree", () => {
    const out = resolveCdrDriver({
      chargerOrgId: ORG_HOST,
      candidates: [
        { field: "email", value: "SYNTH-EMAIL-HHHH8888" },
        { field: "vendor_user_id", value: "SYNTH-VENDOR-HHHH8888" },
      ],
      tokens: [
        token({ value: "SYNTH-EMAIL-HHHH8888", userId: USER_LOCAL }),
        token({ value: "SYNTH-VENDOR-HHHH8888", userId: USER_LOCAL }),
      ],
      memberships: [MEMBER_LOCAL],
      now: NOW,
    });
    expect(out).toEqual({
      kind: "attributed",
      userId: USER_LOCAL,
      matchedOn: "vendor_user_id",
    });
  });

  it("does not accept an empty membership list as permission", () => {
    const out = resolveCdrDriver({
      chargerOrgId: ORG_HOST,
      candidates: [{ field: "token_name", value: "SYNTH-TOKEN-AAAA1111" }],
      tokens: [token()],
      memberships: [],
      now: NOW,
    });
    expect(out).toEqual({ kind: "unattributed", reason: "driver_outside_charger_org" });
  });
});

describe("cdrCandidatesFromVendorFields", () => {
  it("drops blanks and whitespace-only vendor fields", () => {
    expect(
      cdrCandidatesFromVendorFields({
        vendorUserId: "SYNTH-VENDOR-IIII9999",
        tokenName: "   ",
        username: null,
        email: undefined,
      }),
    ).toEqual([{ field: "vendor_user_id", value: "SYNTH-VENDOR-IIII9999" }]);
  });

  it("trims, so a trailing space cannot silently miss a token", () => {
    expect(
      cdrCandidatesFromVendorFields({ tokenName: "  SYNTH-TOKEN-AAAA1111  " }),
    ).toEqual([{ field: "token_name", value: "SYNTH-TOKEN-AAAA1111" }]);
  });

  it("returns nothing for a CDR with no identifiers at all", () => {
    expect(cdrCandidatesFromVendorFields({})).toEqual([]);
  });
});
