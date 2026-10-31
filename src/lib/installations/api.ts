// HTTP handlers for installation management: plain Request → Response so they
// can be tested directly; the route files under src/app/api/cpo/ are one-line
// wrappers.
//
// Every request is checked in this order, and nothing reaches storage before
// all of it passes: method → signed shell session (the actor is derived here,
// never read from the body) → same-origin for state-changing methods → JSON
// content type and size cap → input validation. All responses are no-store.

import { CHARGE_POINT_ID } from "./address";
import { isSameOriginRequest } from "@/lib/cpo-shell-handlers";
import { readShellCookie } from "@/lib/cpo-shell-policy";
import { readShellConfig, verifyShellSession, type ShellEnv } from "@/lib/cpo-shell-session";
import { sharedLoginActor, type Actor } from "./actor";
import {
  SaveInstallationInput,
  cpoAddress,
  effectiveAllowanceAmps,
  responsibleStatus,
  type Snapshot,
} from "./model";
import { SaveError, type Draft, type SaveErrorCode } from "./store";
import type { DiscardOutcome, SaveDraftInput } from "./drafts";
import type { IncomingCharger } from "./discovery";
import type { BootCaptureRow } from "./store";
import { INCOMING_WINDOW_MS } from "./incoming-window";
import type { Directory, HistoryEntry, InstallationListRow } from "./drizzle-store";
import type { SaveResult } from "./service";
import type { Fetcher } from "./vendor-read.mjs";
import { vendorLabel, type MapResult, type ResolvedCharger } from "./vendor-import";
import {
  isVendorAction,
  planVendorOnboarding,
  vendorConnect,
  vendorDisconnect,
  vendorInventory,
  type VendorContext,
  type VendorReply,
} from "./vendor-onboarding";

export const MAX_JSON_BYTES = 256 * 1024;
const CONNECTION_NOTE = "An address alone does not confirm a live charger connection.";
const MAX_LIST = 50;

/** What the handlers need from storage; implemented over Drizzle in ./repo.ts and by fakes in tests. */
export interface Repo {
  save(input: SaveInstallationInput, actor: Actor): Promise<SaveResult>;
  get(id: string): Promise<{ snapshot: Snapshot; routingId: string | null; history: HistoryEntry[] } | null>;
  list(limit: number, offset: number): Promise<InstallationListRow[]>;
  directory(): Promise<Directory>;
  /** Chargers knocking at the given CPO (the workspace CPO, never taken from the request). */
  listIncoming(orgId: string, actor: Actor): Promise<IncomingCharger[]>;
  /** The complete captured BootNotification of one charger of the workspace CPO. Read-only. */
  getBootCapture(orgId: string, actor: Actor, chargePointId: string): Promise<BootCaptureRow | null>;
  /** The one CPO the workspace is associated with, its sites, and its routing id (allocated here if it has none yet). Null when it does not exist. */
  contextDirectory(orgId: string): Promise<Directory | null>;
  createOrganisation(displayName: string): Promise<{ id: string }>;
  createSite(input: { orgId: string; displayName: string; address: string | null }): Promise<{ id: string } | null>;
  saveDraft(input: SaveDraftInput, actor: Actor): Promise<{ draft: Draft; created: boolean; unchanged: boolean }>;
  discardDraft(input: { draftId: string }, actor: Actor): Promise<DiscardOutcome>;
  getDraft(draftId: string, actor: Actor): Promise<Draft | null>;
  listDrafts(actor: Actor): Promise<Draft[]>;
}

export type ApiDeps = {
  env?: ShellEnv;
  /** The CPO this deployment's shared login is associated with (CPO_SHELL_ORG_ID); null/absent when not associated. */
  contextOrgId?: string | null;
  /** Test hooks for the direct OEM actions. In production both are absent: the global fetch and the real clock are used. */
  vendor?: { fetcher?: Fetcher; now?: () => number };
  /** Opens a request-scoped repository; throws DatabaseUnavailableError when the database is not configured. */
  withRepo<T>(fn: (repo: Repo) => Promise<T>): Promise<T>;
};

