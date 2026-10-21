// The first-placement write path — fallback item 1.
//
// ADR 0054 says the re-onboard creates the first placements. It does not say
// what a CORRECT first onboarding writes, and nothing in the repository does
// either: `createCharger` writes the old shape and is marked for retirement.
// **This is the pathway a charger will be onboarded through when we get
// there, and it did not exist.**
//
// Design and port only. No vendor call, no database, no HTTP.
//
// ── WHAT IT WRITES, IN ORDER ──────────────────────────────────────────────
//
//   1  assets.devices              the hardware. Idempotent on (vendor, serial).
//   2  assets.device_identities    the credential, dated.
//   3  assets.placements           where it is, dated and TENANTED.
//   4  assets.evses                children — ONLY from a BootNotification.
//   5  assets.connectors           children of the EVSEs.
//
// ── ONE TRANSACTION, AND WHY THE HALF-STATES ARE WORSE THAN NOTHING ───────
//
// All five in one transaction. The intermediate states are not merely untidy,
// they are each a specific operational failure:
//
//   device + identity, no placement   the charger connects and authenticates,
//                                     and bills NOBODY. Free electricity with
//                                     a working audit trail.
//   device + placement, no identity   the host is billed for a charger that
//                                     cannot connect. The invoice is wrong in
//                                     the direction nobody forgives.
//   placement, no connectors          the flat fee counts connectors, so the
//                                     host is billed for zero. See below —
//                                     this one has a defect all of its own.
//
// A retry after a partial failure is worse still: the device row is idempotent
// but the identity and placement are not, so the second attempt collides with
// the first half and the operator sees a constraint error naming a row they
// never knowingly created.
//
// ── THE ORDER IS NOT ARBITRARY ────────────────────────────────────────────
//
// Device first because everything references it. **Identity SECOND, before the
// placement**, because its uniqueness is the one most likely to collide — an
// operator reusing an identity string from a unit decommissioned last month —
// and failing early costs less work than failing late. Placement third because
// it is the tenanted row and the one billing reads. Children last because they
// are the only part that may legitimately be EMPTY.

import type { Tstzrange } from "@straumvakt/shared/domain/effective-dating";

/**
 * What a `BootNotification` told us. ADR 0054 item 4.
 *
 * Absent means **absent**, and that is the whole point of this type being
 * separate from the rest of the input: the hierarchy is written from what the
 * charger reported, never from what a Zaptec Pro usually has.
 */
export interface BootNotificationFacts {
  vendor: string | null;
  model: string | null;
  serialNumber: string | null;
  chargeBoxSerialNumber: string | null;
  firmwareVersion: string | null;
  /** When the BootNotification arrived. Not import time. */
  observedAt: Date;
  /** One entry per EVSE the charger reported, each with its connectors. */
  evses: Array<{
    evseIndex: number;
    connectors: Array<{ connectorIndex: number; type: string }>;
  }>;
}

export interface OnboardDeviceInput {
  /** Tenancy. FOCUS rule 5 — on the PLACEMENT, never on the device. */
  orgId: string;
  installationId: string;
  siteId?: string | null;
  circuitId?: string | null;
  /** The OCPP identity the charger will connect with. */
  identityString: string;
  /** When the device was placed. Explicit; never a clock read inside. */
  at: Date;
  /**
   * `null` when no BootNotification has been seen yet.
   *
   * **This is the field that decides whether any EVSE or connector is
   * written**, and `null` means none are. See `refusedToInvent` below.
   */
  boot: BootNotificationFacts | null;
  /** Falls back to `boot` when present. Both may be null — an unserialised
   *  device is a device we have, not one we refuse. */
  vendor?: string | null;
  serialNumber?: string | null;
  /** The REAL warranty date, or nothing. Never install + 5 years. */
  warrantyExpires?: Date | null;
  actorUserId: string | null;
  idempotencyKey: string;
  /**
   * Proceed even though `(vendor, serial)` cannot deduplicate this device.
   *
   * Postgres treats NULLs as distinct in a unique index, so an unserialised
   * device gets a new row every time and no constraint can prevent it. The
   * caller must say it knows. Defaulting this to `true` would make a
   * double-onboarding silent, which is how one physical charger ends up with
   * two lifetime-energy counters.
   */
  acceptPossibleDuplicate?: boolean;
}

export interface OnboardedDevice {
  deviceId: string;
  deviceWasAlreadyKnown: boolean;
  identityId: string;
  placementId: string;
  /** The OCPI `EVSE.uid`. Issued here, never changed. */
  placementPublicId: string;
  evseIds: string[];
  connectorIds: string[];
  /**
   * True when no BootNotification was available, so no EVSE and no connector
   * were written. **Not an error and not a zero** — see `checkOnboard`.
   */
  refusedToInvent: boolean;
}

