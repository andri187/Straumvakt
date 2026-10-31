/**
 * Per-CPO admission gate for pending sockets.
 *
 * One small Durable Object per CPO (`pending-gate:{cpo}`, the existing class, no new binding or migration) holds a set of
 * leases, one per waiting charge point id. The entry Worker takes a lease BEFORE it forwards an upgrade to the pending
 * object; the pending object confirms it on the first boot, renews it, and gives it back when its last socket goes. Because
 * a Durable Object runs one request at a time, "count then add" cannot race: the cap is exact while leases are honest.
 *
 * OWNERSHIP. Every upgrade carries one random token (minted by the entry Worker, handed on to the pending object). A lease
 * names who may change it:
 *   - `a` (attempt): the token of an upgrade that is in flight. It lasts at most ATTEMPT_MS (the first-boot deadline) and
 *     only one attempt per id is live at a time; a second concurrent upgrade of the same id is refused (429), so there is no
 *     list of attempts to grow.
 *   - `o` (owner): the token of the connection that holds the slot. The pending object promotes `a` to `o` with its first
 *     renewal (it sends the same token), and replaces it when a newer connection of the same id confirms.
 * Every mutation carries a token and only applies when the token still matches, so a call that arrives late (an old close, a
 * failed upgrade, a stale renewal) cannot free, recreate or take the slot of a newer connection:
 *   - `releaseAttempt` (entry Worker, upgrade refused): only clears a still-unconfirmed attempt. It never ends an owner.
 *   - `releaseOwner` (pending object, socket gone): ends the lease when the token is the owner's or the unconfirmed attempt's
 *     (the pending object has one live connection per id, so an older owner is a closed predecessor). If a newer attempt is
 *     already in flight, only the old owner is dropped and the slot stays for the newer connection.
 *   - `renew` extends only a lease the caller owns (or promotes its own attempt). It does NOT create one, so a renewal that
 *     arrives after a release or a takeover finds nothing and changes nothing. `create` exists for the one legitimate case of
 *     a live socket whose lease lapsed (a charger silent for longer than the lease); it never takes a slot held by another
 *     token, and it is subject to the cap.
 *
 * Finite expiry when a cross-object call is lost: an unconfirmed attempt lapses after ATTEMPT_MS; a confirmed lease lapses
 * PENDING_LEASE_MS after its last renewal. A healthy refusal or close gives the slot back at once. Stated limits: a socket
 * that outlives its lease by staying silent is not counted until it next renews; a `create` renewal that overtakes the same
 * connection's own close can recreate that one lease for at most PENDING_LEASE_MS.
 *
 * Bookkeeping is a Map (ids such as "constructor" or "toString" are legal) with at most MAX_PENDING_SOCKETS_PER_CPO entries,
 * each with at most one owner and one attempt. One storage key, written only when the set changes. No alarm, no timer.
 */
import type { DurableObjectState } from "@cloudflare/workers-types";
import { MAX_PENDING_SOCKETS_PER_CPO, PENDING_FIRST_BOOT_DEADLINE_MS, PENDING_LEASE_MS } from "@engine/pending";

const LEASES_KEY = "gate:leases";
const CP_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,47}$/;
const TOKEN = /^[A-Za-z0-9-]{1,64}$/;
/** How long an upgrade may stay unconfirmed: the pending object closes a socket that has not booted by then. */
export const ATTEMPT_MS = PENDING_FIRST_BOOT_DEADLINE_MS;

/** A token the gate accepts (a UUID is 36 characters). */
export const isOwnerToken = (v: unknown): v is string => typeof v === "string" && TOKEN.test(v);

/** `u`: lease valid until (ms). `o`: owner token. `a`/`p`: token of the upgrade in flight and the time its claim lapses. */
type Lease = { u: number; o?: string; a?: string; p?: number };

function readLease(raw: unknown): Lease | null {
  // An earlier version stored the bare expiry number.
  if (typeof raw === "number") return { u: raw };
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.u !== "number") return null;
  const lease: Lease = { u: r.u };
  if (typeof r.o === "string") lease.o = r.o;
  if (typeof r.a === "string" && typeof r.p === "number") {
    lease.a = r.a;
    lease.p = r.p;
  }
  return lease;
}

const attemptLive = (l: Lease, nowMs: number) => l.a !== undefined && (l.p ?? 0) > nowMs;

export class PendingGate {
  constructor(
    private readonly state: DurableObjectState,
    private readonly now: () => number = Date.now,
  ) {}

