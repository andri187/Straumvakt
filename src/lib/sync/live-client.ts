import { newerLive, validLiveDevice, type LiveDevice } from "../ocpp-engine/live-projection";

export interface LiveSocket {
  onmessage: ((event: { data: string }) => void) | null;
  onclose: ((event?: { code?: number }) => void) | null;
  close(): void;
}

/** The room closes a socket with this code when its access lease ends. Expected every lease; not a failure. */
export const LEASE_CLOSE_CODE = 4001;
/** A reconnect inside this window is invisible: the held values stay on screen (they carry their own expiry). */
export const RECONNECT_GRACE_MS = 8_000;
/** A room that has been unreachable this long, or failed this many times in a row, is degraded: the caller falls back to bounded HTTP polling. */
export const DEGRADED_AFTER_MS = 45_000;
export const DEGRADED_AFTER_FAILURES = 3;

type Options = {
  now?: () => number;
  random?: () => number;
  /** Called only on a change of state. true = at least one room cannot be reached; false = all reachable again. */
  onDegraded?: (degraded: boolean) => void;
  setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (t: ReturnType<typeof setTimeout>) => void;
};
type Room = { socket?: LiveSocket; timer?: ReturnType<typeof setTimeout>; failures: number; downSince: number | null; lostAt: number | null; seen: Set<string> | null };

/**
 * Framework-independent subscription adapter. Reconnects to a shared snapshot; never polls an API/database.
 *
 * What it guarantees the screen:
 *  - a value is shown only until its own `onlineUntil` (a re-render is scheduled for that moment, so an expired observation is
 *    reported as outdated even if nothing else arrives - and that is "we have heard nothing since", never "disconnected");
 *  - a normal lease renewal (close 4001, immediate reconnect) does not flicker: values are held through RECONNECT_GRACE_MS;
 *  - the first message set after a (re)connect is the room's complete snapshot: anything held that it does not repeat is gone
 *    (removed or moved while we were away), and `remove` messages drop a device at once;
 *  - an unreachable room is reported (`onDegraded`) so the caller can fall back to bounded HTTP polling, with backoff and
 *    jitter on every reconnect so a restarted room is not hit by every viewer in the same second.
 */
export class LiveSubscriptions {
  readonly values = new Map<string, LiveDevice>();
  readonly connected = new Set<string>();
  private rooms = new Map<string, Room>();
  private active = false;
  private degraded = false;
  private expiryTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly setTimer: NonNullable<Options["setTimer"]>;
  private readonly clearTimer: NonNullable<Options["clearTimer"]>;
  constructor(private readonly ids: string[], private readonly connect: (id: string) => LiveSocket, private readonly changed: () => void, private readonly options: Options = {}) {
    this.now = options.now ?? Date.now;
    this.random = options.random ?? Math.random;
    this.setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = options.clearTimer ?? ((t) => clearTimeout(t));
  }

  start() {
    if (this.active) return;
    this.active = true;
    for (const id of this.ids.slice(0, 50)) { this.rooms.set(id, { failures: 0, downSince: this.now(), lostAt: null, seen: null }); this.open(id); }
    this.scheduleExpiry();
  }

  /** True while this installation's room is connected, or was a moment ago (within the grace). Only then are its values shown as live. */
  isLive(id: string): boolean {
    if (this.connected.has(id)) return true;
    const room = this.rooms.get(id);
    return !!room && room.lostAt !== null && this.now() - room.lostAt < RECONNECT_GRACE_MS;
  }

