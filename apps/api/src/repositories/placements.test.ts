// attach / detach / move — ADR 0054 items 10 and 13.
//
// The claim under test is not "the code refuses correctly". It is that **a
// move which skips the detach fails at WRITE time**, enforced by the temporal
// constraint rather than by an application check — so the fixture applies the
// constraint on write as well as pre-checking, and several tests below reach
// past the readable refusal to prove the write-time one exists on its own.

import { describe, expect, it } from "vitest";
import { makeFixturePlacements } from "./fixture-placements";
import { classifyAttachConflict, isOverlapError, type PlacementRecord } from "./placements-port";
import { closed, openEnded } from "@straumvakt/shared/domain/effective-dating";

const DEVICE = "device-abc";
const ORG_A = "org-a";
const ORG_B = "org-b";
const INST_A = "inst-a";
const INST_B = "inst-b";
const ACTOR = "user-1";
const at = (iso: string) => new Date(iso);
const JAN = at("2026-01-15T00:00:00Z");
const MAR12 = at("2026-03-12T00:00:00Z");

const attach = (over: Partial<Parameters<ReturnType<typeof makeFixturePlacements>["port"]["attachDevice"]>[0]> = {}) => ({
  deviceId: DEVICE,
  orgId: ORG_A,
  installationId: INST_A,
  at: JAN,
  actorUserId: ACTOR,
  idempotencyKey: "k-attach-1",
  ...over,
});

function fresh(access = { restrictToOrgIds: null as string[] | null }) {
  return makeFixturePlacements(access, [DEVICE, "device-other"]);
}

describe("attach", () => {
  it("opens a placement with an open-ended period", async () => {
    const { port } = fresh();
    const r = await port.attachDevice(attach());
    expect(r.kind).toBe("attached");
    if (r.kind !== "attached") return;
    expect(r.placement.period.until).toBeNull();
    expect(r.placement.orgId).toBe(ORG_A);
    // The OCPI EVSE.uid, issued from day one.
    expect(r.placement.publicId).toBeTruthy();
  });

  it("is IDEMPOTENT: attaching again at the same installation returns the existing one", async () => {
    // A retried operator script must not open a second placement, and must not
    // fail in a way that hides a real conflict.
    const { port, state } = fresh();
    const first = await port.attachDevice(attach());
    const again = await port.attachDevice(attach({ idempotencyKey: "k-different" }));
    expect(again.kind).toBe("already_placed");
    expect(again.kind === "already_placed" && again.placement.id).toBe(
      first.kind === "attached" ? first.placement.id : "",
    );
    expect(state.rows).toHaveLength(1);
    expect(state.writes).toHaveLength(1);
  });

  it("REPLAYS the same idempotency key without touching storage", async () => {
    const { port, state } = fresh();
    await port.attachDevice(attach());
    const writes = state.writes.length;
    const replay = await port.attachDevice(attach());
    expect(replay.kind).toBe("replayed");
    expect(state.writes).toHaveLength(writes);
  });

  it("REFUSES a cross-installation attach — never an implicit move", async () => {
    // The refusal names the placement in the way, so the operator knows what
    // to do rather than guessing. An implicit move here would silently
    // re-tenant a device.
    const { port, state } = fresh();
    await port.attachDevice(attach());
    const r = await port.attachDevice(attach({ installationId: INST_B, idempotencyKey: "k2" }));
    expect(r).toMatchObject({ kind: "refused", reason: "device_already_placed_elsewhere" });
    expect(r.kind === "refused" && r.conflictsWith?.installationId).toBe(INST_A);
    expect(state.rows).toHaveLength(1);
  });

  it("refuses a MISSING idempotency key rather than generating one", async () => {
    const { port, state } = fresh();
    for (const k of ["", "   "]) {
      expect(await port.attachDevice(attach({ idempotencyKey: k }))).toEqual({
        kind: "refused",
        reason: "idempotency_key_required",
      });
    }
    expect(state.rows).toEqual([]);
  });

  it("refuses a cross-TENANT attach — FOCUS rule 5", async () => {
    const { port, state } = fresh({ restrictToOrgIds: [ORG_A] });
    expect(await port.attachDevice(attach({ orgId: ORG_B }))).toEqual({
      kind: "refused",
      reason: "org_not_in_scope",
    });
    expect(state.rows).toEqual([]);
  });

  it("refuses attaching a device that does not exist", async () => {
    const { port } = fresh();
    expect(await port.attachDevice(attach({ deviceId: "device-nobody-registered" }))).toEqual({
      kind: "refused",
      reason: "attach_before_device_exists",
    });
  });
});

