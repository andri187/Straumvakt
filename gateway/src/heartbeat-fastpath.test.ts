import { describe, it, expect } from "vitest";
import {
  bypassesIngest,
  recordFrame,
  frameCapDecision,
  initialFrameCap,
  CAP_EXEMPT_ACTIONS,
  DEFAULT_LIVENESS_CONFIG,
  DEFAULT_FRAME_CAP,
  type LivenessState,
} from "./heartbeat-fastpath";

const HOUR = 60 * 60 * 1000;
const T0 = 1_800_000_000_000; // hour-aligned enough for these tests

describe("bypassesIngest — which frames may skip the queue", () => {
  it("drops Heartbeat", () => {
    expect(bypassesIngest("Heartbeat")).toBe(true);
  });

  // The whole cost case rests on this one being true, and every other
  // frame being false. A regression here is silent and expensive.
  it.each([
    "BootNotification", "StatusNotification", "MeterValues", "Authorize",
    "StartTransaction", "StopTransaction", "DataTransfer", "DiagnosticsStatusNotification",
    "FirmwareStatusNotification",
  ])("does not drop %s", (action) => {
    expect(bypassesIngest(action)).toBe(false);
  });

  it("does not drop an action nobody has triaged yet — fail long, not short", () => {
    expect(bypassesIngest("SomeVendorExtension")).toBe(false);
    expect(bypassesIngest("")).toBe(false);
  });

  it("is case-sensitive, because OCPP action names are", () => {
    expect(bypassesIngest("heartbeat")).toBe(false);
  });
});

describe("recordFrame — liveness and transitions", () => {
  it("treats first contact as a transition to online", () => {
    const d = recordFrame(null, "BootNotification", T0);
    expect(d.emitTransition).toBe(true);
    expect(d.transition).toBe("online");
    expect(d.next.online).toBe(true);
    expect(d.next.rollupCounts).toEqual({ BootNotification: 1 });
  });

  it("emits NO transition for an ordinary heartbeat on a live connector", () => {
    const first = recordFrame(null, "Heartbeat", T0).next;
    const d = recordFrame(first, "Heartbeat", T0 + HOUR);
    expect(d.emitTransition).toBe(false);
    expect(d.transition).toBeNull();
  });

  // The cost case: 720 heartbeats a month must produce ~0 events, not 720.
  it("produces no transition events across a month of hourly heartbeats", () => {
    let s: LivenessState = recordFrame(null, "Heartbeat", T0).next;
    let transitions = 0;
    for (let i = 1; i <= 720; i++) {
      const d = recordFrame(s, "Heartbeat", T0 + i * HOUR);
      if (d.emitTransition) transitions++;
      s = d.next;
    }
    expect(transitions).toBe(0);
  });

  it("emits a recovery transition after silence beyond the offline threshold", () => {
    const first = recordFrame(null, "Heartbeat", T0).next;
    const gap = HOUR * DEFAULT_LIVENESS_CONFIG.offlineAfterMissedIntervals + 1;
    const d = recordFrame(first, "Heartbeat", T0 + gap);
    expect(d.emitTransition).toBe(true);
    expect(d.transition).toBe("online");
    expect(d.previousStateDurationMs).toBe(gap);
  });

  it("does not treat ordinary jitter as an outage", () => {
    const first = recordFrame(null, "Heartbeat", T0).next;
    // Late, but inside the tolerance. One late heartbeat is jitter.
    const d = recordFrame(first, "Heartbeat", T0 + HOUR * 2.5);
    expect(d.emitTransition).toBe(false);
  });

  it("flushes a rollup bucket exactly once when the hour rolls", () => {
    let s = recordFrame(null, "Heartbeat", T0 + 60_000).next;
    s = recordFrame(s, "StatusNotification", T0 + 120_000).next;
    const d = recordFrame(s, "Heartbeat", T0 + HOUR + 60_000);
    expect(d.flushRollup).toBe(true);
    expect(d.flushedBucket?.counts).toEqual({ Heartbeat: 1, StatusNotification: 1 });
    // The new bucket starts clean and counts only the current frame.
    expect(d.next.rollupCounts).toEqual({ Heartbeat: 1 });
  });

  it("does not flush inside the same bucket", () => {
    let s = recordFrame(null, "Heartbeat", T0 + 60_000).next;
    const d = recordFrame(s, "Heartbeat", T0 + 120_000);
    expect(d.flushRollup).toBe(false);
    expect(d.next.rollupCounts).toEqual({ Heartbeat: 2 });
  });

  it("counts frames by action within a bucket", () => {
    let s = recordFrame(null, "Heartbeat", T0 + 1000).next;
    s = recordFrame(s, "MeterValues", T0 + 2000).next;
    s = recordFrame(s, "MeterValues", T0 + 3000).next;
    expect(s.rollupCounts).toEqual({ Heartbeat: 1, MeterValues: 2 });
  });

  it("always advances lastSeenAt", () => {
    const first = recordFrame(null, "Heartbeat", T0).next;
    const d = recordFrame(first, "Heartbeat", T0 + 5000);
    expect(d.next.lastSeenAt).toBe(T0 + 5000);
  });

  it("reports when the next heartbeat is expected, so a sweep can find silence", () => {
    const d = recordFrame(null, "Heartbeat", T0);
    expect(d.expectedNextHeartbeatAt).toBe(T0 + HOUR);
  });

  // Hibernation: a wake-up is a fresh instance over the same storage. Passing
  // the stored state back in must produce identical results.
  it("is a pure function of stored state — survives a hibernation wake", () => {
    const a = recordFrame(null, "Heartbeat", T0).next;
    const viaStorage = JSON.parse(JSON.stringify(a)) as LivenessState;
    const d1 = recordFrame(a, "Heartbeat", T0 + HOUR);
    const d2 = recordFrame(viaStorage, "Heartbeat", T0 + HOUR);
    expect(d2).toEqual(d1);
  });
});

