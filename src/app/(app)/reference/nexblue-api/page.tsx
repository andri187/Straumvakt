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
  MODELS,
  CLOUD_SURFACES,
  REST_API_FACTS,
  REST_API_ENDPOINTS,
  REST_API_GAPS,
  OCPP_FACTS,
  ONBOARD_STEPS,
  END_USER_AUTH,
  LOCAL_INTERFACE,
  ADAPTER_STATUS,
} from "@/lib/reference/nexblue-info";
import { adminSessionConfig, verifyAdminSession } from "@/lib/admin-session";

export const metadata = { title: "NexBlue API" };

function methodPill(method: string): string {
  switch (method) {
    case "GET":
      return "bg-emerald-950/40 text-emerald-300";
    case "POST":
      return "bg-sky-950/40 text-sky-300";
    case "PUT":
      return "bg-violet-950/40 text-violet-300";
    case "DELETE":
      return "bg-rose-950/40 text-rose-300";
    default:
      return "bg-amber-950/40 text-amber-300";
  }
}

export default async function NexblueApiPage() {
  const jar = await cookies();
  const token = jar.get(adminSessionConfig.SESSION_COOKIE_NAME)?.value;
  const session = await verifyAdminSession(token);
  const email = session?.email;

  return (
    <>
      <Topbar title="Reference · API · NexBlue" email={email} />
      <PageShell
        title="NexBlue API & OCPP"
        description="Field-by-field reference of NexBlue integration. Nordic + UK AC vendor with a public OpenAPI 3.0.2 at prod-management.nexblue.com/swagger; OCPP-primary for live state. See docs/reference/integrations/nexblue.md for the full doc."
      >
        <SectionTabs tabs={REFERENCE_TABS} />

        <div className="grid gap-4">
          {/* Adapter status banner */}
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
              <span className="inline-flex items-center gap-1 rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-brand text-emerald-300 ring-1 ring-inset ring-emerald-500/30">
                Hardware / Chargers
              </span>
              <p className="text-[11px] text-ink-300 text-center max-w-md">
                <code className="font-mono text-[10px] text-ink-400">HardwareVendorKind = charger_ac</code>
                {" · "}
                <code className="font-mono text-[10px] text-ink-400">SiteAssetKind = charger</code>
              </p>
              <p className="text-[10px] text-ink-500 text-center max-w-md leading-tight">
                Type 2 AC only — no DC/CCS chargers in the lineup. Extends{" "}
                <code className="font-mono text-[10px] text-ink-400">assets.site_assets</code> via{" "}
                <code className="font-mono text-[10px] text-ink-400">assets.chargers</code>.
              </p>
            </div>
            <div className="h-px flex-1 bg-bg-border/50" />
          </div>

          {/* Vendor identity */}
          <TechSection title="Vendor" source="api" hint="nexblue.com">
            <dl>
              {VENDOR_INFO.map((v) => (
                <InfoRow key={v.label} label={v.label} info={v.info} />
              ))}
            </dl>
          </TechSection>

          {/* Models */}
          <TechSection
            title="Models in scope"
            source="none"
            hint={`${MODELS.length} models · all Type 2 AC`}
          >
            <div className="overflow-hidden rounded-md border border-bg-border/70">
              <table className="w-full text-[11px]">
                <thead className="bg-bg-inset/40 text-left text-[10px] uppercase tracking-brand text-ink-500">
                  <tr>
                    <th className="px-3 py-1.5 font-medium">Model</th>
                    <th className="px-3 py-1.5 font-medium w-32">Phase / Power</th>
                    <th className="px-3 py-1.5 font-medium w-20 text-center">MID</th>
                    <th className="px-3 py-1.5 font-medium w-20 text-center">OCMF</th>
                    <th className="px-3 py-1.5 font-medium w-32 text-center">ISO 15118</th>
                    <th className="px-3 py-1.5 font-medium">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-bg-border/40">
                  {MODELS.map((m) => (
                    <tr key={m.model} className="hover:bg-bg-raised/30">
                      <td className="px-3 py-1.5 font-mono text-ink-200">{m.model}</td>
                      <td className="px-3 py-1.5 text-ink-300">{m.phase}</td>
                      <td className="px-3 py-1.5 text-center text-[10px] text-ink-400">{m.mid}</td>
                      <td className="px-3 py-1.5 text-center text-[10px] text-ink-400">{m.ocmf}</td>
                      <td className="px-3 py-1.5 text-center text-[10px] text-ink-400">{m.iso15118}</td>
                      <td className="px-3 py-1.5 italic text-ink-300">{m.info}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </TechSection>

          {/* Cloud surfaces */}
          <TechSection
            title="Cloud surfaces"
            source="api"
            hint={`${CLOUD_SURFACES.length} surfaces · partner.nexblue.com`}
          >
            <dl>
              {CLOUD_SURFACES.map((c) => (
                <InfoRow key={c.surface} label={c.surface} info={c.info} />
              ))}
            </dl>
          </TechSection>

          {/* Section divider — REST API */}
          <div className="mt-4 flex items-center gap-3">
            <div className="h-px flex-1 bg-bg-border/50" />
            <div className="flex flex-col items-center gap-1 px-3">
              <SourceBadge source="api" />
              <p className="text-[11px] text-ink-300 text-center max-w-md">
                REST API — public OpenAPI 3.0.2
              </p>
              <p className="text-[10px] text-ink-500 text-center max-w-md leading-tight">
                Live Swagger at{" "}
                <code className="font-mono text-[10px]">
                  prod-management.nexblue.com/swagger/dist
                </code>
                . Snapshot in{" "}
                <code className="font-mono text-[10px]">
                  docs/reference/integrations/nexblue-openapi.json
                </code>
                .
              </p>
            </div>
            <div className="h-px flex-1 bg-bg-border/50" />
          </div>

          <TechSection
            title="REST API — facts"
            source="api"
            hint="api.nexblue.com/third_party · OAuth2 + apiKey"
          >
            <dl>
              {REST_API_FACTS.map((r) => (
                <InfoRow key={r.label} label={r.label} info={r.info} />
              ))}
            </dl>
          </TechSection>

          <TechSection
            title="REST API endpoints"
            source="api"
            hint={`${REST_API_ENDPOINTS.length} endpoints · /openapi/...`}
          >
            <p className="mb-3 text-[11px] text-ink-400">
              Two auth flows: OAuth2 authorization-code (no PKCE) for partner integrations, or{" "}
              <code className="font-mono text-[10px]">POST /openapi/account/login</code> with{" "}
              <code className="font-mono text-[10px]">account_type=1</code> (installer) for ad-hoc
              tenant onboarding. Both return the same{" "}
              <code className="font-mono text-[10px]">OAuthTokenRes</code>.
            </p>
            <div className="overflow-hidden rounded-md border border-bg-border/70">
              <table className="w-full text-[11px]">
                <thead className="bg-bg-inset/40 text-left text-[10px] uppercase tracking-brand text-ink-500">
                  <tr>
                    <th className="px-3 py-1.5 font-medium w-16">Method</th>
                    <th className="px-3 py-1.5 font-medium">Path</th>
                    <th className="px-3 py-1.5 font-medium w-32">Tag</th>
                    <th className="px-3 py-1.5 font-medium">What it does</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-bg-border/40">
                  {REST_API_ENDPOINTS.map((e, i) => (
                    <tr key={i} className="hover:bg-bg-raised/30">
                      <td className="whitespace-nowrap px-3 py-1.5">
                        <span
                          className={
                            "inline-flex w-14 justify-center rounded font-mono text-[10px] " +
                            methodPill(e.method)
                          }
                        >
                          {e.method}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-1.5 font-mono text-ink-200">
                        {e.path}
                      </td>
                      <td className="px-3 py-1.5 text-[10px] uppercase tracking-brand text-ink-500">
                        {e.tag}
                      </td>
                      <td className="px-3 py-1.5 italic text-ink-300">{e.info}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </TechSection>

          <TechSection
            title="REST API gaps — relative to a partner-CPMS shape"
            source="api"
            hint={`${REST_API_GAPS.length} missing · own these in Straumvakt`}
          >
            <p className="mb-3 text-[11px] text-ink-400">
              The public OpenAPI is shaped for end-user / installer / owner principals — not for a
              partner CPMS. The capabilities below are not exposed and have to be owned by
              Straumvakt or driven through the Partner App.
            </p>
            <dl>
              {REST_API_GAPS.map((g) => (
                <InfoRow key={g.missing} label={g.missing} info={g.info} />
              ))}
            </dl>
          </TechSection>

          {/* Section divider — OCPP */}
          <div className="mt-4 flex items-center gap-3">
            <div className="h-px flex-1 bg-bg-border/50" />
            <div className="flex flex-col items-center gap-1 px-3">
              <SourceBadge source="ocpp" />
              <p className="text-[11px] text-ink-300 text-center max-w-md">
                OCPP 1.6J + 2.0.1 — primary integration path
              </p>
              <p className="text-[10px] text-ink-500 text-center max-w-md leading-tight">
                "Local OCPP" — client runs on charger, no NexBlue gateway in path. Backend URL is
                configurable OTA via the myNexBlue or Partner App.
              </p>
            </div>
            <div className="h-px flex-1 bg-bg-border/50" />
          </div>

          <TechSection
            title="OCPP support"
            source="ocpp"
            hint="1.6J + 2.0.1 · firmware ≥ 1.1.2"
          >
            <dl>
              {OCPP_FACTS.map((o) => (
                <InfoRow key={o.label} label={o.label} info={o.info} />
              ))}
            </dl>
          </TechSection>

          {/* Onboarding */}
          <TechSection
            title="Onboarding — two-step (commission on-site, then OTA OCPP flip)"
            source="ocpp"
            hint={`${ONBOARD_STEPS.length} steps · OTA after commissioning`}
          >
            <p className="mb-3 text-[11px] text-ink-400">
              Step 1 happens on-site once (BLE/Wi-Fi commissioning by trained installer). Step 2 is
              OTA — the customer self-serves the OCPP-URL flip from their phone, no electrician
              revisit.
            </p>
            <dl>
              {ONBOARD_STEPS.map((s) => (
                <InfoRow key={s.step} label={s.step} info={s.info} />
              ))}
            </dl>
          </TechSection>

          {/* End-user auth */}
          <TechSection
            title="End-user authentication at the charger"
            source="ocpp"
            hint={`${END_USER_AUTH.length} modes`}
          >
            <dl>
              {END_USER_AUTH.map((a) => (
                <InfoRow key={a.mode} label={a.mode} info={a.info} />
              ))}
            </dl>
          </TechSection>

          {/* Local interface */}
          <TechSection
            title="Local interface"
            source="api"
            hint="Modbus unverified · CT clamp + P1 are the EMS path"
          >
            <dl>
              {LOCAL_INTERFACE.map((l) => (
                <InfoRow key={l.interfaceLabel} label={l.interfaceLabel} info={l.info} />
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
                  primary AC vendor with full Cloud API + live integration
                </span>
              </li>
              <li>
                <a href="/reference/easee-api" className="text-sv-green hover:text-sv-sky">
                  Reference · API · Easee
                </a>
                <span className="ml-2 italic text-ink-400">sibling AC vendor with REST API + SignalR push</span>
              </li>
              <li>
                <a href="/reference/alfen-api" className="text-sv-green hover:text-sv-sky">
                  Reference · API · Alfen
                </a>
                <span className="ml-2 italic text-ink-400">
                  also OCPP-primary, but lacks NexBlue's remote OCPP-URL channel
                </span>
              </li>
              <li>
                <a href="/reference/chargeamps-api" className="text-sv-green hover:text-sv-sky">
                  Reference · API · Charge Amps
                </a>
                <span className="ml-2 italic text-ink-400">
                  Nordic peer with the cleanest OTA OCPP-URL flow + a documented EAPI
                </span>
              </li>
              <li>
                <code className="rounded bg-bg-base/60 px-1.5 py-0.5 font-mono text-[10px]">
                  docs/reference/integrations/nexblue.md
                </code>
                <span className="ml-2 italic text-ink-400">
                  full reference with onboarding playbook, OCPP firmware floors, sources
                </span>
              </li>
              <li>
                <code className="rounded bg-bg-base/60 px-1.5 py-0.5 font-mono text-[10px]">
                  docs/reference/integrations/ocpp-1.6j.md
                </code>
                <span className="ml-2 italic text-ink-400">
                  shared OCPP 1.6J protocol — applies to every AC vendor in this catalogue
                </span>
              </li>
            </ul>
          </TechSection>
        </div>
      </PageShell>
    </>
  );
}
