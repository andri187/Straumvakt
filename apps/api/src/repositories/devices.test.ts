// The device repository — decision 1, and the one thing about it that is
// counter-intuitive.
//
// `(vendor, serial_number)` is UNIQUE and both columns are NULLABLE. Postgres
// treats NULLs as distinct in a unique index, so an unserialised device cannot
// be deduplicated and registering one twice makes two rows. That is correct
// behaviour and a real limitation, and the port REPORTS it rather than hiding
// it behind a generated key.

import { describe, expect, it } from "vitest";
import { makeFixtureDevices } from "./fixture-devices";
import { checkRegister } from "./devices";

const reg = (over = {}) => ({
  vendor: "Zaptec",
  serialNumber: "SYNTHETIC-SERIAL-0001",
  idempotencyKey: "k-1",
  ...over,
});

describe("register", () => {
  it("registers a device and is idempotent on (vendor, serial)", async () => {
    const { port, state } = makeFixtureDevices();
    const first = await port.register(reg());
    expect(first.kind).toBe("registered");
    const again = await port.register(reg({ idempotencyKey: "k-2" }));
    expect(again.kind).toBe("already_known");
    expect(state.rows).toHaveLength(1);
  });

  it("an UNSERIALISED device cannot be deduplicated, and the port says so", async () => {
    // OCPP 2.0.1 makes serialNumber optional; 1.6 offers three competing
    // serial fields. A device with no serial is a device we have, not one we
    // refuse — and it is also one no constraint can dedup.
    const { port, state } = makeFixtureDevices();
    expect(checkRegister(reg({ serialNumber: null }))).toEqual({ ok: true, dedupable: false });
    await port.register(reg({ serialNumber: null }));
    await port.register(reg({ serialNumber: null, idempotencyKey: "k-2" }));
    expect(state.rows).toHaveLength(2);
    // Two rows for what may be one physical unit. Reported, not hidden: an
    // importer can refuse, ask, or accept it knowingly.
  });

  it("refuses a serial with no vendor — a serial alone is not a key", async () => {
    // Serials are vendor-scoped and two vendors' units can share a string.
    const { port } = makeFixtureDevices();
    expect(await port.register(reg({ vendor: null }))).toEqual({
      kind: "refused",
      reason: "vendor_required_with_serial",
    });
  });

  it("refuses a missing idempotency key rather than generating one", async () => {
    const { port, state } = makeFixtureDevices();
    expect(await port.register(reg({ idempotencyKey: "" }))).toEqual({
      kind: "refused",
      reason: "idempotency_key_required",
    });
    expect(state.rows).toEqual([]);
  });

  it("stores NO warranty date rather than an invented one", async () => {
    // `zaptec-import.ts` computes install + 5 years and stores it in a column
    // whose name asserts it came from somewhere. Null is the difference
    // between "we do not know" and a wrong date a claim gets denied against.
    const { port } = makeFixtureDevices();
    const r = await port.register(reg());
    expect(r.kind === "registered" && r.device.warrantyExpires).toBeNull();
    const withReal = await port.register(
      reg({ serialNumber: "SYNTHETIC-SERIAL-0002", idempotencyKey: "k-3", warrantyExpires: new Date("2031-01-01T00:00:00Z") }),
    );
    expect(withReal.kind === "registered" && withReal.device.warrantyExpires?.getUTCFullYear()).toBe(2031);
  });

  it("firmware carries its own observed-at, from BootNotification", async () => {
    const { port } = makeFixtureDevices();
    const r = await port.register(
      reg({ firmwareVersion: "3.2.1", firmwareObservedAt: new Date("2026-03-01T00:00:00Z") }),
    );
    expect(r.kind === "registered" && r.device.firmwareObservedAt?.toISOString()).toBe(
      "2026-03-01T00:00:00.000Z",
    );
  });
});

describe("retire — a state, never a delete", () => {
  it("retires a device and keeps the row", async () => {
    const { port, state } = makeFixtureDevices();
    const r = await port.register(reg());
    const id = r.kind === "registered" ? r.device.id : "";
    expect(await port.retire(id, new Date("2026-06-01T00:00:00Z"), "end of life")).toEqual({
      kind: "retired",
    });
    // A device row is what every placement, session and lifetime counter
    // points at. Deleting it orphans all three.
    expect(state.rows).toHaveLength(1);
    expect(state.rows[0]!.retiredAt).not.toBeNull();
  });

  it("retiring twice does not move the date already recorded", async () => {
    const { port, state } = makeFixtureDevices();
    const r = await port.register(reg());
    const id = r.kind === "registered" ? r.device.id : "";
    await port.retire(id, new Date("2026-06-01T00:00:00Z"), "first");
    expect(await port.retire(id, new Date("2026-09-01T00:00:00Z"), "second")).toEqual({
      kind: "already_retired",
    });
    expect(state.rows[0]!.retiredAt?.toISOString()).toBe("2026-06-01T00:00:00.000Z");
  });

  it("retiring an unknown device is not_found", async () => {
    const { port } = makeFixtureDevices();
    expect(await port.retire("device-nobody", new Date(), "x")).toEqual({ kind: "not_found" });
  });

  it("there is no delete on the port at all", () => {
    // Asserted structurally rather than described: decision 1 says a device is
    // immortal, and a port that grew a `delete` later would pass every other
    // test in this file.
    const { port } = makeFixtureDevices();
    expect(Object.keys(port).sort()).toEqual(["byId", "byVendorSerial", "register", "retire"]);
  });
});
