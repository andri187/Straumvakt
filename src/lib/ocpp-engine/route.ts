// Connection route parsing for the generic OCPP engine (Checkpoint A).
//
// A charger connects to  wss://{cpo-routing-id}.straumvakt.org/{installation-key}/{charge-point-id}
// (the address the installation editor shows). This module turns host + path
// + Authorization header into one normalised triple, and nothing else. It does
// no I/O and grants nothing: a well-formed route is only a *claim* to be
// resolved against the database.
//
// Normalisation, stated once:
//   - routing id: DNS labels are case-insensitive, so it is lower-cased.
//   - installation key: generated lowercase [a-z0-9]{12}; lower-cased on input
//     so a charger that upper-cases its URL still resolves the same row.
//   - charge-point id: OCPP identities are case-SENSITIVE and are never folded.
//     Resolution is by exact match; a case-only difference is refused as a
//     distinct reason rather than silently matched (see admission.ts).
//
// Basic-auth username: it MUST equal the charge-point id (OCPP 1.6 security
// whitepaper, Security Profile 1/2: "the username is the ChargePointId").
// The full composite path `{key}/{id}` is NOT a valid username, so a charger
// configured that way fails rather than being quietly accepted.

import { CHARGE_POINT_ID, CONNECTION_DOMAIN } from "@/lib/installations/model";

export type ParsedRoute = {
  routingId: string;
  installationKey: string;
  chargePointId: string;
};

export type RouteProblem = "bad_host" | "bad_path" | "bad_key" | "bad_charge_point_id" | "bad_scheme";

const ROUTING_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const INSTALLATION_KEY = /^[a-z0-9]{12}$/;

export function parseRoute(host: string, pathname: string): { ok: true; route: ParsedRoute } | { ok: false; problem: RouteProblem } {
  const hostname = host.split(":")[0]!.toLowerCase();
  const suffix = `.${CONNECTION_DOMAIN}`;
  if (!hostname.endsWith(suffix)) return { ok: false, problem: "bad_host" };
  const routingId = hostname.slice(0, -suffix.length);
  // Exactly one label: `a.b.straumvakt.org` is not a routing id.
  if (!ROUTING_LABEL.test(routingId)) return { ok: false, problem: "bad_host" };

  // Exactly two non-empty segments. No version prefix, no trailing segment, no
  // percent-encoded separators: a decoded `/` or `..` must never reshape the route.
  const segments = pathname.split("/");
  if (segments.length !== 3 || segments[0] !== "" || segments[1] === "" || segments[2] === "") {
    return { ok: false, problem: "bad_path" };
  }
  let key: string;
  let chargePointId: string;
  try {
    key = decodeURIComponent(segments[1]!).toLowerCase();
    chargePointId = decodeURIComponent(segments[2]!);
  } catch {
    return { ok: false, problem: "bad_path" };
  }
  if (!INSTALLATION_KEY.test(key)) return { ok: false, problem: "bad_key" };
  if (!CHARGE_POINT_ID.test(chargePointId)) return { ok: false, problem: "bad_charge_point_id" };
  return { ok: true, route: { routingId, installationKey: key, chargePointId } };
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
