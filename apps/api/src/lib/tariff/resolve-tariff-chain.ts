// Tariff-chain resolver — Sprint 8.3 / Rule 5 territory.
//
// Given a session's location (siteId, chargingStationId), reads the
// configured DSO tariff (anchored on Site) + retailer tariff
// (anchored on Installation) and composes them into a TariffChain
// the pure-function engine can consume.
//
// Anchor tiers per ADR 0008's cost-factor model:
//   • Site.dsoTariffId            → DSO component (Veitur AD1, etc.)
//   • Installation.retailerTariffId → Retailer component (N1, etc.)
//
// For the Iceland production case (Veitur AD1 + N1 retailer), these
// two are sufficient. Driver-contract overrides + customer-plan
// priority resolution are deferred — see "Out of scope" below.
//
// ─── Out of scope (deferred to later 8.x milestones) ───────────────
//
// • DriverContract overrides — a driver could have a contract that
//   overrides one of the components or adds a per-driver multiplier.
//   Schema supports it (`DriverContractFactorOverride`); resolver
//   doesn't read it yet.
// • CustomerPlan priority chain — Sprint 8 task list mentions a
//   user-override → site-default → host-default → org-default chain.
//   At Iceland production scale, every charger sits under a Site +
//   Installation; the DSO + retailer tariffs ON THOSE entities are
//   the source of truth. Multi-tier customer-plan resolution becomes
//   load-bearing when we onboard customers with negotiated discount
//   tiers — not before.
// • Per-charger tariffs (Charger.chrgrfTariffId) — schema supports
//   them but no canonical use case in production today. Resolver
//   would walk Charger → Installation → Site if needed.
//
// ─── Behaviour on missing tariff rows ─────────────────────────────
//
// If Site.dsoTariffId is null OR the referenced TariffDefinition is
// missing/inactive, throws `dso_tariff_unconfigured`. Same for
// retailer. The session.stopped projection that calls this resolver
// must NOT silently bill at zero — that would corrupt the ledger.
// The throw becomes a queue-consumer transient_failure; CF Queues
// retries. Operator-visible: `[ocpp-q] transient_failure` log lines
// with the session id; fix is to populate Site.dsoTariffId or
// Installation.retailerTariffId via the operator console.

import type { Prisma, PrismaClient } from "../../generated/prisma/client";
import type { TariffChain, TariffComponent, TariffComponentKind } from "./compute-session-cost";

/**
 * Shape of TariffDefinition.computeRule JSONB for the cases the
 * 8.2 engine handles today. Future TOU / fastagjald shapes add
 * new kinds here; the resolver throws on unknown kinds so a stale
 * deploy can't silently pick wrong math.
 */
export type ParsedComputeRule = {
  kind: "flat";
  pricePerKwhMinor: bigint;
};

export class TariffResolutionError extends Error {
  constructor(
    public readonly code:
      | "dso_tariff_unconfigured"
      | "retailer_tariff_unconfigured"
      | "tariff_definition_missing"
      | "tariff_definition_inactive"
      | "compute_rule_unsupported"
      | "compute_rule_malformed"
      | "session_site_not_found"
      | "session_installation_not_found"
      | "vat_rate_mismatch",
    message: string,
  ) {
    super(message);
    this.name = "TariffResolutionError";
  }
}

/**
 * Parse a TariffDefinition.computeRule JSONB into the typed shape
 * the engine accepts. Throws on unknown kinds or malformed values
 * so a misconfigured tariff row doesn't silently bill at zero.
 */
