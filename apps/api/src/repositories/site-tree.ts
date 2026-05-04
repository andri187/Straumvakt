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
import {
  getChargerDetail,
  getChargerState,
  getZaptecAccessToken,
  listChargers,
} from "../lib/zaptec";
import { openPassword } from "../lib/credential-crypto";

// 12 min: API status pollers (Sprint 8.8) tick every */5, so a 5-min
// window races the cron. 12 min gives ~2 ticks of buffer before a row
// flips to offline. OCPP-driven Heartbeat traffic (when present)
// still keeps lastSeenAt fresher than this anyway.
const ONLINE_WINDOW_MS = 12 * 60 * 1000;

// OCPP 1.6 §4.7 ChargePointStatus enum — exhaustive. Used to
// distinguish a real charger-reported status from our DB default
// "unknown" string set at import time before any StatusNotification
// has arrived.
function isRealOcppStatus(s: string): boolean {
  return (
    s === "Available" ||
    s === "Preparing" ||
    s === "Charging" ||
    s === "SuspendedEV" ||
    s === "SuspendedEVSE" ||
    s === "Finishing" ||
    s === "Reserved" ||
    s === "Unavailable" ||
    s === "Faulted"
  );
}

interface ZaptecLiveSnapshot {
  /**
   * Per-charger config flag. True when vendor credentials work AND
   * this charger is in the Zaptec bulk list. Operator-facing
   * meaning: "API integration is configured for this charger".
   * Independent of runtime online state.
   */
  apiActive: boolean;
  /**
   * Per-charger config flag. True when the charger's
   * AuthenticationType is 2 (OCPP cloud) — i.e. OCPP is the
   * configured comms mode. Doesn't say anything about whether the
   * charger is currently authenticated against our gateway; that's
   * the Auth toggle's job.
   */
  ocppConfigured: boolean;
  authRequired: boolean;
  /** Zaptec's own runtime view; exposed for tooltips/future use. */
  vendorOnline: boolean;
  /**
   * Timestamp of the StateId -2 (IsOnline) last transition to "1"
   * — i.e. when the charger came online to Zaptec cloud. Null when
   * we couldn't read state for this charger.
   */
  onlineSince: string | null;
  /** Lifetime kWh from charger detail's SignedMeterValueKwh. Null when missing. */
  lifetimeEnergyKWh: number | null;
  /**
   * Zaptec bulk list reported Active=false — operator has retired the
   * charger on the vendor side. Drives the /sites "show decommissioned"
   * toggle. null when the bulk list didn't include an Active value.
   */
  decommissioned: boolean | null;
  /**
   * OCPP-equivalent status derived from Zaptec's StateId 710
   * (ChargerOperationMode). Used as fallback when our OCPP gateway
   * hasn't received a StatusNotification. null when /state didn't
   * return the field, or the charger is offline.
   */
  vendorConnectorStatus: string | null;
}

/**
 * Map Zaptec ChargerOperationMode (StateId 710) onto an OCPP 1.6
 * §4.7 ChargePointStatus enum value. Operationally these aren't 1:1
 * — Zaptec is per-charger, OCPP is per-connector — but for the
 * single-connector AC chargers that dominate the fleet the mapping
 * is unambiguous and matches operator expectations.
 *
 *   0 Unknown               → null  (caller hides the pill)
 *   1 Disconnected          → Available
 *   2 Connected_Requesting  → Preparing
 *   3 Charging              → Charging
 *   5 Connected_Finished    → Finishing
 *   6 Connected_Limited     → SuspendedEVSE  (DLB / load-balancer pause)
 */
function mapZaptecOpModeToOcpp(raw: string | number | null): string | null {
  if (raw == null) return null;
  // Bulk list returns OperatingMode as a number; /state's
  // ValueAsString is a string. Normalise to string for the switch.
  const code = typeof raw === "number" ? String(raw) : raw;
  switch (code) {
    case "1":
      return "Available";
    case "2":
      return "Preparing";
    case "3":
      return "Charging";
    case "5":
      return "Finishing";
    case "6":
      return "SuspendedEVSE";
    default:
      return null;
  }
}

