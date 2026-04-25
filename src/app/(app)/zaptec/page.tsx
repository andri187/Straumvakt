import { cookies } from "next/headers";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Topbar } from "@/components/topbar";
import { PageShell } from "@/components/page-shell";
import { adminSessionConfig, verifyAdminSession } from "@/lib/admin-session";

export const metadata = { title: "Zaptec API" };

type OpenApiOp = {
  method: string;
  path: string;
  summary?: string;
  tags: string[];
};

type OpenApiSummary = {
  title: string;
  version: string;
  serverUrl?: string;
  pathCount: number;
  operations: OpenApiOp[];
  tags: string[];
};

function loadOpenApiSummary(): OpenApiSummary | null {
  const path = resolve(process.cwd(), "public", "zaptec", "openapi.json");
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    const info = (raw.info ?? {}) as { title?: string; version?: string };
    const servers = (raw.servers ?? []) as Array<{ url?: string }>;
    const paths = (raw.paths ?? {}) as Record<string, Record<string, unknown>>;
    const ops: OpenApiOp[] = [];
    const tagSet = new Set<string>();
    for (const [pathKey, methods] of Object.entries(paths)) {
      for (const [method, def] of Object.entries(methods)) {
        const m = method.toUpperCase();
        if (!["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].includes(m)) continue;
        const d = (def ?? {}) as { summary?: string; tags?: string[] };
        const tags = Array.isArray(d.tags) ? d.tags.filter((t): t is string => typeof t === "string") : [];
        for (const t of tags) tagSet.add(t);
        ops.push({ method: m, path: pathKey, summary: d.summary, tags });
      }
    }
    return {
      title: info.title ?? "Zaptec API",
      version: info.version ?? "?",
      serverUrl: servers[0]?.url,
      pathCount: Object.keys(paths).length,
      operations: ops,
      tags: Array.from(tagSet).sort(),
    };
  } catch {
    return null;
  }
}

function loadConstants(): { totalKeys: number; sample: Array<[string, unknown]> } | null {
  const path = resolve(process.cwd(), "public", "zaptec", "zaptec-constants.json");
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    const keys = Object.keys(raw);
    return { totalKeys: keys.length, sample: keys.slice(0, 8).map((k) => [k, raw[k]]) };
  } catch {
    return null;
  }
}

