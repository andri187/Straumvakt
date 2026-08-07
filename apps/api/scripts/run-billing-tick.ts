export {};

/**
 * Run the agreements billing tick once, by hand, and print what it did.
 *
 * The cron runs this every minute and logs only when something happened, so
 * "nothing in the logs" has been indistinguishable from "scanned zero
 * candidates" for months. This makes the difference visible: scanned,
 * emitted, already-existed, and every denial reason with a count.
 *
 * That distinction is the whole reason this exists. On 2026-08-07 the tick
 * went scanned=0 → scanned=64 → 64 validation errors → 128 lines emitted,
 * and each of those three states had produced identical silence from the
 * cron.
 *
 * `--since <days>` widens the recency window past the cron's 30-day default,
 * which is the flag that lets a backlog older than the window be reached at
 * all. See the header of lib/agreement/billing-tick.ts for why that matters.
 *
 * RULE 3: pass the connection string explicitly. This writes billing lines.
 * RULE 5: pricing. Staging runs need explicit go-ahead.
 *
 *   DATABASE_URL=... npm run script -- run-billing-tick.ts
 *   DATABASE_URL=... npm run script -- run-billing-tick.ts --since 120 --batch 200
 *
 * Must go through scripts/run.mjs — see its header for why plain tsx cannot
 * load the generated Prisma client under Node 24.
 */

import { PrismaClient } from "../../../prisma/generated/node-client/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { runAgreementsBillingTick } from "../src/lib/agreement/billing-tick";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required — this writes billing lines.");
  process.exit(1);
}
const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? Number(process.argv[i + 1]) : undefined;
};

(async () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    const sinceDays = arg("--since");
    const batchSize = arg("--batch");
    const r = await runAgreementsBillingTick(prisma as never, {
      ...(sinceDays ? { sinceDays } : {}),
      ...(batchSize ? { batchSize } : {}),
    });
    console.log(`  window   ${sinceDays ?? 30} days`);
    console.log(`  scanned  ${r.scanned}`);
    console.log(`  emitted  ${r.emitted}`);
    console.log(`  existed  ${r.alreadyExisted}`);
    const denied = Object.entries(r.denied);
    console.log(`  denied   ${denied.length ? denied.map(([k, v]) => `${k}=${v}`).join(" ") : "none"}`);
    if (r.errors.length) {
      console.log(`  errors   ${r.errors.length}`);
      for (const e of r.errors.slice(0, 5)) console.log(`    ${e.sessionId}: ${e.message}`);
    }
  } finally {
    await prisma.$disconnect();
  }
})();
