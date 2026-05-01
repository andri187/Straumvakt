// Vendor-credential management — fetches the Zaptec-side hierarchy
// for a credential and cross-references it against our DB to mark
// which chargers are imported. Backs /onboard/credentials/:id/manage.
//
// Apply path runs the operator's selection diff against our DB:
//   • toRemove (imported but unchecked)  → cascade-delete SiteAsset
//   • toAdd    (checked but not imported) → provision new
//                ChargingStation + EVSE + Connector + OcppIdentity
//                under the existing installation, copying the
//                installation-wide auth_secret_hash from a sibling.
//
// Constraints honoured:
//   • Adding requires the parent installation to already exist in
//     our DB (otherwise we don't know which org/site to provision
//     under). Falls into `skipped` with a reason.
//   • Adding requires at least one existing sibling under the same
//     installation so we can copy the auth_secret_hash. Otherwise
//     skipped — operator should use the wizard with a fresh
//     password.
//   • All deletes happen before any adds (cleaner state in case of
//     mid-batch failure).

import type { PrismaClient } from "../generated/prisma/client";
import type {
  CredentialManageTree,
  CredentialInstallationNode,
  CredentialCircuitNode,
  CredentialChargerNode,
  CredentialApplyResult,
} from "@straumvakt/shared/domain/credential-management";
import {
  getChargerDetail,
  getInstallationHierarchy,
  getZaptecAccessToken,
  listChargers,
  listInstallations,
  type ZaptecHierarchyCharger,
  type ZaptecHierarchyCircuit,
} from "../lib/zaptec";
import { openPassword } from "../lib/credential-crypto";
import { recordAuditAction } from "../lib/audit";

interface UnsealedCredential {
  ownerOrgId: string;
  username: string;
  accessToken: string;
}

async function unsealAndAuth(
  db: PrismaClient,
  kek: string,
  credentialId: string,
): Promise<UnsealedCredential> {
  const credential = await db.vendorCredential.findUnique({
    where: { id: credentialId },
    select: {
      ownerOrgId: true,
      username: true,
      passwordCipher: true,
      passwordIv: true,
      vendor: { select: { slug: true } },
    },
  });
  if (!credential) throw new Error("credential_not_found");
  if (credential.vendor.slug !== "zaptec") throw new Error("credential_not_zaptec");
  if (!credential.passwordCipher || !credential.passwordIv) {
    throw new Error("credential_password_missing");
  }
  const password = await openPassword(kek, {
    cipher: credential.passwordCipher,
    iv: credential.passwordIv,
  });
  const tokenResult = await getZaptecAccessToken(credential.username, password);
  if (!tokenResult.ok) throw new Error("zaptec_auth_failed");
  return {
    ownerOrgId: credential.ownerOrgId,
    username: credential.username,
    accessToken: tokenResult.value,
  };
}

export async function getCredentialManagementTree(
  db: PrismaClient,
  kek: string | undefined,
  credentialId: string,
): Promise<CredentialManageTree> {
  if (!kek) throw new Error("kek_unavailable");
  const auth = await unsealAndAuth(db, kek, credentialId);
  return buildTreeFromAuth(db, auth, credentialId);
}

