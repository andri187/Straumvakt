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
import { readChanges, readSnapshot, type SyncDeps } from "./service";

export type SyncApiDeps = {
  env?: ShellEnv;
  /** Opens request-scoped access + repository + the process cache. Throws DatabaseUnavailableError when unconfigured. */
  withSync<T>(fn: (d: SyncDeps<Actor>) => Promise<T>): Promise<T>;
};

const j = (body: unknown, status: number, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...extra } });

export async function handleSync(request: Request, deps: SyncApiDeps): Promise<Response> {
  if (request.method !== "GET") return j({ error: "method_not_allowed" }, 405, { allow: "GET", "cache-control": "no-store" });
  const actor = await authenticate(request, deps.env);
  if (!actor) return j({ error: "unauthorized" }, 401, { "cache-control": "no-store" });

  const since = new URL(request.url).searchParams.get("since");
  try {
    return await deps.withSync(async (d) => {
      if (since !== null) {
        const r = await readChanges(d, actor, since);
        if (r.kind === "forbidden") return j({ error: "forbidden" }, 403, { "cache-control": "no-store" });
        return j(r.body, 200, { "cache-control": "no-store" });
      }
      const r = await readSnapshot(d, actor, request.headers.get("if-none-match"));
      if (r.kind === "forbidden") return j({ error: "forbidden" }, 403, { "cache-control": "no-store" });
      if (r.kind === "too_many") return j({ error: "scope_too_large" }, 413, { "cache-control": "no-store" });
      const headers = { etag: r.etag, "cache-control": "private, no-cache", vary: "cookie" };
      if (r.kind === "not_modified") return new Response(null, { status: 304, headers });
      return j(r.body, 200, headers);
    });
  } catch (e) {
    if (e instanceof DatabaseUnavailableError) return j({ error: "database_unavailable" }, 503, { "cache-control": "no-store" });
    return j({ error: "internal" }, 500, { "cache-control": "no-store" });
  }
}
