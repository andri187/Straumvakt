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

// ── ADR 0019 (2026-05-08 addendum) — 15-factor agreements catalog.
// Replaces the 9-factor catalog from the original addendum. Coexists
// with the legacy ADR 0008 catalog above until cutover.
//
// Five-agreement placement (lock):
//   service_cpo         INT, USRF, CNR, RVN, PRM
//   service_contractor  AGN, RVN
//   service_workplace   WRK
//   installation        DSO, ELE, MTR, RNT, TRF, IDL (mdu only), NET (mdu only)
//   issues engine       SRF (deferred — non-session billing track)
const AGREEMENT_COST_FACTORS = [
  // service_cpo (Straumvakt revenue from the CPO).
  { code: "INT",  displayNameIs: "Hleðslukerfagjald",          displayNameEn: "Price per installation",      description: "Flat per-installation fee Straumvakt invoices the CPO. Lives on a service_cpo agreement." },
  { code: "USRF", displayNameIs: "Notendagjald",               displayNameEn: "Per-user-on-installation",    description: "Per-user-on-installation fee Straumvakt invoices the CPO. CPO can absorb or forward to drivers. Lives on a service_cpo agreement." },
  { code: "CNR",  displayNameIs: "Tenglagjald",                displayNameEn: "Per-connector",               description: "Per-connector fee Straumvakt invoices the CPO. Lives on a service_cpo agreement." },
  { code: "RVN",  displayNameIs: "Veltutengd gjöld",           displayNameEn: "% of kWh charges",            description: "Percent of kWh-priced charges (= pct × kWh × (ELE_rate + DSO_rate)). Lives on service_cpo and service_contractor agreements." },
  { code: "PRM",  displayNameIs: "Premium",                    displayNameEn: "Premium user fee",            description: "Premium user fee. Straumvakt revenue. Lives on service_cpo agreements; CPO chooses absorb or forward." },
  // service_contractor (Straumvakt revenue from a contractor).
  { code: "AGN",  displayNameIs: "Per Contractor Agent access", displayNameEn: "Per-agent (contractor)",     description: "Per-agent access fee Straumvakt invoices a contractor. Lives on a service_contractor agreement." },
  // service_workplace (Straumvakt revenue from a workplace).
  { code: "WRK",  displayNameIs: "Vinnan",                     displayNameEn: "Workplace service fee",       description: "Per workplace-covered driver per month. Once per workplace (not duplicated per CPO the workplace covers them at). Lives on a service_workplace agreement." },
  // installation (CPO operational facts).
  { code: "DSO",  displayNameIs: "Dreifing",                   displayNameEn: "DSO grid fee",                description: "Distribution-system-operator grid fee. Pass-through to the DSO (Veitur, Norðurorka, RARIK). Bound to the DSO rate table." },
  { code: "ELE",  displayNameIs: "Rafmagn",                    displayNameEn: "Retailer energy",             description: "Electricity commodity price from the retailer. Pass-through. Bound to the electricity rate table." },
  { code: "MTR",  displayNameIs: "Mælagjald",                  displayNameEn: "E-meter daily fee",           description: "Daily fee the DSO charges for the e-meter on the installation. Pass-through. Default bearer ORG (CPO); CPO can split with USR." },
  { code: "RNT",  displayNameIs: "Leiga",                      displayNameEn: "Charger rental",              description: "Hardware-rental fee when the charger is rented rather than owned. Default bearer ORG (CPO)." },
  { code: "TRF",  displayNameIs: "Álag",                       displayNameEn: "Idle / extra tariff",         description: "Per-minute idle fees, surge pricing, etc. CPO-set." },
  { code: "IDL",  displayNameIs: "Idlepower",                  displayNameEn: "Idle power loss",             description: "Difference between the electrical bill and kWh charged. MDU only — CPO can split with dwellers via Allocation. Null on workplace installations." },
  { code: "NET",  displayNameIs: "Internet",                   displayNameEn: "Internet / SIM cost",         description: "Cost of internet / 4G modem + SIM at the installation. MDU only. Null on workplace installations." },
  // issues engine (deferred — non-session billing track).
  { code: "SRF",  displayNameIs: "Þjónustugjald",              displayNameEn: "Service line item",           description: "Service work line item raised by the issues engine. Sum of contractor service costs; Straumvakt takes 5% RVN on each service invoice. Non-session billable_event_type = service_invoice." },
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
