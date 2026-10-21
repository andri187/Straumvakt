// The first-placement write path — fallback item 1.
//
// Design and port only: no vendor call, no database. What is pinned here is
// the DECISION SET, because the pathway does not exist yet and the decisions
// are the deliverable.

import { describe, expect, it } from "vitest";
import { checkOnboard, firstPlacementPeriod, PARTIAL_FAILURE_CONTRACT, type OnboardDeviceInput } from "./onboard-device-port";

const PLATFORM = { restrictToOrgIds: null as string[] | null };
const at = (iso: string) => new Date(iso);

const boot = (evses = [{ evseIndex: 1, connectors: [{ connectorIndex: 1, type: "Type2" }] }]) => ({
  vendor: "Zaptec",
  model: "Pro",
  serialNumber: "SYNTHETIC-SERIAL-0001",
  chargeBoxSerialNumber: null,
  firmwareVersion: "3.2.1",
  observedAt: at("2026-03-01T00:00:00Z"),
  evses,
});

const input = (over: Partial<OnboardDeviceInput> = {}): OnboardDeviceInput => ({
  orgId: "org-a",
  installationId: "inst-a",
  identityString: "SVK-SYNTHETIC-0001",
  at: at("2026-03-01T00:00:00Z"),
  boot: boot(),
  actorUserId: "user-1",
  idempotencyKey: "k-1",
  ...over,
});

describe("what it refuses before writing anything", () => {
  it("refuses a missing idempotency key rather than generating one", () => {
    expect(checkOnboard(input({ idempotencyKey: "" }), PLATFORM)).toEqual({
      ok: false,
      reason: "idempotency_key_required",
    });
  });

  it("refuses an org outside scope", () => {
    expect(checkOnboard(input(), { restrictToOrgIds: ["org-other"] })).toEqual({
      ok: false,
      reason: "org_not_in_scope",
    });
  });

  it("refuses an onboarding with no identity string", () => {
    // A placement for a charger that cannot connect is a billable row for
    // hardware nobody can use.
    expect(checkOnboard(input({ identityString: "  " }), PLATFORM)).toEqual({
      ok: false,
      reason: "identity_string_required",
    });
  });

  it("refuses a boot that reports ZERO EVSEs", () => {
    // Silence and "I have nothing" are not the same claim. The charger spoke
    // and said it has nothing, which is a protocol bug or a unit we should not
    // be billing for — the same distinction as `never_reported` versus
    // `Unavailable` on connector status.
    expect(checkOnboard(input({ boot: boot([]) }), PLATFORM)).toEqual({
      ok: false,
      reason: "boot_reported_no_evses",
    });
  });
});

describe("the BootNotification decides whether children are written", () => {
  it("writes children when a boot is present", () => {
    expect(checkOnboard(input(), PLATFORM)).toEqual({
      ok: true,
      willWriteChildren: true,
      dedupable: true,
    });
  });

  it("writes NO EVSE and NO connector when there is no boot — and it is not an error", () => {
    // A charger is often registered before it first connects. Refusing would
    // make the operator wait for hardware to phone home before they can record
    // where they put it. What it must never do is write one EVSE at index 1
    // with one Type2 connector.
    const r = checkOnboard(
      input({ boot: null, vendor: "Zaptec", serialNumber: "SYNTHETIC-SERIAL-0002" }),
      PLATFORM,
    );
    expect(r).toEqual({ ok: true, willWriteChildren: false, dedupable: true });
  });

  it("takes vendor and serial from the boot when the caller did not supply them", () => {
    const r = checkOnboard(input({ vendor: undefined, serialNumber: undefined }), PLATFORM);
    expect(r).toMatchObject({ ok: true, dedupable: true });
  });
});

describe("the duplicate a constraint cannot catch", () => {
  it("refuses an unserialised device unless the caller acknowledges it", () => {
    // Postgres treats NULLs as distinct in a unique index, so an unserialised
    // device gets a new row every time. Defaulting the acknowledgement to true
    // would make a double-onboarding silent, which is how one physical charger
    // ends up with two lifetime-energy counters.
    expect(
      checkOnboard(input({ boot: null, vendor: null, serialNumber: null }), PLATFORM),
    ).toEqual({ ok: false, reason: "possible_duplicate_device_not_acknowledged" });
  });

  it("proceeds once acknowledged, and still reports it is not dedupable", () => {
    expect(
      checkOnboard(
        input({ boot: null, vendor: null, serialNumber: null, acceptPossibleDuplicate: true }),
        PLATFORM,
      ),
    ).toEqual({ ok: true, willWriteChildren: false, dedupable: false });
  });

  it("a serial with no vendor is not dedupable either", () => {
    expect(
      checkOnboard(
        input({ boot: null, vendor: null, serialNumber: "SYNTHETIC-SERIAL-0003" }),
        PLATFORM,
      ),
    ).toMatchObject({ ok: false, reason: "possible_duplicate_device_not_acknowledged" });
  });
});

describe("the shape of the write", () => {
  it("opens the first placement open-ended, never with an invented end", () => {
    const p = firstPlacementPeriod(at("2026-03-01T00:00:00Z"));
    expect(p.until).toBeNull();
    expect(p.from.toISOString()).toBe("2026-03-01T00:00:00.000Z");
  });

  it("states what a partial failure leaves behind, in two cases and no others", () => {
    // Recorded as a value rather than prose so it cannot drift from the
    // adapter that has to honour it.
    expect(PARTIAL_FAILURE_CONTRACT.insideTransaction).toBe("nothing is written");
    expect(PARTIAL_FAILURE_CONTRACT.afterCommitBeforeReceipt).toContain("idempotent or refuses by name");
  });
});
