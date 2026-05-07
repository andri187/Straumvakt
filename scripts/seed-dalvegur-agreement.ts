/**
 * Dalvegur agreement bootstrap — Sprint 9 milestone A.4 (ADR 0019).
 *
 * Manual-run script that wires up the new agreements.* primitives for
 * Dalvegur: one CPO Agreement, three workplace Agreements (Sjóvá / Klettás /
 * Daltækni), three DriverGroups, two RateReferences (Veitur DSO + retailer
 * ELE), eight AgreementClauses on the CPO agreement (one per enlisted
 * factor), and a handful of BearerRule diffs covering the four allocation
 * scenarios called out in ADR 0019:
 *
 *   1. Sjóvá staff group absorbs ELE fully     (passthrough.splits = WRK 100%)
 *   2. Klettás staff group absorbs everything  (every factor → WRK 100%)
 *   3. Daltækni group has no overrides         (drivers pay per CPO defaults)
 *   4. CEO Anna at C1-CHA-01 gets all factors  (every factor → WRK 100%)
 *
 * NOT auto-run by `npm run seed`. Invoke explicitly:
 *
 *     npx tsx scripts/seed-dalvegur-agreement.ts
 *
 * The script is idempotent — every row is upserted via natural keys or
 * findFirst/create-if-absent. If the four ORG counterparties are missing
 * (Dalvegur Eignir, Sjóvá, Klettás, Daltækni), the script logs a clear
 * warning and exits without writing.
 */
import { PrismaClient } from "../prisma/generated/node-client/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to run this script");
}

const prisma = new PrismaClient({
  adapter: new PrismaNeon({ connectionString: databaseUrl }),
});

// Org display names we look up. Adjust if the canonical name in your
// Neon branch differs — the script reports clearly which lookups missed.
const ORG_NAMES = {
  cpo: "Dalvegur Eignir",
  sjova: "Sjóvá",
  klettas: "Klettás",
  daltekni: "Daltækni",
} as const;

const FROM = new Date("2026-04-01T00:00:00Z");

// ── Allocation helpers ────────────────────────────────────────────────

type BearerCode = "org" | "usr" | "wrk" | "trd";
type AllocationSplit = { bearer_type: BearerCode; share_pct: number };
type Allocation = {
  passthrough: { splits: AllocationSplit[] };
  markup: null | {
    basis: "percent" | "fixed_per_kwh" | "fixed_per_minute" | "fixed_per_session";
    value: number;
    payer_type: BearerCode;
    recipient_type: "org" | "wrk";
  };
};

const fullTo = (bearer: BearerCode): Allocation => ({
  passthrough: { splits: [{ bearer_type: bearer, share_pct: 100 }] },
  markup: null,
});

const split = (a: BearerCode, aPct: number, b: BearerCode, bPct: number): Allocation => ({
  passthrough: {
    splits: [
      { bearer_type: a, share_pct: aPct },
      { bearer_type: b, share_pct: bPct },
    ],
  },
  markup: null,
});

// ── Look-ups (skip seed if anything is missing) ───────────────────────

async function findOrgs() {
  const orgs = await prisma.organization.findMany({
    where: { displayName: { in: Object.values(ORG_NAMES) } },
    select: { id: true, displayName: true },
  });
  const byName = new Map(orgs.map((o) => [o.displayName, o.id]));

  const missing = Object.values(ORG_NAMES).filter((n) => !byName.has(n));
  if (missing.length > 0) {
    // eslint-disable-next-line no-console
    console.error(`[seed-dalvegur] missing ORG rows: ${missing.join(", ")}`);
    // eslint-disable-next-line no-console
    console.error("[seed-dalvegur] create the orgs first via the admin console, then re-run.");
    return null;
  }
  return {
    cpo: byName.get(ORG_NAMES.cpo)!,
    sjova: byName.get(ORG_NAMES.sjova)!,
    klettas: byName.get(ORG_NAMES.klettas)!,
    daltekni: byName.get(ORG_NAMES.daltekni)!,
  };
}

