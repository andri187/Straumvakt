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
  // Sprint 5 / ADR 0017 — inbound OCPP events queue. Optional because
  // local-dev (`wrangler dev --local`) doesn't bind queues; the
  // ingest-client falls back to a direct service-binding postEvent
  // call when this is undefined so the simulator dev loop works.
  OCPP_EVENTS_QUEUE?: {
    send: (body: unknown) => Promise<void>;
  };
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

  // Identity-string from the URL path takes precedence as the
  // resolution key. Only block immediately on hard mismatch (creds
  // present but for a different identity — no legitimate flow does
  // this). The "no Basic Auth at all" case is no longer a fail-fast:
  // the API route decides whether this identity is on the no-auth
  // path.
  if (basic && basic.username !== urlIdentityString) {
    await logPendingDiscovery(env, urlIdentityString);
    return { ok: false, status: 401, reason: "identity_mismatch" };
  }

  // Always call the API so it can decide based on the stored
  // auth_secret_hash. `password` is now optional — when the charger
  // sent no Basic Auth, we forward identity-only and let the API
  // accept (no-auth installation) or reject (auth required, missing).
  // This shifts one decision into the API, costs the no-auth path
  // exactly the same one service-binding hop as the Basic-Auth
  // path, and removes the duplicate "missing creds → 401" log.
  const resp = await env.MAIN_APP.fetch(
    new Request("https://main.internal/api/internal/ocpp-auth", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-straumvakt-ingest": env.OCPP_INGEST_SECRET,
      },
      body: JSON.stringify({
        identityString: urlIdentityString,
        password: basic?.password,
      }),
    }),
  );

  if (resp.status === 200) {
    const body = (await resp.json()) as {
      identityId: string;
      orgId: string;
      authMode?: "basic" | "none";
    };
    return { ok: true, identityId: body.identityId, orgId: body.orgId };
  }
  if (resp.status === 403) {
    // ocpp-auth already upserts pending_discoveries on 403; no
    // double-log here. The 403 reason is overloaded (identity
    // unknown vs auth required but missing vs bad credentials) —
    // the surface to the charger is the same: 401, retry.
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
