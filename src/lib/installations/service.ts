// Save / create an installation: the one write path of installation management.
//
// Order inside the single transaction:
//   replay check → load + authorise → stale-revision gate → plan (validate +
//   diff) → bump revision → apply operations → write change history.
// Mutation and history commit together or not at all. A thrown SaveError rolls
// the whole thing back, so success is never reported for a failed write.

import { mayAdminister, type Actor } from "./actor";
import { discoveryEvidence } from "./discovery";
import { closedDraftError, mayUseDraft, UNKNOWN_DRAFT } from "./drafts";
import {
  isReservedRoutingLabel,
  newInstallationKey,
  responsibleStatus,
  type ResponsibleStatus,
  type SaveInstallationInput,
  type Snapshot,
} from "./model";
import { generateInstallationPassword, hashInstallationPassword } from "./password";
import { planSave, type Diff, type Plan } from "./plan";
import { SaveError, type ChangeRow, type Store, type TxPort } from "./store";
import { importKey, importMetadata } from "./vendor-import";

export type SaveResult = {
  snapshot: Snapshot;
  /** True when this idempotency key had already been applied; nothing was written again. */
  replayed: boolean;
  /** True when the submitted state equalled the stored one and no revision was created. */
  unchanged: boolean;
  /**
   * True when this CPO had already imported this vendor installation: the EXISTING installation is returned, nothing was
   * written, and nothing of the operator's edits was touched. `unchanged` is also true then.
   */
  alreadyImported?: boolean;
  /** A generated password, returned exactly once and never stored in clear. */
  generatedPassword?: string;
  responsibleStatus: ResponsibleStatus;
  /** Charge point ids attached to a circuit by THIS commit (typed or picked from Incoming). Used to signal a waiting charger after the commit. */
  attachedChargePointIds?: string[];
};

export type ServiceDeps = {
  now?: () => Date;
  newId?: () => string;
  newKey?: () => string;
  hashPassword?: (p: string) => Promise<string>;
  generatePassword?: () => string;
};

const ELECTRICIAN_FIELDS = new Set(["electricianName", "electricianEmail", "electricianPhone"]);

function split(diff: Diff): { installation: Diff; electrician: Diff } {
  const installation: Diff = {};
  const electrician: Diff = {};
  for (const [k, v] of Object.entries(diff)) (ELECTRICIAN_FIELDS.has(k) ? electrician : installation)[k] = v;
  return { installation, electrician };
}

type RowBody = Omit<ChangeRow, "orgId" | "installationId" | "revision" | "actorKind" | "actorLabel" | "effectiveAt" | "idempotencyKey">;

