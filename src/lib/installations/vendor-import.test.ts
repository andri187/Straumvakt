import { describe, expect, it } from "vitest";
import { sharedLoginActor } from "./actor";
import { MemoryStore } from "./__tests__/memory-store";
import { MAX_CHARGERS, MAX_CIRCUITS, MAX_TREE_DEPTH, NEW_ID_PREFIX, SaveInstallationInput } from "./model";
import { planSave } from "./plan";
import { saveInstallation, type ServiceDeps } from "./service";
import { SaveError } from "./store";
import { LIMITS, importKey, importMetadata, mapPackageToSave, parseVendorPackage, VendorImportInput, type MapOptions } from "./vendor-import";

const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER_ORG = "22222222-2222-4222-8222-222222222222";
const SITE = "33333333-3333-4333-8333-333333333333";
const OTHER_SITE = "44444444-4444-4444-8444-444444444444";
const actor = sharedLoginActor("Straumvakt");

let counter = 0;
const deps = (): ServiceDeps => ({
  newId: () => `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`,
  newKey: () => `key${String(++counter).padStart(9, "0")}`,
  now: () => new Date("2026-10-31T19:00:00Z"),
});

function seeded() {
  const store = new MemoryStore();
  store.seedOrg(ORG, "Nordic Charge ehf.", SITE);
  store.seedOrg(OTHER_ORG, "Other CPO", OTHER_SITE);
  return store;
}

const rawPackage = (over: Record<string, unknown> = {}) => ({
  kind: "straumvakt-vendor-site",
  version: 1,
  vendor: "easee",
  capturedAt: "2026-10-31T18:00:00.000Z",
  site: { ref: "4821", name: "Grandavegur 3", siteKey: "ELFX-YA22", ratedCurrentAmps: 63, maxAllocatedCurrentAmps: 0, useDynamicMaster: true, address: { line: "Grandavegur 3", city: "Reykjavik" } },
  circuits: [
    { ref: "11", parentRef: null, name: "Panel A", ratedCurrentAmps: 40, use3Phase: true, limits: { maxCircuitCurrent: [32, 32, 32], offlineMaxCircuitCurrent: [6, null, null], dynamicCircuitCurrent: null }, chargerRefs: ["EH000001", "EH000002"] },
    { ref: "12", parentRef: "11", name: "Sub panel", ratedCurrentAmps: 0, use3Phase: false, chargerRefs: [] },
  ],
  equipment: [
    { ref: "EH000001", name: "Bilskur 1", circuitRef: "11", productCode: "100" },
    { ref: "EH000002", name: "Bilskur 2", circuitRef: "11" },
    { ref: "EH000003", name: "Loose", circuitRef: null },
  ],
  equalizers: [{ ref: "EQ1", name: "Meter" }],
  fieldsObserved: ["ratedCurrent", "circuits.panelName"],
  notCaptured: ["site users and driver access"],
  ...over,
});

function parsed(over: Record<string, unknown> = {}) {
  const r = parseVendorPackage(rawPackage(over));
  if (!r.ok) throw new Error(JSON.stringify(r.problems));
  return r.package;
}

function prepare(opts: Partial<MapOptions> = {}, pkgOver: Record<string, unknown> = {}, org = ORG, site = SITE) {
  const mapped = mapPackageToSave(parsed(pkgOver), { siteId: site, idempotencyKey: crypto.randomUUID(), ...opts });
  return { mapped, input: SaveInstallationInput.parse({ ...mapped.input, orgId: org }) };
}

