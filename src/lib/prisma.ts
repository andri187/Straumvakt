import { PrismaClient } from "straumvakt-prisma-cf-client/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { cache } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// Prisma client — Neon-adapted, edge-runtime-compatible
// ─────────────────────────────────────────────────────────────────────────────
//
// Two runtimes need different lifetimes:
//
//   • Cloudflare Workers (production / staging): each request gets its own
//     client. Workers' I/O isolation forbids reusing I/O objects (the Neon
//     WebSocket connection counts) across requests — concurrent navigations
//     would otherwise crash with "Cannot perform I/O on behalf of a different
//     request". React's cache() scopes the client to one server-component
//     render, which is one request.
//
//   • Node.js (local dev): Next dev server reuses the process across
//     requests, so we cache on globalThis to avoid leaking connections
//     during HMR reloads.
//
// The PrismaNeon adapter handles the WebSocket transport internally; no
// `ws` shim required at this layer.

function createClient(): PrismaClient {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to create a Prisma client");
  }
  const adapter = new PrismaNeon({ connectionString: databaseUrl });
  return new PrismaClient({ adapter });
}

// Per-request client for Cloudflare / React Server Components.
export const getPrisma = cache(() => createClient());

// Dev-only fallback so HMR doesn't leak clients across reloads.
declare global {
  // eslint-disable-next-line no-var
  var __straumvakt_prisma__: PrismaClient | undefined;
}

export function getPrismaDev(): PrismaClient {
  if (process.env.NODE_ENV === "production") {
    return getPrisma();
  }
  if (!globalThis.__straumvakt_prisma__) {
    globalThis.__straumvakt_prisma__ = createClient();
  }
  return globalThis.__straumvakt_prisma__;
}

// Application code should prefer `withOrgContext()` from
// `src/lib/repositories/_context` rather than calling `prisma()` directly.
export function prisma(): PrismaClient {
  return process.env.NODE_ENV === "production" ? getPrisma() : getPrismaDev();
}
