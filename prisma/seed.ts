/**
 * Prisma seed — Sprint 0.
 *
 * Reference data only. No mock entity rows (Rule 6).
 *
 * Tenants, hosts, sites and chargers are created through the operator
 * console (Sprint 9.1 onboarding wizard) or manually via admin endpoints
 * during sprint dogfood. Never via this seed.
 *
 * What this seed does populate:
 *   • Hardware Catalog — vendors and models the platform supports.
 *     Reference data, not operational inventory. Idempotent upserts so
 *     it can run on every `prisma db seed` invocation without creating
 *     duplicates.
 *
 * Sprint 0.6 scope: one vendor row (Zaptec), one model row (Zaptec Pro)
 * with an empty profile. Expansion — Easee, Kempower, Shelly, generic
 * OCPP — deferred per the operator's instruction ("to be defined
 * later"). ADR 0002 governs the catalog design.
 */
import { PrismaClient } from "./generated/node-client/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to run the seed");
}

const prisma = new PrismaClient({
  adapter: new PrismaNeon({ connectionString: databaseUrl }),
});

async function seedHardwareCatalog() {
  const zaptec = await prisma.hardwareVendor.upsert({
    where: { slug: "zaptec" },
    update: {},
    create: {
      slug: "zaptec",
      displayName: "Zaptec",
      kind: "charger_ac",
      apiKind: "oauth",
    },
  });

  await prisma.hardwareModel.upsert({
    where: {
      vendorId_slug: {
        vendorId: zaptec.id,
        slug: "zaptec-pro",
      },
    },
    update: {},
    create: {
      vendorId: zaptec.id,
      slug: "zaptec-pro",
      displayName: "Zaptec Pro",
      kind: "charger_ac",
      assetClass: "ac",
      credentialScope: "installation",
      // Profile intentionally empty — to be defined later (operator
      // instruction, Sprint 0 close). The Zaptec Pro spec sheet
      // populates rated power, phases, connector types, supported
      // OCPP versions when we reach the actual Zaptec onboarding flow.
      profile: {},
    },
  });

  // eslint-disable-next-line no-console
  console.log("[seed] hardware catalog: Zaptec + Zaptec Pro upserted.");
}

// ── ADR 0008 — pilot cost-factor catalog ─────────────────────────────
const COST_FACTORS = [
  { code: "DSOF", displayName: "DSO Fee", anchorTier: "site" as const, description: "Distribution-system-operator network fee — anchored at the Site (DSO determined by address)." },
  { code: "REPF", displayName: "Retailer Energy Price Fee", anchorTier: "installation" as const, description: "Electricity retailer commodity price — anchored at the Installation." },
  { code: "USRF", displayName: "User Access Fee", anchorTier: "site" as const, description: "Per-session or per-month flat fee for site access." },
  { code: "USRF_PREM", displayName: "Premium User Access Fee", anchorTier: "site" as const, description: "Higher-tier user access fee for differentiated pricing." },
  { code: "XTRRF", displayName: "Extra Tariffs (Idle, etc.)", anchorTier: "site" as const, description: "Per-minute idle fees, surge pricing, etc." },
  { code: "SPVIVF", displayName: "Service Provider / Installer / Vendor Fee", anchorTier: "site" as const, description: "Fee paid to the service contractor handling installation/maintenance." },
  { code: "CHRGRF", displayName: "Charger Rental Fee", anchorTier: "charger" as const, description: "Hardware-rental fee when the charger is rented rather than owned." },
  { code: "WRKPF", displayName: "Workplace Fee", anchorTier: "driver_contract" as const, description: "Workplace-charging fee billed to the employer." },
];

async function seedCostFactorCatalog() {
  for (const f of COST_FACTORS) {
    await prisma.costFactor.upsert({
      where: { code: f.code },
      update: {},
      create: {
        code: f.code,
        displayName: f.displayName,
        description: f.description,
        anchorTier: f.anchorTier,
        defaultVatRatePct: 24,
        defaultCurrency: "ISK",
        status: "active",
      },
    });
  }
  // eslint-disable-next-line no-console
  console.log(`[seed] cost-factor catalog: ${COST_FACTORS.length} factors upserted.`);
}

// ── ADR 0019 — agreements cost-factor catalog (revised) ──────────────
// Coexists with the legacy ADR 0008 catalog above until cutover.
// STR (Straumvaktargjald) is the platform fee — recipient is always the
// Straumvakt ORG row. Bearer is per-clause: ORG when N1 covers it out
// of revenue, WRK on workplace agreements (e.g. Krónan pays a mediation
// fee), USR when a CPO opts to surface it as a driver-visible "platform
// fee."  Default basis at pilot is per_session.
const AGREEMENT_COST_FACTORS = [
  { code: "DSO", displayNameIs: "Dreifing",        displayNameEn: "DSO grid fee",                description: "Distribution-system-operator grid fee. Pass-through to the DSO (Veitur, Norðurorka, RARIK, ...). Site-anchored." },
  { code: "ELE", displayNameIs: "Rafmagn",         displayNameEn: "Retailer energy price",       description: "Electricity commodity price from the retailer. Pass-through. Installation-anchored in pilot." },
  { code: "ACS", displayNameIs: "Notendagjald",    displayNameEn: "User access fee",             description: "Per-session or per-month flat access fee. Recipient is typically the CPO." },
  { code: "PRM", displayNameIs: "Premium",         displayNameEn: "Premium user access fee",     description: "Higher-tier user access fee for differentiated pricing." },
  { code: "TRF", displayNameIs: "Tímagjald",       displayNameEn: "Extra tariffs",               description: "Idle-minute fees, surge pricing, etc. Recipient is the CPO." },
  { code: "SRF", displayNameIs: "Þjónustugjald",   displayNameEn: "Service / installer fee",     description: "Fee paid to the contractor handling installation/maintenance." },
  { code: "RNT", displayNameIs: "Leiga",           displayNameEn: "Charger rental fee",          description: "Hardware-rental fee when the charger is rented vs. owned. Null/absent when owned." },
  { code: "MTR", displayNameIs: "Mælagjald",       displayNameEn: "E-meter daily fee",           description: "Daily fee the DSO charges for the e-meter on the installation. Pass-through." },
  { code: "STR", displayNameIs: "Straumvaktargjald", displayNameEn: "Straumvakt platform fee",   description: "Per-session (default) or per-kWh fee paid to Straumvakt for platform services. Recipient is always the Straumvakt ORG row. Default bearer depends on agreement type — ORG on CPO agreements, WRK on workplace agreements." },
];

async function seedAgreementCostFactorCatalog() {
  for (const f of AGREEMENT_COST_FACTORS) {
    await prisma.agreementCostFactor.upsert({
      where: { code: f.code },
      update: {
        displayNameIs: f.displayNameIs,
        displayNameEn: f.displayNameEn,
        description: f.description,
      },
      create: {
        code: f.code,
        displayNameIs: f.displayNameIs,
        displayNameEn: f.displayNameEn,
        description: f.description,
        status: "active",
      },
    });
  }
  // eslint-disable-next-line no-console
  console.log(`[seed] agreements cost-factor catalog: ${AGREEMENT_COST_FACTORS.length} factors upserted.`);
}

async function main() {
  await seedHardwareCatalog();
  await seedCostFactorCatalog();
  await seedAgreementCostFactorCatalog();
}

main()
  .then(async () => {
    await prisma.$disconnect();
    process.exit(0);
  })
  .catch(async (err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