export async function saveInstallation(
  store: Store,
  input: SaveInstallationInput,
  actor: Actor,
  deps: ServiceDeps = {},
): Promise<SaveResult> {
  const newId = deps.newId ?? (() => crypto.randomUUID());
  const hashPassword = deps.hashPassword ?? hashInstallationPassword;
  const generatePassword = deps.generatePassword ?? generateInstallationPassword;
  const now = deps.now ?? (() => new Date());

  // Hash outside the transaction: PBKDF2 is CPU, and must not hold a connection open.
  let generated: string | undefined;
  let verifier: string | null = null;
  if (input.password.action === "set") verifier = await hashPassword(input.password.value);
  if (input.password.action === "generate") {
    generated = generatePassword();
    verifier = await hashPassword(generated);
  }

  return store.transaction(async (tx): Promise<SaveResult> => {
    const replayOf = await tx.findReplay(input.idempotencyKey);
    if (replayOf) {
      const snapshot = await tx.loadSnapshot(replayOf);
      if (!snapshot || !mayAdminister(actor, snapshot.installation.orgId)) throw new SaveError("not_found", "Installation not found");
      return { snapshot, replayed: true, unchanged: false, responsibleStatus: responsibleStatus(snapshot.installation) };
    }

    const isCreate = input.installationId === undefined;
    if (!isCreate && input.vendorImport) {
      throw new SaveError("validation", "A vendor import creates a new installation; it cannot be applied to an existing one", [{ path: "vendorImport", message: "Create only" }]);
    }
    let current: Snapshot | null = null;
    let orgId: string;
    let siteId: string;

    if (isCreate) {
      if (!input.orgId || !input.siteId) {
        throw new SaveError("validation", "Choose an organisation and a site", [{ path: "siteId", message: "Required" }]);
      }
      if (!mayAdminister(actor, input.orgId)) throw new SaveError("forbidden", "Not permitted");
      orgId = input.orgId;
      siteId = input.siteId;
    } else {
      current = await tx.loadSnapshot(input.installationId!);
      // Unknown and not-permitted answer identically so existence is not disclosed.
      if (!current || !mayAdminister(actor, current.installation.orgId)) throw new SaveError("not_found", "Installation not found");
      if (input.orgId && input.orgId !== current.installation.orgId) throw new SaveError("not_found", "Installation not found");
      if (input.siteId && input.siteId !== current.installation.siteId) {
        throw new SaveError("validation", "An installation cannot move to another site here", [{ path: "siteId", message: "Not changeable" }]);
      }
      if (input.expectedRevision === undefined) {
        throw new SaveError("validation", "expectedRevision is required", [{ path: "expectedRevision", message: "Required" }]);
      }
      if (input.expectedRevision !== current.installation.revision) {
        throw new SaveError("stale_revision", "This installation was changed by someone else", { currentRevision: current.installation.revision });
      }
      orgId = current.installation.orgId;
      siteId = current.installation.siteId;
    }

    const planned = planSave(current, input);
    if (!planned.ok) throw new SaveError("validation", "Some fields need attention", planned.problems);
    const plan = planned.plan;

    const passwordChanging = input.password.action !== "keep";
    if (!isCreate && plan.isEmpty && !passwordChanging) {
      return { snapshot: current!, replayed: false, unchanged: true, responsibleStatus: responsibleStatus(current!.installation) };
    }

    const effectiveAt = input.effectiveAt ? new Date(input.effectiveAt) : null;
    if (effectiveAt && effectiveAt.getTime() > now().getTime() + 5 * 60_000) {
      throw new SaveError("validation", "The effective time cannot be in the future", [{ path: "effectiveAt", message: "In the future" }]);
    }

    let installationId: string;
    let installationKey: string;
    let revision = 1;
    const changes: ChangeRow[] = [];
    const row = (id: string, body: RowBody): ChangeRow => ({
      orgId, installationId: id, revision, actorKind: actor.kind, actorLabel: actor.label, effectiveAt, idempotencyKey: null, ...body,
    });

    if (isCreate) {
      const site = await tx.loadSite(siteId, orgId);
      if (!site) throw new SaveError("not_found", "Site not found for this organisation");
      if (input.vendorImport) {
        // Serialised per (CPO, vendor, vendor installation) and checked under that lock, so two concurrent imports, a retry with a
        // new idempotency key after a lost response, and a re-import all find the first one instead of making another. A match by
        // name is never used and a manually created installation is never merged. The earlier result is returned untouched.
        const { vendor, externalRef } = importKey(input.vendorImport);
        const existing = await tx.lockVendorImport(orgId, vendor, externalRef);
        if (existing) {
          if (existing.archived) {
            throw new SaveError("validation", "This vendor installation was imported before and that installation is archived. Resolve it explicitly; it is not re-created automatically.", [
              { path: "vendorImport", message: "Previously imported (archived)" },
            ]);
          }
          const snapshot = await tx.loadSnapshot(existing.id);
          if (!snapshot) throw new SaveError("unavailable", "The earlier import could not be read back");
          return { snapshot, replayed: false, unchanged: true, alreadyImported: true, responsibleStatus: responsibleStatus(snapshot.installation) };
        }
      }
      const routing = site.routingId ?? (await tx.ensureRoutingId(orgId, site.orgDisplayName));
      if (isReservedRoutingLabel(routing)) throw new SaveError("unavailable", "Organisation routing label is reserved");
      installationId = newId();
      installationKey = (deps.newKey ?? newInstallationKey)();
      if (input.draftId) {
        // Locked so a discard or a second create from the same draft waits for this one; a discarded or used draft
        // refuses the create outright rather than being quietly ignored.
        const draft = await tx.lockDraft(input.draftId);
        if (!draft || !mayUseDraft(actor, draft.orgId)) throw new SaveError("not_found", UNKNOWN_DRAFT);
        if (draft.state !== "open") throw await closedDraftError(tx, actor, draft);
        await tx.closeDraft(draft.id, "consumed", installationId);
      }
      const e = input.electrician;
      await tx.insertInstallation({
        id: installationId,
        orgId,
        siteId,
        key: installationKey,
        displayName: input.installation.displayName,
        mainDeviceType: input.installation.mainDeviceType,
        mainRatingAmps: input.installation.mainRatingAmps,
        mainPhaseCount: input.installation.mainPhaseCount,
        mainGridType: input.installation.mainGridType,
        electricianName: e.name,
        electricianEmail: e.email,
        electricianPhone: e.phone,
        electricianChangedRevision: plan.electricianChanged ? 1 : 0,
        vendorImport: input.vendorImport
          ? { ...importKey(input.vendorImport), metadata: importMetadata(input.vendorImport, now()) }
          : null,
      });
      const { installation, electrician } = split(plan.installationDiff);
      changes.push(row(installationId, { entityType: "installation", entityId: installationId, action: "create", diff: input.vendorImport ? { ...installation, vendorImport: { from: null, to: `${input.vendorImport.package.vendor}:${input.vendorImport.package.site.ref}` } } : installation }));
      if (Object.keys(electrician).length > 0) {
        changes.push(row(installationId, { entityType: "electrician", entityId: installationId, action: "update", diff: electrician }));
      }
    } else {
      installationId = current!.installation.id;
      installationKey = current!.installation.key;
      const bumped = await tx.bumpRevision(installationId, input.expectedRevision!);
      if (bumped === null) throw new SaveError("stale_revision", "This installation was changed by someone else");
      revision = bumped;
      const { installation, electrician } = split(plan.installationDiff);
      if (Object.keys(plan.installationDiff).length > 0) {
        const e = input.electrician;
        await tx.patchInstallation(installationId, {
          displayName: input.installation.displayName,
          mainDeviceType: input.installation.mainDeviceType,
          mainRatingAmps: input.installation.mainRatingAmps,
          mainPhaseCount: input.installation.mainPhaseCount,
          mainGridType: input.installation.mainGridType,
          electricianName: e.name,
          electricianEmail: e.email,
          electricianPhone: e.phone,
          ...(plan.electricianChanged ? { electricianChangedRevision: revision } : {}),
        });
      }
      if (Object.keys(installation).length > 0) {
        changes.push(row(installationId, { entityType: "installation", entityId: installationId, action: "update", diff: installation }));
      }
      if (Object.keys(electrician).length > 0) {
        changes.push(row(installationId, { entityType: "electrician", entityId: installationId, action: "update", diff: electrician }));
      }
    }

    const attached: string[] = [];
    // Vendor references of circuits created by this save, looked up by the client id the plan keeps for each new circuit.
    const vendorRefs = new Map(input.circuits.map((c) => [c.id, c.vendorRef]));
    await applyTree(tx, plan, { installationId, orgId, siteId, newId, changes, row, attached, at: now(), vendorRefs });

    if (passwordChanging) {
      const prior = isCreate ? "unset" : current!.installation.passwordMode;
      const target = input.password.action === "none" ? "none" : "password";
      await tx.setPassword(installationId, target, target === "password" ? verifier : null);
      // States only. Neither the password nor its verifier ever enters a diff.
      changes.push(
        row(installationId, {
          entityType: "password",
          entityId: installationId,
          action: target === "none" ? "clear" : "set",
          diff: { ocppPassword: { from: prior, to: target === "none" ? "none" : "configured" } },
        }),
      );
    }

    if (changes.length === 0) throw new SaveError("validation", "Nothing to save");
    changes[0] = { ...changes[0], idempotencyKey: input.idempotencyKey };
    await tx.insertChanges(changes);

    const snapshot = await tx.loadSnapshot(installationId);
    if (!snapshot) throw new SaveError("unavailable", "Saved installation could not be read back");
    return { snapshot, replayed: false, unchanged: false, generatedPassword: generated, responsibleStatus: responsibleStatus(snapshot.installation), attachedChargePointIds: attached };
  });
}

