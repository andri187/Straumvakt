// Browser-side structural cache shared by the installations and chargers overviews (and invalidated by the editor).
// Framework-free: the React bindings are in src/app/cpo/structural-react.tsx. Memory only - nothing is persisted, so a new
// document (sign-in, sign-out, reload) always starts empty; there is no storage a previous user's data could survive in.
//
// GUARANTEES
//   - Partitioned: everything is held under one partition (session identity). bind() with another partition drops it all.
//   - Epoch-guarded: every clear / local mutation / partition change bumps an epoch; a response that began before that is
//     discarded on arrival, so a slow answer can never repaint data that was meant to be gone.
//   - Deduplicated: one in-flight request per key; concurrent callers (two views, a double click) share it.
//   - A revisit costs nothing: a held entry is served with no request. Whether it is still current is a separate, cheap,
//     rate-limited question (check()), answered by revision numbers - never by assuming "unchanged".
//   - Revoked or removed installations disappear at once; changed or added ones raise "Updates available" and are applied
//     only by refresh(), so a view never rearranges itself under the reader.
//   - 401/403 from anything clears all data and reports "denied".
//
// It schedules nothing: no timers, no polling. Callers decide when a view is entered or resumed.

import type { ChargerListRow, InstallationListRow } from "@/lib/installations/drizzle-store";
import type { IncomingCharger } from "@/lib/installations/discovery";
import type { DetailView } from "@/lib/installations/tree";
import type { CheckResponse } from "./model";

export const CLIENT_COOLDOWN_MS = 30_000;
export const INCOMING_FRESH_MS = 30_000;
export const MAX_DETAILS = 50;

export type Revisions = Record<string, number>;
/** "limited" = the server declined an expensive read for now (HTTP 429). What is held stays visible; nothing is re-sent before its retry-after. */
export type Failure = "denied" | "failed" | "gone" | "limited";
export type Slot<T> = { status: "idle" } | { status: "loading"; previous: T | null } | { status: "ready"; data: T } | { status: "error"; kind: Failure; previous: T | null; retryAfterMs?: number };

export type OverviewData = { rows: InstallationListRow[]; revisions: Revisions };
export type ChargersData = { rows: ChargerListRow[]; revisions: Revisions };
export type DetailData = { view: DetailView; revision: number | null };
export type IncomingData = { rows: IncomingCharger[] | null; asOf: string; fetchedAtMs: number };

export type RefreshOutcome =
  | { kind: "applied" }
  | { kind: "no_changes"; checkedAt: number }
  | { kind: "cooldown"; retryAfterMs: number; checkedAt: number | null }
  | { kind: "denied" }
  | { kind: "failed" };

type Options = { fetch: typeof fetch; now?: () => number; cooldownMs?: number; maxDetails?: number };
type Listener = () => void;
type Sent = { overview: number; chargers: number; detail: number; incoming: number; check: number };

const IDLE = { status: "idle" } as const;
const heldOf = <T,>(s: Slot<T>): T | null => (s.status === "ready" ? s.data : s.status === "loading" || s.status === "error" ? s.previous : null);

const OVERVIEW_URL = "/api/cpo/installations";
const CHARGERS_URL = "/api/cpo/installations?view=chargers";
const detailUrl = (id: string) => `/api/cpo/installations?id=${encodeURIComponent(id)}&shape=tree`;

const parseOverview = (b: unknown): OverviewData => {
  const body = b as { installations: InstallationListRow[]; revisions?: Revisions };
  if (!body || !Array.isArray(body.installations)) throw new Error("bad shape");
  return { rows: body.installations, revisions: body.revisions ?? {} };
};
const parseChargers = (b: unknown): ChargersData => {
  const body = b as { chargers: ChargerListRow[]; revisions?: Revisions };
  if (!body || !Array.isArray(body.chargers)) throw new Error("bad shape");
  return { rows: body.chargers, revisions: body.revisions ?? {} };
};
const parseDetail = (b: unknown): DetailData => {
  const view = b as DetailView;
  if (!view || !Array.isArray(view.circuits) || !Array.isArray(view.chargers) || !view.installation) throw new Error("bad shape");
  return { view, revision: (view.installation as { revision?: number }).revision ?? null };
};

export class StructuralStore {
  private readonly doFetch: typeof fetch;
  private readonly now: () => number;
  private readonly cooldownMs: number;
  private readonly maxDetails: number;
  private readonly listeners = new Set<Listener>();
  private version = 0;
  private epoch = 0;
  private inflight = new Map<string, Promise<void>>();
  /** Earliest client time a read of this key may be sent again after the server said "later" (429). */
  private limitedUntil = new Map<string, number>();
  /** Revisions from the most recent check, kept so applying updates can be judged against them. */
  private latest: Revisions | null = null;
  /** Least recently used first. */
  private details = new Map<string, Slot<DetailData>>();

