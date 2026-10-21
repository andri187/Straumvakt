// ── ON THE TEST VALUES ──────────────────────────────────────────────────
//
// NO KENNITALA LITERAL APPEARS ANYWHERE IN THIS FILE, and none is ever
// printed.
//
// The positive path needs a value that passes BOTH the mod-11 checksum and
// the date-plausibility check. There is no slot in the kennitala format that
// is well-formed yet unissuable, so any such value could in principle belong
// to someone — and the round's rules forbid committing one.
//
// The resolution is a FUTURE DATE. `31/12/99` with century marker `0` reads
// as 2099-12-31: well-formed, checksum-valid, and impossible to have been
// issued to any living person or registered company, because the date has not
// happened yet. It is built at run time by `checkDigitFor`, held only in
// memory, and asserted never to appear in any output.
//
// Where only the checksum branch matters, the older convention still applies:
// an IMPOSSIBLE date (day 88, month 99), which cannot collide with anything.

import { describe, expect, it } from "vitest";

import { OrgCreateInput, OrgUpdateInput } from "../inputs/orgs";
import { checkDigitFor, maskKennitala } from "../invoice/kennitala";
import {
  ORG_IDENTITY_EXPOSURE,
  OrgTenantViolation,
  assertSameTenant,
  maySeeOrgIdentity,
  orgIdentityForDetail,
  redactOrgIdentityForList,
} from "./org-exposure";
import { assessOrgReadiness, formatReadiness } from "./org-readiness";
import type { OrgReadinessFacts } from "./org-readiness";

/**
 * A well-formed kennitala dated 2099-12-31 — see the file header.
 *
 * Built at run time, never committed, never printed. `NN` is walked until a
 * writable check digit exists (a remainder of 1 has none).
 */
function futureDatedKennitala(): string {
  for (let nn = 0; nn < 100; nn++) {
    const prefix8 = `311299${String(nn).padStart(2, "0")}`;
    const c = checkDigitFor(prefix8);
    if (c !== null) return `${prefix8}${c}0`;
  }
  throw new Error("no writable check digit found");
}
const SYNTH = futureDatedKennitala();

// ── kennitala capture at the input boundary ─────────────────────────────

describe("kennitala capture — at creation", () => {
  const base = {
    displayName: "Fixture Host",
    countryCode: "IS",
    defaultCurrency: "ISK",
  };

  it("an org can be created WITHOUT a kennitala — it is optional at creation", () => {
    const r = OrgCreateInput.safeParse(base);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.kennitala).toBeUndefined();
  });

  it("a checksum-valid kennitala is accepted and stored normalised", () => {
    const r = OrgCreateInput.safeParse({ ...base, kennitala: SYNTH });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.kennitala).toBe(SYNTH);
  });

  it("a dashed kennitala is accepted and the dash is stripped", () => {
    const dashed = `${SYNTH.slice(0, 6)}-${SYNTH.slice(6)}`;
    const r = OrgCreateInput.safeParse({ ...base, kennitala: dashed });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.kennitala).toBe(SYNTH);
  });

  it("REJECTS a transposed kennitala — the defect the old regex-only field allowed", () => {
    // Ten digits, correct shape, wrong checksum. Under the previous
    // `/^\d{6}-?\d{4}$/` this was stored without complaint.
    const transposed = SYNTH.slice(0, 6) + SYNTH[7] + SYNTH[6] + SYNTH.slice(8);
    const r = OrgCreateInput.safeParse({ ...base, kennitala: transposed });
    if (transposed !== SYNTH) {
      expect(r.success).toBe(false);
      if (!r.success) {
        expect(r.error.issues.map((i) => i.message).join(",")).toContain("kennitala_checksum_failed");
      }
    }
  });

  it("rejects a malformed kennitala with a named reason and never echoes the input", () => {
    const r = OrgCreateInput.safeParse({ ...base, kennitala: "12345" });
    expect(r.success).toBe(false);
    if (!r.success) {
      const messages = r.error.issues.map((i) => i.message);
      expect(messages.some((m) => m.includes("format") || m.startsWith("kennitala_"))).toBe(true);
      // The rule that keeps a logged validation error from being a logged id.
      for (const m of messages) expect(m).not.toContain("12345");
    }
  });

  it("rejects a wrong-length value", () => {
    expect(OrgCreateInput.safeParse({ ...base, kennitala: "889912345" }).success).toBe(false);
    expect(OrgCreateInput.safeParse({ ...base, kennitala: "88991234500" }).success).toBe(false);
  });

  it("rejects non-digits", () => {
    expect(OrgCreateInput.safeParse({ ...base, kennitala: "88991234A0" }).success).toBe(false);
  });
});

