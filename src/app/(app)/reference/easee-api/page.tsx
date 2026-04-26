import { cookies } from "next/headers";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Topbar } from "@/components/topbar";
import { PageShell } from "@/components/page-shell";
import { adminSessionConfig, verifyAdminSession } from "@/lib/admin-session";

export const metadata = { title: "Easee API" };

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

// Mirrors the loader in /reference/zaptec-api so when an Easee OpenAPI
// snapshot is vendored to public/easee/openapi.json this page lights up
// with the same surface table the Zaptec page renders. Until that file
// exists the page falls back to the curated reference below.
function loadOpenApiSummary(): OpenApiSummary | null {
  const path = resolve(process.cwd(), "public", "easee", "openapi.json");
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
      title: info.title ?? "Easee API",
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

type EndpointGroup = {
  title: string;
  path: string;
  operations: { method: string; pathSuffix: string; summary: string }[];
};

const CURATED_ENDPOINTS: EndpointGroup[] = [
  {
    title: "Authentication",
    path: "/api/accounts",
    operations: [
      { method: "POST", pathSuffix: "/login", summary: "Exchange username + password for accessToken + refreshToken" },
      { method: "POST", pathSuffix: "/refresh_token", summary: "Refresh accessToken using a valid refreshToken" },
      { method: "GET",  pathSuffix: "/profile", summary: "Read the authenticated user's profile" },
    ],
  },
  {
    title: "Sites",
    path: "/api/accounts",
    operations: [
      { method: "GET",  pathSuffix: "/sites", summary: "List sites the authenticated account has access to" },
      { method: "GET",  pathSuffix: "/sites/{siteId}", summary: "Detailed view of a single site (circuits + chargers nested)" },
    ],
  },
  {
    title: "Circuits",
    path: "/api/sites/{siteId}",
    operations: [
      { method: "GET",  pathSuffix: "/circuits", summary: "List circuits at this site (Easee models circuit explicitly)" },
      { method: "GET",  pathSuffix: "/circuits/{circuitId}", summary: "Detailed circuit including ampere ceiling + grid type" },
      { method: "POST", pathSuffix: "/circuits/{circuitId}/settings", summary: "Update circuit-level settings (e.g. main fuse rating)" },
    ],
  },
  {
    title: "Chargers",
    path: "/api/chargers",
    operations: [
      { method: "GET",  pathSuffix: "", summary: "List chargers visible to the authenticated account" },
      { method: "GET",  pathSuffix: "/{chargerId}/details", summary: "Charger detail (firmware, serial, model, dynamic state)" },
      { method: "GET",  pathSuffix: "/{chargerId}/state", summary: "Live state — output current, kW, voltages, status" },
      { method: "POST", pathSuffix: "/{chargerId}/commands/start_charging", summary: "Start a charging session remotely" },
      { method: "POST", pathSuffix: "/{chargerId}/commands/stop_charging", summary: "Stop the active session" },
      { method: "POST", pathSuffix: "/{chargerId}/commands/pause_charging", summary: "Pause without ending the session" },
      { method: "POST", pathSuffix: "/{chargerId}/settings", summary: "Update charger settings (max current, idle behaviour, etc.)" },
    ],
  },
  {
    title: "Sessions / CDRs",
    path: "/api/chargers",
    operations: [
      { method: "GET", pathSuffix: "/{chargerId}/sessions/monthly", summary: "Monthly aggregate of charging sessions for a charger" },
      { method: "GET", pathSuffix: "/{chargerId}/sessions/{sessionId}", summary: "Single charging session detail (energy, duration, cost)" },
      { method: "GET", pathSuffix: "/{chargerId}/sessions/ongoing", summary: "Current in-progress session if any" },
    ],
  },
  {
    title: "Equalizer (smart-meter)",
    path: "/api/equalizers",
    operations: [
      { method: "GET", pathSuffix: "", summary: "List Easee Equalizer devices linked to the account" },
      { method: "GET", pathSuffix: "/{equalizerId}/state", summary: "Live grid-import state used by Easee's load balancer" },
    ],
  },
];

export default async function EaseeApiPage() {
  const jar = await cookies();
  const token = jar.get(adminSessionConfig.SESSION_COOKIE_NAME)?.value;
  const session = await verifyAdminSession(token);
  const email = session?.email;

  const api = loadOpenApiSummary();

  return (
    <>
      <Topbar title="Reference · API · Easee" email={email} />
      <PageShell
        title="Easee API & OCPP"
        description="Easee Cloud API surface + OCPP 1.6J + 2.0.1 support. Sibling to the Zaptec adapter — no live data yet (Sprint 2.7 ships Zaptec first; Easee follows). Curated reference below mirrors the structure /reference/zaptec-api will use once an Easee OpenAPI snapshot is vendored."
      >
        <div className="grid gap-4">
          {/* Status banner */}
          <section className="rounded-lg border border-amber-700/40 bg-amber-950/20 p-5 shadow-card backdrop-blur">
            <h2 className="text-xs font-semibold uppercase tracking-brand text-amber-300">
              Adapter status
            </h2>
            <p className="mt-2 text-sm text-ink-100">
              Easee adapter is <span className="font-medium">not</span> wired
              for pilot. Zaptec ships in Sprint 2.7 first; Easee plugs in via
              the same vendor-credentials scaffolding when an Easee-shaped
              installation enters scope.
            </p>
            <p className="mt-1 text-xs text-ink-300">
              When the adapter lands, vendor the OpenAPI snapshot to{" "}
              <code className="font-mono text-[11px]">public/easee/openapi.json</code>{" "}
              (mirror of the Zaptec snapshot pattern) — the operations table
              below auto-renders just like the Zaptec page.
            </p>
          </section>

          {/* Vendor identity */}
          <section className="rounded-lg border border-bg-border bg-bg-surface/70 p-5 shadow-card backdrop-blur">
            <h2 className="text-xs font-semibold uppercase tracking-brand text-sv-sky">
              Vendor
            </h2>
            <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              <dt className="text-ink-400">Vendor name</dt>
              <dd className="text-ink-100">Easee AS (Norway)</dd>
              <dt className="text-ink-400">Cloud API base</dt>
              <dd className="font-mono text-xs text-ink-100">https://api.easee.com</dd>
              <dt className="text-ink-400">API style</dt>
              <dd className="text-ink-100">REST + JSON; bearer token (OAuth-like password grant)</dd>
              <dt className="text-ink-400">Documentation</dt>
              <dd>
                <a
                  href="https://developer.easee.com"
                  target="_blank"
                  rel="noreferrer"
                  className="text-sv-green hover:text-sv-sky"
                >
                  developer.easee.com ↗
                </a>
              </dd>
              <dt className="text-ink-400">Hardware models</dt>
              <dd className="text-ink-100">Easee Home, Easee One, Easee Charge (legacy), Easee Equalizer (smart-meter)</dd>
              <dt className="text-ink-400">OCPP versions</dt>
              <dd className="text-ink-100">
                OCPP 1.6J (default for Easee Home / One); OCPP 2.0.1 on selected firmwares
              </dd>
              <dt className="text-ink-400">Native data model</dt>
              <dd className="text-ink-100">Site → Circuit → Charger (maps cleanly onto V3 hierarchy with ADR 0007)</dd>
              <dt className="text-ink-400">Credential scope</dt>
              <dd className="text-ink-100">
                <code className="font-mono text-xs">installation</code> — one OAuth token
                per Easee site covers all chargers
              </dd>
            </dl>
          </section>

          {/* Live OpenAPI table (only when snapshot is vendored) */}
          {api && (
            <section className="rounded-lg border border-bg-border bg-bg-surface/70 shadow-card backdrop-blur">
              <header className="border-b border-bg-border bg-bg-base/40 px-5 py-4">
                <div className="flex items-baseline justify-between">
                  <h2 className="text-base font-semibold text-ink-50">
                    {api.title}{" "}
                    <span className="ml-2 text-xs text-ink-400">v{api.version}</span>
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

          {/* Curated cloud-API reference (always visible) */}
          <section className="rounded-lg border border-bg-border bg-bg-surface/70 shadow-card backdrop-blur">
            <header className="border-b border-bg-border bg-bg-base/40 px-5 py-4">
              <h2 className="text-base font-semibold text-ink-50">
                Cloud API — curated reference
              </h2>
              <p className="mt-1 text-xs text-ink-300">
                Hand-curated from Easee&apos;s public developer docs. Endpoints
                we&apos;ll exercise from the Easee adapter when it ships. Replaced
                automatically by the OpenAPI table above when the snapshot
                lands.
              </p>
            </header>
            <div className="divide-y divide-bg-border/40">
              {CURATED_ENDPOINTS.map((group) => (
                <div key={group.title} className="px-5 py-3">
                  <div className="flex items-baseline justify-between">
                    <h3 className="text-sm font-semibold text-ink-50">
                      {group.title}
                    </h3>
                    <code className="font-mono text-[11px] text-ink-400">
                      {group.path}
                    </code>
                  </div>
                  <ul className="mt-2 space-y-1">
                    {group.operations.map((op, i) => (
                      <li key={i} className="flex items-start gap-3 text-xs">
                        <span
                          className={
                            "inline-flex w-14 shrink-0 justify-center rounded font-mono " +
                            (op.method === "GET"
                              ? "bg-emerald-950/40 text-emerald-300"
                              : op.method === "POST"
                                ? "bg-sky-950/40 text-sky-300"
                                : op.method === "DELETE"
                                  ? "bg-rose-950/40 text-rose-300"
                                  : "bg-amber-950/40 text-amber-300")
                          }
                        >
                          {op.method}
                        </span>
                        <code className="font-mono text-ink-100">
                          {group.path}
                          <span className="text-ink-400">{op.pathSuffix}</span>
                        </code>
                        <span className="text-ink-300">— {op.summary}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>

          {/* OCPP support */}
          <section className="rounded-lg border border-bg-border bg-bg-surface/70 p-5 shadow-card backdrop-blur">
            <h2 className="text-xs font-semibold uppercase tracking-brand text-sv-sky">
              OCPP support
            </h2>
            <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[180px_1fr]">
              <dt className="text-ink-400">Default version</dt>
              <dd className="text-ink-100">OCPP 1.6J — secure WebSocket (wss://) with Basic-Auth identity</dd>
              <dt className="text-ink-400">2.0.1 readiness</dt>
              <dd className="text-ink-100">
                Available on selected Easee Home firmwares; deferred to
                post-pilot per ADR 0005 tag A. V3 translator boundary admits
                2.0.1 as a sibling module.
              </dd>
              <dt className="text-ink-400">Identity convention</dt>
              <dd className="text-ink-100">
                Charger serial as the OCPP identity string;{" "}
                <code className="font-mono text-xs">auth_secret</code> generated
                by Straumvakt and pushed to the device via the cloud API
                (analogous to Zaptec Pro&apos;s pattern).
              </dd>
              <dt className="text-ink-400">Heartbeat</dt>
              <dd className="text-ink-100">300 s default — adjusted via{" "}
                <code className="font-mono text-xs">ChangeConfiguration</code>
                {" "}if needed.
              </dd>
              <dt className="text-ink-400">MeterValues cadence</dt>
              <dd className="text-ink-100">
                60 s default during active session (configurable). Energy
                accumulation stable; compatible with standard OCPP 1.6J{" "}
                <code className="font-mono text-xs">Energy.Active.Import.Register</code>.
              </dd>
              <dt className="text-ink-400">Vendor-specific extensions</dt>
              <dd className="text-ink-100">
                Easee uses{" "}
                <code className="font-mono text-xs">DataTransfer</code> with
                vendor ID{" "}
                <code className="font-mono text-xs">com.easee</code> for
                Equalizer-aware load-balancing payloads — tracked but ignored
                by V3&apos;s translator (passes through to{" "}
                <code className="font-mono text-xs">raw_protocol</code>{" "}
                retention class).
              </dd>
            </dl>
          </section>

          {/* V3 integration roadmap */}
          <section className="rounded-lg border border-bg-border bg-bg-surface/70 p-5 shadow-card backdrop-blur">
            <h2 className="text-xs font-semibold uppercase tracking-brand text-sv-sky">
              V3 integration
            </h2>
            <ul className="mt-3 space-y-2 text-sm text-ink-200">
              <li>
                <strong className="text-ink-50">Hardware Catalog seed</strong> —
                Sprint 2.10 adds <code className="font-mono text-[11px]">hardware.vendors</code>{" "}
                row for{" "}
                <code className="font-mono text-[11px]">slug=easee</code>{" "}
                and model rows for{" "}
                <code className="font-mono text-[11px]">easee-home</code>,{" "}
                <code className="font-mono text-[11px]">easee-one</code>,{" "}
                <code className="font-mono text-[11px]">easee-equalizer</code>.
                Each model carries{" "}
                <code className="font-mono text-[11px]">credential_scope=installation</code>.
              </li>
              <li>
                <strong className="text-ink-50">Vendor adapter module</strong> —
                lives at <code className="font-mono text-[11px]">src/lib/vendors/easee/</code>
                {" "}sibling to the Zaptec adapter that ships in Sprint 2.7.
                Uses the same secret-store contract for the OAuth token (KV
                key on{" "}
                <code className="font-mono text-[11px]">installations.credentials_ref</code>).
              </li>
              <li>
                <strong className="text-ink-50">Onboarding wizard reuse</strong>{" "}
                — the Sprint 2.7 wizard is generalised over the vendor adapter
                contract; switching vendor in the dropdown lights up the
                Easee path with no UI changes.
              </li>
              <li>
                <strong className="text-ink-50">OCPP path</strong> — Easee
                chargers connect to the same{" "}
                <code className="font-mono text-[11px]">straumvakt-ocpp</code>{" "}
                gateway Worker on staging / prod; identity strings + Basic-Auth
                hashes set during onboarding.
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
                  href="/reference/zaptec-api"
                  className="text-sv-green hover:text-sv-sky"
                >
                  Reference · API · Zaptec
                </a>
                <span className="ml-2 text-xs text-ink-400">
                  live OpenAPI table + constants from the local zaptec-test
                  sandbox
                </span>
              </li>
              <li>
                <a
                  href="/technical-read"
                  className="text-sv-green hover:text-sv-sky"
                >
                  Technical Read
                </a>
                <span className="ml-2 text-xs text-ink-400">
                  iframe of zaptec-test on :3100 — real Zaptec API + OCPP
                  diagnostics. Easee equivalent ships when the adapter does.
                </span>
              </li>
            </ul>
          </section>
        </div>
      </PageShell>
    </>
  );
}