describe("package contract", () => {
  it("accepts the fixture and keeps nothing outside the allowlist", () => {
    const r = parseVendorPackage(
      rawPackage({
        contactInfo: { ownerName: "Jon Jonsson" },
        accessToken: "token-never",
        site: { ref: "4821", name: "X", password: "pw-never", costPerKWh: 18.5 },
        equipment: [{ ref: "EH000001", name: "A", circuitRef: null, rfids: ["TAG-SECRET"] }],
      }),
    );
    expect(r.ok).toBe(true);
    expect(JSON.stringify(r)).not.toMatch(/Jon Jonsson|token-never|pw-never|18\.5|TAG-SECRET/);
  });

  it("keeps zero and false as values and absence as null", () => {
    const p = parsed();
    expect(p.site.maxAllocatedCurrentAmps).toBe(0);
    expect(p.circuits[1]).toMatchObject({ ratedCurrentAmps: 0, use3Phase: false });
    expect(p.circuits[1].limits).toEqual({ maxCircuitCurrent: null, offlineMaxCircuitCurrent: null, dynamicCircuitCurrent: null });
    const bare = parsed({ site: { ref: "S1" }, circuits: [], equipment: [] });
    expect(bare.site).toMatchObject({ name: null, ratedCurrentAmps: null, useDynamicMaster: null, address: null });
  });

  it("rejects a wrong kind, version or vendor, malformed references, duplicates and out-of-range values", () => {
    const bad: Record<string, unknown>[] = [
      { kind: "other" },
      { version: 2 },
      { vendor: "Bad Vendor!" },
      { vendor: "" },
      { capturedAt: "yesterday" },
      { site: { ref: "../x" } },
      { site: { ref: "" } },
      { site: { ref: "4821", ratedCurrentAmps: -1 } },
      { site: { ref: "4821", ratedCurrentAmps: 99999 } },
      { circuits: [{ ref: "11" }, { ref: "11" }] },
      { equipment: [{ ref: "E1" }, { ref: "E1" }] },
      { circuits: Array.from({ length: LIMITS.circuits + 1 }, (_, i) => ({ ref: `c${i}` })) },
      { equipment: Array.from({ length: LIMITS.equipment + 1 }, (_, i) => ({ ref: `e${i}` })) },
    ];
    for (const over of bad) expect(parseVendorPackage(rawPackage(over)).ok, JSON.stringify(over)).toBe(false);
    expect(parseVendorPackage(null).ok).toBe(false);
    expect(parseVendorPackage("text").ok).toBe(false);
  });

  it("uses the same limits and id prefix as the save contract", () => {
    expect(LIMITS.circuits).toBe(MAX_CIRCUITS);
    expect(LIMITS.equipment).toBe(MAX_CHARGERS);
    expect(LIMITS.depth).toBe(MAX_TREE_DEPTH);
    expect(LIMITS.newIdPrefix).toBe(NEW_ID_PREFIX);
  });

  it("builds the stored snapshot from the validated package only, with each equipment item's attachment status", () => {
    const vi = VendorImportInput.parse({ package: rawPackage({ contactInfo: { ownerName: "Jon" } }), acceptedElectrical: true, attached: ["EH000001"] });
    const meta = importMetadata(vi, new Date("2026-10-31T19:00:00Z")).vendorImport;
    expect(meta).toMatchObject({ schemaVersion: 1, vendor: "easee", externalRef: "4821", capturedAt: "2026-10-31T18:00:00.000Z", importedAt: "2026-10-31T19:00:00.000Z", electricalValuesAccepted: true });
    expect(meta.equipment.map((e) => [e.ref, e.attachment])).toEqual([["EH000001", "attached"], ["EH000002", "needs_ocpp_identity"], ["EH000003", "needs_ocpp_identity"]]);
    expect(meta.circuits[0].limits.maxCircuitCurrent).toEqual([32, 32, 32]);
    expect(meta.notCaptured).toContain("site users and driver access");
    expect(JSON.stringify(meta)).not.toMatch(/Jon/);
    expect(importKey(vi)).toEqual({ vendor: "easee", externalRef: "4821" });
  });
});

