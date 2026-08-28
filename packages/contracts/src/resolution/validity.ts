// Validity replaces existence — ADR 0054 items 8 and 9.
//
// ── THE CHANGE, IN ONE SENTENCE ─────────────────────────────────────────
//
// "Is this user in this group?" becomes "was this user in this group AT THIS
// INSTANT?", and "which device is this identity?" becomes "which device was
// this identity attached to AT THIS INSTANT?".
//
// ── WHY IT MATTERS ON AN INVOICE ────────────────────────────────────────
//
// A driver who moved out in March is still a member by existence. Priced by
// existence, their April sessions land on the new tenant's bill — or the old
// one's, depending which row survived. Priced by validity, each session lands
// on whoever was actually there.
//
// The same shape, one level up: a charger identity that two orgs both claim
// resolves by `LIMIT 1` today, so a charger's energy is invoiced to an
// arbitrary host. That was round 3's finding and it is ADR 0054's problem
// statement.
//
// ── THE RULE THAT IS EASY TO GET WRONG ──────────────────────────────────
//
// **Absent is `unavailable`, never `false`.** A membership that cannot be
// resolved is not a non-membership. On an invoice those two look identical
// and only one of them is honest: one says "this driver was not here", the
// other says "I could not find out". Ledger note 22.

/** Round-3 convention, restated here so the resolution module stands alone. */
export type Evidence<T> =
  | { status: "available"; value: T }
  | { status: "unavailable"; reason: string };

export const available = <T>(value: T): Evidence<T> => ({ status: "available", value });
export const unavailable = <T>(reason: string): Evidence<T> => ({ status: "unavailable", reason });

export function isAvailable<T>(e: Evidence<T>): e is { status: "available"; value: T } {
  return e.status === "available";
}

// ── intervals ───────────────────────────────────────────────────────────

/**
 * Half-open `[from, until)`.
 *
 * `until: null` is open-ended. The boundary instant belongs to the LATER
 * interval — which is what lets a move-out and a move-in at the same instant
 * describe one continuous tenancy with neither an overlap nor a gap.
 */
export interface Interval {
  from: Date;
  until: Date | null;
}

export function covers(i: Interval, at: Date): boolean {
  if (at.getTime() < i.from.getTime()) return false;
  if (i.until === null) return true;
  // Strictly less than: the closing instant is NOT covered.
  return at.getTime() < i.until.getTime();
}

export function overlaps(a: Interval, b: Interval): boolean {
  const aEnd = a.until?.getTime() ?? Number.POSITIVE_INFINITY;
  const bEnd = b.until?.getTime() ?? Number.POSITIVE_INFINITY;
  return a.from.getTime() < bEnd && b.from.getTime() < aEnd;
}

// ── item 9: membership validity ─────────────────────────────────────────

export interface MembershipRow {
  membershipId: string;
  groupId: string;
  userId: string;
  period: Interval;
}

/**
 * The locked signature, shared verbatim with Claude A.
 *
 * `isMemberAt` answers about ONE instant. `membershipsOverlapping` answers
 * about a period, which is what billing needs — ADR 0054 decision 5 counts
 * placements *overlapping* the period rather than current at billing time,
 * and memberships follow the same rule.
 */
export interface MembershipValidityPort {
  isMemberAt(groupId: string, userId: string, at: Date): Promise<Evidence<boolean>>;
  membershipsOverlapping(
    groupId: string,
    period: { from: Date; until: Date | null },
  ): Promise<Evidence<MembershipRow[]>>;
}

/**
 * A session is priced against the membership valid when it STARTED.
 *
 * ADR 0054 decision 6: sessions are sealed. Never against the membership
 * current at billing time — a driver who left in March must not have their
 * March sessions re-attributed because they are gone in April.
 */
export async function membershipForSession(
  port: MembershipValidityPort,
  groupId: string,
  userId: string,
  sessionStartedAt: Date,
): Promise<Evidence<boolean>> {
  return port.isMemberAt(groupId, userId, sessionStartedAt);
}

