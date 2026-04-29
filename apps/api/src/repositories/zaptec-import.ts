// Zaptec installation import — provisions Property + Site + Installation
// + (ChargingStation + EVSE + Connector + OcppIdentity per charger) in
// one transaction. Operator picks the org; address comes from Zaptec.
//
// Each OCPP identity gets a freshly-generated 32-byte hex Basic-Auth
// password — returned to the operator exactly once in the response,
// hashed (SHA-256) before storage. Operator is responsible for re-
// flashing each Zaptec charger to point at our gateway with the
// corresponding password.

import type { PrismaClient } from "../generated/prisma/client";
import type { ZaptecImportInput } from "@straumvakt/shared/inputs/zaptec-import";
import type { ZaptecImportResult, ZaptecImportedCharger } from "@straumvakt/shared/domain/zaptec-import";
import { sha256Hex } from "../lib/sha256";
import { recordAuditAction } from "../lib/audit";
import {
  getInstallationHierarchy,
  getInstallationSummary,
  getZaptecAccessToken,
} from "../lib/zaptec";

type ZaptecHierarchyChargerLite = {
  Id?: string;
  Name?: string | null;
  SerialNo?: string | null;
  DeviceId?: string | null;
};

function generatePassword(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, "0");
  return hex;
}

/**
 * Pick the OCPP identity-string for a Zaptec charger. Preference order:
 *   1. SerialNo  — typically "ZAP123456", what's on the physical sticker.
 *   2. DeviceId  — Zaptec internal id, fallback when SerialNo is null.
 *   3. Zaptec UUID — last-resort, ugly but unique.
 * Trim to 64 chars to match the OcppIdentity column constraint.
 */
function pickIdentityString(c: { id: string; serialNo: string | null; deviceId: string | null }): string {
  const candidate = c.serialNo ?? c.deviceId ?? c.id;
  return candidate.slice(0, 64);
}

function buildPropertyAddress(s: {
  Address?: string;
  City?: string;
  ZipCode?: string;
}): unknown {
  if (!s.Address && !s.City && !s.ZipCode) return {};
  return {
    street: s.Address ?? null,
    city: s.City ?? null,
    postal_code: s.ZipCode ?? null,
    country: "IS",
  };
}