export function parseComputeRule(raw: unknown): ParsedComputeRule {
  if (!raw || typeof raw !== "object") {
    throw new TariffResolutionError(
      "compute_rule_malformed",
      "computeRule must be an object",
    );
  }
  const obj = raw as Record<string, unknown>;
  if (obj.kind === "flat") {
    const price = obj.pricePerKwhMinor;
    if (
      typeof price !== "number" &&
      typeof price !== "string" &&
      typeof price !== "bigint"
    ) {
      throw new TariffResolutionError(
        "compute_rule_malformed",
        "flat.pricePerKwhMinor must be number|string|bigint",
      );
    }
    let asBigInt: bigint;
    try {
      asBigInt = BigInt(price as bigint | number | string);
    } catch {
      throw new TariffResolutionError(
        "compute_rule_malformed",
        "flat.pricePerKwhMinor not coercible to bigint",
      );
    }
    if (asBigInt < 0n) {
      throw new TariffResolutionError(
        "compute_rule_malformed",
        "flat.pricePerKwhMinor must be non-negative",
      );
    }
    return { kind: "flat", pricePerKwhMinor: asBigInt };
  }
  throw new TariffResolutionError(
    "compute_rule_unsupported",
    `computeRule.kind '${obj.kind}' not supported in 8.2; only 'flat' today`,
  );
}

interface ResolveInput {
  siteId: string;
  chargingStationId: string;
}

/**
 * Composite output of {@link resolveTariffChainWithIdsForSession}.
 *
 * Carries both the priced TariffChain (engine input) AND the
 * TariffDefinition UUIDs that backed each component so the caller can
 * record an audit-trail FK alongside the computed cost in
 * `reports.session_ledger`.
 *
 * `dsoTariffDefinitionId` is the singular value written into
 * `session_ledger.tariff_definition_id` — DSO is the primary anchor
 * per ADR 0008. `retailerTariffDefinitionId` is captured for future
 * use (e.g. JSONB breakdown column once schema supports both) but is
 * currently not persisted on the ledger row.
 *
 * Sprint 9 FIX-1 — strictly additive over Sprint 8.3's resolver:
 *   • TariffChain shape unchanged (engine contract preserved)
 *   • Cost math unchanged (Rule 5)
 *   • Tariff selection unchanged (same Site→DSO + Installation→retailer walk)
 *   • Audit-trail-only — captures which TariffDefinition resolved
 */
export interface ResolvedTariffChainWithIds {
  chain: TariffChain;
  dsoTariffDefinitionId: string;
  retailerTariffDefinitionId: string;
}

/**
 * Resolve the TariffChain for a session at the given location.
 *
 * Pure relative to a Prisma client — call with the same `tx` that
 * the session.stopped projection runs in so the lookup sees the
 * just-committed rows.
 *
 * Sprint 9 FIX-1 — delegates to {@link resolveTariffChainWithIdsForSession}
 * and strips the audit IDs to preserve the historical signature. Use the
 * "WithIds" variant at every site that writes to `reports.session_ledger`.
 */
export async function resolveTariffChainForSession(
  db: PrismaClient | Prisma.TransactionClient,
  input: ResolveInput,
): Promise<TariffChain> {
  const resolved = await resolveTariffChainWithIdsForSession(db, input);
  return resolved.chain;
}

/**
 * Same resolver walk as {@link resolveTariffChainForSession} but ALSO
 * returns the TariffDefinition.id of each chain component. Use at every
 * `reports.session_ledger` write site so the row carries an audit-trail
 * FK to the tariff that priced the session.
 *
 * Behaviour, error codes, and component composition are byte-for-byte
 * identical to the historical resolver — this function IS the resolver
 * now; the legacy alias just strips the IDs (test contract preserved).
 */
