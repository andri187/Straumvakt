// Shared plumbing for the Prisma-vs-Drizzle parity harness.
//
// WHAT THIS PROVES AND WHAT IT DOES NOT
// -------------------------------------
// It proves BEHAVIOUR: given the same inputs against the same rows, the
// Drizzle version of a repository function returns the same shape and the
// same semantics as the Prisma one.
//
// It does not prove DATA FIDELITY, and must not be read as though it did.
// The legacy rows in this database are test and import artefacts with no
// value (operator, 2026-08-05). A mismatch caused by junk data is not a
// failure; a mismatch in shape or semantics is. `compareShape` exists to
// keep that distinction visible rather than leaving it to whoever reads a
// red test at 3am.
//
// Reusable for every later domain. The only per-domain part is the list of
// functions being compared.

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { PrismaClient } from "../../../../prisma/generated/node-client/client";
import { PrismaPg } from "@prisma/adapter-pg";

export const PARITY_URL = process.env.PARITY_DATABASE_URL ?? "";

/** Every parity file guards on this. Without a database there is nothing to
 *  compare, and a silently-passing empty suite is worse than a skip. */
export const hasDb = PARITY_URL.length > 0;

let pool: Pool | null = null;
let prisma: PrismaClient | null = null;

export function getPool(): Pool {
  if (!pool) pool = new Pool({ connectionString: PARITY_URL, max: 4 });
  return pool;
}

export function getDrizzle() {
  return drizzle(getPool());
}

export function getPrisma(): PrismaClient {
  if (!prisma) {
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: PARITY_URL }) });
  }
  return prisma;
}

export async function closeAll() {
  if (prisma) {
    await prisma.$disconnect();
    prisma = null;
  }
  if (pool) {
    await pool.end();
    pool = null;
  }
}

// ── comparison ─────────────────────────────────────────────────────────────

/**
 * Normalise a value for comparison across the two clients.
 *
 * The two disagree about representation in ways that are not semantic
 * differences:
 *   - Dates come back as Date objects from both, but the two can differ in
 *     sub-millisecond precision through different driver paths.
 *   - Prisma returns `null` for absent scalars; node-postgres also returns
 *     `null`. Undefined never appears from either, so it is normalised to
 *     null to keep a missing key and a null key comparable.
 *   - BigInt is not JSON-serialisable; both return it as bigint.
 */
export function normalise(value: unknown): unknown {
  if (value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(normalise);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as object).sort()) {
      out[k] = normalise((value as Record<string, unknown>)[k]);
    }
    return out;
  }
  return value;
}

/** The set of keys a result carries, recursively. This is the SHAPE — the
 *  thing that must match regardless of what junk is in the rows. */
export function shapeOf(value: unknown, depth = 0): unknown {
  if (depth > 6) return "…";
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return value.length ? [shapeOf(value[0], depth + 1)] : [];
  if (value instanceof Date) return "Date";
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as object).sort()) {
      out[k] = shapeOf((value as Record<string, unknown>)[k], depth + 1);
    }
    return out;
  }
  return typeof value;
}

export interface ParityResult {
  equal: boolean;
  shapeEqual: boolean;
  prismaJson: string;
  drizzleJson: string;
  prismaShape: string;
  drizzleShape: string;
}

export function compare(fromPrisma: unknown, fromDrizzle: unknown): ParityResult {
  const p = JSON.stringify(normalise(fromPrisma));
  const d = JSON.stringify(normalise(fromDrizzle));
  const ps = JSON.stringify(shapeOf(fromPrisma));
  const ds = JSON.stringify(shapeOf(fromDrizzle));
  return {
    equal: p === d,
    shapeEqual: ps === ds,
    prismaJson: p,
    drizzleJson: d,
    prismaShape: ps,
    drizzleShape: ds,
  };
}
