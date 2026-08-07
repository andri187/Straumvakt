import { defineConfig } from "drizzle-kit";

// ╔════════════════════════════════════════════════════════════════════════╗
// ║  DRIZZLE OWNS THE SCHEMA AS OF 2026-08-07.                             ║
// ║                                                                        ║
// ║  A schema change starts HERE — edit packages/shared/src/db/*.ts, run   ║
// ║  `npm run db:generate:sql`, read the SQL it produces, then apply it.   ║
// ║  Prisma no longer drives this; see ADR 0051.                           ║
// ║                                                                        ║
// ║  Until the last Prisma call is ported, prisma/schema/*.prisma still    ║
// ║  exists to generate the CLIENT those calls need. It is downstream now: ║
// ║  `npm run check:schema-consistency` fails if the two disagree, so a    ║
// ║  change made here must be mirrored there until Prisma is deleted.      ║
// ║                                                                        ║
// ║  NEVER RUN `drizzle-kit push`. It diffs and reconciles in one step     ║
// ║  with no SQL to review, against a database 21 chargers write to.       ║
// ║  Generate, read, apply.                                                ║
// ╚════════════════════════════════════════════════════════════════════════╝

export default defineConfig({
  dialect: "postgresql",
  // The hand-owned Drizzle schemas — the source of truth. These live in
  // packages/shared because the console imports them too; apps/api is not
  // allowed to be a dependency of the console (dependency-cruiser rule).
  schema: ["../../packages/shared/src/db/*.ts"],
  out: "./drizzle",
  // The migrate/introspect path reads this. Runtime does not: the Worker
  // gets its connection from the Hyperdrive binding — see src/lib/drizzle.ts.
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
  // All 18 Postgres schemas the declarations touch. An incomplete list here
  // is dangerous, not merely wrong: drizzle-kit treats anything outside the
  // filter as none of its business, and a table it cannot see is a table it
  // will happily propose creating on top of the one already there.
  schemaFilter: [
    "agreements", "assets", "audit", "billing", "charging", "energy",
    "entitlements", "events", "hardware", "identity", "ocpp", "people",
    "properties", "reports", "roaming", "tenancy", "vendors", "webhooks",
  ],
  verbose: true,
  strict: true,
});