  private async load(nowMs: number): Promise<{ leases: Map<string, Lease>; pruned: boolean }> {
    const stored = (await this.state.storage.get<Record<string, unknown>>(LEASES_KEY)) ?? {};
    const leases = new Map<string, Lease>();
    let pruned = false;
    // Object.entries lists own enumerable keys only, so an inherited name can never appear here.
    for (const [id, raw] of Object.entries(stored)) {
      const lease = readLease(raw);
      if (lease !== null && lease.u > nowMs) leases.set(id, lease);
      else pruned = true;
    }
    return { leases, pruned };
  }

  private async save(leases: Map<string, Lease>): Promise<void> {
    await this.state.storage.put(LEASES_KEY, Object.fromEntries(leases));
  }

  /**
   * The entry Worker's claim for one upgrade. True when the slot is held for this attempt; false when the CPO is at its cap or
   * another upgrade of the same id is still in flight. An existing confirmed owner keeps its slot until a newer connection
   * confirms, so a refused upgrade cannot cost the live socket anything.
   */
  async acquire(chargePointId: string, attempt: string): Promise<boolean> {
    if (!CP_ID.test(chargePointId) || !isOwnerToken(attempt)) return false;
    const nowMs = this.now();
    const { leases, pruned } = await this.load(nowMs);
    const held = leases.get(chargePointId);
    const until = nowMs + ATTEMPT_MS;
    if (held === undefined) {
      if (leases.size >= MAX_PENDING_SOCKETS_PER_CPO) {
        if (pruned) await this.save(leases);
        return false;
      }
      leases.set(chargePointId, { u: until, a: attempt, p: until });
    } else {
      if (attemptLive(held, nowMs) && held.a !== attempt) {
        if (pruned) await this.save(leases);
        return false;
      }
      leases.set(chargePointId, { ...held, a: attempt, p: until });
    }
    await this.save(leases);
    return true;
  }

  /**
   * The pending object keeps its own slot. True when `owner` holds the lease afterwards.
   * Without `create` this only extends a lease the caller owns or promotes the caller's own attempt; a lease that was released,
   * lapsed or passed to another token is NOT recreated or taken (false), so a late renewal is harmless.
   */
  async renew(chargePointId: string, owner: string, create: boolean): Promise<boolean> {
    if (!CP_ID.test(chargePointId) || !isOwnerToken(owner)) return false;
    const nowMs = this.now();
    const { leases, pruned } = await this.load(nowMs);
    const held = leases.get(chargePointId);
    const until = nowMs + PENDING_LEASE_MS;
    if (held === undefined) {
      if (!create || leases.size >= MAX_PENDING_SOCKETS_PER_CPO) {
        if (pruned) await this.save(leases);
        return false;
      }
      leases.set(chargePointId, { u: until, o: owner });
    } else if (held.o === owner || held.a === owner) {
      // Confirmed (or promoted): the caller is the owner. A DIFFERENT attempt still in flight is left alone.
      const challenger = held.a !== undefined && held.a !== owner && attemptLive(held, nowMs);
      leases.set(chargePointId, challenger ? { u: until, o: owner, a: held.a, p: held.p } : { u: until, o: owner });
    } else {
      if (pruned) await this.save(leases);
      return false;
    }
    await this.save(leases);
    return true;
  }

  /**
   * An upgrade that was refused or failed gives back what its own acquire took, and nothing more. An attempt that was already
   * confirmed (a socket exists) or that was superseded is not touched.
   */
  async releaseAttempt(chargePointId: string, attempt: string): Promise<void> {
    const { leases, pruned } = await this.load(this.now());
    const held = leases.get(chargePointId);
    if (held !== undefined && isOwnerToken(attempt) && held.a === attempt) {
      if (held.o !== undefined) leases.set(chargePointId, { u: held.u, o: held.o });
      else leases.delete(chargePointId);
      await this.save(leases);
    } else if (pruned) {
      await this.save(leases);
    }
  }

  /**
   * The pending object's last socket for this id is gone. Applies only to the caller's own token (see the header).
   */
  async releaseOwner(chargePointId: string, owner: string): Promise<void> {
    const nowMs = this.now();
    const { leases, pruned } = await this.load(nowMs);
    const held = leases.get(chargePointId);
    if (held !== undefined && isOwnerToken(owner) && held.o === owner) {
      // A newer attempt already waits for this id: keep the slot for it for as long as that claim lasts.
      if (attemptLive(held, nowMs)) leases.set(chargePointId, { u: held.p!, a: held.a, p: held.p });
      else leases.delete(chargePointId);
      await this.save(leases);
    } else if (held !== undefined && isOwnerToken(owner) && held.a === owner) {
      // The caller's connection never confirmed; any earlier owner is a predecessor it replaced.
      leases.delete(chargePointId);
      await this.save(leases);
    } else if (pruned) {
      await this.save(leases);
    }
  }

  async size(): Promise<number> {
    return (await this.load(this.now())).leases.size;
  }
}
