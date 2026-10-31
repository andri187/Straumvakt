// Direct OEM onboarding, server side: connect once, list the account's installations, read the SELECTED ones and hand each
// to the one existing save path (api.ts -> service.ts). Pure request-in / reply-out so it can be tested without HTTP or a
// database; api.ts does the authentication, same-origin and JSON guards first and the save afterwards.
//
// Boundaries kept deliberately:
//   - The vendor token never leaves the server except inside the sealed, bound, short-lived cookie (./vendor-connection.ts).
//     No reply from here contains a token, a password, a refresh token or a raw vendor response.
//   - Everything saved is read here, from the vendor, with the connection's own token. The browser names only which listed
//     installation to onboard and the Straumvakt site; a vendor package supplied by the browser is never accepted. The
//     browser-supplied reference is not proof of access: the vendor's own API answers (or refuses) for this token.
//   - Read-only towards the vendor. Its sign-in is the only POST. No charger setting, OCPP URL, balancing or profile is
//     written, and no charger is contacted.
//   - Switched off unless the deployment names the vendor in CPO_VENDOR_CONNECT (a non-secret setting). This is a
//     controlled pre-commercial operator capability, not a commercial customer-password onboarding design. A vendor's
//     authorised-consent integration, which would replace the password step, is a separate piece of work.
//   - A 429 is passed on with its Retry-After and remembered in a wait cookie. That cookie is client-held: a courtesy that
//     stops an honest page from hammering a vendor, not a rate-limit guarantee, and nothing here relies on Worker memory.

import { z } from "zod";
import { readShellConfig, type ShellEnv } from "@/lib/cpo-shell-session";
import {
  CheckError,
  checkEaseeConnection,
  checkZaptecConnection,
  readEaseeInventory,
  readEaseeSitePackage,
  readZaptecInventory,
  readZaptecSitePackage,
  type Fetcher,
  type Inventory,
  type KeptToken,
} from "./vendor-read.mjs";
import { commissionChargers, configurableVendors, type CommissionRun, type CommissionTarget } from "./vendor-commissioning";
import {
  ConnectionError,
  clearConnectionCookie,
  connectionCookie,
  connectionCookieName,
  isVendorSlug,
  openConnection,
  readCookie,
  remainingWaitSeconds,
  sealConnection,
  waitCookie,
  type ConnectionBinding,
} from "./vendor-connection";
import { mapPackageToSave, parseVendorPackage, type MapResult } from "./vendor-import";

// ── Vendor registry ────────────────────────────────────────────────────────
// A vendor is available for direct onboarding only when it has an entry here AND the deployment names it in
// CPO_VENDOR_CONNECT. Easee and Zaptec share everything below (connection, selection, save, retry, results); only the sign-in,
// the reads and the commissioning differ.

type SignIn = (input: { username: unknown; password: unknown }, fetcher: Fetcher, keep: (t: KeptToken) => void) => Promise<Inventory & { claims?: string[] | null }>;

type Reader = {
  slug: string;
  label: string;
  signIn: SignIn;
  inventory: (accessToken: string, fetcher: Fetcher) => Promise<Inventory>;
  readPackage: (accessToken: string, ref: string, fetcher: Fetcher) => Promise<{ installationId: string; package: unknown }>;
};

const READERS: Record<string, Reader> = {
  easee: {
    slug: "easee",
    label: "Easee",
    signIn: (input, fetcher, keep) => checkEaseeConnection(input, fetcher, keep),
    inventory: (token, fetcher) => readEaseeInventory(token, fetcher),
    readPackage: (token, ref, fetcher) => readEaseeSitePackage(token, ref, fetcher),
  },
  zaptec: {
    slug: "zaptec",
    label: "Zaptec",
    signIn: (input, fetcher, keep) => checkZaptecConnection(input, fetcher, keep),
    inventory: (token, fetcher) => readZaptecInventory(token, fetcher),
    readPackage: (token, ref, fetcher) => readZaptecSitePackage(token, ref, fetcher),
  },
};

const hasReader = (slug: string) => Object.prototype.hasOwnProperty.call(READERS, slug);

/** The vendors this deployment has switched on: the names in CPO_VENDOR_CONNECT that also have a reader. Empty by default. */
export function enabledVendors(env: ShellEnv | undefined): string[] {
  const raw = env?.CPO_VENDOR_CONNECT ?? "";
  const names = raw.split(",").map((s) => s.trim().toLowerCase()).filter((s) => isVendorSlug(s) && hasReader(s));
  return [...new Set(names)];
}

