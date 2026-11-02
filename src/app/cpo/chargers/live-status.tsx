"use client";

// Live operational status for the chargers list. The list itself (structure) comes from the shared structural store; this adds
// only each charger's reported connector state, replacing the static "Unknown - not connected" badge when one is known.
//
// Reads: one LEAN status snapshot (device states only - no installation tree is read to look up a badge), then either
//   - opt-in realtime: scoped, leased WebSocket subscriptions, no periodic HTTP fetch; or
//   - the established poller: one conditional request per interval, stretching while nothing changes; NOTHING runs while the
//     tab is hidden, and everything stops on sign-out/403.
// Realtime has an honest, bounded fallback: while a room cannot be reached (repeated failures, or unreachable for 45 s) the same
// poller runs at its normal backed-off pace and the badge says the value is polled; it stops again when the room is back.
// This is also how a revoked or expired login is noticed while push is down (the poll answers 401/403 and everything clears).
// The status client is kept for the life of the document (per session partition), so leaving the page and coming back does
// not take another snapshot: the poller resumes from its cursor, and a step is made at once only if one is already due.
// Memory only; a different session partition or sign-out drops it.

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { SyncClient } from "@/lib/sync/client";
import type { DeviceStateView, SnapshotResponse, StatusResponse } from "@/lib/sync/model";
import { SyncPoller, type Fetchers } from "@/lib/sync/poller";
import { LiveSubscriptions, type LiveSocket } from "@/lib/sync/live-client";
import { useStructural } from "../structural-react";

const SyncContext = createContext<SyncClient | null>(null);
const TickContext = createContext(0);
const LiveContext = createContext<LiveSubscriptions | null>(null);

type Warm = { partition: string; client: SyncClient; poller: SyncPoller; nextDueAt: number; realtime: boolean };
let warm: Warm | null = null;

/** The status client for this session partition. A different partition's client is dropped first. */
function warmFor(partition: string): Warm {
  if (warm && warm.partition !== partition) {
    warm.client.clear();
    warm = null;
  }
  if (!warm) {
    const client = new SyncClient();
    warm = { partition, client, poller: new SyncPoller(client, fetchers), nextDueAt: 0, realtime: false };
  }
  return warm;
}

/** The status reply carries no structure; the poller and client expect a snapshot, so each installation gets an empty shell. */
function asSnapshot(s: StatusResponse): SnapshotResponse {
  return {
    schema: s.schema,
    projection: s.projection,
    cursor: s.cursor,
    installations: s.installations.map((i) => ({
      structure: { installation: { id: i.id, displayName: "", revision: 0, mainRatingAmps: null, mainPhaseCount: null }, circuits: [], chargers: [] },
      devices: i.devices,
    })),
  };
}

const fetchers: Fetchers = {
  async snapshot(ifNoneMatch) {
    const res = await fetch("/api/cpo/sync?view=status", { headers: ifNoneMatch ? { "if-none-match": ifNoneMatch } : {}, credentials: "same-origin" });
    const realtime = res.headers.get("x-straumvakt-realtime") === "1";
    if (res.status === 200 && realtime && warm) warm.realtime = true; // the server offers push for this session; the provider switches to it
    return { status: res.status, etag: res.headers.get("etag"), realtime, ...(res.status === 200 ? { body: asSnapshot((await res.json()) as StatusResponse) } : {}) };
  },
  async changes(cursor) {
    const res = await fetch(`/api/cpo/sync?since=${encodeURIComponent(cursor)}`, { credentials: "same-origin" });
    return { status: res.status, ...(res.status === 200 ? { body: await res.json() } : {}) };
  },
};