type ApplyCtx = {
  installationId: string;
  orgId: string;
  siteId: string;
  newId: () => string;
  changes: ChangeRow[];
  row: (installationId: string, body: RowBody) => ChangeRow;
  attached: string[];
  at: Date;
  /** Client circuit id → the vendor's own circuit reference, for circuits that came from a vendor import. */
  vendorRefs: Map<string, string | null>;
};

async function applyTree(tx: TxPort, plan: Plan, ctx: ApplyCtx): Promise<void> {
  const { installationId, orgId, siteId, changes, row } = ctx;
  const circuitIds = new Map<string, string>(); // client id → stored id
  const resolve = (ref: string | null) => (ref === null ? null : (circuitIds.get(ref) ?? ref));

  for (const op of plan.circuits) {
    if (op.kind !== "create") continue;
    const id = ctx.newId();
    circuitIds.set(op.clientId, id);
    const parentId = resolve(op.parentRef);
    await tx.insertCircuit({ id, orgId, siteId, installationId, parentId, displayName: op.displayName, ratingAmps: op.ratingAmps, phaseCount: op.phaseCount, sortOrder: op.sortOrder, vendorRef: ctx.vendorRefs.get(op.clientId) ?? null });
    changes.push(
      row(installationId, {
        entityType: "circuit",
        entityId: id,
        action: "create",
        diff: {
          displayName: { from: null, to: op.displayName },
          ratingAmps: { from: null, to: op.ratingAmps },
          phaseCount: { from: null, to: op.phaseCount },
          parentId: { from: null, to: parentId },
        },
      }),
    );
  }
  // New circuits are known now, so updates may re-parent onto them.
  for (const op of plan.circuits) {
    if (op.kind !== "update") continue;
    const patch = { ...op.patch };
    if ("parentId" in patch) patch.parentId = resolve(patch.parentId ?? null);
    await tx.updateCircuit(op.id, patch);
    if (Object.keys(op.diff).length > 0) {
      const diff = { ...op.diff };
      if (diff.parentId) diff.parentId = { from: diff.parentId.from, to: resolve((diff.parentId.to as string | null) ?? null) };
      changes.push(row(installationId, { entityType: "circuit", entityId: op.id, action: "update", diff }));
    }
  }
  // Chargers: detach and move first, so circuits can be archived after.
  for (const op of plan.chargers) {
    if (op.kind === "detach") {
      const blocked = await tx.detachBlockReason(op.id);
      if (blocked) throw new SaveError("validation", blocked, [{ path: `chargers.${op.id}`, message: blocked }]);
      await tx.detachCharger({ deviceId: op.id, placementId: op.placementId, reason: "removed from installation" });
      changes.push(row(installationId, { entityType: "charger", entityId: op.id, action: "detach", diff: { label: { from: op.before.label, to: null }, circuitId: { from: op.before.circuitId, to: null } } }));
    } else if (op.kind === "move") {
      const to = resolve(op.circuitRef)!;
      await tx.moveCharger({ deviceId: op.id, placementId: op.placementId, orgId, siteId, installationId, circuitId: to, label: op.before.label });
      changes.push(row(installationId, { entityType: "charger", entityId: op.id, action: "move", diff: { circuitId: { from: op.fromCircuitId, to } } }));
    } else if (op.kind === "update") {
      await tx.updateCharger({ deviceId: op.id, placementId: op.before.placementId, orgId, patch: op.patch });
      changes.push(row(installationId, { entityType: "charger", entityId: op.id, action: "update", diff: op.diff }));
    } else {
      const deviceId = ctx.newId();
      const circuitId = resolve(op.circuitRef)!;
      await tx.attachCharger({ deviceId, orgId, siteId, installationId, circuitId, label: op.label, chargePointId: op.chargePointId, vendor: op.vendor, model: op.model, serialNumber: op.serialNumber });
      ctx.attached.push(op.chargePointId);
      // Durable intent, committed or rolled back WITH the attach: the waiting charger must be told, and a lost signal is visible and retried.
      await tx.markPromotion(orgId, op.chargePointId, ctx.at);
      // The same operation whether the id was typed or picked from the incoming list. If this CPO had recorded it knocking,
      // that is part of the audit; the operator's save is the explicit acceptance.
      const knock = await tx.loadDiscovery(orgId, op.chargePointId);
      changes.push(
        row(installationId, {
          entityType: "charger",
          entityId: deviceId,
          action: "create",
          diff: {
            label: { from: null, to: op.label },
            chargePointId: { from: null, to: op.chargePointId },
            circuitId: { from: null, to: circuitId },
            vendor: { from: null, to: op.vendor },
            model: { from: null, to: op.model },
            serialNumber: { from: null, to: op.serialNumber },
            ...(knock ? { acceptedFromIncoming: { from: null, to: discoveryEvidence(knock) } } : {}),
          },
        }),
      );
    }
  }
  for (const op of plan.circuits) {
    if (op.kind !== "archive") continue;
    await tx.archiveCircuit(op.id);
    changes.push(row(installationId, { entityType: "circuit", entityId: op.id, action: "archive", diff: { displayName: { from: op.before.displayName, to: null } } }));
  }
}
