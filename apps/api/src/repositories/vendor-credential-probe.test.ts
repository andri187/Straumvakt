// Sprint 9 — PROBE-2 discovery repository tests. Verifies the
// four-state status taxonomy (onboarded_linked / onboarded_unlinked /
// onboarded_other_credential / not_onboarded), the dual join-key
// (vendor_resource_id OR identity_string), the summary rollup, and
// the installation sort (most-onboarded first).
//
// Mocks Zaptec (via vi.mock on ../lib/zaptec), the auth step (via
// vi.mock on ./credential-management.unsealAndAuth), and Prisma.

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../lib/zaptec", () => ({
  listInstallations: vi.fn(),
  getInstallationHierarchy: vi.fn(),
}));

vi.mock("./credential-management", () => ({
  unsealAndAuth: vi.fn(),
}));

import { getInstallationHierarchy, listInstallations } from "../lib/zaptec";
import { unsealAndAuth } from "./credential-management";
import { probeVendorCredentialChargers } from "./vendor-credential-probe";
import type { PrismaClient } from "../generated/prisma/client";
import type { VendorCredentialProbeInstallation } from "@straumvakt/shared/domain/vendor-credential-probe";

const CREDENTIAL_ID = "11111111-1111-1111-1111-111111111111";
const CREDENTIAL_USERNAME = "ops@example.is";
const OTHER_CREDENTIAL_ID = "22222222-2222-2222-2222-222222222222";
const ORG_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const OTHER_ORG_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const KEK = "stub-kek";

interface FakeIdentity {
  vendorResourceId: string | null;
  identityString: string;
  chargingStationId: string;
  orgId: string;
  organization: { displayName: string };
  chargingStation: {
    installationId: string | null;
    installation: { credentialsId: string | null; credentialsRef: string | null } | null;
  } | null;
}

function makeFakeDb(opts: {
  credential: {
    id: string;
    username: string;
    status: string;
    vendorSlug: string;
  } | null;
  identities: FakeIdentity[];
}): PrismaClient {
  return {
    vendorCredential: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      findUnique: async ({ where }: any) => {
        if (!opts.credential) return null;
        if (where.id !== opts.credential.id) return null;
        return {
          id: opts.credential.id,
          username: opts.credential.username,
          status: opts.credential.status,
          vendor: { slug: opts.credential.vendorSlug },
        };
      },
    },
    ocppIdentity: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      findMany: async ({ where }: any) => {
        // Mimic the OR filter on vendor_resource_id + identity_string.
        const orClauses = where.OR as Array<Record<string, unknown>> | undefined;
        const vrIds = new Set<string>();
        const idStrings = new Set<string>();
        for (const clause of orClauses ?? []) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const vr = (clause as any).vendorResourceId?.in as string[] | undefined;
          if (vr) for (const v of vr) vrIds.add(v);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const is = (clause as any).identityString?.in as string[] | undefined;
          if (is) for (const v of is) idStrings.add(v.toLowerCase());
        }
        return opts.identities.filter((row) => {
          const vrHit = row.vendorResourceId != null && vrIds.has(row.vendorResourceId);
          const isHit = idStrings.has(row.identityString.toLowerCase());
          return vrHit || isHit;
        });
      },
    },
  } as unknown as PrismaClient;
}

beforeEach(() => {
  vi.mocked(listInstallations).mockReset();
  vi.mocked(getInstallationHierarchy).mockReset();
  vi.mocked(unsealAndAuth).mockReset();
  vi.mocked(unsealAndAuth).mockResolvedValue({
    ownerOrgId: ORG_ID,
    username: CREDENTIAL_USERNAME,
    accessToken: "stub-token",
  });
});

