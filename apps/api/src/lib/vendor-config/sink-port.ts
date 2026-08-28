// The vendor-config sink — ADR 0054 item 12.
//
// Four fields from the Zaptec bulk response, persisted because each one
// changes what our OWN rows mean. That is the test for what belongs in the
// database, and it is worth applying to each field rather than to the group:
//
//   Charger.Active            a deactivated charger is still a row in our
//                             database and still a charger in the portal. Per
//                             connector billing over unfiltered rows invoices
//                             for it. See `activeForBilling` below.
//   IsAuthorizationRequired   whether a driver must present a credential.
//                             Decides whether a session can be attributed to a
//                             person at all, which decides whether the driver
//                             half of the fee has anyone to count.
//   AuthenticationType        the INTEGRATION PATH, not authentication. Read
//                             the warning on the type below before using it.
//   PropertyOcppDefaultIdTag  the token sessions arrive under when no driver
//                             authenticated. Sessions bearing it are NOT
//                             evidence of a driver, and a driver count that
//                             includes them is wrong.
//
// ── THE SIGNATURE BELOW IS LOCKED ─────────────────────────────────────────
// It appears verbatim in Claude B's prompt. Changing it here breaks the
// importer B is writing against it. Any change goes through CR-3 in
// docs/notes/2026-08-18-invoice-contract-change-requests.md first.

/**
 * Round 3's evidence convention, generalised.
 *
 * An absent row is `unavailable` — never a zero, and here never a `false`.
 * `false` is the sharper trap: `chargerActive: false` is a claim that Zaptec
 * told us the charger is deactivated, and a missing observation defaulted to
 * `false` would silently remove a live charger from a billing count.
 */
export type Evidence<T> =
  | { kind: "observed"; value: T }
  | { kind: "unavailable"; reason: VendorConfigGap };

/** Why an observation is not available. Each is a different fix. */
export type VendorConfigGap =
  /** No observation has ever been recorded for this device. */
  | "never_observed"
  /** The device id is not one this caller may read. */
  | "out_of_scope";

export interface VendorConfigObservation {
  deviceId: string;
  observedAt: Date;
  chargerActive: boolean | null;
  /**
   * INTEGRATION PATH — 0=Native, 1=WebHooks, 2=Ocpp, 3=OcppNative.
   *
   * IT IS NOT DRIVER AUTHENTICATION, and it never can be. It is an
   * INSTALLATION property, so it reads 2 uniformly across the whole fleet.
   * Two different wrong readings of this field have already been committed to
   * this repository and corrected — one as "0=None, 1=Vendor app, 2=OCPP
   * cloud", one as "0 = Zaptec Portal owns the list". Use
   * `isAuthorizationRequired` for per-charger driver auth.
   *
   * Persisted anyway, because a value that reads 2 uniformly today is
   * evidence, and the day one installation reads 3 is a day we want a record
   * of rather than a surprise.
   */
  authenticationType: number | null;
  /** Driver authorization, Zaptec StateId 120. True on exactly one charger in
   *  the fleet as of 2026-08-05. THIS is per-charger driver auth. */
  isAuthorizationRequired: boolean | null;
  /** A token, never a person. Sessions arriving under it have no driver. */
  ocppDefaultIdTag: string | null;
}

export interface VendorConfigSinkPort {
  record(o: VendorConfigObservation): Promise<{ status: "recorded" | "unchanged" }>;
  latestFor(deviceId: string): Promise<Evidence<VendorConfigObservation>>;
}

// ── The decisions both adapters share ─────────────────────────────────────
//
// Pure, and extracted for the same reason as everything else in this lane:
// the Drizzle adapter has never run, so anything encoded only inside it is
// untested. The fixture runs the functions below in the same order the SQL
// does.

/**
 * Are two observations the same reading?
 *
 * `observedAt` is deliberately NOT compared. An importer polling every five
 * minutes produces a new timestamp every time and identical values; storing
 * each of those is a row per poll and a history in which nothing ever
 * happened. What we want recorded is the CHANGE.
 *
 * The cost is stated rather than hidden: the log then answers "what did this
 * charger last report" and "when did it change", but NOT "when did we last
 * successfully poll it". If that second question is ever needed it is a
 * different fact and wants its own column, not a duplicate row here.
 */
export function sameReading(a: VendorConfigObservation, b: VendorConfigObservation): boolean {
  return (
    a.deviceId === b.deviceId &&
    a.chargerActive === b.chargerActive &&
    a.authenticationType === b.authenticationType &&
    a.isAuthorizationRequired === b.isAuthorizationRequired &&
    a.ocppDefaultIdTag === b.ocppDefaultIdTag
  );
}

export type RecordCheck =
  | { ok: true }
  | { ok: false; reason: "device_id_required" | "observed_at_invalid" };

/** Refusals that must not become a stored row, checked before either adapter
 *  touches storage so both refuse identically. */
export function checkObservation(o: VendorConfigObservation): RecordCheck {
  if (typeof o.deviceId !== "string" || o.deviceId.trim() === "") {
    return { ok: false, reason: "device_id_required" };
  }
  if (!(o.observedAt instanceof Date) || Number.isNaN(o.observedAt.getTime())) {
    return { ok: false, reason: "observed_at_invalid" };
  }
  return { ok: true };
}

