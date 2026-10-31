// Pointing an OEM's chargers at Straumvakt, after they are registered.
//
// This runs only for chargers that already exist in Straumvakt (registered first, in the one save), only for the chargers the
// operator selected, and only when the deployment switched configuration on (CPO_VENDOR_CONFIGURE names the vendor). The order
// is always: READ what the vendor holds now -> classify -> write only if nothing would be overwritten -> READ BACK and compare.
// Anything else is reported as a specific result and nothing is changed.
//
// What this module never does, by construction (there is no code path for any of it):
//   - start, stop, reset, unlock or send a charging profile; change a current limit, load-balancing owner, authorisation
//     policy, certificate, firmware or operator; write an installation-wide or operator-wide default;
//   - overwrite a backend that is already configured and is not ours;
//   - call a host other than the vendor's fixed one, or follow a redirect, or retry;
//   - return or log a token, a password or a vendor URL's path/query (a foreign backend is reported by host only).
//
// An accepted vendor call is NOT a connected charger. The most this module can say after a verified write is "configured";
// the charger still has to reconnect and send a BootNotification, which is observed elsewhere (Incoming / Chargers).
//
// What is documented and what is not (Codex read the vendor pages 2026-10-31; see the handoff):
//   Easee: the local-OCPP commissioning API stores a versioned connection configuration and applies it. The configuration
//     fields used here (connectivityMode DualProtocol, websocketConnectionArgs.url, chargePointId) are the ones the page names;
//     the apply request body and the exact read-back shape are NOT confirmed. DualProtocol is the mode that keeps Easee's own
//     cloud (and so its load balancing) alongside the OCPP backend. Every step is verified by reading back, and an unconfirmed
//     contract fails visibly instead of reporting success.
//   Zaptec: the Integrations API (charger onboarding / ocpp-settings, installation ocpp-cloud mode) is documented as existing
//     but its request schemas are not in our reference, and the installation-level mode is installation-wide. No Zaptec write is
//     implemented. The read-and-classify below still tells the operator exactly what is configured and what to set.

import { chargerAddress, CONNECTION_DOMAIN } from "./address";
import { CheckError, EASEE_UPSTREAM, USER_AGENT, ZAPTEC_UPSTREAM, retryAfterSeconds, type Fetcher } from "./vendor-read.mjs";

export type CommissionState = "configured" | "already_configured" | "blocked" | "failed" | "not_attempted";

export type CommissionCode =
  | "not_enabled"
  | "no_routing"
  | "serial_unverified"
  | "prerequisites"
  | "different_backend"
  | "identity_mismatch"
  | "not_cloud_mode"
  | "write_contract_unconfirmed"
  | "store_unconfirmed"
  | "apply_failed"
  | "readback_mismatch"
  | "vendor_error"
  | "unreachable"
  | "rate_limited"
  | "connection_ended"
  | "stopped_earlier"
  | "ok";

export type CommissionTarget = {
  /** The vendor's own reference for the charger. */
  ref: string;
  name: string | null;
  /** Only an explicit serial/device-id the vendor reported. Null = not established. */
  serialNumber: string | null;
  /** The identity registered in Straumvakt for this charger: what the charger must connect as. */
  chargePointId: string;
};

export type CommissionResult = {
  ref: string;
  chargePointId: string;
  /** The address the charger must connect to; null when it cannot be formed (no routing id). */
  address: string | null;
  state: CommissionState;
  code: CommissionCode;
  message: string;
};

export type CommissionRun = {
  results: CommissionResult[];
  /** The vendor refused the token: the connection is over. */
  ended: boolean;
  /** Seconds the vendor asked us to wait (429). Remaining targets were not attempted. */
  retryAfter: number | null;
};

export type CommissionInput = {
  vendor: string;
  accessToken: string;
  /** The vendor's reference for the installation (needed by Zaptec's installation-level read). */
  installationRef: string;
  /** The workspace CPO's routing label. */
  routingId: string | null;
  /** CPO_VENDOR_CONFIGURE names this vendor. */
  enabled: boolean;
  targets: CommissionTarget[];
  fetcher: Fetcher;
};

