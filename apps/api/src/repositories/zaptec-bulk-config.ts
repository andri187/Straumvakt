// Bulk-write Zaptec OCPP config (currently: AuthenticationRequired)
// across a tree scope. Used by the operator's per-tree-row toggle on
// /sites — flip auth-required at site/installation/circuit/charger
// level and the change cascades down to every Zaptec-vendor charger
// under that node.
//
// Resolves the scope to charging_station_ids in our DB, joins to
// OcppIdentity.vendor_resource_id (Zaptec UUID), then unseals the
// org's active Zaptec credential and POSTs /api/chargers/{id}/update
// with the new value in parallel. Returns per-charger outcomes so
// the UI can flash a count + list any failures.
//
// Same OCPP-handler-semantics caveat as elsewhere: writes the same
// flag the operator could flip in the Zaptec portal manually. We're
// just bulk-applying it. No billing/access semantics, fully
// reversible by toggling back.

import type { PrismaClient } from "../generated/prisma/client";
import { getZaptecAccessToken, updateChargerSettings } from "../lib/zaptec";
import { openPassword } from "../lib/credential-crypto";

export type BulkScope =
  | { kind: "site"; siteId: string }
  | { kind: "installation"; installationId: string }
  | { kind: "circuit"; circuitId: string }
  | { kind: "charger"; chargingStationId: string };

export interface BulkAuthRequiredResult {
  scope: BulkScope;
  enabled: boolean;
  attempted: number;
  updated: number;
  failed: { chargingStationId: string; identityString: string | null; reason: string }[];
  /** Chargers in scope that aren't Zaptec / have no vendor_resource_id — skipped. */
  skippedNonZaptec: number;
}

interface CandidateRow {
  chargingStationId: string;
  orgId: string;
  identityString: string;
  vendorResourceId: string | null;
  vendor: string | null;
}

async function findChargersInScope(
  db: PrismaClient,
  scope: BulkScope,
): Promise<CandidateRow[]> {
  // Build a where on charging_stations matching the scope.
  const stationWhere: Record<string, unknown> =
    scope.kind === "charger"
      ? { siteAssetId: scope.chargingStationId }
      : scope.kind === "circuit"
        ? { circuitId: scope.circuitId }
        : scope.kind === "installation"
          ? { installationId: scope.installationId }
          : { siteAsset: { siteId: scope.siteId } };

  const stations = await db.chargingStation.findMany({
    where: stationWhere,
    select: {
      siteAssetId: true,
      orgId: true,
      ocppIdentities: {
        take: 1,
        orderBy: { createdAt: "asc" },
        select: { identityString: true, vendorResourceId: true, vendor: true },
      },
    },
  });

  return stations.map((s) => ({
    chargingStationId: s.siteAssetId,
    orgId: s.orgId,
    identityString: s.ocppIdentities[0]?.identityString ?? "",
    vendorResourceId: s.ocppIdentities[0]?.vendorResourceId ?? null,
    vendor: s.ocppIdentities[0]?.vendor ?? null,
  }));
}

export async function setZaptecAuthRequired(
  db: PrismaClient,
  kek: string | undefined,
  scope: BulkScope,
  enabled: boolean,
): Promise<BulkAuthRequiredResult> {
  if (!kek) {
    throw new Error("kek_unavailable");
  }
  const candidates = await findChargersInScope(db, scope);
  const zaptec = candidates.filter((c) => c.vendor === "Zaptec" && c.vendorResourceId);
  const skippedNonZaptec = candidates.length - zaptec.length;

  if (zaptec.length === 0) {
    return {
      scope,
      enabled,
      attempted: 0,
      updated: 0,
      failed: [],
      skippedNonZaptec,
    };
  }

  // All candidates in this scope share an org for Zaptec installations
  // (the import always uses one org). If we ever support cross-org
  // scopes we'd group by orgId here — for now grab the first.
  const orgId = zaptec[0].orgId;

  const credential = await db.vendorCredential.findFirst({
    where: { ownerOrgId: orgId, status: "active", vendor: { slug: "zaptec" } },
    select: { username: true, passwordCipher: true, passwordIv: true },
    orderBy: { lastUsedAt: "desc" },
  });
  if (!credential || !credential.passwordCipher || !credential.passwordIv) {
    throw new Error("zaptec_credential_missing");
  }
  const password = await openPassword(kek, {
    cipher: credential.passwordCipher,
    iv: credential.passwordIv,
  });
  const tokenResult = await getZaptecAccessToken(credential.username, password);
  if (!tokenResult.ok) throw new Error("zaptec_auth_failed");
  const accessToken = tokenResult.value;

  // StateId 120 = AuthenticationRequired (writable per Zaptec docs §13.16).
  const body = { "120": enabled ? "true" : "false" };

  const results = await Promise.all(
    zaptec.map(async (c) => {
      const r = await updateChargerSettings(accessToken, c.vendorResourceId!, body);
      if (r.ok) {
        return { ok: true as const, c };
      }
      return {
        ok: false as const,
        c,
        reason:
          r.error.kind === "unreachable"
            ? "zaptec_unreachable"
            : r.error.kind === "list"
              ? `zaptec_${r.error.status}`
              : r.error.kind,
      };
    }),
  );

  const failed = results
    .filter((r): r is { ok: false; c: CandidateRow; reason: string } => !r.ok)
    .map((r) => ({
      chargingStationId: r.c.chargingStationId,
      identityString: r.c.identityString || null,
      reason: r.reason,
    }));

  return {
    scope,
    enabled,
    attempted: zaptec.length,
    updated: zaptec.length - failed.length,
    failed,
    skippedNonZaptec,
  };
}
