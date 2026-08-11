/**
 * Sentry event scrubbing for the OCPP gateway.
 *
 * The rule this module exists to enforce: **an OCPP payload is personal
 * data until proven otherwise.** `idTag` is a driver's RFID token, so
 * an unscrubbed exception carrying a frame body is a personal-data
 * export to a third-party processor. Scrubbing is therefore a
 * denylist-of-keys *plus* an allowlist-of-payload-fields, not one or
 * the other — a denylist alone fails on the next field OCPP adds, and
 * an allowlist alone fails on nested transport metadata.
 *
 * No Sentry SDK is imported. The dependency is not present in this
 * worktree and installing one was out of scope for this lane, so what
 * ships here is the part that must be right regardless of SDK version:
 * the `beforeSend` transform. Wiring it to `@sentry/cloudflare` is a
 * three-line patch recorded in
 * docs/notes/2026-08-11-sentry-analytics-engine-setup-runbook.md.
 *
 * No DSN literal appears in this file or anywhere in the repository.
 * The DSN is a Worker *secret*; a DSN is a credential-shaped URL and a
 * committed one lets anyone forge events into the project.
 */
import type { GatewayEnv } from "./auth";

/** Replacement marker. Distinctive so it is greppable in Sentry. */
export const REDACTED = "[redacted]";

/**
 * Keys whose *value* is never safe, at any depth, in any casing.
 * Matched as a substring of the lowercased key so `idTagInfo`,
 * `x-straumvakt-ingest` and `Authorization` are all caught.
 */
const DENY_KEY_SUBSTRINGS = [
  "idtag",
  "authorization",
  "password",
  "passwd",
  "secret",
  "token",
  "apikey",
  "api_key",
  "credential",
  "cookie",
  "session",
  "dsn",
  "email",
  "phone",
  "kennitala", // Icelandic national id — this is a domestic product
  "ssn",
  "vin",
  "meterserialnumber",
  "chargeboxserialnumber",
  "iccid",
  "imsi",
];

/**
 * OCPP payload fields explicitly judged safe to keep. Everything else
 * inside a frame payload is dropped. These are all enum-valued or
 * numeric protocol fields with no personal content, and they are the
 * ones that make an exception diagnosable at all.
 */
export const OCPP_PAYLOAD_ALLOWLIST = new Set([
  "status",
  "errorCode",
  "connectorId",
  "transactionId",
  "meterStart",
  "meterStop",
  "reason",
  "vendorId",
  "messageId",
  "currentTime",
  "interval",
  "chargePointVendor",
  "chargePointModel",
  "firmwareVersion",
  "timestamp",
  "measurand",
  "unit",
  "value",
]);

function isDeniedKey(key: string): boolean {
  const k = key.toLowerCase();
  return DENY_KEY_SUBSTRINGS.some((bad) => k.includes(bad));
}

/**
 * Recursively redacts denied keys. Depth- and breadth-bounded: a
 * hostile or cyclic structure must not turn scrubbing into a hang on
 * the error path, which is exactly when the system is least able to
 * absorb one.
 */
export function scrubValue(input: unknown, depth = 0): unknown {
  if (depth > 8) return REDACTED;
  if (input === null || typeof input !== "object") return input;
  if (Array.isArray(input)) {
    return input.slice(0, 50).map((v) => scrubValue(v, depth + 1));
  }
  const out: Record<string, unknown> = {};
  let seen = 0;
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (seen++ >= 100) break;
    out[key] = isDeniedKey(key) ? REDACTED : scrubValue(value, depth + 1);
  }
  return out;
}

/**
 * Reduces an OCPP frame payload to its allowlisted fields. Unknown
 * fields are dropped rather than redacted, because their *presence* can
 * itself be informative and the count is preserved separately.
 */
export function scrubOcppPayload(payload: unknown): Record<string, unknown> {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return { _dropped: REDACTED };
  }
  const src = payload as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  let dropped = 0;
  for (const [key, value] of Object.entries(src)) {
    if (OCPP_PAYLOAD_ALLOWLIST.has(key) && !isDeniedKey(key)) {
      out[key] = scrubValue(value, 1);
    } else {
      dropped++;
    }
  }
  if (dropped > 0) out._droppedFields = dropped;
  return out;
}

/** The subset of a Sentry event this scrubber understands. */
export interface SentryEventLike {
  request?: { headers?: Record<string, unknown>; url?: string; data?: unknown };
  extra?: Record<string, unknown>;
  contexts?: Record<string, unknown>;
  tags?: Record<string, unknown>;
  user?: unknown;
  breadcrumbs?: Array<{ message?: string; data?: unknown; [k: string]: unknown }>;
  message?: string;
  release?: string;
  [k: string]: unknown;
}

/**
 * Strips credentials that ride in a URL — Basic-Auth userinfo and any
 * query string. Chargers authenticate with Basic auth on the socket
 * URL, so `wss://user:pass@host/ocpp/ZPR074002` is a realistic value
 * and the password is in it.
 */
export function scrubUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.username || u.password) {
      u.username = REDACTED;
      u.password = "";
    }
    if ([...u.searchParams.keys()].length > 0) u.search = `?${REDACTED}`;
    return u.toString();
  } catch {
    return REDACTED;
  }
}

/**
 * `beforeSend`. Every event passes through here before leaving the
 * Worker.
 *
 * `user` is dropped wholesale rather than scrubbed: this gateway has no
 * legitimate reason to attribute a gateway exception to a person, and
 * an empty field cannot leak.
 */
export function scrubEvent(event: SentryEventLike): SentryEventLike {
  const out: SentryEventLike = { ...event };

  if (out.request) {
    const req = { ...out.request };
    if (req.headers) req.headers = scrubValue(req.headers, 1) as Record<string, unknown>;
    if (typeof req.url === "string") req.url = scrubUrl(req.url);
    if ("data" in req) req.data = scrubOcppPayload(req.data);
    out.request = req;
  }
  if (out.extra) out.extra = scrubValue(out.extra, 1) as Record<string, unknown>;
  if (out.contexts) out.contexts = scrubValue(out.contexts, 1) as Record<string, unknown>;
  if (out.tags) out.tags = scrubValue(out.tags, 1) as Record<string, unknown>;
  if ("user" in out) out.user = undefined;
  if (Array.isArray(out.breadcrumbs)) {
    out.breadcrumbs = out.breadcrumbs.slice(-30).map((b) => ({
      ...(scrubValue(b, 1) as Record<string, unknown>),
    }));
  }
  return out;
}

export interface SentryConfig {
  enabled: boolean;
  dsn?: string;
  release?: string;
  environment: string;
}

/**
 * Builds config from the environment. Absent DSN disables reporting
 * rather than throwing — a missing optional secret must not stop a
 * gateway from serving chargers.
 *
 * `release` is the Worker version id from the `version_metadata`
 * binding. Without it a regression cannot be keyed to a deploy, which
 * is currently the project's single blocking release gap.
 */
export function sentryConfigFrom(env: Partial<GatewayEnv>, environment = "unknown"): SentryConfig {
  const dsn = typeof env.SENTRY_DSN === "string" && env.SENTRY_DSN.trim() !== ""
    ? env.SENTRY_DSN.trim()
    : undefined;
  return {
    enabled: dsn !== undefined,
    dsn,
    release: env.CF_VERSION_METADATA?.id,
    environment,
  };
}