export class DatabaseUnavailableError extends Error {
  constructor() {
    super("database not configured");
    this.name = "DatabaseUnavailableError";
  }
}

function json(body: unknown, status = 200, extra?: Record<string, string>, cookies: readonly string[] = []) {
  const headers = new Headers({ "content-type": "application/json", "cache-control": "no-store", ...extra });
  for (const cookie of cookies) headers.append("set-cookie", cookie);
  return new Response(JSON.stringify(body), { status, headers });
}

const vendorResponse = (r: VendorReply) => json(r.body, r.status, r.headers, r.cookies);

const STATUS: Record<SaveErrorCode, number> = {
  validation: 422,
  stale_revision: 409,
  not_found: 404,
  forbidden: 403,
  identity_in_use: 409,
  serial_in_use: 409,
  draft_unavailable: 409,
  unavailable: 503,
};

function saveErrorResponse(error: SaveError) {
  const body: Record<string, unknown> = { error: error.code, message: error.message };
  if (error.code === "validation") body.problems = error.detail ?? [];
  if (error.code === "draft_unavailable") {
    // Why, so the editor can tell a used draft (open the installation it made) from a discarded one (nothing was made).
    const d = error.detail as { state?: string; installationId?: string | null } | undefined;
    if (d?.state) body.draftState = d.state;
    if (d?.state === "consumed" && d.installationId) body.installationId = d.installationId;
  }
  if (error.code === "stale_revision") body.currentRevision = (error.detail as { currentRevision?: number } | undefined)?.currentRevision ?? null;
  return json(body, STATUS[error.code]);
}

export async function authenticate(request: Request, env?: ShellEnv): Promise<Actor | null> {
  const config = readShellConfig(env);
  if (!config) return null;
  const session = await verifyShellSession(readShellCookie(request.headers.get("cookie")), config);
  return session ? sharedLoginActor(session.username) : null;
}

type Guard = { actor: Actor } | { response: Response };

async function guard(request: Request, deps: ApiDeps, methods: readonly string[]): Promise<Guard> {
  if (!methods.includes(request.method)) {
    return { response: json({ error: "method_not_allowed" }, 405, { allow: methods.join(", ") }) };
  }
  const actor = await authenticate(request, deps.env);
  if (!actor) return { response: json({ error: "unauthorized" }, 401) };
  if (request.method !== "GET" && request.method !== "HEAD") {
    if (!isSameOriginRequest(request)) return { response: json({ error: "forbidden_origin" }, 403) };
    if (!(request.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) {
      return { response: json({ error: "unsupported_media_type" }, 415) };
    }
  }
  return { actor };
}

async function readJson(request: Request): Promise<unknown | undefined> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_JSON_BYTES) return undefined;
  const text = await request.text();
  if (text.length > MAX_JSON_BYTES) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

const wrongContext = () => json({ error: "wrong_context", message: "This workspace belongs to a different CPO." }, 403);

const unavailable = () => json({ error: "database_unavailable", message: "The database is not configured for this deployment." }, 503);

// ── Views ──────────────────────────────────────────────────────────────────