describe("kennitala capture — after creation", () => {
  it("can be added later via update", () => {
    const r = OrgUpdateInput.safeParse({ kennitala: SYNTH });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.kennitala).toBe(SYNTH);
  });

  it("update applies the same checksum rule as create", () => {
    const transposed = SYNTH.slice(0, 6) + SYNTH[7] + SYNTH[6] + SYNTH.slice(8);
    if (transposed !== SYNTH) {
      expect(OrgUpdateInput.safeParse({ kennitala: transposed }).success).toBe(false);
    }
  });

  it("an update that omits kennitala leaves it alone", () => {
    const r = OrgUpdateInput.safeParse({ displayName: "Renamed" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.kennitala).toBeUndefined();
  });
});

// ── exposure: list vs detail, and cross-org reads ───────────────────────

describe("list vs detail exposure", () => {
  const summary = { id: "org-a", kennitala: SYNTH, vskNr: "VSK-FIXTURE" };

  it("the list projection masks the kennitala", () => {
    const listed = redactOrgIdentityForList(summary);
    expect(listed.kennitala).toBe(maskKennitala(SYNTH));
    expect(listed.kennitala).not.toBe(SYNTH);
  });

  it("the masked value does not carry the identifying digits", () => {
    const listed = redactOrgIdentityForList(summary);
    expect(listed.kennitala).not.toContain(SYNTH.slice(6));
  });

  it("the list projection keeps the shape — the key is present, not removed", () => {
    // Removing the key would make list and detail rows structurally different
    // and force every consumer to branch.
    expect(Object.keys(redactOrgIdentityForList(summary))).toContain("kennitala");
  });

  it("a null kennitala stays null rather than becoming a mask of nothing", () => {
    expect(redactOrgIdentityForList({ ...summary, kennitala: null }).kennitala).toBeNull();
  });

  it("VSK is not redacted — it is public register data, and the asymmetry is deliberate", () => {
    expect(redactOrgIdentityForList(summary).vskNr).toBe("VSK-FIXTURE");
  });

  it("the detail projection returns the full value to a caller in the same org", () => {
    const caller = { orgId: "org-a", isPlatformStaff: false };
    expect(orgIdentityForDetail(caller, summary).kennitala).toBe(SYNTH);
  });

  it("the recorded exposure contract says what each endpoint does today", () => {
    expect(ORG_IDENTITY_EXPOSURE.list.crossTenant).toBe(true);
    expect(ORG_IDENTITY_EXPOSURE.list.kennitalaToday).toBe("full");
    expect(ORG_IDENTITY_EXPOSURE.list.kennitalaRecommended).toBe("masked");
    expect(ORG_IDENTITY_EXPOSURE.detail.crossTenant).toBe(false);
  });
});

describe("cross-org read", () => {
  const summary = { id: "org-a", kennitala: SYNTH, vskNr: null };

  it("a caller from another org cannot read the identity", () => {
    const outsider = { orgId: "org-b", isPlatformStaff: false };
    expect(() => orgIdentityForDetail(outsider, summary)).toThrow(OrgTenantViolation);
    expect(maySeeOrgIdentity(outsider, "org-a")).toBe(false);
  });

  it("a caller with no org cannot read the identity", () => {
    expect(() => assertSameTenant({ orgId: null, isPlatformStaff: false }, "org-a")).toThrow(
      OrgTenantViolation,
    );
  });

  it("platform staff may cross tenants", () => {
    expect(maySeeOrgIdentity({ orgId: null, isPlatformStaff: true }, "org-a")).toBe(true);
  });

  it("the violation error carries no identifier", () => {
    try {
      assertSameTenant({ orgId: "org-b", isPlatformStaff: false }, "org-a");
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(String(e)).not.toContain(SYNTH);
      expect((e as OrgTenantViolation).message).toBe("org_tenant_violation");
    }
  });
});

