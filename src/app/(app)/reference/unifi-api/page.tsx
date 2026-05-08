import { cookies } from "next/headers";
import { Topbar } from "@/components/topbar";
import { PageShell } from "@/components/page-shell";
import { SectionTabs, REFERENCE_TABS } from "@/components/section-tabs";
import {
  TechSection,
  SourceBadge,
  InfoRow,
} from "@/components/reference/tech-section";
import {
  ADAPTER_STATUS,
  API_SURFACES,
  CONTROL_SAFETY,
  LOCAL_NETWORK_GROUPS,
  SITE_MANAGER_ENDPOINTS,
  STRAUMVAKT_MAPPING,
  VENDOR_INFO,
} from "@/lib/reference/unifi-info";
import { adminSessionConfig, verifyAdminSession } from "@/lib/admin-session";

export const metadata = { title: "UniFi API" };

function methodPill(method: string): string {
  switch (method) {
    case "GET":
      return "bg-emerald-950/40 text-emerald-300";
    case "POST":
      return "bg-sky-950/40 text-sky-300";
    default:
      return "bg-amber-950/40 text-amber-300";
  }
}

export default async function UniFiApiPage() {
  const jar = await cookies();
  const token = jar.get(adminSessionConfig.SESSION_COOKIE_NAME)?.value;
  const session = await verifyAdminSession(token);
  const email = session?.email;

  return (
    <>
      <Topbar title="Reference · API · UniFi" email={email} />
      <PageShell
        title="UniFi API & network hardware"
        description="Reference for UniFi as site network infrastructure around Straumvakt charger deployments: cloud Site Manager inventory, local Network API control, device/client health, VLAN/firewall context, and installer access workflows."
      >
        <SectionTabs tabs={REFERENCE_TABS} />

        <div className="grid gap-4">
          <section className="rounded-lg border border-amber-700/40 bg-amber-950/20 p-5 shadow-card backdrop-blur">
            <h2 className="text-xs font-semibold uppercase tracking-brand text-amber-300">
              Adapter status - {ADAPTER_STATUS.state}
            </h2>
            <p className="mt-2 text-sm text-ink-100">
              {ADAPTER_STATUS.description}
            </p>
          </section>

          <div className="mt-2 flex items-center gap-3">
            <div className="h-px flex-1 bg-bg-border/50" />
            <div className="flex flex-col items-center gap-1 px-3">
              <span className="inline-flex items-center gap-1 rounded bg-sky-500/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-brand text-sky-300 ring-1 ring-inset ring-sky-500/30">
                Network infrastructure
              </span>
              <p className="max-w-md text-center text-[11px] text-ink-300">
                Gateways · switches · access points · UniFi OS hosts
              </p>
              <p className="max-w-md text-center text-[10px] leading-tight text-ink-500">
                Not a charger API. UniFi explains whether the site network can
                carry charger traffic before charger-level diagnostics begin.
              </p>
            </div>
            <div className="h-px flex-1 bg-bg-border/50" />
          </div>

          <TechSection title="Vendor" source="api" hint="ui.com">
            <dl>
              {VENDOR_INFO.map((v) => (
                <InfoRow key={v.label} label={v.label} info={v.info} />
              ))}
            </dl>
          </TechSection>

          <TechSection
            title="API surfaces"
            source="api"
            hint={`${API_SURFACES.length} surfaces`}
          >
            <div className="overflow-hidden rounded-md border border-bg-border/70">
              <table className="w-full text-[11px]">
                <thead className="bg-bg-inset/40 text-left text-[10px] uppercase tracking-brand text-ink-500">
                  <tr>
                    <th className="px-3 py-1.5 font-medium">Surface</th>
                    <th className="px-3 py-1.5 font-medium">Base / docs</th>
                    <th className="px-3 py-1.5 font-medium">Auth</th>
                    <th className="px-3 py-1.5 font-medium">Best fit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-bg-border/40">
                  {API_SURFACES.map((s) => (
                    <tr key={s.surface} className="hover:bg-bg-raised/30">
                      <td className="px-3 py-1.5 text-ink-200">{s.surface}</td>
                      <td className="px-3 py-1.5 font-mono text-[10px] text-sv-sky">
                        {s.base}
                      </td>
                      <td className="px-3 py-1.5 text-ink-300">{s.auth}</td>
                      <td className="px-3 py-1.5 italic text-ink-300">
                        {s.use}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </TechSection>

          <div className="mt-4 flex items-center gap-3">
            <div className="h-px flex-1 bg-bg-border/50" />
            <div className="flex flex-col items-center gap-1 px-3">
              <SourceBadge source="api" />
              <p className="max-w-md text-center text-[11px] text-ink-300">
                Cloud inventory first · local control second
              </p>
              <p className="max-w-md text-center text-[10px] leading-tight text-ink-500">
                Keep Site Manager keys separate from local Network API keys.
              </p>
            </div>
            <div className="h-px flex-1 bg-bg-border/50" />
          </div>

          <TechSection
            title="Site Manager API"
            source="api"
            hint={`${SITE_MANAGER_ENDPOINTS.length} official v1 endpoints`}
          >
            <p className="mb-3 text-[11px] text-ink-400">
              Fleet visibility through{" "}
              <code className="font-mono text-[10px]">
                https://api.ui.com/v1
              </code>
              . Useful for NOC health and site inventory, not charger commands.
            </p>
            <div className="overflow-hidden rounded-md border border-bg-border/70">
              <table className="w-full text-[11px]">
                <thead className="bg-bg-inset/40 text-left text-[10px] uppercase tracking-brand text-ink-500">
                  <tr>
                    <th className="w-16 px-3 py-1.5 font-medium">Method</th>
                    <th className="px-3 py-1.5 font-medium">Path</th>
                    <th className="px-3 py-1.5 font-medium">What it does</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-bg-border/40">
                  {SITE_MANAGER_ENDPOINTS.map((e) => (
                    <tr
                      key={`${e.method}-${e.path}`}
                      className="hover:bg-bg-raised/30"
                    >
                      <td className="whitespace-nowrap px-3 py-1.5">
                        <span
                          className={
                            "inline-flex w-12 justify-center rounded font-mono text-[10px] " +
                            methodPill(e.method)
                          }
                        >
                          {e.method}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-1.5 font-mono text-ink-200">
                        {e.path}
                      </td>
                      <td className="px-3 py-1.5 italic text-ink-300">
                        {e.info}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </TechSection>

          <TechSection
            title="Local UniFi Network API"
            source="api"
            hint={`${LOCAL_NETWORK_GROUPS.length} capability groups`}
          >
            <p className="mb-3 text-[11px] text-ink-400">
              Official local docs and API-key generation live inside each
              controller at Settings - Control Plane - Integrations. Use this
              surface for detailed site control.
            </p>
            <div className="overflow-hidden rounded-md border border-bg-border/70">
              <table className="w-full text-[11px]">
                <thead className="bg-bg-inset/40 text-left text-[10px] uppercase tracking-brand text-ink-500">
                  <tr>
                    <th className="px-3 py-1.5 font-medium">Group</th>
                    <th className="px-3 py-1.5 font-medium">Capabilities</th>
                    <th className="px-3 py-1.5 font-medium">Straumvakt use</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-bg-border/40">
                  {LOCAL_NETWORK_GROUPS.map((g) => (
                    <tr key={g.group} className="hover:bg-bg-raised/30">
                      <td className="px-3 py-1.5 font-mono text-sv-sky">
                        {g.group}
                      </td>
                      <td className="px-3 py-1.5 text-ink-200">
                        {g.capabilities}
                      </td>
                      <td className="px-3 py-1.5 italic text-ink-300">
                        {g.use}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </TechSection>

          <TechSection
            title="Control safety"
            source="none"
            hint="Write actions need audit + confirmation"
          >
            <dl>
              {CONTROL_SAFETY.map((a) => (
                <InfoRow
                  key={a.action}
                  label={a.action}
                  info={`${a.risk}. ${a.recommendation}.`}
                />
              ))}
            </dl>
          </TechSection>

          <TechSection
            title="Straumvakt mapping"
            source="none"
            hint="Suggested external refs"
          >
            <dl>
              {STRAUMVAKT_MAPPING.map((m) => (
                <InfoRow key={m.field} label={m.field} info={m.unifi} />
              ))}
            </dl>
          </TechSection>

          <TechSection title="See also" source="none">
            <ul className="space-y-1.5 text-xs">
              <li>
                <a
                  href="/reference/teltonika-rut"
                  className="text-sv-green hover:text-sv-sky"
                >
                  Reference · Connectivity · Teltonika RUT
                </a>
                <span className="ml-2 italic text-ink-400">
                  cellular backhaul and VPN path for charger LANs
                </span>
              </li>
              <li>
                <a
                  href="/reference/alfen-api"
                  className="text-sv-green hover:text-sv-sky"
                >
                  Reference · API · Alfen
                </a>
                <span className="ml-2 italic text-ink-400">
                  example where charger LAN access often matters before OCPP
                  cutover
                </span>
              </li>
              <li>
                <code className="rounded bg-bg-base/60 px-1.5 py-0.5 font-mono text-[10px]">
                  docs/reference/integrations/unifi.md
                </code>
                <span className="ml-2 italic text-ink-400">
                  full Markdown reference with auth, surfaces, workflows, and
                  adapter checklist
                </span>
              </li>
            </ul>
          </TechSection>
        </div>
      </PageShell>
    </>
  );
}
