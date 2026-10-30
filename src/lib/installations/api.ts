// HTTP handlers for installation management: plain Request → Response so they
// can be tested directly; the route files under src/app/api/cpo/ are one-line
// wrappers.
//
// Every request is checked in this order, and nothing reaches storage before
// all of it passes: method → signed shell session (the actor is derived here,
// never read from the body) → same-origin for state-changing methods → JSON
// content type and size cap → input validation. All responses are no-store.

import { isSameOriginRequest } from "@/lib/cpo-shell-handlers";
import { readShellCookie } from "@/lib/cpo-shell-policy";
import { readShellConfig, verifyShellSession, type ShellEnv } from "@/lib/cpo-shell-session";
import { sharedLoginActor, type Actor } from "./actor";
import {
  SaveInstallationInput,
  connectionAddress,
  effectiveAllowanceAmps,
  responsibleStatus,
  type Snapshot,
} from "./model";
import { SaveError, type SaveErrorCode } from "./store";
import type { Directory, HistoryEntry, InstallationListRow } from "./drizzle-store";
import type { SaveResult } from "./service";

export const MAX_JSON_BYTES = 256 * 1024;
const MAX_LIST = 50;

/** What the handlers need from storage; implemented over Drizzle in ./repo.ts and by fakes in tests. */
export interface Repo {
  save(input: SaveInstallationInput, actor: Actor): Promise<SaveResult>;
  get(id: string): Promise<{ snapshot: Snapshot; routingId: string | null; history: HistoryEntry[] } | null>;
  list(limit: number, offset: number): Promise<InstallationListRow[]>;
  directory(): Promise<Directory>;
  createOrganisation(displayName: string): Promise<{ id: string }>;
  createSite(input: { orgId: string; displayName: string; address: string | null }): Promise<{ id: string } | null>;
}

export type ApiDeps = {
  env?: ShellEnv;
  /** Opens a request-scoped repository; throws DatabaseUnavailableError when the database is not configured. */
  withRepo<T>(fn: (repo: Repo) => Promise<T>): Promise<T>;
};

export class DatabaseUnavailableError extends Error {
  constructor() {
    super("database not configured");
    this.name = "DatabaseUnavailableError";
  }
}

function json(body: unknown, status = 200, extra?: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...extra },
  });
}

const STATUS: Record<SaveErrorCode, number> = {
  validation: 422,
  stale_revision: 409,
  not_found: 404,
  forbidden: 403,
  identity_in_use: 409,
  serial_in_use: 409,
  unavailable: 503,
};

function saveErrorResponse(error: SaveError) {
  const body: Record<string, unknown> = { error: error.code, message: error.message };
  if (error.code === "validation") body.problems = error.detail ?? [];
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
      status: "not_active" as const,
      address: connectionAddress(routingId, installation.key),
      note: "Not yet active. Chargers cannot connect to this address until the Straumvakt gateway is integrated.",
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
    const parsed = SaveInstallationInput.safeParse(body);
    if (!parsed.success) {
      return json(
        { error: "validation", message: "Some fields need attention", problems: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) },
        422,
      );
    }
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

const DirectoryAction = {
  organisation: (b: Record<string, unknown>) => (typeof b.displayName === "string" ? b.displayName.trim() : ""),
};

export async function handleDirectory(request: Request, deps: ApiDeps): Promise<Response> {
  const g = await guard(request, deps, ["GET", "POST"]);
  if ("response" in g) return g.response;

  try {
    if (request.method === "GET") {
      return json(await deps.withRepo((repo) => repo.directory()));
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
