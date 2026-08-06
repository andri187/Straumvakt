// The driver access-request flow, end to end, against a real database.
//
// WHY THIS EXISTS
// ---------------
// Operator, 2026-08-06: this flow has never been used, and is about to be
// real-world tested.
//
// It has also never run against Postgres. Until `d7e8e8a` every query on
// `agreements.driver_access_requests` failed at runtime — `triggeredBy` was
// missing its `@map` — and nothing noticed, because the unit tests run
// against a hand-rolled fake with no column names to get wrong. A fake will
// happily accept any query the code can express, including ones the database
// would reject.
//
// So before it meets a real driver, it runs here: create, duplicate-guard,
// operator inbox, approve, approve-again idempotency, already-has-access,
// and deny. Against the real schema, the real constraints and the real
// enum types.
//
// WRITES. Test branch only (br-withered-hat-abtc5gzi), which is disposable
// and resettable from staging. Everything it creates is removed in afterAll,
// so it is re-runnable; the fixture rows it leans on come from
// fixtures/identity.sql and are left alone.
//
// Emails fail open with no RESEND_API_KEY — `sendEmail` returns
// binding_missing without a network call — so no mail is sent from here.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeAll, getApiPrisma, getPool, hasDb } from "./_harness";
import {
  approveRequest,
  createSelfRequest,
  denyRequest,
  listForOperator,
} from "../../src/repositories/driver-access-requests";
import type { Env } from "../../src/bindings";

// No RESEND_API_KEY: sendEmail logs and returns binding_missing.
const env = {} as Env;

/** Fixture driver from fixtures/identity.sql — audience 'driver', no driver-group
 *  membership, which is the precondition the flow assumes. */
const DRIVER = "22222222-0000-4000-8000-000000000003";
const SECOND_DRIVER = "22222222-0000-4000-8000-000000000001";

let installationId = "";
let installationOrgId = "";
let reviewerId = "";
const createdRequestIds: string[] = [];

