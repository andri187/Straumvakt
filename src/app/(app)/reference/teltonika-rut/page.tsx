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
  VENDOR_INFO,
  CPMS_USE_CASES,
  AUTH_OPTIONS,
  LOCAL_API_OBJECTS,
  RMS_ENDPOINTS,
  DEPLOYMENT_PATTERNS,
  BASELINE_CONFIG,
  SECURITY_NOTES,
  ADAPTER_STATUS,
} from "@/lib/reference/teltonika-info";
import { adminSessionConfig, verifyAdminSession } from "@/lib/admin-session";

export const metadata = { title: "Teltonika RUT" };

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

export default async function TeltonikaRutPage() {
  const jar = await cookies();
  const token = jar.get(adminSessionConfig.SESSION_COOKIE_NAME)?.value;
  const session = await verifyAdminSession(token);
  const email = session?.email;

  return (
    <>
      <Topbar title="Reference · Connectivity · Teltonika RUT" email={email} />
      <PageShell
        title="Teltonika RUT — 4G/5G modems"
        description="Field-by-field reference of Teltonika RUT modems. V3 schema class: Hardware / 4G modems (HardwareVendorKind = modem) — distinct from Hardware / Chargers. Cellular backhaul + VPN concentrator commonly deployed between chargers and the cloud at greenfield sites."
      >
        <SectionTabs tabs={REFERENCE_TABS} />

        <div className="grid gap-4">
          {/* Adapter status */}
          <section className="rounded-lg border border-amber-700/40 bg-amber-950/20 p-5 shadow-card backdrop-blur">
            <h2 className="text-xs font-semibold uppercase tracking-brand text-amber-300">
              Adapter status — {ADAPTER_STATUS.state}
            </h2>
            <p className="mt-2 text-sm text-ink-100">{ADAPTER_STATUS.description}</p>
          </section>

          {/* Section divider — V3 hardware class banner */}
          <div className="mt-2 flex items-center gap-3">
            <div className="h-px flex-1 bg-bg-border/50" />
            <div className="flex flex-col items-center gap-1 px-3">
              <span className="inline-flex items-center gap-1 rounded bg-purple-500/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-brand text-purple-300 ring-1 ring-inset ring-purple-500/30">
                Hardware / 4G modems
              </span>
              <p className="text-[11px] text-ink-300 text-center max-w-md">
                <code className="font-mono text-[10px] text-ink-400">HardwareVendorKind = modem</code>
                {" · "}
                <code className="font-mono text-[10px] text-ink-400">SiteAssetKind = modem</code>
              </p>
              <p className="text-[10px] text-ink-500 text-center max-w-md leading-tight">
                Distinct V3 schema class from Hardware / Chargers (Zaptec, Easee, Alfen). Extends{" "}
                <code className="font-mono text-[10px] text-ink-400">assets.site_assets</code> via{" "}
                <code className="font-mono text-[10px] text-ink-400">assets.modems</code>.
              </p>
            </div>
            <div className="h-px flex-1 bg-bg-border/50" />
          </div>

          {/* Vendor identity */}
          <TechSection title="Vendor" source="api" hint="teltonika-networks.com">
            <dl>
              {VENDOR_INFO.map((v) => (
                <InfoRow key={v.label} label={v.label} info={v.info} />
              ))}
            </dl>
          </TechSection>

          {/* Why a CPMS cares */}
          <TechSection
            title="Why Straumvakt cares about Teltonika"
            source="none"
            hint={`${CPMS_USE_CASES.length} use cases`}
          >
            <p className="mb-3 text-[11px] text-ink-400">
              Teltonika RUT is the recurring answer to "how does the charger get online" and "how
              does the installer reach the charger LAN remotely". Both decisions appear in the
              charger-vendor onboarding playbooks (notably <code className="font-mono text-[10px]">alfen.md §1</code>).
            </p>
            <dl>
              {CPMS_USE_CASES.map((u) => (
                <InfoRow key={u.label} label={u.label} info={u.info} />
              ))}
            </dl>
          </TechSection>

          {/* Section divider — auth */}
          <div className="mt-4 flex items-center gap-3">
            <div className="h-px flex-1 bg-bg-border/50" />
            <div className="flex flex-col items-center gap-1 px-3">
              <SourceBadge source="api" />
              <p className="text-[11px] text-ink-300 text-center max-w-md">
                Authentication · two surfaces
              </p>
              <p className="text-[10px] text-ink-500 text-center max-w-md leading-tight">
                Local JSON-RPC for site-specific config; RMS API for fleet visibility.
              </p>
            </div>
            <div className="h-px flex-1 bg-bg-border/50" />
          </div>

          <TechSection
            title="Authentication options"
            source="api"
            hint="Local /ubus token + RMS PAT bearer"
          >
            <dl>
              {AUTH_OPTIONS.map((a) => (
                <InfoRow key={a.label} label={a.label} info={a.info} />
              ))}
            </dl>
          </TechSection>

          {/* Local JSON-RPC */}
          <TechSection
            title="Local JSON-RPC API surface"
            source="api"
            hint={`${LOCAL_API_OBJECTS.length} object/method pairs · POST /ubus`}
          >
            <p className="mb-3 text-[11px] text-ink-400">
              Login returns a session token; subsequent calls put the token in the first param
              slot. Session timeout default 300 s. JSON-RPC must be enabled on the router (System →
              Administration → Access Control).
            </p>
            <div className="overflow-hidden rounded-md border border-bg-border/70">
              <table className="w-full text-[11px]">
                <thead className="bg-bg-inset/40 text-left text-[10px] uppercase tracking-brand text-ink-500">
                  <tr>
                    <th className="px-3 py-1.5 font-medium">Object (namespace)</th>
                    <th className="px-3 py-1.5 font-medium w-44">Method</th>
                    <th className="px-3 py-1.5 font-medium">What it does</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-bg-border/40">
                  {LOCAL_API_OBJECTS.map((o, i) => (
                    <tr key={i} className="hover:bg-bg-raised/30">
                      <td className="px-3 py-1.5 font-mono text-ink-200">{o.object}</td>
                      <td className="px-3 py-1.5 font-mono text-[10px] text-sv-sky">{o.method}</td>
                      <td className="px-3 py-1.5 italic text-ink-300">{o.info}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </TechSection>

          {/* RMS API */}
          <TechSection
            title="RMS Cloud API"
            source="api"
            hint={`${RMS_ENDPOINTS.length} endpoints · developers.rms.teltonika-networks.com`}
          >
            <p className="mb-3 text-[11px] text-ink-400">
              Personal Access Token (PAT) bearer — requires 2FA on the RMS account. Account → API →
              Access tokens → Add new access token → select scopes. The "Connect" endpoint mints
              time-bound public URLs into the device's LAN — the no-VPN path for installer access.
            </p>
            <div className="overflow-hidden rounded-md border border-bg-border/70">
              <table className="w-full text-[11px]">
                <thead className="bg-bg-inset/40 text-left text-[10px] uppercase tracking-brand text-ink-500">
                  <tr>
                    <th className="px-3 py-1.5 font-medium w-16">Method</th>
                    <th className="px-3 py-1.5 font-medium">Path</th>
                    <th className="px-3 py-1.5 font-medium">What it does</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-bg-border/40">
                  {RMS_ENDPOINTS.map((e, i) => (
                    <tr key={i} className="hover:bg-bg-raised/30">
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
                      <td className="px-3 py-1.5 italic text-ink-300">{e.info}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </TechSection>

          {/* Section divider — deployment */}
          <div className="mt-4 flex items-center gap-3">
            <div className="h-px flex-1 bg-bg-border/50" />
            <div className="flex flex-col items-center gap-1 px-3">
              <span className="inline-flex items-center gap-1 rounded bg-yellow-500/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-brand text-yellow-300 ring-1 ring-inset ring-yellow-500/30">
                Operations
              </span>
              <p className="text-[11px] text-ink-300 text-center max-w-md">
                Deployment patterns · baseline config · security
              </p>
              <p className="text-[10px] text-ink-500 text-center max-w-md leading-tight">
                Operator-facing concerns — what to set on every router, how to access them, what
                can go wrong.
              </p>
            </div>
            <div className="h-px flex-1 bg-bg-border/50" />
          </div>

          <TechSection
            title="Deployment patterns"
            source="none"
            hint="VPN vs RMS Connect vs port-forward (don't)"
          >
            <dl>
              {DEPLOYMENT_PATTERNS.map((p) => (
                <InfoRow key={p.pattern} label={p.pattern} info={p.info} />
              ))}
            </dl>
          </TechSection>

          <TechSection
            title="Recommended baseline configuration"
            source="none"
            hint={`${BASELINE_CONFIG.length} settings · ship preset on every CPMS-deployed router`}
          >
            <p className="mb-3 text-[11px] text-ink-400">
              When Straumvakt sells a deployment that includes Teltonika hardware, every router
              should ship with these settings — via RMS bulk config, factory image, or first-boot
              script.
            </p>
            <dl>
              {BASELINE_CONFIG.map((b) => (
                <InfoRow key={b.setting} label={b.setting} info={b.info} />
              ))}
            </dl>
          </TechSection>

          <TechSection
            title="Security considerations"
            source="none"
            hint={`${SECURITY_NOTES.length} concerns to validate before commissioning`}
          >
            <dl>
              {SECURITY_NOTES.map((s) => (
                <InfoRow key={s.topic} label={s.topic} info={s.info} />
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
                  AC charger that may sit behind a Teltonika at sites without wired internet
                </span>
              </li>
              <li>
                <a href="/reference/easee-api" className="text-sv-green hover:text-sv-sky">
                  Reference · API · Easee
                </a>
                <span className="ml-2 italic text-ink-400">same — same deployment pattern</span>
              </li>
              <li>
                <a href="/reference/alfen-api" className="text-sv-green hover:text-sv-sky">
                  Reference · API · Alfen
                </a>
                <span className="ml-2 italic text-ink-400">
                  references Teltonika as the "VPN to charger LAN" path repeatedly (§1.1, §1.6)
                </span>
              </li>
              <li>
                <code className="rounded bg-bg-base/60 px-1.5 py-0.5 font-mono text-[10px]">
                  docs/reference/integrations/teltonika-rut.md
                </code>
                <span className="ml-2 italic text-ink-400">
                  full reference with curl examples, deployment topology diagrams, security checklist
                </span>
              </li>
            </ul>
          </TechSection>
        </div>
      </PageShell>
    </>
  );
}