/**
 * Build a Map<chargingStationId, ZaptecLiveSnapshot> by hitting
 * Zaptec's bulk /api/chargers endpoint per active Zaptec credential.
 * One round trip per credential — dramatically cheaper than
 * per-charger detail.
 *
 * Best-effort. Failures (auth issue, Zaptec unreachable, missing
 * KEK) leave the map empty and the caller renders apiActive=null
 * + authRequired=null rather than 500ing the page.
 */
async function buildApiActiveMap(
  db: PrismaClient,
  kek: string | undefined,
): Promise<Map<string, ZaptecLiveSnapshot>> {
  const out = new Map<string, ZaptecLiveSnapshot>();
  if (!kek) return out;

  const credentials = await db.vendorCredential.findMany({
    where: { status: "active", vendor: { slug: "zaptec" } },
    select: {
      ownerOrgId: true,
      username: true,
      passwordCipher: true,
      passwordIv: true,
    },
  });
  if (credentials.length === 0) return out;

  // Build map: orgId → list of (vendorResourceId → chargingStationId).
  // Used after the Zaptec call to translate vendor UUIDs back to our
  // SiteAsset ids.
  const orgIdentities = await db.ocppIdentity.findMany({
    where: { vendor: "Zaptec", vendorResourceId: { not: null } },
    select: { orgId: true, chargingStationId: true, vendorResourceId: true },
  });
  const orgVendorMap = new Map<string, Map<string, string>>();
  for (const id of orgIdentities) {
    if (!id.vendorResourceId) continue;
    const inner = orgVendorMap.get(id.orgId) ?? new Map<string, string>();
    inner.set(id.vendorResourceId, id.chargingStationId);
    orgVendorMap.set(id.orgId, inner);
  }

  await Promise.all(
    credentials.map(async (cred) => {
      const map = orgVendorMap.get(cred.ownerOrgId);
      if (!map || !cred.passwordCipher || !cred.passwordIv) return;
      try {
        const password = await openPassword(kek, {
          cipher: cred.passwordCipher,
          iv: cred.passwordIv,
        });
        const tokenResult = await getZaptecAccessToken(cred.username, password);
        if (!tokenResult.ok) return;
        const listResult = await listChargers(tokenResult.value);
        if (!listResult.ok) return;
        // For every charger Zaptec returns that we know about, mark
        // apiActive=true — creds work AND we have the vendor record
        // for it, so the charger is API-manageable. Chargers in our
        // DB that aren't in this response stay null (= unknown), so
        // the operator can spot decommissioned-but-still-imported rows.
        // First pass: write the rows we can populate from the bulk
        // list alone. onlineSince gets filled in afterwards via
        // per-charger /state calls, but only for chargers that are
        // currently IsOnline=true (no point fetching state for
        // offline ones — onlineSince doesn't apply).
        const onlineToFetch: Array<{ vendorId: string; stationId: string }> = [];
        for (const ch of listResult.value) {
          if (!ch.Id) continue;
          const stationId = map.get(ch.Id);
          if (!stationId) continue;
          // AuthenticationType: 0=None, 1=Vendor app, 2=OCPP cloud,
          // 3=Native OCPP. Treat 2 (cloud) and 3 (native) as
          // OCPP-configured — both route through OCPP, just over
          // different transports.
          const authTypeNum =
            typeof (ch as { AuthenticationType?: unknown }).AuthenticationType === "number"
              ? ((ch as { AuthenticationType?: number }).AuthenticationType as number)
              : null;
          const ocppConfigured = authTypeNum === 2 || authTypeNum === 3;
          // OperatingMode comes from the bulk list directly (no extra
          // call). Zaptec keeps the last-reported value for offline
          // chargers, so this is the right source for a per-charger
          // status pill regardless of IsOnline. /state below may
          // refresh it for online chargers but bulk is enough on its
          // own for the pill to appear.
          const bulkVendorStatus = mapZaptecOpModeToOcpp(
            typeof ch.OperatingMode === "number" ? ch.OperatingMode : null,
          );
          out.set(stationId, {
            apiActive: true,
            ocppConfigured,
            authRequired: ch.IsAuthorizationRequired === true,
            vendorOnline: ch.IsOnline === true,
            onlineSince: null,
            lifetimeEnergyKWh: null,
            // Bulk list returns Active as boolean. null when the field
            // is missing entirely (older Zaptec firmware / unexpected
            // shape) so the UI can distinguish "explicitly active" from
            // "we don't know".
            decommissioned:
              typeof ch.Active === "boolean" ? ch.Active === false : null,
            vendorConnectorStatus: bulkVendorStatus,
          });
          if (ch.IsOnline === true) {
            onlineToFetch.push({ vendorId: ch.Id, stationId });
          }
        }

        // Per-online-charger fetches in parallel:
        //   /state  → StateId -2 timestamp (online-since)
        //   /detail → SignedMeterValueKwh (lifetime kWh)
        // Both run side-by-side per charger; offline chargers skip
        // both fetches. Best-effort — failures leave fields null and
        // the UI renders em-dashes rather than 500ing the page.
        //
        // Write-through: when /detail returns a higher SignedMeterValueKwh
        // than what's persisted, persist the new value. Caller reads
        // lifetimeKwhCached from ChargingStation directly, so we don't
        // need to thread the value through this map.
        const writeThroughs: Promise<unknown>[] = [];
        await Promise.all(
          onlineToFetch.map(async ({ vendorId, stationId }) => {
            const [stateResult, detailResult] = await Promise.all([
              getChargerState(tokenResult.value, vendorId),
              getChargerDetail(tokenResult.value, vendorId),
            ]);
            const existing = out.get(stationId);
            if (!existing) return;
            const onlineEntry = stateResult.ok
              ? stateResult.value.find((s) => s.StateId === -2)
              : null;
            const onlineSince = onlineEntry?.Timestamp ?? null;
            const lifetimeKWh =
              detailResult.ok && detailResult.value && typeof detailResult.value.SignedMeterValueKwh === "number"
                ? (detailResult.value.SignedMeterValueKwh as number)
                : null;
            // StateId 710 from /state — used to refresh the bulk
            // OperatingMode for online chargers. Only override the
            // existing snapshot when /state gave us a real value;
            // otherwise keep what bulk set so we don't blank out a
            // valid status with null.
            const opModeEntry = stateResult.ok
              ? stateResult.value.find((s) => s.StateId === 710)
              : null;
            const refreshedVendorStatus = mapZaptecOpModeToOcpp(
              opModeEntry?.ValueAsString ?? null,
            );
            out.set(stationId, {
              ...existing,
              onlineSince,
              lifetimeEnergyKWh: lifetimeKWh,
              vendorConnectorStatus:
                refreshedVendorStatus ?? existing.vendorConnectorStatus,
            });
            if (lifetimeKWh != null) {
              writeThroughs.push(
                db.chargingStation.updateMany({
                  where: {
                    siteAssetId: stationId,
                    OR: [
                      { lifetimeKwhCached: null },
                      { lifetimeKwhCached: { lt: lifetimeKWh } },
                    ],
                  },
                  data: {
                    lifetimeKwhCached: lifetimeKWh,
                    lifetimeKwhObservedAt: new Date(),
                  },
                }),
              );
            }
          }),
        );
        if (writeThroughs.length > 0) {
          await Promise.all(writeThroughs);
        }

        // Decommissioned-by-omission detection. Zaptec's bulk
        // /api/chargers excludes Active=false rows, so any imported
        // charger whose vendor_resource_id we *expected* but didn't
        // see in the response has been retired (or removed) on the
        // vendor side. Mark these explicitly so the /sites toggle
        // can hide them and the badge can render. apiActive=false
        // because the credential reaches Zaptec but the API no
        // longer surfaces this charger.
        //
        // Note this only fires when listResult.ok was true — if auth
        // failed or the bulk call errored we already returned early
        // without touching `out`, leaving rows null (= unknown).
        const seenZaptecIds = new Set<string>();
        for (const ch of listResult.value) {
          if (typeof ch.Id === "string") seenZaptecIds.add(ch.Id);
        }
        for (const [vendorResourceId, stationId] of map.entries()) {
          if (seenZaptecIds.has(vendorResourceId)) continue;
          if (out.has(stationId)) continue;
          out.set(stationId, {
            apiActive: false,
            ocppConfigured: false,
            authRequired: false,
            vendorOnline: false,
            onlineSince: null,
            lifetimeEnergyKWh: null,
            decommissioned: true,
            vendorConnectorStatus: null,
          });
        }
      } catch (err) {
        console.error("[site-tree] zaptec API-active fetch failed", {
          orgId: cred.ownerOrgId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }),
  );

  return out;
}

export async function listSiteTree(
  db: PrismaClient,
  kek?: string,
  options?: { includeDecommissioned?: boolean },
): Promise<SiteTreeNode[]> {
  const includeDecommissioned = options?.includeDecommissioned ?? false;
  // pending_discoveries is the second source of "online" — populated
  // by the gateway's no-auth hook when a charger connects but doesn't
  // present valid Basic-Auth. Without this, a charger connecting
  // anonymously (e.g. Zaptec PropertyAuthenticationDisabled=true)
  // would render offline here while showing Live on /chargers/pending.
  // Same charger → same answer in both views.
  //
  // apiActiveMap is fetched in parallel with the DB queries — Zaptec
  // round trip is the slowest leg, so overlapping it with the DB
  // queries keeps the total tree-build time bounded by max() rather
  // than sum().
  const [sites, installations, circuits, chargers, pending, apiActiveMap] = await Promise.all([
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
        siteAsset: { select: { siteId: true, displayName: true } },
        evses: {
          orderBy: { evseIndex: "asc" },
          select: {
            evseIndex: true,
            connectors: {
              orderBy: { connectorIndex: "asc" },
              select: {
                type: true,
                connectorIndex: true,
                status: true,
                errorCode: true,
                statusUpdatedAt: true,
              },
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
    }).then((rows) =>
      rows.map((r) => ({
        ...r,
        // Decimal → number for downstream comparisons. Keeping the row
        // shape flat avoids a second cast at the chargerNode call site.
        lifetimeKwhCached:
          r.lifetimeKwhCached != null ? Number(r.lifetimeKwhCached) : null,
      })),
    ),
    db.pendingDiscovery.findMany({
      select: { identityString: true, lastSeenAt: true },
    }),
    buildApiActiveMap(db, kek),
  ]);

  const now = Date.now();

  // Map pending rows by lower(identityString) — same case-insensitive
  // join the auth route uses, so we catch the "Zaptec sends lowercase
  // / DB stored uppercase" mismatch consistently.
  const pendingByIdentity = new Map<string, Date>();
  for (const p of pending) {
    pendingByIdentity.set(p.identityString.toLowerCase(), p.lastSeenAt);
  }

  function chargerNode(
    c: (typeof chargers)[number],
  ): SiteTreeChargerNode {
    const identity = c.ocppIdentities[0] ?? null;
    const lastSeen = identity?.lastSeenAt ?? null;
    const pendingSeen = identity
      ? pendingByIdentity.get(identity.identityString.toLowerCase()) ?? null
      : null;
    const liveSnapshot = apiActiveMap.get(c.siteAssetId) ?? null;
    const apiActive = liveSnapshot ? liveSnapshot.apiActive : null;
    const authRequired = liveSnapshot ? liveSnapshot.authRequired : null;
    // OCPP emblem prefers the Zaptec config signal (AuthenticationType
    // = 2 or 3 means OCPP), but falls back to our gateway's view when
    // the vendor API is unreachable for this charger. The fallback
    // catches "Zaptec is down but our OCPP gateway is hearing the
    // charger fine" — the operator still wants to see green. Order:
    //   1. Vendor API says OCPP-mode → trust it
    //   2. Vendor API says not-OCPP → trust it (red)
    //   3. Vendor API silent + we have a recent auth-passing OCPP
    //      session → green (gateway evidence)
    //   4. Otherwise → null (unknown)
    const gatewayHasOcpp =
      identity?.status === "online" ||
      (lastSeen != null && now - new Date(lastSeen).getTime() < ONLINE_WINDOW_MS);
    const ocppActive = liveSnapshot
      ? liveSnapshot.ocppConfigured
      : gatewayHasOcpp
        ? true
        : null;
    // `online` reflects runtime reachability across both sides:
    //   • vendor (Zaptec IsOnline) — the most reliable signal when the
    //     gateway can't authenticate the charger but Zaptec sees it
    //   • our gateway (auth-passing OCPP traffic) — when Zaptec API is
    //     unreachable but the charger is talking to us
    //   • pending_discoveries — gateway heard a connection attempt
    //     even without auth
    // Either source within the 5-min window counts as online.
    const online =
      (liveSnapshot?.vendorOnline === true) ||
      identity?.status === "online" ||
      (lastSeen != null && now - new Date(lastSeen).getTime() < ONLINE_WINDOW_MS) ||
      (pendingSeen != null && now - pendingSeen.getTime() < ONLINE_WINDOW_MS);
    const connectorTypes = c.evses.flatMap((e) => e.connectors.map((k) => k.type));
    const connectorSummary =
      connectorTypes.length === 0
        ? "—"
        : connectorTypes.length === 1
          ? connectorTypes[0]
          : `${connectorTypes.length}× ${[...new Set(connectorTypes)].join("/")}`;
    // Connector status with two-source fallback. Prefer OCPP because
    // it's per-connector and authoritative; fall back to Zaptec's
    // per-charger ChargerOperationMode (StateId 710) when OCPP is
    // silent (e.g. anonymous charger that hasn't authenticated against
    // our gateway). The source field tells the UI which it is.
    const vendorStatus = liveSnapshot?.vendorConnectorStatus ?? null;
    const connectors = c.evses.flatMap((e) =>
      e.connectors.map((k) => {
        const ocppReal = isRealOcppStatus(k.status);
        const useVendor = !ocppReal && vendorStatus != null;
        return {
          evseIndex: e.evseIndex,
          connectorIndex: k.connectorIndex,
          type: k.type,
          status: useVendor ? vendorStatus : k.status,
          errorCode: useVendor ? null : k.errorCode,
          statusUpdatedAt: useVendor
            ? null
            : k.statusUpdatedAt
              ? new Date(k.statusUpdatedAt).toISOString()
              : null,
          source: ocppReal ? "ocpp" : useVendor ? "vendor" : null,
        } as SiteTreeChargerNode["connectors"][number];
      }),
    );
    return {
      chargingStationId: c.siteAssetId,
      ocppIdentityId: identity?.id ?? null,
      identityString: identity?.identityString ?? null,
      vendor: c.vendor,
      model: c.model,
      serialNumber: c.serialNumber,
      displayName: c.siteAsset.displayName,
      online,
      apiActive,
      ocppActive,
      authRequired,
      onlineSince: liveSnapshot ? liveSnapshot.onlineSince : null,
      // Disconnect count needs gateway-side WebSocket lifecycle event
      // tracking that we don't have yet — Zaptec REST doesn't expose
      // it either. Reserved as a stable null so the UI placeholder
      // maps cleanly when the data lands.
      disconnectsPast24h: null,
      // Effective lifetime kWh: prefer the live Zaptec read, fall back
      // to the persisted cache when Zaptec is silent (offline charger,
      // decommissioned charger, vendor API down). Take the max so a
      // stale-cached value can't show higher than reality.
      lifetimeEnergyKWh:
        liveSnapshot?.lifetimeEnergyKWh != null && c.lifetimeKwhCached != null
          ? Math.max(liveSnapshot.lifetimeEnergyKWh, c.lifetimeKwhCached)
          : (liveSnapshot?.lifetimeEnergyKWh ?? c.lifetimeKwhCached ?? null),
      decommissioned: liveSnapshot?.decommissioned ?? null,
      status: identity?.status ?? "—",
      lastSeenAt: lastSeen ? new Date(lastSeen).toISOString() : null,
      connectorSummary,
      connectors,
    };
  }

  function sumKwh(nodes: SiteTreeChargerNode[]): number | null {
    let total = 0;
    let any = false;
    for (const n of nodes) {
      if (n.lifetimeEnergyKWh != null) {
        total += n.lifetimeEnergyKWh;
        any = true;
      }
    }
    return any ? total : null;
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
      lifetimeEnergyKWhTotal: sumKwh(children),
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

  // When the operator is hiding decommissioned chargers (the default),
  // we drop them out of the rendered tree entirely — including from
  // their parent's kWh totals and online/offline counts. Keeps the
  // numbers consistent with what's visible. Toggle ON for the
  // decommissioned-fleet view (sums then include retired hardware's
  // lifetime energy).
  const visible = (n: SiteTreeChargerNode): boolean =>
    includeDecommissioned || n.decommissioned !== true;

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
          .map(chargerNode)
          .filter(visible);
        return circuitNode(cir, cirChargers);
      });

      const directChargers = installChargers
        .filter((c) => c.circuitId == null)
        .map(chargerNode)
        .filter(visible);

      let instOn = 0;
      let instOff = 0;
      const tally = (n: SiteTreeChargerNode) => (n.online ? instOn++ : instOff++);
      circuitNodes.forEach((c) => c.chargers.forEach(tally));
      directChargers.forEach(tally);
      online += instOn;
      offline += instOff;

      const allInstChargers = [
        ...circuitNodes.flatMap((c) => c.chargers),
        ...directChargers,
      ];
      return {
        id: inst.id,
        displayName: inst.displayName,
        vendorSlug: inst.vendor?.slug ?? null,
        onboardingStatus: inst.onboardingStatus,
        circuits: circuitNodes,
        directChargers,
        chargersOnline: instOn,
        chargersOffline: instOff,
        lifetimeEnergyKWhTotal: sumKwh(allInstChargers),
      };
    });

    // Orphan circuits (under site but no installation) and their chargers.
    const orphanCircuits = siteCircuits
      .filter((c) => c.installationId == null)
      .map((cir) => {
        const kids = siteChargers
          .filter((c) => c.installationId == null && c.circuitId === cir.id)
          .map(chargerNode)
          .filter(visible);
        kids.forEach((n) => (n.online ? online++ : offline++));
        return circuitNode(cir, kids);
      });

    // Orphan chargers (no installation, no circuit).
    const orphanChargers = siteChargers
      .filter((c) => c.installationId == null && c.circuitId == null)
      .map(chargerNode)
      .filter(visible);
    orphanChargers.forEach((n) => (n.online ? online++ : offline++));

    const allSiteChargers: SiteTreeChargerNode[] = [
      ...installationNodes.flatMap((i) => [...i.circuits.flatMap((c) => c.chargers), ...i.directChargers]),
      ...orphanCircuits.flatMap((c) => c.chargers),
      ...orphanChargers,
    ];
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
      lifetimeEnergyKWhTotal: sumKwh(allSiteChargers),
    };
  });
}
