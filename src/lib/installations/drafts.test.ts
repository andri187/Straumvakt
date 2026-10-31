// Unfinished-form drafts, and the CPO-scoped charger identity they sit beside.
// These run against the in-memory store, which proves the SERVICE rules
// (ordering, rollback, single use, scoping, no overwrite of newer text). They do
// not prove PostgreSQL behaviour: the unique and exclusion constraints, row locks
// and the concurrent-request paths are exercised only on an approved target.

import { describe, expect, it } from "vitest";
import type { Actor } from "./actor";
import { sharedLoginActor } from "./actor";
import { MemoryStore } from "./__tests__/memory-store";
import { MAX_OPEN_DRAFTS, discardDraft, getDraft, listDrafts, saveDraft, sameDocument } from "./drafts";
import { DraftPayload, SaveInstallationInput } from "./model";
import { saveInstallation, type ServiceDeps } from "./service";

const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER_ORG = "22222222-2222-4222-8222-222222222222";
const SITE = "33333333-3333-4333-8333-333333333333";
const OTHER_SITE = "44444444-4444-4444-8444-444444444444";
const actor = sharedLoginActor("Straumvakt");
// A future per-CPO account that may not touch these organisations. The type is a literal today, hence the cast.
const outsider = { kind: "shared_login", label: "outsider", platformOperator: false } as unknown as Actor;

const uuid = () => crypto.randomUUID();

function world() {
  const store = new MemoryStore();
  store.seedOrg(ORG, "Nordic Charge", SITE);
  store.seedOrg(OTHER_ORG, "Harbour Power", OTHER_SITE);
  return store;
}

const keys = (...list: string[]) => {
  let i = 0;
  return () => list[Math.min(i++, list.length - 1)];
};

const input = (over: Record<string, unknown> = {}) =>
  SaveInstallationInput.parse({
    orgId: ORG,
    siteId: SITE,
    idempotencyKey: uuid(),
    installation: { displayName: "Harbour car park" },
    electrician: {},
    circuits: [],
    chargers: [],
    ...over,
  });

const saveDeps = (newKey?: () => string): ServiceDeps => ({ newKey, hashPassword: async (p) => `v(${p.length})`, now: () => new Date("2026-10-30T12:00:00Z") });

/** A form as typed so far: as incomplete and as invalid as the operator left it. */
const form = (over: Record<string, unknown> = {}) => ({ name: "Harbour", siteId: "", mainType: "", mainAmps: "63x", mainPhases: "", eName: "", eEmail: "not an email", ePhone: "", effectiveAt: "", pwPending: false, circuits: [], chargers: [], ...over });

const save = (store: MemoryStore, over: Record<string, unknown> = {}) =>
  saveDraft(store, { draftId: over.draftId as string ?? uuid(), orgId: (over.orgId as string | null | undefined) === undefined ? ORG : (over.orgId as string | null), expectedRevision: over.expectedRevision as number | undefined, payload: over.payload ?? form() }, (over.actor as Actor) ?? actor);

