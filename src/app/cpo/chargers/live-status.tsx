"use client";

// Minimal live data for the chargers list. The page itself (server-rendered
// registered chargers) is unchanged; this only replaces the static
// "Unknown — not connected" badge with a charger's reported connector state
// when the shared read mechanism has one.
//
// Cost behaviour (see src/lib/sync/poller.ts): one snapshot on open, then one
// conditional request per interval, stretching while nothing changes; NOTHING
// runs while the tab is hidden, and everything stops on sign-out/403 or unmount.
// No state is persisted: logout/unmount clears the in-memory cache.

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { SyncClient } from "@/lib/sync/client";
import type { DeviceStateView } from "@/lib/sync/model";
import { SyncPoller, type Fetchers } from "@/lib/sync/poller";

const SyncContext = createContext<SyncClient | null>(null);
const TickContext = createContext(0);

const fetchers: Fetchers = {
  async snapshot(ifNoneMatch) {
    const res = await fetch("/api/cpo/sync", { headers: ifNoneMatch ? { "if-none-match": ifNoneMatch } : {}, credentials: "same-origin" });
    return { status: res.status, etag: res.headers.get("etag"), ...(res.status === 200 ? { body: await res.json() } : {}) };
  },
  async changes(cursor) {
    const res = await fetch(`/api/cpo/sync?since=${encodeURIComponent(cursor)}`, { credentials: "same-origin" });
    return { status: res.status, ...(res.status === 200 ? { body: await res.json() } : {}) };
  },
};

export function LiveStatusProvider({ children }: { children: ReactNode }) {
  const [client] = useState(() => new SyncClient());
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const poller = new SyncPoller(client, fetchers);
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let wake: (() => void) | undefined;

    const sleep = (ms: number) =>
      new Promise<void>((resolve) => {
        wake = resolve;
        timer = setTimeout(resolve, ms);
      });
    const waitVisible = () =>
      new Promise<void>((resolve) => {
        wake = resolve;
      });

    async function loop() {
      while (active) {
        if (document.hidden) {
          await waitVisible(); // nothing is scheduled while hidden
          continue;
        }
        const { nextDelayMs } = await poller.step();
        if (!active) return;
        setTick((t) => t + 1);
        if (nextDelayMs === null) return; // signed out / revoked: stop for good
        if (nextDelayMs > 0) await sleep(nextDelayMs);
      }
    }

    const onVisibility = () => {
      if (!document.hidden && wake) {
        clearTimeout(timer);
        wake(); // catch up as soon as the tab is visible again
      } else if (document.hidden) {
        clearTimeout(timer); // cancel the pending timer; the loop then parks in waitVisible()
        wake?.();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    void loop();
    return () => {
      active = false;
      clearTimeout(timer);
      wake?.();
      document.removeEventListener("visibilitychange", onVisibility);
      client.clear();
    };
  }, [client]);

  return (
    <SyncContext.Provider value={client}>
      <TickContext.Provider value={tick}>{children}</TickContext.Provider>
    </SyncContext.Provider>
  );
}

export function describeConnectors(state: DeviceStateView | null): string | null {
  if (!state) return null;
  const parts = Object.entries(state.connectors)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([n, c]) => `${Object.keys(state.connectors).length > 1 ? `Connector ${n}: ` : ""}${c.status}${c.errorCode && c.errorCode !== "NoError" ? ` (${c.errorCode})` : ""}`);
  return parts.length ? parts.join(" · ") : null;
}

export function LiveConnection({ deviceId }: { deviceId: string }) {
  const client = useContext(SyncContext);
  useContext(TickContext); // re-render when a poll applied something
  const text = describeConnectors(client?.deviceState(deviceId) ?? null);
  // Truthful default: no report from the charger means we do not know, and we say so.
  return <span className="ws-badge">{text ?? "Unknown — not connected"}</span>;
}
