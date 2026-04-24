/**
 * Branded tenant identifier — prevents accidental string-to-orgId coercion.
 */
export type OrgId = string & { readonly __brand: "OrgId" };

export function asOrgId(value: string): OrgId {
  if (!value || typeof value !== "string") {
    throw new TenantContextError("OrgId must be a non-empty string");
  }
  return value as OrgId;
}

/**
 * Thrown when tenant context is missing, invalid, or violated.
 *
 * Repository code should never silently fall back to an unscoped query.
 * Catching this exception is reserved for the API gateway, which converts
 * it into a 400 / 401 / 500 as appropriate.
 */
export class TenantContextError extends Error {
  readonly name = "TenantContextError" as const;
  constructor(message: string) {
    super(message);
  }
}
