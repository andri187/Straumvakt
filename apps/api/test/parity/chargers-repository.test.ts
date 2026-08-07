// Prisma and Drizzle, same query, same rows — do they agree?
//
// chargers.ts backs /chargers, the page that matters most, and it was the
// hardest file in the port: a six-level nested `include` with `take: 1`
// sub-selects, two groupBy aggregates over partitioned tables, and three
// transactions.
//
// The Prisma side below is the OLD implementation, inlined rather than
// imported, because the port deleted it. Inlining is what makes this a
// comparison rather than a tautology.
//
// TWO THINGS THIS IS SPECIFICALLY HUNTING
// ---------------------------------------
//  1. **The take:1 rewrite.** Prisma's nested `take: 1, orderBy` became
//     DISTINCT ON. If the ORDER BY leads with the wrong column, or if the
//     relation got joined instead, the wrong child comes back — or the
//     parent rows multiply. Both would be invisible in a typecheck and
//     obvious here.
//  2. **Decimal formatting.** Postgres returns numeric with its scale
//     intact ("7.40"); Prisma's Decimal prints "7.4". Every max-power value
//     in the API response would gain a trailing zero without
//     normaliseDecimalString. Asserted directly.
//
// READ-ONLY. listAllChargers/getChargerById only. createCharger,
// updateCharger, deleteCharger and attachVendorToOcppIdentity write, and are
// deliberately not exercised against a shared branch.
//
// `kek` is never passed, so the live Zaptec round-trip in
// getActiveVendorResourceIds is skipped and `decommissioned` is null on both
// sides — the same as pre-9.7 behaviour. That path needs a vendor API and
// does not belong in a parity run.

import { afterAll, describe, expect, it } from "vitest";
import { closeAll, getDrizzle, getPrisma, hasDb, shapeOf } from "./_harness";
import { listAllChargers, getChargerById, listSiteCircuits } from "../../src/repositories/chargers";

const ONLINE_WINDOW_MS = 12 * 60 * 1000;
const OCPP_LOOKBACK_MS = 24 * 60 * 60 * 1000;

