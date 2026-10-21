import { describe, expect, it } from "vitest";

import {
  FixtureMembershipValidity,
  FixturePlacementResolver,
  covers,
  isAvailable,
  membershipForSession,
  overlaps,
} from "./validity";
import type { DeviceIdentityRow, MembershipRow, PlacementRow } from "./validity";

const d = (iso: string) => new Date(iso);
const JAN = d("2026-01-01T00:00:00Z");
const APR = d("2026-04-01T00:00:00Z");
const JUL = d("2026-07-01T00:00:00Z");
const OCT = d("2026-10-01T00:00:00Z");

// ── item 9: membership validity ─────────────────────────────────────────

const G = "grp-1";

function memberships(rows: Array<[string, Date, Date | null]>): MembershipRow[] {
  return rows.map(([userId, from, until], i) => ({
    membershipId: `m-${i + 1}`,
    groupId: G,
    userId,
    period: { from, until },
  }));
}

describe("membership validity", () => {
  it("a current member resolves true", async () => {
    const port = new FixtureMembershipValidity(memberships([["u1", JAN, null]]));
    const r = await port.isMemberAt(G, "u1", JUL);
    expect(isAvailable(r) && r.value).toBe(true);
  });

  it("a driver who LEFT mid-period is not a member afterwards", async () => {
    const port = new FixtureMembershipValidity(memberships([["u1", JAN, APR]]));
    expect(isAvailable(await port.isMemberAt(G, "u1", JUL)) && (await port.isMemberAt(G, "u1", JUL)).status).toBe(
      "available",
    );
    const r = await port.isMemberAt(G, "u1", JUL);
    expect(isAvailable(r) && r.value).toBe(false);
  });

  it("...but IS a member before they left", async () => {
    const port = new FixtureMembershipValidity(memberships([["u1", JAN, APR]]));
    const r = await port.isMemberAt(G, "u1", d("2026-02-01T00:00:00Z"));
    expect(isAvailable(r) && r.value).toBe(true);
  });

  it("a driver who JOINED mid-period is not a member before", async () => {
    const port = new FixtureMembershipValidity(memberships([["u1", JUL, null]]));
    const r = await port.isMemberAt(G, "u1", APR);
    expect(isAvailable(r) && r.value).toBe(false);
  });

  it("a driver who LEFT AND REJOINED is a member in both windows and not in the gap", async () => {
    const port = new FixtureMembershipValidity(
      memberships([
        ["u1", JAN, APR],
        ["u1", OCT, null],
      ]),
    );
    const inFirst = await port.isMemberAt(G, "u1", d("2026-02-01T00:00:00Z"));
    const inGap = await port.isMemberAt(G, "u1", JUL);
    const inSecond = await port.isMemberAt(G, "u1", d("2026-11-01T00:00:00Z"));
    expect(isAvailable(inFirst) && inFirst.value).toBe(true);
    expect(isAvailable(inGap) && inGap.value).toBe(false);
    expect(isAvailable(inSecond) && inSecond.value).toBe(true);
  });

  it("THE BOUNDARY INSTANT belongs to the LATER interval", async () => {
    const port = new FixtureMembershipValidity(
      memberships([
        ["u1", JAN, APR],
        ["u2", APR, null],
      ]),
    );
    // At exactly APR: u1 has left, u2 has arrived. No overlap, no gap.
    const leaving = await port.isMemberAt(G, "u1", APR);
    const arriving = await port.isMemberAt(G, "u2", APR);
    expect(isAvailable(leaving) && leaving.value).toBe(false);
    expect(isAvailable(arriving) && arriving.value).toBe(true);
  });

  it("an unresolvable membership is UNAVAILABLE, never false", async () => {
    const port = new FixtureMembershipValidity([], "replica lag");
    const r = await port.isMemberAt(G, "u1", JUL);
    expect(r.status).toBe("unavailable");
    // The distinction that matters: this is NOT the same as `available(false)`.
    expect(isAvailable(r)).toBe(false);
  });

  it("membershipsOverlapping returns everyone who was there for any of the period", async () => {
    const port = new FixtureMembershipValidity(
      memberships([
        ["u1", JAN, APR],
        ["u2", APR, null],
        ["u3", d("2030-01-01T00:00:00Z"), null],
      ]),
    );
    const r = await port.membershipsOverlapping(G, { from: JAN, until: JUL });
    expect(isAvailable(r) && r.value.map((m) => m.userId).sort()).toEqual(["u1", "u2"]);
  });

  it("a session is priced against the membership valid when it STARTED", async () => {
    // Left in April. A session that started in February is theirs.
    const port = new FixtureMembershipValidity(memberships([["u1", JAN, APR]]));
    const atSessionStart = await membershipForSession(port, G, "u1", d("2026-02-15T00:00:00Z"));
    const atBillingTime = await port.isMemberAt(G, "u1", d("2026-08-01T00:00:00Z"));
    expect(isAvailable(atSessionStart) && atSessionStart.value).toBe(true);
    expect(isAvailable(atBillingTime) && atBillingTime.value).toBe(false);
  });

  it("interval helpers agree: touching intervals do not overlap", () => {
    expect(overlaps({ from: JAN, until: APR }, { from: APR, until: null })).toBe(false);
    expect(covers({ from: JAN, until: APR }, APR)).toBe(false);
    expect(covers({ from: APR, until: null }, APR)).toBe(true);
  });
});