// ── readiness ───────────────────────────────────────────────────────────

function readyFacts(over: Partial<OrgReadinessFacts> = {}): OrgReadinessFacts {
  return {
    org: {
      id: "org-a",
      status: "active",
      displayName: "Fixture Host",
      legalName: "Fixture Host ehf.",
      kennitala: SYNTH,
      vskNr: "VSK-FIXTURE",
      countryCode: "IS",
      defaultCurrency: "ISK",
      roles: ["site_host"],
    },
    enrolledUserCount: 1,
    attachedChargerCount: 1,
    connectorCount: 2,
    agreements: [{ effectiveFrom: "2026-01-01", effectiveTo: null, hasConnectorRate: true }],
    period: { from: "2026-07-01", to: "2026-07-31" },
    kennitalaValid: true,
    ...over,
  };
}

describe("org readiness", () => {
  it("a fully-onboarded org is invoiceable with no holds", () => {
    const r = assessOrgReadiness(readyFacts());
    expect(r.invoiceable).toBe(true);
    expect(r.holds).toEqual([]);
    expect(r.satisfied.length).toBeGreaterThanOrEqual(8);
  });

  it("a missing org holds on org_missing and nothing else", () => {
    const r = assessOrgReadiness(readyFacts({ org: null }));
    expect(r.holds.map((h) => h.reason)).toEqual(["org_missing"]);
  });

  it.each([
    ["kennitala_missing", { org: { ...readyFacts().org!, kennitala: null } }],
    ["kennitala_invalid", { kennitalaValid: false }],
    ["legal_name_missing", { org: { ...readyFacts().org!, legalName: null } }],
    ["org_roles_unset", { org: { ...readyFacts().org!, roles: [] } }],
    ["org_not_active", { org: { ...readyFacts().org!, status: "suspended" } }],
    ["currency_unset", { org: { ...readyFacts().org!, defaultCurrency: null } }],
    ["no_enrolled_user", { enrolledUserCount: 0 }],
    ["no_charger_attached", { attachedChargerCount: 0 }],
    ["no_connector_in_asset_chain", { connectorCount: 0 }],
    ["no_agreement", { agreements: [] }],
  ] as const)("holds %s when that prerequisite is missing", (reason, over) => {
    const r = assessOrgReadiness(readyFacts(over as Partial<OrgReadinessFacts>));
    expect(r.invoiceable).toBe(false);
    expect(r.holds.map((h) => h.reason)).toContain(reason);
  });

  it("holds when the agreement does not cover the period", () => {
    const r = assessOrgReadiness(
      readyFacts({
        agreements: [{ effectiveFrom: "2026-09-01", effectiveTo: null, hasConnectorRate: true }],
      }),
    );
    expect(r.holds.map((h) => h.reason)).toContain("agreement_not_in_force_for_period");
  });

  it("holds when an in-force agreement carries no per-connector rate", () => {
    const r = assessOrgReadiness(
      readyFacts({
        agreements: [{ effectiveFrom: "2026-01-01", effectiveTo: null, hasConnectorRate: false }],
      }),
    );
    expect(r.holds.map((h) => h.reason)).toContain("agreement_has_no_connector_rate");
  });

  it("an agreement that ended mid-period does not count as in force", () => {
    const r = assessOrgReadiness(
      readyFacts({
        agreements: [{ effectiveFrom: "2026-01-01", effectiveTo: "2026-07-15", hasConnectorRate: true }],
      }),
    );
    expect(r.holds.map((h) => h.reason)).toContain("agreement_not_in_force_for_period");
  });

  it("reports EVERY reason at once — one fix must not reveal the next a month later", () => {
    const r = assessOrgReadiness(
      readyFacts({
        org: { ...readyFacts().org!, kennitala: null, legalName: null, roles: [] },
        enrolledUserCount: 0,
        attachedChargerCount: 0,
        connectorCount: 0,
        agreements: [],
      }),
    );
    const reasons = r.holds.map((h) => h.reason);
    expect(reasons).toContain("kennitala_missing");
    expect(reasons).toContain("legal_name_missing");
    expect(reasons).toContain("org_roles_unset");
    expect(reasons).toContain("no_enrolled_user");
    expect(reasons).toContain("no_charger_attached");
    expect(reasons).toContain("no_connector_in_asset_chain");
    expect(reasons).toContain("no_agreement");
    expect(reasons.length).toBeGreaterThanOrEqual(7);
  });

  it("every hold carries a remedy — a hold without one is a complaint", () => {
    const r = assessOrgReadiness(readyFacts({ org: { ...readyFacts().org!, kennitala: null } }));
    for (const h of r.holds) {
      expect(h.remedy.length).toBeGreaterThan(10);
      expect(h.detail.length).toBeGreaterThan(10);
    }
  });

  it("the formatted report carries no kennitala", () => {
    const r = assessOrgReadiness(readyFacts());
    const text = formatReadiness(r, "Fixture Host");
    expect(text).not.toContain(SYNTH);
    expect(text).toContain("INVOICEABLE");
  });
});