export function toView(snapshot: Snapshot, routingId: string | null, history?: HistoryEntry[]) {
  const { installation, circuits, chargers } = snapshot;
  const byId = new Map(circuits.map((c) => [c.id, c]));
  const allowance = (circuitId: string) => {
    const chain: (number | null)[] = [];
    for (let cur: string | null = circuitId, guardLoop = 0; cur && guardLoop < 20; guardLoop++) {
      const node = byId.get(cur);
      if (!node) break;
      chain.push(node.ratingAmps);
      cur = node.parentId;
    }
    chain.push(installation.mainRatingAmps);
    return effectiveAllowanceAmps(chain);
  };
  return {
    installation: {
      id: installation.id,
      key: installation.key,
      orgId: installation.orgId,
      siteId: installation.siteId,
      displayName: installation.displayName,
      revision: installation.revision,
      mainDeviceType: installation.mainDeviceType,
      mainRatingAmps: installation.mainRatingAmps,
      mainPhaseCount: installation.mainPhaseCount,
      mainGridType: installation.mainGridType,
      electrician: installation.electrician,
      responsible: {
        status: responsibleStatus(installation),
        confirmedRevision: installation.responsibleConfirmedRevision,
        detailsChangedAtRevision: installation.electricianChangedRevision,
      },
      // Mode and time only. The verifier is never sent.
      password: { mode: installation.passwordMode, setAt: installation.passwordSetAt },
      mainAllowance: effectiveAllowanceAmps([installation.mainRatingAmps]),
    },
    circuits: circuits.map((c) => ({ ...c, allowance: allowance(c.id) })),
    chargers,
    connection: {
      status: "unverified" as const,
      /** The CPO's endpoint, `wss://{cpo-id}.straumvakt.org/`; each charger's own id follows it. Null until the CPO has a routing id. */
      cpoAddress: cpoAddress(routingId),
      routingId,
      note: CONNECTION_NOTE,
    },
    enforcement: { status: "unavailable" as const, note: "Limits shown here are not confirmed on any charger." },
    ...(history ? { history } : {}),
  };
}

// ── Handlers ───────────────────────────────────────────────────────────────

export async function handleInstallations(request: Request, deps: ApiDeps): Promise<Response> {
  const g = await guard(request, deps, ["GET", "POST"]);
  if ("response" in g) return g.response;
  const url = new URL(request.url);

  try {
    if (request.method === "GET") {
      if (url.searchParams.has("draft") || url.searchParams.has("drafts")) return await draftsGet(url, deps, g.actor);
      if (url.searchParams.has("incoming")) {
        // The CPO is the workspace's. Any organisation named in the request is ignored, and without a workspace CPO there is no list.
        const ctx = deps.contextOrgId;
        if (!ctx) return json({ error: "no_context", message: "No CPO is set for this workspace." }, 409);
        // The same endpoint serves one charger's complete BootNotification: `incoming=1&boot=<charge point id>`. One row, on demand,
        // never part of the list. It contacts no charger.
        const bootId = url.searchParams.get("boot");
        if (bootId !== null) {
          if (!CHARGE_POINT_ID.test(bootId)) return json({ error: "validation", message: "Not a valid charge point id" }, 422);
          const capture = await deps.withRepo((repo) => repo.getBootCapture(ctx, g.actor, bootId));
          return json({ chargePointId: bootId, capture });
        }
        // asOf/windowMs let the page expire rows locally without another read; they are not a new service.
        const incoming = await deps.withRepo((repo) => repo.listIncoming(ctx, g.actor));
        return json({ incoming, asOf: new Date().toISOString(), windowMs: INCOMING_WINDOW_MS });
      }
      const id = url.searchParams.get("id");
      if (id) {
        if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: "not_found" }, 404);
        const found = await deps.withRepo((repo) => repo.get(id));
        if (!found) return json({ error: "not_found" }, 404);
        return json(toView(found.snapshot, found.routingId, found.history));
      }
      const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? MAX_LIST) || MAX_LIST, 1), MAX_LIST);
      const offset = Math.max(Number(url.searchParams.get("offset") ?? 0) || 0, 0);
      const rows = await deps.withRepo((repo) => repo.list(limit, offset));
      return json({ installations: rows, limit, offset });
    }

    const body = await readJson(request);
    if (body === undefined) return json({ error: "invalid_body" }, 400);
    // Direct OEM onboarding. The same guards ran above (signed session, same origin, JSON); the vendor connection is its own
    // sealed cookie, bound to this shell session. Nothing a browser sends is taken as a vendor package.
    if (body !== null && typeof body === "object" && isVendorAction((body as Record<string, unknown>).action)) {
      return await vendorAction(body as Record<string, unknown>, request, deps, g.actor);
    }
    // Draft actions carry an `action`; a save never does.
    if (body !== null && typeof body === "object" && "action" in body) return await draftsPost(body as Record<string, unknown>, deps, g.actor);
    const parsed = SaveInstallationInput.safeParse(body);
    if (!parsed.success) {
      return json(
        { error: "validation", message: "Some fields need attention", problems: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) },
        422,
      );
    }
    if (parsed.data.installationId === undefined && deps.contextOrgId && parsed.data.orgId !== deps.contextOrgId) return wrongContext();
    const { result, routing } = await deps.withRepo(async (repo) => {
      const saved = await repo.save(parsed.data, g.actor);
      return { result: saved, routing: await repo.get(saved.snapshot.installation.id) };
    });
    return json({
      ...toView(result.snapshot, routing?.routingId ?? null, routing?.history),
      replayed: result.replayed,
      unchanged: result.unchanged,
      // Returned exactly once, in this response only.
      ...(result.generatedPassword ? { generatedPassword: result.generatedPassword } : {}),
    });
  } catch (error) {
    if (error instanceof DatabaseUnavailableError) return unavailable();
    if (error instanceof SaveError) return saveErrorResponse(error);
    console.error(JSON.stringify({ ev: "installations_api_error", name: error instanceof Error ? error.name : "unknown" }));
    return json({ error: "internal" }, 500);
  }
}