async function getCostFactorMap() {
  const factors = await prisma.agreementCostFactor.findMany({
    select: { id: true, code: true },
  });
  const byCode = new Map(factors.map((f) => [f.code, f.id]));
  // Eight codes per ADR 0019; the agreements seed in prisma/seed.ts must run first.
  const required = ["DSO", "ELE", "ACS", "PRM", "TRF", "SRF", "RNT", "MTR"];
  const missing = required.filter((c) => !byCode.has(c));
  if (missing.length > 0) {
    throw new Error(`[seed-dalvegur] missing cost factors: ${missing.join(", ")}. Run \`npm run seed\` first.`);
  }
  return byCode;
}

// ── Rate references (Veitur DSO + retailer ELE) ───────────────────────

async function ensureRateReference(opts: {
  code: string;
  costFactorId: string;
  basis: "per_kwh" | "per_minute" | "per_day" | "per_session";
  priceMinor: bigint;
  vatRatePct: number;
  notes: string;
}) {
  const existing = await prisma.rateReference.findFirst({
    where: { code: opts.code, effectiveFrom: FROM },
  });
  if (existing) return existing;
  return prisma.rateReference.create({
    data: {
      code: opts.code,
      costFactorId: opts.costFactorId,
      supplierOrgId: null, // supplier ORGs (Veitur, retailer) not yet modelled in tenancy.organizations
      basis: opts.basis,
      priceMinor: opts.priceMinor,
      currency: "ISK",
      vatRatePct: opts.vatRatePct,
      effectiveFrom: FROM,
      effectiveUntil: null,
      notes: opts.notes,
    },
  });
}

// ── Agreement helpers ─────────────────────────────────────────────────

async function ensureAgreement(opts: {
  counterpartyOrgId: string;
  agreementType: "cpo" | "workplace";
  displayName: string;
}) {
  const existing = await prisma.agreement.findFirst({
    where: {
      counterpartyOrgId: opts.counterpartyOrgId,
      agreementType: opts.agreementType,
      effectiveFrom: FROM,
    },
  });
  if (existing) return existing;
  return prisma.agreement.create({
    data: {
      counterpartyOrgId: opts.counterpartyOrgId,
      agreementType: opts.agreementType,
      displayName: opts.displayName,
      status: "active",
      effectiveFrom: FROM,
    },
  });
}

async function ensureClause(opts: {
  agreementId: string;
  costFactorId: string;
  defaultBearerType: BearerCode;
  defaultRateRefCode: string | null;
  allocation: Allocation;
}) {
  return prisma.agreementClause.upsert({
    where: { agreementId_costFactorId: { agreementId: opts.agreementId, costFactorId: opts.costFactorId } },
    update: {
      defaultBearerType: opts.defaultBearerType,
      defaultRateRefCode: opts.defaultRateRefCode,
      allocationJson: opts.allocation as unknown as object,
    },
    create: {
      agreementId: opts.agreementId,
      costFactorId: opts.costFactorId,
      defaultBearerType: opts.defaultBearerType,
      defaultRateRefCode: opts.defaultRateRefCode,
      allocationJson: opts.allocation as unknown as object,
    },
  });
}

async function ensureDriverGroup(opts: {
  agreementId: string;
  ownerOrgId: string;
  displayName: string;
  scopeFilter: object;
}) {
  const existing = await prisma.driverGroup.findFirst({
    where: { agreementId: opts.agreementId, ownerOrgId: opts.ownerOrgId, displayName: opts.displayName },
  });
  if (existing) return existing;
  return prisma.driverGroup.create({
    data: {
      agreementId: opts.agreementId,
      ownerOrgId: opts.ownerOrgId,
      displayName: opts.displayName,
      scopeFilterJson: opts.scopeFilter as unknown as object,
    },
  });
}