  partition: string | null = null;
  overview: Slot<OverviewData> = IDLE;
  chargers: Slot<ChargersData> = IDLE;
  incoming: Slot<IncomingData> = IDLE;
  /** Expansion state lives here so navigating away and back shows the same open rows. Sites and installations start collapsed. */
  ui = { openInstallations: new Set<string>(), openSites: new Set<string>() };

  updatesAvailable = false;
  /** Installations whose held data is behind the latest check, including ones added since. */
  staleIds = new Set<string>();
  /** Client-clock time of the last observation of the server's revisions (a fetch or a check), minus its reported age. */
  lastCheckedAt: number | null = null;
  /** Earliest client-clock time another check may be sent (mirrors the server's retry-after). */
  nextCheckAt = 0;
  checkFailed = false;
  denied = false;
  /** For measurement: requests actually sent, by kind. */
  readonly sent: Sent = { overview: 0, chargers: 0, detail: 0, incoming: 0, check: 0 };

  constructor(o: Options) {
    this.doFetch = o.fetch;
    this.now = o.now ?? Date.now;
    this.cooldownMs = o.cooldownMs ?? CLIENT_COOLDOWN_MS;
    this.maxDetails = o.maxDetails ?? MAX_DETAILS;
  }

  // ── subscription ──────────────────────────────────────────────────────────
  subscribe = (l: Listener): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  getVersion = (): number => this.version;
  private changed() {
    this.version += 1;
    for (const l of [...this.listeners]) l();
  }

  // ── lifecycle ─────────────────────────────────────────────────────────────
  /** Idempotent. A different partition (another session) drops everything before anything is read. */
  bind(partition: string): void {
    if (this.partition === partition) return;
    const hadPartition = this.partition !== null;
    this.partition = partition;
    if (hadPartition) this.clear();
  }

  /** Logout, partition change, revoked access: drop all data and invalidate every request still in flight. */
  clear(): void {
    this.reset();
    this.denied = false;
    this.changed();
  }

  private reset() {
    this.epoch += 1;
    this.overview = IDLE;
    this.chargers = IDLE;
    this.incoming = IDLE;
    this.details.clear();
    this.inflight.clear();
    this.limitedUntil.clear();
    this.ui = { openInstallations: new Set(), openSites: new Set() };
    this.updatesAvailable = false;
    this.staleIds = new Set();
    this.latest = null;
    this.lastCheckedAt = null;
    this.nextCheckAt = 0;
    this.checkFailed = false;
  }

  /** A successful write by this user. Takes effect immediately; it never waits for the cooldown. */
  localMutation(installationId?: string): void {
    this.epoch += 1;
    this.inflight.clear();
    this.overview = IDLE;
    this.chargers = IDLE;
    if (installationId) this.details.delete(installationId);
    else this.details.clear();
    this.updatesAvailable = false;
    this.staleIds = new Set();
    this.latest = null;
    this.lastCheckedAt = null;
    this.nextCheckAt = 0;
    this.changed();
  }

  private deny() {
    this.reset();
    this.denied = true;
    this.changed();
  }

  // ── reads ─────────────────────────────────────────────────────────────────
  private load<T>(key: string, kind: keyof Sent, url: string, parse: (body: unknown) => T, set: (slot: Slot<T>) => void, previous: T | null, observesRevisions = false): Promise<void> {
    const existing = this.inflight.get(key);
    if (existing) return existing;
    // The server asked us to wait: respect it without sending anything, and leave the held data and slot as they are.
    if ((this.limitedUntil.get(key) ?? 0) > this.now()) return Promise.resolve();
    const epoch = this.epoch;
    set({ status: "loading", previous });
    this.changed();
    const run = (async () => {
      this.sent[kind] += 1;
      try {
        const res = await this.doFetch(url, { credentials: "same-origin", headers: { accept: "application/json" } });
        if (epoch !== this.epoch) return;
        if (res.status === 401 || res.status === 403) return this.deny();
        if (res.status === 404) {
          set({ status: "error", kind: "gone", previous: null });
          return this.changed();
        }
        if (res.status === 429) {
          const wait = Math.min(60_000, Math.max(1_000, (Number(res.headers.get("retry-after")) || 5) * 1000));
          this.limitedUntil.set(key, this.now() + wait);
          set({ status: "error", kind: "limited", previous, retryAfterMs: wait });
          return this.changed();
        }
        if (!res.ok) {
          set({ status: "error", kind: "failed", previous });
          return this.changed();
        }
        const data = parse(await res.json());
        if (epoch !== this.epoch) return;
        // A list that carries revisions is itself a fresh observation of the server: the first one is the check baseline.
        if (observesRevisions && this.lastCheckedAt === null) this.lastCheckedAt = this.now();
        set({ status: "ready", data });
        this.changed();
      } catch {
        if (epoch !== this.epoch) return;
        set({ status: "error", kind: "failed", previous });
        this.changed();
      }
    })().finally(() => {
      if (epoch === this.epoch) this.inflight.delete(key);
    });
    this.inflight.set(key, run);
    return run;
  }