  private open(id: string) {
    if (!this.active) return;
    const room = this.rooms.get(id)!;
    room.seen = new Set();
    const lost = (event?: { code?: number }) => {
      if (room.socket !== ws) return;
      const reachedReady = this.connected.has(id);
      this.connected.delete(id);
      room.seen = null;
      if (reachedReady) room.lostAt = this.now();
      room.downSince ??= this.now();
      // A lease ending is routine: reconnect straight away and do not count it. Anything else counts and backs off.
      const routine = reachedReady && event?.code === LEASE_CLOSE_CODE;
      if (!routine) room.failures += 1;
      this.evaluate();
      this.changed();
      if (this.active) room.timer = this.setTimer(() => this.open(id), routine ? 250 : this.backoff(room.failures));
    };
    let ws!: LiveSocket;
    try {
      ws = this.connect(id);
    } catch {
      room.failures += 1;
      room.downSince ??= this.now();
      this.evaluate();
      if (this.active) room.timer = this.setTimer(() => this.open(id), this.backoff(room.failures));
      return;
    }
    room.socket = ws;
    ws.onclose = lost;
    ws.onmessage = (event) => {
      if (!this.active || room.socket !== ws) return;
      try {
        const message = JSON.parse(event.data);
        if (message.type === "ready" && message.installationId === id) {
          // The snapshot is complete: whatever we held for this installation that it did not repeat has left.
          for (const key of [...this.values.keys()]) if (key.startsWith(`${id}:`) && !room.seen?.has(key)) this.values.delete(key);
          room.seen = null;
          room.failures = 0;
          room.downSince = null;
          room.lostAt = null;
          this.connected.add(id);
          this.evaluate();
          this.scheduleExpiry();
          this.changed();
        } else if (message.type === "device" && validLiveDevice(message.value) && message.value.installationId === id) {
          const value: LiveDevice = message.value;
          const key = `${id}:${value.deviceId}`;
          // The first value for a device in the post-connect snapshot is the room's current truth and replaces what was held from
          // before the outage; every other value (a duplicate in the snapshot, or any later push) must be newer to be applied.
          const firstInSnapshot = room.seen !== null && !room.seen.has(key);
          room.seen?.add(key);
          const held = this.values.get(key);
          if (firstInSnapshot || !held || newerLive(value, held)) {
            this.values.set(key, value);
            this.scheduleExpiry();
            this.changed();
          }
        } else if (message.type === "remove" && typeof message.deviceId === "string") {
          if (this.values.delete(`${id}:${message.deviceId}`)) this.changed();
        }
      } catch { /* malformed signals confer no state or authority */ }
    };
  }

  private backoff(failures: number): number {
    const base = Math.min(60_000, 1000 * 2 ** Math.min(Math.max(failures - 1, 0), 6));
    return Math.round(base * (0.8 + 0.4 * this.random()));
  }

  /** Degraded = some room cannot be reached (repeated failures, or down for a long time). Reported on change only. */
  private evaluate() {
    if (!this.active) return;
    const t = this.now();
    const now = [...this.rooms.values()].some((r) => r.failures >= DEGRADED_AFTER_FAILURES || (r.downSince !== null && t - r.downSince >= DEGRADED_AFTER_MS));
    if (now !== this.degraded) { this.degraded = now; this.options.onDegraded?.(now); }
  }

  /** One timer for the soonest value expiry: at that moment the screen re-renders and reports the observation outdated. */
  private scheduleExpiry() {
    if (this.expiryTimer !== undefined) { this.clearTimer(this.expiryTimer); this.expiryTimer = undefined; }
    if (!this.active) return;
    const t = this.now();
    let next = Infinity;
    for (const v of this.values.values()) if (v.onlineUntil > t) next = Math.min(next, v.onlineUntil);
    // Also re-evaluate degradation without a socket event (a room that never answers has no events at all).
    for (const r of this.rooms.values()) if (r.downSince !== null) next = Math.min(next, r.downSince + DEGRADED_AFTER_MS > t ? r.downSince + DEGRADED_AFTER_MS : Infinity);
    if (!Number.isFinite(next)) return;
    this.expiryTimer = this.setTimer(() => { this.expiryTimer = undefined; this.evaluate(); this.changed(); this.scheduleExpiry(); }, Math.min(Math.max(next - t + 50, 50), 2 ** 31 - 1));
  }

  pause() {
    this.active = false;
    if (this.expiryTimer !== undefined) { this.clearTimer(this.expiryTimer); this.expiryTimer = undefined; }
    for (const room of this.rooms.values()) {
      if (room.timer !== undefined) this.clearTimer(room.timer);
      if (room.socket) { room.socket.onclose = null; room.socket.onmessage = null; room.socket.close(); }
    }
    this.rooms.clear(); this.connected.clear();
    if (this.degraded) { this.degraded = false; this.options.onDegraded?.(false); }
    this.changed();
  }
  clear() { this.pause(); this.values.clear(); }
}
