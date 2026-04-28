import { PrismaClient } from "straumvakt-prisma-cf-client/client";
import { PrismaNeon } from "@prisma/adapter-neon";

// PrismaClient is cached on the V8 isolate (Workers) / process (Node).
// Re-creating it per request adds hundreds of ms because the Neon adapter
// opens a fresh WebSocket and Prisma initializes its compiler against the
// WASM module each time. Workers reuse isolates across requests, so a
// module-scoped singleton is the documented Prisma + Workers pattern. The
// same singleton dedupes across HMR reloads in dev.

declare global {
  // eslint-disable-next-line no-var
  var __straumvakt_prisma__: PrismaClient | undefined;
}

function createClient(): PrismaClient {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to create a Prisma client");
  }
  const adapter = new PrismaNeon({ connectionString: databaseUrl });
  return new PrismaClient({ adapter });
}

export function getPrisma(): PrismaClient {
  if (!globalThis.__straumvakt_prisma__) {
    globalThis.__straumvakt_prisma__ = createClient();
  }
  return globalThis.__straumvakt_prisma__;
}

// Application code should prefer withOrgContext() from
// src/lib/repositories/_context rather than calling prisma() directly.
export function prisma(): PrismaClient {
  return getPrisma();
}