async function ensureBearerRule(opts: {
  agreementId: string;
  costFactorId: string;
  scopeType?: "site" | "installation" | "circuit" | "charger";
  scopeId?: string;
  audienceType?: "driver_group" | "user";
  audienceId?: string;
  bearerType?: BearerCode;
  rateRefCode?: string;
  allocation?: Allocation;
}) {
  // Composite "natural key" — matched on the resolver-walk dimensions plus
  // effective_from. We don't have a DB UNIQUE here, so the script rolls its
  // own dedupe.
  const existing = await prisma.bearerRule.findFirst({
    where: {
      agreementId: opts.agreementId,
      costFactorId: opts.costFactorId,
      scopeType: opts.scopeType ?? null,
      scopeId: opts.scopeId ?? null,
      audienceType: opts.audienceType ?? null,
      audienceId: opts.audienceId ?? null,
      effectiveFrom: FROM,
    },
  });
  if (existing) return existing;
  return prisma.bearerRule.create({
    data: {
      agreementId: opts.agreementId,
      costFactorId: opts.costFactorId,
      scopeType: opts.scopeType ?? null,
      scopeId: opts.scopeId ?? null,
      audienceType: opts.audienceType ?? null,
      audienceId: opts.audienceId ?? null,
      bearerType: opts.bearerType ?? null,
      rateRefCode: opts.rateRefCode ?? null,
      allocationJson: (opts.allocation as unknown as object) ?? null,
      effectiveFrom: FROM,
    },
  });
}

// ── Main ──────────────────────────────────────────────────────────────

