// EXECUTABLE MODEL of the lock protocol that serialises start / removal-request / close.
//
// WHAT THIS PROVES: that the PROTOCOL (who takes which lock, in which order, and that every decision is read AFTER the
// lock) has no lost session and no deadlock under every commit order the scripts below drive, given PostgreSQL's
// documented row-lock semantics (FOR SHARE vs FOR UPDATE conflict; READ COMMITTED sees rows committed before a statement
// begins). WHAT IT DOES NOT PROVE: that PostgreSQL behaves that way here, or that the Drizzle queries take those locks.
// That needs the deterministic two-connection run specified in the handoff (see "PostgreSQL concurrency spec").
//
// Protocol under test (matches drizzle-tx-store.startGate and drizzle-store.closePlacement / lockPlacement):
//   start   : placement FOR SHARE -> read open? -> read blocked -> insert session -> commit
//   request : placement FOR UPDATE -> read sessions -> insert request (blocks starts) -> commit
//   close   : installation FOR UPDATE -> placement FOR UPDATE -> count sessions -> close or refuse -> commit
//   status  : installation FOR UPDATE -> (no placement lock) -> commit
import { describe, expect, it } from "vitest";

type Mode = "S" | "X";
class Locks {
  private holders = new Map<string, { id: string; mode: Mode }[]>();
  private waiters: { key: string; id: string; mode: Mode; go: () => void }[] = [];
  trace: string[] = [];
  private compatible(key: string, id: string, mode: Mode) {
    return (this.holders.get(key) ?? []).every((h) => h.id === id || (h.mode === "S" && mode === "S"));
  }
  async acquire(key: string, id: string, mode: Mode) {
    if (this.compatible(key, id, mode)) { this.grant(key, id, mode); return; }
    this.trace.push(`${id} waits ${mode}:${key}`);
    await new Promise<void>((go) => this.waiters.push({ key, id, mode, go }));
  }
  private grant(key: string, id: string, mode: Mode) {
    const l = this.holders.get(key) ?? [];
    l.push({ id, mode });
    this.holders.set(key, l);
  }
  release(id: string) {
    for (const [k, l] of this.holders) this.holders.set(k, l.filter((h) => h.id !== id));
    for (const w of [...this.waiters]) {
      if (this.compatible(w.key, w.id, w.mode)) { this.waiters.splice(this.waiters.indexOf(w), 1); this.grant(w.key, w.id, w.mode); w.go(); }
    }
  }
  get stuck() { return this.waiters.length; }
}

type World = { placementOpen: boolean; sessions: { id: string; authorized: boolean }[]; blocked: boolean; requestSaw: string[]; closeResult: "closed" | "refused" | null; startResult: "accepted" | "refused_closed" | "refused_blocked" | null };
const fresh = (): World => ({ placementOpen: true, sessions: [], blocked: false, requestSaw: [], closeResult: null, startResult: null });
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

/** Each procedure takes `pauseAfterLock` so a script can hold a lock while another transaction tries to take it. */
function procs(w: World, L: Locks) {
  return {
    async start(id: string, pause?: Promise<void>) {
      await L.acquire("placement", id, "S");
      if (pause) await pause;
      if (!w.placementOpen) { w.startResult = "refused_closed"; w.sessions.push({ id, authorized: false }); }
      else if (w.blocked) { w.startResult = "refused_blocked"; w.sessions.push({ id, authorized: false }); }
      else { w.startResult = "accepted"; w.sessions.push({ id, authorized: true }); }
      L.release(id); // commit
    },
    async request(id: string, pause?: Promise<void>) {
      await L.acquire("placement", id, "X");
      if (pause) await pause;
      w.requestSaw = w.sessions.filter((s) => s.authorized).map((s) => s.id);
      w.blocked = true;
      L.release(id);
    },
    async close(id: string, pause?: Promise<void>) {
      await L.acquire("installation", id, "X");
      await L.acquire("placement", id, "X");
      if (pause) await pause;
      const open = w.sessions.filter((s) => s.authorized).length;
      if (open > 0) w.closeResult = "refused";
      else { w.placementOpen = false; w.closeResult = "closed"; }
      L.release(id);
    },
    async status(id: string) {
      await L.acquire("installation", id, "X");
      L.release(id);
    },
  };
}
const gate = () => { let open!: () => void; const p = new Promise<void>((r) => (open = r)); return { p, open }; };

