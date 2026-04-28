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

async function main() {
  await seedHardwareCatalog();
  await seedCostFactorCatalog();
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
