// Bound work before the engine RPC/Neon lookup. These platform limits are
// approximate per Cloudflare location, not a global quota or a spending cap.
// No charger payloads, counters or identities are logged or stored here.
export interface IngressGuardEnv {
  OCPP_ALLOWED_HOSTS?: string;
  OCPP_HOST_LIMITER?: RateLimit;
  OCPP_IDENTITY_LIMITER?: RateLimit;
}

export async function guardIngress(request: Request, env: IngressGuardEnv, url: URL): Promise<Response | null> {
  if (request.method !== "GET" || !/^\/[A-Za-z0-9._-]{1,48}$/.test(url.pathname) ||
      (request.headers.get("authorization")?.length ?? 0) > 1024) {
    return new Response("invalid connection request", { status: 400 });
  }
  if (!env.OCPP_ALLOWED_HOSTS || !env.OCPP_HOST_LIMITER || !env.OCPP_IDENTITY_LIMITER) {
    return new Response("connection admission unavailable", { status: 503 });
  }
  const hosts = env.OCPP_ALLOWED_HOSTS.split(",").map((h) => h.trim().toLowerCase());
  if (!hosts.includes(url.hostname)) return new Response("not found", { status: 404 });
  try {
    // A fixed host key gates rotating-id traffic before allocating identity keys.
    // Never key only by IP: installations can share a NAT/mobile connection.
    if (!(await env.OCPP_HOST_LIMITER.limit({ key: url.hostname })).success ||
        !(await env.OCPP_IDENTITY_LIMITER.limit({ key: `${url.hostname}${url.pathname}` })).success) {
      return new Response("retry later", { status: 429, headers: { "retry-after": "60" } });
    }
    return null;
  } catch {
    return new Response("connection admission unavailable", { status: 503 });
  }
}