export const EASEE_LOCAL_OCPP = `${EASEE_UPSTREAM}/local-ocpp`;
export const CONFIGURABLE_VENDORS = ["easee", "zaptec"] as const;

/** The vendors whose configuration this deployment has switched on. Empty by default. */
export function configurableVendors(env: Record<string, string | undefined> | undefined): string[] {
  const names = (env?.CPO_VENDOR_CONFIGURE ?? "").split(",").map((s) => s.trim().toLowerCase());
  return [...new Set(names.filter((n) => (CONFIGURABLE_VENDORS as readonly string[]).includes(n)))];
}

// ── Address comparison ─────────────────────────────────────────────────────

const trimSlash = (s: string) => s.replace(/\/+$/, "");

/** `{deviceId}` is Zaptec's documented placeholder for the charger serial. Returns null when it cannot be filled. */
function fillTemplate(url: string, serial: string | null): string | null {
  if (!url.includes("{deviceId}")) return url;
  return serial ? url.replaceAll("{deviceId}", serial) : null;
}

/**
 * The address a stored configuration makes a charger use: the stored URL, with the identity appended exactly once. A URL that
 * already ends in the identity is taken as complete; otherwise the identity is appended (the documented default when an id is
 * supplied separately). Returns null for something that is not a URL.
 */