// ── Direct OEM onboarding ──────────────────────────────────────────────────
// connect → list → onboard the selected installations, all on this endpoint. The vendor logic is in ./vendor-onboarding.ts;
// the only write is the one existing save below.

async function vendorAction(body: Record<string, unknown>, request: Request, deps: ApiDeps, actor: Actor): Promise<Response> {
  const ctx: VendorContext = {
    request,
    env: deps.env,
    // The CPO is the workspace's. Nothing in the request can name another.
    orgId: deps.contextOrgId ?? null,
    shellSessionToken: readShellCookie(request.headers.get("cookie")) ?? "",
    fetcher: deps.vendor?.fetcher,
    now: deps.vendor?.now,
  };
  switch (body.action) {
    case "vendor-connect":
      return vendorResponse(await vendorConnect(ctx, body));
    case "vendor-inventory":
      return vendorResponse(await vendorInventory(ctx, body));
    case "vendor-disconnect":
      return vendorResponse(vendorDisconnect(ctx, body));
    default:
      return await onboardVendorInstallation(body, ctx, deps, actor);
  }
}

/**
 * One selected vendor installation, read from the vendor here and saved through the same save service as the editor. The
 * signed session is the actor. Each request is its own atomic outcome: an earlier success is never undone by a later
 * failure, and a repeat of an installation this CPO already imported answers with the existing one
 * (`outcome: "already_imported"`) and writes nothing.
 */