describe.skipIf(!hasDb)("chargers repository: Prisma vs Drizzle", () => {
  afterAll(closeAll);

  // ── the Prisma implementation, as it was before the port ────────────────

  /* eslint-disable @typescript-eslint/no-explicit-any */
  async function listAllChargersPrisma(db: any, opts: { includeDecommissioned?: boolean } = {}) {
    const rows = await db.chargingStation.findMany({
      orderBy: [{ updatedAt: "desc" }],
      include: {
        organization: { select: { displayName: true } },
        siteAsset: { select: { site: { select: { displayName: true } } } },
        installation: { select: { id: true, displayName: true, enforceAuthorize: true } },
        circuit: { select: { id: true, displayName: true } },
        evses: {
          take: 1,
          orderBy: { evseIndex: "asc" },
          include: { connectors: { take: 1, orderBy: { connectorIndex: "asc" } } },
        },
        ocppIdentities: { take: 1, orderBy: { createdAt: "asc" } },
      },
    });

    const identityIds = rows
      .map((r: any) => r.ocppIdentities[0]?.id)
      .filter((id: any): id is string => typeof id === "string" && id.length > 0);

    const ocppLastSeen = new Map<string, Date>();
    if (identityIds.length > 0) {
      const since = new Date(Date.now() - OCPP_LOOKBACK_MS);
      const noteNewest = (rowsIn: any[]) => {
        for (const g of rowsIn) {
          const at = g._max.occurredAt;
          if (!at) continue;
          const prev = ocppLastSeen.get(g.aggregateId);
          if (!prev || at > prev) ocppLastSeen.set(g.aggregateId, at);
        }
      };
      const [fromEvents, fromProtocol] = await Promise.all([
        db.eventLogEntry.groupBy({
          by: ["aggregateId"],
          where: { aggregateId: { in: identityIds }, occurredAt: { gte: since } },
          _max: { occurredAt: true },
        }),
        db.protocolLogEntry.groupBy({
          by: ["aggregateId"],
          where: { aggregateId: { in: identityIds }, occurredAt: { gte: since } },
          _max: { occurredAt: true },
        }),
      ]);
      noteNewest(fromEvents);
      noteNewest(fromProtocol);
    }

    const now = Date.now();
    const mapped = rows.map((r: any) => {
      const identity = r.ocppIdentities[0];
      const lastSeen = identity?.lastSeenAt ?? null;
      const within = lastSeen != null && now - lastSeen.getTime() < ONLINE_WINDOW_MS;
      const online = within && identity?.status !== "offline";
      const ocppSeen = identity?.id ? (ocppLastSeen.get(identity.id) ?? null) : null;
      return {
        chargingStationId: r.siteAssetId,
        evseId: r.evses[0]?.id ?? "",
        connectorId: r.evses[0]?.connectors[0]?.id ?? "",
        ocppIdentityId: identity?.id ?? "",
        identityString: identity?.identityString ?? "—",
        orgDisplayName: r.organization.displayName,
        siteDisplayName: r.siteAsset.site.displayName,
        vendor: r.vendor,
        model: r.model,
        serialNumber: r.serialNumber,
        connectorType: r.evses[0]?.connectors[0]?.type ?? "—",
        ocppVersion: identity?.ocppVersion ?? "—",
        createdAt: r.createdAt.toISOString(),
        firmwareVersion: r.firmwareVersion,
        mainboardSwVersion: r.mainboardSwVersion,
        smartBootloaderVersion: r.smartBootloaderVersion,
        hardwareVersion: r.hardwareVersion,
        lifetimeKwh: r.lifetimeKwhCached != null ? Number(r.lifetimeKwhCached) : null,
        status: online ? (identity?.status ?? null) : "offline",
        online,
        onlineSinceAt: online && r.onlineSinceAt ? r.onlineSinceAt.toISOString() : null,
        lastSeenAt: lastSeen ? lastSeen.toISOString() : null,
        ocppLastSeenAt: ocppSeen ? ocppSeen.toISOString() : null,
        ocppOnline: ocppSeen != null && now - ocppSeen.getTime() < ONLINE_WINDOW_MS,
        enforceAuthorize: r.installation?.enforceAuthorize ?? null,
        vendorAuthRequired: r.vendorAuthRequired ?? null,
        vendorAuthenticationType: r.vendorAuthenticationType ?? null,
        vendorAuthSeenAt: r.vendorAuthSeenAt ? r.vendorAuthSeenAt.toISOString() : null,
        decommissioned: null,
        commMode: r.commMode,
        signalDbm: r.signalDbm,
        installationId: r.installation?.id ?? null,
        installationDisplayName: r.installation?.displayName ?? null,
        circuitId: r.circuit?.id ?? null,
        circuitDisplayName: r.circuit?.displayName ?? null,
      };
    });
    if (!opts.includeDecommissioned) return mapped.filter((c: any) => c.decommissioned !== true);
    return mapped;
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */

  // Fields whose value depends on Date.now() at call time. The two
  // implementations run milliseconds apart, so a charger sitting exactly on
  // the 12-minute boundary could legitimately flip between them. Compared
  // for type, not value.
  const TIME_SENSITIVE = new Set(["online", "ocppOnline", "status", "onlineSinceAt"]);

  it("listAllChargers returns the same rows in the same order", async () => {
    const [drz, pri] = await Promise.all([
      listAllChargers(getDrizzle()),
      listAllChargersPrisma(getPrisma()),
    ]);

    expect(drz.length).toBe(pri.length);
    expect(drz.length).toBeGreaterThan(0);

    // Order is `updatedAt desc` — ties are unstable in both, so compare the
    // sets by id, then compare each row by id rather than by position.
    expect(new Set(drz.map((c) => c.chargingStationId))).toEqual(
      new Set(pri.map((c: { chargingStationId: string }) => c.chargingStationId)),
    );

    const byId = new Map(pri.map((c: { chargingStationId: string }) => [c.chargingStationId, c]));
    for (const d of drz) {
      const p = byId.get(d.chargingStationId) as Record<string, unknown>;
      expect(p, `no Prisma row for ${d.chargingStationId}`).toBeTruthy();
      for (const [k, v] of Object.entries(d)) {
        if (TIME_SENSITIVE.has(k)) {
          expect(shapeOf(v), `${k} type on ${d.chargingStationId}`).toBe(shapeOf(p[k]));
          continue;
        }
        expect(v, `${k} on ${d.chargingStationId}`).toEqual(p[k]);
      }
    }
  });

  it("picks the same first EVSE, connector and identity per station", async () => {
    // The DISTINCT ON rewrite is the highest-risk part of the port. These
    // three fields are exactly what it decides.
    const [drz, pri] = await Promise.all([
      listAllChargers(getDrizzle()),
      listAllChargersPrisma(getPrisma()),
    ]);
    const byId = new Map(
      pri.map((c: { chargingStationId: string }) => [c.chargingStationId, c]),
    );
    let withEvse = 0;
    let withIdentity = 0;
    for (const d of drz) {
      const p = byId.get(d.chargingStationId) as Record<string, unknown>;
      expect(d.evseId).toBe(p.evseId);
      expect(d.connectorId).toBe(p.connectorId);
      expect(d.ocppIdentityId).toBe(p.ocppIdentityId);
      expect(d.connectorType).toBe(p.connectorType);
      expect(d.identityString).toBe(p.identityString);
      if (d.evseId) withEvse++;
      if (d.ocppIdentityId) withIdentity++;
    }
    // Guard against a vacuous pass: if every station had zero children the
    // assertions above would hold trivially and prove nothing.
    expect(withEvse, "no station had an EVSE — the take:1 path was never exercised").toBeGreaterThan(0);
    expect(withIdentity, "no station had an OcppIdentity").toBeGreaterThan(0);
  });

  it("getChargerById matches, including nested evses and connectors", async () => {
    const list = await listAllChargers(getDrizzle());
    const withChildren = list.filter((c) => c.evseId);
    expect(withChildren.length).toBeGreaterThan(0);

    // A handful is enough — this is a per-row query on both sides.
    for (const c of withChildren.slice(0, 5)) {
      const drz = await getChargerById(getDrizzle(), c.chargingStationId);
      const pri = await getChargerByIdPrisma(getPrisma(), c.chargingStationId);
      expect(drz, c.chargingStationId).toEqual(pri);
    }
  });

  it("getChargerById returns null for an unknown id on both sides", async () => {
    const missing = "00000000-0000-4000-8000-0000000000ff";
    expect(await getChargerById(getDrizzle(), missing)).toBeNull();
    expect(await getChargerByIdPrisma(getPrisma(), missing)).toBeNull();
  });

  it("formats decimals the way Prisma did — no trailing zeros", async () => {
    // The trap this is guarding: numeric(8,2) comes back from Postgres as
    // "7.40". Prisma's Decimal prints "7.4". Every maxPowerKw in the API
    // response would change shape without normaliseDecimalString.
    //
    // KNOWN GAP, 2026-08-07: every assets.evses and assets.connectors row on
    // this branch has max_power_kw NULL — 0 of 31 on each. So this cannot be
    // exercised here, and it reports that rather than passing vacuously.
    //
    // normaliseDecimalString itself IS covered, by the identity fixture,
    // whose vehicles.battery_capacity_kwh stores 77.40 precisely to catch
    // this. What stays unproven against real rows is that chargers.ts routes
    // maxPowerKw through it. Seeding a row is not an option — this suite is
    // read-only against a shared branch on purpose.
    const list = await listAllChargers(getDrizzle());
    let checked = 0;
    for (const c of list.slice(0, 10)) {
      const detail = await getChargerById(getDrizzle(), c.chargingStationId);
      for (const e of detail?.evses ?? []) {
        for (const value of [e.maxPowerKw, ...e.connectors.map((k) => k.maxPowerKw)]) {
          if (value === null) continue;
          checked++;
          expect(value, `"${value}" has a trailing zero`).not.toMatch(/\.\d*0$/);
        }
      }
    }
    if (checked === 0) {
      console.warn(
        "[parity] maxPowerKw is NULL on every row in this branch — decimal " +
          "normalisation in chargers.ts is NOT verified against real data. " +
          "Delete this branch once any charger carries a max power.",
      );
    }
  });

  it("listSiteCircuits matches", async () => {
    const prisma = getPrisma();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const site = await (prisma as any).circuit.findFirst({ select: { siteId: true } });
    if (!site) return; // no circuits in this branch — nothing to compare
    const [drz, pri] = await Promise.all([
      listSiteCircuits(getDrizzle(), site.siteId),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (prisma as any).circuit.findMany({
        where: { siteId: site.siteId },
        select: { id: true, displayName: true },
        orderBy: { displayName: "asc" },
      }),
    ]);
    expect(drz).toEqual(pri);
  });

  /* eslint-disable @typescript-eslint/no-explicit-any */
  async function getChargerByIdPrisma(db: any, chargingStationId: string) {
    const r = await db.chargingStation.findUnique({
      where: { siteAssetId: chargingStationId },
      include: {
        organization: { select: { displayName: true } },
        siteAsset: { select: { siteId: true, site: { select: { displayName: true } } } },
        installation: { select: { displayName: true } },
        circuit: { select: { displayName: true } },
        evses: {
          orderBy: { evseIndex: "asc" },
          include: { connectors: { orderBy: { connectorIndex: "asc" } } },
        },
        ocppIdentities: { orderBy: { createdAt: "asc" } },
      },
    });
    if (!r) return null;
    return {
      chargingStationId: r.siteAssetId,
      orgId: r.orgId,
      orgDisplayName: r.organization.displayName,
      siteId: r.siteAsset.siteId,
      siteDisplayName: r.siteAsset.site.displayName,
      installationId: r.installationId,
      installationDisplayName: r.installation?.displayName ?? null,
      circuitId: r.circuitId,
      circuitDisplayName: r.circuit?.displayName ?? null,
      vendor: r.vendor,
      model: r.model,
      serialNumber: r.serialNumber,
      firmwareVersion: r.firmwareVersion,
      warrantyExpires: r.warrantyExpires ? r.warrantyExpires.toISOString().slice(0, 10) : null,
      chargeBoxSerialNumber: r.chargeBoxSerialNumber,
      meterType: r.meterType,
      meterSerialNumber: r.meterSerialNumber,
      iccid: r.iccid,
      imsi: r.imsi,
      locationNote: r.locationNote,
      mountingType: r.mountingType,
      photoUrl: r.photoUrl,
      ipRating: r.ipRating,
      breakerAmps: r.breakerAmps,
      evses: r.evses.map((e: any) => ({
        id: e.id,
        evseIndex: e.evseIndex,
        maxPowerKw: e.maxPowerKw?.toString() ?? null,
        phaseCount: e.phaseCount,
        connectors: e.connectors.map((c: any) => ({
          id: c.id,
          connectorIndex: c.connectorIndex,
          type: c.type,
          maxPowerKw: c.maxPowerKw?.toString() ?? null,
          status: c.status,
          errorCode: c.errorCode,
          vendorErrorCode: c.vendorErrorCode,
          statusUpdatedAt: c.statusUpdatedAt?.toISOString() ?? null,
        })),
      })),
      ocppIdentities: r.ocppIdentities.map((i: any) => ({
        id: i.id,
        identityString: i.identityString,
        ocppVersion: i.ocppVersion,
      })),
    };
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */
});