describe("mapping onto the save contract", () => {
  it("makes the vendor site an installation, leaves electrical values unknown and keeps vendor ids apart from Straumvakt ids", () => {
    const { mapped, input } = prepare();
    expect(input.installation).toEqual({ displayName: "Grandavegur 3", mainDeviceType: null, mainRatingAmps: null, mainPhaseCount: null, mainGridType: null });
    expect(input.siteId).toBe(SITE);
    expect(input.circuits.map((c) => [c.id, c.parentId, c.vendorRef])).toEqual([[`${NEW_ID_PREFIX}vi-0`, null, "11"], [`${NEW_ID_PREFIX}vi-1`, `${NEW_ID_PREFIX}vi-0`, "12"]]);
    // The vendor's rated current is not a confirmed breaker rating: unknown until the operator accepts it.
    expect(input.circuits.map((c) => [c.ratingAmps, c.phaseCount])).toEqual([[null, null], [null, null]]);
    // No OCPP identity was supplied: nothing is invented from a vendor id, and nothing is dropped silently.
    expect(input.chargers).toEqual([]);
    expect(mapped.pendingEquipment.map((p) => [p.ref, p.reason])).toEqual([["EH000001", "needs_ocpp_identity"], ["EH000002", "needs_ocpp_identity"], ["EH000003", "needs_ocpp_identity"]]);
    expect(input.vendorImport?.attached).toEqual([]);
  });

  it("maps the vendor ratings only when the operator accepts them, and never turns false or zero into something else", () => {
    const { input } = prepare({ acceptVendorElectrical: true });
    expect(input.circuits.map((c) => [c.ratingAmps, c.phaseCount])).toEqual([[40, 3], [0, null]]);
    expect(input.installation.mainRatingAmps).toBeNull();
    expect(input.vendorImport?.acceptedElectrical).toBe(true);
  });

  it("creates a charger only from an OCPP id the operator typed, and reports the rest", () => {
    const { mapped, input } = prepare({ ocppIds: { EH000001: " CP-1 ", EH000002: "bad id", EH000003: "CP-3" } });
    expect(input.chargers).toHaveLength(1);
    expect(input.chargers[0]).toMatchObject({ circuitId: `${NEW_ID_PREFIX}vi-0`, label: "Bilskur 1", chargePointId: "CP-1", vendor: "Easee", model: null, serialNumber: null });
    expect(input.chargers[0].chargePointId).not.toBe("EH000001");
    expect(mapped.pendingEquipment.map((p) => [p.ref, p.reason])).toEqual([["EH000002", "invalid_ocpp_identity"], ["EH000003", "no_circuit"]]);
    expect(input.vendorImport?.attached).toEqual(["EH000001"]);
  });

  it("breaks loops, missing parents and over-deep nesting instead of failing the whole import", () => {
    const loop = prepare({}, { circuits: [{ ref: "A", parentRef: "B" }, { ref: "B", parentRef: "A" }, { ref: "C", parentRef: "ghost" }, { ref: "D", parentRef: "D" }], equipment: [] });
    expect(loop.input.circuits.map((c) => c.parentId)).toEqual([null, null, null, null]);
    expect(loop.mapped.warnings.length).toBe(4);
    const chain = Array.from({ length: LIMITS.depth + 2 }, (_, i) => ({ ref: `n${i}`, parentRef: i === 0 ? null : `n${i - 1}` }));
    const deep = prepare({}, { circuits: chain, equipment: [] });
    // The save contract's own tree validation (loops, parents, depth) accepts both results.
    expect(planSave(null, loop.input).ok).toBe(true);
    expect(planSave(null, deep.input).ok).toBe(true);
    expect(deep.input.circuits.length).toBe(chain.length);
    expect(deep.mapped.warnings.some((w) => w.includes("deeper"))).toBe(true);
  });

  it("falls back to the site key and then the vendor reference for a missing name", () => {
    expect(prepare({}, { site: { ref: "4821", name: "  ", siteKey: "ELFX-YA22" } }).input.installation.displayName).toBe("ELFX-YA22");
    expect(prepare({}, { site: { ref: "4821" } }).input.installation.displayName).toBe("Easee site 4821");
  });
});