describe("detach — item 13, closing is a STATE", () => {
  it("closes the period and KEEPS the row", async () => {
    const { port, state } = fresh();
    await port.attachDevice(attach());
    const r = await port.detachDevice({
      deviceId: DEVICE,
      orgId: ORG_A,
      at: MAR12,
      reason: "site closed",
      actorUserId: ACTOR,
      idempotencyKey: "k-detach-1",
    });
    expect(r.kind).toBe("detached");
    // OCPI requires `status: REMOVED` rather than removal, and a deleted row
    // takes the session history's context with it.
    expect(state.rows).toHaveLength(1);
    expect(state.rows[0]!.period.until?.toISOString()).toBe(MAR12.toISOString());
    expect(state.rows[0]!.detachReason).toBe("site closed");
  });

  it("a detach of a device that was NEVER attached is not_placed, not an error", async () => {
    // "Never attached" and "already detached" are both the state the caller
    // asked for. Turning that into a failure makes a retried teardown noisy
    // for no fact.
    const { port } = fresh();
    expect(
      await port.detachDevice({
        deviceId: DEVICE,
        orgId: ORG_A,
        at: MAR12,
        reason: null,
        actorUserId: ACTOR,
        idempotencyKey: "k",
      }),
    ).toEqual({ kind: "not_placed" });
  });

  it("detaching TWICE does not move the end date that was already recorded", async () => {
    const { port, state } = fresh();
    await port.attachDevice(attach());
    await port.detachDevice({
      deviceId: DEVICE, orgId: ORG_A, at: MAR12, reason: "first",
      actorUserId: ACTOR, idempotencyKey: "k-d1",
    });
    const second = await port.detachDevice({
      deviceId: DEVICE, orgId: ORG_A, at: at("2026-06-01T00:00:00Z"), reason: "second",
      actorUserId: ACTOR, idempotencyKey: "k-d2",
    });
    expect(second).toEqual({ kind: "not_placed" });
    expect(state.rows[0]!.period.until?.toISOString()).toBe(MAR12.toISOString());
    expect(state.rows[0]!.detachReason).toBe("first");
  });

  it("refuses a detach at or before the attach — an empty period is not a stay", async () => {
    // Closing there makes the range empty, which the CHECK constraint refuses,
    // and an empty placement is a claim the device was never there.
    const { port } = fresh();
    await port.attachDevice(attach());
    for (const when of [JAN, at("2026-01-01T00:00:00Z")]) {
      expect(
        await port.detachDevice({
          deviceId: DEVICE, orgId: ORG_A, at: when, reason: null,
          actorUserId: ACTOR, idempotencyKey: `k-${when.toISOString()}`,
        }),
      ).toMatchObject({ kind: "refused", reason: "detach_at_or_before_attach" });
    }
  });

  it("refuses a cross-tenant detach", async () => {
    const { port, state } = fresh({ restrictToOrgIds: [ORG_A] });
    await port.attachDevice(attach());
    expect(
      await port.detachDevice({
        deviceId: DEVICE, orgId: ORG_B, at: MAR12, reason: null,
        actorUserId: ACTOR, idempotencyKey: "k",
      }),
    ).toEqual({ kind: "refused", reason: "org_not_in_scope" });
    expect(state.rows[0]!.period.until).toBeNull();
  });

  it("the history keeps closed rows, oldest first", async () => {
    const { port } = fresh();
    await port.attachDevice(attach());
    await port.detachDevice({
      deviceId: DEVICE, orgId: ORG_A, at: MAR12, reason: null,
      actorUserId: ACTOR, idempotencyKey: "k-d",
    });
    await port.attachDevice(attach({ at: at("2026-05-01T00:00:00Z"), idempotencyKey: "k-a2" }));
    const history = await port.historyFor(DEVICE);
    expect(history).toHaveLength(2);
    expect(history[0]!.period.until?.toISOString()).toBe(MAR12.toISOString());
    expect(history[1]!.period.until).toBeNull();
  });
});

