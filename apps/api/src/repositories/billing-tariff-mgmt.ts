// Write-side repository for TariffDefinition management.
// Sprint 9 — Track C (tariff edit/create/clone).
//
// Rule 5 invariants enforced here (not just in the route layer):
//
//   - createTariff: always creates status = 'draft'. Never 'active'.
//   - patchTariff: returns { code: "active_immutable" } if caller tries to
//     mutate resolution fields on an active tariff. Returns
//     { code: "retired_immutable" } for retired tariffs.
//   - publishTariff: draft → active transition only. Sets valid_from = now()
//     if not already set. Does NOT chain-retire prior active versions of the
//     same family_code (family_code column doesn't exist yet — see TODO).
//   - retireTariff: active → retired only (draft → retired allowed as
//     "discard"). Sets valid_to = now(). Returns binding-count warning.
//   - cloneTariff: always creates a new draft regardless of source status.
//
// BigInt money: pricePerKwhMinor / priceMinor are transported as strings.
// All output serialises BigInt via .toString() before leaving this module.

import type { PrismaClient } from "../generated/prisma/client";
import type {
  CreateTariffInput,
  PatchTariffInput,
} from "../lib/billing/tariff-zod";
import { ACTIVE_TARIFF_MUTABLE_FIELDS } from "../lib/billing/tariff-zod";

// ─────────────────────────────────────────────────────────────────────────────
// UI shape
// ─────────────────────────────────────────────────────────────────────────────