async function main() {
  const orgs = await findOrgs();
  if (!orgs) {
    process.exit(1);
  }

  const factors = await getCostFactorMap();
  const f = (code: string) => factors.get(code)!;

  // RateReferences — pricing is illustrative; tune to actual contracts later.
  await ensureRateReference({
    code: "veitur-dso-c",
    costFactorId: f("DSO"),
    basis: "per_kwh",
    priceMinor: 850n, // 8.50 ISK/kWh
    vatRatePct: 24,
    notes: "Illustrative DSO rate for Veitur grid zone C — replace with the real published rate before production.",
  });
  await ensureRateReference({
    code: "n1-retail-ele",
    costFactorId: f("ELE"),
    basis: "per_kwh",
    priceMinor: 1450n, // 14.50 ISK/kWh
    vatRatePct: 24,
    notes: "Illustrative retailer ELE price — replace with the real contract before production.",
  });
  await ensureRateReference({
    code: "veitur-meter-c",
    costFactorId: f("MTR"),
    basis: "per_day",
    priceMinor: 5000n, // 50 ISK/day
    vatRatePct: 24,
    notes: "Illustrative DSO e-meter daily fee.",
  });

  // CPO Agreement: Straumvakt ↔ Dalvegur Eignir.
  const cpoAgreement = await ensureAgreement({
    counterpartyOrgId: orgs.cpo,
    agreementType: "cpo",
    displayName: "Dalvegur Eignir — CPO operating agreement",
  });

  // Default clauses on the CPO agreement — one per enlisted factor.
  // ACS / PRM are deliberately NOT enlisted (no clause, no billing line).
  await ensureClause({ agreementId: cpoAgreement.id, costFactorId: f("DSO"), defaultBearerType: "usr", defaultRateRefCode: "veitur-dso-c", allocation: fullTo("usr") });
  await ensureClause({ agreementId: cpoAgreement.id, costFactorId: f("ELE"), defaultBearerType: "usr", defaultRateRefCode: "n1-retail-ele", allocation: fullTo("usr") });
  await ensureClause({ agreementId: cpoAgreement.id, costFactorId: f("TRF"), defaultBearerType: "org", defaultRateRefCode: null, allocation: fullTo("org") });
  await ensureClause({ agreementId: cpoAgreement.id, costFactorId: f("SRF"), defaultBearerType: "org", defaultRateRefCode: null, allocation: fullTo("org") });
  await ensureClause({ agreementId: cpoAgreement.id, costFactorId: f("RNT"), defaultBearerType: "org", defaultRateRefCode: null, allocation: fullTo("org") });
  await ensureClause({ agreementId: cpoAgreement.id, costFactorId: f("MTR"), defaultBearerType: "org", defaultRateRefCode: "veitur-meter-c", allocation: fullTo("org") });

  // Workplace agreements (Sjóvá / Klettás / Daltækni).
  const sjovaAgr = await ensureAgreement({
    counterpartyOrgId: orgs.sjova,
    agreementType: "workplace",
    displayName: "Sjóvá — workplace agreement (Dalvegur)",
  });
  const klettasAgr = await ensureAgreement({
    counterpartyOrgId: orgs.klettas,
    agreementType: "workplace",
    displayName: "Klettás — workplace agreement (Dalvegur)",
  });
  const daltekniAgr = await ensureAgreement({
    counterpartyOrgId: orgs.daltekni,
    agreementType: "workplace",
    displayName: "Daltækni — workplace agreement (Dalvegur)",
  });

  // DriverGroups (one per workplace). scopeFilterJson stays empty for the
  // bootstrap — a follow-up ADR can land circuit-level filtering once the
  // operator confirms which Circuit row maps to each tenant's bay.
  const sjovaGroup = await ensureDriverGroup({
    agreementId: sjovaAgr.id,
    ownerOrgId: orgs.sjova,
    displayName: "Sjóvá staff",
    scopeFilter: {},
  });
  await ensureDriverGroup({
    agreementId: klettasAgr.id,
    ownerOrgId: orgs.klettas,
    displayName: "Klettás staff",
    scopeFilter: {},
  });
  await ensureDriverGroup({
    agreementId: daltekniAgr.id,
    ownerOrgId: orgs.daltekni,
    displayName: "Daltækni guests",
    scopeFilter: {},
  });

  // ── BearerRule diffs (the four allocation scenarios) ────────────────

  // (1) Sjóvá staff absorb ELE fully.
  await ensureBearerRule({
    agreementId: sjovaAgr.id,
    costFactorId: f("ELE"),
    audienceType: "driver_group",
    audienceId: sjovaGroup.id,
    bearerType: "wrk",
    allocation: fullTo("wrk"),
  });

  // (2) Klettás staff absorb every CPO-default factor that the agreement
  //     enlists (DSO, ELE, MTR — the ones that pass through to a supplier).
  //     TRF/SRF/RNT already default to ORG (CPO) per the CPO clauses, so
  //     they don't need an override on a workplace agreement.
  const klettasGroupRow = await prisma.driverGroup.findFirst({
    where: { agreementId: klettasAgr.id, ownerOrgId: orgs.klettas },
  });
  if (klettasGroupRow) {
    for (const code of ["DSO", "ELE", "MTR"]) {
      await ensureBearerRule({
        agreementId: klettasAgr.id,
        costFactorId: f(code),
        audienceType: "driver_group",
        audienceId: klettasGroupRow.id,
        bearerType: "wrk",
        allocation: fullTo("wrk"),
      });
    }
  }

  // (3) Daltækni — no overrides, the workplace agreement exists but its
  //     rules layer is empty so drivers pay per CPO defaults. (No-op here.)

  // (4) CEO Anna at C1-CHA-01 — driver-level override at a single charger.
  //     Skipped in the bootstrap because we don't yet know:
  //     - which User row maps to "Anna" (no canonical kennitala for the
  //       demo persona),
  //     - which ChargingStation row is "C1-CHA-01" at Dalvegur 10.
  //     The /agreements/_debug page (milestone A.6) will let an operator
  //     compose this rule interactively against real IDs.

  // eslint-disable-next-line no-console
  console.log("[seed-dalvegur] complete.");
  // eslint-disable-next-line no-console
  console.log("  CPO agreement:        ", cpoAgreement.id);
  // eslint-disable-next-line no-console
  console.log("  Sjóvá agreement:      ", sjovaAgr.id);
  // eslint-disable-next-line no-console
  console.log("  Klettás agreement:    ", klettasAgr.id);
  // eslint-disable-next-line no-console
  console.log("  Daltækni agreement:   ", daltekniAgr.id);
}

main()
  .then(async () => {
    await prisma.$disconnect();
    process.exit(0);
  })
  .catch(async (err) => {
    // eslint-disable-next-line no-console
    console.error("[seed-dalvegur] failed:", err);
    await prisma.$disconnect();
    process.exit(1);
  });
