// Sprint 9 — PROBE-3: attach-vendor endpoint tests.
//
// Drives the POST /:id/attach-vendor route through a fake PrismaClient
// using the same pattern as zaptec.test.ts (fake state object + vi.mock).
// The route is wired under /api/admin/chargers in src/index.ts but we
// test the Hono app directly to avoid bootstrapping the full Worker.
//
// Six cases per spec:
//   1. Attach to a row with all 3 vendor fields NULL → 200, fields populated
//   2. Attach to a row that already has the SAME values → idempotent 200
//   3. Attach to a row with a DIFFERENT vendorResourceId → 409 conflict
//   4. Attach to a row with a DIFFERENT credentialsRef → 409 conflict
//   5. credentialId points at inactive credential → 400 error
//   6. credentialId points at non-existent credential → 404 error
//
// Additionally: missing body fields → 400, unknown vendor → 400.

import { describe, expect, it, beforeEach, vi } from "vitest";

// ─── Fake-state shape ────────────────────────────────────────────────────────

interface FakeIdentityRow {
  id: string;
  orgId: string;
  vendor: string | null;
  vendorResourceId: string | null;
  credentialsRef: string | null;
}

interface FakeCredentialRow {
  id: string;
  status: string;
  vendor: { slug: string };
}

interface FakeState {
  station: {
    siteAssetId: string;
    orgId: string;
    ocppIdentities: FakeIdentityRow[];
  } | null;
  credential: FakeCredentialRow | null;
  auditLogs: unknown[];
  ocppUpdates: unknown[];
}

const fakeState: FakeState = {
  station: null,
  credential: null,
  auditLogs: [],
  ocppUpdates: [],
};

function resetState() {
  fakeState.station = null;
  fakeState.credential = null;
  fakeState.auditLogs = [];
  fakeState.ocppUpdates = [];
}

// ─── Fake PrismaClient factory ───────────────────────────────────────────────

function makeFake() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tx: any = {
    chargingStation: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      findUnique: async ({ where }: any) => {
        if (!fakeState.station) return null;
        if (where.siteAssetId !== fakeState.station.siteAssetId) return null;
        return {
          siteAssetId: fakeState.station.siteAssetId,
          orgId: fakeState.station.orgId,
          ocppIdentities: fakeState.station.ocppIdentities,
        };
      },
    },
    vendorCredential: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      findUnique: async ({ where }: any) => {
        if (!fakeState.credential) return null;
        if (where.id !== fakeState.credential.id) return null;
        return fakeState.credential;
      },
    },
    ocppIdentity: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      update: async ({ where, data }: any) => {
        fakeState.ocppUpdates.push({ where, data });
        // Apply to in-memory identity so subsequent reads see the update.
        if (fakeState.station) {
          const identity = fakeState.station.ocppIdentities.find(
            (i) => i.id === where.id,
          );
          if (identity) {
            if (data.vendor !== undefined) identity.vendor = data.vendor;
            if (data.vendorResourceId !== undefined) identity.vendorResourceId = data.vendorResourceId;
            if (data.credentialsRef !== undefined) identity.credentialsRef = data.credentialsRef;
          }
        }
      },
    },
    auditAction: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      create: async ({ data }: any) => {
        fakeState.auditLogs.push(data);
      },
    },
  };

  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    $transaction: async (fn: any) => fn(tx),
    ...tx,
  };
}

vi.mock("../../lib/prisma", () => ({
  makePrisma: () => makeFake(),
}));

// Import the Hono app AFTER mocking so the route uses our fake.
import { adminChargers } from "./chargers";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const STATION_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const ORG_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const IDENTITY_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const CRED_ID = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const VENDOR_RESOURCE_ID = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";

// Fake AUTH_SECRET for the admin-session verification. The route applies
// requireAdmin first (checks the cookie) and requirePermission (which
// short-circuits for bootstrap sessions). We bypass both by providing a
// fake env with AUTH_SECRET set and using the bootstrap cookie format
// that verifyAdminSession recognises. Since we can't produce a real HMAC
// here, we instead inject a fake session directly by mocking the session
// verification. See note at bottom re: bootstrap bypass path.
//
// The cleaner approach used by the webhook tests is to NOT go through
// the full middleware stack for the route under test. For admin routes
// that use requireAdmin + requirePermission(bootstrap) the simplest test
// surface is to exercise the repository directly and separately test the
// route with a minimal request that satisfies the bootstrap path.
//
// Bootstrap-admin path: requireAdmin calls verifyAdminSession(env.AUTH_SECRET, cookie).
// verifyAdminSession is in apps/api/src/lib/admin-session.ts. We mock it here.

vi.mock("../../lib/admin-session", async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const real = (await importOriginal()) as any;
  return {
    ...real,
    verifyAdminSession: async (_secret: string, _cookie: string | undefined) => ({
      sub: "admin",
      iat: Math.floor(Date.now() / 1000),
    }),
    adminSessionConfig: real.adminSessionConfig ?? { SESSION_COOKIE_NAME: "sv_session" },
  };
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function callAttach(stationId: string, body: unknown, env: any = { AUTH_SECRET: "test" }) {
  const req = new Request(`http://test/${stationId}/attach-vendor`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: "straumvakt_admin_session=fake",
    },
    body: JSON.stringify(body),
  });
  return adminChargers.fetch(req, env);
}

// ─── Test suite ──────────────────────────────────────────────────────────────

