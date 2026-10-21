// The attach/detach port — ADR 0054 items 10 and 13.
//
// ── WHAT THE CONSTRAINT DOES, AND WHAT THIS DOES ──────────────────────────
//
// The temporal key on `assets.placements` is the enforcement:
//
//     EXCLUDE USING GIST (device_id WITH =, period WITH &&)
//
// **A move that skips the detach fails at write time**, in the database, on a
// write made by anything at all — this code, a script, psql, a service written
// next year. That is item 10's requirement and it is not satisfiable by an
// application check, because an application check is only as good as the set
// of applications that run it.
//
// What this port adds is a REFUSAL A CALLER CAN READ. Surfacing SQLSTATE
// 23P01 to an operator who attached a device to the wrong site tells them
// nothing; `device_already_placed_elsewhere` with the conflicting placement
// named tells them what to do. The pre-check loses every race and that is
// fine: the constraint has the last word, and both paths refuse for the same
// reason under the same name.
//
// ── THE SQLSTATE FORK, HANDLED ONCE ───────────────────────────────────────
//
// Migration 0005 ships two constraint forms. Form A (EXCLUDE) raises 23P01;
// Form B (UNIQUE ... WITHOUT OVERLAPS, PG 18+) raises 23505. `isOverlapError`
// below treats both identically, so switching forms is a migration and not a
// code change. This is the "closed in code" the migration's banner refers to.

import {
  checkTemporalKey,
  closed,
  openEnded,
  type DatedRow,
  type Tstzrange,
} from "@straumvakt/shared/domain/effective-dating";

/** A placement row, as both adapters see it. */
export interface PlacementRecord extends DatedRow {
  publicId: string;
  deviceId: string;
  orgId: string;
  installationId: string;
  siteId: string | null;
  circuitId: string | null;
  period: Tstzrange;
  detachReason: string | null;
}

/** Tenancy, FOCUS rule 5. `null` is platform scope. */
export interface PlacementAccess {
  restrictToOrgIds: string[] | null;
}

export interface AttachInput {
  deviceId: string;
  orgId: string;
  installationId: string;
  siteId?: string | null;
  circuitId?: string | null;
  /** When the placement begins. Explicit, never `now()` inside the repository:
   *  an atomic move needs detach and attach at the SAME instant, and a clock
   *  read in two places cannot guarantee that. */
  at: Date;
  actorUserId: string | null;
  /** A missing key is a REFUSAL, never a generated one. Round 1's rule:
   *  `?? crypto.randomUUID()` is an idempotency mechanism that guarantees the
   *  duplicate it was added to prevent. */
  idempotencyKey: string;
}

export interface DetachInput {
  deviceId: string;
  orgId: string;
  at: Date;
  reason: string | null;
  actorUserId: string | null;
  idempotencyKey: string;
}

export type AttachOutcome =
  /** A new placement was opened. */
  | { kind: "attached"; placement: PlacementRecord }
  /**
   * The device was ALREADY open at this installation. Idempotent: the existing
   * placement is returned rather than a duplicate, and rather than an error
   * that would hide a real one. Attaching twice is what a retried operator
   * script does, and it must not be a failure.
   */
  | { kind: "already_placed"; placement: PlacementRecord }
  /** A replay of the same idempotency key. */
  | { kind: "replayed"; placement: PlacementRecord }
  | {
      kind: "refused";
      reason:
        /** Open elsewhere. NOT an implicit move — see the note on moves. */
        | "device_already_placed_elsewhere"
        /** Would overlap a CLOSED placement. The historical version of the
         *  same error, and the one a partial unique index would have let
         *  through. */
        | "period_overlaps_existing_placement"
        | "idempotency_key_required"
        | "org_not_in_scope"
        | "attach_before_device_exists"
        | "period_is_empty";
      /** The placement in the way, when there is one. Named so the operator
       *  can act rather than guess. */
      conflictsWith?: PlacementRecord;
    };

export type DetachOutcome =
  | { kind: "detached"; placement: PlacementRecord }
  /** Nothing was open. NOT an error: a detach of a device that was never
   *  attached, and a second detach of one already closed, are both "the device
   *  is not placed", which is the state the caller asked for. */
  | { kind: "not_placed" }
  | { kind: "replayed"; placement: PlacementRecord }
  | {
      kind: "refused";
      reason:
        | "idempotency_key_required"
        | "org_not_in_scope"
        /** `at` is at or before the placement's start. Closing there would
         *  make the range empty, which the CHECK constraint refuses — and an
         *  empty placement is a claim that the device was never there. */
        | "detach_at_or_before_attach";
      placement?: PlacementRecord;
    };

