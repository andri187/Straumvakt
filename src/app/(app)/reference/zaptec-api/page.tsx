import { cookies } from "next/headers";
import zaptecOpenApi from "../../../../../public/zaptec/openapi.json";
import zaptecConstants from "../../../../../public/zaptec/zaptec-constants.json";
import { Topbar } from "@/components/topbar";
import { PageShell } from "@/components/page-shell";
import { SectionTabs, REFERENCE_TABS } from "@/components/section-tabs";
import {
  TechSection,
  SourceBadge,
  InfoRow,
} from "@/components/reference/tech-section";
import {
  CONSTANT_KEY_INFO,
  OBSERVATION_INFO,
  COMMAND_INFO,
  OCPP_INFO,
  VENDOR_INFO,
} from "@/lib/reference/zaptec-info";
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
  try {
    const raw = zaptecOpenApi as Record<string, unknown>;
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

function loadConstantTopKeys(): string[] | null {
  return Object.keys(zaptecConstants as Record<string, unknown>);
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

export default async function ZaptecPage() {
  const jar = await cookies();
  const token = jar.get(adminSessionConfig.SESSION_COOKIE_NAME)?.value;
  const session = await verifyAdminSession(token);
  const email = session?.email;

  const api = loadOpenApiSummary();
  const constantKeys = loadConstantTopKeys();
  const synced = api !== null || constantKeys !== null;

  // Group observations by family for display — mirrors the Technical Read
  // diagnostics drawer's grouping.
  const observationGroups: Array<{
    title: string;
    ids: number[];
  }> = [
    { title: "Synthetic / connection", ids: [-3, -2, -1] },
    { title: "Capabilities", ids: [100, 110, 152, 154] },
    { title: "Electrical (live telemetry)", ids: [501, 502, 503, 507, 508, 509, 510, 511, 512, 513, 515, 518, 519, 520] },
    { title: "Metering", ids: [553, 554, 555] },
    { title: "Operation", ids: [701, 708, 710, 711, 712, 714, 715, 716, 718, 720, 721, 722, 723] },
    { title: "Authentication", ids: [120, 750, 751, 752] },
    { title: "Diagnostics & cloud", ids: [803, 804, 809, 810, 820, 821] },
    { title: "OCPP Native (only when AuthType=3)", ids: [861, 862, 866] },
    { title: "Versions", ids: [908, 909, 911, 912, 913, 914] },
    { title: "Identifiers (MAC + LTE + MID)", ids: [950, 951, 952, 953, 962, 963, 980, 981, 982] },
  ];

  // Group commands by category
  const commandGroups: Array<{
    title: string;
    ids: number[];
  }> = [
    { title: "Lifecycle (operator-facing)", ids: [102, 506, 507, 10001] },
    { title: "Maintenance", ids: [104, 200, 261] },
    { title: "Connector", ids: [708] },
    { title: "Auth list", ids: [751] },
  ];

  return (
    <>
      <Topbar title="Zaptec API" email={email} />
      <PageShell
        title="Zaptec API & OCPP"
        description="Field-by-field reference of the Zaptec REST API and OCPP 1.6J integration. Each row describes what a value would mean, not what it currently is — for live telemetry against this surface, see Technical Read."
      >
        <SectionTabs tabs={REFERENCE_TABS} />

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
            <p className="mt-3 text-xs text-ink-400">.env is intentionally not synced — Rule 2.</p>
          </div>
        ) : (
          <div className="grid gap-4">
            {/* Section header — mirrors the SectionDivider in the Technical Read */}
            <div className="mt-2 flex items-center gap-3">
              <div className="h-px flex-1 bg-bg-border/50" />
              <div className="flex flex-col items-center gap-1 px-3">
                <SourceBadge source="api" />
                <p className="text-[11px] text-ink-300 text-center max-w-md">
                  Vendor REST API · Zaptec
                </p>
                <p className="text-[10px] text-ink-500 text-center max-w-md leading-tight">
                  Documentation view — every row below describes what the field means.
                  For live values, open Technical Read.
                </p>
              </div>
              <div className="h-px flex-1 bg-bg-border/50" />
            </div>

            {/* Vendor identity */}
            <TechSection title="Vendor" source="api" hint="zaptec.no">
              <dl>
                {VENDOR_INFO.map((v) => (
                  <InfoRow key={v.label} label={v.label} info={v.info} />
                ))}
              </dl>
            </TechSection>

            {/* OpenAPI surface — when snapshot vendored */}
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

            {/* Constants — brief descriptions instead of JSON dump */}
            {constantKeys ? (
              <TechSection
                title="Constants"
                source="api"
                hint={`${constantKeys.length} top-level keys · /api/constants`}
              >
                <p className="mb-3 text-[11px] text-ink-400">
                  Each key is a separate enum or lookup table. Click through to the{" "}
                  <a
                    href="/zaptec/zaptec-constants.json"
                    target="_blank"
                    rel="noreferrer"
                    className="text-sv-sky hover:underline"
                  >
                    raw JSON
                  </a>{" "}
                  for the full payload.
                </p>
                <dl>
                  {constantKeys.map((k) => (
                    <InfoRow
                      key={k}
                      label={k}
                      info={CONSTANT_KEY_INFO[k] ?? "(no description yet — populate in zaptec-info.ts)"}
                      mono
                    />
                  ))}
                </dl>
              </TechSection>
            ) : null}

            {/* State observations — grouped, with brief info per ID */}
            <TechSection
              title="State observations"
              source="api"
              hint={`${Object.keys(OBSERVATION_INFO).length} of 155 documented · /api/chargers/{id}/state`}
            >
              <p className="mb-3 text-[11px] text-ink-400">
                Live telemetry observation IDs. The Technical Read tab shows the current{" "}
                <code className="font-mono text-[10px]">ValueAsString</code> per row;
                here we show what each ID means. Full 155-entry table lives in{" "}
                <code className="font-mono text-[10px]">docs/reference/integrations/zaptec.md</code>{" "}
                §13.1.
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

            {/* Commands — brief info instead of empty body documentation */}
            <TechSection
              title="Commands"
              source="api"
              hint={`${Object.keys(COMMAND_INFO).length} documented of 50 · POST /api/chargers/{id}/sendCommand/{commandId}`}
            >
              <p className="mb-3 text-[11px] text-ink-400">
                Each <code className="font-mono">commandId</code> is invoked with an empty{" "}
                <code className="font-mono">POST</code> body. Destructive commands are flagged.
              </p>
              <div className="space-y-3">
                {commandGroups.map((g) => (
                  <div key={g.title}>
                    <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-brand text-sv-sky">
                      {g.title}
                    </p>
                    <dl>
                      {g.ids.map((id) => {
                        const c = COMMAND_INFO[id];
                        if (!c) return null;
                        return (
                          <div
                            key={id}
                            className="flex items-baseline justify-between gap-3 border-b border-bg-border/30 py-1 last:border-0"
                          >
                            <dt className="shrink-0 font-mono text-[11px] text-ink-200">
                              {id}{" "}
                              <span className={c.destructive ? "text-yellow-300" : "text-ink-400"}>
                                {c.name}
                              </span>
                            </dt>
                            <dd className="text-right text-[11px] italic text-ink-300">
                              {c.info}
                            </dd>
                          </div>
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
                  OCPP 1.6J · Zaptec implementation
                </p>
                <p className="text-[10px] text-ink-500 text-center max-w-md leading-tight">
                  Protocol-side documentation. See{" "}
                  <code className="font-mono text-[10px]">docs/reference/integrations/ocpp-1.6j.md</code>{" "}
                  for the full vocabulary.
                </p>
              </div>
              <div className="h-px flex-1 bg-bg-border/50" />
            </div>

            <TechSection title="OCPP integration" source="ocpp" hint="1.6J today · 2.0.1 admitted">
              <dl>
                {OCPP_INFO.map((r) => (
                  <InfoRow key={r.label} label={r.label} info={r.info} mono={r.mono} />
                ))}
              </dl>
            </TechSection>

            {/* Cross-link */}
            <TechSection title="See also" source="none">
              <ul className="space-y-1.5 text-xs">
                <li>
                  <a href="/technical-read" className="text-sv-green hover:text-sv-sky">
                    Technical Read
                  </a>
                  <span className="ml-2 italic text-ink-400">
                    iframe of zaptec-test on :3100 — same fields as above, but live
                  </span>
                </li>
                <li>
                  <a href="/reference/easee-api" className="text-sv-green hover:text-sv-sky">
                    Reference · API · Easee
                  </a>
                  <span className="ml-2 italic text-ink-400">
                    sibling AC vendor — same shape, different transport / observation IDs
                  </span>
                </li>
                <li>
                  <code className="rounded bg-bg-base/60 px-1.5 py-0.5 font-mono text-[10px]">
                    docs/reference/integrations/zaptec.md
                  </code>
                  <span className="ml-2 italic text-ink-400">
                    full 155-entry observation table, every command, every bitmask flag, OCMF parser, production-adapter checklist
                  </span>
                </li>
              </ul>
            </TechSection>
          </div>
        )}
      </PageShell>
    </>
  );
}
