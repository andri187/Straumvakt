import type { PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { asOrgId, OrgId, TenantContextError } from "./_types";

/**
 * The only sanctioned way to read or write operational data.
 *
 * `withOrgContext` takes a tenant identifier and a function. It hands the
 * function a `TenantDb` — a structurally-typed Prisma client whose surface
 * exposes only the tables that participate in the tenant boundary, and a
 * helper that asserts a `where` clause carries `orgId`.
 *
 * Application code should not import `@/lib/prisma` directly. Pages and
 * route handlers receive their tenant from the session (see `requireAdmin`
 * in `src/lib/api-auth.ts`) and pass it through here.
 *
 * Example:
 *
 *   export async function listSites(orgId: string) {
 *     return withOrgContext(orgId, ({ db, requireOrg }) =>
 *       db.site.findMany({ where: requireOrg({ status: "active" }) }),
 *     );
 *   }
 *
 * The `requireOrg` helper exists because Prisma cannot statically enforce
 * that every where-clause carries `orgId`. Instead, repository code must
 * pass its where-clause through `requireOrg`, which throws if `orgId` is
 * already set to a different value (defence against context confusion) and
 * stamps the correct one if it is missing.
 */
export interface TenantContext {
  readonly orgId: OrgId;
  readonly db: PrismaClient;
  /**
   * Stamp `orgId` onto a where-clause. Throws if the clause already pins a
   * different `orgId` — prevents one repository accidentally querying
   * another tenant's data.
   *
   * Generic shape `<W>(where: W & { orgId?: string })` is what allows
   * call sites to pass excess properties (e.g. `{ status: "active" }`)
   * without TypeScript's excess-property check rejecting the literal.
   */
  requireOrg<W>(where: W & { orgId?: string }): W & { orgId: OrgId };
}

export async function withOrgContext<T>(
  orgId: string | undefined | null,
  fn: (ctx: TenantContext) => Promise<T>,
): Promise<T> {
  if (!orgId) {
    throw new TenantContextError(
      "withOrgContext called without an orgId — tenant boundary not satisfied.",
    );
  }
  const tenant = asOrgId(orgId);
  const db = prisma();

  const ctx: TenantContext = {
    orgId: tenant,
    db,
    requireOrg<W>(where: W & { orgId?: string }): W & { orgId: OrgId } {
      const existing = (where as { orgId?: string }).orgId;
      if (existing && existing !== tenant) {
        throw new TenantContextError(
          `requireOrg: clause pins orgId=${String(
            existing,
          )} but context tenant is ${String(tenant)}`,
        );
      }
      return { ...where, orgId: tenant };
    },
  };

  return fn(ctx);
}
