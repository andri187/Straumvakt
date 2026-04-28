import { PrismaClient } from "straumvakt-prisma-cf-client/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaPg } from "@prisma/adapter-pg";
import { cache } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// Prisma client — Neon-adapted, edge-runtime-compatible
// ─────────────────────────────────────────────────────────────────────────────
//
// Two paths:
//
//   • Cloudflare Workers (production / staging): each request gets its own
//     client. Workers I/O isolation forbids reusing connections across
//     requests, so we use React's cache() to scope to a single render.
//     Connection pooling happens through the Cloudflare Hyperdrive binding
//     HYPERDRIVE_DB — Hyperdrive speaks raw Postgres TCP, so the adapter is
//     PrismaPg (not PrismaNeon). The Neon adapter cannot handshake with
//     Hyperdrive's endpoint.
//
//   • Node.js (local dev): Next dev server reuses the process across
//     requests, so we cache on globalThis to avoid HMR connection leaks.
//     Local dev points DATABASE_URL at Neon directly via the pooler URL
//     and uses PrismaNeon for its WebSocket-native fast path.

type HyperdriveBinding = { connectionString: string };

function tryHyperdrive(): HyperdriveBinding | null {
  if (typeof process !== "undefined" && process.env.NODE_ENV === "development") {
    return null;
  }
  try {
    const adapter = require("@opennextjs/cloudflare") as {
      getCloudflareContext?: () => { env?: Record<string, unknown> };
    };
    const ctx = adapter.getCloudflareContext?.();
    return (ctx?.env?.HYPERDRIVE_DB as HyperdriveBinding | undefined) ?? null;
  } catch {
    return null;
  }
}

function createClient(): PrismaClient {
  const hd = tryHyperdrive();
  if (hd?.connectionString) {
    const adapter = new PrismaPg({ connectionString: hd.connectionString });
    return new PrismaClient({ adapter });
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL is required (or HYPERDRIVE_DB binding on Workers)",
    );
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

// Application code should prefer withOrgContext() from
// src/lib/repositories/_context rather than calling prisma() directly.
export function prisma(): PrismaClient {
  return process.env.NODE_ENV === "production" ? getPrisma() : getPrismaDev();
}