/** An in-memory port for tests and for the offline dry runs. */
export class FixtureMembershipValidity implements MembershipValidityPort {
  constructor(
    private readonly rows: MembershipRow[],
    /** When set, every call reports unavailable — for testing the honest-absence path. */
    private readonly failWith: string | null = null,
  ) {}

  async isMemberAt(groupId: string, userId: string, at: Date): Promise<Evidence<boolean>> {
    if (this.failWith) return unavailable(this.failWith);
    const hit = this.rows.some(
      (r) => r.groupId === groupId && r.userId === userId && covers(r.period, at),
    );
    return available(hit);
  }

  async membershipsOverlapping(
    groupId: string,
    period: { from: Date; until: Date | null },
  ): Promise<Evidence<MembershipRow[]>> {
    if (this.failWith) return unavailable(this.failWith);
    return available(this.rows.filter((r) => r.groupId === groupId && overlaps(r.period, period)));
  }
}

// ── item 8: the placement resolution chain ──────────────────────────────

export interface ResolvedPlacement {
  /** The stable public id — OCPI's EVSE.uid, which "can never be changed". */
  placementId: string;
  deviceId: string;
  orgId: string;
  installationId: string;
  circuitId: string | null;
  siteId: string;
}

/** The locked signature, shared verbatim with Claude A. */
export interface PlacementResolverPort {
  resolveIdentity(identityString: string, at: Date): Promise<Evidence<ResolvedPlacement>>;
}

export interface DeviceIdentityRow {
  deviceId: string;
  identityString: string;
  period: Interval;
}

export interface PlacementRow {
  placementId: string;
  deviceId: string;
  orgId: string;
  installationId: string;
  circuitId: string | null;
  siteId: string;
  period: Interval;
}

/**
 * The reason an identity did not resolve.
 *
 * `ambiguous_*` are the ones that matter. Until A's temporal key lands,
 * nothing in the database prevents two open rows — so this adapter REFUSES
 * rather than taking `LIMIT 1`, which is exactly what today's
 * `WHERE lower(identity_string) = lower($1) LIMIT 1` does and exactly how a
 * charger's energy ends up on an arbitrary host's invoice.
 */
export type ResolutionFailure =
  | "identity_not_found"
  | "identity_not_attached_at_instant"
  | "ambiguous_identity"
  | "device_not_placed_at_instant"
  | "ambiguous_placement";

export class FixturePlacementResolver implements PlacementResolverPort {
  constructor(
    private readonly identities: DeviceIdentityRow[],
    private readonly placements: PlacementRow[],
  ) {}

  async resolveIdentity(identityString: string, at: Date): Promise<Evidence<ResolvedPlacement>> {
    const needle = identityString.toLowerCase();
    const matching = this.identities.filter((i) => i.identityString.toLowerCase() === needle);
    if (matching.length === 0) return unavailable("identity_not_found");

    const openAt = matching.filter((i) => covers(i.period, at));
    if (openAt.length === 0) return unavailable("identity_not_attached_at_instant");
    if (openAt.length > 1) {
      // Two devices claiming one identity string at one instant. Refused, not
      // arbitrated. This is the case round 3 found resolving by LIMIT 1.
      return unavailable("ambiguous_identity");
    }

    const deviceId = openAt[0]!.deviceId;
    const placed = this.placements.filter((p) => p.deviceId === deviceId && covers(p.period, at));
    if (placed.length === 0) return unavailable("device_not_placed_at_instant");
    if (placed.length > 1) return unavailable("ambiguous_placement");

    const p = placed[0]!;
    return available({
      placementId: p.placementId,
      deviceId: p.deviceId,
      orgId: p.orgId,
      installationId: p.installationId,
      circuitId: p.circuitId,
      siteId: p.siteId,
    });
  }
}
