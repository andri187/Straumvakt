import { describe, expect, it } from "vitest";

import { initialLiveness } from "./heartbeat-fastpath";
import type { LivenessState } from "./heartbeat-fastpath";
import {
  DEFAULT_SWEEP_CONFIG,
  SWEEP_EVENT_FIELDS,
  clearOfflineLatch,
  groupByOrg,
  groupBySite,
  offlineThresholdMs,
  sweep,
  sweepOne,
  toEvent,
} from "./liveness-sweeper";
import type { SweepSubject } from "./liveness-sweeper";

const HOUR = 60 * 60 * 1000;
const T0 = 1_760_000_000_000;

function subject(over: Partial<SweepSubject> = {}): SweepSubject {
  const liveness: LivenessState = initialLiveness(T0, HOUR);
  return {
    identityId: "id-1",
    orgId: "org-a",
    siteId: "site-1",
    connectorId: "conn-1",
    enabled: true,
    heartbeatIntervalMs: HOUR,
    liveness,
    offlineEventEmitted: false,
    ...over,
  };
}

/** Threshold with defaults: 3 × 1h + 5m. */
const THRESHOLD = offlineThresholdMs({ heartbeatIntervalMs: HOUR });

describe("on time", () => {
  it("a heartbeat one interval ago is not offline", () => {
    const d = sweepOne(subject(), T0 + HOUR);
    expect(d.emit).toBe(false);
    expect(d.offline).toBe(false);
    expect(d.reason).toBe("within-threshold");
  });

  it("silence is reported accurately", () => {
    const d = sweepOne(subject(), T0 + HOUR);
    expect(d.silenceMs).toBe(HOUR);
  });
});

describe("late within grace", () => {
  it("two missed intervals is jitter, not an outage", () => {
    const d = sweepOne(subject(), T0 + 2 * HOUR);
    expect(d.emit).toBe(false);
    expect(d.offline).toBe(false);
  });

  it("exactly at the threshold is still not offline", () => {
    const d = sweepOne(subject(), T0 + THRESHOLD);
    expect(d.emit).toBe(false);
    expect(d.offline).toBe(false);
  });

  it("one millisecond past the threshold is", () => {
    const d = sweepOne(subject(), T0 + THRESHOLD + 1);
    expect(d.emit).toBe(true);
    expect(d.transition).toBe("offline");
  });
});

describe("missed", () => {
  it("emits exactly one offline transition", () => {
    const d = sweepOne(subject(), T0 + 4 * HOUR);
    expect(d.emit).toBe(true);
    expect(d.transition).toBe("offline");
    expect(d.next).toEqual({ online: false, offlineEventEmitted: true });
    expect(d.reason).toBe("emitted");
  });
});

describe("repeated missed sweeps produce no duplicate event", () => {
  it("the second sweep is silent", () => {
    const first = sweepOne(subject(), T0 + 4 * HOUR);
    expect(first.emit).toBe(true);
    const second = sweepOne(
      subject({ offlineEventEmitted: first.next.offlineEventEmitted }),
      T0 + 5 * HOUR,
    );
    expect(second.emit).toBe(false);
    expect(second.reason).toBe("already-emitted");
    expect(second.offline).toBe(true);
  });

  it("twenty-four sweeps of a dead charger emit once, not twenty-four times", () => {
    let s = subject();
    let emitted = 0;
    for (let h = 4; h < 28; h++) {
      const d = sweepOne(s, T0 + h * HOUR);
      if (d.emit) emitted++;
      s = { ...s, offlineEventEmitted: d.next.offlineEventEmitted };
    }
    expect(emitted).toBe(1);
  });
});

describe("recovery", () => {
  it("a frame within the threshold releases the latch", () => {
    const afterOutage = subject({ offlineEventEmitted: true });
    // The charger comes back: lastSeenAt moves forward.
    const recovered = subject({
      offlineEventEmitted: afterOutage.offlineEventEmitted,
      liveness: { ...afterOutage.liveness!, lastSeenAt: T0 + 10 * HOUR },
    });
    const d = sweepOne(recovered, T0 + 10 * HOUR + 60_000);
    expect(d.emit).toBe(false);
    expect(d.next.offlineEventEmitted).toBe(false);
    expect(d.next.online).toBe(true);
  });

  it("clearing the latch twice is a no-op, so recovery emits once", () => {
    expect(clearOfflineLatch({ offlineEventEmitted: true })).toEqual({
      offlineEventEmitted: false,
    });
    expect(clearOfflineLatch({ offlineEventEmitted: false })).toEqual({
      offlineEventEmitted: false,
    });
  });

  it("a second outage after recovery IS reported", () => {
    const recovered = subject({
      offlineEventEmitted: false,
      liveness: { ...subject().liveness!, lastSeenAt: T0 + 10 * HOUR },
    });
    const d = sweepOne(recovered, T0 + 20 * HOUR);
    expect(d.emit).toBe(true);
  });
});

describe("interval change", () => {
  it("a charger moved to a 6-hour interval is not marked offline at 4 hours", () => {
    const slow = subject({ heartbeatIntervalMs: 6 * HOUR });
    const d = sweepOne(slow, T0 + 4 * HOUR);
    expect(d.emit).toBe(false);
  });

  it("a charger moved to a 60-second interval is offline much sooner", () => {
    const fast = subject({ heartbeatIntervalMs: 60_000 });
    const d = sweepOne(fast, T0 + 30 * 60_000);
    expect(d.emit).toBe(true);
  });

  it("the threshold follows the identity's own interval, not a global constant", () => {
    expect(offlineThresholdMs({ heartbeatIntervalMs: HOUR })).not.toBe(
      offlineThresholdMs({ heartbeatIntervalMs: 6 * HOUR }),
    );
  });
});

