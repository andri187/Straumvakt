/**
 * permissions.ts — Canonical permission slug catalog for the API worker.
 *
 * Routes call `requirePermission(slug)` to gate write endpoints. Read
 * endpoints use `requireAdmin()` (session check only) unless they surface
 * sensitive data that warrants finer-grained control.
 *
 * Slug format: "<domain>.<action>" — domain is a bounded-context name,
 * action is one of: read, write, admin.
 *
 * Sprint 9 — Phase 1 Track D deliverable.
 */

// ─── Billing ─────────────────────────────────────────────────────────────────

/** Read access to billing entities (agreements, cost factors, tariffs, rate refs). */
export const BILLING_READ = "billing.read" as const;

/** Write access to billing entities — gate all mutating billing endpoints with this. */
export const BILLING_WRITE = "billing.write" as const;

// ─── All slugs as a const tuple (for runtime validation) ─────────────────────

export const ALL_PERMISSION_SLUGS = [
  BILLING_READ,
  BILLING_WRITE,
] as const;

export type PermissionSlug = (typeof ALL_PERMISSION_SLUGS)[number];

/**
 * Asserts that `slug` is a known permission slug.
 * Call this at startup / in tests to catch typos early.
 */
export function isKnownPermission(slug: string): slug is PermissionSlug {
  return (ALL_PERMISSION_SLUGS as readonly string[]).includes(slug);
}
