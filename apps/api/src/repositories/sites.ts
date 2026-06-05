import type { PrismaClient, Prisma } from "../generated/prisma/client";
import type { OrgScope } from "../lib/auth/org-scope";
import type { SiteSummary } from "@straumvakt/shared/domain/sites";
import type { SiteCreateInput, SiteUpdateInput } from "@straumvakt/shared/inputs/sites";
import { recordAuditAction } from "../lib/audit";

const include = {
  organization: { select: { displayName: true } },
  property: { select: { displayName: true } },
} as const;

type Row = {
  id: string;
  orgId: string;
  organization: { displayName: string };
  propertyId: string;
  property: { displayName: string };
  displayName: string;
  timezone: string;
  siteType: string;
  accessLevel: string;
  powerClass: string | null;
  provisioningStatus: string;
  dsoTariffId: string | null;
  usrfTariffId: string | null;
  usrfPremTariffId: string | null;
  xtrrfTariffId: string | null;
  spvivfTariffId: string | null;
  openingHours: unknown;
  accessNote: string | null;
  photoUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function toSummary(r: Row): SiteSummary {
  return {
    id: r.id,
    orgId: r.orgId,
    orgDisplayName: r.organization.displayName,
    propertyId: r.propertyId,
    propertyDisplayName: r.property.displayName,
    displayName: r.displayName,
    timezone: r.timezone,
    siteType: r.siteType,
    accessLevel: r.accessLevel,
    powerClass: r.powerClass,
    provisioningStatus: r.provisioningStatus,
    dsoTariffId: r.dsoTariffId,
    usrfTariffId: r.usrfTariffId,
    usrfPremTariffId: r.usrfPremTariffId,
    xtrrfTariffId: r.xtrrfTariffId,
    spvivfTariffId: r.spvivfTariffId,
    openingHours: r.openingHours,
    accessNote: r.accessNote,
    photoUrl: r.photoUrl,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export async function listAllSites(
  db: PrismaClient,
  orgScope?: OrgScope,
): Promise<SiteSummary[]> {
  const rows = await db.site.findMany({
    where: orgScope && orgScope.all === false ? { orgId: { in: orgScope.orgIds } } : undefined,
    orderBy: [{ updatedAt: "desc" }],
    include,
  });
  return rows.map(toSummary);
}

export async function listSitesByOrg(
  db: PrismaClient,
  orgId: string,
): Promise<SiteSummary[]> {
  const rows = await db.site.findMany({
    where: { orgId },
    orderBy: [{ displayName: "asc" }],
    include,
  });
  return rows.map(toSummary);
}

export async function getSiteById(
  db: PrismaClient,
  id: string,
  orgScope?: OrgScope,
): Promise<SiteSummary | null> {
  const r = await db.site.findUnique({ where: { id }, include });
  if (!r) return null;
  if (orgScope && orgScope.all === false && !orgScope.orgIds.includes(r.orgId)) return null;
  return toSummary(r);
}

export async function createSite(
  db: PrismaClient,
  input: SiteCreateInput,
): Promise<SiteSummary> {
  const created = await db.site.create({
    data: {
      orgId: input.orgId,
      propertyId: input.propertyId,
      displayName: input.displayName,
      timezone: input.timezone,
      siteType: input.siteType,
      accessLevel: input.accessLevel,
      powerClass: input.powerClass,
    },
    include,
  });
  return toSummary(created);
}

export async function updateSite(
  db: PrismaClient,
  id: string,
  patch: SiteUpdateInput,
): Promise<SiteSummary> {
  const data: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    data[k] = v;
  }
  const updated = await db.site.update({ where: { id }, data, include });
  return toSummary(updated);
}

/**
 * Cascade-delete a site and everything physically anchored under it:
 * chargers (SiteAsset+ChargingStation+EVSE+Connector+OcppIdentity),
 * circuits, installations. Schema cascades take care of:
 *   - SiteAsset → ChargingStation (Cascade)
 *   - ChargingStation → OcppIdentity (Cascade)
 *   - Site → Installation (Cascade)
 *   - Site → Circuit (Cascade)
 * We explicitly delete SiteAssets first to make the chain reach
 * EVSE/Connector/OcppIdentity in a defined order, then let the
 * remaining schema cascades fire when we delete the site itself.
 *
 * Operator semantics: deleting a site removes ALL physical and
 * logical infrastructure underneath. There is no recovery; this is
 * intentional per the operator's stated cascade rule.
 */
export async function deleteSite(db: PrismaClient, id: string): Promise<void> {
  await db.$transaction(
    async (tx) => {
      // SiteAssets (which back ChargingStations) — let the FK cascade
      // wipe the rest of the physical chain.
      await tx.siteAsset.deleteMany({ where: { siteId: id } });
      // Site delete cascades to Installation + Circuit via schema FKs.
      await tx.site.delete({ where: { id } });
    },
    { timeout: 60_000, maxWait: 30_000 },
  );
}

export interface MoveSiteResult {
  siteId: string;
  fromOrgId: string;
  toOrgId: string;
  newPropertyId: string;
  // Counts of rows whose org_id was updated.
  affected: {
    installations: number;
    circuits: number;
    siteAssets: number;
    chargingStations: number;
    evses: number;
    connectors: number;
    ocppIdentities: number;
    chargeSessions: number;
    meterValues: number;
    reservations: number;
    vendorAssetRefs: number;
    externalCpmsRefs: number;
    capabilityProfiles: number;
    controlRoutingPolicies: number;
  };
  // What was nulled out (cross-org references that no longer apply).
  cleared: {
    siteTariffs: boolean;
    installationCredentials: number;
    installationRetailerTariffs: number;
    /** True when the source-org Property had no remaining sites and
     *  was auto-deleted as part of the move (Sprint 8.14). */
    sourcePropertyDeleted: boolean;
  };
}

/**
 * Move a Site (and everything physically + logically under it) to a
 * different organization. Tenancy invariant: every row in the subtree
 * shares an org_id; this function updates them all atomically.
 *
 * Auto-creates a property in the target org mirroring the source
 * property's displayName + address so the site has a valid parent in
 * the new tenant. Operator can rename / merge properties afterwards.
 *
 * NULLs out cross-org references (tariff anchors, vendor credentials)
 * because they belong to the source org's catalogue. Operator
 * re-links them in the target org.
 *
 * What does NOT move: Memberships, VendorCredentials, Contracts,
 * DriverContracts, CostCenters, Tariff catalogue rows. Those are
 * tenant-owned in the original org and stay there.
 */
export async function moveSiteToOrg(
  db: PrismaClient,
  siteId: string,
  targetOrgId: string,
  actorUserId: string | null,
): Promise<MoveSiteResult> {
  return db.$transaction(
    async (tx) => {
      const site = await tx.site.findUnique({
        where: { id: siteId },
        include: {
          property: true,
        },
      });
      if (!site) throw new Error("site_not_found");

      const fromOrgId = site.orgId;
      if (fromOrgId === targetOrgId) {
        throw new Error("already_in_target_org");
      }

      const targetOrg = await tx.organization.findUnique({
        where: { id: targetOrgId },
        select: { id: true },
      });
      if (!targetOrg) throw new Error("target_org_not_found");

      // Auto-create a mirror property in target org. Always create
      // fresh — picking an existing property would require operator
      // input. Mirror keeps the location data intact; operator can
      // merge/rename later.
      const newProperty = await tx.property.create({
        data: {
          orgId: targetOrgId,
          displayName: site.property.displayName,
          locationType: site.property.locationType,
          address: site.property.address as Prisma.InputJsonValue,
          latitude: site.property.latitude,
          longitude: site.property.longitude,
          provisioningStatus: site.property.provisioningStatus,
        },
        select: { id: true },
      });

      // Collect ChargingStation IDs under this site (via SiteAsset).
      // These drive the EVSE/Connector/OcppIdentity/Session cascades.
      const siteAssetRows = await tx.siteAsset.findMany({
        where: { siteId },
        select: { id: true },
      });
      const stationIds = siteAssetRows.map((s) => s.id);

      // Update org_id on every level of the subtree. Each updateMany
      // is scoped via foreign-key chains the schema already supports.
      const installations = await tx.installation.updateMany({
        where: { siteId },
        data: { orgId: targetOrgId },
      });
      const circuits = await tx.circuit.updateMany({
        where: { siteId },
        data: { orgId: targetOrgId },
      });
      const siteAssets = await tx.siteAsset.updateMany({
        where: { siteId },
        data: { orgId: targetOrgId },
      });
      const chargingStations =
        stationIds.length > 0
          ? await tx.chargingStation.updateMany({
              where: { siteAssetId: { in: stationIds } },
              data: { orgId: targetOrgId },
            })
          : { count: 0 };
      const evses =
        stationIds.length > 0
          ? await tx.eVSE.updateMany({
              where: { chargingStationId: { in: stationIds } },
              data: { orgId: targetOrgId },
            })
          : { count: 0 };
      const evseRows =
        stationIds.length > 0
          ? await tx.eVSE.findMany({
              where: { chargingStationId: { in: stationIds } },
              select: { id: true },
            })
          : [];
      const evseIds = evseRows.map((e) => e.id);
      const connectors =
        evseIds.length > 0
          ? await tx.connector.updateMany({
              where: { evseId: { in: evseIds } },
              data: { orgId: targetOrgId },
            })
          : { count: 0 };
      const ocppIdentities =
        stationIds.length > 0
          ? await tx.ocppIdentity.updateMany({
              where: { chargingStationId: { in: stationIds } },
              data: { orgId: targetOrgId },
            })
          : { count: 0 };
      const sessionRows =
        stationIds.length > 0
          ? await tx.chargeSession.findMany({
              where: { chargingStationId: { in: stationIds } },
              select: { id: true },
            })
          : [];
      const sessionIds = sessionRows.map((s) => s.id);
      const chargeSessions =
        stationIds.length > 0
          ? await tx.chargeSession.updateMany({
              where: { chargingStationId: { in: stationIds } },
              data: { orgId: targetOrgId },
            })
          : { count: 0 };
      // MeterValue is keyed by sessionId, not chargingStationId; cascade
      // via the session list we just collected.
      const meterValues =
        sessionIds.length > 0
          ? await tx.meterValue.updateMany({
              where: { sessionId: { in: sessionIds } },
              data: { orgId: targetOrgId },
            })
          : { count: 0 };
      const connectorIds: string[] =
        evseIds.length > 0
          ? (
              await tx.connector.findMany({
                where: { evseId: { in: evseIds } },
                select: { id: true },
              })
            ).map((c) => c.id)
          : [];
      const reservations =
        connectorIds.length > 0
          ? await tx.reservation.updateMany({
              where: { connectorId: { in: connectorIds } },
              data: { orgId: targetOrgId },
            })
          : { count: 0 };
      const vendorAssetRefs =
        stationIds.length > 0
          ? await tx.vendorAssetRef.updateMany({
              where: { chargingStationId: { in: stationIds } },
              data: { orgId: targetOrgId },
            })
          : { count: 0 };
      const externalCpmsRefs =
        stationIds.length > 0
          ? await tx.externalCpmsRef.updateMany({
              where: { chargingStationId: { in: stationIds } },
              data: { orgId: targetOrgId },
            })
          : { count: 0 };
      const capabilityProfiles =
        stationIds.length > 0
          ? await tx.capabilityProfile.updateMany({
              where: { chargingStationId: { in: stationIds } },
              data: { orgId: targetOrgId },
            })
          : { count: 0 };
      const controlRoutingPolicies =
        stationIds.length > 0
          ? await tx.controlRoutingPolicy.updateMany({
              where: { chargingStationId: { in: stationIds } },
              data: { orgId: targetOrgId },
            })
          : { count: 0 };

      // Clear cross-org references. Tariff anchors point to the source
      // org's tariff catalogue; vendor-credentials FKs point to source
      // org's credentials. Operator re-links in the target org.
      const installationsBefore = await tx.installation.findMany({
        where: { siteId },
        select: { credentialsId: true, retailerTariffId: true },
      });
      const installationCredentialsCount = installationsBefore.filter((i) => i.credentialsId !== null).length;
      const installationRetailerTariffsCount = installationsBefore.filter((i) => i.retailerTariffId !== null).length;
      await tx.installation.updateMany({
        where: { siteId },
        data: {
          credentialsId: null,
          retailerTariffId: null,
        },
      });

      const siteBefore = await tx.site.findUnique({
        where: { id: siteId },
        select: {
          dsoTariffId: true,
          usrfTariffId: true,
          usrfPremTariffId: true,
          xtrrfTariffId: true,
          spvivfTariffId: true,
        },
      });
      const siteHadTariffs =
        !!siteBefore &&
        (siteBefore.dsoTariffId ||
          siteBefore.usrfTariffId ||
          siteBefore.usrfPremTariffId ||
          siteBefore.xtrrfTariffId ||
          siteBefore.spvivfTariffId);

      // Update the site itself last — flips org_id + property_id +
      // clears tariffs in one statement.
      await tx.site.update({
        where: { id: siteId },
        data: {
          orgId: targetOrgId,
          propertyId: newProperty.id,
          dsoTariffId: null,
          usrfTariffId: null,
          usrfPremTariffId: null,
          xtrrfTariffId: null,
          spvivfTariffId: null,
        },
      });

      // Sprint 8.14 — auto-cleanup orphan property in the source org.
      // The moved site was the only site under its old property →
      // that property is now empty in the source org and would just
      // sit there as duplicate metadata of the new property in the
      // target org. Delete it. If the source property still has
      // OTHER sites, leave it alone.
      const sourcePropertyId = site.propertyId;
      const remainingSitesOnSourceProperty = await tx.site.count({
        where: { propertyId: sourcePropertyId },
      });
      let sourcePropertyDeleted = false;
      if (remainingSitesOnSourceProperty === 0) {
        await tx.property.delete({ where: { id: sourcePropertyId } });
        sourcePropertyDeleted = true;
      }

      const result: MoveSiteResult = {
        siteId,
        fromOrgId,
        toOrgId: targetOrgId,
        newPropertyId: newProperty.id,
        affected: {
          installations: installations.count,
          circuits: circuits.count,
          siteAssets: siteAssets.count,
          chargingStations: chargingStations.count,
          evses: evses.count,
          connectors: connectors.count,
          ocppIdentities: ocppIdentities.count,
          chargeSessions: chargeSessions.count,
          meterValues: meterValues.count,
          reservations: reservations.count,
          vendorAssetRefs: vendorAssetRefs.count,
          externalCpmsRefs: externalCpmsRefs.count,
          capabilityProfiles: capabilityProfiles.count,
          controlRoutingPolicies: controlRoutingPolicies.count,
        },
        cleared: {
          siteTariffs: !!siteHadTariffs,
          installationCredentials: installationCredentialsCount,
          installationRetailerTariffs: installationRetailerTariffsCount,
          sourcePropertyDeleted,
        },
      };

      // Audit lands under the target org (where the site now lives).
      await recordAuditAction(tx, {
        orgId: targetOrgId,
        actorUserId,
        actorKind: "user",
        action: "site.move_to_org",
        targetType: "site",
        targetId: siteId,
        metadata: {
          fromOrgId,
          toOrgId: targetOrgId,
          newPropertyId: newProperty.id,
          affected: result.affected,
          cleared: result.cleared,
        },
      });

      return result;
    },
    { timeout: 90_000, maxWait: 30_000 },
  );
}
