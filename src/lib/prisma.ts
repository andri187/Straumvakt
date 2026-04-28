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
//     WebSocket counts) across requests — concurrent navigations would
//     otherwise crash with "Cannot perform I/O on behalf of a different
//     request". React's cache() scopes the client to one server-component
//     render, which is one request. Connection pooling happens via
//     Cloudflare Hyperdrive (binding HYPERDRIVE_DB on the staging Worker).
//     Hyperdrive multiplexes onto warm Postgres connections so the
//     per-request cost drops from ~hundreds of ms to ~tens of ms.
//
//   • Node.js (local dev): Next dev server reuses the process across
//     requests, so we cache on globalThis to avoid leaking connections
//     during HMR reloads. Hyperdrive is not used locally — DATABASE_URL
//     points at Neon directly via the pooler.

type HyperdriveBinding = { connectionString: string };

function getDatabaseUrl(): string {
  // On Workers, the Hyperdrive binding gives us a pooled connection string.
  // The binding only exists at runtime in workerd, so we have to look it up
  // through OpenNext's runtime accessor — process.env does not expose
  // bindings.
  if (typeof process === "undefined" || process.env.NODE_ENV !== "development") {
    try {
      // Lazy require so local Node dev does not fail on missing module.
      // OpenNext exposes getCloudflareContext from its runtime adapter.
      const adapter = require("@opennextjs/cloudflare") as {
        getCloudflareContext?: () => { env?: Record<string, unknown> };
      };
      const ctx = adapter.getCloudflareContext?.();
      const hd = ctx?.env?.HYPERDRIVE_DB as HyperdriveBinding | undefined;
      if (hd?.connectionString) return hd.connectionString;
    } catch {
      // Not running under OpenNext / Cloudflare — fall through.
    }
  }

  const fromEnv = process.env.DATABASE_URL;
  if (!fromEnv) {
    throw new Error(
      "DATABASE_URL is required (or HYPERDRIVE_DB binding on Workers)",
    );
  }
  return fromEnv;
}

function createClient(): PrismaClient {
  const adapter = new PrismaNeon({ connectionString: getDatabaseUrl() });
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