async function onboardVendorInstallation(body: Record<string, unknown>, ctx: VendorContext, deps: ApiDeps, actor: Actor): Promise<Response> {
  const plan = await planVendorOnboarding(ctx, body);
  if (!plan.ok) return vendorResponse(plan.reply);
  const { mapped } = plan;

  const parsed = SaveInstallationInput.safeParse({ ...mapped.input, orgId: ctx.orgId });
  if (!parsed.success) {
    return json({ error: "validation", message: "Some fields need attention", problems: parsed.error.issues.slice(0, 20).map((i) => ({ path: i.path.join("."), message: i.message })) }, 422);
  }
  // 1. Register: the one existing save. A creation is atomic (structure and every resolved charger, or nothing).
  const result = await deps.withRepo((repo) => repo.save(parsed.data, actor));
  let snapshot = result.snapshot;
  const created = new Set((result.attachedChargePointIds ?? []).map((id) => id.toLowerCase()));
  const failures = new Map<string, string>();

  // 2. A retry of an installation that already exists: attach what is still missing, through the same save (an update).
  // Chargers that are already registered are never duplicated and never touched.
  if ((result.alreadyImported || result.replayed) && mapped.resolved.length > 0) {
    const more = await attachMissing(deps, actor, plan.vendor, snapshot, mapped.resolved);
    snapshot = more.snapshot;
    for (const id of more.attached) created.add(id.toLowerCase());
    for (const [id, message] of more.failures) failures.set(id, message);
  }

  // 3. Reconcile every vendor equipment item with what is registered now.
  const items = reconcileEquipment(snapshot, mapped, created, failures);

  // 4. Configure the chargers that are registered (only those; only when switched on; read first, verify after).
  const routingId = await deps.withRepo(async (repo) => (await repo.get(snapshot.installation.id))?.routingId ?? null);
  const targets = items.filter((i) => i.chargePointId !== null && (i.registration === "registered" || i.registration === "already_registered")).map((i) => ({ ref: i.ref, name: i.name, serialNumber: i.serialNumber, chargePointId: i.chargePointId! }));
  const { run, cookies } = targets.length > 0 ? await plan.commission({ routingId, targets }) : { run: { results: [], ended: false, retryAfter: null }, cookies: [] as string[] };
  const byRef = new Map(run.results.map((r) => [r.ref, r]));
  for (const item of items) {
    const c = byRef.get(item.ref);
    if (c) item.configuration = { state: c.state, code: c.code, message: c.message };
    if (c) item.address = c.address;
  }

  const installation = snapshot.installation;
  const configured = (s: string | undefined) => s === "configured" || s === "already_configured";
  const notes: string[] = [];
  if (installation.passwordMode === "unset" && items.some((i) => configured(i.configuration?.state))) {
    notes.push("This installation has no OCPP password setting yet, so a configured charger is refused when it connects (shown under Incoming) until you set one on the installation.");
  }
  return json(
    {
      outcome: result.alreadyImported ? "already_imported" : result.replayed ? "replayed" : "created",
      vendor: plan.vendor,
      installationId: installation.id,
      displayName: installation.displayName,
      revision: installation.revision,
      circuits: snapshot.circuits.length,
      chargers: snapshot.chargers.length,
      // Per vendor charger: registered in Straumvakt, configured at the vendor (or why not), and never "connected": a vendor
      // accepting a setting is not a BootNotification.
      equipment: items,
      // Equipment kept as evidence but not turned into a charger; each still needs its own OCPP identity.
      pendingEquipment: items.filter((i) => i.registration === "needs_identity" || i.registration === "invalid_identity").map((i) => ({ ref: i.ref, name: i.name, circuitRef: i.circuitRef, serialNumber: i.serialNumber, reason: i.registration === "needs_identity" ? "needs_ocpp_identity" : "invalid_ocpp_identity" })),
      // True only when every vendor charger is registered AND its configuration is verified. Still not a claim that it is online.
      complete: items.length > 0 && items.every((i) => (i.registration === "registered" || i.registration === "already_registered") && configured(i.configuration?.state)),
      registrationComplete: items.every((i) => i.registration === "registered" || i.registration === "already_registered"),
      warnings: result.alreadyImported ? [] : mapped.warnings,
      notes,
      configurationRetryAfter: run.retryAfter,
      electricalValuesAccepted: plan.acceptVendorElectrical,
    },
    200,
    undefined,
    cookies,
  );
}

type EquipmentItem = {
  ref: string;
  name: string | null;
  circuitRef: string | null;
  serialNumber: string | null;
  chargePointId: string | null;
  address: string | null;
  registration: "registered" | "already_registered" | "needs_identity" | "invalid_identity" | "failed";
  registrationMessage: string | null;
  configuration: { state: string; code: string; message: string } | null;
  /** Always "not_observed": this path never learns whether the charger connected. */
  connection: "not_observed";
};