export function effectiveAddress(url: string, chargePointId: string | null): string | null {
  const base = trimSlash(url.trim());
  if (!/^wss?:\/\/[^\s/?#]+/i.test(base) || /[?#]/.test(base)) return null;
  if (!chargePointId) return base;
  return base.endsWith(`/${chargePointId}`) ? base : `${base}/${chargePointId}`;
}

const hostOf = (url: string): string => {
  try {
    return new URL(url.replace(/^ws/i, "http").replaceAll("{deviceId}", "x")).host.toLowerCase();
  } catch {
    return "an unreadable address";
  }
};

type Place = "same" | "ours_other_identity" | "foreign" | "unreadable";

function classify(effective: string | null, rawUrl: string, expected: string, routingId: string): Place {
  if (effective === null) return "unreadable";
  if (effective === expected) return "same";
  return hostOf(rawUrl) === `${routingId}.${CONNECTION_DOMAIN}` ? "ours_other_identity" : "foreign";
}

// ── Vendor calls ───────────────────────────────────────────────────────────

class Ended extends Error {}
class Limited extends Error {
  constructor(readonly seconds: number | null) {
    super("limited");
  }
}

async function call(fetcher: Fetcher, method: "GET" | "POST", url: string, token: string, body?: unknown): Promise<Response> {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}`, "user-agent": USER_AGENT, accept: "application/json" };
  if (body !== undefined) headers["content-type"] = "application/json";
  const response = await fetcher(url, {
    method,
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (response.status === 401) throw new Ended();
  if (response.status === 429) throw new Limited(retryAfterSeconds(response));
  return response;
}

const json = async (response: Response): Promise<Record<string, unknown> | null> => {
  try {
    const v: unknown = await response.json();
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

const result = (t: CommissionTarget, address: string | null, state: CommissionState, code: CommissionCode, message: string): CommissionResult => ({
  ref: t.ref,
  chargePointId: t.chargePointId,
  address,
  state,
  code,
  message,
});

// ── Easee ──────────────────────────────────────────────────────────────────

const EASEE_SERIAL = /^[0-9A-Za-z_-]{3,40}$/;

type EaseeStored = { exists: boolean; url: string | null; chargePointId: string | null; mode: string | null; version: string | null };

function parseEaseeStored(body: Record<string, unknown> | null): EaseeStored {
  if (!body) return { exists: false, url: null, chargePointId: null, mode: null, version: null };
  const cfg = obj(body.configuration ?? body.connectionDetails ?? body);
  const args = obj(cfg.websocketConnectionArgs);
  const v = cfg.version ?? body.version;
  return {
    exists: true,
    url: str(args.url),
    chargePointId: str(cfg.chargePointId),
    mode: str(cfg.connectivityMode),
    version: typeof v === "number" && Number.isSafeInteger(v) ? String(v) : typeof v === "string" && /^[0-9]{1,12}$/.test(v) ? v : null,
  };
}

async function easeeOne(i: CommissionInput, t: CommissionTarget, routingId: string): Promise<CommissionResult> {
  const expected = chargerAddress(routingId, t.chargePointId)!;
  const serial = t.serialNumber;
  if (!serial || !EASEE_SERIAL.test(serial)) {
    return result(t, expected, "blocked", "serial_unverified", "Easee did not report this charger's serial number, which its commissioning API requires. Nothing was changed; set the address on the charger in Easee's own tools.");
  }
  const details = `${EASEE_LOCAL_OCPP}/v1/connection-details/${encodeURIComponent(serial)}`;

  const read = async () => call(i.fetcher, "GET", details, i.accessToken);
  const first = await read();
  let stored = parseEaseeStored(null);
  if (first.status === 403) {
    return result(t, expected, "blocked", "prerequisites", "Easee does not allow this account to configure this charger's OCPP connection. Easee's page lists: firmware 344 or newer, Easee as the site operator, and Wi-Fi. Nothing was changed.");
  }
  if (first.ok) stored = parseEaseeStored(await json(first));
  else if (first.status !== 404) {
    return result(t, expected, "failed", "vendor_error", `Reading the charger's current OCPP configuration failed (Easee HTTP ${first.status}). Nothing was changed.`);
  }

  if (stored.url) {
    const place = classify(effectiveAddress(stored.url, stored.chargePointId ?? serial), stored.url, expected, routingId);
    if (place === "same") return result(t, expected, "already_configured", "ok", "Already configured for this address. Waiting for the charger to connect.");
    if (place === "ours_other_identity") {
      return result(t, expected, "blocked", "identity_mismatch", "This charger is already set to connect to Straumvakt under a different OCPP id. Register that id instead, or change it on the charger. Nothing was changed.");
    }
    return result(t, expected, "blocked", "different_backend", `This charger is already configured for another OCPP backend (${hostOf(stored.url)}). It was not overwritten.`);
  }

  // Nothing is configured: store, apply, read back. Dual protocol keeps Easee's own cloud (and its load balancing) running
  // next to the OCPP backend. No password is sent: authorisation policy is not changed here.
  const store = await call(i.fetcher, "POST", details, i.accessToken, {
    connectivityMode: "DualProtocol",
    websocketConnectionArgs: { url: trimSlash(cpoBase(routingId)) },
    chargePointId: t.chargePointId,
  });
  if (!store.ok) {
    return result(t, expected, "failed", "vendor_error", `Easee did not accept the configuration (HTTP ${store.status}). Nothing was applied to the charger.`);
  }
  const version = parseEaseeStored(await json(store)).version;
  if (!version) {
    return result(t, expected, "failed", "store_unconfirmed", "Easee stored a configuration but did not say which version, so it was not applied. Retry, or check the charger in Easee's tools.");
  }
  const apply = await call(i.fetcher, "POST", `${EASEE_LOCAL_OCPP}/v1/connections/chargers/${encodeURIComponent(serial)}`, i.accessToken, { version });
  if (!apply.ok) {
    return result(t, expected, "failed", "apply_failed", `Easee stored the configuration but did not apply it to the charger (HTTP ${apply.status}). Retry applies only what is unfinished.`);
  }
  const back = await read();
  const after = back.ok ? parseEaseeStored(await json(back)) : null;
  const effective = after?.url ? effectiveAddress(after.url, after.chargePointId ?? serial) : null;
  if (effective !== expected) {
    return result(t, expected, "failed", "readback_mismatch", "The configuration was sent but reading it back did not show the expected address. Check the charger in Easee's tools.");
  }
  return result(t, expected, "configured", "ok", "Configured and read back. The charger still has to reconnect and send its BootNotification; nothing here proves it is connected.");
}

