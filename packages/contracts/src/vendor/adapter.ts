// The vendor-adapter interface.
//
// INTERFACE ONLY. No Zaptec, no Easee, no HTTP, no credentials. An
// implementation lives in packages/vendors/<name> and is the ONLY place that
// names a vendor.
//
// ── WHY THIS EXISTS ─────────────────────────────────────────────────────
//
// Today 22 dependency-cruiser baseline entries record the core importing
// vendor code directly — the slowest-changing layer depending on the
// fastest-changing external dependency. Easee is when that bill comes due.
//
// This interface is what turns "add a vendor" from a porting exercise into an
// implementation of something already tested. The conformance suite that goes
// with it is the exit criterion: an adapter that passes may be swapped in; one
// that does not, may not.
//
// FOCUS.md rule 6. The suite itself is a later pass — this file is the shape
// it will test against.
//
// ── WHAT IS DELIBERATELY NOT HERE ───────────────────────────────────────
//
// The OCPP event vocabulary. The gateway is untouched in this pass, and its
// vocabulary is harvested when the gateway is next touched — touch-it-convert
// -it, not a speculative move. A vendor adapter is the REST/observation side:
// what the vendor's cloud knows about hardware we also speak OCPP to.

/** Our id ↔ their id. The only place a vendor identifier is allowed to live. */
export interface VendorAssetRef {
  /** Vendor slug — "zaptec", "easee". Matches hardware.vendors.slug. */
  vendor: string;
  /** The vendor's identifier for this thing. */
  vendorResourceId: string;
  /** What it points at on our side. */
  localKind: "charging_station" | "installation" | "circuit" | "user";
  localId: string;
}

/** A charger as the vendor's cloud describes it, normalised. */
export interface VendorCharger {
  vendorResourceId: string;
  /** Vendor-side display name. Not authoritative for ours. */
  name: string | null;
  serialNumber: string | null;
  /**
   * Vendor-side online belief.
   *
   * NOT the same as OCPP liveness and must never be conflated with it: a
   * three-month OCPP outage once read as "online" for the whole period
   * because one column carried both meanings. Keep them separate.
   */
  vendorOnline: boolean | null;
  /** Vendor reports the unit as retired / inactive. */
  active: boolean | null;
  firmwareVersion: string | null;
}

/** A completed charging record as the vendor reports it. */
export interface VendorSessionRecord {
  vendorSessionId: string;
  vendorChargerId: string;
  startedAt: Date;
  endedAt: Date | null;
  energyKwh: string | null;
  /** The token presented, if the vendor captured one. */
  idTag: string | null;
  /**
   * A signed metering envelope (OCMF or equivalent), verbatim.
   *
   * Evidence, not a number — it is what settles a billing dispute, so it is
   * carried whole and never re-encoded. Legacy ADR 0049.
   */
  signedSession: string | null;
}

/**
 * Every call can fail in a way that is the vendor's fault and not ours, and
 * the distinction decides whether we retry, alarm, or mark data unknown.
 * A thrown exception loses that, so the result is explicit.
 */
export type VendorResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: "auth_failed" | "not_found" | "rate_limited" | "unavailable" | "malformed"; detail?: string };

/**
 * What every vendor adapter must provide.
 *
 * Read-mostly on purpose. Writes to vendor hardware go through the OCPP path
 * where we own the protocol; the vendor REST surface is for what only the
 * vendor knows.
 */
export interface VendorAdapter {
  /** Slug this adapter implements. Must match a hardware.vendors row. */
  readonly vendor: string;

  /** Every charger this credential can see. The decommissioned-by-omission source. */
  listChargers(): Promise<VendorResult<VendorCharger[]>>;

  /** One charger's detail, or not_found. */
  getCharger(vendorResourceId: string): Promise<VendorResult<VendorCharger>>;

  /**
   * Completed sessions in a window.
   *
   * Half-open [from, to): a session exactly on the boundary belongs to one
   * window, not both, or a re-sync double-counts.
   */
  listSessions(args: { from: Date; to: Date; vendorChargerId?: string }): Promise<
    VendorResult<VendorSessionRecord[]>
  >;

  /**
   * Whether the credential still works.
   *
   * Separate from the calls above so "the integration is broken" can be
   * distinguished from "this charger is missing" without inferring it from a
   * failure pattern.
   */
  checkCredential(): Promise<VendorResult<{ ownerOrgId: string | null }>>;
}

/**
 * How an adapter is constructed.
 *
 * The adapter receives an already-unsealed credential. It never reads the
 * key-encryption key, never touches the database, and never decides which
 * credential to use — those are the caller's, and keeping them out is what
 * makes an adapter testable against a fake vendor.
 */
export interface VendorAdapterFactory {
  readonly vendor: string;
  create(credential: { username: string; password: string }): VendorAdapter;
}
