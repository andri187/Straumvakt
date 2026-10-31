"use client";

// Minimal live data for the chargers list. The page itself (server-rendered
// registered chargers) is unchanged; this only replaces the static
// "Unknown — not connected" badge with a charger's reported connector state
// when the shared read mechanism has one.
//
// Opt-in realtime: one structural snapshot, then scoped leased WebSocket subscriptions;
// no periodic HTTP data fetch. Default remains the established poller until the binding/flags are released.
// Poller cost behaviour (see src/lib/sync/poller.ts): one snapshot on open, then one
// conditional request per interval, stretching while nothing changes; NOTHING
// runs while the tab is hidden, and everything stops on sign-out/403 or unmount.
// No state is persisted: logout/unmount clears the in-memory cache.

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { SyncClient } from "@/lib/sync/client";
import type { DeviceStateView } from "@/lib/sync/model";
import { SyncPoller, type Fetchers } from "@/lib/sync/poller";
import { LiveSubscriptions } from "@/lib/sync/live-client";

const SyncContext = createContext<SyncClient | null>(null);
const TickContext = createContext(0);
const LiveContext = createContext<LiveSubscriptions | null>(null);

const fetchers: Fetchers = {
  async snapshot(ifNoneMatch) {
    const res = await fetch("/api/cpo/sync", { headers: ifNoneMatch ? { "if-none-match": ifNoneMatch } : {}, credentials: "same-origin" });
    return { status: res.status, etag: res.headers.get("etag"), realtime: res.headers.get("x-straumvakt-realtime") === "1", ...(res.status === 200 ? { body: await res.json() } : {}) };
  },
  async changes(cursor) {
    const res = await fetch(`/api/cpo/sync?since=${encodeURIComponent(cursor)}`, { credentials: "same-origin" });
    return { status: res.status, ...(res.status === 200 ? { body: await res.json() } : {}) };
  },
};

export function LiveStatusProvider({ children }: { children: ReactNode }) {
  const [client] = useState(() => new SyncClient());
  const [tick, setTick] = useState(0);
  const [live, setLive] = useState<LiveSubscriptions | null>(null);

  useEffect(() => {
    let subscriptions: LiveSubscriptions | null = null;
    const poller = new SyncPoller(client, { ...fetchers, snapshot: async etag => {
      const reply = await fetchers.snapshot(etag);
      if (active && reply.realtime && reply.status === 200 && reply.body) {
        subscriptions = new LiveSubscriptions(reply.body.installations.map(i => i.structure.installation.id), id => {
          const url = new URL(`/api/cpo/sync?installation=${encodeURIComponent(id)}`, window.location.href);
          url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
          return new WebSocket(url) as unknown as import("@/lib/sync/live-client").LiveSocket;
        }, () => { if (active) setTick(t => t + 1); });
        setLive(subscriptions);
      }
      return reply;
    } });
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
        if (subscriptions) { if (!document.hidden) subscriptions.start(); return; }
        if (nextDelayMs === null) return; // signed out / revoked: stop for good
        if (nextDelayMs > 0) await sleep(nextDelayMs);
      }
    }

    const onVisibility = () => {
      if (subscriptions) { document.hidden ? subscriptions.pause() : subscriptions.start(); return; }
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
      subscriptions?.clear();
    };
  }, [client]);

  return (
    <SyncContext.Provider value={client}>
      <LiveContext.Provider value={live}><TickContext.Provider value={tick}>{children}</TickContext.Provider></LiveContext.Provider>
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
  const live = useContext(LiveContext);
  useContext(TickContext); // re-render when a poll applied something
  const installationId = client?.get<{ installationId: string }>("charger", deviceId)?.installationId;
  const value = installationId ? live?.values.get(`${installationId}:${deviceId}`) : null;
  if (live) {
    if (!value || !installationId || !live.connected.has(installationId)) return <span className="ws-badge">Live status unavailable</span>;
    if (!value.online) return <span className="ws-badge">Offline</span>;
    if (value.onlineUntil <= Date.now()) return <span className="ws-badge">Status outdated</span>;
    const connectors = Object.fromEntries(Object.entries(value.connectors).filter(([, c]) => c.status).map(([key, c]) => [key, { status: c.status!, errorCode: c.errorCode ?? "NoError", reportedAt: c.reportedAt ?? null }]));
    const text = describeConnectors({ deviceId, connectors, seq: value.revision, lastReceivedAt: new Date(value.observedAt).toISOString(), lastReportedAt: null });
    return <span className="ws-badge">{text || "Connected"}</span>;
  }
  const text = describeConnectors(client?.deviceState(deviceId) ?? null);
  // Truthful default: no report from the charger means we do not know, and we say so.
  return <span className="ws-badge">{text ?? "Unknown — not connected"}</span>;
}