export default async function ZaptecPage() {
  const jar = await cookies();
  const token = jar.get(adminSessionConfig.SESSION_COOKIE_NAME)?.value;
  const session = await verifyAdminSession(token);
  const email = session?.email;

  const api = loadOpenApiSummary();
  const consts = loadConstants();
  const synced = api !== null || consts !== null;

  return (
    <>
      <Topbar title="Zaptec API" email={email} />
      <PageShell
        title="Zaptec API"
        description="Static reference of Zaptec's REST API surface. Live data lands when the Zaptec vendor adapter ships in Sprint 2."
      >
        {!synced ? (
          <div className="rounded-lg border border-bg-border bg-bg-surface/70 p-6 shadow-card backdrop-blur">
            <h2 className="text-sm font-semibold text-ink-50">Assets not synced yet</h2>
            <p className="mt-2 text-sm text-ink-300">
              Run{" "}
              <code className="rounded bg-bg-base/60 px-1.5 py-0.5 font-mono text-xs">
                npm run sync:detour-assets
              </code>{" "}
              to copy{" "}
              <code className="font-mono text-xs">openapi.json</code> and{" "}
              <code className="font-mono text-xs">zaptec-constants.json</code> from{" "}
              <code className="font-mono text-xs">E:\Claude\zaptec-test</code> into{" "}
              <code className="font-mono text-xs">public/zaptec/</code>.
            </p>
            <p className="mt-3 text-xs text-ink-400">
              .env is intentionally not synced — Rule 2.
            </p>
          </div>
        ) : (
          <div className="grid gap-4">
            {/* Live data placeholder — wired in Sprint 2 */}
            <section className="rounded-lg border border-amber-700/40 bg-amber-950/20 p-5 shadow-card backdrop-blur">
              <h2 className="text-xs font-semibold uppercase tracking-brand text-amber-300">
                Live data
              </h2>
              <p className="mt-2 text-sm text-ink-100">
                No active Zaptec adapter yet — Sprint 2 wires authenticated calls.
              </p>
              <p className="mt-1 text-xs text-ink-400">
                Until then, this page displays the OpenAPI surface and constants pulled
                from the local <code className="font-mono">zaptec-test</code> sandbox. Real
                installations and chargers will appear here once the adapter is connected
                in operator console Sprint 5+.
              </p>
            </section>

            {/* OpenAPI summary */}
            {api && (
              <section className="rounded-lg border border-bg-border bg-bg-surface/70 shadow-card backdrop-blur">
                <header className="border-b border-bg-border bg-bg-base/40 px-5 py-4">
                  <div className="flex items-baseline justify-between">
                    <h2 className="text-base font-semibold text-ink-50">
                      {api.title} <span className="ml-2 text-xs text-ink-400">v{api.version}</span>
                    </h2>
                    <span className="text-xs text-ink-300">
                      {api.operations.length} operations · {api.pathCount} paths · {api.tags.length} tags
                    </span>
                  </div>
                  {api.serverUrl && (
                    <p className="mt-1 text-xs text-ink-300">
                      Base:{" "}
                      <code className="rounded bg-bg-base/60 px-1.5 py-0.5 font-mono text-xs">
                        {api.serverUrl}
                      </code>
                    </p>
                  )}
                </header>
                <div className="max-h-[55vh] overflow-y-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="sticky top-0 bg-bg-surface text-ink-400">
                      <tr>
                        <th className="px-5 py-2 font-medium">Method</th>
                        <th className="px-5 py-2 font-medium">Path</th>
                        <th className="px-5 py-2 font-medium">Summary</th>
                        <th className="px-5 py-2 font-medium">Tags</th>
                      </tr>
                    </thead>
                    <tbody className="font-mono text-ink-100">
                      {api.operations.map((op, i) => (
                        <tr key={i} className="border-t border-bg-border/40">
                          <td className="whitespace-nowrap px-5 py-1.5 text-emerald-300">
                            {op.method}
                          </td>
                          <td className="whitespace-nowrap px-5 py-1.5">{op.path}</td>
                          <td className="px-5 py-1.5 font-sans text-ink-200">
                            {op.summary ?? ""}
                          </td>
                          <td className="px-5 py-1.5 text-sv-sky">{op.tags.join(", ")}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {/* Constants summary */}
            {consts && (
              <section className="rounded-lg border border-bg-border bg-bg-surface/70 shadow-card backdrop-blur">
                <header className="border-b border-bg-border bg-bg-base/40 px-5 py-4">
                  <h2 className="text-base font-semibold text-ink-50">
                    Constants{" "}
                    <span className="ml-2 text-xs text-ink-400">
                      {consts.totalKeys} top-level keys
                    </span>
                  </h2>
                  <p className="mt-1 text-xs text-ink-300">
                    First {consts.sample.length} samples shown — open{" "}
                    <a
                      href="/zaptec/zaptec-constants.json"
                      target="_blank"
                      rel="noreferrer"
                      className="text-sv-sky hover:underline"
                    >
                      raw JSON
                    </a>{" "}
                    for the full set.
                  </p>
                </header>
                <div className="space-y-3 p-5">
                  {consts.sample.map(([k, v]) => (
                    <div key={k} className="rounded border border-bg-border bg-bg-base/30 p-3">
                      <p className="font-mono text-xs text-sv-sky">{k}</p>
                      <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all font-mono text-[11px] text-ink-200">
                        {JSON.stringify(v, null, 2).slice(0, 600)}
                        {JSON.stringify(v).length > 600 ? "…" : ""}
                      </pre>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </PageShell>
    </>
  );
}