/**
 * WHEN EACH FIELD LAST CHANGED, derived from the observation log.
 *
 * Item 12 asks for the four fields "each with a timestamp". Four columns would
 * give four timestamps that can disagree with each other — one row claiming
 * `charger_active` was read at 09:00 and `auth_required` at 09:05, from a
 * single response. An append-only log gives every field the timestamp of the
 * observation it appeared in, which cannot disagree, AND answers the question
 * four columns cannot: when did this field last CHANGE, as opposed to when was
 * it last seen.
 *
 * `null` means the field has held one value across the whole log — never
 * observed to change — which is different from never observed at all. The
 * caller distinguishes them by whether the log is empty.
 */
export function fieldChangedAt(
  log: readonly VendorConfigObservation[],
): Record<"chargerActive" | "authenticationType" | "isAuthorizationRequired" | "ocppDefaultIdTag", Date | null> {
  const ordered = [...log].sort((a, b) => a.observedAt.getTime() - b.observedAt.getTime());
  const out = {
    chargerActive: null as Date | null,
    authenticationType: null as Date | null,
    isAuthorizationRequired: null as Date | null,
    ocppDefaultIdTag: null as Date | null,
  };
  for (let i = 1; i < ordered.length; i++) {
    const prev = ordered[i - 1]!;
    const cur = ordered[i]!;
    for (const k of Object.keys(out) as (keyof typeof out)[]) {
      if (prev[k] !== cur[k]) out[k] = cur.observedAt;
    }
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// THE DALVEGUR PREDICATE — what per-connector billing must count
//
// The estate, as observed:
//
//     20   chargers ACTIVE at Dalvegur
//     15   chargers DEACTIVATED
//     35   chargers visible in the Zaptec portal   (20 + 15)
//     30   rows in our database
//
// Three different numbers, none of them wrong, and the gaps are the finding:
//
//   35 vs 30   five portal chargers have no row here at all. That is an
//              IMPORT gap, not a billing one, and it is invisible to any
//              predicate — a row that does not exist cannot be filtered in.
//              It is the direction that under-bills, and it needs a
//              reconciliation rather than a WHERE clause.
//
//   30 vs 20   the one this phase closes. Ten of our thirty rows are
//              deactivated chargers. **Per-connector billing over unfiltered
//              rows invoices 30 where 20 exist** — at 200 kr per active
//              connector that is 6,000 kr against 4,000 kr of real estate, on
//              one site, every month.
//
// THE PREDICATE, stated precisely, and implemented in Phase 5:
//
//   A connector is billable in period P when
//     (a) its device had a PLACEMENT overlapping P                 [dec. 5]
//     AND
//     (b) the latest vendor-config observation at or before the END of P
//         has chargerActive === true.
//
// Four things that predicate deliberately does NOT say:
//
//   1 · It does not read `chargerActive` as of NOW. Billing March in April
//       must use what was true in March. `activeForBilling` takes the period
//       end for that reason and for no other.
//   2 · It does not treat a MISSING observation as inactive. That is the
//       `false`-is-not-`unavailable` trap in this file's Evidence type: a
//       device we have never polled would silently drop out of the invoice.
//       Missing is `unavailable`, and an unavailable count is a HOLD, not a
//       smaller number — which is round 3's rule and stays so.
//   3 · It does not consult connector STATUS. A charger that was `Faulted`
//       when someone ran the query was still on site all month. Operational
//       health and billable presence are different questions; `isServiceable`
//       answers the first and lives in the status module.
//   4 · It does not filter on the portal count. The five missing rows are an
//       import gap and are named as one.
// ═══════════════════════════════════════════════════════════════════════════

export type BillableActivity =
  | { kind: "billable" }
  | { kind: "not_billable"; reason: "deactivated_by_vendor" }
  | { kind: "unavailable"; reason: VendorConfigGap | "no_observation_before_period_end" };

/**
 * Half (b) of the predicate: was this device vendor-active for the period?
 *
 * `log` is every observation for the device; `periodEnd` is the EXCLUSIVE end
 * of the billing period. The latest observation strictly before it wins.
 *
 * Returns three outcomes and never two. Collapsing `unavailable` into
 * `not_billable` is the whole defect this exists to prevent: it turns "we have
 * not polled this charger" into "do not invoice for it", which is a silent
 * discount that nobody reviews.
 */
export function activeForBilling(
  log: readonly VendorConfigObservation[],
  periodEnd: Date,
): BillableActivity {
  if (log.length === 0) return { kind: "unavailable", reason: "never_observed" };
  const before = log
    .filter((o) => o.observedAt.getTime() < periodEnd.getTime())
    .sort((a, b) => a.observedAt.getTime() - b.observedAt.getTime());
  const latest = before[before.length - 1];
  if (!latest) {
    // Observations exist, but all of them are AFTER the period ended. Learning
    // in April that a charger is active says nothing about March, and dating
    // it backwards would be inventing evidence.
    return { kind: "unavailable", reason: "no_observation_before_period_end" };
  }
  if (latest.chargerActive === null) {
    return { kind: "unavailable", reason: "never_observed" };
  }
  return latest.chargerActive
    ? { kind: "billable" }
    : { kind: "not_billable", reason: "deactivated_by_vendor" };
}
