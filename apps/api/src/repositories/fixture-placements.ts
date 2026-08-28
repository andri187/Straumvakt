// An in-memory `PlacementsPort`.
//
// Not a mock. It runs the same decision sequence the Drizzle adapter runs, in
// the same order — validate, look up the receipt, classify the conflict, then
// write — through the same `checkAttach` and `classifyAttachConflict`. Only
// storage is an array.
//
// It also models the two things a naive fixture would smooth over:
//
//   1 · the TEMPORAL CONSTRAINT, applied on write rather than trusted from the
//       pre-check, so a test can prove the write-time refusal exists
//       independently of the readable one;
//   2 · `mutation_receipts`, so a replay is a stored fact rather than a
//       coincidence of the same inputs producing the same output.

import {
  attachPeriod,
  checkAttach,
  classifyAttachConflict,
  detachPeriod,
  type AttachInput,
  type AttachOutcome,
  type DetachInput,
  type DetachOutcome,
  type PlacementAccess,
  type PlacementRecord,
  type PlacementsPort,
} from "./placements-port";
import { checkTemporalKey } from "@straumvakt/shared/domain/effective-dating";

export interface FixturePlacementState {
  rows: PlacementRecord[];
  /** (org, scope, key) -> the outcome first recorded under it. */
  receipts: Map<string, unknown>;
  /** Every write that reached storage. A replay must not appear here. */
  writes: string[];
  /** Devices that exist. Attaching to an unknown device is a refusal. */
  devices: Set<string>;
}

const receiptKey = (orgId: string, scope: string, key: string) => `${orgId}:${scope}:${key}`;

let seq = 0;
const nextId = (prefix: string) => `${prefix}-${String(++seq).padStart(4, "0")}`;