const openSocket = (id: string): LiveSocket => {
  const url = new URL(`/api/cpo/sync?installation=${encodeURIComponent(id)}`, window.location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return new WebSocket(url) as unknown as LiveSocket;
};

export function LiveStatusProvider({ installationIds, children }: { installationIds: string[]; children: ReactNode }) {
  const store = useStructural();
  const partition = store.partition ?? "";
  const idsKey = installationIds.join("|");
  const [tick, setTick] = useState(0);
  const [live, setLive] = useState<LiveSubscriptions | null>(null);
  const [client, setClient] = useState<SyncClient>(() => warmFor(partition).client);

  useEffect(() => {
    const w = warmFor(partition);
    setClient(w.client);
    let active = true;
    let subscriptions: LiveSubscriptions | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let wake: (() => void) | undefined;

    let degraded = false;
    let polling = false;
    const startRealtime = () => {
      subscriptions = new LiveSubscriptions(idsKey ? idsKey.split("|") : [], openSocket, () => { if (active) setTick((t) => t + 1); }, {
        onDegraded: (d) => {
          degraded = d;
          if (d) void loop(); // bounded HTTP fallback while push is unreachable
          else wake?.(); // push is back: the loop ends at its next check
        },
      });
      setLive(subscriptions);
      if (!document.hidden) subscriptions.start();
    };
    const sleep = (ms: number) => new Promise<void>((resolve) => { wake = resolve; timer = setTimeout(resolve, ms); });
    const waitVisible = () => new Promise<void>((resolve) => { wake = resolve; });

    async function loop() {
      if (polling) return;
      polling = true;
      try {
        // Returning to a warm client: do nothing until a step is actually due; a fresh one takes its snapshot now.
        const due = w.client.cursor === null ? 0 : w.nextDueAt - Date.now();
        if (due > 0) await sleep(due);
        while (active && (!subscriptions || degraded)) {
          if (document.hidden) { await waitVisible(); continue; }
          const { event, nextDelayMs } = await w.poller.step();
          if (!active) return;
          w.nextDueAt = Date.now() + (nextDelayMs ?? 0);
          if (event === "signed_out") { subscriptions?.clear(); warm = null; setTick((t) => t + 1); return; }
          setTick((t) => t + 1);
          if (event === "snapshot" && w.realtime && !subscriptions) { startRealtime(); return; }
          if (nextDelayMs === null) return;
          if (nextDelayMs > 0) await sleep(nextDelayMs);
        }
      } finally {
        polling = false;
      }
    }

    const onVisibility = () => {
      if (subscriptions) { if (document.hidden) subscriptions.pause(); else subscriptions.start(); wake?.(); return; }
      if (!document.hidden && wake) { clearTimeout(timer); wake(); }
      else if (document.hidden) { clearTimeout(timer); wake?.(); }
    };
    document.addEventListener("visibilitychange", onVisibility);
    if (w.realtime && w.client.cursor !== null) startRealtime(); // the sockets send their own snapshot on connect
    else void loop();
    return () => {
      active = false;
      clearTimeout(timer);
      wake?.();
      document.removeEventListener("visibilitychange", onVisibility);
      subscriptions?.clear(); // no sockets stay open for a page nobody is looking at; the status client itself is kept
      setLive(null);
    };
  }, [partition, idsKey]);

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

export function LiveConnection({ deviceId, installationId }: { deviceId: string; installationId: string }) {
  const client = useContext(SyncContext);
  const live = useContext(LiveContext);
  useContext(TickContext); // re-render when a poll applied something
  const value = live?.values.get(`${installationId}:${deviceId}`);
  if (live) {
    if (!value || !live.isLive(installationId)) {
      // Not live right now. If the bounded fallback poll has a value, show it AS polled; otherwise say plainly there is none.
      const polled = client?.deviceState(deviceId) ?? null;
      const polledText = describeConnectors(polled);
      if (polledText) return <span className="ws-badge" title={`Polled, not live: live updates are reconnecting. Last received ${polled!.lastReceivedAt}`}>{polledText}</span>;
      return <span className="ws-badge">{live.connected.has(installationId) ? "No live report yet" : "Live status unavailable"}</span>;
    }
    if (!value.online) return <span className="ws-badge">Offline</span>;
    // The observation's own lease has run out. This says we have HEARD nothing recent; it is not a claim that the charger is disconnected.
    if (value.onlineUntil <= Date.now()) return <span className="ws-badge" title="No recent report from the gateway; this is the age of the last observation, not proof of a lost connection.">Status outdated</span>;
    const connectors = Object.fromEntries(Object.entries(value.connectors).filter(([, c]) => c.status).map(([key, c]) => [key, { status: c.status!, errorCode: c.errorCode ?? "NoError", reportedAt: c.reportedAt ?? null }]));
    const text = describeConnectors({ deviceId, connectors, seq: value.revision, lastReceivedAt: new Date(value.observedAt).toISOString(), lastReportedAt: null });
    return <span className="ws-badge">{text || "Connected"}</span>;
  }
  const state = client?.deviceState(deviceId) ?? null;
  const text = describeConnectors(state);
  // Truthful default: no report from the charger means we do not know, and we say so.
  return <span className="ws-badge" title={state ? `Last received ${state.lastReceivedAt}` : undefined}>{text ?? "Unknown — not connected"}</span>;
}