export interface PlacementsPort {
  attachDevice(input: AttachInput): Promise<AttachOutcome>;
  detachDevice(input: DetachInput): Promise<DetachOutcome>;
  /**
   * An atomic move: close at `at` and open at `at`, in ONE transaction.
   *
   * Not `detach` followed by `attach` from the caller, and the difference is
   * not stylistic. Two calls can be interrupted between them, and the state in
   * between — a device placed nowhere — is one a billing run can observe. In
   * one transaction it never exists.
   *
   * The two intervals touch and do not overlap: `[x, at)` and `[at, )`. That
   * is why the interval is half-open, and it is what lets the temporal
   * constraint accept a move at all.
   */
  moveDevice(input: {
    deviceId: string;
    fromOrgId: string;
    toOrgId: string;
    toInstallationId: string;
    toSiteId?: string | null;
    toCircuitId?: string | null;
    at: Date;
    reason: string | null;
    actorUserId: string | null;
    idempotencyKey: string;
  }): Promise<
    | { kind: "moved"; closed: PlacementRecord; opened: PlacementRecord }
    | { kind: "replayed"; closed: PlacementRecord; opened: PlacementRecord }
    | { kind: "refused"; reason: string; conflictsWith?: PlacementRecord }
  >;
  /** Every placement for a device, open and closed, oldest first. */
  historyFor(deviceId: string): Promise<PlacementRecord[]>;
}

// ── The decisions both adapters share ─────────────────────────────────────

export type AttachCheck =
  | { ok: true }
  | { ok: false; reason: "idempotency_key_required" | "org_not_in_scope" | "period_is_empty" };

/** Refusals that must not reach storage, checked identically in both adapters. */
export function checkAttach(input: AttachInput, access: PlacementAccess): AttachCheck {
  if (typeof input.idempotencyKey !== "string" || input.idempotencyKey.trim() === "") {
    return { ok: false, reason: "idempotency_key_required" };
  }
  if (access.restrictToOrgIds !== null && !access.restrictToOrgIds.includes(input.orgId)) {
    return { ok: false, reason: "org_not_in_scope" };
  }
  if (!(input.at instanceof Date) || Number.isNaN(input.at.getTime())) {
    return { ok: false, reason: "period_is_empty" };
  }
  return { ok: true };
}

/**
 * Would this attach be accepted by the temporal constraint?
 *
 * The same predicate the database enforces, run early so the refusal has a
 * name. `existing` is every placement for the device, open and closed —
 * **closed rows included, which is the entire difference from a partial unique
 * index on `WHERE until IS NULL`.** A backfilled closed row overlapping the
 * proposed period is refused here for the same reason the constraint refuses
 * it, and a partial index would have permitted both.
 */
export function classifyAttachConflict(
  existing: readonly PlacementRecord[],
  candidate: { deviceId: string; installationId: string; period: Tstzrange },
): { kind: "ok" } | { kind: "conflict"; reason: "device_already_placed_elsewhere" | "period_overlaps_existing_placement"; conflictsWith: PlacementRecord } {
  const result = checkTemporalKey(
    existing,
    { id: "__candidate__", period: candidate.period },
    (r) => r.deviceId === candidate.deviceId,
  );
  if (result.ok) return { kind: "ok" };
  const conflict = result.conflictsWith;
  // Two names for one constraint violation, because the operator's next move
  // differs. An OPEN placement elsewhere means "detach it first, or use
  // moveDevice"; a CLOSED one overlapping means the history is wrong and
  // needs correcting, which is a different conversation.
  return {
    kind: "conflict",
    reason:
      conflict.period.until === null
        ? "device_already_placed_elsewhere"
        : "period_overlaps_existing_placement",
    conflictsWith: conflict,
  };
}

/**
 * Is this database error the temporal constraint firing?
 *
 * BOTH SQLSTATEs, treated identically. Migration 0005 ships Form A (EXCLUDE,
 * `23P01`) active and Form B (`UNIQUE ... WITHOUT OVERLAPS`, `23505`, PG 18+)
 * commented. Handling only one would make switching forms a code change
 * instead of a migration — and the failure would be silent, because the
 * unhandled error would surface as a 500 rather than as a named refusal.
 */
export function isOverlapError(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return code === "23P01" || code === "23505";
}

/** `[at, )` — an open placement. Exported so both adapters build it one way. */
export function attachPeriod(at: Date): Tstzrange {
  return openEnded(at);
}

/** `[from, at)` — a closed one. */
export function detachPeriod(from: Date, at: Date): Tstzrange {
  return closed(from, at);
}
