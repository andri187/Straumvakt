#!/usr/bin/env tsx
// Sprint 9 / 2026-05-09 — Pilot access seeding for Dalvegur via N1 Drivers User.
//
// Creates the four rows that wire the Zaptec default tag EE43C609263CC7
// into the agreements model, so session-stop billing attributes plug-ins
// to the N1 Drivers User and A.11 (when enforceAuthorize=true) accepts.
//
//   1. agreements.agreements             — installation Agreement at Dalvegur 10-14
//   2. agreements.driver_groups          — "N1 Drivers" group under it
//   3. agreements.driver_group_memberships — N1 Drivers User as the only member
//   4. identity.id_tokens                — EE43C609263CC7 → N1 Drivers User (manual, scoped to Dalvegur)
//
// Idempotent guard: bails before any INSERT if any of the four rows
// already exist. Re-running after a partial failure is therefore safe
// — fix what's there or rollback first.

import { Client } from "pg";
import { config as dotenv } from "dotenv";
import { resolve } from "node:path";
dotenv({ path: resolve(process.cwd(), "../../.env.local") });

const N1_DRIVERS_USER_ID = "91a2fae3-8fb0-467a-be99-d613e6d3fd78";
const N1_EHF_ORG_ID = "b9f6a897-2401-45a3-9cde-b89d32fdb326";
const DALVEGUR_INSTALLATION_ID = "37de71e8-10bc-458e-ab5d-164eaccd75e6";
const DEFAULT_TAG = "EE43C609263CC7";

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  // Pre-flight checks — bail if any conflicting row exists.
  const existingAgreement = await c.query(
    `select id from agreements.agreements
      where agreement_type='installation' and installation_id=$1`,
    [DALVEGUR_INSTALLATION_ID],
  );
  if (existingAgreement.rowCount && existingAgreement.rowCount > 0) {
    console.error(
      `ABORT: Dalvegur already has an installation Agreement ` +
        `(id=${existingAgreement.rows[0].id}). Inspect or drop it first.`,
    );
    await c.end();
    process.exit(1);
  }

  const existingToken = await c.query(
    `select id, user_id from identity.id_tokens where value=$1`,
    [DEFAULT_TAG],
  );
  if (existingToken.rowCount && existingToken.rowCount > 0) {
    console.error(
      `ABORT: IdToken for ${DEFAULT_TAG} already exists ` +
        `(id=${existingToken.rows[0].id}, user_id=${existingToken.rows[0].user_id}).`,
    );
    await c.end();
    process.exit(1);
  }

  // Validate the three target rows actually exist.
  const u = await c.query(`select id from identity.users where id=$1`, [N1_DRIVERS_USER_ID]);
  if (u.rowCount !== 1) {
    console.error(`ABORT: N1 Drivers user ${N1_DRIVERS_USER_ID} not found.`);
    await c.end();
    process.exit(1);
  }
  const o = await c.query(`select id from tenancy.organizations where id=$1`, [N1_EHF_ORG_ID]);
  if (o.rowCount !== 1) {
    console.error(`ABORT: N1 ehf org ${N1_EHF_ORG_ID} not found.`);
    await c.end();
    process.exit(1);
  }
  const i = await c.query(`select id from properties.installations where id=$1`, [DALVEGUR_INSTALLATION_ID]);
  if (i.rowCount !== 1) {
    console.error(`ABORT: Dalvegur installation ${DALVEGUR_INSTALLATION_ID} not found.`);
    await c.end();
    process.exit(1);
  }

  console.log("Pre-flight clean. Beginning transaction.\n");

  await c.query("BEGIN");
  try {
    const a = await c.query(
      `insert into agreements.agreements
         (agreement_type, counterparty_org_id, installation_id, display_name,
          status, effective_from, notes)
       values
         ('installation', $1, $2, $3,
          'active', now(),
          'Pilot access pre-A.10 — bare access, no clauses. Default tag EE43C609263CC7 routes plug-ins to N1 Drivers User for billing attribution. (2026-05-09 addendum / A.11)')
       returning id`,
      [N1_EHF_ORG_ID, DALVEGUR_INSTALLATION_ID, "Dalvegur 10-14 — N1 driver access (pilot)"],
    );
    const agreementId = a.rows[0].id;
    console.log(`  ✓ Agreement created       : ${agreementId}`);

    const dg = await c.query(
      `insert into agreements.driver_groups
         (agreement_id, owner_org_id, display_name)
       values ($1, $2, 'N1 Drivers')
       returning id`,
      [agreementId, N1_EHF_ORG_ID],
    );
    const driverGroupId = dg.rows[0].id;
    console.log(`  ✓ DriverGroup created     : ${driverGroupId}`);

    const m = await c.query(
      `insert into agreements.driver_group_memberships
         (driver_group_id, user_id)
       values ($1, $2)
       returning id`,
      [driverGroupId, N1_DRIVERS_USER_ID],
    );
    const membershipId = m.rows[0].id;
    console.log(`  ✓ Membership created      : ${membershipId}`);

    const t = await c.query(
      `insert into identity.id_tokens
         (user_id, kind, value, vendor_issued_by, label, status, scope_installation_id)
       values ($1, 'manual', $2, NULL,
               'Dalvegur default tag (Zaptec portal — operator-set)',
               'active', $3)
       returning id`,
      [N1_DRIVERS_USER_ID, DEFAULT_TAG, DALVEGUR_INSTALLATION_ID],
    );
    const tokenId = t.rows[0].id;
    console.log(`  ✓ IdToken created         : ${tokenId} (value=${DEFAULT_TAG})`);

    await c.query("COMMIT");
    console.log("\n✅ COMMIT — Dalvegur pilot access wired.");
    console.log("\nSummary:");
    console.log(`  Agreement   : ${agreementId}`);
    console.log(`  DriverGroup : ${driverGroupId}`);
    console.log(`  Membership  : ${membershipId}`);
    console.log(`  IdToken     : ${tokenId}`);
  } catch (err) {
    await c.query("ROLLBACK");
    console.error("\n❌ ROLLBACK — transaction failed, no rows committed.");
    console.error(err);
    process.exit(1);
  } finally {
    await c.end();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
