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
import { PrismaClient } from "@prisma/client";
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

async function main() {
  await seedHardwareCatalog();
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
