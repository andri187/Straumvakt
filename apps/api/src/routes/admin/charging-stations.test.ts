// Sprint 9 — PROBE-3: attach-vendor endpoint tests.
//
// ── REWRITTEN 2026-08-07, when chargers.ts moved to Drizzle ─────────────
//
// This used to drive the route through a hand-rolled ~150-line fake
// PrismaClient. That fake encoded Prisma's query API, so the moment the
// repository moved to Drizzle every case here returned 500 — the mock was
// still being applied, it just no longer intercepted anything the code
// called. Seven green tests went red without a single behaviour change.
//
// Faking Drizzle's fluent builder instead would be worse and would break
// again on the next ORM decision. So the seam moved: this file mocks the
// REPOSITORY FUNCTION, which is what the route actually depends on, and
// asserts the thing only a route test can assert — the AttachVendorError →
// HTTP status mapping, and the request validation in front of it.
//
// What was lost, deliberately: two assertions that counted rows written to
// the fake (`ocppUpdates`, `auditLogs`). Those were testing the mock, not
// the route. Whether the repository really writes those rows belongs in
// test/parity/, against real ones.
//
// Cases:
//   1. Success → 200 with the repository's result echoed
//   2. charging_station_not_found / no_ocpp_identity / credential_not_found → 404
//   3. credential_inactive / vendor_mismatch → 400
//   4. conflict_vendor_resource_id / conflict_credentials_ref → 409
//   5. Validation: missing fields, non-string fields, unknown vendor → 400
//   6. A non-AttachVendorError propagates rather than being swallowed

import { describe, expect, it, beforeEach, vi } from "vitest";

const STATION_ID = "11111111-1111-4111-8111-111111111111";
const IDENTITY_ID = "22222222-2222-4222-8222-222222222222";
const CRED_ID = "33333333-3333-4333-8333-333333333333";
const VENDOR_RESOURCE_ID = "44444444-4444-4444-8444-444444444444";

// The repository is the seam. AttachVendorError is imported from the real
// module so `instanceof` in the route's catch block still matches.
const { AttachVendorError } = await vi.importActual<
  typeof import("../../repositories/chargers")
>("../../repositories/chargers");

const attachVendorToOcppIdentity = vi.fn();

vi.mock("../../repositories/chargers", async (importOriginal) => {
  const real = (await importOriginal()) as Record<string, unknown>;
  return { ...real, attachVendorToOcppIdentity: (...a: unknown[]) => attachVendorToOcppIdentity(...a) };
});

// A Drizzle client is built before the repository call. Nothing in these
// tests reaches the database, but makeDrizzle would open a pool, so stub it.
vi.mock("../../lib/drizzle", () => ({ makeDrizzle: () => ({}) }));
vi.mock("../../lib/prisma", () => ({ makePrisma: () => ({}) }));

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

const { adminChargers } = await import("./chargers");

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

const validBody = {
  vendor: "zaptec",
  vendorResourceId: VENDOR_RESOURCE_ID,
  credentialId: CRED_ID,
};

describe("POST /:id/attach-vendor", () => {
  beforeEach(() => {
    attachVendorToOcppIdentity.mockReset();
    attachVendorToOcppIdentity.mockResolvedValue({
      ocppIdentityId: IDENTITY_ID,
      vendor: "zaptec",
      vendorResourceId: VENDOR_RESOURCE_ID,
      credentialsRef: CRED_ID,
    });
  });

  it("returns 200 and echoes the repository result", async () => {
    const res = await callAttach(STATION_ID, validBody);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      ocppIdentityId: IDENTITY_ID,
      vendor: "zaptec",
      vendorResourceId: VENDOR_RESOURCE_ID,
      credentialsRef: CRED_ID,
    });
  });

  it("passes the station id, body and actor through to the repository", async () => {
    await callAttach(STATION_ID, validBody);
    expect(attachVendorToOcppIdentity).toHaveBeenCalledTimes(1);
    const [, stationId, input] = attachVendorToOcppIdentity.mock.calls[0]!;
    expect(stationId).toBe(STATION_ID);
    expect(input).toEqual({
      vendor: "zaptec",
      vendorResourceId: VENDOR_RESOURCE_ID,
      credentialId: CRED_ID,
    });
  });

  // ── Error-code → status mapping ─────────────────────────────────────────

  const mappings: Array<[string, number]> = [
    ["charging_station_not_found", 404],
    ["no_ocpp_identity", 404],
    ["credential_not_found", 404],
    ["credential_inactive", 400],
    ["vendor_mismatch", 400],
    ["conflict_vendor_resource_id", 409],
    ["conflict_credentials_ref", 409],
  ];

  for (const [code, status] of mappings) {
    it(`maps ${code} to ${status}`, async () => {
      attachVendorToOcppIdentity.mockRejectedValue(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        new AttachVendorError(code as any, `boom: ${code}`),
      );
      const res = await callAttach(STATION_ID, validBody);
      expect(res.status).toBe(status);
      const body = (await res.json()) as { error: string; message: string };
      expect(body.error).toBe(code);
      expect(body.message).toBe(`boom: ${code}`);
    });
  }

  it("does not swallow an unexpected error", async () => {
    attachVendorToOcppIdentity.mockRejectedValue(new Error("connection reset"));
    // Hono turns an uncaught throw into a 500 — the point is that it is NOT
    // mapped to one of the AttachVendorError statuses.
    const res = await callAttach(STATION_ID, validBody);
    expect(res.status).toBe(500);
  });

  // ── Validation, in front of the repository ──────────────────────────────

  it("rejects a body missing required fields with 400", async () => {
    const res = await callAttach(STATION_ID, { vendor: "zaptec" });
    expect(res.status).toBe(400);
    expect(attachVendorToOcppIdentity).not.toHaveBeenCalled();
  });

  it("rejects non-string fields with 400", async () => {
    const res = await callAttach(STATION_ID, { ...validBody, credentialId: 7 });
    expect(res.status).toBe(400);
    expect(attachVendorToOcppIdentity).not.toHaveBeenCalled();
  });

  it("rejects a vendor other than zaptec with 400", async () => {
    const res = await callAttach(STATION_ID, { ...validBody, vendor: "easee" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { message: string };
    expect(body.message).toBe('vendor must be "zaptec"');
    expect(attachVendorToOcppIdentity).not.toHaveBeenCalled();
  });
});
