// An in-memory `VendorConfigSinkPort`.
//
// Not a mock: it runs the same decision sequence the Drizzle adapter runs, in
// the same order — validate, read the latest, compare, then append — and uses
// the same `sameReading` and `checkObservation`. Only the storage is an array.
//
// It records `writes`, so "an identical observation did not create a row" is
// asserted rather than inferred from a length that could have been right by
// accident.

import {
  checkObservation,
  sameReading,
  type Evidence,
  type VendorConfigObservation,
  type VendorConfigSinkPort,
} from "./sink-port";

export interface FixtureVendorConfigState {
  /** Append-only, in insertion order. */
  log: VendorConfigObservation[];
  /** One entry per observation that actually reached storage. */
  writes: string[];
  /** One entry per call that was deduplicated away. */
  suppressed: string[];
}

export function makeFixtureVendorConfigSink(opts: { visibleDeviceIds?: string[] } = {}): {
  sink: VendorConfigSinkPort;
  state: FixtureVendorConfigState;
} {
  const state: FixtureVendorConfigState = { log: [], writes: [], suppressed: [] };
  const visible = opts.visibleDeviceIds ?? null;

  const latestOf = (deviceId: string): VendorConfigObservation | null => {
    const mine = state.log
      .filter((o) => o.deviceId === deviceId)
      .sort((a, b) => a.observedAt.getTime() - b.observedAt.getTime());
    return mine[mine.length - 1] ?? null;
  };

  const sink: VendorConfigSinkPort = {
    async record(o) {
      const check = checkObservation(o);
      if (!check.ok) {
        // A refusal is not a write and not an "unchanged": both of those are
        // claims that storage is now consistent with the input, and it is not.
        throw new Error(check.reason);
      }
      const prior = latestOf(o.deviceId);
      // Dedup against the LATEST only, never against the whole log. A charger
      // that goes active -> inactive -> active must record three observations;
      // matching anywhere in history would swallow the third and leave a log
      // saying it was never reactivated.
      if (prior && sameReading(prior, o)) {
        state.suppressed.push(o.deviceId);
        return { status: "unchanged" };
      }
      state.log.push(o);
      state.writes.push(o.deviceId);
      return { status: "recorded" };
    },

    async latestFor(deviceId): Promise<Evidence<VendorConfigObservation>> {
      if (visible && !visible.includes(deviceId)) {
        return { kind: "unavailable", reason: "out_of_scope" };
      }
      const latest = latestOf(deviceId);
      return latest
        ? { kind: "observed", value: latest }
        : { kind: "unavailable", reason: "never_observed" };
    },
  };

  return { sink, state };
}