describe.skipIf(!hasDb)("driver access-request flow, against Postgres", () => {
  beforeAll(async () => {
    // Pick an installation that an ACTIVE agreement with a driver group
    // covers — approve needs somewhere to put the membership.
    const { rows } = await getPool().query<{
      installation_id: string;
      org_id: string;
    }>(
      `select a.installation_id, i.org_id
         from agreements.agreements a
         join agreements.driver_groups g on g.agreement_id = a.id
         join properties.installations i on i.id = a.installation_id
        where a.status = 'active'
        limit 1`,
    );
    if (rows.length === 0) throw new Error("no active agreement with a driver group — cannot exercise approve");
    installationId = rows[0].installation_id;
    installationOrgId = rows[0].org_id;

    // Any operator will do as reviewer; authority is checked at the route
    // layer, which this deliberately does not go through.
    const r = await getPool().query<{ id: string }>(
      `select id from identity.users where audience = 'operator' limit 1`,
    );
    reviewerId = r.rows[0].id;

    // Start from a clean slate for the two fixture drivers so the test is
    // re-runnable after a partial failure.
    await cleanup();
  });

  afterAll(async () => {
    await cleanup();
    await closeAll();
  });

  async function cleanup() {
    await getPool().query(
      `delete from agreements.driver_access_requests where user_id = any($1)`,
      [[DRIVER, SECOND_DRIVER]],
    );
    await getPool().query(
      `delete from agreements.driver_group_memberships where user_id = any($1)`,
      [[DRIVER, SECOND_DRIVER]],
    );
  }

  it("createSelfRequest writes a pending request", async () => {
    const out = await createSelfRequest(getApiPrisma(), env, DRIVER, installationId);
    expect(out, "createSelfRequest failed — this is the path about to be tested for real").toMatchObject({
      ok: true,
    });
    if ("ok" in out) {
      expect(out.accessRequest.status).toBe("pending");
      expect(out.accessRequest.installationId).toBe(installationId);
      createdRequestIds.push(out.accessRequest.id);
    }
  });

  it("stores triggeredBy as 'self_request' in the column the database actually has", async () => {
    // The regression that motivated this file. Read it back through raw SQL
    // so the assertion does not depend on the same mapping it is checking.
    const { rows } = await getPool().query<{ triggered_by: string }>(
      `select triggered_by from agreements.driver_access_requests where user_id = $1`,
      [DRIVER],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].triggered_by).toBe("self_request");
  });

  it("a second request for the same installation is refused, not duplicated", async () => {
    const out = await createSelfRequest(getApiPrisma(), env, DRIVER, installationId);
    expect(out).toMatchObject({ error: "already_requested" });

    const { rows } = await getPool().query(
      `select id from agreements.driver_access_requests where user_id = $1 and installation_id = $2`,
      [DRIVER, installationId],
    );
    expect(rows, "duplicate pending rows — the guard is advisory, there is no partial unique index").toHaveLength(1);
  });

  it("an unknown installation is refused", async () => {
    const out = await createSelfRequest(
      getApiPrisma(),
      env,
      DRIVER,
      "00000000-0000-4000-8000-000000000000",
    );
    expect(out).toMatchObject({ error: "installation_not_found" });
  });

  it("listForOperator shows it in the org's inbox, with totals", async () => {
    const page = await listForOperator(getApiPrisma(), {
      orgId: installationOrgId,
      status: "pending",
      limit: 50,
    });
    expect(page.requests.map((r) => r.id)).toContain(createdRequestIds[0]);
    expect(page.totals.pending).toBeGreaterThanOrEqual(1);
  });

  it("listForOperator does not leak another org's requests", async () => {
    // Tenant isolation on the operator inbox. The fixture orgs from
    // fixtures/identity.sql own no installations, so their inbox must be
    // empty however many requests exist elsewhere.
    const page = await listForOperator(getApiPrisma(), {
      orgId: "11111111-0000-4000-8000-000000000001",
      status: "pending",
      limit: 50,
    });
    expect(page.requests, "an org with no installations saw someone else's requests").toEqual([]);
  });

  it("approveRequest creates the driver-group membership", async () => {
    const out = await approveRequest(getApiPrisma(), env, createdRequestIds[0], reviewerId, {
      expectedInstallationOrgId: installationOrgId,
    });
    expect(out, "approve failed").toMatchObject({ ok: true });
    if ("ok" in out) {
      expect(out.alreadyExisted).toBe(false);
      expect(out.membership.driverGroupId).toBeTruthy();
    }

    const { rows } = await getPool().query(
      `select id from agreements.driver_group_memberships where user_id = $1`,
      [DRIVER],
    );
    expect(rows).toHaveLength(1);
  });

  it("approving twice is idempotent and does not double the membership", async () => {
    const out = await approveRequest(getApiPrisma(), env, createdRequestIds[0], reviewerId, {
      expectedInstallationOrgId: installationOrgId,
    });
    // Either it reports the existing membership, or it refuses because the
    // request is no longer pending. Both are safe; creating a second
    // membership is not.
    const safe =
      ("ok" in out && out.alreadyExisted) || ("error" in out && out.error === "request_not_pending");
    expect(safe, `second approve returned ${JSON.stringify(out)}`).toBe(true);

    const { rows } = await getPool().query(
      `select id from agreements.driver_group_memberships where user_id = $1`,
      [DRIVER],
    );
    expect(rows, "approving twice created two memberships").toHaveLength(1);
  });

  it("once access is granted, a new request is refused as already_have_access", async () => {
    const out = await createSelfRequest(getApiPrisma(), env, DRIVER, installationId);
    expect(out).toMatchObject({ error: "already_have_access" });
  });

  it("denyRequest requires a reason, then records it", async () => {
    const created = await createSelfRequest(getApiPrisma(), env, SECOND_DRIVER, installationId);
    expect(created).toMatchObject({ ok: true });
    if (!("ok" in created)) return;
    createdRequestIds.push(created.accessRequest.id);

    const blank = await denyRequest(getApiPrisma(), env, created.accessRequest.id, reviewerId, "   ");
    expect(blank).toMatchObject({ error: "denial_reason_required" });

    const denied = await denyRequest(
      getApiPrisma(),
      env,
      created.accessRequest.id,
      reviewerId,
      "Not a resident of this building.",
    );
    expect(denied, "deny failed").toMatchObject({ ok: true });

    const { rows } = await getPool().query<{ status: string; denial_reason: string; reviewed_by_user_id: string }>(
      `select status, denial_reason, reviewed_by_user_id
         from agreements.driver_access_requests where id = $1`,
      [created.accessRequest.id],
    );
    expect(rows[0].status).toBe("denied");
    expect(rows[0].denial_reason).toBe("Not a resident of this building.");
    expect(rows[0].reviewed_by_user_id).toBe(reviewerId);
  });

  it("re-denying an already-denied request is refused", async () => {
    const id = createdRequestIds[createdRequestIds.length - 1];
    const out = await denyRequest(getApiPrisma(), env, id, reviewerId, "again");
    expect(out).toMatchObject({ error: "request_not_pending" });
  });
});