describe("frameCapDecision — noisy connector containment", () => {
  it("permits a normal rate", () => {
    let s = initialFrameCap(T0);
    for (let i = 0; i < 10; i++) {
      const d = frameCapDecision(s, "Heartbeat", T0 + i * 1000);
      expect(d.shedIngest).toBe(false);
      s = d.next;
    }
  });

  it("sheds ingest once the cap is crossed", () => {
    let s = initialFrameCap(T0);
    let shed = 0;
    for (let i = 0; i < DEFAULT_FRAME_CAP.maxFramesPerWindow + 5; i++) {
      const d = frameCapDecision(s, "StatusNotification", T0 + i * 100);
      if (d.shedIngest) shed++;
      s = d.next;
    }
    expect(shed).toBe(5);
  });

  it("emits exactly ONE breach event, not one per shed frame", () => {
    let s = initialFrameCap(T0);
    let breaches = 0;
    for (let i = 0; i < DEFAULT_FRAME_CAP.maxFramesPerWindow + 50; i++) {
      const d = frameCapDecision(s, "StatusNotification", T0 + i * 100);
      if (d.emitBreachEvent) breaches++;
      s = d.next;
    }
    expect(breaches).toBe(1);
  });

  // The invariant that matters most: a cost control must never cause a
  // billing dispute.
  it.each([...CAP_EXEMPT_ACTIONS])("never sheds %s however noisy the connector", (action) => {
    let s = initialFrameCap(T0);
    for (let i = 0; i < DEFAULT_FRAME_CAP.maxFramesPerWindow + 20; i++) {
      s = frameCapDecision(s, "StatusNotification", T0 + i * 100).next;
    }
    const d = frameCapDecision(s, action, T0 + 100_000);
    expect(d.shedIngest).toBe(false);
  });

  it("keeps shedding while quarantined", () => {
    let s = initialFrameCap(T0);
    for (let i = 0; i < DEFAULT_FRAME_CAP.maxFramesPerWindow + 1; i++) {
      s = frameCapDecision(s, "StatusNotification", T0 + i * 100).next;
    }
    const d = frameCapDecision(s, "StatusNotification", T0 + 200_000);
    expect(d.shedIngest).toBe(true);
    expect(d.reason).toBe("quarantined");
  });

  it("recovers in a new window", () => {
    let s = initialFrameCap(T0);
    for (let i = 0; i < DEFAULT_FRAME_CAP.maxFramesPerWindow + 1; i++) {
      s = frameCapDecision(s, "StatusNotification", T0 + i * 100).next;
    }
    const d = frameCapDecision(s, "StatusNotification", T0 + DEFAULT_FRAME_CAP.windowMs + 1000);
    expect(d.shedIngest).toBe(false);
    expect(d.next.count).toBe(1);
  });

  it("raises an anomaly only after repeated breaches", () => {
    let s = initialFrameCap(T0);
    let anomalies = 0;
    for (let w = 0; w < DEFAULT_FRAME_CAP.anomalyAfterConsecutiveBreaches; w++) {
      const base = T0 + w * DEFAULT_FRAME_CAP.windowMs;
      for (let i = 0; i < DEFAULT_FRAME_CAP.maxFramesPerWindow + 2; i++) {
        const d = frameCapDecision(s, "StatusNotification", base + i * 100);
        if (d.emitAnomalyEvent) anomalies++;
        s = d.next;
      }
    }
    expect(anomalies).toBe(1);
  });

  it("survives a hibernation wake — pure function of stored state", () => {
    let s = initialFrameCap(T0);
    s = frameCapDecision(s, "Heartbeat", T0 + 1000).next;
    const viaStorage = JSON.parse(JSON.stringify(s)) as typeof s;
    expect(frameCapDecision(viaStorage, "Heartbeat", T0 + 2000))
      .toEqual(frameCapDecision(s, "Heartbeat", T0 + 2000));
  });
});
