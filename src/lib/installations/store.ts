// Persistence port for installation management.
//
// The service in ./service.ts is written against this interface so its rules
// (idempotent replay, stale-revision refusal, atomic change history, conflict
// handling) can be exercised with an in-memory fake. The Drizzle
// implementation is ./drizzle-store.ts. A fake proves the service contract
// only — never PostgreSQL constraints or real persistence.

import type { Amps, Grid, Phases, Snapshot } from "./model";

export type SaveErrorCode =
  | "validation"
  | "stale_revision"
  | "not_found"
  | "forbidden"
  | "identity_in_use"
  | "serial_in_use"
  /** The draft cannot be used: already used, discarded, or too many are open. */
  | "draft_unavailable"
  | "unavailable";

export class SaveError extends Error {
  constructor(
    readonly code: SaveErrorCode,
    message: string,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = "SaveError";
  }
}

export type DraftState = "open" | "consumed" | "discarded";

/** The stored draft: the form document the operator had typed, never a password. */
export type DraftRow = {
  id: string;
  orgId: string | null;
  state: DraftState;
  payload: Record<string, unknown>;
  revision: number;
  /** Set exactly when state is "consumed". */
  installationId: string | null;
  actorLabel: string;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
};

/** A draft as the operator sees it: with the CPO name when one was chosen. */
export type Draft = DraftRow & { orgName: string | null };

export type NewDraftRow = {
  id: string;
  orgId: string | null;
  payload: Record<string, unknown>;
  actorKind: string;
  actorLabel: string;
};

export type NewInstallationRow = {
  id: string;
  orgId: string;
  siteId: string;
  key: string;
  displayName: string;
  mainDeviceType: string | null;
  mainRatingAmps: Amps;
  mainPhaseCount: Phases;
  mainGridType: Grid;
  electricianName: string | null;
  electricianEmail: string | null;
  electricianPhone: string | null;
  electricianChangedRevision: number;
  /**
   * Set when the installation is created from a selected vendor installation: the durable identity (vendor + the vendor's own
   * installation reference) and the allowlisted snapshot kept in `metadata`. Null for every manually created installation.
   */
  vendorImport?: { vendor: string; externalRef: string; metadata: Record<string, unknown> } | null;
};

export type InstallationPatch = Partial<{
  displayName: string;
  mainDeviceType: string | null;
  mainRatingAmps: Amps;
  mainPhaseCount: Phases;
  mainGridType: Grid;
  electricianName: string | null;
  electricianEmail: string | null;
  electricianPhone: string | null;
  electricianChangedRevision: number;
}>;

export type ChangeRow = {
  orgId: string;
  installationId: string;
  revision: number;
  entityType: "installation" | "electrician" | "circuit" | "charger" | "password";
  entityId: string | null;
  action: "create" | "update" | "archive" | "move" | "detach" | "set" | "clear";
  diff: Record<string, { from: unknown; to: unknown }>;
  actorKind: string;
  actorLabel: string;
  effectiveAt: Date | null;
  idempotencyKey: string | null;
};

/** One recorded knock of an unknown charger, as the engine wrote it (throttled observations, not live status). */
export type DiscoveryRow = {
  chargePointId: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
  attemptCount: number;
  /** Why admission refused it, when it knew (e.g. a retired device reconnecting). Null for a plain unknown id. */
  reason: string | null;
  /** When and which BootNotification message was last captured, never its body. Null when none was captured. */
  boot: { messageId: string; receivedAt: Date } | null;
  /** When `reason` was recorded (credential refusals carry it so a later successful boot can clear them). */
  reasonAt: Date | null;
  /** Durable record, written in the SAME transaction as the attach, that a waiting charger must be told it is registered now. */
  promote: { at: Date; delivered: boolean; attempts: number; outcome: string | null } | null;
};

/** The complete captured BootNotification for one CPO + charge point id (the detail read; the list never carries it). */
export type BootCaptureRow = {
  messageId: string;
  receivedAt: string;
  frameBytes: number;
  validation: { ok: true } | { ok: false; code: string; description: string };
  /** Exactly as received. Untrusted text: render it as text. */
  payload: unknown;
};