describe("POST /:id/attach-vendor", () => {
  beforeEach(() => {
    resetState();
    // Default station + credential setup for the happy path.
    fakeState.station = {
      siteAssetId: STATION_ID,
      orgId: ORG_ID,
      ocppIdentities: [
        {
          id: IDENTITY_ID,
          orgId: ORG_ID,
          vendor: null,
          vendorResourceId: null,
          credentialsRef: null,
        },
      ],
    };
    fakeState.credential = {
      id: CRED_ID,
      status: "active",
      vendor: { slug: "zaptec" },
    };
  });

  // ── Case 1: all 3 vendor fields NULL → success ────────────────────────────

  it("attaches vendor to an unlinked identity and returns the updated fields", async () => {
    const res = await callAttach(STATION_ID, {
      vendor: "zaptec",
      vendorResourceId: VENDOR_RESOURCE_ID,
      credentialId: CRED_ID,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      ocppIdentityId: string;
      vendor: string;
      vendorResourceId: string;
      credentialsRef: string;
    };
    expect(body.ok).toBe(true);
    expect(body.ocppIdentityId).toBe(IDENTITY_ID);
    expect(body.vendor).toBe("zaptec");
    expect(body.vendorResourceId).toBe(VENDOR_RESOURCE_ID);
    expect(body.credentialsRef).toBe(CRED_ID);

    // Verify the DB update was issued.
    expect(fakeState.ocppUpdates).toHaveLength(1);
    // Verify audit log was written.
    expect(fakeState.auditLogs).toHaveLength(1);
    const audit = fakeState.auditLogs[0] as {
      action: string;
      targetType: string;
      targetId: string;
    };
    expect(audit.action).toBe("charger.attach_vendor");
    expect(audit.targetType).toBe("ocpp_identity");
    expect(audit.targetId).toBe(IDENTITY_ID);
  });

  // ── Case 2: same values already set → idempotent success ─────────────────

  it("is idempotent when the identity already has the same vendor values", async () => {
    // Pre-populate with identical values.
    fakeState.station!.ocppIdentities[0].vendor = "zaptec";
    fakeState.station!.ocppIdentities[0].vendorResourceId = VENDOR_RESOURCE_ID;
    fakeState.station!.ocppIdentities[0].credentialsRef = CRED_ID;

    const res = await callAttach(STATION_ID, {
      vendor: "zaptec",
      vendorResourceId: VENDOR_RESOURCE_ID,
      credentialId: CRED_ID,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
    // Update was still issued (same data, idempotent).
    expect(fakeState.ocppUpdates).toHaveLength(1);
  });

  // ── Case 3: DIFFERENT vendorResourceId → 409 conflict ────────────────────

  it("returns 409 when identity already has a different vendorResourceId", async () => {
    fakeState.station!.ocppIdentities[0].vendorResourceId = "other-vendor-resource-id";

    const res = await callAttach(STATION_ID, {
      vendor: "zaptec",
      vendorResourceId: VENDOR_RESOURCE_ID,
      credentialId: CRED_ID,
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("conflict_vendor_resource_id");
    // No DB update or audit on conflict.
    expect(fakeState.ocppUpdates).toHaveLength(0);
    expect(fakeState.auditLogs).toHaveLength(0);
  });

  // ── Case 4: DIFFERENT credentialsRef → 409 conflict ──────────────────────

  it("returns 409 when identity already has a different credentialsRef", async () => {
    fakeState.station!.ocppIdentities[0].credentialsRef = "other-credential-id";

    const res = await callAttach(STATION_ID, {
      vendor: "zaptec",
      vendorResourceId: VENDOR_RESOURCE_ID,
      credentialId: CRED_ID,
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("conflict_credentials_ref");
    expect(fakeState.ocppUpdates).toHaveLength(0);
    expect(fakeState.auditLogs).toHaveLength(0);
  });

  // ── Case 5: credential exists but is inactive → 400 ─────────────────────

  it("returns 400 when the credential is inactive", async () => {
    fakeState.credential!.status = "revoked";

    const res = await callAttach(STATION_ID, {
      vendor: "zaptec",
      vendorResourceId: VENDOR_RESOURCE_ID,
      credentialId: CRED_ID,
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("credential_inactive");
    expect(fakeState.ocppUpdates).toHaveLength(0);
    expect(fakeState.auditLogs).toHaveLength(0);
  });

  // ── Case 6: credential does not exist → 404 ──────────────────────────────

  it("returns 404 when the credentialId does not exist", async () => {
    fakeState.credential = null; // no credential in the fake store

    const res = await callAttach(STATION_ID, {
      vendor: "zaptec",
      vendorResourceId: VENDOR_RESOURCE_ID,
      credentialId: CRED_ID,
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("credential_not_found");
  });

  // ── Additional: charging station not found → 404 ─────────────────────────

  it("returns 404 when the charging station does not exist", async () => {
    fakeState.station = null;

    const res = await callAttach(STATION_ID, {
      vendor: "zaptec",
      vendorResourceId: VENDOR_RESOURCE_ID,
      credentialId: CRED_ID,
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("charging_station_not_found");
  });

  // ── Additional: invalid body → 400 ───────────────────────────────────────

  it("returns 400 when required body fields are missing", async () => {
    const res = await callAttach(STATION_ID, { vendor: "zaptec" }); // missing vendorResourceId + credentialId
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("validation");
  });

  it("returns 400 when vendor is not 'zaptec'", async () => {
    const res = await callAttach(STATION_ID, {
      vendor: "easee",
      vendorResourceId: VENDOR_RESOURCE_ID,
      credentialId: CRED_ID,
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe("validation");
  });
});
