// The per-CPO admission gate for pending sockets. LOCAL FIXTURES ONLY (an in-memory stand-in for Durable Object storage).
import { describe, expect, it } from "vitest";
import { ATTEMPT_MS, PendingGate } from "./pending-gate";
import { MAX_PENDING_SOCKETS_PER_CPO, PENDING_LEASE_MS } from "@engine/pending";

function makeGate(clock = { t: 1_000_000 }) {
  const values = new Map<string, unknown>();
  const state = {
    storage: {
      get: async (k: string) => (values.has(k) ? structuredClone(values.get(k)) : undefined),
      put: async (k: string, v: unknown) => {
        values.set(k, structuredClone(v));
      },
    },
  };
  return { gate: new PendingGate(state as never, () => clock.t), clock, values };
}
/** A connection the way production makes one: the entry Worker claims, the pending object confirms with its first boot. */
async function connectOwned(gate: PendingGate, id: string, token: string) {
  expect(await gate.acquire(id, token)).toBe(true);
  expect(await gate.renew(id, token, false)).toBe(true);
}

describe("pending gate: cap and lapse", () => {
  it("grants up to the cap, refuses the next identity, and keeps a held identity", async () => {
    const { gate } = makeGate();
    for (let i = 0; i < MAX_PENDING_SOCKETS_PER_CPO; i++) await connectOwned(gate, `CP-${i}`, `tok-${i}`);
    expect(await gate.acquire("CP-NEW", "tok-new")).toBe(false);
    expect(await gate.renew("CP-0", "tok-0", false)).toBe(true);
    expect(await gate.size()).toBe(MAX_PENDING_SOCKETS_PER_CPO);
  });
  it("a release gives the slot back; a lapsed lease stops counting", async () => {
    const { gate, clock } = makeGate();
    for (let i = 0; i < MAX_PENDING_SOCKETS_PER_CPO; i++) await connectOwned(gate, `CP-${i}`, `tok-${i}`);
    await gate.releaseOwner("CP-3", "tok-3");
    expect(await gate.acquire("CP-NEW", "tok-new")).toBe(true);
    clock.t += PENDING_LEASE_MS + 1;
    expect(await gate.size()).toBe(0);
  });
  it("an id or token outside the legal grammar is refused", async () => {
    const { gate } = makeGate();
    expect(await gate.acquire("../x", "tok")).toBe(false);
    expect(await gate.acquire("", "tok")).toBe(false);
    expect(await gate.acquire("CP-1", "")).toBe(false);
    expect(await gate.acquire("CP-1", "has space")).toBe(false);
    expect(await gate.acquire("CP-1", "x".repeat(65))).toBe(false);
    expect(await gate.renew("CP-1", "bad token", true)).toBe(false);
    expect(await gate.size()).toBe(0);
  });
});

describe("pending gate: ids named like inherited object properties", () => {
  it("REVIEW CASE: a legal charger id named 'constructor' consumes a real slot", async () => {
    const { gate } = makeGate();
    expect(await gate.acquire("constructor", "tok")).toBe(true);
    expect(await gate.size()).toBe(1);
    await gate.releaseAttempt("constructor", "tok");
    expect(await gate.size()).toBe(0);
  });
  it("REVIEW CASE: a full CPO does not admit an additional identity named 'toString'", async () => {
    const { gate } = makeGate();
    for (let i = 0; i < MAX_PENDING_SOCKETS_PER_CPO; i++) expect(await gate.acquire(`CP-${i}`, `tok-${i}`)).toBe(true);
    expect(await gate.acquire("toString", "t1")).toBe(false);
    expect(await gate.acquire("hasOwnProperty", "t2")).toBe(false);
  });
  it("such ids survive a reload from storage and are not mistaken for each other", async () => {
    const { gate, values } = makeGate();
    await connectOwned(gate, "constructor", "tok-a");
    await connectOwned(gate, "valueOf", "tok-b");
    await gate.releaseOwner("toString", "tok-c"); // never held: changes nothing
    expect(await gate.size()).toBe(2);
    // every call reloads from storage (what a restored object does), so the stored shape is what matters
    const stored = values.get("gate:leases") as Record<string, unknown>;
    expect(Object.keys(stored).sort()).toEqual(["constructor", "valueOf"]);
    await gate.releaseOwner("constructor", "tok-a");
    expect(await gate.size()).toBe(1);
  });
  it("a lease written by the earliest version (a bare expiry number) is still counted and can be renewed away", async () => {
    const { gate, values, clock } = makeGate();
    values.set("gate:leases", { "CP-OLD": clock.t + 1000 });
    expect(await gate.size()).toBe(1);
    expect(await gate.renew("CP-OLD", "tok-x", false)).toBe(false); // nobody owns it, so nobody can take it by renewing
  });
});