export async function resolveTariffChainWithIdsForSession(
  db: PrismaClient | Prisma.TransactionClient,
  input: ResolveInput,
): Promise<ResolvedTariffChainWithIds> {
  // 1. Site → DSO tariff
  const site = await db.site.findUnique({
    where: { id: input.siteId },
    select: { id: true, dsoTariffId: true },
  });
  if (!site) {
    throw new TariffResolutionError(
      "session_site_not_found",
      `site ${input.siteId} not found`,
    );
  }
  if (!site.dsoTariffId) {
    throw new TariffResolutionError(
      "dso_tariff_unconfigured",
      `site ${input.siteId} has no dsoTariffId`,
    );
  }
  const dsoTariff = await loadTariffDefinition(db, site.dsoTariffId);

  // 2. ChargingStation → Installation → retailer tariff
  const station = await db.chargingStation.findUnique({
    where: { siteAssetId: input.chargingStationId },
    select: { siteAssetId: true, installationId: true },
  });
  if (!station) {
    throw new TariffResolutionError(
      "session_installation_not_found",
      `chargingStation ${input.chargingStationId} not found`,
    );
  }
  if (!station.installationId) {
    throw new TariffResolutionError(
      "session_installation_not_found",
      `chargingStation ${input.chargingStationId} has no installation`,
    );
  }
  const installation = await db.installation.findUnique({
    where: { id: station.installationId },
    select: { id: true, retailerTariffId: true },
  });
  if (!installation) {
    throw new TariffResolutionError(
      "session_installation_not_found",
      `installation ${station.installationId} not found`,
    );
  }
  if (!installation.retailerTariffId) {
    throw new TariffResolutionError(
      "retailer_tariff_unconfigured",
      `installation ${installation.id} has no retailerTariffId`,
    );
  }
  const retailerTariff = await loadTariffDefinition(db, installation.retailerTariffId);

  // 3. Validate VAT rates agree (engine requires uniform VAT)
  if (Number(dsoTariff.vatRatePct) !== Number(retailerTariff.vatRatePct)) {
    throw new TariffResolutionError(
      "vat_rate_mismatch",
      `DSO vat ${dsoTariff.vatRatePct} ≠ retailer vat ${retailerTariff.vatRatePct}`,
    );
  }
  if (dsoTariff.currency !== retailerTariff.currency) {
    throw new TariffResolutionError(
      "vat_rate_mismatch",
      `DSO currency ${dsoTariff.currency} ≠ retailer currency ${retailerTariff.currency}`,
    );
  }
  if (dsoTariff.currency !== "ISK") {
    throw new TariffResolutionError(
      "vat_rate_mismatch",
      `Sprint 8.x ships ISK only; got ${dsoTariff.currency}`,
    );
  }

  // 4. Compose TariffChain
  const dsoComponent: TariffComponent = {
    kind: "dso",
    code: dsoTariff.displayName,
    displayName: dsoTariff.displayName,
    pricePerKwhMinor: parseComputeRule(dsoTariff.computeRule).pricePerKwhMinor,
    vatRatePct: Number(dsoTariff.vatRatePct),
  };
  const retailerComponent: TariffComponent = {
    kind: "retailer",
    code: retailerTariff.displayName,
    displayName: retailerTariff.displayName,
    pricePerKwhMinor: parseComputeRule(retailerTariff.computeRule).pricePerKwhMinor,
    vatRatePct: Number(retailerTariff.vatRatePct),
  };

  const chain: TariffChain = {
    currency: "ISK",
    components: [dsoComponent, retailerComponent],
  };
  return {
    chain,
    dsoTariffDefinitionId: dsoTariff.id,
    retailerTariffDefinitionId: retailerTariff.id,
  };
}

interface LoadedTariffDefinition {
  id: string;
  displayName: string;
  computeRule: unknown;
  vatRatePct: unknown;
  currency: string;
  status: string;
}

async function loadTariffDefinition(
  db: PrismaClient | Prisma.TransactionClient,
  id: string,
): Promise<LoadedTariffDefinition> {
  const td = await db.tariffDefinition.findUnique({
    where: { id },
    select: {
      id: true,
      displayName: true,
      computeRule: true,
      vatRatePct: true,
      currency: true,
      status: true,
    },
  });
  if (!td) {
    throw new TariffResolutionError(
      "tariff_definition_missing",
      `TariffDefinition ${id} not found`,
    );
  }
  if (td.status !== "active") {
    throw new TariffResolutionError(
      "tariff_definition_inactive",
      `TariffDefinition ${id} status=${td.status}`,
    );
  }
  return td as LoadedTariffDefinition;
}

/**
 * Re-export the kind union so callers don't need to import from
 * compute-session-cost when they only deal with the resolver shape.
 */
export type { TariffComponentKind };