  /** No request when held. A failed slot is retried only by an explicit `retry`. */
  ensureOverview(retry = false): Promise<void> {
    const s = this.overview;
    if (this.denied || s.status === "ready" || (s.status === "error" && !retry)) return Promise.resolve();
    return this.load("overview", "overview", OVERVIEW_URL, parseOverview, (n) => (this.overview = n), heldOf(s), true);
  }

  ensureChargers(retry = false): Promise<void> {
    const s = this.chargers;
    if (this.denied || s.status === "ready" || (s.status === "error" && !retry)) return Promise.resolve();
    return this.load("chargers", "chargers", CHARGERS_URL, parseChargers, (n) => (this.chargers = n), heldOf(s), true);
  }

  detail(id: string): Slot<DetailData> {
    return this.details.get(id) ?? IDLE;
  }

  private setDetail(id: string, slot: Slot<DetailData>) {
    this.details.delete(id);
    this.details.set(id, slot);
    while (this.details.size > this.maxDetails) this.details.delete(this.details.keys().next().value as string);
  }

  /** Fetched on first expansion or when invalidated; never preloaded. */
  ensureDetail(id: string, retry = false): Promise<void> {
    const s = this.detail(id);
    if (this.denied || s.status === "ready" || (s.status === "error" && !retry)) return Promise.resolve();
    return this.load(`detail:${id}`, "detail", detailUrl(id), parseDetail, (n) => this.setDetail(id, n), heldOf(s));
  }

  /** Incoming (discovery) is operational, not structural: a held snapshot is reused only while it is fresh. */
  ensureIncoming(): Promise<void> {
    const s = this.incoming;
    if (this.denied || (s.status === "ready" && this.now() - s.data.fetchedAtMs < INCOMING_FRESH_MS)) return Promise.resolve();
    return this.load("incoming", "incoming", "/api/cpo/installations?incoming=1", (b): IncomingData => {
      const body = b as { incoming: IncomingCharger[]; asOf: string };
      if (!body || !Array.isArray(body.incoming)) throw new Error("bad shape");
      return { rows: body.incoming, asOf: body.asOf, fetchedAtMs: this.now() };
    }, (n) => (this.incoming = n), heldOf(s));
  }

  // ── freshness ─────────────────────────────────────────────────────────────
  /** Earliest client time another check may be sent: the server's retry-after, and one cooldown after the last observation. */
  nextAllowedAt(): number {
    return Math.max(this.nextCheckAt, this.lastCheckedAt === null ? 0 : this.lastCheckedAt + this.cooldownMs);
  }

  /** Eligible = something is held, nothing is in flight, and the (server-mirrored) cooldown has passed. */
  checkEligible(): boolean {
    const holds = this.overview.status === "ready" || this.chargers.status === "ready";
    return holds && !this.denied && !this.inflight.has("check") && this.now() >= this.nextAllowedAt();
  }

  /** View entry / resume: one small request if eligible, otherwise nothing at all. */
  async onViewEnter(): Promise<void> {
    if (this.checkEligible()) await this.check();
  }

  async check(): Promise<void> {
    const existing = this.inflight.get("check");
    if (existing) return existing;
    const epoch = this.epoch;
    const run = (async () => {
      this.sent.check += 1;
      try {
        const res = await this.doFetch("/api/cpo/sync?check=1", { credentials: "same-origin", headers: { accept: "application/json" } });
        if (epoch !== this.epoch) return;
        if (res.status === 401 || res.status === 403) return this.deny();
        if (!res.ok) {
          this.checkFailed = true;
          this.nextCheckAt = this.now() + this.cooldownMs; // do not hammer a failing endpoint
          return this.changed();
        }
        const body = (await res.json()) as CheckResponse;
        if (epoch !== this.epoch) return;
        const t = this.now();
        this.checkFailed = false;
        this.lastCheckedAt = t - Math.max(0, body.ageMs ?? 0);
        this.nextCheckAt = t + Math.max(0, body.retryAfterMs);
        this.latest = body.revisions;
        this.absorb(body.revisions);
        this.changed();
      } catch {
        if (epoch !== this.epoch) return;
        this.checkFailed = true;
        this.nextCheckAt = this.now() + this.cooldownMs;
        this.changed();
      }
    })().finally(() => {
      if (epoch === this.epoch) this.inflight.delete("check");
    });
    this.inflight.set("check", run);
    return run;
  }