const cpoBase = (routingId: string) => `wss://${routingId}.${CONNECTION_DOMAIN}/`;

// ── Zaptec ─────────────────────────────────────────────────────────────────

const ZAPTEC_ID = /^[0-9a-fA-F-]{10,100}$/;

async function zaptecAll(i: CommissionInput, routingId: string): Promise<CommissionResult[]> {
  const out: CommissionResult[] = [];
  const addressFor = (t: CommissionTarget) => chargerAddress(routingId, t.chargePointId);
  if (!ZAPTEC_ID.test(i.installationRef)) {
    return i.targets.map((t) => result(t, addressFor(t), "failed", "vendor_error", "The Zaptec installation reference is not usable. Nothing was changed."));
  }
  // One installation-level read for all selected chargers of this installation.
  const inst = await call(i.fetcher, "GET", `${ZAPTEC_UPSTREAM}/api/installation/${encodeURIComponent(i.installationRef)}`, i.accessToken);
  if (inst.status === 403) {
    return i.targets.map((t) => result(t, addressFor(t), "blocked", "prerequisites", "This Zaptec account may not read the installation's OCPP settings. Nothing was changed."));
  }
  if (!inst.ok) return i.targets.map((t) => result(t, addressFor(t), "failed", "vendor_error", `Reading the installation's OCPP settings failed (Zaptec HTTP ${inst.status}). Nothing was changed.`));
  const detail = (await json(inst)) ?? {};
  const mode = detail.AuthenticationType ?? detail.authenticationType;
  const installationUrl = str(detail.OcppCloudUrl ?? detail.ocppCloudUrl);

  for (const t of i.targets) {
    const expected = addressFor(t)!;
    // Cloud OCPP (enum 2) is the arrangement that keeps Zaptec's phase/load balancing. Switching the installation to another
    // mode, or to box-level OCPP, is installation-wide and is never done here.
    if (mode !== 2) {
      out.push(result(t, expected, "blocked", "not_cloud_mode", "This Zaptec installation is not in cloud OCPP mode. Straumvakt does not switch the installation's mode; set it in Zaptec Portal (cloud OCPP keeps Zaptec's load balancing). Nothing was changed."));
      continue;
    }
    if (!ZAPTEC_ID.test(t.ref)) {
      out.push(result(t, expected, "failed", "vendor_error", "The Zaptec charger reference is not usable. Nothing was changed."));
      continue;
    }
    const charger = await call(i.fetcher, "GET", `${ZAPTEC_UPSTREAM}/api/chargers/${encodeURIComponent(t.ref)}`, i.accessToken);
    if (!charger.ok) {
      out.push(result(t, expected, charger.status === 403 ? "blocked" : "failed", charger.status === 403 ? "prerequisites" : "vendor_error", `Reading the charger's OCPP settings failed (Zaptec HTTP ${charger.status}). Nothing was changed.`));
      continue;
    }
    const cdetail = (await json(charger)) ?? {};
    // The installation URL overrides a charger URL (Zaptec's configuration guide).
    const rawUrl = installationUrl ?? str(cdetail.PropertyOcppUrl ?? cdetail.propertyOcppUrl);
    if (!rawUrl) {
      out.push(result(t, expected, "blocked", "write_contract_unconfirmed", `No OCPP address is set on this charger. Straumvakt does not change Zaptec's OCPP settings automatically yet (the request format is not confirmed). In Zaptec Portal set the charger's OCPP URL to ${expected}, then wait for it to connect.`));
      continue;
    }
    const serial = t.serialNumber ?? str(cdetail.DeviceId ?? cdetail.deviceId);
    const filled = fillTemplate(rawUrl, serial);
    if (filled === null) {
      out.push(result(t, expected, "blocked", "serial_unverified", "The configured Zaptec URL uses the charger's serial, which Zaptec did not report. Nothing was changed."));
      continue;
    }
    const place = classify(effectiveAddress(filled, null), filled, expected, routingId);
    if (place === "same") out.push(result(t, expected, "already_configured", "ok", "Already configured for this address. Waiting for the charger to connect."));
    else if (place === "ours_other_identity") {
      out.push(result(t, expected, "blocked", "identity_mismatch", "This charger is already set to connect to Straumvakt under a different OCPP id. Register that id instead, or change the URL in Zaptec Portal. Nothing was changed."));
    } else {
      out.push(result(t, expected, "blocked", "different_backend", `This Zaptec charger is already configured for another OCPP backend (${hostOf(filled)}). It was not overwritten.`));
    }
  }
  return out;
}