// ── item 8: the placement resolution chain ──────────────────────────────

const identities: DeviceIdentityRow[] = [
  { deviceId: "dev-1", identityString: "ZPR074002", period: { from: JAN, until: JUL } },
  { deviceId: "dev-2", identityString: "ZPR074002", period: { from: JUL, until: null } },
  { deviceId: "dev-3", identityString: "ZPR999999", period: { from: JAN, until: null } },
];

const placements: PlacementRow[] = [
  {
    placementId: "plc-1", deviceId: "dev-1", orgId: "org-old",
    installationId: "inst-1", circuitId: "cir-1", siteId: "site-1",
    period: { from: JAN, until: APR },
  },
  {
    placementId: "plc-2", deviceId: "dev-1", orgId: "org-new",
    installationId: "inst-2", circuitId: null, siteId: "site-2",
    period: { from: APR, until: null },
  },
  {
    placementId: "plc-3", deviceId: "dev-2", orgId: "org-third",
    installationId: "inst-3", circuitId: null, siteId: "site-3",
    period: { from: JUL, until: null },
  },
];

describe("placement resolution", () => {
  const resolver = new FixturePlacementResolver(identities, placements);

  it("resolves an identity at an instant inside a CLOSED placement to the host who held it THEN", async () => {
    const r = await resolver.resolveIdentity("ZPR074002", d("2026-02-01T00:00:00Z"));
    expect(isAvailable(r) && r.value.orgId).toBe("org-old");
    expect(isAvailable(r) && r.value.placementId).toBe("plc-1");
  });

  it("resolves the same identity later to the host who holds it NOW", async () => {
    const r = await resolver.resolveIdentity("ZPR074002", d("2026-05-01T00:00:00Z"));
    expect(isAvailable(r) && r.value.orgId).toBe("org-new");
  });

  it("a device moved between orgs bills each host for their own window", async () => {
    const before = await resolver.resolveIdentity("ZPR074002", d("2026-03-31T23:59:59Z"));
    const after = await resolver.resolveIdentity("ZPR074002", d("2026-04-01T00:00:01Z"));
    expect(isAvailable(before) && before.value.orgId).toBe("org-old");
    expect(isAvailable(after) && after.value.orgId).toBe("org-new");
  });

  it("the same identity string REUSED on a different device resolves by instant, not by LIMIT 1", async () => {
    // dev-1 held it until July, dev-2 from July. Both rows exist.
    const early = await resolver.resolveIdentity("ZPR074002", d("2026-05-01T00:00:00Z"));
    const late = await resolver.resolveIdentity("ZPR074002", d("2026-08-01T00:00:00Z"));
    expect(isAvailable(early) && early.value.deviceId).toBe("dev-1");
    expect(isAvailable(late) && late.value.deviceId).toBe("dev-2");
  });

  it("an unknown identity is unavailable, not a rejection", async () => {
    const r = await resolver.resolveIdentity("NOPE", JUL);
    expect(r.status).toBe("unavailable");
    expect(r.status === "unavailable" && r.reason).toBe("identity_not_found");
  });

  it("an identity with no OPEN attachment at that instant is unavailable", async () => {
    const r = await resolver.resolveIdentity("ZPR074002", d("2025-01-01T00:00:00Z"));
    expect(r.status === "unavailable" && r.reason).toBe("identity_not_attached_at_instant");
  });

  it("AMBIGUITY IS REFUSED — two devices holding one identity at one instant", async () => {
    // Exactly round 3's finding: today this resolves by LIMIT 1 and routes a
    // charger's energy to an arbitrary host.
    const ambiguous = new FixturePlacementResolver(
      [
        { deviceId: "dev-a", identityString: "DUP", period: { from: JAN, until: null } },
        { deviceId: "dev-b", identityString: "DUP", period: { from: JAN, until: null } },
      ],
      placements,
    );
    const r = await ambiguous.resolveIdentity("DUP", JUL);
    expect(r.status).toBe("unavailable");
    expect(r.status === "unavailable" && r.reason).toBe("ambiguous_identity");
  });

  it("two open PLACEMENTS for one device are refused, not LIMIT-1-resolved", async () => {
    const ambiguous = new FixturePlacementResolver(
      [{ deviceId: "dev-x", identityString: "X", period: { from: JAN, until: null } }],
      [
        { placementId: "p1", deviceId: "dev-x", orgId: "o1", installationId: "i1", circuitId: null, siteId: "s1", period: { from: JAN, until: null } },
        { placementId: "p2", deviceId: "dev-x", orgId: "o2", installationId: "i2", circuitId: null, siteId: "s2", period: { from: JAN, until: null } },
      ],
    );
    const r = await ambiguous.resolveIdentity("X", JUL);
    expect(r.status === "unavailable" && r.reason).toBe("ambiguous_placement");
  });

  it("a device with an identity but no placement at that instant is unavailable", async () => {
    const r = await resolver.resolveIdentity("ZPR999999", JUL);
    expect(r.status === "unavailable" && r.reason).toBe("device_not_placed_at_instant");
  });

  it("carries the stable placement id — OCPI's EVSE.uid", async () => {
    const r = await resolver.resolveIdentity("ZPR074002", d("2026-02-01T00:00:00Z"));
    expect(isAvailable(r) && r.value.placementId).toBeTruthy();
  });

  it("carries the full chain: org, installation, circuit and site", async () => {
    const r = await resolver.resolveIdentity("ZPR074002", d("2026-02-01T00:00:00Z"));
    expect(isAvailable(r) && r.value).toMatchObject({
      orgId: "org-old", installationId: "inst-1", circuitId: "cir-1", siteId: "site-1",
    });
  });
});