// Tree build, extracted so the apply path can share one Zaptec OAuth
// grant. Zaptec's OAuth endpoint blocks back-to-back token requests
// from the same client (likely a per-client throttle) — a fresh grant
// during the GET followed by another during the POST returns
// invalid_grant on the second call. Always auth once per request.
async function buildTreeFromAuth(
  db: PrismaClient,
  auth: UnsealedCredential,
  credentialId: string,
): Promise<CredentialManageTree> {
  // Fetch Zaptec installations + their hierarchies + bulk online list
  // in parallel — one auth, three concurrent calls.
  const [installationsResult, bulkChargersResult] = await Promise.all([
    listInstallations(auth.accessToken),
    listChargers(auth.accessToken),
  ]);
  if (!installationsResult.ok) throw new Error("zaptec_list_installations_failed");
  if (!bulkChargersResult.ok) throw new Error("zaptec_list_chargers_failed");
  const isOnlineByZaptecId = new Map<string, boolean>();
  for (const ch of bulkChargersResult.value) {
    if (ch.Id && typeof ch.IsOnline === "boolean") {
      isOnlineByZaptecId.set(ch.Id, ch.IsOnline);
    }
  }

  const zaptecInstallations = installationsResult.value.filter(
    (i): i is { Id: string; Name?: string } & typeof i => typeof i.Id === "string",
  );
  const hierarchies = await Promise.all(
    zaptecInstallations.map(async (i) => {
      const r = await getInstallationHierarchy(auth.accessToken, i.Id);
      return { id: i.Id, hierarchy: r.ok ? r.value : null };
    }),
  );
  const hierarchyById = new Map(hierarchies.map((h) => [h.id, h.hierarchy]));

  // Lifetime kWh enrichment — pull SignedMeterValueKwh from the
  // per-charger detail endpoint for every charger in the tree
  // (including decommissioned ones; that's the whole point — the
  // operator wants to see how much energy was delivered before
  // deciding whether to remove it). One parallel fan-out keeps the
  // page responsive even with 50+ chargers.
  const allZaptecChargerIds = new Set<string>();
  for (const h of hierarchies) {
    for (const cc of h.hierarchy?.Circuits ?? []) {
      for (const ch of cc.Chargers ?? []) {
        if (typeof ch.Id === "string") allZaptecChargerIds.add(ch.Id);
      }
    }
  }
  const lifetimeKWhById = new Map<string, number | null>();
  await Promise.all(
    Array.from(allZaptecChargerIds).map(async (id) => {
      const r = await getChargerDetail(auth.accessToken, id);
      const kwh =
        r.ok && r.value && typeof r.value.SignedMeterValueKwh === "number"
          ? (r.value.SignedMeterValueKwh as number)
          : null;
      lifetimeKWhById.set(id, kwh);
    }),
  );

  // Pull our DB state — every OcppIdentity matched to this credential's
  // chargers. Installation match = vendor_installation_ref equals the
  // Zaptec installation Id; OR credentials_id FK equals our credential.
  const ourInstallations = await db.installation.findMany({
    where: {
      OR: [
        { credentialsId: credentialId },
        {
          orgId: auth.ownerOrgId,
          credentialsRef: auth.username,
        },
      ],
    },
    select: { id: true, vendorInstallationRef: true },
  });
  const ourInstByZaptecRef = new Map<string, string>();
  for (const i of ourInstallations) {
    if (i.vendorInstallationRef) ourInstByZaptecRef.set(i.vendorInstallationRef, i.id);
  }

  const ourIdentities = await db.ocppIdentity.findMany({
    where: {
      vendor: "Zaptec",
      vendorResourceId: { not: null },
      orgId: auth.ownerOrgId,
    },
    select: { vendorResourceId: true, chargingStationId: true },
  });
  const ourStationByZaptecId = new Map<string, string>();
  for (const id of ourIdentities) {
    if (id.vendorResourceId) ourStationByZaptecId.set(id.vendorResourceId, id.chargingStationId);
  }

  const installations: CredentialInstallationNode[] = zaptecInstallations.map((inst) => {
    const h = hierarchyById.get(inst.Id);
    const ourInstId = ourInstByZaptecRef.get(inst.Id) ?? null;
    const circuits: CredentialCircuitNode[] = (h?.Circuits ?? [])
      .filter(
        (cc): cc is ZaptecHierarchyCircuit & { Id: string } => typeof cc.Id === "string",
      )
      .map((cc) => ({
        zaptecId: cc.Id,
        name: cc.Name ?? "(unnamed circuit)",
        maxCurrent: cc.MaxCurrent ?? null,
        chargers: (cc.Chargers ?? [])
          .filter(
            (ch): ch is ZaptecHierarchyCharger & { Id: string } => typeof ch.Id === "string",
          )
          .map<CredentialChargerNode>((ch) => {
            const ourStationId = ourStationByZaptecId.get(ch.Id) ?? null;
            return {
              zaptecId: ch.Id,
              deviceId: ch.DeviceId ?? null,
              serialNo: ch.SerialNo ?? null,
              name: ch.Name ?? "(unnamed)",
              active: ch.Active === true,
              isOnline: isOnlineByZaptecId.get(ch.Id) === true,
              imported: ourStationId != null,
              chargingStationId: ourStationId,
              lifetimeEnergyKWh: lifetimeKWhById.get(ch.Id) ?? null,
            };
          }),
      }));
    return {
      zaptecId: inst.Id,
      name: inst.Name ?? "(unnamed installation)",
      imported: ourInstId != null,
      installationId: ourInstId,
      circuits,
    };
  });

  // Imported installations float to the top — that's where the
  // operator can take action. Unimported (wizard-required) sink below.
  installations.sort((a, b) => Number(b.imported) - Number(a.imported));

  return {
    credentialId,
    credentialUsername: auth.username,
    installations,
  };
}