// ── Requests and replies ───────────────────────────────────────────────────

export type VendorContext = {
  request: Request;
  env: ShellEnv | undefined;
  /** The workspace CPO (CPO_SHELL_ORG_ID); null when the workspace is not associated with one. */
  orgId: string | null;
  /** The current signed shell session cookie value; the connection is bound to it. */
  shellSessionToken: string;
  fetcher?: Fetcher;
  now?: () => number;
};

export type VendorReply = { status: number; body: Record<string, unknown>; cookies: string[]; headers?: Record<string, string> };

const reply = (status: number, body: Record<string, unknown>, cookies: string[] = [], headers?: Record<string, string>): VendorReply => ({ status, body, cookies, ...(headers ? { headers } : {}) });

const VendorField = z.string().regex(/^[a-z][a-z0-9-]{1,31}$/);
const ConnectRequest = z.object({ action: z.literal("vendor-connect"), vendor: VendorField, username: z.string().max(320), password: z.string().max(1024) });
const VendorOnlyRequest = z.object({ action: z.enum(["vendor-inventory", "vendor-disconnect"]), vendor: VendorField });
const OnboardRequest = z.object({
  action: z.literal("vendor-onboard"),
  vendor: VendorField,
  /** The vendor's own reference for the installation, taken from the list this connection returned. Not proof of access. */
  installationRef: z.string().min(1).max(100),
  siteId: z.string().uuid(),
  idempotencyKey: z.string().uuid(),
  /** The operator accepts the vendor's rated current / three-phase flag as the circuit rating and phase count. */
  acceptVendorElectrical: z.boolean().default(false),
  /** Equipment reference → the charger's own OCPP identity. Optional; the page does not ask for it before the read. */
  ocppIds: z.record(z.string(), z.string().max(64)).refine((r) => Object.keys(r).length <= 500, "Too many identities").default({}),
});
export type OnboardRequest = z.output<typeof OnboardRequest>;

const invalid = (error: z.ZodError) =>
  reply(422, { error: "validation", message: "Some fields need attention", problems: error.issues.slice(0, 20).map((i) => ({ path: i.path.join("."), message: i.message })) });

type Gated = { reader: Reader; binding: ConnectionBinding; secret: string; fetcher: Fetcher; now: () => number };

/** Is this vendor switched on, does the workspace have a CPO, and is there a secret to seal with? */
function gate(ctx: VendorContext, vendor: string): VendorReply | Gated {
  if (!isVendorSlug(vendor) || !hasReader(vendor) || !enabledVendors(ctx.env).includes(vendor)) {
    return reply(404, { error: "vendor_connect_disabled", message: "Direct connection to this OEM is not enabled for this deployment." });
  }
  if (!ctx.orgId) return reply(409, { error: "no_context", message: "No CPO is set for this workspace." });
  const secret = readShellConfig(ctx.env)?.secret;
  if (!secret) return reply(503, { error: "connection_unavailable", message: "Connections cannot be kept on this deployment." });
  return {
    reader: READERS[vendor],
    binding: { vendor, orgId: ctx.orgId, shellSessionToken: ctx.shellSessionToken },
    secret,
    fetcher: ctx.fetcher ?? globalThis.fetch.bind(globalThis),
    now: ctx.now ?? Date.now,
  };
}

const isReply = (v: VendorReply | Gated): v is VendorReply => "status" in v;

/** A vendor wait recorded in the browser: refused before anything leaves the Worker. */
function waiting(ctx: VendorContext, g: Gated): VendorReply | null {
  const seconds = remainingWaitSeconds(ctx.request.headers.get("cookie"), g.binding.vendor, g.now());
  if (seconds <= 0) return null;
  return reply(429, { error: "vendor_rate_limited", message: `${g.reader.label} asked for a pause. Try again in ${seconds} second${seconds === 1 ? "" : "s"}.`, retryAfter: seconds }, [], { "retry-after": String(seconds) });
}

/**
 * A vendor failure as a reply. `ended` is what a refused token means for this call: during sign-in it is a refused sign-in;
 * afterwards it is the end of the connection, which is cleared so the page asks for a fresh sign-in.
 */
