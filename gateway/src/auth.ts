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
 *
 * On the *no-auth* path (charger connects without a Basic-Auth
 * header), we still reject the upgrade but log the attempt to the
 * pending-discovery pool so /chargers/pending surfaces the connection
 * — without that, operator can't see chargers that haven't been
 * configured with credentials yet. Identity-mismatch is treated the
 * same way (the URL identity is what we'd want the operator to see).
 * Both fall through to a 401 to the charger.
 */
export async function authenticate(
  env: GatewayEnv,
  urlIdentityString: string,
  authHeader: string | null,
): Promise<AuthResult> {
  const basic = parseBasicAuth(authHeader);
  if (!basic) {
    await logPendingDiscovery(env, urlIdentityString);
    return { ok: false, status: 401, reason: "missing_basic_auth" };
  }
  if (basic.username !== urlIdentityString) {
    await logPendingDiscovery(env, urlIdentityString);
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
    // ocpp-auth route already upserts pending_discoveries on 403 —
    // no double-log needed here.
    return { ok: false, status: 403, reason: "bad_credentials" };
  }
  return { ok: false, status: 401, reason: "auth_upstream_failed" };
}

/**
 * Best-effort. Failure is silent — we never block the charger
 * response on observability writes. Same OCPP_INGEST_SECRET gate as
 * the auth call.
 */
async function logPendingDiscovery(env: GatewayEnv, identityString: string): Promise<void> {
  try {
    const resp = await env.MAIN_APP.fetch(
      new Request("https://main.internal/api/internal/pending-discovery", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-straumvakt-ingest": env.OCPP_INGEST_SECRET,
        },
        body: JSON.stringify({ identityString }),
      }),
    );
    // Drain the body. Without this the Service Binding subrequest is
    // marked Canceled when this Worker returns its own response —
    // and the API Worker's Prisma upsert can be interrupted mid-write.
    await resp.text().catch(() => null);
  } catch (err) {
    console.error("[gateway] pending-discovery log failed", {
      identityString,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