// ── fool-tests ──────────────────────────────────────────────────────────

describe("FOOL E — restore an existence check in place of validity", () => {
  // The call site as it is today: does a row exist for this (group, user)?
  const existsFooled = (rows: MembershipRow[], groupId: string, userId: string) =>
    rows.some((r) => r.groupId === groupId && r.userId === userId);

  const rows = memberships([["u1", JAN, APR]]);

  it("the fooled check says a driver who left in April is still a member in July", () => {
    expect(existsFooled(rows, G, "u1")).toBe(true);
  });

  it("the real check says they are not", async () => {
    const port = new FixtureMembershipValidity(rows);
    const r = await port.isMemberAt(G, "u1", JUL);
    expect(isAvailable(r) && r.value).toBe(false);
  });
});

describe("FOOL F — treat unavailable as false", () => {
  // The collapse that makes an invoice lie: "I could not find out" becomes
  // "they were not a member", and the driver silently drops off the bill.
  const collapse = (e: { status: string; value?: boolean }) =>
    e.status === "available" ? e.value === true : false;

  it("the fooled collapse turns an unreadable membership into a non-membership", async () => {
    const port = new FixtureMembershipValidity([], "replica lag");
    const r = await port.isMemberAt(G, "u1", JUL);
    expect(collapse(r as never)).toBe(false);
  });

  it("the real value keeps the two apart", async () => {
    const port = new FixtureMembershipValidity([], "replica lag");
    const r = await port.isMemberAt(G, "u1", JUL);
    expect(r.status).toBe("unavailable");
    expect(isAvailable(r)).toBe(false);
    // ...and an actual non-member is available(false), which is different.
    const real = new FixtureMembershipValidity(memberships([["u2", JAN, null]]));
    const nonMember = await real.isMemberAt(G, "u1", JUL);
    expect(nonMember.status).toBe("available");
    expect(isAvailable(nonMember) && nonMember.value).toBe(false);
  });
});

describe("FOOL G — resolve an ambiguous identity with LIMIT 1", () => {
  const dupIdentities: DeviceIdentityRow[] = [
    { deviceId: "dev-a", identityString: "DUP", period: { from: JAN, until: null } },
    { deviceId: "dev-b", identityString: "DUP", period: { from: JAN, until: null } },
  ];

  it("the fooled resolver picks one arbitrarily — which host gets the energy is undefined", () => {
    const picked = dupIdentities.find((i) => i.identityString === "DUP");
    expect(picked).toBeTruthy();
    expect(["dev-a", "dev-b"]).toContain(picked!.deviceId);
  });

  it("the real resolver refuses", async () => {
    const r = await new FixturePlacementResolver(dupIdentities, placements).resolveIdentity("DUP", JUL);
    expect(r.status).toBe("unavailable");
    expect(r.status === "unavailable" && r.reason).toBe("ambiguous_identity");
  });
});