export interface TxPort {
  /** Recorded knocks for THIS CPO only (rows keyed {cpo-org-id}/{charge-point-id}); legacy or malformed keys are not returned. */
  listDiscoveries(orgId: string, limit: number): Promise<DiscoveryRow[]>;
  /** The latest captured BootNotification for exactly this CPO and charge point id, or null. Survives attachment. */
  loadBootCapture(orgId: string, chargePointId: string): Promise<BootCaptureRow | null>;
  /** The knock for exactly this CPO and charge point id, or null. */
  loadDiscovery(orgId: string, chargePointId: string): Promise<DiscoveryRow | null>;
  /**
   * Records, inside the saving transaction, that this charge point id was just attached. Updates the existing discovery row only:
   * a charger that never knocked has nothing waiting to be told.
   */
  markPromotion(orgId: string, chargePointId: string, at: Date): Promise<void>;
  /** Outcome of one attempt to tell the gateway. Increments `attempts`. A no-op without a recorded promotion. */
  recordPromotionOutcome(orgId: string, chargePointId: string, result: { delivered: boolean; outcome: string }): Promise<void>;
  /** Latest accepted BootNotification receipt per lower-cased charge point id (known chargers only). Evidence that a charger connected. */
  lastBootAt(orgId: string, chargePointIds: string[]): Promise<Map<string, Date>>;
  /** Lower-cased charge point ids (of those given) that have ANY connection identity in this CPO, open or closed. */
  knownChargePointIds(orgId: string, chargePointIds: string[]): Promise<Set<string>>;
  /** Installation id of an earlier save made with this idempotency key. */
  findReplay(idempotencyKey: string): Promise<string | null>;
  loadSnapshot(installationId: string): Promise<Snapshot | null>;
  /** The site must exist and belong to the organisation; returns the CPO organisation's display name and routing id. */
  loadSite(siteId: string, orgId: string): Promise<{ orgDisplayName: string; routingId: string | null } | null>;
  /** Assigns the CPO routing label once (collision-checked, reserved labels excluded) and returns it. */
  ensureRoutingId(orgId: string, orgDisplayName: string): Promise<string>;
  /** A CPO organisation that exists and is active, with its routing label (null until first assigned). */
  loadCpoOrganisation(orgId: string): Promise<{ displayName: string; routingId: string | null } | null>;
  /** The draft, without locking it. */
  loadDraft(id: string): Promise<Draft | null>;
  /** The draft row locked FOR UPDATE: a create, a discard and a save of one draft are serialised here. */
  lockDraft(id: string): Promise<DraftRow | null>;
  countOpenDrafts(): Promise<number>;
  listOpenDrafts(limit: number): Promise<Draft[]>;
  insertDraft(row: NewDraftRow): Promise<void>;
  /** Replaces the payload and organisation of an OPEN draft and bumps its revision; returns the new revision. */
  updateDraft(id: string, patch: { orgId: string | null; payload: Record<string, unknown> }): Promise<number>;
  /** Moves an open draft to consumed (with the installation id) or discarded. Never reopens or re-closes one. */
  closeDraft(id: string, to: "consumed" | "discarded", installationId: string | null): Promise<void>;
  insertInstallation(row: NewInstallationRow): Promise<void>;
  /**
   * Serialises every import of one vendor installation by one CPO for the rest of this transaction (a transaction-scoped
   * lock on org + vendor + vendor reference), then returns the installation already created from it, if any. The check
   * happens under the lock, so two concurrent imports cannot both find nothing. Archived installations are reported, not hidden.
   */
  lockVendorImport(orgId: string, vendor: string, externalRef: string): Promise<{ id: string; archived: boolean } | null>;
  /** `UPDATE … WHERE revision = expected`; returns the new revision, or null if the stored revision differs. */
  bumpRevision(installationId: string, expected: number): Promise<number | null>;
  patchInstallation(installationId: string, patch: InstallationPatch): Promise<void>;
  setPassword(installationId: string, mode: "none" | "password", verifier: string | null): Promise<void>;

  insertCircuit(row: {
    id: string;
    orgId: string;
    siteId: string;
    installationId: string;
    parentId: string | null;
    displayName: string;
    ratingAmps: Amps;
    phaseCount: Phases;
    sortOrder: number;
    /** The vendor's own circuit reference (vendor imports only). A reference, never an identity. */
    vendorRef?: string | null;
  }): Promise<void>;
  updateCircuit(
    id: string,
    patch: Partial<{ displayName: string; ratingAmps: Amps; phaseCount: Phases; parentId: string | null; sortOrder: number }>,
  ): Promise<void>;
  archiveCircuit(id: string): Promise<void>;

  /** Creates device + identity + placement. Throws SaveError identity_in_use / serial_in_use on conflict. */
  attachCharger(row: {
    deviceId: string;
    orgId: string;
    siteId: string;
    installationId: string;
    circuitId: string;
    label: string;
    chargePointId: string;
    vendor: string | null;
    model: string | null;
    serialNumber: string | null;
  }): Promise<void>;
  updateCharger(row: {
    deviceId: string;
    placementId: string;
    /** The CPO organisation the connection identity belongs to. */
    orgId: string;
    patch: Partial<{ label: string; chargePointId: string; vendor: string | null; model: string | null; serialNumber: string | null }>;
  }): Promise<void>;
  /** Closes the current placement and opens a new one on another circuit of the same installation. */
  moveCharger(row: {
    deviceId: string;
    placementId: string;
    orgId: string;
    siteId: string;
    installationId: string;
    circuitId: string;
    label: string;
  }): Promise<void>;
  /**
   * Why this device must NOT be detached by a plain save, or null. Non-null while a session is in
   * progress on it or a guarded removal is already open: deleting it here would orphan the session.
   * The guarded path (lifecycle service) stops the session and settles it first.
   */
  detachBlockReason(deviceId: string): Promise<string | null>;
  /** Closes placement and identity. The device row, its observations and its history are kept. */
  detachCharger(row: { deviceId: string; placementId: string; reason: string }): Promise<void>;

  insertChanges(rows: ChangeRow[]): Promise<void>;
}

export interface Store {
  /** One database transaction. Any thrown error rolls everything back. */
  transaction<T>(fn: (tx: TxPort) => Promise<T>): Promise<T>;
}