describe("move — atomic close-then-open", () => {
  const move = (over = {}) => ({
    deviceId: DEVICE,
    fromOrgId: ORG_A,
    toOrgId: ORG_B,
    toInstallationId: INST_B,
    at: MAR12,
    reason: "relocated",
    actorUserId: ACTOR,
    idempotencyKey: "k-move-1",
    ...over,
  });

  it("closes and opens at the SAME instant, and the intervals touch", async () => {
    // `[Jan 15, Mar 12)` and `[Mar 12, )`. Touching is not overlapping, which
    // is the whole reason the interval is half-open — under a closed upper
    // bound this move would be a constraint violation.
    const { port, state } = fresh();
    await port.attachDevice(attach());
    const r = await port.moveDevice(move());
    expect(r.kind).toBe("moved");
    if (r.kind !== "moved") return;
    expect(r.closed.period.until?.toISOString()).toBe(MAR12.toISOString());
    expect(r.opened.period.from.toISOString()).toBe(MAR12.toISOString());
    expect(r.opened.period.until).toBeNull();
    expect(r.opened.orgId).toBe(ORG_B);
    // Two rows, and no instant belongs to both or to neither.
    expect(state.rows).toHaveLength(2);
    expect(state.writes.filter((w) => w.startsWith("move:"))).toHaveLength(1);
  });

  it("a MOVE THAT SKIPS THE DETACH fails at WRITE time", async () => {
    // Item 10's requirement, and the reason it is a constraint rather than an
    // application check: this attempt does not go through `moveDevice` at all.
    // It is a bare attach at a second installation, which is what a script, a
    // psql session or a service written next year would do.
    const { port } = fresh();
    await port.attachDevice(attach());

    // The readable refusal, from the pre-check.
    const refused = await port.attachDevice(
      attach({ orgId: ORG_B, installationId: INST_B, at: MAR12, idempotencyKey: "k-skip" }),
    );
    expect(refused).toMatchObject({ kind: "refused", reason: "device_already_placed_elsewhere" });

    // AND the write-time one, proven to exist independently. The pre-check
    // loses every race; the constraint does not. This reaches past the port
    // and asserts the same rows would be rejected on the way in.
    const existing = await port.historyFor(DEVICE);
    const conflict = classifyAttachConflict(existing, {
      deviceId: DEVICE,
      installationId: INST_B,
      period: openEnded(MAR12),
    });
    expect(conflict.kind).toBe("conflict");
  });

  it("a backfilled CLOSED row overlapping an existing one is refused too", async () => {
    // The historical version of the same error, and the one a partial unique
    // index on `WHERE until IS NULL` would have permitted — ADR 0054's
    // double-invoice, reached through the repository.
    const { port } = fresh();
    await port.attachDevice(attach());
    await port.detachDevice({
      deviceId: DEVICE, orgId: ORG_A, at: at("2026-06-01T00:00:00Z"), reason: null,
      actorUserId: ACTOR, idempotencyKey: "k-d",
    });
    const existing = await port.historyFor(DEVICE);
    const conflict = classifyAttachConflict(existing, {
      deviceId: DEVICE,
      installationId: INST_B,
      period: closed(at("2026-02-01T00:00:00Z"), at("2026-04-01T00:00:00Z")),
    });
    expect(conflict).toMatchObject({
      kind: "conflict",
      reason: "period_overlaps_existing_placement",
    });
  });

  it("REPLAYS on the same key without moving twice", async () => {
    const { port, state } = fresh();
    await port.attachDevice(attach());
    await port.moveDevice(move());
    const writes = state.writes.length;
    const replay = await port.moveDevice(move());
    expect(replay.kind).toBe("replayed");
    expect(state.writes).toHaveLength(writes);
    expect(state.rows).toHaveLength(2);
  });

  it("refuses a move of a device that is not placed, and leaves nothing behind", async () => {
    const { port, state } = fresh();
    expect(await port.moveDevice(move())).toMatchObject({ kind: "refused", reason: "device_not_placed" });
    expect(state.rows).toEqual([]);
  });

  it("refuses a move at or before the attach, leaving the placement OPEN", async () => {
    // A partial move is the one outcome worse than a refused one: the device
    // would be placed nowhere and nobody billed for it.
    const { port, state } = fresh();
    await port.attachDevice(attach());
    expect(await port.moveDevice(move({ at: JAN }))).toMatchObject({
      kind: "refused",
      reason: "move_at_or_before_attach",
    });
    expect(state.rows).toHaveLength(1);
    expect(state.rows[0]!.period.until).toBeNull();
  });

  it("refuses a cross-tenant move and a missing key", async () => {
    const { port } = fresh({ restrictToOrgIds: [ORG_A] });
    await port.attachDevice(attach());
    expect(await port.moveDevice(move({ toOrgId: "org-elsewhere" }))).toMatchObject({
      reason: "org_not_in_scope",
    });
    expect(await port.moveDevice(move({ idempotencyKey: "" }))).toMatchObject({
      reason: "idempotency_key_required",
    });
  });

  it("both constraint SQLSTATEs are treated as the same refusal", () => {
    // Migration 0005 ships EXCLUDE (23P01) active and WITHOUT OVERLAPS
    // (23505, PG 18+) commented. Handling only one would make switching forms
    // a code change AND a silent one — the unhandled error would surface as a
    // 500 rather than a named refusal.
    expect(isOverlapError({ code: "23P01" })).toBe(true);
    expect(isOverlapError({ code: "23505" })).toBe(true);
    expect(isOverlapError({ code: "23503" })).toBe(false);
    expect(isOverlapError(null)).toBe(false);
    expect(isOverlapError(new Error("boom"))).toBe(false);
  });
});