// ── fool-tests ──────────────────────────────────────────────────────────

describe("FOOL 1 — validate the kennitala by shape only", () => {
  // Exactly what the field did before this round.
  const shapeOnly = (v: string) => /^\d{6}-?\d{4}$/.test(v);

  it("the fooled check accepts a transposed kennitala", () => {
    const transposed = SYNTH.slice(0, 6) + SYNTH[7] + SYNTH[6] + SYNTH.slice(8);
    expect(shapeOnly(transposed)).toBe(true);
  });

  it("the real field rejects it", () => {
    const transposed = SYNTH.slice(0, 6) + SYNTH[7] + SYNTH[6] + SYNTH.slice(8);
    if (transposed !== SYNTH) {
      expect(OrgCreateInput.safeParse({
        displayName: "x",
        countryCode: "IS",
        kennitala: transposed,
      }).success).toBe(false);
    }
  });
});

describe("FOOL 2 — let the identifier cross an org boundary", () => {
  // The guard is `assertSameTenant`. Without it, a detail read is just a
  // lookup by id, which is what the repository layer does today.
  const summary = { id: "org-a", kennitala: SYNTH, vskNr: null };
  const detailFooled = <T,>(_caller: unknown, s: T) => s;

  it("the fooled reader hands an outsider the full identifier", () => {
    const outsider = { orgId: "org-b", isPlatformStaff: false };
    expect(detailFooled(outsider, summary).kennitala).toBe(SYNTH);
  });

  it("the real reader throws", () => {
    const outsider = { orgId: "org-b", isPlatformStaff: false };
    expect(() => orgIdentityForDetail(outsider, summary)).toThrow(OrgTenantViolation);
  });
});

describe("FOOL 3 — return a bare boolean instead of holds", () => {
  const readyFooled = (f: OrgReadinessFacts) => assessOrgReadiness(f).invoiceable;

  it("the fooled signal cannot say what is missing", () => {
    const facts = readyFacts({
      org: { ...readyFacts().org!, kennitala: null },
      attachedChargerCount: 0,
    });
    expect(readyFooled(facts)).toBe(false);
    // ...and that is all it can say. An operator learns nothing actionable.
  });

  it("the real signal names both missing prerequisites and how to fix each", () => {
    const facts = readyFacts({
      org: { ...readyFacts().org!, kennitala: null },
      attachedChargerCount: 0,
    });
    const r = assessOrgReadiness(facts);
    expect(r.holds.map((h) => h.reason).sort()).toEqual(
      ["kennitala_missing", "no_charger_attached"].sort(),
    );
    expect(r.holds.every((h) => h.remedy.length > 0)).toBe(true);
  });
});

describe("FOOL 4 — short-circuit readiness on the first hold", () => {
  // The tempting early return. It makes onboarding a game of whack-a-mole:
  // fix one thing, discover the next, once per billing cycle.
  const firstHoldOnly = (f: OrgReadinessFacts) => assessOrgReadiness(f).holds.slice(0, 1);

  const broken = readyFacts({
    org: { ...readyFacts().org!, kennitala: null, legalName: null },
    enrolledUserCount: 0,
    agreements: [],
  });

  it("the fooled version reports one reason", () => {
    expect(firstHoldOnly(broken)).toHaveLength(1);
  });

  it("the real version reports all four", () => {
    expect(assessOrgReadiness(broken).holds.length).toBeGreaterThanOrEqual(4);
  });
});
