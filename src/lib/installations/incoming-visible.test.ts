import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { INCOMING_WINDOW_MS } from "./incoming-window";
import { visibleIncoming } from "./incoming-visible";
import { OEM_IMAGE_PATHS, OEM_MODELS, modelCards } from "./oem-models";
import { enabledVendors } from "./vendor-onboarding";
import { SHELL_PUBLIC_ASSETS } from "../cpo-shell-policy";

const NOW = Date.parse("2026-11-02T12:00:00Z");
const knock = (id: string, ageMs: number, over: Partial<{ state: "incoming" | "recovery"; socket: boolean | null }> = {}) => ({
  chargePointId: id,
  lastSeenAt: new Date(NOW - ageMs).toISOString(),
  state: over.state ?? ("incoming" as const),
  socket: over.socket ?? null,
});

describe("visibleIncoming (the waiting count and the table share it)", () => {
  it("hides a row at the exact window boundary and shows one just inside", () => {
    const rows = [knock("inside", INCOMING_WINDOW_MS - 1), knock("edge", INCOMING_WINDOW_MS), knock("old", INCOMING_WINDOW_MS + 1)];
    expect(visibleIncoming(rows, NOW).map((r) => r.chargePointId)).toEqual(["inside"]);
  });
  it("keeps a row with an open pending socket however old, but not one whose socket is closed or unknown", () => {
    const rows = [knock("open", 3 * INCOMING_WINDOW_MS, { socket: true }), knock("closed", 3 * INCOMING_WINDOW_MS, { socket: false }), knock("unknown", 3 * INCOMING_WINDOW_MS)];
    expect(visibleIncoming(rows, NOW).map((r) => r.chargePointId)).toEqual(["open"]);
  });
  it("never counts a recovery row (a known charger) or an unreadable timestamp", () => {
    const rows = [knock("known", 1000, { state: "recovery" }), { ...knock("bad", 0), lastSeenAt: "not a date" }, knock("new", 1000)];
    expect(visibleIncoming(rows, NOW).map((r) => r.chargePointId)).toEqual(["new"]);
  });
  it("applies no window before the clock is read, and treats no data as an empty list (callers keep null apart)", () => {
    expect(visibleIncoming([knock("old", 9 * INCOMING_WINDOW_MS)], null)).toHaveLength(1);
    expect(visibleIncoming(null, NOW)).toEqual([]);
  });
});

describe("Add installation model board", () => {
  it("offers only models whose reader the server really has, and only when this deployment switched it on", () => {
    const on = modelCards(enabledVendors({ CPO_VENDOR_CONNECT: "easee,zaptec" }));
    expect(on.filter((c) => c.state === "available").map((c) => c.id)).toEqual(["easee-charge", "zaptec-pro"]);
    expect(on.filter((c) => c.state === "available").map((c) => c.href)).toEqual(["/cpo/installations?onboard=1&model=easee", "/cpo/installations?onboard=1&model=zaptec"]);
    expect(on.filter((c) => c.state === "unsupported")).toHaveLength(9);
    const easeeOnly = modelCards(enabledVendors({ CPO_VENDOR_CONNECT: "easee" }));
    expect(easeeOnly.find((c) => c.id === "zaptec-pro")).toMatchObject({ state: "not_enabled", href: null });
    const off = modelCards(enabledVendors({}));
    expect(off.every((c) => c.state !== "available" && c.href === null)).toBe(true);
  });
  it("cannot be made actionable by a vendor name the server has no reader for", () => {
    expect(modelCards(enabledVendors({ CPO_VENDOR_CONNECT: "wallbox,alfen" })).every((c) => c.href === null)).toBe(true);
  });
  it("every model with a vendor has a real server reader; every image is served and exists on disk", () => {
    const readers = enabledVendors({ CPO_VENDOR_CONNECT: OEM_MODELS.flatMap((m) => (m.vendor ? [m.vendor] : [])).join(",") });
    for (const m of OEM_MODELS) if (m.vendor) expect(readers).toContain(m.vendor);
    // The edge list is kept equal to this policy list by scripts/cpo-shell-edge.test.mjs.
    for (const p of OEM_IMAGE_PATHS) {
      expect(SHELL_PUBLIC_ASSETS).toContain(p);
      expect(fs.existsSync(path.join(process.cwd(), "public", p))).toBe(true);
    }
    expect(new Set(OEM_IMAGE_PATHS).size).toBe(OEM_MODELS.length);
  });
});