function failed(ctx: VendorContext, g: Gated, error: unknown, during: "sign-in" | "connected"): VendorReply {
  const url = ctx.request.url;
  if (error instanceof CheckError) {
    if (error.status === 429) {
      const wait = error.retryAfter ?? 60;
      return reply(429, { error: "vendor_rate_limited", message: error.message, retryAfter: wait }, [waitCookie(g.binding.vendor, wait, url, g.now())], { "retry-after": String(wait) });
    }
    if (error.status === 401) {
      if (during === "sign-in") return reply(422, { error: "vendor_sign_in_refused", message: error.message });
      return reply(409, { error: "connection_required", message: `${g.reader.label} ended this connection. Connect again.` }, [clearConnectionCookie(g.binding.vendor, url)]);
    }
    if (error.status === 400) return reply(422, { error: "vendor_input", message: error.message });
    if (error.status === 403) return reply(422, { error: "vendor_forbidden", message: error.message });
    if (error.status === 501) return reply(501, { error: "vendor_not_available", message: error.message });
    return reply(502, { error: "vendor_unavailable", message: error.message });
  }
  // Timeouts, network failures and anything unexpected: no upstream detail is passed on.
  return reply(502, { error: "vendor_unavailable", message: `${g.reader.label} could not be reached or did not answer in time. Nothing was changed.` });
}

const shape = (inventory: Inventory) => ({
  // A row without a usable id cannot be selected for onboarding, so it is not offered.
  installations: inventory.installations.filter((i) => i.id !== "").map((i) => ({ id: i.id, name: i.name, activeChargerCount: i.activeChargerCount })),
  more: inventory.more,
});

async function opened(ctx: VendorContext, g: Gated) {
  return openConnection(readCookie(ctx.request.headers.get("cookie"), connectionCookieName(g.binding.vendor)), g.binding, g.secret, g.now());
}

// ── Actions ────────────────────────────────────────────────────────────────

/** Signs in once, lists the account's installations and keeps the connection sealed in the browser. */
export async function vendorConnect(ctx: VendorContext, raw: unknown): Promise<VendorReply> {
  const req = ConnectRequest.safeParse(raw);
  if (!req.success) return invalid(req.error);
  const g = gate(ctx, req.data.vendor);
  if (isReply(g)) return g;
  const wait = waiting(ctx, g);
  if (wait) return wait;

  let kept: KeptToken | null = null;
  let result: Awaited<ReturnType<SignIn>>;
  try {
    result = await g.reader.signIn({ username: req.data.username, password: req.data.password }, g.fetcher, (t) => { kept = t; });
  } catch (error) {
    return failed(ctx, g, error, "sign-in");
  }
  const token = kept as KeptToken | null;
  if (!token) return reply(502, { error: "vendor_unavailable", message: `${g.reader.label} returned no usable access. Nothing was changed.` });

  try {
    const sealed = await sealConnection({ accessToken: token.accessToken, vendorExpiresInSeconds: token.expiresIn }, g.binding, g.secret, g.now());
    return reply(
      200,
      { connected: true, vendor: g.binding.vendor, label: g.reader.label, expiresAt: new Date(sealed.expiresAt).toISOString(), ...shape(result), claims: result.claims ?? null },
      [connectionCookie(g.binding.vendor, sealed, ctx.request.url)],
    );
  } catch (error) {
    if (error instanceof ConnectionError) return reply(502, { error: "connection_not_kept", message: error.message });
    return reply(502, { error: "connection_not_kept", message: "The connection could not be kept. Nothing was stored." });
  }
}

/**
 * Lists the account's installations through an existing connection: ONE vendor read, on request. Without a valid connection
 * it answers `connected: false` and reads nothing, so the page can show the sign-in form.
 */
export async function vendorInventory(ctx: VendorContext, raw: unknown): Promise<VendorReply> {
  const req = VendorOnlyRequest.safeParse(raw);
  if (!req.success) return invalid(req.error);
  if (req.data.action !== "vendor-inventory") return reply(422, { error: "validation", message: "Not a valid request" });
  const g = gate(ctx, req.data.vendor);
  if (isReply(g)) return g;
  const open = await opened(ctx, g);
  if (!open.ok) {
    // A damaged, expired or foreign value is removed; an absent one needs nothing.
    return reply(200, { connected: false, vendor: g.binding.vendor, reason: open.reason }, open.reason === "missing" ? [] : [clearConnectionCookie(g.binding.vendor, ctx.request.url)]);
  }
  const wait = waiting(ctx, g);
  if (wait) return wait;
  try {
    const inventory = await g.reader.inventory(open.accessToken, g.fetcher);
    return reply(200, { connected: true, vendor: g.binding.vendor, label: g.reader.label, expiresAt: new Date(open.expiresAt).toISOString(), ...shape(inventory) });
  } catch (error) {
    const out = failed(ctx, g, error, "connected");
    // The vendor no longer accepts the token: a plain "not connected", not an error, so the page shows the sign-in form.
    return out.status === 409 ? reply(200, { connected: false, vendor: g.binding.vendor, reason: "vendor_session_ended" }, out.cookies) : out;
  }
}

