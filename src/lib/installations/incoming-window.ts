// How long an unregistered incoming charger stays listed after its last recorded knock. A visibility window only:
// it deletes nothing, bans nothing and says nothing about whether a charger is physically online. The engine records a
// knock at most once per DISCOVERY_WRITE_INTERVAL_SECONDS (300), so a charger that is still knocking can look up to five
// minutes older than it is. Kept import-free so the browser component can share it with the server read.
export const INCOMING_WINDOW_MS = 30 * 60 * 1000;

/** Listed while lastSeen is strictly inside the window; at the exact boundary it is hidden. */
export const incomingVisible = (lastSeenAtMs: number, nowMs: number) => lastSeenAtMs > nowMs - INCOMING_WINDOW_MS;

export const incomingExpiresAtMs = (lastSeenAtMs: number) => lastSeenAtMs + INCOMING_WINDOW_MS;