  /** Compare the latest revisions with what each held entry was built from. */
  private absorb(latest: Revisions): void {
    const stale = new Set<string>();
    let removed = false;
    for (const slot of [this.overview, this.chargers] as Slot<{ revisions: Revisions }>[]) {
      if (slot.status !== "ready") continue;
      const held = slot.data.revisions;
      for (const id of Object.keys(held)) {
        if (!(id in latest)) removed = true;
        else if (latest[id] !== held[id]) stale.add(id);
      }
      for (const id of Object.keys(latest)) if (!(id in held)) stale.add(id);
    }
    for (const [id, slot] of [...this.details]) {
      if (!(id in latest)) this.details.delete(id);
      else if (slot.status === "ready" && slot.data.revision !== null && slot.data.revision !== latest[id]) stale.add(id);
    }
    if (removed) this.dropMissing(latest);
    this.staleIds = stale;
    this.updatesAvailable = stale.size > 0;
  }

  /** An installation no longer in the authorised set (revoked or removed): not shown, not kept. */
  private dropMissing(latest: Revisions): void {
    const keep = (r: Revisions) => Object.fromEntries(Object.entries(r).filter(([id]) => id in latest));
    if (this.overview.status === "ready") {
      const d = this.overview.data;
      this.overview = { status: "ready", data: { rows: d.rows.filter((r) => r.id in latest), revisions: keep(d.revisions) } };
    }
    if (this.chargers.status === "ready") {
      const d = this.chargers.data;
      this.chargers = { status: "ready", data: { rows: d.rows.filter((r) => r.installationId in latest), revisions: keep(d.revisions) } };
    }
    for (const id of [...this.ui.openInstallations]) if (!(id in latest)) this.ui.openInstallations.delete(id);
  }

  /**
   * The explicit Refresh. Known pending updates are applied at once. Otherwise one check is sent if the cooldown allows;
   * inside the cooldown nothing is sent and the caller learns when the next check is possible.
   */
  async refresh(): Promise<RefreshOutcome> {
    if (this.denied) return { kind: "denied" };
    if (!this.updatesAvailable) {
      const wait = this.nextAllowedAt() - this.now();
      if (wait > 0) return { kind: "cooldown", retryAfterMs: wait, checkedAt: this.lastCheckedAt };
      await this.check();
      if (this.denied) return { kind: "denied" };
      if (this.checkFailed) return { kind: "failed" };
      if (!this.updatesAvailable) return { kind: "no_changes", checkedAt: this.lastCheckedAt ?? this.now() };
    }
    await this.apply();
    return this.denied ? { kind: "denied" } : { kind: "applied" };
  }

  /** Refetch only what is held and behind. Expanded details that changed reload in place; the previous data stays visible meanwhile. */
  private async apply(): Promise<void> {
    const stale = this.staleIds;
    const jobs: Promise<void>[] = [];
    const o = this.overview;
    if (o.status === "ready") jobs.push(this.load("overview", "overview", OVERVIEW_URL, parseOverview, (n) => (this.overview = n), o.data, true));
    const c = this.chargers;
    if (c.status === "ready") jobs.push(this.load("chargers", "chargers", CHARGERS_URL, parseChargers, (n) => (this.chargers = n), c.data, true));
    for (const [id, slot] of [...this.details]) {
      if (!stale.has(id) || slot.status !== "ready") continue;
      if (this.ui.openInstallations.has(id)) jobs.push(this.load(`detail:${id}`, "detail", detailUrl(id), parseDetail, (n) => this.setDetail(id, n), slot.data));
      else this.details.delete(id); // not on screen: fetched on its next expansion
    }
    await Promise.all(jobs);
    // Judge the result against the latest known revisions: if the server handed back something still behind, stay honest.
    if (this.latest) this.absorb(this.latest);
    else {
      this.staleIds = new Set();
      this.updatesAvailable = false;
    }
    this.changed();
  }

  // ── view state ────────────────────────────────────────────────────────────
  setInstallationOpen(id: string, open: boolean): void {
    if (open) this.ui.openInstallations.add(id);
    else this.ui.openInstallations.delete(id);
    this.changed();
  }
  setSiteOpen(siteId: string, open: boolean): void {
    if (open) this.ui.openSites.add(siteId);
    else this.ui.openSites.delete(siteId);
    this.changed();
  }
}