/**
 * Every vendor charger of the package, with its registration. An item whose identity was not supplied this time but whose
 * explicit serial matches a charger already registered in this installation is recognised as that charger (so a later visit
 * does not report registered equipment as pending).
 */
function reconcileEquipment(snapshot: Snapshot, mapped: MapResult, created: Set<string>, failures: Map<string, string>): EquipmentItem[] {
  const resolved = new Map(mapped.resolved.map((r) => [r.ref, r]));
  const pending = new Map(mapped.pendingEquipment.map((p) => [p.ref, p]));
  const byId = new Map(snapshot.chargers.map((c) => [c.chargePointId.toLowerCase(), c]));
  const bySerial = new Map(snapshot.chargers.filter((c) => c.serialNumber).map((c) => [c.serialNumber!.toLowerCase(), c]));
  const entries = [
    ...mapped.resolved.map((r) => ({ ref: r.ref, name: r.name, circuitRef: r.circuitRef, serialNumber: r.serialNumber })),
    ...mapped.pendingEquipment.map((p) => ({ ref: p.ref, name: p.name, circuitRef: p.circuitRef, serialNumber: p.serialNumber ?? null })),
  ];
  return entries.map((e): EquipmentItem => {
    const base = { ref: e.ref, name: e.name, circuitRef: e.circuitRef, serialNumber: e.serialNumber, address: null, configuration: null, connection: "not_observed" as const };
    const r = resolved.get(e.ref);
    if (r) {
      const have = byId.get(r.chargePointId.toLowerCase());
      if (have && have.serialNumber && r.serialNumber && have.serialNumber.toLowerCase() !== r.serialNumber.toLowerCase()) {
        return { ...base, chargePointId: r.chargePointId, registration: "failed", registrationMessage: `The OCPP id ${r.chargePointId} is already registered here for different equipment. Nothing was changed.` };
      }
      if (have) return { ...base, chargePointId: have.chargePointId, registration: created.has(r.chargePointId.toLowerCase()) ? "registered" : "already_registered", registrationMessage: null };
      return { ...base, chargePointId: r.chargePointId, registration: "failed", registrationMessage: failures.get(r.chargePointId.toLowerCase()) ?? "Not registered. Retry to register it." };
    }
    const known = e.serialNumber ? bySerial.get(e.serialNumber.toLowerCase()) : undefined;
    if (known) return { ...base, chargePointId: known.chargePointId, registration: "already_registered", registrationMessage: null };
    const p = pending.get(e.ref);
    return { ...base, chargePointId: null, registration: p?.reason === "needs_ocpp_identity" || !p ? "needs_identity" : "invalid_identity", registrationMessage: p?.reason === "no_circuit" ? "No circuit for this charger in the vendor data." : null };
  });
}

/**
 * Attach resolved chargers that an earlier import of this installation did not register. Whole-state update through the one
 * save service (existing circuits and chargers are carried through unchanged, so nothing else changes). Tried as one save; if
 * that is refused, one charger at a time so a single conflict does not hold back the others.
 */