describe("probeVendorCredentialChargers — status classification", () => {
  it("classifies a charger as onboarded_linked when installation.credentialsId matches", async () => {
    vi.mocked(listInstallations).mockResolvedValue({
      ok: true,
      value: [{ Id: "zap-inst-A", Name: "Site A", Address: "Main 1", City: "Reykjavík", ZipCode: "101" }],
    });
    vi.mocked(getInstallationHierarchy).mockResolvedValue({
      ok: true,
      value: {
        Id: "zap-inst-A",
        Circuits: [
          {
            Id: "circuit-A",
            Name: "C1",
            Chargers: [
              { Id: "zap-ch-1", Name: "Bay 1", DeviceId: "ZPR000001", SerialNo: "ZPR000001", Active: true },
            ],
          },
        ],
      },
    });

    const db = makeFakeDb({
      credential: {
        id: CREDENTIAL_ID,
        username: CREDENTIAL_USERNAME,
        status: "active",
        vendorSlug: "zaptec",
      },
      identities: [
        {
          vendorResourceId: "zap-ch-1",
          identityString: "zpr000001",
          chargingStationId: "cs-1",
          orgId: ORG_ID,
          organization: { displayName: "Our Org" },
          chargingStation: {
            installationId: "our-inst-A",
            installation: { credentialsId: CREDENTIAL_ID, credentialsRef: null },
          },
        },
      ],
    });

    const probe = await probeVendorCredentialChargers(db, KEK, CREDENTIAL_ID);

    expect(probe.installations).toHaveLength(1);
    const inst = probe.installations[0];
    expect(inst.zaptecInstallationId).toBe("zap-inst-A");
    expect(inst.address).toBe("Main 1, 101 Reykjavík");
    expect(inst.chargers).toHaveLength(1);
    expect(inst.chargers[0].status).toBe("onboarded_linked");
    expect(inst.chargers[0].ourChargingStationId).toBe("cs-1");
    expect(inst.chargers[0].ourOrgId).toBe(ORG_ID);
    expect(inst.chargers[0].ourOrgName).toBe("Our Org");
    expect(probe.summary.onboardedTotal).toBe(1);
    expect(probe.summary.needsAttachTotal).toBe(0);
    expect(probe.summary.notOnboardedTotal).toBe(0);
  });

  it("classifies a charger as onboarded_linked when credentialsRef matches username", async () => {
    vi.mocked(listInstallations).mockResolvedValue({
      ok: true,
      value: [{ Id: "zap-inst-A", Name: "Site A" }],
    });
    vi.mocked(getInstallationHierarchy).mockResolvedValue({
      ok: true,
      value: {
        Id: "zap-inst-A",
        Circuits: [
          {
            Id: "c",
            Chargers: [{ Id: "zap-ch-1", Name: "Bay 1", DeviceId: "ZPR000001" }],
          },
        ],
      },
    });

    const db = makeFakeDb({
      credential: {
        id: CREDENTIAL_ID,
        username: CREDENTIAL_USERNAME,
        status: "active",
        vendorSlug: "zaptec",
      },
      identities: [
        {
          vendorResourceId: "zap-ch-1",
          identityString: "zpr000001",
          chargingStationId: "cs-1",
          orgId: ORG_ID,
          organization: { displayName: "Our Org" },
          chargingStation: {
            installationId: "our-inst-A",
            installation: { credentialsId: null, credentialsRef: CREDENTIAL_USERNAME },
          },
        },
      ],
    });

    const probe = await probeVendorCredentialChargers(db, KEK, CREDENTIAL_ID);
    expect(probe.installations[0].chargers[0].status).toBe("onboarded_linked");
  });

  it("classifies as onboarded_unlinked when installation has no credentials_* set", async () => {
    vi.mocked(listInstallations).mockResolvedValue({
      ok: true,
      value: [{ Id: "zap-inst-A", Name: "Site A" }],
    });
    vi.mocked(getInstallationHierarchy).mockResolvedValue({
      ok: true,
      value: {
        Id: "zap-inst-A",
        Circuits: [
          {
            Id: "c",
            Chargers: [{ Id: "zap-ch-1", Name: "Bay 1", DeviceId: "ZPR000001" }],
          },
        ],
      },
    });

    const db = makeFakeDb({
      credential: {
        id: CREDENTIAL_ID,
        username: CREDENTIAL_USERNAME,
        status: "active",
        vendorSlug: "zaptec",
      },
      identities: [
        {
          vendorResourceId: "zap-ch-1",
          identityString: "zpr000001",
          chargingStationId: "cs-1",
          orgId: ORG_ID,
          organization: { displayName: "Our Org" },
          chargingStation: {
            installationId: "our-inst-A",
            installation: { credentialsId: null, credentialsRef: null },
          },
        },
      ],
    });

    const probe = await probeVendorCredentialChargers(db, KEK, CREDENTIAL_ID);
    expect(probe.installations[0].chargers[0].status).toBe("onboarded_unlinked");
    expect(probe.summary.needsAttachTotal).toBe(1);
  });

  it("classifies as onboarded_other_credential when a different credential owns it", async () => {
    vi.mocked(listInstallations).mockResolvedValue({
      ok: true,
      value: [{ Id: "zap-inst-A", Name: "Site A" }],
    });
    vi.mocked(getInstallationHierarchy).mockResolvedValue({
      ok: true,
      value: {
        Id: "zap-inst-A",
        Circuits: [
          {
            Id: "c",
            Chargers: [{ Id: "zap-ch-1", Name: "Bay 1", DeviceId: "ZPR000001" }],
          },
        ],
      },
    });

    const db = makeFakeDb({
      credential: {
        id: CREDENTIAL_ID,
        username: CREDENTIAL_USERNAME,
        status: "active",
        vendorSlug: "zaptec",
      },
      identities: [
        {
          vendorResourceId: "zap-ch-1",
          identityString: "zpr000001",
          chargingStationId: "cs-other",
          orgId: OTHER_ORG_ID,
          organization: { displayName: "Other Org" },
          chargingStation: {
            installationId: "their-inst-A",
            installation: { credentialsId: OTHER_CREDENTIAL_ID, credentialsRef: null },
          },
        },
      ],
    });

    const probe = await probeVendorCredentialChargers(db, KEK, CREDENTIAL_ID);
    expect(probe.installations[0].chargers[0].status).toBe("onboarded_other_credential");
    expect(probe.installations[0].chargers[0].ourOrgId).toBe(OTHER_ORG_ID);
    expect(probe.installations[0].chargers[0].ourOrgName).toBe("Other Org");
    expect(probe.summary.onboardedTotal).toBe(1);
    expect(probe.summary.needsAttachTotal).toBe(0);
  });

  it("classifies as not_onboarded when no OcppIdentity matches", async () => {
    vi.mocked(listInstallations).mockResolvedValue({
      ok: true,
      value: [{ Id: "zap-inst-A", Name: "Site A" }],
    });
    vi.mocked(getInstallationHierarchy).mockResolvedValue({
      ok: true,
      value: {
        Id: "zap-inst-A",
        Circuits: [
          {
            Id: "c",
            Chargers: [{ Id: "zap-ch-unknown", Name: "Greenfield", DeviceId: "ZPR999999" }],
          },
        ],
      },
    });

    const db = makeFakeDb({
      credential: {
        id: CREDENTIAL_ID,
        username: CREDENTIAL_USERNAME,
        status: "active",
        vendorSlug: "zaptec",
      },
      identities: [],
    });

    const probe = await probeVendorCredentialChargers(db, KEK, CREDENTIAL_ID);
    expect(probe.installations[0].chargers[0].status).toBe("not_onboarded");
    expect(probe.installations[0].chargers[0].ourChargingStationId).toBeNull();
    expect(probe.summary.notOnboardedTotal).toBe(1);
    expect(probe.summary.onboardedTotal).toBe(0);
  });

  it("matches by serial fallback when vendor_resource_id is null", async () => {
    // Simulates the legacy case where we have an OcppIdentity row that
    // was provisioned without the Zaptec UUID (e.g. early wizard runs
    // before vendor_resource_id was being captured). The serial-based
    // fallback (identity_string ↔ DeviceId) should still find it.
    vi.mocked(listInstallations).mockResolvedValue({
      ok: true,
      value: [{ Id: "zap-inst-A", Name: "Site A" }],
    });
    vi.mocked(getInstallationHierarchy).mockResolvedValue({
      ok: true,
      value: {
        Id: "zap-inst-A",
        Circuits: [
          {
            Id: "c",
            Chargers: [{ Id: "zap-ch-1", Name: "Bay 1", DeviceId: "ZPR000042" }],
          },
        ],
      },
    });

    const db = makeFakeDb({
      credential: {
        id: CREDENTIAL_ID,
        username: CREDENTIAL_USERNAME,
        status: "active",
        vendorSlug: "zaptec",
      },
      identities: [
        {
          vendorResourceId: null, // ← key part: no UUID, only serial
          identityString: "zpr000042",
          chargingStationId: "cs-legacy",
          orgId: ORG_ID,
          organization: { displayName: "Our Org" },
          chargingStation: {
            installationId: "our-inst-A",
            installation: { credentialsId: CREDENTIAL_ID, credentialsRef: null },
          },
        },
      ],
    });

    const probe = await probeVendorCredentialChargers(db, KEK, CREDENTIAL_ID);
    expect(probe.installations[0].chargers[0].status).toBe("onboarded_linked");
    expect(probe.installations[0].chargers[0].ourChargingStationId).toBe("cs-legacy");
  });
});

