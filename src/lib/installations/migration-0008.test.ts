// Static check of migration 0008 against the Drizzle declarations. It reads SQL
// text only: it proves the definitions are present and consistent, NOT that
// PostgreSQL accepts or enforces them. Migration 0008 has not been applied to
// any database; it must be rehearsed in a rolled-back transaction first.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import { deviceIdentities, installationDrafts } from "@straumvakt/shared/db/assets";
import { pendingDiscoveries } from "@straumvakt/shared/db/protocol";

const DRIZZLE_DIR = path.join(__dirname, "..", "..", "..", "apps", "api", "drizzle");
const TAG = "0008_installation_drafts_and_cpo_identity";
const sqlText = readFileSync(path.join(DRIZZLE_DIR, `${TAG}.sql`), "utf8");
const statements = sqlText
  .replace(/--(?!>)[^\r\n]*/g, "")
  .split("--> statement-breakpoint")
  .map((s) => s.replace(/\s+/g, " ").trim())
  .filter(Boolean);

describe("migration 0008: installation drafts and CPO-scoped connection identity", () => {
  it("is the next entry in the journal, follows the applied chain, and there is no leftover reservation migration", () => {
    const journal = JSON.parse(readFileSync(path.join(DRIZZLE_DIR, "meta", "_journal.json"), "utf8")) as { entries: { idx: number; tag: string }[] };
    journal.entries.forEach((e, i) => expect(e.idx).toBe(i));
    expect(journal.entries[8]).toMatchObject({ idx: 8, tag: TAG });
    expect(journal.entries[7]?.tag).toBe("0007_terms_snapshot");
    expect(journal.entries.some((e) => e.tag.includes("reservation"))).toBe(false);
  });

  it("only adds: no drop, no delete, and the single data statement touches only the two new columns", () => {
    expect(statements.filter((s) => /^(DROP|TRUNCATE|DELETE|INSERT)\b/i.test(s))).toEqual([]);
    const updates = statements.filter((s) => /^UPDATE\b/i.test(s));
    expect(updates).toHaveLength(1);
    // History is left as written: identity_string and period are never assigned.
    const assigned = /SET (.*?) FROM/i.exec(updates[0])![1];
    expect(assigned).toContain('"cpo_org_id"');
    expect(assigned).toContain('"charge_point_id"');
    expect(assigned).not.toMatch(/"(identity_string|period)" =/); // read from, never assigned
    expect(updates[0]).toContain('di."cpo_org_id" IS NULL'); // never rewrites a row that already has a value
  });

  it("backfills only from an existing installation's key prefix, so an unmatched row stays NULL and is never admitted", () => {
    const update = statements.find((s) => /^UPDATE\b/i.test(s))!;
    expect(update).toContain('i."installation_key" IS NOT NULL');
    expect(update).toContain(`left(di."identity_string", length(i."installation_key") + 1) = i."installation_key" || '/'`);
    expect(update).toContain('i."org_id"');
  });

  it("creates the draft table with every declared column and adds the identity columns", () => {
    const create = statements.find((s) => s.startsWith('CREATE TABLE "properties"."installation_drafts"'));
    expect(create).toBeDefined();
    for (const col of getTableConfig(installationDrafts).columns) expect(create, col.name).toContain(`"${col.name}"`);
    expect(statements).toContain('ALTER TABLE "assets"."device_identities" ADD COLUMN "cpo_org_id" uuid;');
    expect(statements).toContain('ALTER TABLE "assets"."device_identities" ADD COLUMN "charge_point_id" text;');
    const cols = getTableConfig(deviceIdentities).columns.map((c) => c.name);
    expect(cols).toEqual(expect.arrayContaining(["cpo_org_id", "charge_point_id", "identity_string", "period"]));
  });

  it("widens the discovery key (now '{org-id}/{charge-point-id}', up to 85 characters)", () => {
    expect(statements.some((s) => s.includes('ALTER TABLE "ocpp"."pending_discoveries" ALTER COLUMN "identity_string" SET DATA TYPE varchar(128)'))).toBe(true);
    expect(getTableConfig(pendingDiscoveries).columns.find((c) => c.name === "identity_string")?.getSQLType()).toBe("varchar(128)");
    expect(36 + 1 + 48).toBeLessThanOrEqual(128);
  });

  it("holds one CPO to one open charge point id at a time, across installations; the same id in two CPOs stays allowed", () => {
    const wanted = 'ALTER TABLE "assets"."device_identities" ADD CONSTRAINT "device_identities_one_device_per_cpo_charge_point_id_at_a_time" EXCLUDE USING GIST ("cpo_org_id" WITH =, "charge_point_id" WITH =, "period" WITH &&)';
    expect(statements.filter((s) => s === wanted || s === `${wanted};`)).toHaveLength(1);
    // The CPO is part of the key; there is no constraint on charge_point_id alone.
    expect(statements.some((s) => /EXCLUDE USING GIST \("charge_point_id"/.test(s))).toBe(false);
    // btree_gist (needed for uuid/text equality in an exclusion) is created by migration 0001, before this one.
    expect(readFileSync(path.join(DRIZZLE_DIR, "0001_restore_temporal_and_status_constraints.sql"), "utf8")).toMatch(/CREATE EXTENSION IF NOT EXISTS btree_gist/);
  });

  it("orders the backfill before the exclusion constraint and the NULL-together check, so legacy rows are covered", () => {
    const at = (needle: string) => statements.findIndex((s) => s.includes(needle));
    expect(at("UPDATE")).toBeGreaterThan(at('ADD COLUMN "charge_point_id"'));
    expect(at("device_identities_one_device_per_cpo_charge_point_id_at_a_time")).toBeGreaterThan(at("UPDATE"));
  });

  it.each([
    ["device_identities", "device_identities_cpo_and_charge_point_id_together", `CHECK (("cpo_org_id" IS NULL) = ("charge_point_id" IS NULL))`],
    ["installation_drafts", "installation_drafts_state_values", `CHECK ("state" IN ('open', 'consumed', 'discarded'))`],
    ["installation_drafts", "installation_drafts_consumed_names_installation", `CHECK (("state" = 'consumed') = ("installation_id" IS NOT NULL))`],
    ["installation_drafts", "installation_drafts_closed_when_not_open", `CHECK (("state" = 'open') = ("closed_at" IS NULL))`],
    ["installation_drafts", "installation_drafts_payload_is_object", `CHECK (jsonb_typeof("payload") = 'object')`],
    ["installation_drafts", "installation_drafts_revision_positive", `CHECK ("revision" >= 1)`],
  ])("carries %s.%s exactly once", (table, name, definition) => {
    const schema = table === "device_identities" ? "assets" : "properties";
    const wanted = `ALTER TABLE "${schema}"."${table}" ADD CONSTRAINT "${name}" ${definition}`;
    expect(statements.filter((s) => s === wanted || s === `${wanted};`)).toHaveLength(1);
  });

  it("indexes the admission lookup by CPO and lower-cased id", () => {
    expect(statements.some((s) => s.startsWith("CREATE INDEX") && s.includes('"device_identities_cpo_org_id_lower_charge_point_id_index"') && s.includes('("cpo_org_id",lower("charge_point_id"))'))).toBe(true);
  });
});
