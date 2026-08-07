// Errors the identity repositories raise, replacing Prisma's error codes.
//
// Prisma signalled these two conditions with `err.code === "P2002"` /
// `"P2025"`, and callers matched on `err.message.includes("Unique
// constraint")` — a string that node-postgres does not produce. Rather than
// swap one driver's private error format for another's, the boundary raises
// its own, and the driver-specific detection stays in this file.
//
// The HTTP behaviour on the other side is unchanged: a duplicate email is
// still a 409.

/** A UNIQUE constraint rejected the write. */
export class UniqueViolationError extends Error {
  readonly constraintName: string | undefined;
  constructor(constraintName?: string, cause?: unknown) {
    super(`unique constraint violated${constraintName ? `: ${constraintName}` : ""}`);
    this.name = "UniqueViolationError";
    this.constraintName = constraintName;
    if (cause !== undefined) (this as { cause?: unknown }).cause = cause;
  }
}

/** An update or delete matched no row. Prisma raised P2025 here. */
export class RecordNotFoundError extends Error {
  constructor(what: string) {
    super(`${what}: no such row`);
    this.name = "RecordNotFoundError";
  }
}

/**
 * Pull a Postgres SQLSTATE off an error, following the `cause` chain.
 *
 * ── CORRECTED 2026-08-07 ────────────────────────────────────────────────
 *
 * This file used to assert "the driver does not wrap it, so this is the raw
 * pg error" and read `err.code` directly. That is false. Drizzle wraps driver
 * errors, and a real duplicate insert arrives as:
 *
 *     { name: 'Error', code: undefined, cause: { code: '23505', ... } }
 *
 * So every SQLSTATE branch in the codebase was matching nothing — silently,
 * because the fallthrough is a 500 rather than a crash. Found when the
 * org-email-domains duplicate-domain response turned from 409 into 500 after
 * its port, and confirmed by test/parity/error-shape.probe.test.ts, which
 * exists to catch this changing again.
 *
 * The chain is walked rather than checking exactly one level, because the
 * nesting depth is Drizzle's business and not something to depend on.
 */
export function pgErrorCode(err: unknown): string | undefined {
  let cur: unknown = err;
  for (let depth = 0; depth < 5 && typeof cur === "object" && cur !== null; depth++) {
    const code = (cur as { code?: unknown }).code;
    if (typeof code === "string") return code;
    cur = (cur as { cause?: unknown }).cause;
  }
  return undefined;
}

/** Postgres SQLSTATE 23505 — unique_violation. */
export function isUniqueViolation(err: unknown): err is { code: "23505"; constraint?: string } {
  return pgErrorCode(err) === "23505";
}

/** Postgres SQLSTATE 23503 — foreign_key_violation. The id-token delete path
 *  turns this into a 409 ("still referenced — revoke instead") rather than a
 *  500, so it has to survive the ORM change. */
export function isForeignKeyViolation(err: unknown): err is { code: "23503"; constraint?: string } {
  return pgErrorCode(err) === "23503";
}
