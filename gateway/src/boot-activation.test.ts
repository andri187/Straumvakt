import { describe, expect, it } from "vitest";
import { abandonActivation, completeActivation, isOpenActivation, isProbeReply, recordProbeReply, seedActivation, stepActivation, type BootActivation } from "./boot-activation";
import { ACTIVATION_CONNECTION_WINDOW_MS, ACTIVATION_PROBE_AFTER_MS } from "@engine/pending";

const T0 = 1_000_000;
const id = () => "probe-1";
const fresh = (over: Partial<BootActivation> = {}): BootActivation => ({ ...seedActivation(null, "p1", 1, T0)!, ...over });
const owner = { generation: 1, placementId: "p1" };

describe("seedActivation", () => {
  it("starts a waiting attempt with the grace period and the connection window", () => {
    expect(seedActivation(null, "p1", 3, T0)).toEqual({ placementId: "p1", generation: 3, phase: "waiting", startedAt: T0, probeAt: T0 + ACTIVATION_PROBE_AFTER_MS, deadline: T0 + ACTIVATION_CONNECTION_WINDOW_MS });
  });
  it("keeps a completed placement activated, but starts again after removal and re-addition", () => {
    const done = { ...fresh(), phase: "done" as const, doneAt: T0 };
    expect(seedActivation(done, "p1", 4, T0 + 5)).toBeNull();
    expect(seedActivation(done, "p2", 4, T0 + 5)).toMatchObject({ phase: "waiting", placementId: "p2", generation: 4, startedAt: T0 + 5 });
    for (const phase of ["waiting", "probing", "incomplete"] as const) expect(seedActivation(fresh({ phase, probe: { uniqueId: "old", sentAt: T0 } }), "p1", 2, T0 + 5)).toMatchObject({ phase: "waiting", generation: 2, startedAt: T0 + 5 });
    expect(seedActivation(fresh({ probe: { uniqueId: "old", sentAt: T0 } }), "p1", 2, T0 + 5)!.probe).toBeUndefined();
  });
});

describe("stepActivation", () => {
  it("does nothing and asks for no wake-up when the attempt is closed or absent", () => {
    for (const a of [null, fresh({ phase: "done" }), fresh({ phase: "incomplete" })]) expect(stepActivation(a, T0 + 1, owner, true, id)).toEqual({ next: null, send: false, rearmAt: null });
  });
  it("waits for the grace period, then persists ONE probe and wakes again only at the deadline", () => {
    expect(stepActivation(fresh(), T0 + 9_999, owner, true, id)).toEqual({ next: null, send: false, rearmAt: T0 + ACTIVATION_PROBE_AFTER_MS });
    const s = stepActivation(fresh(), T0 + ACTIVATION_PROBE_AFTER_MS, owner, true, id);
    expect(s).toMatchObject({ send: true, rearmAt: T0 + ACTIVATION_CONNECTION_WINDOW_MS, next: { phase: "probing", probe: { uniqueId: "probe-1", sentAt: T0 + ACTIVATION_PROBE_AFTER_MS } } });
    // already probing: never a second probe
    expect(stepActivation(s.next, T0 + 20_000, owner, true, () => "probe-2")).toEqual({ next: null, send: false, rearmAt: T0 + ACTIVATION_CONNECTION_WINDOW_MS });
  });
  it("gives up at the deadline, with a reason that tells whether a probe was sent", () => {
    expect(stepActivation(fresh(), T0 + ACTIVATION_CONNECTION_WINDOW_MS, owner, true, id).next).toMatchObject({ phase: "incomplete", reason: "no_boot" });
    expect(stepActivation(fresh({ phase: "probing", probe: { uniqueId: "x", sentAt: T0 } }), T0 + ACTIVATION_CONNECTION_WINDOW_MS, owner, true, id).next).toMatchObject({ phase: "incomplete", reason: "no_boot_after_probe" });
  });
  it("does not probe a missing socket or a different generation/placement", () => {
    expect(stepActivation(fresh(), T0 + 10_000, owner, false, id)).toMatchObject({ send: false, next: { phase: "incomplete", reason: "no_socket" } });
    expect(stepActivation(fresh(), T0 + 10_000, { generation: 2, placementId: "p1" }, true, id)).toMatchObject({ send: false, next: { phase: "incomplete", reason: "superseded" } });
    expect(stepActivation(fresh(), T0 + 10_000, { generation: 1, placementId: "p2" }, true, id)).toMatchObject({ send: false, next: { phase: "incomplete", reason: "superseded" } });
    expect(stepActivation(fresh(), T0 + 10_000, null, true, id)).toMatchObject({ send: false, next: { phase: "incomplete", reason: "superseded" } });
  });
});

describe("replies, completion and abandonment", () => {
  const probing = fresh({ phase: "probing", probe: { uniqueId: "x", sentAt: T0 + 10_000 } });
  it("recognises only the probe's own id, in any phase", () => {
    expect(isProbeReply(probing, "x")).toBe(true);
    expect(isProbeReply(probing, "other")).toBe(false);
    expect(isProbeReply(fresh(), "x")).toBe(false);
    expect(isProbeReply({ ...probing, phase: "done" }, "x")).toBe(true);
    expect(isProbeReply(null, "x")).toBe(false);
  });
  it("records the first reply of the current generation before the deadline and never completes the attempt", () => {
    const next = recordProbeReply(probing, 1, T0 + 12_000, "accepted");
    expect(next).toMatchObject({ phase: "probing", probe: { uniqueId: "x", reply: "accepted" } });
    expect(recordProbeReply(next, 1, T0 + 13_000, "rejected")).toBeNull(); // duplicate
    expect(recordProbeReply(probing, 2, T0 + 12_000, "accepted")).toBeNull(); // another generation
    expect(recordProbeReply(probing, 1, T0 + ACTIVATION_CONNECTION_WINDOW_MS, "accepted")).toBeNull(); // after the deadline
    expect(recordProbeReply({ ...probing, phase: "incomplete" }, 1, T0 + 12_000, "accepted")).toBeNull();
  });
  it("completes on an accepted boot of the same placement, also late, and never twice", () => {
    for (const phase of ["waiting", "probing", "incomplete"] as const) expect(completeActivation(fresh({ phase }), "p1", T0 + 99_000)).toMatchObject({ phase: "done", doneAt: T0 + 99_000 });
    expect(completeActivation(fresh({ phase: "done" }), "p1", T0)).toBeNull();
    expect(completeActivation(fresh(), "p9", T0)).toBeNull();
    expect(completeActivation(null, "p1", T0)).toBeNull();
  });
  it("abandons only an open attempt of the closing generation", () => {
    expect(abandonActivation(fresh(), 1)).toMatchObject({ phase: "incomplete", reason: "disconnected" });
    expect(abandonActivation(fresh(), 2)).toBeNull();
    expect(abandonActivation(fresh({ phase: "done" }), 1)).toBeNull();
    expect(isOpenActivation(abandonActivation(probing, 1))).toBe(false);
  });
});