export function makeFixturePlacements(
  access: PlacementAccess = { restrictToOrgIds: null },
  seedDevices: string[] = [],
): { port: PlacementsPort; state: FixturePlacementState } {
  const state: FixturePlacementState = {
    rows: [],
    receipts: new Map(),
    writes: [],
    devices: new Set(seedDevices),
  };

  const forDevice = (deviceId: string) =>
    state.rows
      .filter((r) => r.deviceId === deviceId)
      .sort((a, b) => a.period.from.getTime() - b.period.from.getTime());

  const openFor = (deviceId: string) => forDevice(deviceId).find((r) => r.period.until === null) ?? null;

  /**
   * The constraint, applied at write time.
   *
   * Deliberately NOT "trust the pre-check": the whole argument for the
   * temporal key is that it holds against writes the pre-check never saw, and
   * a fixture that only checked once could not demonstrate that.
   */
  function assertNoOverlap(row: PlacementRecord): void {
    const verdict = checkTemporalKey(
      state.rows,
      row,
      (r) => r.deviceId === row.deviceId,
    );
    if (!verdict.ok) {
      const err = new Error("conflicting key value violates exclusion constraint");
      (err as { code?: string }).code = "23P01";
      throw err;
    }
  }

  const port: PlacementsPort = {
    async attachDevice(input: AttachInput): Promise<AttachOutcome> {
      const check = checkAttach(input, access);
      if (!check.ok) return { kind: "refused", reason: check.reason };

      const rk = receiptKey(input.orgId, "placement.attach", input.idempotencyKey);
      const prior = state.receipts.get(rk);
      if (prior) return { kind: "replayed", placement: prior as PlacementRecord };

      if (!state.devices.has(input.deviceId)) {
        // A placement points at a device. Creating one for an unknown device
        // would make the device row optional, which is the conflation ADR 0054
        // exists to undo.
        return { kind: "refused", reason: "attach_before_device_exists" };
      }

      const open = openFor(input.deviceId);
      if (open && open.installationId === input.installationId && open.orgId === input.orgId) {
        // IDEMPOTENT. A retried operator script must not open a second
        // placement, and must not fail in a way that hides a real conflict.
        return { kind: "already_placed", placement: open };
      }

      const candidate = {
        deviceId: input.deviceId,
        installationId: input.installationId,
        period: attachPeriod(input.at),
      };
      const conflict = classifyAttachConflict(forDevice(input.deviceId), candidate);
      if (conflict.kind === "conflict") {
        return {
          kind: "refused",
          reason: conflict.reason,
          conflictsWith: conflict.conflictsWith,
        };
      }

      const row: PlacementRecord = {
        id: nextId("placement"),
        publicId: nextId("evse-uid"),
        deviceId: input.deviceId,
        orgId: input.orgId,
        installationId: input.installationId,
        siteId: input.siteId ?? null,
        circuitId: input.circuitId ?? null,
        period: candidate.period,
        detachReason: null,
      };
      assertNoOverlap(row);
      state.rows.push(row);
      state.writes.push(`attach:${row.id}`);
      state.receipts.set(rk, row);
      return { kind: "attached", placement: row };
    },

    async detachDevice(input: DetachInput): Promise<DetachOutcome> {
      if (typeof input.idempotencyKey !== "string" || input.idempotencyKey.trim() === "") {
        return { kind: "refused", reason: "idempotency_key_required" };
      }
      if (access.restrictToOrgIds !== null && !access.restrictToOrgIds.includes(input.orgId)) {
        return { kind: "refused", reason: "org_not_in_scope" };
      }

      const rk = receiptKey(input.orgId, "placement.detach", input.idempotencyKey);
      const prior = state.receipts.get(rk);
      if (prior) return { kind: "replayed", placement: prior as PlacementRecord };

      const open = openFor(input.deviceId);
      // Not an error. "Never attached" and "already detached" are both "the
      // device is not placed" — the state the caller asked for — and turning
      // that into a failure makes a retried teardown script noisy for no fact.
      if (!open || open.orgId !== input.orgId) return { kind: "not_placed" };

      if (input.at.getTime() <= open.period.from.getTime()) {
        // Closing at or before the start makes the range EMPTY, which the
        // CHECK constraint refuses — and an empty placement is a claim the
        // device was never there, which is not what a detach means.
        return { kind: "refused", reason: "detach_at_or_before_attach", placement: open };
      }

      open.period = detachPeriod(open.period.from, input.at);
      open.detachReason = input.reason;
      state.writes.push(`detach:${open.id}`);
      state.receipts.set(rk, open);
      // ITEM 13 — the row is CLOSED, not deleted. OCPI wants `status: REMOVED`
      // rather than removal, and a deleted row takes the session history's
      // context with it.
      return { kind: "detached", placement: open };
    },

    async moveDevice(input) {
      if (typeof input.idempotencyKey !== "string" || input.idempotencyKey.trim() === "") {
        return { kind: "refused", reason: "idempotency_key_required" };
      }
      for (const org of [input.fromOrgId, input.toOrgId]) {
        if (access.restrictToOrgIds !== null && !access.restrictToOrgIds.includes(org)) {
          return { kind: "refused", reason: "org_not_in_scope" };
        }
      }

      const rk = receiptKey(input.fromOrgId, "placement.move", input.idempotencyKey);
      const prior = state.receipts.get(rk) as { closed: PlacementRecord; opened: PlacementRecord } | undefined;
      if (prior) return { kind: "replayed", closed: prior.closed, opened: prior.opened };

      const open = openFor(input.deviceId);
      if (!open) return { kind: "refused", reason: "device_not_placed" };
      if (open.orgId !== input.fromOrgId) return { kind: "refused", reason: "device_placed_under_another_org" };
      if (input.at.getTime() <= open.period.from.getTime()) {
        return { kind: "refused", reason: "move_at_or_before_attach", conflictsWith: open };
      }

      // ── ATOMIC ────────────────────────────────────────────────────────
      //
      // The close and the open happen together. Two separate calls can be
      // interrupted between them, and the state in between — a device placed
      // nowhere — is one a billing run can observe: the period would show a
      // gap and the new host would be under-billed for it.
      //
      // The two intervals TOUCH and do not overlap: `[x, at)` and `[at, )`.
      // That is the whole reason the interval is half-open, and it is what
      // lets the temporal constraint accept a move at all. Under a closed
      // upper bound the same move would be a constraint violation.
      const snapshot = state.rows.map((r) => ({ ...r, period: { ...r.period } }));
      try {
        open.period = detachPeriod(open.period.from, input.at);
        open.detachReason = input.reason;

        const opened: PlacementRecord = {
          id: nextId("placement"),
          publicId: nextId("evse-uid"),
          deviceId: input.deviceId,
          orgId: input.toOrgId,
          installationId: input.toInstallationId,
          siteId: input.toSiteId ?? null,
          circuitId: input.toCircuitId ?? null,
          period: attachPeriod(input.at),
          detachReason: null,
        };
        assertNoOverlap(opened);
        state.rows.push(opened);
        state.writes.push(`move:${open.id}->${opened.id}`);
        state.receipts.set(rk, { closed: open, opened });
        return { kind: "moved", closed: open, opened };
      } catch (err) {
        // Roll back, so a refused move leaves the old placement OPEN rather
        // than closed with nothing opened. A partial move is the one outcome
        // worse than a refused one: the device would be placed nowhere and
        // nobody would be billed.
        state.rows.length = 0;
        state.rows.push(...snapshot);
        return { kind: "refused", reason: (err as Error).message };
      }
    },

    async historyFor(deviceId) {
      // Open AND closed, oldest first. Item 13: the history is the point — a
      // deleted row takes the record of the stay with it.
      return forDevice(deviceId).map((r) => ({ ...r, period: { ...r.period } }));
    },
  };

  return { port, state };
}