describe("saving a draft", () => {
  it("keeps the form exactly as typed, incomplete and invalid values included, and creates nothing", async () => {
    const store = world();
    const id = uuid();
    const { draft, created } = await save(store, { draftId: id, payload: form({ chargers: [{ id: "new-1", circuitId: "new-c", label: "", chargePointId: "bad id!", vendor: "", model: "", serialNumber: "" }], circuits: [{ id: "new-c", parentId: null, displayName: "", ratingAmps: "abc", phaseCount: "" }] }) });
    expect(created).toBe(true);
    expect(draft).toMatchObject({ id, orgId: ORG, orgName: "Nordic Charge", state: "open", revision: 1 });
    expect((draft.payload as { mainAmps: string }).mainAmps).toBe("63x");
    expect((draft.payload as { chargers: { chargePointId: string }[] }).chargers[0].chargePointId).toBe("bad id!");
    const s = store.state;
    expect([s.installations.size, s.devices.size, s.identities.length, s.placements.length, s.circuits.size, s.changes.length]).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it("allows a draft with no organisation chosen yet", async () => {
    const store = world();
    const { draft } = await save(store, { orgId: null });
    expect(draft).toMatchObject({ orgId: null, orgName: null, state: "open" });
  });

  it("never stores a password: the shape has no such field and anything extra is refused", async () => {
    const store = world();
    for (const evil of [{ password: "hunter2hunter2" }, { pwValue: "hunter2hunter2" }, { password: { action: "set", value: "x".repeat(20) } }]) {
      await expect(save(store, { payload: { ...form(), ...evil } })).rejects.toMatchObject({ code: "validation" });
    }
    await expect(save(store, { payload: { ...form(), circuits: [{ id: "c", displayName: "x", password: "nope" }] } })).rejects.toMatchObject({ code: "validation" });
    // Only the fact that a password was being typed is kept (a flag), never the value.
    expect(DraftPayload.safeParse(form({ pwPending: true })).success).toBe(true);
    expect(DraftPayload.safeParse(form({ pwPending: "hunter2hunter2" })).success).toBe(false);
    expect(DraftPayload.safeParse(form({ pwChoice: "set" })).success).toBe(false);
    expect(store.state.drafts.size).toBe(0);
    expect(JSON.stringify([...store.state.drafts.values()])).not.toMatch(/hunter2/);
  });

  it("refuses oversized or malformed documents without storing anything", async () => {
    const store = world();
    await expect(save(store, { payload: form({ name: "x".repeat(121) }) })).rejects.toMatchObject({ code: "validation" });
    await expect(save(store, { payload: form({ mainPhases: "4" }) })).rejects.toMatchObject({ code: "validation" });
    await expect(save(store, { payload: "nope" })).rejects.toMatchObject({ code: "validation" });
    await expect(save(store, { payload: form({ circuits: Array.from({ length: 201 }, (_, i) => ({ id: `c${i}`, displayName: "" })) }) })).rejects.toMatchObject({ code: "validation" });
    expect(store.state.drafts.size).toBe(0);
  });

  it("is idempotent: a double click or a retry after a lost response changes nothing", async () => {
    const store = world();
    const id = uuid();
    const first = await save(store, { draftId: id });
    const again = await save(store, { draftId: id }); // no revision: the response was lost
    expect(again).toMatchObject({ created: false, unchanged: true });
    expect(again.draft.revision).toBe(first.draft.revision);
    expect(store.state.drafts.size).toBe(1);
    const withRev = await save(store, { draftId: id, expectedRevision: 1 });
    expect(withRev).toMatchObject({ unchanged: true });
  });

  it("an update names the revision it was built on and bumps it", async () => {
    const store = world();
    const id = uuid();
    await save(store, { draftId: id });
    const next = await save(store, { draftId: id, expectedRevision: 1, payload: form({ name: "Harbour car park" }) });
    expect(next).toMatchObject({ created: false, unchanged: false });
    expect(next.draft).toMatchObject({ revision: 2 });
    expect((next.draft.payload as { name: string }).name).toBe("Harbour car park");
  });

  it("refuses a late or second-tab save instead of overwriting newer text", async () => {
    const store = world();
    const id = uuid();
    await save(store, { draftId: id });
    await save(store, { draftId: id, expectedRevision: 1, payload: form({ name: "Newer text" }) });
    // A response from before the newer save arrives late and tries to save its older text on revision 1.
    await expect(save(store, { draftId: id, expectedRevision: 1, payload: form({ name: "Older text" }) })).rejects.toMatchObject({ code: "stale_revision", detail: { currentRevision: 2 } });
    // Saving without any revision, with different text, is refused too: only identical text is treated as a replay.
    await expect(save(store, { draftId: id, payload: form({ name: "Blind overwrite" }) })).rejects.toMatchObject({ code: "stale_revision" });
    expect((await getDraft(store, id, actor))!.payload).toMatchObject({ name: "Newer text" });
  });

  it("changing only the organisation is a change and needs the revision", async () => {
    const store = world();
    const id = uuid();
    await save(store, { draftId: id });
    await expect(save(store, { draftId: id, orgId: OTHER_ORG })).rejects.toMatchObject({ code: "stale_revision" });
    const moved = await save(store, { draftId: id, orgId: OTHER_ORG, expectedRevision: 1 });
    expect(moved.draft).toMatchObject({ orgId: OTHER_ORG, orgName: "Harbour Power", revision: 2 });
  });

  it("cannot update a draft that does not exist, belongs to an organisation the actor cannot use, or is closed", async () => {
    const store = world();
    await expect(save(store, { expectedRevision: 1 })).rejects.toMatchObject({ code: "not_found" });
    await expect(save(store, { orgId: uuid() })).rejects.toMatchObject({ code: "not_found" }); // unknown organisation
    await expect(save(store, { actor: outsider })).rejects.toMatchObject({ code: "forbidden" });
    const id = uuid();
    await save(store, { draftId: id });
    await discardDraft(store, { draftId: id }, actor);
    await expect(save(store, { draftId: id, expectedRevision: 1, payload: form({ name: "Back from the dead" }) })).rejects.toMatchObject({ code: "draft_unavailable" });
    expect((await getDraft(store, id, actor))!.state).toBe("discarded");
  });

  it("caps unfinished drafts and frees a slot when one is discarded", async () => {
    const store = world();
    const ids: string[] = [];
    for (let i = 0; i < MAX_OPEN_DRAFTS; i++) {
      const id = uuid();
      ids.push(id);
      await save(store, { draftId: id });
    }
    await expect(save(store, {})).rejects.toMatchObject({ code: "draft_unavailable" });
    await discardDraft(store, { draftId: ids[0] }, actor);
    await expect(save(store, {})).resolves.toMatchObject({ created: true });
  });

  it("compares documents by content, not key order", () => {
    expect(sameDocument({ a: 1, b: { c: [1, 2] } }, { b: { c: [1, 2] }, a: 1 })).toBe(true);
    expect(sameDocument({ a: 1 }, { a: 2 })).toBe(false);
  });
});

describe("creating an installation from a draft", () => {
  it("closes the draft in the same transaction as the installation", async () => {
    const store = world();
    const { draft } = await save(store);
    const saved = await saveInstallation(store, input({ draftId: draft.id }), actor, saveDeps());
    expect(await getDraft(store, draft.id, actor)).toMatchObject({ state: "consumed", installationId: saved.snapshot.installation.id });
    expect(await listDrafts(store, actor)).toEqual([]);
  });

  it("required fields are checked at creation, not when the draft is saved", async () => {
    const store = world();
    const { draft } = await save(store, { payload: form({ name: "" }) }); // no name, no site: fine as a draft
    // The create contract is what refuses it: an empty name never reaches the service, and the draft stays open for another try.
    const attempt = SaveInstallationInput.safeParse({ orgId: ORG, siteId: SITE, draftId: draft.id, idempotencyKey: uuid(), installation: { displayName: "" }, electrician: {}, circuits: [], chargers: [] });
    expect(attempt.success).toBe(false);
    expect(store.state.installations.size).toBe(0);
    expect((await getDraft(store, draft.id, actor))!.state).toBe("open");
  });

  it("a failed create keeps the draft open and a later create succeeds", async () => {
    const store = world();
    const { draft } = await save(store);
    await expect(saveInstallation(store, input({ siteId: OTHER_SITE, draftId: draft.id }), actor, saveDeps())).rejects.toMatchObject({ code: "not_found" });
    expect((await getDraft(store, draft.id, actor))!.state).toBe("open");
    await expect(saveInstallation(store, input({ draftId: draft.id }), actor, saveDeps())).resolves.toMatchObject({ replayed: false });
  });

  it("answers a repeated create as a replay and never makes a second installation", async () => {
    const store = world();
    const { draft } = await save(store);
    const body = input({ draftId: draft.id });
    const first = await saveInstallation(store, body, actor, saveDeps());
    const replay = await saveInstallation(store, body, actor, saveDeps());
    expect(replay).toMatchObject({ replayed: true });
    expect(replay.snapshot.installation.id).toBe(first.snapshot.installation.id);
    expect(store.state.installations.size).toBe(1);
  });

  it("a second, different create from a used draft is refused, so a lost first answer cannot duplicate", async () => {
    const store = world();
    const { draft } = await save(store);
    await saveInstallation(store, input({ draftId: draft.id }), actor, saveDeps());
    await expect(saveInstallation(store, input({ draftId: draft.id }), actor, saveDeps(keys("anotherkeyxx")))).rejects.toMatchObject({ code: "draft_unavailable" });
    expect(store.state.installations.size).toBe(1);
  });

  it("a discarded draft refuses the create: a discard is never silently undone", async () => {
    const store = world();
    const { draft } = await save(store);
    await discardDraft(store, { draftId: draft.id }, actor);
    await expect(saveInstallation(store, input({ draftId: draft.id }), actor, saveDeps())).rejects.toMatchObject({ code: "draft_unavailable" });
    expect(store.state.installations.size).toBe(0);
  });

  it("says WHY a draft is closed, and names the existing installation when it was used, so a second tab recovers instead of duplicating", async () => {
    const store = world();
    const { draft } = await save(store);
    const made = await saveInstallation(store, input({ draftId: draft.id }), actor, saveDeps());
    const used = { code: "draft_unavailable", detail: { state: "consumed", installationId: made.snapshot.installation.id } };
    await expect(saveInstallation(store, input({ draftId: draft.id }), actor, saveDeps(keys("anotherkeyxx")))).rejects.toMatchObject(used);
    await expect(save(store, { draftId: draft.id, expectedRevision: 1, payload: form({ name: "Edited in tab two" }) })).rejects.toMatchObject(used);

    const second = (await save(store)).draft;
    await discardDraft(store, { draftId: second.id }, actor);
    await expect(saveInstallation(store, input({ draftId: second.id }), actor, saveDeps(keys("thirdkeyxxxx")))).rejects.toMatchObject({ code: "draft_unavailable", detail: { state: "discarded" } });
    await expect(save(store, { draftId: second.id, expectedRevision: 1, payload: form({ name: "x" }) })).rejects.toMatchObject({ code: "draft_unavailable", detail: { state: "discarded" } });
    expect(store.state.installations.size).toBe(1);
  });

  it("the draft limit is its own reason, not a closed draft", async () => {
    const store = world();
    for (let i = 0; i < MAX_OPEN_DRAFTS; i++) await save(store);
    await expect(save(store, {})).rejects.toMatchObject({ code: "draft_unavailable", detail: { state: "limit" } });
  });

  it("an unknown draft id, or one the actor may not use, cannot be used to create", async () => {
    const store = world();
    const { draft } = await save(store);
    await expect(saveInstallation(store, input({ draftId: uuid() }), actor, saveDeps())).rejects.toMatchObject({ code: "not_found", message: "Draft not found" });
    await expect(saveInstallation(store, input({ draftId: draft.id }), outsider, saveDeps())).rejects.toMatchObject({ code: "forbidden" });
    expect((await getDraft(store, draft.id, actor))!.state).toBe("open");
  });

  it("works without a draft exactly as before", async () => {
    const store = world();
    const saved = await saveInstallation(store, input(), actor, saveDeps(keys("directsavedk")));
    expect(saved.snapshot.installation.key).toBe("directsavedk");
    expect(store.state.drafts.size).toBe(0);
  });
});

describe("discarding a draft", () => {
  it("closes the draft and nothing else", async () => {
    const store = world();
    const existing = await saveInstallation(
      store,
      input({
        circuits: [{ id: "new-c1", displayName: "Main", ratingAmps: 32, phaseCount: 3 }],
        chargers: [{ id: "new-ch1", circuitId: "new-c1", label: "Bay 1", chargePointId: "CP-001" }],
      }),
      actor,
      saveDeps(keys("existingkeyx")),
    );
    const snap = () => JSON.stringify({ i: [...store.state.installations], d: [...store.state.devices], id: store.state.identities, p: store.state.placements, c: store.state.changes, o: [...store.state.orgs], s: [...store.state.sites] });
    const before = snap();

    const { draft } = await save(store);
    expect(await discardDraft(store, { draftId: draft.id }, actor)).toEqual({ outcome: "discarded" });

    expect(snap()).toBe(before); // organisations, sites, installations, chargers, identities and history untouched
    expect(store.snapshot(existing.snapshot.installation.id)!.chargers).toHaveLength(1);
    expect((await getDraft(store, draft.id, actor))!.state).toBe("discarded");
    expect(await listDrafts(store, actor)).toEqual([]);
  });

  it("is idempotent, never reopens, and reports an already-used draft without touching its installation", async () => {
    const store = world();
    const a = await save(store);
    await discardDraft(store, { draftId: a.draft.id }, actor);
    expect(await discardDraft(store, { draftId: a.draft.id }, actor)).toEqual({ outcome: "already_discarded" });

    const b = await save(store);
    const saved = await saveInstallation(store, input({ draftId: b.draft.id }), actor, saveDeps());
    expect(await discardDraft(store, { draftId: b.draft.id }, actor)).toEqual({ outcome: "already_used", installationId: saved.snapshot.installation.id });
    expect(store.snapshot(saved.snapshot.installation.id)).not.toBeNull();
  });

  it("answers not_found for an unknown draft and for one the actor may not use, identically", async () => {
    const store = world();
    const { draft } = await save(store);
    const unknown = await discardDraft(store, { draftId: uuid() }, actor).catch((e) => e);
    const forbidden = await discardDraft(store, { draftId: draft.id }, outsider).catch((e) => e);
    expect(unknown).toMatchObject({ code: "not_found", message: forbidden.message });
    expect(forbidden).toMatchObject({ code: "not_found" });
    expect((await getDraft(store, draft.id, actor))!.state).toBe("open");
    expect(await getDraft(store, draft.id, outsider)).toBeNull();
    expect(await listDrafts(store, outsider)).toEqual([]);
  });
});

describe("resuming", () => {
  it("lists only open drafts, most recently changed first, and returns the whole form after a reload", async () => {
    const store = world();
    const a = await save(store, { payload: form({ name: "First" }) });
    const b = await save(store, { payload: form({ name: "Second" }) });
    const c = await save(store, { payload: form({ name: "Third" }) });
    await discardDraft(store, { draftId: b.draft.id }, actor);
    await saveInstallation(store, input({ draftId: c.draft.id }), actor, saveDeps());
    expect((await listDrafts(store, actor)).map((d) => d.id)).toEqual([a.draft.id]);
    // "Reload" is reading the row again: the same document, the same revision.
    const reloaded = (await getDraft(store, a.draft.id, actor))!;
    expect(reloaded).toMatchObject({ revision: 1, orgName: "Nordic Charge", state: "open" });
    expect(reloaded.payload).toMatchObject({ name: "First", mainAmps: "63x", eEmail: "not an email" });
  });
});

describe("charger identity is scoped to the CPO, not the installation", () => {
  const charger = (id: string, circuit: string, cp: string, serial?: string) => ({ id, circuitId: circuit, label: `Charger ${cp}`, chargePointId: cp, ...(serial ? { serialNumber: serial } : {}) });
  const circuit = (id: string) => ({ id, displayName: "Main", ratingAmps: 32, phaseCount: 3 });

  it("refuses the same charge point id in two installations of one CPO, whichever order they are saved in", async () => {
    const store = world();
    await saveInstallation(store, input({ circuits: [circuit("new-c1")], chargers: [charger("new-a", "new-c1", "CP-001")] }), actor, saveDeps(keys("installone01")));
    const second = await saveInstallation(store, input({ installation: { displayName: "Second" } }), actor, saveDeps(keys("installtwo02")));
    const clash = saveInstallation(
      store,
      input({ installationId: second.snapshot.installation.id, orgId: undefined, siteId: undefined, expectedRevision: 1, circuits: [circuit("new-c2")], chargers: [charger("new-b", "new-c2", "CP-001")] }),
      actor,
      saveDeps(),
    );
    await expect(clash).rejects.toMatchObject({ code: "identity_in_use" });
    expect(store.state.identities.filter((i) => i.open && i.chargePointId === "CP-001")).toHaveLength(1);
  });

  it("allows the same charge point id in two different CPOs", async () => {
    const store = world();
    await saveInstallation(store, input({ circuits: [circuit("new-c1")], chargers: [charger("new-a", "new-c1", "CP-001")] }), actor, saveDeps(keys("installone01")));
    await saveInstallation(store, input({ orgId: OTHER_ORG, siteId: OTHER_SITE, circuits: [circuit("new-c2")], chargers: [charger("new-b", "new-c2", "CP-001")] }), actor, saveDeps(keys("installtwo02")));
    expect(store.state.identities.map((i) => [i.cpoOrgId, i.chargePointId]).sort()).toEqual([[ORG, "CP-001"], [OTHER_ORG, "CP-001"]]);
  });

  it("treats a case-only difference as a different id (exact match), exactly as admission does", async () => {
    const store = world();
    await saveInstallation(store, input({ circuits: [circuit("new-c1")], chargers: [charger("new-a", "new-c1", "CP-001")] }), actor, saveDeps(keys("installone01")));
    await expect(saveInstallation(store, input({ installation: { displayName: "Two" }, circuits: [circuit("new-c2")], chargers: [charger("new-b", "new-c2", "cp-001")] }), actor, saveDeps(keys("installtwo02")))).resolves.toBeTruthy();
  });

  it("the stored identity is the CPO plus the id as typed; the serial number is a separate field", async () => {
    const store = world();
    const saved = await saveInstallation(store, input({ circuits: [circuit("new-c1")], chargers: [charger("new-a", "new-c1", "CP-001", "SN-9")] }), actor, saveDeps());
    expect(store.state.identities).toEqual([expect.objectContaining({ cpoOrgId: ORG, chargePointId: "CP-001", open: true })]);
    expect(saved.snapshot.chargers[0]).toMatchObject({ chargePointId: "CP-001", serialNumber: "SN-9" });
  });

  it("changing a charge point id closes the old identity and opens a new one in the same CPO", async () => {
    const store = world();
    const first = await saveInstallation(store, input({ circuits: [circuit("new-c1")], chargers: [charger("new-a", "new-c1", "CP-001")] }), actor, saveDeps());
    const ch = first.snapshot.chargers[0];
    const circ = first.snapshot.circuits[0];
    await saveInstallation(
      store,
      input({
        installationId: first.snapshot.installation.id, orgId: undefined, siteId: undefined, expectedRevision: first.snapshot.installation.revision,
        circuits: [{ id: circ.id, displayName: "Main", ratingAmps: 32, phaseCount: 3 }],
        chargers: [{ id: ch.id, circuitId: circ.id, label: ch.label, chargePointId: "CP-002" }],
      }),
      actor,
      saveDeps(),
    );
    expect(store.state.identities.map((i) => [i.chargePointId, i.open])).toEqual([["CP-001", false], ["CP-002", true]]);
  });
});
