// GET /api/cpo/sync  (snapshot)   and   GET /api/cpo/sync?since=<cursor>  (changes)
//
// Plain Request -> Response, like the installation handlers, and NOT mounted by
// this increment: adding the route means extending the three exact allow-lists
// (policy, middleware, edge Worker) and is a reviewed release step.
//
// Guard order: method -> signed shell session -> (database configured) ->
// resolve effective access -> cursor/ETag -> data. A 304 is only ever produced
// AFTER access was resolved and the version probe ran; it never short-circuits
// authorization. Snapshot responses are `private, no-cache` with an ETag (the
// browser keeps them but must revalidate, and no shared cache may hold them);
// delta responses are `no-store`.

import { authenticate, DatabaseUnavailableError } from "@/lib/installations/api";
import type { Actor } from "@/lib/installations/actor";
import type { ShellEnv } from "@/lib/cpo-shell-session";
import { permissionPartition } from "@/lib/installations/actor";
import type { Gate } from "./gate";
import { ScopeChecker, readCheck } from "./check";
import { readChanges, readSnapshot, readStatus, type SyncDeps } from "./service";

export type SyncApiDeps = {
  env?: ShellEnv;
  /** Opens request-scoped access + repository + the process cache. Throws DatabaseUnavailableError when unconfigured. */
  withSync<T>(fn: (d: SyncDeps<Actor>) => Promise<T>): Promise<T>;
  /** Process-wide cooldown/probe state for ?check=1. Absent = checks are refused (501) rather than run unthrottled. */
  checker?: ScopeChecker;
  /** Shared admission (hub-backed, isolate fallback). Absent = the checker's own isolate-local cooldown only. */
  gate?: Gate;
};

const j = (body: unknown, status: number, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...extra } });

export async function handleSync(request: Request, deps: SyncApiDeps): Promise<Response> {
  if (request.method !== "GET") return j({ error: "method_not_allowed" }, 405, { allow: "GET", "cache-control": "no-store" });
  const actor = await authenticate(request, deps.env);
  if (!actor) return j({ error: "unauthorized" }, 401, { "cache-control": "no-store" });

  const params = new URL(request.url).searchParams;
  const since = params.get("since");
  try {
    if (params.has("check")) {
      const checker = deps.checker;
      if (!checker) return j({ error: "not_implemented" }, 501, { "cache-control": "no-store" });
      return await deps.withSync(async (d) => {
        const r = await readCheck(d, actor, checker, permissionPartition(actor), deps.gate);
        if (r.kind === "forbidden") return j({ error: "forbidden" }, 403, { "cache-control": "no-store" });
        if (r.kind === "too_many") return j({ error: "scope_too_large" }, 413, { "cache-control": "no-store" });
        return j(r.body, 200, { "cache-control": "no-store" });
      });
    }
    if (params.get("view") === "status") {
      return await deps.withSync(async (d) => {
        const r = await readStatus(d, actor, request.headers.get("if-none-match"));
        if (r.kind === "forbidden") return j({ error: "forbidden" }, 403, { "cache-control": "no-store" });
        if (r.kind === "too_many") return j({ error: "scope_too_large" }, 413, { "cache-control": "no-store" });
        const headers = { etag: r.etag, "cache-control": "private, no-cache", vary: "cookie", "x-straumvakt-realtime": deps.env?.CPO_SHELL_REALTIME_ENABLED === "true" ? "1" : "0" };
        if (r.kind === "not_modified") return new Response(null, { status: 304, headers });
        return j(r.body, 200, headers);
      });
    }
    return await deps.withSync(async (d) => {
      if (since !== null) {
        const r = await readChanges(d, actor, since);
        if (r.kind === "forbidden") return j({ error: "forbidden" }, 403, { "cache-control": "no-store" });
        return j(r.body, 200, { "cache-control": "no-store" });
      }
      const r = await readSnapshot(d, actor, request.headers.get("if-none-match"));
      if (r.kind === "forbidden") return j({ error: "forbidden" }, 403, { "cache-control": "no-store" });
      if (r.kind === "too_many") return j({ error: "scope_too_large" }, 413, { "cache-control": "no-store" });
      const headers = { etag: r.etag, "cache-control": "private, no-cache", vary: "cookie", "x-straumvakt-realtime": deps.env?.CPO_SHELL_REALTIME_ENABLED === "true" ? "1" : "0" };
      if (r.kind === "not_modified") return new Response(null, { status: 304, headers });
      return j(r.body, 200, headers);
    });
  } catch (e) {
    if (e instanceof DatabaseUnavailableError) return j({ error: "database_unavailable" }, 503, { "cache-control": "no-store" });
    return j({ error: "internal" }, 500, { "cache-control": "no-store" });
  }
}