describe("pending gate: one unconfirmed upgrade per id", () => {
  it("an attempt that created the lease can give back exactly that lease", async () => {
    const { gate } = makeGate();
    expect(await gate.acquire("CP-1", "attempt-1")).toBe(true);
    await gate.releaseAttempt("CP-1", "attempt-1");
    expect(await gate.size()).toBe(0);
  });
  it("a token that does not match releases nothing", async () => {
    const { gate } = makeGate();
    await gate.acquire("CP-1", "attempt-1");
    await gate.releaseAttempt("CP-1", "someone-else");
    await gate.releaseOwner("CP-1", "someone-else");
    expect(await gate.size()).toBe(1);
  });
  it("REVIEW CASE: two overlapping upgrades of one id leave no empty slot (the second is refused; the first gives its claim back)", async () => {
    const { gate } = makeGate();
    expect(await gate.acquire("CP-1", "attempt-1")).toBe(true);
    expect(await gate.acquire("CP-1", "attempt-2")).toBe(false);
    await gate.releaseAttempt("CP-1", "attempt-1");
    await gate.releaseAttempt("CP-1", "attempt-2");
    expect(await gate.size()).toBe(0);
  });
  it("many failed upgrades of NEW ids cannot fill the CPO with empty leases", async () => {
    const { gate } = makeGate();
    for (let i = 0; i < MAX_PENDING_SOCKETS_PER_CPO * 3; i++) {
      expect(await gate.acquire(`CP-${i}`, `attempt-${i}`)).toBe(true);
      await gate.releaseAttempt(`CP-${i}`, `attempt-${i}`);
    }
    expect(await gate.size()).toBe(0);
  });
  it("an unreleased claim lapses with the first-boot deadline, not after the seven-hour lease", async () => {
    const { gate, clock } = makeGate();
    await gate.acquire("CP-1", "attempt-1");
    clock.t += ATTEMPT_MS - 1;
    expect(await gate.size()).toBe(1);
    expect(await gate.acquire("CP-1", "attempt-2")).toBe(false); // still in flight
    clock.t += 1;
    expect(await gate.size()).toBe(0);
    expect(await gate.acquire("CP-1", "attempt-2")).toBe(true); // the lapsed claim does not block the next upgrade
  });
});