describe("probeVendorCredentialChargers — sort + summary roll-up", () => {
  it("sorts installations so the most-onboarded ones float to the top", async () => {
    vi.mocked(listInstallations).mockResolvedValue({
      ok: true,
      value: [
        { Id: "greenfield", Name: "Greenfield" },
        { Id: "mostly-done", Name: "Mostly Done" },
      ],
    });
    vi.mocked(getInstallationHierarchy).mockImplementation(async (_t, id) => {
      if (id === "greenfield") {
        return {
          ok: true,
          value: {
            Id: id,
            Circuits: [
              {
                Id: "c",
                Chargers: [
                  { Id: "g-1", Name: "g1", DeviceId: "ZPR-G-1" },
                  { Id: "g-2", Name: "g2", DeviceId: "ZPR-G-2" },
                ],
              },
            ],
          },
        };
      }
      return {
        ok: true,
        value: {
          Id: id,
          Circuits: [
            {
              Id: "c",
              Chargers: [
                { Id: "m-1", Name: "m1", DeviceId: "ZPR-M-1" },
                { Id: "m-2", Name: "m2", DeviceId: "ZPR-M-2" },
              ],
            },
          ],
        },
      };
    });

    const db = makeFakeDb({
      credential: {
        id: CREDENTIAL_ID,
        username: CREDENTIAL_USERNAME,
        status: "active",
        vendorSlug: "zaptec",
      },
      identities: [
        {
          vendorResourceId: "m-1",
          identityString: "zpr-m-1",
          chargingStationId: "cs-m-1",
          orgId: ORG_ID,
          organization: { displayName: "Our Org" },
          chargingStation: {
            installationId: "our-mostly",
            installation: { credentialsId: CREDENTIAL_ID, credentialsRef: null },
          },
        },
        {
          vendorResourceId: "m-2",
          identityString: "zpr-m-2",
          chargingStationId: "cs-m-2",
          orgId: ORG_ID,
          organization: { displayName: "Our Org" },
          chargingStation: {
            installationId: "our-mostly",
            installation: { credentialsId: CREDENTIAL_ID, credentialsRef: null },
          },
        },
      ],
    });

    const probe = await probeVendorCredentialChargers(db, KEK, CREDENTIAL_ID);
    expect(
      probe.installations.map((i: VendorCredentialProbeInstallation) => i.zaptecInstallationId),
    ).toEqual(["mostly-done", "greenfield"]);
    expect(probe.summary).toEqual({
      totalInstallations: 2,
      totalChargers: 4,
      onboardedTotal: 2,
      notOnboardedTotal: 2,
      needsAttachTotal: 0,
    });
  });

  it("returns an empty installations array when Zaptec returns 0 installations", async () => {
    vi.mocked(listInstallations).mockResolvedValue({ ok: true, value: [] });

    const db = makeFakeDb({
      credential: {
        id: CREDENTIAL_ID,
        username: CREDENTIAL_USERNAME,
        status: "active",
        vendorSlug: "zaptec",
      },
      identities: [],
    });

    const probe = await probeVendorCredentialChargers(db, KEK, CREDENTIAL_ID);
    expect(probe.installations).toEqual([]);
    expect(probe.summary).toEqual({
      totalInstallations: 0,
      totalChargers: 0,
      onboardedTotal: 0,
      notOnboardedTotal: 0,
      needsAttachTotal: 0,
    });
  });

  it("propagates the credential envelope (id, vendor, username, status)", async () => {
    vi.mocked(listInstallations).mockResolvedValue({ ok: true, value: [] });
    const db = makeFakeDb({
      credential: {
        id: CREDENTIAL_ID,
        username: CREDENTIAL_USERNAME,
        status: "active",
        vendorSlug: "zaptec",
      },
      identities: [],
    });
    const probe = await probeVendorCredentialChargers(db, KEK, CREDENTIAL_ID);
    expect(probe.credential).toEqual({
      id: CREDENTIAL_ID,
      vendor: "zaptec",
      username: CREDENTIAL_USERNAME,
      status: "active",
    });
  });
});

describe("probeVendorCredentialChargers — error handling", () => {
  it("throws kek_unavailable when no KEK is supplied", async () => {
    const db = makeFakeDb({ credential: null, identities: [] });
    await expect(probeVendorCredentialChargers(db, undefined, CREDENTIAL_ID)).rejects.toThrow(
      "kek_unavailable",
    );
  });

  it("throws zaptec_list_installations_failed when Zaptec list call fails", async () => {
    vi.mocked(listInstallations).mockResolvedValue({
      ok: false,
      error: { kind: "list", status: 500 },
    });
    const db = makeFakeDb({
      credential: {
        id: CREDENTIAL_ID,
        username: CREDENTIAL_USERNAME,
        status: "active",
        vendorSlug: "zaptec",
      },
      identities: [],
    });
    await expect(probeVendorCredentialChargers(db, KEK, CREDENTIAL_ID)).rejects.toThrow(
      "zaptec_list_installations_failed",
    );
  });
});
