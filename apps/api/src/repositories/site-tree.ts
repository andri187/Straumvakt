// Site tree repository — assembles the Site → Installation → Circuit
// → Charger hierarchy in one round of independent queries, then nests
// the result in JS. We intentionally avoid a single deeply-nested
// Prisma include because the projection bucketing (orphan circuits,
// orphan chargers, direct-on-installation chargers) is easier to do
// imperatively than via where-clauses on nested includes.
//
// Online/offline definition matches the vendor-credentials list:
// status === 'online' OR last_seen_at within the last 5 minutes.

import type { PrismaClient } from "../generated/prisma/client";
import type {
  SiteTreeNode,
  SiteTreeInstallationNode,
  SiteTreeCircuitNode,
  SiteTreeChargerNode,
} from "@straumvakt/shared/domain/site-tree";

const ONLINE_WINDOW_MS = 5 * 60 * 1000;

export async function listSiteTree(db: PrismaClient): Promise<SiteTreeNode[]> {
  const [sites, installations, circuits, chargers] = await Promise.all([
    db.site.findMany({
      orderBy: [{ displayName: "asc" }],
      include: {
        organization: { select: { id: true, displayName: true } },
        property: { select: { id: true, displayName: true } },
      },
    }),
    db.installation.findMany({
      orderBy: [{ displayName: "asc" }],
      select: {
        id: true,
        siteId: true,
        displayName: true,
        onboardingStatus: true,
        vendor: { select: { slug: true } },
      },
    }),
    db.circuit.findMany({
      orderBy: [{ displayName: "asc" }],
      select: {
        id: true,
        siteId: true,
        installationId: true,
        displayName: true,
        ampereCeiling: true,
        phaseCount: true,
      },
    }),
    db.chargingStation.findMany({
      orderBy: [{ updatedAt: "desc" }],
      include: {
        siteAsset: { select: { siteId: true } },
        evses: {
          orderBy: { evseIndex: "asc" },
          select: {
            connectors: {
              orderBy: { connectorIndex: "asc" },
              select: { type: true },
            },
          },
        },
        ocppIdentities: {
          take: 1,
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            identityString: true,
            status: true,
            lastSeenAt: true,
          },
        },
      },
    }),
  ]);

  const now = Date.now();

  function chargerNode(
    c: (typeof chargers)[number],
  ): SiteTreeChargerNode {
    const identity = c.ocppIdentities[0] ?? null;
    const lastSeen = identity?.lastSeenAt ?? null;
    const online =
      identity?.status === "online" ||
      (lastSeen != null && now - new Date(lastSeen).getTime() < ONLINE_WINDOW_MS);
    const connectorTypes = c.evses.flatMap((e) => e.connectors.map((k) => k.type));
    const connectorSummary =
      connectorTypes.length === 0
        ? "—"
        : connectorTypes.length === 1
          ? connectorTypes[0]
          : `${connectorTypes.length}× ${[...new Set(connectorTypes)].join("/")}`;
    return {
      chargingStationId: c.siteAssetId,
      ocppIdentityId: identity?.id ?? null,
      identityString: identity?.identityString ?? null,
      vendor: c.vendor,
      model: c.model,
      serialNumber: c.serialNumber,
      online,
      status: identity?.status ?? "—",
      lastSeenAt: lastSeen ? new Date(lastSeen).toISOString() : null,
      connectorSummary,
    };
  }

  function circuitNode(
    cir: (typeof circuits)[number],
    children: SiteTreeChargerNode[],
  ): SiteTreeCircuitNode {
    return {
      id: cir.id,
      displayName: cir.displayName,
      ampereCeiling: cir.ampereCeiling,
      phaseCount: cir.phaseCount,
      chargers: children,
    };
  }

  // Pre-bucket chargers by (siteId, installationId, circuitId).
  const chargersBySite = new Map<string, typeof chargers>();
  for (const c of chargers) {
    const sid = c.siteAsset.siteId;
    const list = chargersBySite.get(sid) ?? [];
    list.push(c);
    chargersBySite.set(sid, list);
  }
  const installationsBySite = new Map<string, typeof installations>();
  for (const i of installations) {
    const list = installationsBySite.get(i.siteId) ?? [];
    list.push(i);
    installationsBySite.set(i.siteId, list);
  }
  const circuitsBySite = new Map<string, typeof circuits>();
  for (const cir of circuits) {
    const list = circuitsBySite.get(cir.siteId) ?? [];
    list.push(cir);
    circuitsBySite.set(cir.siteId, list);
  }

  return sites.map<SiteTreeNode>((s) => {
    const siteChargers = chargersBySite.get(s.id) ?? [];
    const siteInstallations = installationsBySite.get(s.id) ?? [];
    const siteCircuits = circuitsBySite.get(s.id) ?? [];

    let online = 0;
    let offline = 0;

    const installationNodes: SiteTreeInstallationNode[] = siteInstallations.map((inst) => {
      const installCircuits = siteCircuits.filter((c) => c.installationId === inst.id);
      const installChargers = siteChargers.filter((c) => c.installationId === inst.id);

      const circuitNodes: SiteTreeCircuitNode[] = installCircuits.map((cir) => {
        const cirChargers = installChargers
          .filter((c) => c.circuitId === cir.id)
          .map(chargerNode);
        return circuitNode(cir, cirChargers);
      });

      const directChargers = installChargers
        .filter((c) => c.circuitId == null)
        .map(chargerNode);

      let instOn = 0;
      let instOff = 0;
      const tally = (n: SiteTreeChargerNode) => (n.online ? instOn++ : instOff++);
      circuitNodes.forEach((c) => c.chargers.forEach(tally));
      directChargers.forEach(tally);
      online += instOn;
      offline += instOff;

      return {
        id: inst.id,
        displayName: inst.displayName,
        vendorSlug: inst.vendor?.slug ?? null,
        onboardingStatus: inst.onboardingStatus,
        circuits: circuitNodes,
        directChargers,
        chargersOnline: instOn,
        chargersOffline: instOff,
      };
    });

    // Orphan circuits (under site but no installation) and their chargers.
    const orphanCircuits = siteCircuits
      .filter((c) => c.installationId == null)
      .map((cir) => {
        const kids = siteChargers
          .filter((c) => c.installationId == null && c.circuitId === cir.id)
          .map(chargerNode);
        kids.forEach((n) => (n.online ? online++ : offline++));
        return circuitNode(cir, kids);
      });

    // Orphan chargers (no installation, no circuit).
    const orphanChargers = siteChargers
      .filter((c) => c.installationId == null && c.circuitId == null)
      .map(chargerNode);
    orphanChargers.forEach((n) => (n.online ? online++ : offline++));

    return {
      id: s.id,
      displayName: s.displayName,
      orgId: s.organization.id,
      orgDisplayName: s.organization.displayName,
      propertyId: s.property.id,
      propertyDisplayName: s.property.displayName,
      siteType: s.siteType,
      accessLevel: s.accessLevel,
      timezone: s.timezone,
      chargersOnline: online,
      chargersOffline: offline,
      installations: installationNodes,
      orphanCircuits,
      orphanChargers,
    };
  });
}
