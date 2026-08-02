// Sprint 9 (PROBE-1) — charger-technical-read linkStatus contract.
//
// Covers the five distinct exit paths of getChargerTechnicalRead:
//
//   1. OcppIdentity.credentialsRef = NULL
//      → linkStatus: "no_credential"; no Zaptec API call attempted.
//
//   2. credentialsRef set + vendorResourceId NULL
//      → linkStatus: "no_vendor_resource_id"; still no API call.
//
//   3. credentialsRef set + vendorResourceId set, but credential's
//      ownerOrgId != charger.orgId (cross-tenant) → PROCEEDS, uses the
//      credential normally. This is the regression test that proves
//      the org-match join was the bug; zpr074002 (owned by N1 ehf,
//      managed by Straumvakt's master cred) is the production canary.
//
//   4. Credential row found but status != "active"
//      → linkStatus: "credential_unhealthy"; no Zaptec API call.
//
//   5. Credential healthy, Zaptec API throws
//      → linkStatus: "vendor_api_failed"; cached payload returned when
//      available.
//
// All five cases run against a hand-rolled fake PrismaClient that only
// implements the methods this repo touches. Zaptec API is mocked via
// vi.mock so no network is hit.

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../lib/zaptec", () => ({
  getChargerDetail: vi.fn(),
  getChargerState: vi.fn(),
  getInstallationSummary: vi.fn(),
  getZaptecAccessToken: vi.fn(),
}));

// openPassword is exercised by every healthy-credential path; mock it
// to a deterministic plaintext so we don't have to actually seal a
// password with WebCrypto for each test. The real seal/open contract
// has its own unit coverage in credential-crypto.test.ts.
vi.mock("../lib/credential-crypto", () => ({
  openPassword: vi.fn(async () => "secret-plaintext"),
}));

import {
  getChargerDetail,
  getChargerState,
  getInstallationSummary,
  getZaptecAccessToken,
} from "../lib/zaptec";
import { getChargerTechnicalRead } from "./charger-technical-read";
import type { PrismaClient } from "../generated/prisma/client";

const STATION_ID = "11111111-1111-1111-1111-111111111111";
const CHARGER_ORG_ID = "22222222-2222-2222-2222-222222222222";
const CRED_ORG_ID = "33333333-3333-3333-3333-333333333333"; // different from charger's org
const VENDOR_RESOURCE_ID = "44444444-4444-4444-4444-444444444444";
const CRED_ID = "55555555-5555-5555-5555-555555555555";
const KEK = "test-kek-test-kek-test-kek-test-kek";

interface OcppIdentityRow {
  vendorResourceId: string | null;
  vendor: string | null;
  credentialsRef: string | null;
}

interface StationRow {
  orgId: string;
  installationId: string | null;
  lastTelemetryRead: unknown;
  lastTelemetryAt: Date | null;
  ocppIdentities: OcppIdentityRow[];
}

interface CredentialRow {
  id: string;
  ownerOrgId: string;
  username: string;
  passwordCipher: Uint8Array | null;
  passwordIv: Uint8Array | null;
  status: string;
}

interface FakeOpts {
  station: StationRow | null;
  credentials?: CredentialRow[];
  captureCacheWrite?: (data: unknown) => void;
}

function makeFakeDb(opts: FakeOpts): PrismaClient {
  const db = {
    chargingStation: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      findUnique: async (_args: any) => opts.station,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      update: async (args: any) => {
        opts.captureCacheWrite?.(args.data);
        return {};
      },
    },
    vendorCredential: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      findFirst: async (args: any) => {
        const where = args.where;
        const refTargets = where.OR.flatMap((o: { id?: string; username?: string }) => [
          o.id,
          o.username,
        ]).filter(Boolean) as string[];
        for (const cred of opts.credentials ?? []) {
          // We don't model the vendor.slug join precisely; the fake
          // only stores zaptec credentials so the where clause is a
          // no-op for matching purposes.
          if (refTargets.includes(cred.id) || refTargets.includes(cred.username)) {
            return cred;
          }
        }
        return null;
      },
      // Rung 3 of the credential resolution chain — resolves only when
      // exactly one active credential exists, so the fake honours `take`
      // (the real query takes 2, which is enough to detect ambiguity).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      findMany: async (args: any) => {
        const actives = (opts.credentials ?? []).filter(
          (c) => c.status === "active",
        );
        return typeof args?.take === "number"
          ? actives.slice(0, args.take)
          : actives;
      },
    },
    idToken: {
      // The local-auth roster builder hits this; tests don't care
      // about roster content. Returning [] keeps roster.note =
      // "show_csms_roster" with zero entries.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      findMany: async () => [],
    },
    driverGroupMembership: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      findMany: async () => [],
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return db as unknown as PrismaClient;
}