/** Forgets the connection in the browser. Needs no vendor and makes no vendor call. */
export function vendorDisconnect(ctx: VendorContext, raw: unknown): VendorReply {
  const req = VendorOnlyRequest.safeParse(raw);
  if (!req.success) return invalid(req.error);
  return reply(200, { connected: false, vendor: req.data.vendor }, [clearConnectionCookie(req.data.vendor, ctx.request.url)]);
}

/** Configuration of the registered chargers, with the connection's own token held inside the closure (never in the plan's data). */
export type Commissioner = (input: { routingId: string | null; targets: CommissionTarget[] }) => Promise<{ run: CommissionRun; cookies: string[] }>;

export type OnboardingPlan =
  | { ok: true; mapped: MapResult; vendor: string; acceptVendorElectrical: boolean; installationRef: string; commission: Commissioner }
  | { ok: false; reply: VendorReply };

/**
 * Everything up to the save: the connection, the vendor read of the one selected installation, the allowlisted package built
 * here, its re-validation and the mapping to the existing save input. The caller adds the workspace CPO and saves through
 * the existing service. Nothing is written by this function.
 */
export async function planVendorOnboarding(ctx: VendorContext, raw: unknown): Promise<OnboardingPlan> {
  const req = OnboardRequest.safeParse(raw);
  if (!req.success) return { ok: false, reply: invalid(req.error) };
  const g = gate(ctx, req.data.vendor);
  if (isReply(g)) return { ok: false, reply: g };

  const open = await opened(ctx, g);
  if (!open.ok) {
    return {
      ok: false,
      reply: reply(409, { error: "connection_required", message: `Connect to ${g.reader.label} first.` }, open.reason === "missing" ? [] : [clearConnectionCookie(g.binding.vendor, ctx.request.url)]),
    };
  }
  const wait = waiting(ctx, g);
  if (wait) return { ok: false, reply: wait };

  let read: { installationId: string; package: unknown };
  try {
    read = await g.reader.readPackage(open.accessToken, req.data.installationRef, g.fetcher);
  } catch (error) {
    return { ok: false, reply: failed(ctx, g, error, "connected") };
  }

  // Built from the vendor's response by explicit field extraction, then validated again as untrusted input.
  const pkg = parseVendorPackage(read.package);
  if (!pkg.ok) {
    return { ok: false, reply: reply(422, { error: "validation", message: "This installation's data does not fit the import limits", problems: pkg.problems.map((p) => ({ ...p, path: `package.${p.path}` })) }) };
  }
  // References are compared without regard to case: Zaptec's ids are GUIDs, whose case a response may change.
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  if (pkg.package.vendor !== g.binding.vendor || !same(pkg.package.site.ref, req.data.installationRef) || !same(read.installationId, req.data.installationRef)) {
    return { ok: false, reply: reply(502, { error: "vendor_unavailable", message: `${g.reader.label} returned a different installation than the one selected. Nothing was changed.` }) };
  }

  const mapped = mapPackageToSave(pkg.package, {
    siteId: req.data.siteId,
    idempotencyKey: req.data.idempotencyKey,
    acceptVendorElectrical: req.data.acceptVendorElectrical,
    ocppIds: req.data.ocppIds,
  });
  const vendor = g.binding.vendor;
  const url = ctx.request.url;
  const commission: Commissioner = async ({ routingId, targets }) => {
    const run = await commissionChargers({
      vendor,
      accessToken: open.accessToken,
      installationRef: req.data.installationRef,
      routingId,
      enabled: configurableVendors(ctx.env).includes(vendor),
      targets,
      fetcher: g.fetcher,
    });
    // A refused token ends the connection; a 429 is remembered, exactly as for the reads.
    const cookies = run.ended ? [clearConnectionCookie(vendor, url)] : run.retryAfter !== null ? [waitCookie(vendor, run.retryAfter, url, g.now())] : [];
    return { run, cookies };
  };
  return { ok: true, mapped, vendor, acceptVendorElectrical: req.data.acceptVendorElectrical, installationRef: req.data.installationRef, commission };
}

export const VENDOR_ACTIONS = ["vendor-connect", "vendor-inventory", "vendor-disconnect", "vendor-onboard"] as const;
export const isVendorAction = (action: unknown): action is (typeof VENDOR_ACTIONS)[number] => typeof action === "string" && (VENDOR_ACTIONS as readonly string[]).includes(action);