export interface TariffMgmtRow {
  id: string;
  orgId: string;
  orgDisplayName: string;
  costFactorId: string;
  costFactorCode: string;
  costFactorDisplayName: string;
  displayName: string;
  currency: string;
  vatRatePct: string;
  computeRule: Record<string, unknown>;
  computeRuleKind: string | null;
  pricePerKwhMinor: string | null;
  status: string;
  validFrom: string;
  validUntil: string | null;
  createdAt: string;
  updatedAt: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Error shapes (discriminated union codes for the route layer)
// ─────────────────────────────────────────────────────────────────────────────

export type TariffMgmtError =
  | { code: "not_found" }
  | { code: "active_immutable"; suggestion: "clone_then_edit" }
  | { code: "retired_immutable" }
  | { code: "invalid_transition"; from: string; to: string }
  | { code: "already_active" }
  | { code: "already_retired" }
  | { code: "not_draft" };

// ─────────────────────────────────────────────────────────────────────────────
// Helper: map DB row → UI shape
// ─────────────────────────────────────────────────────────────────────────────

function mapTariffRow(
  row: Awaited<ReturnType<typeof fetchTariff>>,
): TariffMgmtRow {
  const rule = (row.computeRule as Record<string, unknown>) ?? {};
  return {
    id: row.id,
    orgId: row.orgId,
    orgDisplayName: row.organization.displayName,
    costFactorId: row.costFactor.id,
    costFactorCode: row.costFactor.code,
    costFactorDisplayName: row.costFactor.displayName,
    displayName: row.displayName,
    currency: row.currency,
    vatRatePct: row.vatRatePct.toString(),
    computeRule: rule,
    computeRuleKind: typeof rule.kind === "string" ? rule.kind : null,
    pricePerKwhMinor:
      rule.pricePerKwhMinor !== undefined ? String(rule.pricePerKwhMinor) : null,
    status: row.status,
    validFrom: row.validFrom.toISOString(),
    validUntil: row.validUntil?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal fetch helper
// ─────────────────────────────────────────────────────────────────────────────

async function fetchTariff(db: PrismaClient, id: string) {
  const row = await db.tariffDefinition.findUnique({
    where: { id },
    include: {
      organization: { select: { id: true, displayName: true } },
      costFactor: {
        select: { id: true, code: true, displayName: true },
      },
    },
  });
  if (!row) throw Object.assign(new Error("not_found"), { code: "not_found" });
  return row;
}

// ─────────────────────────────────────────────────────────────────────────────
// createTariff — POST /tariffs
//
// Always creates with status = 'draft'. valid_from defaults to now() but
// can be overridden via publishTariff.
// ─────────────────────────────────────────────────────────────────────────────

export async function createTariff(
  db: PrismaClient,
  input: CreateTariffInput,
): Promise<TariffMgmtRow> {
  const row = await db.tariffDefinition.create({
    data: {
      orgId: input.orgId,
      costFactorId: input.costFactorId,
      displayName: input.displayName,
      currency: input.currency,
      vatRatePct: input.vatRatePct,
      computeRule: input.computeRule as object,
      // Draft tariffs get a provisional validFrom = now(). publish will
      // flip status and confirm the date in a transaction.
      validFrom: new Date(),
      status: "draft",
    },
    include: {
      organization: { select: { id: true, displayName: true } },
      costFactor: { select: { id: true, code: true, displayName: true } },
    },
  });
  return mapTariffRow(row);
}

// ─────────────────────────────────────────────────────────────────────────────
// patchTariff — PATCH /tariffs/:id
//
// Rule 5 enforcement:
//   - active: only displayName allowed; anything else → active_immutable
//   - retired: nothing allowed → retired_immutable
//   - draft: any field in PatchTariffInput allowed
// ─────────────────────────────────────────────────────────────────────────────

export async function patchTariff(
  db: PrismaClient,
  id: string,
  input: PatchTariffInput,
): Promise<TariffMgmtRow | TariffMgmtError> {
  let current: Awaited<ReturnType<typeof fetchTariff>>;
  try {
    current = await fetchTariff(db, id);
  } catch {
    return { code: "not_found" };
  }

  if (current.status === "retired") {
    return { code: "retired_immutable" };
  }

  if (current.status === "active") {
    // Enforce active-tariff whitelist: only displayName may be patched.
    const attemptedKeys = Object.keys(input) as Array<keyof PatchTariffInput>;
    const forbidden = attemptedKeys.filter(
      (k) => !ACTIVE_TARIFF_MUTABLE_FIELDS.has(k),
    );
    if (forbidden.length > 0) {
      return { code: "active_immutable", suggestion: "clone_then_edit" };
    }
  }

  // Build Prisma update data. Only include keys that are present in input.
  const data: Record<string, unknown> = {};
  if (input.displayName !== undefined) data.displayName = input.displayName;
  if (input.costFactorId !== undefined) data.costFactorId = input.costFactorId;
  if (input.currency !== undefined) data.currency = input.currency;
  if (input.vatRatePct !== undefined) data.vatRatePct = input.vatRatePct;
  if (input.computeRule !== undefined)
    data.computeRule = input.computeRule as object;
  if (input.validFrom !== undefined) data.validFrom = new Date(input.validFrom);
  if ("validUntil" in input) {
    data.validUntil = input.validUntil ? new Date(input.validUntil) : null;
  }

  const updated = await db.tariffDefinition.update({
    where: { id },
    data,
    include: {
      organization: { select: { id: true, displayName: true } },
      costFactor: { select: { id: true, code: true, displayName: true } },
    },
  });
  return mapTariffRow(updated);
}

// ─────────────────────────────────────────────────────────────────────────────
// cloneTariff — POST /tariffs/:id/clone
//
// Creates a new draft with the source tariff's fields. Status is always
// 'draft' regardless of source. validFrom is reset to now().
// ─────────────────────────────────────────────────────────────────────────────

export async function cloneTariff(
  db: PrismaClient,
  sourceId: string,
): Promise<TariffMgmtRow | TariffMgmtError> {
  let source: Awaited<ReturnType<typeof fetchTariff>>;
  try {
    source = await fetchTariff(db, sourceId);
  } catch {
    return { code: "not_found" };
  }

  const cloned = await db.tariffDefinition.create({
    data: {
      orgId: source.orgId,
      costFactorId: source.costFactorId,
      displayName: `${source.displayName} (copy)`,
      currency: source.currency,
      vatRatePct: source.vatRatePct,
      computeRule: source.computeRule as object,
      validFrom: new Date(),
      status: "draft",
    },
    include: {
      organization: { select: { id: true, displayName: true } },
      costFactor: { select: { id: true, code: true, displayName: true } },
    },
  });
  return mapTariffRow(cloned);
}

// ─────────────────────────────────────────────────────────────────────────────
// publishTariff — POST /tariffs/:id/publish
//
// Transitions draft → active in a single transaction.
// Sets valid_from = now() if it's in the past (keep future dates as-is).
//
// TODO ADR 0021: chain-retire prior active version of same family_code when
// family_code column is added to the schema. For now just flip this draft
// to active without touching sibling rows.
// ─────────────────────────────────────────────────────────────────────────────

export async function publishTariff(
  db: PrismaClient,
  id: string,
): Promise<TariffMgmtRow | TariffMgmtError> {
  let current: Awaited<ReturnType<typeof fetchTariff>>;
  try {
    current = await fetchTariff(db, id);
  } catch {
    return { code: "not_found" };
  }

  if (current.status !== "draft") {
    if (current.status === "active") return { code: "already_active" };
    return { code: "not_draft" };
  }

  const now = new Date();
  // If validFrom is in the future, keep it. Otherwise anchor to now.
  const validFrom =
    current.validFrom > now ? current.validFrom : now;

  const published = await db.$transaction(async (tx) => {
    // TODO ADR 0021: chain-retire prior active version of same family_code
    // (family_code column not yet added — this is future work per ADR 0021).
    return tx.tariffDefinition.update({
      where: { id },
      data: { status: "active", validFrom },
      include: {
        organization: { select: { id: true, displayName: true } },
        costFactor: { select: { id: true, code: true, displayName: true } },
      },
    });
  });
  return mapTariffRow(published);
}

// ─────────────────────────────────────────────────────────────────────────────
// retireTariff — POST /tariffs/:id/retire
//
// active → retired: sets valid_until = now()
// draft → retired: discard path (sets valid_until = now())
// retired → retired: already_retired error
//
// Returns binding counts as a warning (does NOT block retirement).
// ─────────────────────────────────────────────────────────────────────────────

export interface RetireTariffResult {
  tariff: TariffMgmtRow;
  warning: string | null;
  bindingCounts: {
    sites: number;
    installations: number;
    stations: number;
    driverContracts: number;
  };
}

export async function retireTariff(
  db: PrismaClient,
  id: string,
): Promise<RetireTariffResult | { code: "not_found" } | { code: "already_retired" }> {
  let current: Awaited<ReturnType<typeof fetchTariff>>;
  try {
    current = await fetchTariff(db, id);
  } catch {
    return { code: "not_found" };
  }

  if (current.status === "retired") {
    return { code: "already_retired" };
  }

  // Query binding counts just-in-time (not pre-loaded on detail render —
  // per the Rule 5 anchored-bindings note in the brief).
  const [siteCounts, installCounts, stationCounts] = await Promise.all([
    db.site.count({
      where: {
        OR: [
          { dsoTariffId: id },
          { usrfTariffId: id },
          { usrfPremTariffId: id },
          { xtrrfTariffId: id },
          { spvivfTariffId: id },
        ],
      },
    }),
    db.installation.count({ where: { retailerTariffId: id } }),
    db.chargingStation.count({ where: { chrgrfTariffId: id } }),
  ]);

  // DriverContract references wrkpfTariffId — fetch this too
  const driverContractCount = await db.driverContract.count({
    where: { wrkpfTariffId: id },
  });

  const totalBindings =
    siteCounts + installCounts + stationCounts + driverContractCount;

  const now = new Date();
  const retired = await db.tariffDefinition.update({
    where: { id },
    data: {
      status: "retired",
      validUntil: current.validUntil ?? now,
    },
    include: {
      organization: { select: { id: true, displayName: true } },
      costFactor: { select: { id: true, code: true, displayName: true } },
    },
  });

  const bindingCounts = {
    sites: siteCounts,
    installations: installCounts,
    stations: stationCounts,
    driverContracts: driverContractCount,
  };

  const warning =
    totalBindings > 0
      ? `Tariff retired but still referenced by ${totalBindings} binding(s): ` +
        [
          siteCounts > 0 ? `${siteCounts} site(s)` : null,
          installCounts > 0 ? `${installCounts} installation(s)` : null,
          stationCounts > 0 ? `${stationCounts} station(s)` : null,
          driverContractCount > 0
            ? `${driverContractCount} driver contract(s)`
            : null,
        ]
          .filter(Boolean)
          .join(", ") +
        ". Sessions resolving through these anchors will now fail to find an active tariff."
      : null;

  return { tariff: mapTariffRow(retired), warning, bindingCounts };
}
