// The connector status vocabulary — OCPP's, not ours.
//
// ADR 0054 item 11. OCPP 1.6 §4.9 `StatusNotification.status` has nine values
// and they are kept VERBATIM, capitalisation included. No house enum, no
// lowercase normalisation, no "idle"/"busy" collapse.
//
// WHY THE ORIGINALS. Two consumers want them and neither can reconstruct them
// from a simplified set:
//
//   - an OCPP 2.0.1 migration, which reorganises the hierarchy but keeps the
//     value names recognisable, so a house enum has to be un-mapped first;
//   - OCPI, whose `EVSE.status` is a different vocabulary again — mapping
//     OCPP -> OCPI is a stated conversion, and mapping OCPP -> house -> OCPI
//     loses `SuspendedEV` vs `SuspendedEVSE`, which is exactly the distinction
//     a driver support call turns on ("the car stopped it" vs "we stopped it").
//
// A collapse is always available later from the originals. The reverse is not.

/** OCPP 1.6 §4.9, verbatim and in the specification's order. */
export const OCPP_CONNECTOR_STATUSES = [
  "Available",
  "Preparing",
  "Charging",
  "SuspendedEV",
  "SuspendedEVSE",
  "Finishing",
  "Reserved",
  "Unavailable",
  "Faulted",
] as const;

export type OcppConnectorStatus = (typeof OCPP_CONNECTOR_STATUSES)[number];

const KNOWN = new Set<string>(OCPP_CONNECTOR_STATUSES);

/**
 * The stored value for "no StatusNotification has ever been received".
 *
 * NOT one of the nine, and deliberately not `Unavailable`. Ledger note 22:
 * absent evidence is `unavailable`, never a value — and here the temptation is
 * sharper than usual, because OCPP HAS a status called `Unavailable` and
 * writing it would look like reporting rather than inventing. It is not the
 * same claim. `Unavailable` means the charger told us it is out of service;
 * this means the charger has told us nothing. A connector that has never
 * reported is not one an operator should be dispatched to.
 */
export const STATUS_NOT_OBSERVED = "unknown";

export type StoredConnectorStatus = OcppConnectorStatus | typeof STATUS_NOT_OBSERVED;

export type ConnectorStatusEvidence =
  | { kind: "observed"; status: OcppConnectorStatus; at: Date }
  | { kind: "unavailable"; reason: "never_reported" | "unrecognised_value" };

/**
 * Parse an inbound `StatusNotification.status`.
 *
 * STRICT, and case-sensitive. A charger sending `charging` instead of
 * `Charging` is off-specification, and silently accepting it means the stored
 * value is no longer the protocol's — which is the whole thing item 11 asks us
 * not to do. It is refused by name so the deviation is visible in a log rather
 * than absorbed into the data.
 */
export function parseConnectorStatus(raw: string | null | undefined): OcppConnectorStatus | null {
  if (typeof raw !== "string") return null;
  return KNOWN.has(raw) ? (raw as OcppConnectorStatus) : null;
}

/**
 * Read a stored connector row into evidence.
 *
 * Returns `unavailable` for the not-observed sentinel and for anything
 * unrecognised, and the two reasons are kept apart: `never_reported` is a
 * connector we have not heard from, `unrecognised_value` is a row someone or
 * something wrote that is not in the vocabulary. The first is normal on a new
 * install; the second is a bug, and collapsing them hides it.
 */
export function readConnectorStatus(
  stored: string | null | undefined,
  at: Date | null | undefined,
): ConnectorStatusEvidence {
  if (stored === STATUS_NOT_OBSERVED || stored === null || stored === undefined || stored === "") {
    return { kind: "unavailable", reason: "never_reported" };
  }
  const parsed = parseConnectorStatus(stored);
  if (!parsed) return { kind: "unavailable", reason: "unrecognised_value" };
  // A status with no timestamp is not evidence of a moment; it is a value with
  // no provenance, and every caller here wants to know WHEN.
  if (!(at instanceof Date) || Number.isNaN(at.getTime())) {
    return { kind: "unavailable", reason: "unrecognised_value" };
  }
  return { kind: "observed", status: parsed, at };
}

/**
 * Is a connector physically able to serve a session right now?
 *
 * Deliberately NOT a billing predicate. Billing counts placements overlapping
 * a period (ADR 0054 decision 5) and whether a connector happened to be
 * `Faulted` at the instant someone ran the query has nothing to do with
 * whether it was on site that month. Keeping the two apart is why this
 * function is named for operations and lives here rather than in the feeder.
 */
export function isServiceable(status: OcppConnectorStatus): boolean {
  return status !== "Unavailable" && status !== "Faulted";
}