export async function applyCredentialSelection(
  db: PrismaClient,
  kek: string | undefined,
  credentialId: string,
  selectedZaptecIds: string[],
): Promise<CredentialApplyResult> {
  if (!kek) throw new Error("kek_unavailable");
  // One auth for the whole request — Zaptec OAuth doesn't tolerate
  // back-to-back grants. Reuse the same accessToken for the tree
  // refetch and any add-path lookups.
  const auth = await unsealAndAuth(db, kek, credentialId);
  const tree = await buildTreeFromAuth(db, auth, credentialId);

  const selected = new Set(selectedZaptecIds);
  const allInTree: CredentialChargerNode[] = tree.installations.flatMap((i) =>
    i.circuits.flatMap((c) => c.chargers),
  );
  const importedNow = new Set(allInTree.filter((c) => c.imported).map((c) => c.zaptecId));
  const allInTreeIds = new Set(allInTree.map((c) => c.zaptecId));

  // Diff
  const toRemove: CredentialChargerNode[] = [];
  const toAdd: CredentialChargerNode[] = [];
  for (const ch of allInTree) {
    const want = selected.has(ch.zaptecId);
    const have = importedNow.has(ch.zaptecId);
    if (have && !want) toRemove.push(ch);
    if (!have && want) toAdd.push(ch);
  }

  const result: CredentialApplyResult = {
    added: 0,
    removed: 0,
    failed: [],
    skipped: [],
  };

  // Selections referencing chargers Zaptec doesn't return (e.g. operator
  // selected something that's since been removed in Zaptec) — skip.
  for (const id of selected) {
    if (!allInTreeIds.has(id) && !importedNow.has(id)) {
      result.skipped.push({ zaptecId: id, reason: "not in zaptec hierarchy" });
    }
  }

  // 1) Removes — cascade-delete each SiteAsset. Schema FKs cascade to
  //    ChargingStation, EVSE, Connector, OcppIdentity.
  for (const ch of toRemove) {
    if (!ch.chargingStationId) {
      result.failed.push({ zaptecId: ch.zaptecId, reason: "no charging_station_id" });
      continue;
    }
    try {
      await db.siteAsset.delete({ where: { id: ch.chargingStationId } });
      result.removed++;
    } catch (err) {
      result.failed.push({
        zaptecId: ch.zaptecId,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (toAdd.length === 0) return result;

  // 2) Adds — group by their parent Zaptec installation, then process
  //    only the ones whose installation we already have provisioned.
  //    For each add we need:
  //      • our installation row (looked up by vendor_installation_ref)
  //      • our circuit row (looked up by vendor_circuit_ref); create if missing
  //      • the existing installation-wide auth_secret_hash (copied from
  //        a sibling charger) — without one we can't provision because
  //        we have no way to know what password Zaptec is sending.
  const stationVendorByZaptecId = new Map<string, { authSecretHash: string }>();
  // Collect siblings per installation in one query.
  const siblings = await db.ocppIdentity.findMany({
    where: { vendor: "Zaptec", orgId: auth.ownerOrgId },
    select: {
      authSecretHash: true,
      chargingStation: { select: { installationId: true } },
    },
  });
  const hashByOurInstallationId = new Map<string, string>();
  for (const s of siblings) {
    const instId = s.chargingStation?.installationId;
    if (instId && !hashByOurInstallationId.has(instId)) {
      hashByOurInstallationId.set(instId, s.authSecretHash);
    }
  }

  // Map Zaptec circuit Id → our circuit row, scoped per installation.
  const ourCircuits = await db.circuit.findMany({
    where: { orgId: auth.ownerOrgId },
    select: {
      id: true,
      installationId: true,
      vendorCircuitRef: true,
      siteId: true,
    },
  });
  const ourCircuitByVendorRef = new Map<string, (typeof ourCircuits)[number]>();
  for (const c of ourCircuits) {
    if (c.vendorCircuitRef) ourCircuitByVendorRef.set(c.vendorCircuitRef, c);
  }

  // Need installation details for siteId + orgId; fetch in one batch.
  const ourInstDetails = await db.installation.findMany({
    where: { id: { in: Array.from(hashByOurInstallationId.keys()) } },
    select: { id: true, orgId: true, siteId: true },
  });
  const ourInstDetailById = new Map(ourInstDetails.map((i) => [i.id, i]));

  for (const ch of toAdd) {
    const tree2Inst = tree.installations.find((i) =>
      i.circuits.some((c) => c.chargers.some((g) => g.zaptecId === ch.zaptecId)),
    );
    if (!tree2Inst) {
      result.failed.push({ zaptecId: ch.zaptecId, reason: "installation lookup failed" });
      continue;
    }
    if (!tree2Inst.installationId) {
      result.skipped.push({
        zaptecId: ch.zaptecId,
        reason: "parent installation not imported — use the Zaptec wizard",
      });
      continue;
    }
    const ourInst = ourInstDetailById.get(tree2Inst.installationId);
    if (!ourInst) {
      result.failed.push({ zaptecId: ch.zaptecId, reason: "installation row missing" });
      continue;
    }
    const installHash = hashByOurInstallationId.get(tree2Inst.installationId);
    if (!installHash) {
      result.skipped.push({
        zaptecId: ch.zaptecId,
        reason: "no sibling charger to copy auth_secret_hash from — re-onboard via wizard",
      });
      continue;
    }
    // Find which Zaptec circuit this charger belongs to in the tree.
    const tree2Circuit = tree2Inst.circuits.find((c) =>
      c.chargers.some((g) => g.zaptecId === ch.zaptecId),
    );
    if (!tree2Circuit) {
      result.failed.push({ zaptecId: ch.zaptecId, reason: "circuit lookup failed" });
      continue;
    }
    let ourCircuit = ourCircuitByVendorRef.get(tree2Circuit.zaptecId);
    try {
      // If the Zaptec circuit isn't in our DB yet, create it under
      // this installation. Mirrors the wizard's circuit-creation path.
      if (!ourCircuit) {
        const newCircuit = await db.circuit.create({
          data: {
            orgId: ourInst.orgId,
            siteId: ourInst.siteId,
            installationId: ourInst.id,
            displayName: tree2Circuit.name,
            ampereCeiling: tree2Circuit.maxCurrent ?? undefined,
            phaseCount: 3,
            vendorCircuitRef: tree2Circuit.zaptecId,
          },
          select: {
            id: true,
            installationId: true,
            vendorCircuitRef: true,
            siteId: true,
          },
        });
        ourCircuitByVendorRef.set(tree2Circuit.zaptecId, newCircuit);
        ourCircuit = newCircuit;
      }
      // Provision the charger: SiteAsset + ChargingStation + EVSE +
      // Connector + OcppIdentity, all in one tx. Identity-string =
      // lower(DeviceId), serial = upper(DeviceId), auth hash = sibling's.
      const deviceId = ch.deviceId ?? ch.zaptecId;
      const identityString = deviceId.toLowerCase().slice(0, 64);
      const canonicalSerial = deviceId.toUpperCase().slice(0, 64);
      await db.$transaction(
        async (tx) => {
          const siteAsset = await tx.siteAsset.create({
            data: {
              orgId: ourInst.orgId,
              siteId: ourInst.siteId,
              kind: "charger",
              displayName: ch.name,
            },
            select: { id: true },
          });
          await tx.chargingStation.create({
            data: {
              siteAssetId: siteAsset.id,
              orgId: ourInst.orgId,
              installationId: ourInst.id,
              circuitId: ourCircuit!.id,
              vendor: "Zaptec",
              serialNumber: canonicalSerial,
            },
          });
          const evse = await tx.eVSE.create({
            data: { orgId: ourInst.orgId, chargingStationId: siteAsset.id, evseIndex: 1 },
            select: { id: true },
          });
          await tx.connector.create({
            data: {
              orgId: ourInst.orgId,
              evseId: evse.id,
              connectorIndex: 1,
              type: "Type2",
            },
          });
          await tx.ocppIdentity.create({
            data: {
              orgId: ourInst.orgId,
              chargingStationId: siteAsset.id,
              identityString,
              authSecretHash: installHash,
              ocppVersion: "ocpp_1_6",
              assetClass: "ac",
              vendor: "Zaptec",
              vendorResourceId: ch.zaptecId,
            },
          });
          await tx.pendingDiscovery.deleteMany({
            where: { identityString: { equals: identityString, mode: "insensitive" } },
          });
        },
        { timeout: 60_000, maxWait: 30_000 },
      );
      result.added++;
    } catch (err) {
      result.failed.push({
        zaptecId: ch.zaptecId,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  await recordAuditAction(db, {
    orgId: auth.ownerOrgId,
    actorUserId: null,
    actorKind: "user",
    action: "credential.manage_apply",
    targetType: "vendor_credential",
    targetId: credentialId,
    metadata: {
      added: result.added,
      removed: result.removed,
      failed: result.failed.length,
      skipped: result.skipped.length,
    },
  });

  return result;
}