async function attachMissing(deps: ApiDeps, actor: Actor, vendor: string, start: Snapshot, resolved: ResolvedCharger[]) {
  const attached: string[] = [];
  const failures = new Map<string, string>();
  let snapshot = start;
  const circuitFor = (snap: Snapshot, ref: string | null) => (ref === null ? undefined : Object.entries(snap.vendorCircuitRefs ?? {}).find(([, v]) => v === ref)?.[0]);
  const stateOf = (snap: Snapshot, extra: ResolvedCharger[]) => ({
    installationId: snap.installation.id,
    orgId: snap.installation.orgId,
    expectedRevision: snap.installation.revision,
    idempotencyKey: crypto.randomUUID(),
    installation: {
      displayName: snap.installation.displayName,
      mainDeviceType: snap.installation.mainDeviceType,
      mainRatingAmps: snap.installation.mainRatingAmps,
      mainPhaseCount: snap.installation.mainPhaseCount,
      mainGridType: snap.installation.mainGridType,
    },
    electrician: { ...snap.installation.electrician },
    circuits: snap.circuits.map((c) => ({ id: c.id, parentId: c.parentId, displayName: c.displayName, ratingAmps: c.ratingAmps, phaseCount: c.phaseCount })),
    chargers: [
      ...snap.chargers.map((c) => ({ id: c.id, circuitId: c.circuitId, label: c.label, chargePointId: c.chargePointId, vendor: c.vendor, model: c.model, serialNumber: c.serialNumber })),
      ...extra.map((r, i) => ({ id: `new-ve-${i}`, circuitId: circuitFor(snap, r.circuitRef)!, label: r.name ?? r.ref, chargePointId: r.chargePointId, vendor: vendorLabel(vendor), model: null, serialNumber: r.serialNumber })),
    ],
  });
  const todo = (snap: Snapshot) => resolved.filter((r) => !snap.chargers.some((c) => c.chargePointId.toLowerCase() === r.chargePointId.toLowerCase()));

  const pending = todo(snapshot);
  const placeable: ResolvedCharger[] = [];
  for (const r of pending) {
    if (circuitFor(snapshot, r.circuitRef)) placeable.push(r);
    else failures.set(r.chargePointId.toLowerCase(), "Its circuit is not part of the earlier import, so it cannot be placed automatically. Add it in the installation.");
  }
  if (placeable.length === 0) return { snapshot, attached, failures };

  const save = async (extra: ResolvedCharger[]) => {
    const input = SaveInstallationInput.safeParse(stateOf(snapshot, extra));
    if (!input.success) throw new SaveError("validation", "Some fields need attention");
    return deps.withRepo((repo) => repo.save(input.data, actor));
  };
  try {
    const r = await save(placeable);
    snapshot = r.snapshot;
    attached.push(...placeable.map((p) => p.chargePointId));
    return { snapshot, attached, failures };
  } catch (error) {
    if (!(error instanceof SaveError)) throw error;
  }
  for (const one of placeable) {
    try {
      const r = await save([one]);
      snapshot = r.snapshot;
      attached.push(one.chargePointId);
    } catch (error) {
      if (!(error instanceof SaveError)) throw error;
      failures.set(
        one.chargePointId.toLowerCase(),
        error.code === "identity_in_use" || error.code === "serial_in_use"
          ? "This OCPP id or serial number is already registered to other equipment. Nothing was changed."
          : error.code === "stale_revision"
            ? "The installation was changed by someone else meanwhile. Retry."
            : error.message,
      );
    }
  }
  return { snapshot, attached, failures };
}

// ── Drafts (unfinished forms) ──────────────────────────────────────────────

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The list row: enough to recognise a draft and resume it. */
export function draftSummary(d: Draft) {
  const name = typeof d.payload.name === "string" ? d.payload.name.trim() : "";
  return { id: d.id, orgId: d.orgId, orgName: d.orgName, name: name || null, state: d.state, revision: d.revision, createdAt: d.createdAt, updatedAt: d.updatedAt };
}

/** The full draft, with the form document. It never contains a password (the stored shape has no such field). */
export function draftView(d: Draft) {
  return { ...draftSummary(d), payload: d.payload, installationId: d.installationId };
}

/**
 * Unfinished-form drafts, served on the installations endpoint (the shell's route
 * allow-list names exact paths, so no new path is added). A draft is a saved copy
 * of the form: it creates no installation and no charger and admits nothing.
 */
async function draftsGet(url: URL, deps: ApiDeps, actor: Actor): Promise<Response> {
  const id = url.searchParams.get("draft");
  if (id) {
    if (!UUID.test(id)) return json({ error: "not_found" }, 404);
    const draft = await deps.withRepo((repo) => repo.getDraft(id, actor));
    return draft ? json({ draft: draftView(draft) }) : json({ error: "not_found" }, 404);
  }
  const drafts = await deps.withRepo((repo) => repo.listDrafts(actor));
  return json({ drafts: drafts.map(draftSummary) });
}

