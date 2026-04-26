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
        title="Zaptec API & OCPP"
        description="Static reference of Zaptec's REST API surface plus OCPP 1.6J integration notes. Live data lands when the Zaptec vendor adapter ships in Sprint 2.7. Real diagnostics against this surface are visible under Technical Read (iframe of zaptec-test on :3100)."
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
                No active Zaptec adapter yet — Sprint 2.7 wires authenticated
                calls into Straumvakt itself.
              </p>
              <p className="mt-1 text-xs text-ink-400">
                Until then, this page displays the OpenAPI surface and constants pulled
                from the local <code className="font-mono">zaptec-test</code> sandbox.
                Real Zaptec installations + live OCPP traffic <em>are</em> already
                observable today via{" "}
                <a
                  href="/technical-read"
                  className="text-sv-green hover:text-sv-sky"
                >
                  Technical Read
                </a>
                {" "}(iframe of zaptec-test on{" "}
                <code className="font-mono">:3100</code> — real OAuth credentials in
                <code className="font-mono"> zaptec-test/.env</code>, not duplicated
                to Straumvakt).
              </p>
            </section>

            {/* Vendor identity */}
            <section className="rounded-lg border border-bg-border bg-bg-surface/70 p-5 shadow-card backdrop-blur">
              <h2 className="text-xs font-semibold uppercase tracking-brand text-sv-sky">
                Vendor
              </h2>
              <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                <dt className="text-ink-400">Vendor name</dt>
                <dd className="text-ink-100">Zaptec AS (Norway)</dd>
                <dt className="text-ink-400">Cloud API base</dt>
                <dd className="font-mono text-xs text-ink-100">https://api.zaptec.com</dd>
                <dt className="text-ink-400">API style</dt>
                <dd className="text-ink-100">REST + JSON; OAuth 2 password grant → bearer + refresh</dd>
                <dt className="text-ink-400">Documentation</dt>
                <dd>
                  <a
                    href="https://api.zaptec.com/help/index.html"
                    target="_blank"
                    rel="noreferrer"
                    className="text-sv-green hover:text-sv-sky"
                  >
                    api.zaptec.com/help ↗
                  </a>
                </dd>
                <dt className="text-ink-400">Hardware models</dt>
                <dd className="text-ink-100">
                  Zaptec Pro (commercial / workplace, AC), Zaptec Go (home, AC),
                  Zaptec Sense (smart-meter)
                </dd>
                <dt className="text-ink-400">OCPP versions</dt>
                <dd className="text-ink-100">
                  OCPP 1.6J on Zaptec Pro (default for V3 pilot); 2.0.1 on selected
                  firmwares
                </dd>
                <dt className="text-ink-400">Native data model</dt>
                <dd className="text-ink-100">
                  Installation → Circuit → Charger (maps directly onto V3 hierarchy
                  with ADR 0007)
                </dd>
                <dt className="text-ink-400">Credential scope</dt>
                <dd className="text-ink-100">
                  <code className="font-mono text-xs">installation</code> — one
                  OAuth token per Zaptec installation covers all chargers
                </dd>
              </dl>
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

            {/* OCPP support */}
            <section className="rounded-lg border border-bg-border bg-bg-surface/70 p-5 shadow-card backdrop-blur">
              <h2 className="text-xs font-semibold uppercase tracking-brand text-sv-sky">
                OCPP support
              </h2>
              <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[180px_1fr]">
                <dt className="text-ink-400">Default version</dt>
                <dd className="text-ink-100">
                  OCPP 1.6J — secure WebSocket (wss://) with Basic-Auth identity
                </dd>
                <dt className="text-ink-400">2.0.1 readiness</dt>
                <dd className="text-ink-100">
                  Available on selected Zaptec Pro firmwares; deferred to
                  post-pilot per ADR 0005 tag A. V3 translator boundary in{" "}
                  <code className="font-mono text-xs">gateway/src/ocpp-frame.ts</code>
                  {" "}admits 2.0.1 as a sibling module without rework.
                </dd>
                <dt className="text-ink-400">Identity convention</dt>
                <dd className="text-ink-100">
                  Charger serial as the OCPP identity string; auth_secret
                  generated by Straumvakt and pushed to the device via the cloud
                  API at onboarding (Sprint 2.7 wizard). SHA-256 hashed at rest
                  in <code className="font-mono text-xs">ocpp_identities.auth_secret_hash</code>.
                </dd>
                <dt className="text-ink-400">Heartbeat</dt>
                <dd className="text-ink-100">
                  300 s default — adjusted via{" "}
                  <code className="font-mono text-xs">ChangeConfiguration</code>
                  {" "}from the operator console (Sprint 1.5 wired this end-to-end).
                </dd>
                <dt className="text-ink-400">MeterValues cadence</dt>
                <dd className="text-ink-100">
                  60 s default during active session (configurable). Energy
                  accumulation via standard{" "}
                  <code className="font-mono text-xs">Energy.Active.Import.Register</code>.
                  Verified end-to-end against zaptec-test sandbox during Sprint 1.
                </dd>
                <dt className="text-ink-400">Vendor-specific extensions</dt>
                <dd className="text-ink-100">
                  Zaptec uses{" "}
                  <code className="font-mono text-xs">DataTransfer</code> with
                  vendor ID{" "}
                  <code className="font-mono text-xs">com.zaptec</code> for
                  installation-aware load-balancing payloads — passed through to{" "}
                  <code className="font-mono text-xs">raw_protocol</code>{" "}
                  retention class without translation.
                </dd>
              </dl>
            </section>

            {/* V3 integration */}
            <section className="rounded-lg border border-bg-border bg-bg-surface/70 p-5 shadow-card backdrop-blur">
              <h2 className="text-xs font-semibold uppercase tracking-brand text-sv-sky">
                V3 integration
              </h2>
              <ul className="mt-3 space-y-2 text-sm text-ink-200">
                <li>
                  <strong className="text-ink-50">Hardware Catalog seed</strong>
                  {" "}— Sprint 0 already ships{" "}
                  <code className="font-mono text-[11px]">hardware.vendors.slug=zaptec</code>
                  {" "}with model{" "}
                  <code className="font-mono text-[11px]">zaptec-pro</code>{" "}
                  (credential_scope=installation). Sprint 0.6 catalog seed is
                  the source of truth.
                </li>
                <li>
                  <strong className="text-ink-50">Vendor adapter module</strong>
                  {" "}— ships in Sprint 2.7 at{" "}
                  <code className="font-mono text-[11px]">src/lib/vendors/zaptec/</code>.
                  OAuth tokens stored in Cloudflare KV keyed off{" "}
                  <code className="font-mono text-[11px]">installations.credentials_ref</code>;
                  never echoed to chat or committed to git per CLAUDE.md Rule 2.
                </li>
                <li>
                  <strong className="text-ink-50">Onboarding wizard</strong>{" "}
                  — Sprint 2.7 four-step wizard: enter Zaptec credentials → pick
                  installation → preview pulled metadata → save. One transaction
                  creates Installation + Circuits + Chargers + OCPPIdentities +
                  Connectors with{" "}
                  <code className="font-mono text-[11px]">vendor_circuit_ref</code>
                  {" "}+{" "}
                  <code className="font-mono text-[11px]">vendor_installation_ref</code>
                  {" "}populated.
                </li>
                <li>
                  <strong className="text-ink-50">OCPP path live since
                  Sprint 1</strong> — Zaptec chargers connect to{" "}
                  <code className="font-mono text-[11px]">straumvakt-ocpp</code>{" "}
                  gateway Worker (per-identity Durable Objects, ADR 0004
                  Service Binding). End-to-end verified via zaptec-test → real
                  Zaptec API → gateway → main app event log.
                </li>
              </ul>
            </section>

            {/* Cross-link */}
            <section className="rounded-lg border border-bg-border bg-bg-surface/70 p-5 shadow-card backdrop-blur">
              <h2 className="text-xs font-semibold uppercase tracking-brand text-sv-sky">
                See also
              </h2>
              <ul className="mt-3 space-y-1 text-sm text-ink-200">
                <li>
                  <a
                    href="/technical-read"
                    className="text-sv-green hover:text-sv-sky"
                  >
                    Technical Read
                  </a>
                  <span className="ml-2 text-xs text-ink-400">
                    live diagnostics — installation hierarchy, identity strip,
                    API + OCPP cards. Real Zaptec credentials in{" "}
                    <code className="font-mono text-[11px]">zaptec-test/.env</code>.
                  </span>
                </li>
                <li>
                  <a
                    href="/reference/easee-api"
                    className="text-sv-green hover:text-sv-sky"
                  >
                    Reference · API · Easee
                  </a>
                  <span className="ml-2 text-xs text-ink-400">
                    sibling vendor — curated reference until the adapter ships
                  </span>
                </li>
              </ul>
            </section>
          </div>
        )}
      </PageShell>
    </>
  );
}
