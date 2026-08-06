import { defineConfig } from "drizzle-kit";

// ╔════════════════════════════════════════════════════════════════════════╗
// ║  DO NOT RUN `drizzle-kit push` OR `drizzle-kit generate` AGAINST ANY   ║
// ║  BRANCH YET.                                                           ║
// ║                                                                        ║
// ║  Prisma still owns this schema. Every table declared under             ║
// ║  src/domains/*/schema.ts already exists, created by a Prisma           ║
// ║  migration. drizzle-kit does not know that: it diffs the declarations  ║
// ║  against the database and would try to reconcile the difference —      ║
// ║  including dropping the ~142 tables it has never been told about.      ║
// ║                                                                        ║
// ║  This config exists so `drizzle-kit check`/`up` work and so the        ║
// ║  eventual handover has somewhere to land. Migrations move to           ║
// ║  drizzle-kit only once Prisma is removed, and that is a separate,      ║
// ║  deliberate piece of work.                                             ║
// ╚════════════════════════════════════════════════════════════════════════╝

export default defineConfig({
  dialect: "postgresql",
  // Only the ported domains. Adding a domain here without porting it would
  // make the diff claim the other 142 tables should not exist.
  schema: ["./src/domains/*/schema.ts"],
  out: "./drizzle",
  // The migrate/introspect path reads this. Runtime does not: the Worker
  // gets its connection from the Hyperdrive binding — see src/lib/drizzle.ts.
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
  schemaFilter: ["identity", "tenancy", "people"],
  verbose: true,
  strict: true,
});