describe("pending gate: accepted ownership is distinct from an unconfirmed claim", () => {
  it("REVIEW CASE: an upgrade that was accepted (confirmed) is not ended by the entry Worker's late failure handling", async () => {
    const { gate } = makeGate();
    await connectOwned(gate, "CP-1", "attempt-1");
    await gate.releaseAttempt("CP-1", "attempt-1"); // e.g. a forwarding error reported after the socket exists
    expect(await gate.size()).toBe(1);
    await gate.releaseOwner("CP-1", "attempt-1");
    expect(await gate.size()).toBe(0);
  });
  it("a refused newer upgrade does not cost the live connection its slot", async () => {
    const { gate } = makeGate();
    await connectOwned(gate, "CP-1", "old");
    expect(await gate.acquire("CP-1", "new")).toBe(true); // claimed while the old connection is live
    await gate.releaseAttempt("CP-1", "new"); // and refused (bad subprotocol)
    expect(await gate.size()).toBe(1);
    expect(await gate.renew("CP-1", "old", false)).toBe(true); // the old connection still owns it
  });
  it("a newer connection that confirms takes the slot over; the old one's late release is a no-op", async () => {
    const { gate } = makeGate();
    await connectOwned(gate, "CP-1", "old");
    await gate.acquire("CP-1", "new");
    expect(await gate.renew("CP-1", "new", false)).toBe(true); // promoted
    await gate.releaseOwner("CP-1", "old");
    expect(await gate.size()).toBe(1);
    await gate.releaseOwner("CP-1", "new");
    expect(await gate.size()).toBe(0);
  });
  it("REVIEW CASE: the old connection's release delivered AFTER the replacement claimed (before it confirmed) keeps the slot for it", async () => {
    const { gate } = makeGate();
    await connectOwned(gate, "CP-1", "old");
    await gate.acquire("CP-1", "new");
    await gate.releaseOwner("CP-1", "old"); // delayed close of the replaced socket
    expect(await gate.size()).toBe(1);
    expect(await gate.renew("CP-1", "new", false)).toBe(true); // the replacement still confirms
    await gate.releaseOwner("CP-1", "new");
    expect(await gate.size()).toBe(0);
  });
  it("a replacement that never boots takes the closed predecessor's slot with it", async () => {
    const { gate } = makeGate();
    await connectOwned(gate, "CP-1", "old");
    await gate.acquire("CP-1", "new"); // the pending object replaced (closed) the old socket
    await gate.releaseOwner("CP-1", "new"); // the first-boot deadline closed the replacement
    expect(await gate.size()).toBe(0);
  });
});

describe("pending gate: a stale renewal cannot recreate or steal a slot", () => {
  it("REVIEW CASE: a renewal after the lease was released finds nothing and creates nothing", async () => {
    const { gate } = makeGate();
    await connectOwned(gate, "CP-1", "tok");
    await gate.releaseOwner("CP-1", "tok");
    expect(await gate.renew("CP-1", "tok", false)).toBe(false);
    expect(await gate.size()).toBe(0);
  });
  it("REVIEW CASE: an old connection's renewal after a replacement confirmed does not take the slot back", async () => {
    const { gate } = makeGate();
    await connectOwned(gate, "CP-1", "old");
    await connectOwned(gate, "CP-1", "new");
    expect(await gate.renew("CP-1", "old", false)).toBe(false);
    expect(await gate.renew("CP-1", "old", true)).toBe(false); // not even when it asks to create
    await gate.releaseOwner("CP-1", "new");
    expect(await gate.size()).toBe(0);
  });
  it("a renewal does not extend or confirm another connection's unconfirmed claim", async () => {
    const { gate } = makeGate();
    await gate.acquire("CP-1", "new");
    expect(await gate.renew("CP-1", "someone-else", true)).toBe(false);
    await gate.releaseAttempt("CP-1", "new");
    expect(await gate.size()).toBe(0);
  });
  it("a live socket whose lease lapsed can claim a slot again (only with `create`), subject to the cap", async () => {
    const { gate, clock } = makeGate();
    await connectOwned(gate, "CP-1", "tok");
    clock.t += PENDING_LEASE_MS + 1;
    expect(await gate.renew("CP-1", "tok", false)).toBe(false);
    expect(await gate.renew("CP-1", "tok", true)).toBe(true);
    expect(await gate.size()).toBe(1);
    for (let i = 0; i < MAX_PENDING_SOCKETS_PER_CPO - 1; i++) await connectOwned(gate, `CP-F${i}`, `tok-f${i}`);
    expect(await gate.renew("CP-LATE", "tok-late", true)).toBe(false); // full
  });
  it("a renewal by the owner extends the lease past its original expiry", async () => {
    const { gate, clock } = makeGate();
    await connectOwned(gate, "CP-1", "tok");
    clock.t += PENDING_LEASE_MS - 1000;
    expect(await gate.renew("CP-1", "tok", false)).toBe(true);
    clock.t += PENDING_LEASE_MS - 1000;
    expect(await gate.size()).toBe(1); // would have lapsed without the renewal
  });
});