describe("import through the one save service", () => {
  it("creates the installation, keeps vendor references and the snapshot, and records the import in the history", async () => {
    const store = seeded();
    const { input } = prepare({ acceptVendorElectrical: true, ocppIds: { EH000001: "CP-1" } });
    const result = await saveInstallation(store, input, actor, deps());
    expect(result.alreadyImported).toBeUndefined();
    const id = result.snapshot.installation.id;
    expect(result.snapshot.circuits.map((c) => [c.displayName, c.ratingAmps, c.phaseCount])).toEqual([["Panel A", 40, 3], ["Sub panel", 0, null]]);
    expect(result.snapshot.chargers).toHaveLength(1);
    expect(result.snapshot.chargers[0]).toMatchObject({ chargePointId: "CP-1", vendor: "Easee", serialNumber: null });
    expect([...store.state.circuits.values()].map((c) => c.vendorRef).sort()).toEqual(["11", "12"]);
    const stored = store.state.installations.get(id)!;
    expect(stored.vendorImport).toMatchObject({ vendor: "easee", externalRef: "4821" });
    const meta = stored.vendorImport!.metadata as { vendorImport: { equipment: { ref: string; attachment: string }[]; electricalValuesAccepted: boolean } };
    expect(meta.vendorImport.electricalValuesAccepted).toBe(true);
    expect(meta.vendorImport.equipment.map((e) => [e.ref, e.attachment])).toEqual([["EH000001", "attached"], ["EH000002", "needs_ocpp_identity"], ["EH000003", "needs_ocpp_identity"]]);
    expect(store.state.changes.find((c) => c.entityType === "installation")?.diff.vendorImport).toEqual({ from: null, to: "easee:4821" });
  });

  it("imports without any charger when no OCPP identity is known, keeping the equipment as evidence", async () => {
    const store = seeded();
    const result = await saveInstallation(store, prepare().input, actor, deps());
    expect(result.snapshot.chargers).toEqual([]);
    expect(store.state.devices.size).toBe(0);
    const meta = store.state.installations.get(result.snapshot.installation.id)!.vendorImport!.metadata as { vendorImport: { equipment: unknown[] } };
    expect(meta.vendorImport.equipment).toHaveLength(3);
  });

  it("answers a repeat with the first installation, even under a new idempotency key, and leaves the operator's edits alone", async () => {
    const store = seeded();
    const first = await saveInstallation(store, prepare().input, actor, deps());
    const id = first.snapshot.installation.id;
    // The operator renames the installation after the import.
    const renamed = SaveInstallationInput.parse({
      installationId: id, expectedRevision: 1, idempotencyKey: crypto.randomUUID(),
      installation: { displayName: "Renamed by operator" }, electrician: {},
      circuits: first.snapshot.circuits.map((c) => ({ id: c.id, parentId: c.parentId, displayName: c.displayName, ratingAmps: c.ratingAmps, phaseCount: c.phaseCount })),
      chargers: [],
    });
    await saveInstallation(store, renamed, actor, deps());
    const changesBefore = store.state.changes.length;
    const again = await saveInstallation(store, prepare().input, actor, deps());
    expect(again.alreadyImported).toBe(true);
    expect(again.unchanged).toBe(true);
    expect(again.snapshot.installation.id).toBe(id);
    expect(again.snapshot.installation.displayName).toBe("Renamed by operator");
    expect(store.state.installations.size).toBe(1);
    expect(store.state.circuits.size).toBe(2);
    expect(store.state.changes.length).toBe(changesBefore);
  });

  it("answers the same idempotency key as a replay", async () => {
    const store = seeded();
    const { input } = prepare();
    const first = await saveInstallation(store, input, actor, deps());
    const replay = await saveInstallation(store, input, actor, deps());
    expect(replay.replayed).toBe(true);
    expect(replay.snapshot.installation.id).toBe(first.snapshot.installation.id);
    expect(store.state.installations.size).toBe(1);
  });

  it("creates exactly one installation when the same vendor installation is imported concurrently", async () => {
    const store = seeded();
    const results = await Promise.all([saveInstallation(store, prepare().input, actor, deps()), saveInstallation(store, prepare().input, actor, deps()), saveInstallation(store, prepare().input, actor, deps())]);
    expect(store.state.installations.size).toBe(1);
    expect(results.filter((r) => r.alreadyImported).length).toBe(2);
    expect(new Set(results.map((r) => r.snapshot.installation.id)).size).toBe(1);
  });

  it("separates CPOs and vendors, and never matches by name or merges a manual installation", async () => {
    const store = seeded();
    const manual = SaveInstallationInput.parse({ orgId: ORG, siteId: SITE, idempotencyKey: crypto.randomUUID(), installation: { displayName: "Grandavegur 3" }, electrician: {}, circuits: [], chargers: [] });
    const manualResult = await saveInstallation(store, manual, actor, deps());
    const imported = await saveInstallation(store, prepare().input, actor, deps());
    expect(imported.alreadyImported).toBeUndefined();
    expect(imported.snapshot.installation.id).not.toBe(manualResult.snapshot.installation.id);
    const otherCpo = await saveInstallation(store, prepare({}, {}, OTHER_ORG, OTHER_SITE).input, actor, deps());
    expect(otherCpo.alreadyImported).toBeUndefined();
    const otherVendor = await saveInstallation(store, prepare({}, { vendor: "zaptec" }).input, actor, deps());
    expect(otherVendor.alreadyImported).toBeUndefined();
    expect(store.state.installations.size).toBe(4);
  });

  it("refuses to re-create an import whose installation is archived", async () => {
    const store = seeded();
    const first = await saveInstallation(store, prepare().input, actor, deps());
    store.archivedInstallations.add(first.snapshot.installation.id);
    await expect(saveInstallation(store, prepare().input, actor, deps())).rejects.toMatchObject({ code: "validation" });
    expect(store.state.installations.size).toBe(1);
  });

  it("is create-only, and a site of another CPO is refused before anything is written", async () => {
    const store = seeded();
    const first = await saveInstallation(store, prepare().input, actor, deps());
    const update = SaveInstallationInput.parse({
      installationId: first.snapshot.installation.id, expectedRevision: 1, idempotencyKey: crypto.randomUUID(),
      installation: { displayName: "x" }, electrician: {}, circuits: [], chargers: [],
      vendorImport: { package: rawPackage() },
    });
    await expect(saveInstallation(store, update, actor, deps())).rejects.toMatchObject({ code: "validation" });
    const foreign = prepare({}, { site: { ref: "9000" } }, ORG, OTHER_SITE).input;
    await expect(saveInstallation(store, foreign, actor, deps())).rejects.toBeInstanceOf(SaveError);
    expect(store.state.installations.size).toBe(1);
  });

  it("keeps each selection's outcome separate: a failure rolls back only itself", async () => {
    const store = seeded();
    const ok1 = await saveInstallation(store, prepare({}, { site: { ref: "1", name: "One" }, circuits: [], equipment: [] }).input, actor, deps());
    const bad = prepare({}, { site: { ref: "2", name: "Two" }, circuits: [], equipment: [] }, ORG, OTHER_SITE).input;
    await expect(saveInstallation(store, bad, actor, deps())).rejects.toBeInstanceOf(SaveError);
    const ok3 = await saveInstallation(store, prepare({}, { site: { ref: "3", name: "Three" }, circuits: [], equipment: [] }).input, actor, deps());
    expect([...store.state.installations.keys()].sort()).toEqual([ok1.snapshot.installation.id, ok3.snapshot.installation.id].sort());
  });

  it("rolls back the whole import when a typed OCPP id is already in use, so a corrected retry still succeeds", async () => {
    const store = seeded();
    await saveInstallation(store, prepare({ ocppIds: { EH000001: "CP-1" } }, { site: { ref: "1" } }).input, actor, deps());
    const clash = prepare({ ocppIds: { EH000001: "CP-1" } }, { site: { ref: "2" } }).input;
    await expect(saveInstallation(store, clash, actor, deps())).rejects.toMatchObject({ code: "identity_in_use" });
    expect(store.state.installations.size).toBe(1);
    // The failed attempt left no trace of vendor installation 2, so importing it again with a free id works.
    const retry = await saveInstallation(store, prepare({ ocppIds: { EH000001: "CP-2" } }, { site: { ref: "2" } }).input, actor, deps());
    expect(retry.alreadyImported).toBeUndefined();
    expect(store.state.installations.size).toBe(2);
  });
});
