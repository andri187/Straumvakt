/**
 * Gateway-side auth — extracts Basic-Auth from the WebSocket upgrade
 * request and asks the main app to validate it (Service Binding call
 * to `/api/internal/ocpp-auth`).
 *
 * The main app owns the `ocpp_identities` table; the gateway never
 * touches the DB directly. This keeps DB credentials out of the
 * gateway Worker entirely.
 */

export interface AuthOk {
  ok: true;
  identityId: string;
  orgId: string;
}

export interface AuthFail {
  ok: false;
  status: 401 | 403;
  reason: string;
}

export type AuthResult = AuthOk | AuthFail;

export interface GatewayEnv {
  MAIN_APP: { fetch: (req: Request) => Promise<Response> };
  OCPP_INGEST_SECRET: string;
}

/**
 * Parses an HTTP `Authorization: Basic <b64>` header. Returns null if
 * missing or malformed — caller maps null to a 401.
 */
export function parseBasicAuth(header: string | null): {
  username: string;
  password: string;
} | null {
  if (!header) return null;
  const m = /^Basic\s+([A-Za-z0-9+/=]+)\s*$/.exec(header);
  if (!m || !m[1]) return null;
  let decoded: string;
  try {
    decoded = atob(m[1]);
  } catch {
    return null;
  }
  const idx = decoded.indexOf(":");
  if (idx < 0) return null;
  const username = decoded.slice(0, idx);
  const password = decoded.slice(idx + 1);
  if (username.length === 0 || password.length === 0) return null;
  return { username, password };
}

/**
 * Calls main app to verify the credentials. Matches the identity
 * string from the URL path against the Basic-Auth username — refuses
 * any mismatch (defends against a charger presenting one identity on
 * the path and another in the header).
 */
export async function authenticate(
  env: GatewayEnv,
  urlIdentityString: string,
  authHeader: string | null,
): Promise<AuthResult> {
  const basic = parseBasicAuth(authHeader);
  if (!basic) return { ok: false, status: 401, reason: "missing_basic_auth" };
  if (basic.username !== urlIdentityString) {
    return { ok: false, status: 401, reason: "identity_mismatch" };
  }

  const resp = await env.MAIN_APP.fetch(
    new Request("https://main.internal/api/internal/ocpp-auth", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-straumvakt-ingest": env.OCPP_INGEST_SECRET,
      },
      body: JSON.stringify({
        identityString: basic.username,
        password: basic.password,
      }),
    }),
  );

  if (resp.status === 200) {
    const body = (await resp.json()) as { identityId: string; orgId: string };
    return { ok: true, identityId: body.identityId, orgId: body.orgId };
  }
  if (resp.status === 403) {
    return { ok: false, status: 403, reason: "bad_credentials" };
  }
  return { ok: false, status: 401, reason: "auth_upstream_failed" };
}
