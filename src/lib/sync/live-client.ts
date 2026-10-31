import { newerLive, validLiveDevice, type LiveDevice } from "../ocpp-engine/live-projection";

export interface LiveSocket {
  onmessage: ((event: { data: string }) => void) | null;
  onclose: (() => void) | null;
  close(): void;
}
/** Framework-independent subscription adapter. Reconnects to a shared snapshot; never polls an API/database. */
export class LiveSubscriptions {
  readonly values = new Map<string, LiveDevice>();
  readonly connected = new Set<string>();
  private rooms = new Map<string, { socket?: LiveSocket; timer?: ReturnType<typeof setTimeout>; failures: number }>();
  private active = false;
  constructor(private readonly ids: string[], private readonly connect: (id: string) => LiveSocket, private readonly changed: () => void) {}
  start() {
    if (this.active) return;
    this.active = true;
    for (const id of this.ids.slice(0, 50)) { this.rooms.set(id, { failures: 0 }); this.open(id); }
  }
  private open(id: string) {
    if (!this.active) return;
    const room = this.rooms.get(id)!;
    const retry = () => {
      this.connected.delete(id);
      for (const key of this.values.keys()) if (key.startsWith(`${id}:`)) this.values.delete(key);
      this.changed();
      if (this.active) room.timer = setTimeout(() => this.open(id), Math.min(60_000, 1000 * 2 ** Math.min(room.failures++, 6)));
    };
    try {
      const ws = this.connect(id);
      room.socket = ws;
      ws.onclose = retry;
      ws.onmessage = event => {
        if (!this.active || room.socket !== ws) return;
        try {
          const message = JSON.parse(event.data);
          if (message.type === "ready" && message.installationId === id) {
            this.connected.add(id); room.failures = 0; this.changed();
          } else if (message.type === "device" && validLiveDevice(message.value) && message.value.installationId === id) {
            const value: LiveDevice = message.value;
            const key = `${id}:${value.deviceId}`;
            const held = this.values.get(key);
            if (!held || newerLive(value, held)) { this.values.set(key, value); this.changed(); }
          }
        } catch { /* malformed signals confer no state or authority */ }
      };
    } catch { retry(); }
  }
  pause() {
    this.active = false;
    for (const room of this.rooms.values()) {
      clearTimeout(room.timer);
      if (room.socket) { room.socket.onclose = null; room.socket.onmessage = null; room.socket.close(); }
    }
    this.rooms.clear(); this.connected.clear();
    this.changed();
  }
  clear() { this.pause(); this.values.clear(); }
}
