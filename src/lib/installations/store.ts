// Persistence port for installation management.
//
// The service in ./service.ts is written against this interface so its rules
// (idempotent replay, stale-revision refusal, atomic change history, conflict
// handling) can be exercised with an in-memory fake. The Drizzle
// implementation is ./drizzle-store.ts. A fake proves the service contract
// only — never PostgreSQL constraints or real persistence.

import type { Amps, Phases, Snapshot } from "./model";

export type SaveErrorCode =
  | "validation"
  | "stale_revision"
  | "not_found"
  | "forbidden"
  | "identity_in_use"
  | "serial_in_use"
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

export type NewInstallationRow = {
  id: string;
  orgId: string;
  siteId: string;
  key: string;
  displayName: string;
  mainDeviceType: string | null;
  mainRatingAmps: Amps;
  mainPhaseCount: Phases;
  electricianName: string | null;
  electricianEmail: string | null;
  electricianPhone: string | null;
  electricianChangedRevision: number;
};

export type InstallationPatch = Partial<{
  displayName: string;
  mainDeviceType: string | null;
  mainRatingAmps: Amps;
  mainPhaseCount: Phases;
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

export interface TxPort {
  /** Installation id of an earlier save made with this idempotency key. */
  findReplay(idempotencyKey: string): Promise<string | null>;
  loadSnapshot(installationId: string): Promise<Snapshot | null>;
  /** The site must exist and belong to the organisation; returns the CPO organisation's display name and routing id. */
  loadSite(siteId: string, orgId: string): Promise<{ orgDisplayName: string; routingId: string | null } | null>;
  /** Assigns the CPO routing label once (collision-checked, reserved labels excluded) and returns it. */
  ensureRoutingId(orgId: string, orgDisplayName: string): Promise<string>;
  insertInstallation(row: NewInstallationRow): Promise<void>;
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
    installationKey: string;
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
    installationKey: string;
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
