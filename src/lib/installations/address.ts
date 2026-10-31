// Charger connection address: pure, dependency-free, safe to import from the
// browser bundle (model.ts pulls in zod, which a client component should not).
//
// A charger connects to  wss://{cpo-id}.straumvakt.org/{charge-point-id}
// The CPO is the host; the path is the charger's own OCPP identity. There is no
// installation segment: which installation a charger belongs to is read from its
// registered placement, never from the URL.
//
// The address is routing information, not proof of ownership. It never contains
// a password, and it is not active: the gateway that would accept it is not
// deployed or routed.

export const CONNECTION_DOMAIN = "straumvakt.org";

/** OCPP charge-point id: a single URL path segment, conservative on purpose. */
export const CHARGE_POINT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,47}$/;

/** The CPO's stable endpoint: `wss://{cpo-id}.straumvakt.org/`. Null until the CPO's routing id exists. */
export function cpoAddress(routingId: string | null): string | null {
  return routingId ? `wss://${routingId}.${CONNECTION_DOMAIN}/` : null;
}

/**
 * The complete address for one charger, or null while the CPO's routing id is
 * unknown or the charge-point id is empty or not a valid path segment. The id is
 * whatever the operator typed for that charger: a serial number is never
 * substituted for it.
 */
export function chargerAddress(routingId: string | null, chargePointId: string): string | null {
  const id = chargePointId.trim();
  if (!routingId || !CHARGE_POINT_ID.test(id)) return null;
  return `wss://${routingId}.${CONNECTION_DOMAIN}/${id}`;
}
