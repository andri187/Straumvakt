import { cookies } from "next/headers";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Topbar } from "@/components/topbar";
import { PageShell } from "@/components/page-shell";
import { SectionTabs, REFERENCE_TABS } from "@/components/section-tabs";
import {
  TechSection,
  SourceBadge,
  InfoRow,
  PlaceholderRow,
} from "@/components/reference/tech-section";
import {
  VENDOR_INFO,
  ENDPOINT_GROUPS,
  OBSERVATION_INFO,
  OCPP_INFO,
  ADAPTER_STATUS,
} from "@/lib/reference/easee-info";
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

function methodPill(method: string): string {
  switch (method) {
    case "GET":
      return "bg-emerald-950/40 text-emerald-300";
    case "POST":
      return "bg-sky-950/40 text-sky-300";
    case "DELETE":
      return "bg-rose-950/40 text-rose-300";
    default:
      return "bg-amber-950/40 text-amber-300";
  }
}

export default async function EaseeApiPage() {
  const jar = await cookies();
  const token = jar.get(adminSessionConfig.SESSION_COOKIE_NAME)?.value;
  const session = await verifyAdminSession(token);
  const email = session?.email;

  const api = loadOpenApiSummary();

  // Group observations by family for display — mirrors the Tech Read
  // diagnostics-drawer grouping.
  const observationGroups: Array<{ title: string; ids: number[] }> = [
    { title: "Operation", ids: [31, 38, 41, 42, 44, 45, 47, 48, 96, 100, 103, 109, 110] },
    { title: "Electrical (live telemetry)", ids: [22, 23, 24, 111, 112, 113, 114, 115, 116, 120] },
    { title: "Energy / metering", ids: [121, 122, 124, 125, 126, 129] },
    { title: "Connectivity", ids: [81, 130, 131, 132, 141, 220, 221] },
    { title: "Site-level aggregates (master-only)", ids: [76, 77, 78, 79] },
    { title: "Authentication", ids: [15, 16, 17, 28, 69, 108, 128] },
    { title: "Diagnostics", ids: [89, 117, 118, 119, 219] },
    { title: "Hardware identity", ids: [80, 90, 91, 107] },
    { title: "Temperature", ids: [150, 151, 160, 161, 162, 163, 164, 165, 166, 170, 172] },
    { title: "Cloud", ids: [250, 251] },
  ];

  return (
    <>
      <Topbar title="Reference · API · Easee" email={email} />
      <PageShell
        title="Easee API & OCPP"
        description="Field-by-field reference of Easee Cloud API + OCPP 1.6J. Documentation view (label → brief info), styled to mirror Technical Read. No live data yet — adapter ships after Zaptec (Sprint 2.7+)."
      >
        <SectionTabs tabs={REFERENCE_TABS} />

        <div className="grid gap-4">
          {/* Adapter status banner */}
          <section className="rounded-lg border border-amber-700/40 bg-amber-950/20 p-5 shadow-card backdrop-blur">
            <h2 className="text-xs font-semibold uppercase tracking-brand text-amber-300">
              Adapter status — {ADAPTER_STATUS.state}
            </h2>
            <p className="mt-2 text-sm text-ink-100">{ADAPTER_STATUS.description}</p>
            <p className="mt-1 text-[11px] text-ink-400">
              Vendor an OpenAPI snapshot to{" "}
              <code className="font-mono text-[11px]">public/easee/openapi.json</code>{" "}
              and the operations table below auto-renders.
            </p>
          </section>

          {/* Section divider — REST API */}
          <div className="mt-2 flex items-center gap-3">
            <div className="h-px flex-1 bg-bg-border/50" />
            <div className="flex flex-col items-center gap-1 px-3">
              <SourceBadge source="api" />
              <p className="text-[11px] text-ink-300 text-center max-w-md">
                Cloud REST API · Easee
              </p>
              <p className="text-[10px] text-ink-500 text-center max-w-md leading-tight">
                Documentation view — every row below describes what the field means.
                For live values, the Easee adapter must ship first.
              </p>
            </div>
            <div className="h-px flex-1 bg-bg-border/50" />
          </div>

          {/* Vendor identity */}
          <TechSection title="Vendor" source="api" hint="easee.com">
            <dl>
              {VENDOR_INFO.map((v) => (
                <InfoRow key={v.label} label={v.label} info={v.info} />
              ))}
            </dl>
          </TechSection>

          {/* Live OpenAPI table — only when snapshot is vendored */}
          {api ? (
            <TechSection
              title={`${api.title} v${api.version}`}
              source="api"
              hint={`${api.operations.length} operations · ${api.pathCount} paths · ${api.tags.length} tags`}
            >
              {api.serverUrl ? (
                <p className="mb-3 text-[11px] text-ink-400">
                  Base:{" "}
                  <code className="rounded bg-bg-base/60 px-1.5 py-0.5 font-mono text-xs">
                    {api.serverUrl}
                  </code>
                </p>
              ) : null}
              <div className="max-h-[55vh] overflow-y-auto rounded-md border border-bg-border/70">
                <table className="w-full text-left text-[11px]">
                  <thead className="sticky top-0 bg-bg-inset/40 text-[10px] uppercase tracking-brand text-ink-500">
                    <tr>
                      <th className="px-3 py-1.5 font-medium w-16">Method</th>
                      <th className="px-3 py-1.5 font-medium">Path</th>
                      <th className="px-3 py-1.5 font-medium">What it does</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-bg-border/40">
                    {api.operations.map((op, i) => (
                      <tr key={i} className="hover:bg-bg-raised/30">
                        <td className="whitespace-nowrap px-3 py-1.5">
                          <span
                            className={
                              "inline-flex w-12 justify-center rounded font-mono text-[10px] " +
                              methodPill(op.method)
                            }
                          >
                            {op.method}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-3 py-1.5 font-mono text-ink-200">
                          {op.path}
                        </td>
                        <td className="px-3 py-1.5 italic text-ink-300">
                          {op.summary ?? "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </TechSection>
          ) : null}

          {/* Curated endpoint surface (always visible) — info column shows what each does */}
          <TechSection
            title="Cloud API — curated reference"
            source="api"
            hint={`${ENDPOINT_GROUPS.reduce((n, g) => n + g.operations.length, 0)} operations across ${ENDPOINT_GROUPS.length} groups`}
          >
            <p className="mb-3 text-[11px] text-ink-400">
              Hand-curated from Easee&apos;s public developer docs. Each operation
              row carries a brief description of what it does. The OpenAPI table
              above auto-replaces this once a snapshot is vendored.
            </p>
            <div className="space-y-3">
              {ENDPOINT_GROUPS.map((g) => (
                <div key={g.group}>
                  <div className="mb-1.5 flex items-baseline justify-between">
                    <p className="text-[10px] font-semibold uppercase tracking-brand text-sv-sky">
                      {g.group}
                    </p>
                    <code className="font-mono text-[10px] text-ink-400">{g.basePath}</code>
                  </div>
                  <dl>
                    {g.operations.map((op, i) => (
                      <div
                        key={i}
                        className="flex items-baseline gap-3 border-b border-bg-border/30 py-1 last:border-0"
                      >
                        <span
                          className={
                            "inline-flex w-12 shrink-0 justify-center rounded font-mono text-[10px] " +
                            methodPill(op.method)
                          }
                        >
                          {op.method}
                        </span>
                        <code className="shrink-0 font-mono text-[11px] text-ink-200">
                          {op.suffix || "(base)"}
                        </code>
                        <span className="ml-auto text-right text-[11px] italic text-ink-300">
                          {op.info}
                        </span>
                      </div>
                    ))}
                  </dl>
                </div>
              ))}
            </div>
          </TechSection>

          {/* SignalR push — placeholder rows describing what would arrive */}
          <TechSection
            title="Real-time push (SignalR)"
            source="api"
            hint="WSS · /hubs/chargers"
          >
            <p className="mb-3 text-[11px] text-ink-400">
              Easee uses Microsoft SignalR over WebSocket — distinct from
              Zaptec&apos;s Service Bus AMQP. Negotiate, connect, send protocol
              handshake, then subscribe per charger.
            </p>
            <dl>
              <InfoRow label="Negotiate URL" info="POST /hubs/chargers/negotiate?negotiateVersion=1 — returns connectionToken" mono />
              <InfoRow label="WebSocket URL" info="wss://api.easee.com/hubs/chargers?id={connectionToken}" mono />
              <InfoRow label="Auth" info="Bearer JWT in Authorization header (or access_token query param)" />
              <InfoRow label="Protocol handshake" info='{"protocol":"json","version":1} terminated by 0x1E record-separator' mono />
              <InfoRow label="Subscribe" info='{"type":1,"target":"SubscribeWithCurrentState","arguments":["<chargerId>",true]}' mono />
              <InfoRow label="Push frame" info='{"type":1,"target":"ProductUpdate","arguments":[{ Mid, DataType, Id, Value, Timestamp }]}' mono />
              <InfoRow label="Keep-alive" info="Ping (Type 6) every ~15 s — server drops the conn after 30 s of silence" />
              <PlaceholderRow
                label="Live observations"
                hint="Will arrive once the adapter is wired and an Easee Site enters scope"
              />
            </dl>
          </TechSection>

          {/* State observations — grouped, with brief info per ID */}
          <TechSection
            title="ChargerStreamData observations"
            source="api"
            hint={`${Object.keys(OBSERVATION_INFO).length} of ~180 documented · ChargerStreamData enum (pyeasee)`}
          >
            <p className="mb-3 text-[11px] text-ink-400">
              Live observation IDs Easee chargers push over SignalR. The
              Technical Read tab would show the current{" "}
              <code className="font-mono text-[10px]">Value</code> per row;
              here we show what each ID means. Full list lives in{" "}
              <code className="font-mono text-[10px]">docs/reference/integrations/easee.md</code>{" "}
              §11.
            </p>
            <div className="space-y-3">
              {observationGroups.map((g) => (
                <div key={g.title}>
                  <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-brand text-sv-sky">
                    {g.title}
                  </p>
                  <dl>
                    {g.ids.map((id) => {
                      const o = OBSERVATION_INFO[id];
                      if (!o) return null;
                      return (
                        <InfoRow
                          key={id}
                          label={`${id}  ${o.name}`}
                          info={o.info}
                          mono
                        />
                      );
                    })}
                  </dl>
                </div>
              ))}
            </div>
          </TechSection>

          {/* OCPP section divider */}
          <div className="mt-4 flex items-center gap-3">
            <div className="h-px flex-1 bg-bg-border/50" />
            <div className="flex flex-col items-center gap-1 px-3">
              <SourceBadge source="ocpp" />
              <p className="text-[11px] text-ink-300 text-center max-w-md">
                OCPP 1.6J · Easee implementation
              </p>
              <p className="text-[10px] text-ink-500 text-center max-w-md leading-tight">
                Same protocol as Zaptec — see{" "}
                <code className="font-mono text-[10px]">docs/reference/integrations/ocpp-1.6j.md</code>{" "}
                for the shared vocabulary.
              </p>
            </div>
            <div className="h-px flex-1 bg-bg-border/50" />
          </div>

          <TechSection title="OCPP integration" source="ocpp" hint="1.6J today · 2.0.1 admitted">
            <dl>
              {OCPP_INFO.map((r) => (
                <InfoRow key={r.label} label={r.label} info={r.info} />
              ))}
            </dl>
          </TechSection>

          {/* Cross-link */}
          <TechSection title="See also" source="none">
            <ul className="space-y-1.5 text-xs">
              <li>
                <a href="/reference/zaptec-api" className="text-sv-green hover:text-sv-sky">
                  Reference · API · Zaptec
                </a>
                <span className="ml-2 italic text-ink-400">
                  sibling AC vendor — same shape, currently the live integration via
                  zaptec-test
                </span>
              </li>
              <li>
                <a href="/technical-read" className="text-sv-green hover:text-sv-sky">
                  Technical Read
                </a>
                <span className="ml-2 italic text-ink-400">
                  Zaptec live diagnostics — Easee equivalent ships when the adapter does
                </span>
              </li>
              <li>
                <code className="rounded bg-bg-base/60 px-1.5 py-0.5 font-mono text-[10px]">
                  docs/reference/integrations/easee.md
                </code>
                <span className="ml-2 italic text-ink-400">
                  full ChargerStreamData (180+) + EqualizerStreamData enums, SignalR handshake, production-adapter checklist
                </span>
              </li>
            </ul>
          </TechSection>
        </div>
      </PageShell>
    </>
  );
}