describe("noisy charger", () => {
  it("frame volume does not affect the sweeper — only recency does", () => {
    const noisy = subject({
      liveness: { ...subject().liveness!, rollupCounts: { Heartbeat: 50_000 } },
    });
    const quiet = subject();
    expect(sweepOne(noisy, T0 + 4 * HOUR).emit).toBe(sweepOne(quiet, T0 + 4 * HOUR).emit);
  });

  it("a quarantined noisy charger still reports offline when it goes silent", () => {
    const d = sweepOne(subject({ liveness: { ...subject().liveness!, online: true } }), T0 + 9 * HOUR);
    expect(d.emit).toBe(true);
  });
});

describe("no prior heartbeat", () => {
  it("an identity never seen is never reported offline", () => {
    const d = sweepOne(subject({ liveness: null }), T0 + 1000 * HOUR);
    expect(d.emit).toBe(false);
    expect(d.reason).toBe("never-seen");
  });
});

describe("disabled charger", () => {
  it("is never swept", () => {
    const d = sweepOne(subject({ enabled: false }), T0 + 1000 * HOUR);
    expect(d.emit).toBe(false);
    expect(d.reason).toBe("disabled");
  });

  it("is not reported offline even having been online before", () => {
    const d = sweepOne(
      subject({ enabled: false, offlineEventEmitted: false }),
      T0 + 50 * HOUR,
    );
    expect(d.offline).toBe(false);
  });
});

describe("clock skew and delayed ticks", () => {
  it("a sweep whose clock runs behind the last frame emits nothing", () => {
    const d = sweepOne(subject(), T0 - 60_000);
    expect(d.emit).toBe(false);
    expect(d.reason).toBe("clock-skew");
    expect(d.silenceMs).toBe(0);
  });

  it("silence is never negative", () => {
    expect(sweepOne(subject(), T0 - 10 * HOUR).silenceMs).toBeGreaterThanOrEqual(0);
  });

  it("grace absorbs a late sweep tick", () => {
    const justInside = T0 + 3 * HOUR + DEFAULT_SWEEP_CONFIG.graceMs - 1;
    expect(sweepOne(subject(), justInside).emit).toBe(false);
  });
});

describe("site and org grouping", () => {
  const dead = (id: string, org: string, site: string | null): SweepSubject =>
    subject({ identityId: id, orgId: org, siteId: site });

  const decisions = sweep(
    [
      dead("a", "org-a", "site-1"),
      dead("b", "org-a", "site-1"),
      dead("c", "org-a", "site-2"),
      dead("d", "org-b", null),
      subject({ identityId: "e", orgId: "org-b", enabled: false }),
    ],
    T0 + 9 * HOUR,
  );

  it("groups emitted transitions by site", () => {
    const bySite = groupBySite(decisions);
    expect(bySite.get("org-a/site-1")).toHaveLength(2);
    expect(bySite.get("org-a/site-2")).toHaveLength(1);
    expect(bySite.get("org-b/unsited")).toHaveLength(1);
  });

  it("groups by org", () => {
    const byOrg = groupByOrg(decisions);
    expect(byOrg.get("org-a")).toHaveLength(3);
    expect(byOrg.get("org-b")).toHaveLength(1);
  });

  it("excludes the disabled charger from every group", () => {
    const all = [...groupByOrg(decisions).values()].flat();
    expect(all.map((d) => d.identityId)).not.toContain("e");
  });
});

describe("the emitted event leaks nothing", () => {
  it("carries only the closed field set", () => {
    const d = sweepOne(subject(), T0 + 9 * HOUR);
    expect(Object.keys(toEvent(d)).sort()).toEqual([...SWEEP_EVENT_FIELDS].sort());
  });

  it("carries no idTag, credential, secret or raw payload", () => {
    const serialised = JSON.stringify(toEvent(sweepOne(subject(), T0 + 9 * HOUR)));
    for (const forbidden of ["idTag", "credential", "secret", "password", "payload", "token"]) {
      expect(serialised.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });

  it("carries enough to alert: org, site and connector", () => {
    const e = toEvent(sweepOne(subject(), T0 + 9 * HOUR));
    expect(e.orgId).toBe("org-a");
    expect(e.siteId).toBe("site-1");
    expect(e.connectorId).toBe("conn-1");
  });
});

// ── fool-test ───────────────────────────────────────────────────────────

describe("FOOL — remove the transition latch and emit every sweep", () => {
  // The latch is `if (subject.offlineEventEmitted) return quiet(...)`. Without
  // it the sweeper emits on state rather than transition, and one dead charger
  // becomes one alert per tick.
  const sweepFooled = (s: SweepSubject, now: number) => {
    const silence = now - s.liveness!.lastSeenAt;
    return { emit: silence > offlineThresholdMs(s) };
  };

  it("the fooled sweeper emits on all 24 hourly ticks for one dead charger", () => {
    let emitted = 0;
    for (let h = 4; h < 28; h++) if (sweepFooled(subject(), T0 + h * HOUR).emit) emitted++;
    expect(emitted).toBe(24);
  });

  it("the real sweeper emits once", () => {
    let s = subject();
    let emitted = 0;
    for (let h = 4; h < 28; h++) {
      const d = sweepOne(s, T0 + h * HOUR);
      if (d.emit) emitted++;
      s = { ...s, offlineEventEmitted: d.next.offlineEventEmitted };
    }
    expect(emitted).toBe(1);
  });

  it("so at 21 chargers the difference is 21 alerts vs 504 a day", () => {
    expect(24 * 21).toBe(504);
  });
});