function activeCredential(overrides: Partial<CredentialRow> = {}): CredentialRow {
  return {
    id: CRED_ID,
    ownerOrgId: CRED_ORG_ID,
    username: "admin@straumvakt.is",
    passwordCipher: new Uint8Array([1, 2, 3, 4]),
    passwordIv: new Uint8Array(12),
    status: "active",
    ...overrides,
  };
}

function baseStation(overrides: Partial<StationRow> = {}): StationRow {
  return {
    orgId: CHARGER_ORG_ID,
    installationId: null,
    lastTelemetryRead: null,
    lastTelemetryAt: null,
    ocppIdentities: [
      {
        vendorResourceId: VENDOR_RESOURCE_ID,
        vendor: "Zaptec",
        credentialsRef: CRED_ID,
      },
    ],
    ...overrides,
  };
}

describe("getChargerTechnicalRead — linkStatus contract (PROBE-1)", () => {
  beforeEach(() => {
    vi.mocked(getChargerDetail).mockReset();
    vi.mocked(getChargerState).mockReset();
    vi.mocked(getInstallationSummary).mockReset();
    vi.mocked(getZaptecAccessToken).mockReset();
  });

  // ── credential resolution chain ───────────────────────────────────
  //
  // PROBE-1 made OcppIdentity.credentials_ref authoritative and hard-
  // failed on NULL. But nothing populates that column except
  // attachVendor (repositories/chargers.ts:645) — the Zaptec importer
  // never writes it. So the strict contract reported "no credential"
  // for every imported charger, including ones actively serving
  // telemetry, and pointed the operator at /onboard/zaptec to create a
  // credential that already existed.
  //
  // The chain restores resolution WITHOUT restoring the bug PROBE-1
  // killed: the failure there was *guessing*, so rung 3 resolves only
  // when the answer is unambiguous. Crossing tenants is fine and
  // intended; picking one of several candidates is not.

  it("credentials_ref NULL + exactly one active credential → resolves", async () => {
    const db = makeFakeDb({
      station: baseStation({
        ocppIdentities: [
          {
            vendorResourceId: VENDOR_RESOURCE_ID,
            vendor: "Zaptec",
            credentialsRef: null,
          },
        ],
      }),
      credentials: [activeCredential()],
    });

    const read = await getChargerTechnicalRead(db, STATION_ID, KEK);

    expect(read.linkStatus).not.toBe("no_credential");
    expect(vi.mocked(getZaptecAccessToken)).toHaveBeenCalled();
  });

  it("credentials_ref NULL + no active credential → 'no_credential', zero Zaptec calls", async () => {
    const db = makeFakeDb({
      station: baseStation({
        ocppIdentities: [
          {
            vendorResourceId: VENDOR_RESOURCE_ID,
            vendor: "Zaptec",
            credentialsRef: null,
          },
        ],
      }),
      credentials: [],
    });

    const read = await getChargerTechnicalRead(db, STATION_ID, KEK);

    expect(read.linkStatus).toBe("no_credential");
    expect(read.fresh).toBe(false);
    expect(vi.mocked(getZaptecAccessToken)).not.toHaveBeenCalled();
    expect(vi.mocked(getChargerDetail)).not.toHaveBeenCalled();
    expect(vi.mocked(getChargerState)).not.toHaveBeenCalled();
  });

  it("credentials_ref NULL + several active credentials → refuses to guess", async () => {
    const db = makeFakeDb({
      station: baseStation({
        ocppIdentities: [
          {
            vendorResourceId: VENDOR_RESOURCE_ID,
            vendor: "Zaptec",
            credentialsRef: null,
          },
        ],
      }),
      credentials: [activeCredential(), activeCredential()],
    });

    const read = await getChargerTechnicalRead(db, STATION_ID, KEK);

    expect(read.linkStatus).toBe("no_credential");
    expect(read.linkStatusReason).toMatch(/rather than guessing/);
    expect(vi.mocked(getZaptecAccessToken)).not.toHaveBeenCalled();
  });

  // ── vendor linkage, split out of no_credential ────────────────────

  it("vendor NULL → 'vendor_not_linked', not 'no_credential'", async () => {
    // zpr074002's actual state: arrived OCPP-first via gateway
    // discovery, so vendor and vendor_resource_id were never filled.
    // Reporting this as no_credential sent the operator to onboard a
    // credential they already had.
    const db = makeFakeDb({
      station: baseStation({
        ocppIdentities: [
          { vendorResourceId: null, vendor: null, credentialsRef: null },
        ],
      }),
      credentials: [activeCredential()],
    });

    const read = await getChargerTechnicalRead(db, STATION_ID, KEK);

    expect(read.linkStatus).toBe("vendor_not_linked");
    expect(read.linkStatusReason).toMatch(/never linked/i);
    expect(vi.mocked(getZaptecAccessToken)).not.toHaveBeenCalled();
  });

  it("vendor is matched case-insensitively", async () => {
    // attachVendor writes lowercase "zaptec" (the route validates that
    // spelling); the importer writes "Zaptec". A strict compare meant
    // running the documented repair path left the badge unchanged.
    const db = makeFakeDb({
      station: baseStation({
        ocppIdentities: [
          {
            vendorResourceId: VENDOR_RESOURCE_ID,
            vendor: "zaptec",
            credentialsRef: CRED_ID,
          },
        ],
      }),
      credentials: [activeCredential()],
    });

    const read = await getChargerTechnicalRead(db, STATION_ID, KEK);

    expect(read.linkStatus).not.toBe("vendor_not_linked");
    expect(vi.mocked(getZaptecAccessToken)).toHaveBeenCalled();
  });

  it("credentials_ref set + vendor_resource_id NULL → linkStatus 'no_vendor_resource_id'", async () => {
    const db = makeFakeDb({
      station: baseStation({
        ocppIdentities: [
          {
            vendorResourceId: null,
            vendor: "Zaptec",
            credentialsRef: CRED_ID,
          },
        ],
      }),
      credentials: [activeCredential()],
    });

    const read = await getChargerTechnicalRead(db, STATION_ID, KEK);

    expect(read.linkStatus).toBe("no_vendor_resource_id");
    expect(read.fresh).toBe(false);
    expect(vi.mocked(getZaptecAccessToken)).not.toHaveBeenCalled();
    expect(vi.mocked(getChargerDetail)).not.toHaveBeenCalled();
  });

  it("cross-tenant credential (charger.orgId != credential.ownerOrgId) → PROCEEDS normally, linkStatus 'ok'", async () => {
    // This is the regression test for the original bug. zpr074002 is
    // owned by N1 ehf but the Zaptec credential that can read it
    // belongs to the Straumvakt org. The repo MUST follow
    // credentials_ref directly without rejecting on org mismatch.
    vi.mocked(getZaptecAccessToken).mockResolvedValueOnce({
      ok: true,
      value: "access-token-from-cross-tenant-cred",
    });
    vi.mocked(getChargerDetail).mockResolvedValueOnce({
      ok: true,
      value: { SerialNo: "ZPR074002", DeviceId: "ZPR074002" } as never,
    });
    vi.mocked(getChargerState).mockResolvedValueOnce({
      ok: true,
      value: [{ StateId: -2, ValueAsString: "true" }],
    });

    const db = makeFakeDb({
      station: baseStation({ orgId: CHARGER_ORG_ID }),
      credentials: [activeCredential({ ownerOrgId: CRED_ORG_ID })],
    });

    const read = await getChargerTechnicalRead(db, STATION_ID, KEK);

    expect(read.linkStatus).toBe("ok");
    expect(read.fresh).toBe(true);
    expect(read.serialNo).toBe("ZPR074002");
    expect(read.isOnline).toBe(true);
    // Critical: the credential was used despite cross-tenant org.
    expect(vi.mocked(getZaptecAccessToken)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(getChargerDetail)).toHaveBeenCalledWith(
      "access-token-from-cross-tenant-cred",
      VENDOR_RESOURCE_ID,
    );
  });

  it("credential row status='expired' → linkStatus 'credential_unhealthy', no API call", async () => {
    const db = makeFakeDb({
      station: baseStation(),
      credentials: [activeCredential({ status: "expired" })],
    });

    const read = await getChargerTechnicalRead(db, STATION_ID, KEK);

    expect(read.linkStatus).toBe("credential_unhealthy");
    expect(read.linkStatusReason).toContain("expired");
    expect(read.fresh).toBe(false);
    expect(vi.mocked(getZaptecAccessToken)).not.toHaveBeenCalled();
  });

  it("Zaptec OAuth throws → linkStatus 'vendor_api_failed', cached read served", async () => {
    const cachedAt = new Date(Date.now() - 60_000);
    const cachedPayload = {
      // Just enough of a payload to verify the cache is overlaid.
      serialNo: "ZPR074002-CACHED",
      isOnline: false,
    };

    vi.mocked(getZaptecAccessToken).mockRejectedValueOnce(
      new Error("network blew up"),
    );

    const db = makeFakeDb({
      station: baseStation({
        lastTelemetryRead: cachedPayload,
        lastTelemetryAt: cachedAt,
      }),
      credentials: [activeCredential()],
    });

    const read = await getChargerTechnicalRead(db, STATION_ID, KEK);

    expect(read.linkStatus).toBe("vendor_api_failed");
    expect(read.fresh).toBe(false);
    expect(read.cachedAt).toBe(cachedAt.toISOString());
    // Cached field overlays the empty placeholder.
    expect(read.serialNo).toBe("ZPR074002-CACHED");
    // Reason captured so the operator sees the proximate cause.
    expect(read.linkStatusReason ?? "").toContain("network blew up");
  });
});