export async function importZaptecInstallation(
  db: PrismaClient,
  input: ZaptecImportInput,
): Promise<ZaptecImportResult> {
  // 1) Re-auth + re-fetch the Zaptec installation hierarchy server-side.
  //    We don't trust client-supplied charger lists — operator's session
  //    cookie is the only trust anchor; everything else must be re-verified.
  const tokenResult = await getZaptecAccessToken(input.username, input.password);
  if (!tokenResult.ok) {
    if (tokenResult.error.kind === "invalid_credentials") {
      throw new Error("invalid_credentials");
    }
    throw new Error(`zaptec_${tokenResult.error.kind}`);
  }
  const accessToken = tokenResult.value;

  const summary = await getInstallationSummary(accessToken, input.zaptecInstallationId);
  if (!summary.ok || !summary.value) {
    throw new Error("installation_not_accessible");
  }
  const hierarchy = await getInstallationHierarchy(accessToken, input.zaptecInstallationId);
  if (!hierarchy.ok) throw new Error(`zaptec_${hierarchy.error.kind}`);

  // 2) Look up Zaptec vendor row + verify org. Outside the tx so failures
  //    surface as 4xx without leaving partial state.
  const [vendor, org] = await Promise.all([
    db.hardwareVendor.findUnique({ where: { slug: "zaptec" }, select: { id: true } }),
    db.organization.findUnique({ where: { id: input.orgId }, select: { id: true } }),
  ]);
  if (!vendor) throw new Error("vendor_zaptec_missing");
  if (!org) throw new Error("org_not_found");

  // 3) Build the circuit + charger graph. Each Zaptec circuit becomes
  //    a Straumvakt Circuit (vendorCircuitRef = Zaptec circuit id);
  //    each charger under it links to that Circuit via
  //    ChargingStation.circuitId. Operator can later delete circuits to
  //    cascade-drop their chargers (see deleteCircuit).
  const zaptecCircuits = (hierarchy.value?.Circuits ?? [])
    .filter((cc): cc is { Id: string; Name?: string | null; MaxCurrent?: number; Chargers?: ZaptecHierarchyChargerLite[] | null } =>
      typeof cc.Id === "string",
    )
    .map((cc) => ({
      id: cc.Id,
      name: cc.Name ?? "(unnamed circuit)",
      maxCurrent: cc.MaxCurrent ?? null,
      chargers: (cc.Chargers ?? [])
        .filter((ch): ch is { Id: string; Name?: string | null; SerialNo?: string | null; DeviceId?: string | null } =>
          typeof ch.Id === "string",
        )
        .map((ch) => ({
          id: ch.Id,
          name: ch.Name ?? "(unnamed)",
          serialNo: ch.SerialNo ?? null,
          deviceId: ch.DeviceId ?? null,
        })),
    }));

  // Flatten for password gen (we still pre-compute all passwords up-front).
  const flatChargers = zaptecCircuits.flatMap((cc) =>
    cc.chargers.map((ch) => ({ ...ch, zaptecCircuitId: cc.id })),
  );

  // 4) Pre-generate passwords + hashes outside the tx.
  const chargerSecrets = await Promise.all(
    flatChargers.map(async (ch) => ({
      ...ch,
      identityString: pickIdentityString(ch),
      password: generatePassword(),
    })),
  );
  const chargerHashes = await Promise.all(
    chargerSecrets.map((ch) => sha256Hex(ch.password).then((hash) => ({ ...ch, hash }))),
  );

  // 5) Multi-table tx.
  //
  // Per-charger we make 6 round trips (siteAsset, chargingStation, eVSE,
  // connector, ocppIdentity, pendingDiscovery.deleteMany). Hyperdrive +
  // Neon round-trip latency lands us around 50–80ms each, so ten chargers
  // is well past Prisma's default 5-second interactive-tx timeout. Bump
  // to 60s + a 30s max-wait to claim a connection. If we ever import
  // installations with hundreds of chargers, switch to createMany +
  // pre-allocated UUIDs to drop round-trip count.
  const result = await db.$transaction(
    async (tx) => {
    const property = await tx.property.create({
      data: {
        orgId: org.id,
        displayName: input.propertyDisplayName,
        address: buildPropertyAddress(summary.value!) as object,
      },
      select: { id: true },
    });

    const site = await tx.site.create({
      data: {
        orgId: org.id,
        propertyId: property.id,
        displayName: input.siteDisplayName,
        timezone: summary.value!.TimeZoneIanaName ?? "Atlantic/Reykjavik",
        siteType: "standard",
      },
      select: { id: true },
    });

    const installation = await tx.installation.create({
      data: {
        orgId: org.id,
        siteId: site.id,
        vendorId: vendor.id,
        displayName: summary.value!.Name ?? "Zaptec installation",
        vendorInstallationRef: input.zaptecInstallationId,
        // credentials_ref placeholder — store the username so operator can
        // re-auth later; password is not persisted. A proper refresh-token
        // store comes with the credential-vault milestone.
        credentialsRef: input.username,
        credentialsStatus: "imported",
        onboardingStatus: "active",
      },
      select: { id: true },
    });

    // Mirror Zaptec's circuit hierarchy as Straumvakt circuits, keyed
    // by vendorCircuitRef so future re-imports / sync flows can match
    // them. Build a Zaptec-circuit-id → Straumvakt-circuit-id map for
    // the charger-create loop below.
    const circuitIdByZaptec = new Map<string, string>();
    for (const cc of zaptecCircuits) {
      const created = await tx.circuit.create({
        data: {
          orgId: org.id,
          siteId: site.id,
          installationId: installation.id,
          displayName: cc.name,
          ampereCeiling: cc.maxCurrent ?? undefined,
          phaseCount: 3,
          vendorCircuitRef: cc.id,
        },
        select: { id: true },
      });
      circuitIdByZaptec.set(cc.id, created.id);
    }

    const importedChargers: ZaptecImportedCharger[] = [];
    for (const ch of chargerHashes) {
      const siteAsset = await tx.siteAsset.create({
        data: {
          orgId: org.id,
          siteId: site.id,
          kind: "charger",
          displayName: ch.name,
        },
        select: { id: true },
      });

      await tx.chargingStation.create({
        data: {
          siteAssetId: siteAsset.id,
          orgId: org.id,
          installationId: installation.id,
          circuitId: circuitIdByZaptec.get(ch.zaptecCircuitId) ?? null,
          vendor: "Zaptec",
          serialNumber: ch.serialNo,
        },
      });

      const evse = await tx.eVSE.create({
        data: { orgId: org.id, chargingStationId: siteAsset.id, evseIndex: 1 },
        select: { id: true },
      });

      await tx.connector.create({
        data: {
          orgId: org.id,
          evseId: evse.id,
          connectorIndex: 1,
          type: "Type2",
        },
      });

      const identity = await tx.ocppIdentity.create({
        data: {
          orgId: org.id,
          chargingStationId: siteAsset.id,
          identityString: ch.identityString,
          authSecretHash: ch.hash,
          ocppVersion: "ocpp_1_6",
          assetClass: "ac",
          vendor: "Zaptec",
          vendorResourceId: ch.id,
        },
        select: { id: true },
      });

      // Loop closure: if a Zaptec charger we just imported was already
      // hitting the gateway (with the matching identity_string), drop
      // its pending discovery row.
      await tx.pendingDiscovery.deleteMany({
        where: { identityString: ch.identityString },
      });

      importedChargers.push({
        chargingStationId: siteAsset.id,
        ocppIdentityId: identity.id,
        identityString: ch.identityString,
        ocppPassword: ch.password,
        displayName: ch.name,
        serialNo: ch.serialNo,
      });
    }

    return {
      orgId: org.id,
      propertyId: property.id,
      siteId: site.id,
      installationId: installation.id,
      chargers: importedChargers,
    };
    },
    { timeout: 60_000, maxWait: 30_000 },
  );

  await recordAuditAction(db, {
    orgId: org.id,
    actorUserId: null,
    actorKind: "user",
    action: "zaptec.import",
    targetType: "installation",
    targetId: result.installationId,
    metadata: {
      zaptecInstallationId: input.zaptecInstallationId,
      chargerCount: result.chargers.length,
    },
  });

  return {
    ...result,
    zaptecInstallationId: input.zaptecInstallationId,
  };
}
