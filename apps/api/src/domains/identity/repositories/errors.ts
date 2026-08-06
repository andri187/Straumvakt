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

/** Postgres SQLSTATE 23505 — unique_violation. node-postgres puts the class
 *  on `err.code`; the driver does not wrap it, so this is the raw pg error. */
export function isUniqueViolation(err: unknown): err is { code: "23505"; constraint?: string } {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: unknown }).code === "23505"
  );
}

/** Postgres SQLSTATE 23503 — foreign_key_violation. The id-token delete path
 *  turns this into a 409 ("still referenced — revoke instead") rather than a
 *  500, so it has to survive the ORM change. */
export function isForeignKeyViolation(err: unknown): err is { code: "23503"; constraint?: string } {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: unknown }).code === "23503"
  );
}
