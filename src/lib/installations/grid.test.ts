// TN/IT supply system on the installation: accepted values, persistence through the real service (against the
// in-memory store, which proves the service contract and NOT PostgreSQL), audit, drafts, and the 0009 migration text.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import { installations } from "@straumvakt/shared/db/assets";
import { sharedLoginActor } from "./actor";
import { MemoryStore } from "./__tests__/memory-store";
import { toView } from "./api";
import { getDraft, saveDraft } from "./drafts";
import { DraftPayload, SaveInstallationInput } from "./model";
import { saveInstallation } from "./service";

const ORG = "11111111-1111-4111-8111-111111111111";
const SITE = "33333333-3333-4333-8333-333333333333";
const actor = sharedLoginActor("Straumvakt");
const uuid = () => crypto.randomUUID();
const deps = { hashPassword: async (p: string) => `v(${p.length})`, now: () => new Date("2026-10-30T12:00:00Z") };

function world() {
  const store = new MemoryStore();
  store.seedOrg(ORG, "Nordic Charge", SITE);
  return store;
}

const input = (installation: Record<string, unknown> = {}, over: Record<string, unknown> = {}) =>
  SaveInstallationInput.parse({ orgId: ORG, siteId: SITE, idempotencyKey: uuid(), installation: { displayName: "Harbour", ...installation }, electrician: {}, circuits: [], chargers: [], ...over });

describe("TN/IT on the installation", () => {
  it("accepts TN and IT, and anything else is refused", () => {
    expect(input({ mainGridType: "TN" }).installation.mainGridType).toBe("TN");
    expect(input({ mainGridType: "IT" }).installation.mainGridType).toBe("IT");
    expect(input({ mainGridType: null }).installation.mainGridType).toBeNull();
    for (const bad of ["TT", "tn", "", "TN-S", 1, true]) {
      expect(SaveInstallationInput.safeParse({ orgId: ORG, siteId: SITE, idempotencyKey: uuid(), installation: { displayName: "x", mainGridType: bad }, electrician: {}, circuits: [], chargers: [] }).success).toBe(false);
    }
  });

  it("an omitted value is not specified: nothing defaults to TN, and nothing is inferred from phases or rating", () => {
    const parsed = input({ mainPhaseCount: 3, mainRatingAmps: 63 });
    expect(parsed.installation.mainGridType).toBeNull();
  });

  it("survives create, read and edit, with each change in the audit history", async () => {
    const store = world();
    const created = await saveInstallation(store, input({ mainGridType: "TN" }), actor, deps);
    expect(created.snapshot.installation.mainGridType).toBe("TN");
    expect(toView(created.snapshot, "nordic-charge").installation.mainGridType).toBe("TN");
    expect(store.snapshot(created.snapshot.installation.id)!.installation.mainGridType).toBe("TN");

    const id = created.snapshot.installation.id;
    const edited = await saveInstallation(store, input({ mainGridType: "IT" }, { installationId: id, expectedRevision: 1, orgId: undefined, siteId: undefined }), actor, deps);
    expect(edited.snapshot.installation.mainGridType).toBe("IT");
    expect(store.state.changes.find((c) => c.diff.mainGridType && c.diff.mainGridType.from === "TN")?.diff.mainGridType).toEqual({ from: "TN", to: "IT" });
    expect(store.state.changes.find((c) => c.action === "create")?.diff.mainGridType).toEqual({ from: null, to: "TN" });

    const cleared = await saveInstallation(store, input({ mainGridType: null }, { installationId: id, expectedRevision: 2, orgId: undefined, siteId: undefined }), actor, deps);
    expect(cleared.snapshot.installation.mainGridType).toBeNull();
  });

  it("an installation saved without it stays unknown through an unrelated edit", async () => {
    const store = world();
    const created = await saveInstallation(store, input({ mainPhaseCount: 3 }), actor, deps);
    expect(created.snapshot.installation.mainGridType).toBeNull();
    const id = created.snapshot.installation.id;
    const again = await saveInstallation(store, input({ displayName: "Renamed", mainPhaseCount: 3 }, { installationId: id, expectedRevision: 1, orgId: undefined, siteId: undefined }), actor, deps);
    expect(again.snapshot.installation.mainGridType).toBeNull();
    expect(store.state.changes.some((c) => c.diff.mainGridType)).toBe(false);
  });

  it("drafts keep it, resume it, and an old draft without it is unknown", async () => {
    const store = world();
    const id = uuid();
    const form = { name: "Draft", siteId: "", mainType: "", mainAmps: "0", mainPhases: "", eName: "", eEmail: "", ePhone: "", effectiveAt: "", pwPending: false, circuits: [], chargers: [] };
    await saveDraft(store, { draftId: id, orgId: ORG, payload: { ...form, mainGrid: "IT" } }, actor);
    expect((await getDraft(store, id, actor))!.payload.mainGrid).toBe("IT");
    expect(DraftPayload.safeParse({ ...form, mainGrid: "TT" }).success).toBe(false);
    const old = DraftPayload.parse(form);
    expect(old.mainGrid).toBe("");
    await expect(saveDraft(store, { draftId: uuid(), orgId: ORG, payload: { ...form, mainGrid: "TT" } }, actor)).rejects.toMatchObject({ code: "validation" });
  });
});

describe("migration 0009: installation supply system", () => {
  const DIR = path.join(__dirname, "..", "..", "..", "apps", "api", "drizzle");
  const sql = readFileSync(path.join(DIR, "0009_installation_main_grid_type.sql"), "utf8");

  it("is the next journal entry after the unreleased 0008 candidate", () => {
    const journal = JSON.parse(readFileSync(path.join(DIR, "meta", "_journal.json"), "utf8")) as { entries: { idx: number; tag: string }[] };
    journal.entries.forEach((e, i) => expect(e.idx).toBe(i));
    expect(journal.entries[9]).toMatchObject({ idx: 9, tag: "0009_installation_main_grid_type" });
    expect(journal.entries[8].tag).toBe("0008_installation_drafts_and_cpo_identity");
  });

  it("is additive and nullable, with a TN/IT-only check and no backfill", () => {
    const text = sql.replace(/--(?!>)[^\r\n]*/g, "");
    expect(text).toMatch(/ADD COLUMN "main_grid_type" text;/);
    expect(text).not.toMatch(/NOT NULL|DEFAULT|UPDATE |DROP |DELETE /i);
    expect(text).toMatch(/CHECK \("main_grid_type" IS NULL OR "main_grid_type" IN \('TN', 'IT'\)\)/);
  });

  it("matches the Drizzle declaration", () => {
    const col = getTableConfig(installations).columns.find((c) => c.name === "main_grid_type");
    expect(col).toBeDefined();
    expect(col!.notNull).toBe(false);
    expect(col!.hasDefault).toBe(false);
  });
});