// ── Entry point ────────────────────────────────────────────────────────────

/**
 * Commission the given registered chargers of ONE vendor installation. Never throws for a vendor outcome: each target gets a
 * result, a refused token ends the run (`ended`), and a 429 stops it (`retryAfter`) with the rest marked not attempted.
 */
export async function commissionChargers(i: CommissionInput): Promise<CommissionRun> {
  const addressFor = (t: CommissionTarget) => (i.routingId ? chargerAddress(i.routingId, t.chargePointId) : null);
  const all = (state: CommissionState, code: CommissionCode, message: string): CommissionResult[] => i.targets.map((t) => result(t, addressFor(t), state, code, message));
  if (!i.enabled) {
    return { ended: false, retryAfter: null, results: all("blocked", "not_enabled", "Automatic OCPP configuration is not switched on for this deployment. Set the address on the charger yourself.") };
  }
  if (!i.routingId) return { ended: false, retryAfter: null, results: all("blocked", "no_routing", "This CPO has no connection address yet. Nothing was changed.") };
  if (i.targets.length === 0) return { ended: false, retryAfter: null, results: [] };
  if (i.vendor !== "easee" && i.vendor !== "zaptec") {
    return { ended: false, retryAfter: null, results: all("blocked", "write_contract_unconfirmed", "Configuration is not available for this vendor.") };
  }

  try {
    if (i.vendor === "zaptec") return { ended: false, retryAfter: null, results: await zaptecAll(i, i.routingId) };
    const results: CommissionResult[] = [];
    for (const t of i.targets) {
      try {
        results.push(await easeeOne(i, t, i.routingId));
      } catch (error) {
        if (error instanceof Ended || error instanceof Limited) {
          const done = new Set(results.map((r) => r.ref));
          const rest = i.targets.filter((x) => !done.has(x.ref));
          const ended = error instanceof Ended;
          const message = ended ? "The vendor ended this connection. Connect again; nothing further was attempted." : "The vendor asked for a pause. Nothing further was attempted; retry later.";
          for (const x of rest) results.push(result(x, addressFor(x), "not_attempted", ended ? "connection_ended" : "rate_limited", message));
          return { results, ended, retryAfter: error instanceof Limited ? (error.seconds ?? 60) : null };
        }
        results.push(result(t, addressFor(t), "failed", "unreachable", "The vendor could not be reached or did not answer in time. Retry applies only what is unfinished."));
      }
    }
    return { results, ended: false, retryAfter: null };
  } catch (error) {
    if (error instanceof Ended) return { ended: true, retryAfter: null, results: all("not_attempted", "connection_ended", "The vendor ended this connection. Connect again; nothing was changed.") };
    if (error instanceof Limited) return { ended: false, retryAfter: error.seconds ?? 60, results: all("not_attempted", "rate_limited", "The vendor asked for a pause. Retry later; nothing was changed.") };
    if (error instanceof CheckError) return { ended: false, retryAfter: null, results: all("failed", "vendor_error", error.message) };
    return { ended: false, retryAfter: null, results: all("failed", "unreachable", "The vendor could not be reached or did not answer in time. Nothing was changed.") };
  }
}
