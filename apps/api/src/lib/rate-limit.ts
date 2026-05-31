/**
 * rate-limit.ts — Hono middleware factory wrapping the Cloudflare Rate
 * Limiting binding.
 *
 * Sprint 9 — AUD-2 FIX-2 (adapted from the Next.js attempt for the Hono
 * API Worker, where the actual login endpoints live).
 *
 * Pattern:
 *
 *   adminAuth.post(
 *     "/login",
 *     rateLimit({
 *       keyBy: "email_or_ip",
 *       limit: 10,
 *       windowSec: 900,
 *       bindingName: "ADMIN_LOGIN_RATE_LIMITER",
 *     }),
 *     async (c) => { ... }
 *   );
 *
 * The binding is declared in wrangler.jsonc — see
 * docs/operator/RATE_LIMITER_BINDINGS_TODO.md. When the binding is
 * missing (dev environments, miswired prod) the middleware fails OPEN
 * with a console.warn so the login path stays usable. Production worker
 * configuration is verified by integration test, not by middleware fail.
 */
import type { Context, MiddlewareHandler } from "hono";
import type { Env } from "../bindings";

/**
 * Shape of the Cloudflare Rate Limiting binding's `.limit()` return.
 * Defined locally so this middleware doesn't depend on the
 * `@cloudflare/workers-types` Rate Limit types being wired in.
 */
interface RateLimitBinding {
  limit(input: { key: string }): Promise<{ success: boolean }>;
}

export interface RateLimitOptions {
  /**
   * Bucket key construction.
   *
   *   - "ip": one bucket per CF-Connecting-IP.
   *   - "email_or_ip": prefer body.email (lowercased) joined with IP;
   *     fall back to IP alone when email absent or unparseable.
   */
  keyBy: "ip" | "email_or_ip";

  /** Quota in requests per `windowSec`. Surfaced in the 429 body. */
  limit: number;

  /** Window in seconds. Surfaced as `retry_after_sec` in the 429 body. */
  windowSec: number;

  /**
   * Name of the binding on `c.env`. Must match the binding declared in
   * wrangler.jsonc (`name: "..."`).
   */
  bindingName: keyof Env;
}

/**
 * Pull the originating IP for keying. Worker request headers carry
 * `CF-Connecting-IP` for direct hits and `X-Forwarded-For` for proxied
 * ones. Fall back to a constant `"unknown"` so the bucket still works,
 * with a warn so the operator knows the bucket aggregated.
 */
function getRequestIp(c: Context): string {
  const cfIp = c.req.header("cf-connecting-ip");
  if (cfIp) return cfIp;
  const xff = c.req.header("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  console.warn(
    "[rate-limit] no CF-Connecting-IP or X-Forwarded-For — bucketing under 'unknown'",
  );
  return "unknown";
}

/**
 * Best-effort email read from the request body for `email_or_ip` mode.
 * Cloning the request before middleware lets the downstream handler
 * still call `c.req.json()`. If parsing fails for any reason, returns
 * null and the caller falls back to IP-only keying.
 */
async function tryReadEmail(c: Context): Promise<string | null> {
  try {
    const cloned = c.req.raw.clone();
    const body = (await cloned.json().catch(() => null)) as unknown;
    if (
      body &&
      typeof body === "object" &&
      "email" in body &&
      typeof (body as { email: unknown }).email === "string"
    ) {
      return (body as { email: string }).email.trim().toLowerCase();
    }
  } catch {
    // ignore
  }
  return null;
}

async function buildKey(c: Context, opts: RateLimitOptions): Promise<string> {
  const ip = getRequestIp(c);
  if (opts.keyBy === "ip") return `ip:${ip}`;
  const email = await tryReadEmail(c);
  if (email) return `email_ip:${email}|${ip}`;
  return `ip:${ip}`; // fallback for missing/malformed body
}

/**
 * Factory returning a Hono middleware that gates a route by the
 * Cloudflare Rate Limiting binding. Fails OPEN with a warn if the
 * binding is missing — exactly what dev environments need.
 */
export function rateLimit(opts: RateLimitOptions): MiddlewareHandler {
  return async (c, next) => {
    const binding = (c.env as unknown as Record<string, unknown>)[
      opts.bindingName as string
    ];
    if (!binding || typeof (binding as RateLimitBinding).limit !== "function") {
      console.warn(
        `[rate-limit] binding ${String(opts.bindingName)} missing or malformed — failing open`,
      );
      return next();
    }
    const key = await buildKey(c, opts);
    const result = await (binding as RateLimitBinding).limit({ key });
    if (!result.success) {
      c.header("Retry-After", String(opts.windowSec));
      return c.json(
        {
          error: "rate_limited",
          retry_after_sec: opts.windowSec,
          limit: opts.limit,
        },
        429,
      );
    }
    await next();
  };
}
