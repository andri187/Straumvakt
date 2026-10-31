// Connection route parsing for the generic OCPP engine.
//
// A charger connects to  wss://{cpo-routing-id}.straumvakt.org/{charge-point-id}
// (the address the installation editor shows). This module turns host + path
// + Authorization header into one normalised pair, and nothing else. It does
// no I/O and grants nothing: a well-formed route is only a *claim* to be
// resolved against the database. There is no installation segment: the
// installation is derived from the charger's registered placement.
//
// The previous route  /{installation-key}/{charge-point-id}  is not accepted.
// It has two segments, so it fails as `bad_path`: an old URL cannot be
// mistaken for a charge point id, and a charge point id can never be read as a key.
//
// Normalisation, stated once:
//   - routing id: DNS labels are case-insensitive, so it is lower-cased.
//   - charge-point id: OCPP identities are case-SENSITIVE and are never folded.
//     Resolution is by exact match; a case-only difference is refused as a
//     distinct reason rather than silently matched (see admission.ts).
//
// Basic-auth username: it MUST equal the charge-point id (OCPP 1.6 security
// whitepaper, Security Profile 1/2: "the username is the ChargePointId").

import { CHARGE_POINT_ID, CONNECTION_DOMAIN } from "@/lib/installations/address";

export type ParsedRoute = {
  routingId: string;
  chargePointId: string;
};

export type RouteProblem = "bad_host" | "bad_path" | "bad_charge_point_id" | "bad_scheme";

const ROUTING_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export function parseRoute(host: string, pathname: string): { ok: true; route: ParsedRoute } | { ok: false; problem: RouteProblem } {
  const hostname = host.split(":")[0]!.toLowerCase();
  const suffix = `.${CONNECTION_DOMAIN}`;
  if (!hostname.endsWith(suffix)) return { ok: false, problem: "bad_host" };
  const routingId = hostname.slice(0, -suffix.length);
  // Exactly one label: `a.b.straumvakt.org` is not a routing id.
  if (!ROUTING_LABEL.test(routingId)) return { ok: false, problem: "bad_host" };

  // Exactly one non-empty segment. No installation segment, no version prefix, no trailing slash, no
  // percent-encoded separators: a decoded `/` or `..` must never reshape the route.
  const segments = pathname.split("/");
  if (segments.length !== 2 || segments[0] !== "" || segments[1] === "") {
    return { ok: false, problem: "bad_path" };
  }
  let chargePointId: string;
  try {
    chargePointId = decodeURIComponent(segments[1]!);
  } catch {
    return { ok: false, problem: "bad_path" };
  }
  if (!CHARGE_POINT_ID.test(chargePointId)) return { ok: false, problem: "bad_charge_point_id" };
  return { ok: true, route: { routingId, chargePointId } };
}

export type BasicCredentials = { username: string; password: string };

/** `Authorization: Basic …`. Null for absent or malformed; never throws. */
export function parseBasic(header: string | null | undefined): BasicCredentials | null {
  if (!header) return null;
  const m = /^Basic\s+([A-Za-z0-9+/=]+)\s*$/.exec(header);
  if (!m?.[1]) return null;
  let decoded: string;
  try {
    decoded = new TextDecoder().decode(Uint8Array.from(atob(m[1]), (c) => c.charCodeAt(0)));
  } catch {
    return null;
  }
  const i = decoded.indexOf(":");
  if (i <= 0) return null;
  const username = decoded.slice(0, i);
  const password = decoded.slice(i + 1);
  if (password.length === 0) return null;
  return { username, password };
}
