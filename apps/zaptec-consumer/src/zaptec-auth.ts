// Zaptec OAuth password grant + per-installation messagingConnectionDetails
// fetcher. Token is cached in-process; re-grants on 401 (~24h TTL per
// integration docs). The /oauth/token endpoint rate-limits back-to-back
// grants — single in-flight refresh prevents thundering-herd if multiple
// callers hit `getAccessToken()` simultaneously after expiry.

import { log } from "./logger.js";

const ZAPTEC_BASE = "https://api.zaptec.com";

export interface MessagingConnectionDetails {
  Type?: number;
  Host: string;
  Port: number;
  UseSSL?: boolean;
  Username: string;
  /** SAS token. Never log this value. */
  Password: string;
  Topic: string;
  Subscription: string;
}

export interface InstallationLite {
  Id: string;
  Name?: string;
  MessagingEnabled?: boolean;
}

interface CachedToken {
  token: string;
  acquiredAt: number;
}

const TOKEN_TTL_MS = 23 * 60 * 60 * 1000; // 23h — re-grant before Zaptec's 24h cliff.

let cached: CachedToken | null = null;
let inFlightGrant: Promise<string> | null = null;

export async function getAccessToken(
  username: string,
  password: string,
): Promise<string> {
  const now = Date.now();
  if (cached && now - cached.acquiredAt < TOKEN_TTL_MS) {
    return cached.token;
  }
  if (inFlightGrant) return inFlightGrant;

  inFlightGrant = (async () => {
    const res = await fetch(`${ZAPTEC_BASE}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "password",
        username,
        password,
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`oauth_failed: ${res.status} ${text.slice(0, 200)}`);
    }
    const json = (await res.json()) as { access_token: string };
    cached = { token: json.access_token, acquiredAt: Date.now() };
    log.info("zaptec_oauth_granted");
    return json.access_token;
  })();

  try {
    return await inFlightGrant;
  } finally {
    inFlightGrant = null;
  }
}

/** Force a re-grant on next call (use when an API returns 401). */
export function invalidateToken(): void {
  cached = null;
}

export async function listInstallations(
  accessToken: string,
): Promise<InstallationLite[]> {
  const res = await fetch(`${ZAPTEC_BASE}/api/installation`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `list_installations_failed: ${res.status} ${text.slice(0, 200)}`,
    );
  }
  const json = (await res.json()) as { Data?: InstallationLite[] };
  return json.Data ?? [];
}

export async function getMessagingConnectionDetails(
  accessToken: string,
  installationId: string,
): Promise<MessagingConnectionDetails> {
  const res = await fetch(
    `${ZAPTEC_BASE}/api/installation/${installationId}/messagingConnectionDetails`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `messaging_connection_failed: ${res.status} ${text.slice(0, 200)}`,
    );
  }
  return (await res.json()) as MessagingConnectionDetails;
}