async function draftsPost(body: Record<string, unknown>, deps: ApiDeps, actor: Actor): Promise<Response> {
  const draftId = typeof body.draftId === "string" ? body.draftId : "";
  if (!UUID.test(draftId)) return json({ error: "validation", message: "Some fields need attention", problems: [{ path: "draftId", message: "Required" }] }, 422);

  if (body.action === "save-draft") {
    const orgId = body.orgId === null || body.orgId === undefined || body.orgId === "" ? null : typeof body.orgId === "string" && UUID.test(body.orgId) ? body.orgId : undefined;
    if (orgId === undefined) return json({ error: "validation", message: "Some fields need attention", problems: [{ path: "orgId", message: "Not a valid organisation" }] }, 422);
    const rev = body.expectedRevision;
    if (rev !== undefined && (typeof rev !== "number" || !Number.isInteger(rev) || rev < 1)) {
      return json({ error: "validation", message: "Some fields need attention", problems: [{ path: "expectedRevision", message: "Not a valid revision" }] }, 422);
    }
    if (deps.contextOrgId && orgId !== null && orgId !== deps.contextOrgId) return wrongContext();
    const { draft, created, unchanged } = await deps.withRepo((repo) =>
      repo.saveDraft({ draftId, orgId, ...(rev !== undefined ? { expectedRevision: rev } : {}), payload: body.payload }, actor),
    );
    return json({ draft: draftView(draft), created, unchanged }, created ? 201 : 200);
  }
  if (body.action === "discard-draft") {
    return json(await deps.withRepo((repo) => repo.discardDraft({ draftId }, actor)));
  }
  return json({ error: "unknown_action" }, 400);
}

const DirectoryAction = {
  organisation: (b: Record<string, unknown>) => (typeof b.displayName === "string" ? b.displayName.trim() : ""),
};

export async function handleDirectory(request: Request, deps: ApiDeps): Promise<Response> {
  const g = await guard(request, deps, ["GET", "POST"]);
  if ("response" in g) return g.response;

  try {
    if (request.method === "GET") {
      const ctx = deps.contextOrgId;
      return json(ctx ? ((await deps.withRepo((repo) => repo.contextDirectory(ctx))) ?? { organisations: [], sites: [] }) : await deps.withRepo((repo) => repo.directory()));
    }
    const body = (await readJson(request)) as Record<string, unknown> | undefined;
    if (!body || typeof body !== "object") return json({ error: "invalid_body" }, 400);
    const name = DirectoryAction.organisation(body);
    if (name.length < 2 || name.length > 120) return json({ error: "validation", problems: [{ path: "displayName", message: "2–120 characters" }] }, 422);

    if (body.action === "create-organisation") {
      return json(await deps.withRepo((repo) => repo.createOrganisation(name)), 201);
    }
    if (body.action === "create-site") {
      const orgId = typeof body.orgId === "string" ? body.orgId : "";
      if (!/^[0-9a-f-]{36}$/i.test(orgId)) return json({ error: "validation", problems: [{ path: "orgId", message: "Choose an organisation" }] }, 422);
      if (deps.contextOrgId && orgId.toLowerCase() !== deps.contextOrgId) return wrongContext();
      const address = typeof body.address === "string" && body.address.trim() ? body.address.trim().slice(0, 200) : null;
      const created = await deps.withRepo((repo) => repo.createSite({ orgId, displayName: name, address }));
      return created === null ? json({ error: "not_found" }, 404) : json(created, 201);
    }
    return json({ error: "unknown_action" }, 400);
  } catch (error) {
    if (error instanceof DatabaseUnavailableError) return unavailable();
    console.error(JSON.stringify({ ev: "directory_api_error", name: error instanceof Error ? error.name : "unknown" }));
    return json({ error: "internal" }, 500);
  }
}