export type OnboardOutcome =
  | { kind: "onboarded"; result: OnboardedDevice }
  | { kind: "replayed"; result: OnboardedDevice }
  | {
      kind: "refused";
      reason:
        | "idempotency_key_required"
        | "org_not_in_scope"
        | "identity_string_required"
        | "identity_in_use_at_that_instant"
        | "device_already_placed_elsewhere"
        | "possible_duplicate_device_not_acknowledged"
        | "boot_reported_no_evses";
      detail?: string;
    };

export interface OnboardDevicePort {
  onboard(input: OnboardDeviceInput): Promise<OnboardOutcome>;
}

export type OnboardCheck =
  | { ok: true; willWriteChildren: boolean; dedupable: boolean }
  | { ok: false; reason: Extract<OnboardOutcome, { kind: "refused" }>["reason"] };

/**
 * Every refusal that can be decided before a row is written.
 *
 * ── THE ONE DECISION WORTH ARGUING ────────────────────────────────────────
 *
 * A first onboarding with **no BootNotification writes no EVSE and no
 * connector**, and reports `refusedToInvent: true`. It is not an error: a
 * charger is often registered before it first connects, and refusing to
 * onboard it would make the operator wait for hardware to phone home before
 * they can record where they put it.
 *
 * What it must never do is write one EVSE at index 1 with one `Type2`
 * connector. For a Zaptec Pro that is true, which is exactly what makes it
 * dangerous — a coincidence that reads as a model until the first DC unit.
 *
 * **AND IT HAS A CONSEQUENCE THAT HAD TO BE FIXED ELSEWHERE.** The flat fee
 * counts connectors. A placement whose device has no connectors would have
 * contributed nothing to `connectorSharesForPeriod` — a MEASURED zero for a
 * device we have simply never heard from. That is ledger note 22's exact
 * failure, reached from a direction nobody was watching, and it is why
 * `connectorSharesForPeriod` now returns
 * `unavailable: placement_without_connectors` rather than a quiet omission.
 *
 * A boot that reports ZERO EVSEs is different again, and refused: the charger
 * spoke and said it has nothing, which is either a protocol bug or a unit we
 * should not be billing for. Silence and "I have nothing" are not the same
 * claim, and this is the same distinction as `never_reported` versus
 * `Unavailable` on connector status.
 */
export function checkOnboard(
  input: OnboardDeviceInput,
  access: { restrictToOrgIds: string[] | null },
): OnboardCheck {
  if (typeof input.idempotencyKey !== "string" || input.idempotencyKey.trim() === "") {
    return { ok: false, reason: "idempotency_key_required" };
  }
  if (access.restrictToOrgIds !== null && !access.restrictToOrgIds.includes(input.orgId)) {
    return { ok: false, reason: "org_not_in_scope" };
  }
  if (typeof input.identityString !== "string" || input.identityString.trim() === "") {
    // Without it the charger cannot connect, and a placement for a charger
    // that cannot connect is a billable row for hardware nobody can use.
    return { ok: false, reason: "identity_string_required" };
  }
  if (input.boot && input.boot.evses.length === 0) {
    return { ok: false, reason: "boot_reported_no_evses" };
  }

  const vendor = input.vendor ?? input.boot?.vendor ?? null;
  const serial = input.serialNumber ?? input.boot?.serialNumber ?? null;
  const dedupable =
    typeof vendor === "string" && vendor.trim() !== "" &&
    typeof serial === "string" && serial.trim() !== "";

  if (!dedupable && input.acceptPossibleDuplicate !== true) {
    return { ok: false, reason: "possible_duplicate_device_not_acknowledged" };
  }

  return { ok: true, willWriteChildren: input.boot !== null, dedupable };
}

/**
 * What a partial failure leaves behind — stated, because the answer is "one of
 * two things and never anything else".
 *
 * INSIDE the transaction: nothing. Every row rolls back together, and a retry
 * with the same idempotency key replays; a retry with a different key
 * re-onboards from scratch against a clean slate.
 *
 * OUTSIDE it — a crash between commit and the receipt write — the rows exist
 * and the receipt does not. A retry then finds the device already known (the
 * `(vendor, serial)` unique), the identity and placement already open, and
 * refuses with `device_already_placed_elsewhere` or returns the existing
 * placement if the installation matches. **That is a recoverable state and it
 * is not silent**, which is the most that can be promised without the receipt
 * write being inside the same transaction — where it belongs, and where the
 * Drizzle adapter puts it.
 */
export const PARTIAL_FAILURE_CONTRACT = {
  insideTransaction: "nothing is written",
  afterCommitBeforeReceipt: "rows exist, retry is idempotent or refuses by name",
} as const;

/** The period a first placement opens with: `[at, )`. */
export function firstPlacementPeriod(at: Date): Tstzrange {
  return { from: at, until: null };
}
