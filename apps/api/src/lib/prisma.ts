import { PrismaClient } from "../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import type { Env } from "../bindings";

// Per-request PrismaClient. Workers I/O isolation forbids reusing the
// underlying Postgres connection across requests, so we mint a fresh
// client per request. Hyperdrive sits between us and Neon to amortize
// the cost — its pooled connections stay warm.
//
// PrismaPg is the right adapter for a Hyperdrive endpoint (raw Postgres
// TCP); PrismaNeon (WebSocket) does not handshake with Hyperdrive.

export function makePrisma(env: Env): PrismaClient {
  const adapter = new PrismaPg({
    connectionString: env.HYPERDRIVE_DB.connectionString,
  });
  return new PrismaClient({ adapter });
}