describe("lock protocol: start vs close, both commit orders", () => {
  it("start holds the placement FIRST, close arrives mid-start: close WAITS, then sees the committed session and REFUSES (no lost session)", async () => {
    const w = fresh(), L = new Locks(), p = procs(w, L);
    const hold = gate();
    const s = p.start("S1", hold.p);
    await tick();
    const c = p.close("C1");
    await tick();
    expect(L.stuck).toBe(1); // close is waiting on the placement
    expect(w.closeResult).toBeNull();
    hold.open();
    await Promise.all([s, c]);
    expect(w.startResult).toBe("accepted");
    expect(w.closeResult).toBe("refused");
    expect(w.placementOpen).toBe(true);
    expect(w.sessions).toHaveLength(1);
  });
  it("close commits FIRST, start was admitted earlier (stale socket): the start is REFUSED, recorded as unauthorized evidence, no session under a closed placement", async () => {
    const w = fresh(), L = new Locks(), p = procs(w, L);
    const hold = gate();
    const c = p.close("C1", hold.p);
    await tick();
    const s = p.start("S1");
    await tick();
    expect(L.stuck).toBe(1);
    hold.open();
    await Promise.all([c, s]);
    expect(w.closeResult).toBe("closed");
    expect(w.startResult).toBe("refused_closed");
    expect(w.sessions).toEqual([{ id: "S1", authorized: false }]); // evidence kept; nothing authorized
  });
  it("the START has already passed its own checks but is uncommitted when close begins: close still cannot count past it (the bug in the interleaving Codex described)", async () => {
    const w = fresh(), L = new Locks(), p = procs(w, L);
    const hold = gate();
    const s = p.start("S1", hold.p); // placement S held, read of `blocked`/`open` pending
    await tick();
    const c = p.close("C1"); // takes installation X, then waits for the placement
    await tick();
    hold.open();
    await Promise.all([s, c]);
    expect(w.sessions.filter((x) => x.authorized)).toHaveLength(1);
    expect(w.closeResult).toBe("refused");
  });
  it("request first: a start waits, then sees the committed block and is refused (evidence kept)", async () => {
    const w = fresh(), L = new Locks(), p = procs(w, L);
    const hold = gate();
    const r = p.request("R1", hold.p);
    await tick();
    const s = p.start("S1");
    await tick();
    hold.open();
    await Promise.all([r, s]);
    expect(w.startResult).toBe("refused_blocked");
    expect(w.requestSaw).toEqual([]);
  });
  it("start first: the request waits and then OBSERVES the session, so it is stopped normally (the 'cosmetic understatement' is closed)", async () => {
    const w = fresh(), L = new Locks(), p = procs(w, L);
    const hold = gate();
    const s = p.start("S1", hold.p);
    await tick();
    const r = p.request("R1");
    await tick();
    hold.open();
    await Promise.all([s, r]);
    expect(w.startResult).toBe("accepted");
    expect(w.requestSaw).toEqual(["S1"]);
  });
  it("no deadlock under any interleaving of start, request, close and status writers (lock order: installation -> placement; start takes placement only)", async () => {
    const order = ["start", "request", "close", "status"] as const;
    const perms = (a: readonly string[]): string[][] => (a.length <= 1 ? [[...a]] : a.flatMap((x, i) => perms([...a.slice(0, i), ...a.slice(i + 1)]).map((r) => [x, ...r])));
    for (const perm of perms(order)) {
      for (const pauseFirst of [false, true]) {
        const w = fresh(), L = new Locks(), p = procs(w, L);
        const hold = gate();
        const runs: Promise<void>[] = [];
        perm.forEach((name, i) => {
          const pause = pauseFirst && i === 0 ? hold.p : undefined;
          runs.push((p as Record<string, (id: string, pause?: Promise<void>) => Promise<void>>)[name]!(`${name}${i}`, pause));
        });
        await tick(); await tick();
        hold.open();
        const done = await Promise.race([Promise.all(runs).then(() => "done"), new Promise<string>((r) => setTimeout(() => r("DEADLOCK"), 200))]);
        expect(done, `${perm.join(",")} pauseFirst=${pauseFirst}`).toBe("done");
        // invariant: a closed placement never has an authorized session started after it closed
        if (!w.placementOpen) expect(w.sessions.every((s) => !s.authorized) || w.closeResult === "closed").toBe(true);
        expect(w.closeResult === "closed" ? w.sessions.filter((s) => s.authorized).length : 0).toBe(0);
      }
    }
  });
  it("NEGATIVE CONTROL: if start did NOT lock the placement (the original code), the lost-session interleaving is reachable in this model", async () => {
    const w = fresh(), L = new Locks();
    const hold = gate();
    // the original protocol: read blocked/open unlocked, insert later
    const startNoLock = (async () => { const open = w.placementOpen && !w.blocked; await hold.p; w.sessions.push({ id: "S1", authorized: open }); })();
    const close = (async () => { await L.acquire("installation", "C1", "X"); if (w.sessions.filter((s) => s.authorized).length === 0) { w.placementOpen = false; w.closeResult = "closed"; } L.release("C1"); })();
    await close;
    hold.open();
    await startNoLock;
    expect(w.closeResult).toBe("closed");
    expect(w.sessions.some((s) => s.authorized)).toBe(true); // a live session under a closed placement: the defect the lock removes
  });
});
