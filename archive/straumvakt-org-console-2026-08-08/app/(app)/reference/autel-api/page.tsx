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
  AC_MODELS,
  DC_MODELS,
  CLOUD_SURFACES,
  REST_API_FACTS,
  OCPP_FACTS,
  OCPP_QUIRKS,
  ONBOARD_STEPS,
  END_USER_AUTH,
  LOCAL_INTERFACE,
  OCMF_FACTS,
  PRICING_FACTS,
  ADAPTER_STATUS,
} from "@/lib/reference/autel-info";
import { adminSessionConfig, verifyAdminSession } from "@/lib/admin-session";

export const metadata = { title: "Autel Energy API" };

export default async function AutelApiPage() {
  const jar = await cookies();
  const token = jar.get(adminSessionConfig.SESSION_COOKIE_NAME)?.value;
  const session = await verifyAdminSession(token);
  const email = session?.email;

  return (
    <>
      <Topbar title="Reference · API · Autel Energy" email={email} />
      <PageShell
        title="Autel Energy API & OCPP"
        description="Field-by-field reference of Autel Energy integration. Full ladder vendor — residential AC up to 480 kW DC HiPower. Strong formal-cert story (DNV OCPP 2.0.1 cert on DH480, Hubject Plug & Charge), no public REST API. See docs/reference/integrations/autel.md for the full doc."
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
                {" + "}
                <code className="font-mono text-[10px] text-ink-400">charger_dc</code>
              </p>
              <p className="text-[10px] text-ink-500 text-center max-w-md leading-tight">
                Full ladder — residential AC, commercial AC, DC fast, DC HiPower (480 kW per
                dispenser, 640 kW system).
              </p>
            </div>
            <div className="h-px flex-1 bg-bg-border/50" />
          </div>

          {/* Vendor identity */}
          <TechSection title="Vendor" source="api" hint="autelenergy.com">
            <dl>
              {VENDOR_INFO.map((v) => (
                <InfoRow key={v.label} label={v.label} info={v.info} />
              ))}
            </dl>
          </TechSection>

          {/* AC models */}
          <TechSection
            title="AC models in scope"
            source="none"
            hint={`${AC_MODELS.length} AC SKUs`}
          >
            <div className="overflow-hidden rounded-md border border-bg-border/70">
              <table className="w-full text-[11px]">
                <thead className="bg-bg-inset/40 text-left text-[10px] uppercase tracking-brand text-ink-500">
                  <tr>
                    <th className="px-3 py-1.5 font-medium">Model</th>
                    <th className="px-3 py-1.5 font-medium w-16">Region</th>
                    <th className="px-3 py-1.5 font-medium w-24">Power</th>
                    <th className="px-3 py-1.5 font-medium w-32">OCPP</th>
                    <th className="px-3 py-1.5 font-medium w-28 text-center">MID</th>
                    <th className="px-3 py-1.5 font-medium w-20 text-center">PnC</th>
                    <th className="px-3 py-1.5 font-medium">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-bg-border/40">
                  {AC_MODELS.map((m) => (
                    <tr key={m.model} className="hover:bg-bg-raised/30">
                      <td className="px-3 py-1.5 font-mono text-ink-200">{m.model}</td>
                      <td className="px-3 py-1.5 text-ink-300">{m.region}</td>
                      <td className="px-3 py-1.5 text-[10px] text-ink-300">{m.power}</td>
                      <td className="px-3 py-1.5 text-[10px] text-ink-300">{m.ocpp}</td>
                      <td className="px-3 py-1.5 text-center text-[10px] text-ink-400">{m.mid}</td>
                      <td className="px-3 py-1.5 text-center text-[10px] text-ink-400">{m.pnc}</td>
                      <td className="px-3 py-1.5 italic text-ink-300">{m.info}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </TechSection>

          {/* DC models */}
          <TechSection
            title="DC models in scope"
            source="none"
            hint={`${DC_MODELS.length} DC SKUs · DH480 has DNV OCPP 2.0.1 cert`}
          >
            <div className="overflow-hidden rounded-md border border-bg-border/70">
              <table className="w-full text-[11px]">
                <thead className="bg-bg-inset/40 text-left text-[10px] uppercase tracking-brand text-ink-500">
                  <tr>
                    <th className="px-3 py-1.5 font-medium">Model</th>
                    <th className="px-3 py-1.5 font-medium w-44">Power</th>
                    <th className="px-3 py-1.5 font-medium">Connectors</th>
                    <th className="px-3 py-1.5 font-medium">OCPP</th>
                    <th className="px-3 py-1.5 font-medium">PnC</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-bg-border/40">
                  {DC_MODELS.map((m) => (
                    <tr key={m.model} className="hover:bg-bg-raised/30">
                      <td className="px-3 py-1.5 font-mono text-ink-200">{m.model}</td>
                      <td className="px-3 py-1.5 text-[10px] text-ink-300">{m.power}</td>
                      <td className="px-3 py-1.5 text-[10px] text-ink-300">{m.connectors}</td>
                      <td className="px-3 py-1.5 text-[10px] text-ink-300">{m.ocpp}</td>
                      <td className="px-3 py-1.5 italic text-ink-300">{m.pnc}</td>
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
            hint={`${CLOUD_SURFACES.length} surfaces · regional eucloud / uscloud`}
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
                REST API — partner-gated, no public docs
              </p>
              <p className="text-[10px] text-ink-500 text-center max-w-md leading-tight">
                Plan integration as OCPP-direct, not via Autel cloud REST. Use Hubject for OCPI roaming.
              </p>
            </div>
            <div className="h-px flex-1 bg-bg-border/50" />
          </div>

          <TechSection
            title="REST API — what's known"
            source="api"
            hint="No public Swagger / OpenAPI"
          >
            <dl>
              {REST_API_FACTS.map((r) => (
                <InfoRow key={r.label} label={r.label} info={r.info} />
              ))}
            </dl>
          </TechSection>

          {/* Section divider — OCPP */}
          <div className="mt-4 flex items-center gap-3">
            <div className="h-px flex-1 bg-bg-border/50" />
            <div className="flex flex-col items-center gap-1 px-3">
              <SourceBadge source="ocpp" />
              <p className="text-[11px] text-ink-300 text-center max-w-md">
                OCPP 1.6J line-wide · 2.0.1 cert on DH480 + CSMS
              </p>
              <p className="text-[10px] text-ink-500 text-center max-w-md leading-tight">
                Backend URL is configurable, but ONLY via the Autel Config app over BLE proximity.
                There is no remote OCPP-URL takeover path.
              </p>
            </div>
            <div className="h-px flex-1 bg-bg-border/50" />
          </div>

          <TechSection
            title="OCPP support"
            source="ocpp"
            hint="DNV cert OCA.0201.0069.CS · BLE-only URL change"
          >
            <dl>
              {OCPP_FACTS.map((o) => (
                <InfoRow key={o.label} label={o.label} info={o.info} />
              ))}
            </dl>
          </TechSection>

          <TechSection
            title="OCPP integration quirks"
            source="ocpp"
            hint={`${OCPP_QUIRKS.length} quirks · sourced from lbbrhzn/ocpp + evcc`}
          >
            <dl>
              {OCPP_QUIRKS.map((q) => (
                <InfoRow key={q.quirk} label={q.quirk} info={q.info} />
              ))}
            </dl>
          </TechSection>

          {/* Onboarding */}
          <TechSection
            title="Onboarding to Straumvakt — BLE-on-site only"
            source="ocpp"
            hint={`${ONBOARD_STEPS.length} steps · field installer required`}
          >
            <p className="mb-3 text-[11px] text-ink-400">
              Plan a non-zero installer cost into every Autel onboarding quote — there is no remote
              takeover path. Field installer must be on-site with a phone running Autel Config.
              Once moved off Autel Charge Cloud, the end-user Autel Charge app stops working for
              that unit.
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
            hint={`${END_USER_AUTH.length} modes · Hubject PnC ecosystem`}
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
            hint="DC line has Modbus TCP/RTU · AC line BLE-only"
          >
            <dl>
              {LOCAL_INTERFACE.map((l) => (
                <InfoRow key={l.interfaceLabel} label={l.interfaceLabel} info={l.info} />
              ))}
            </dl>
          </TechSection>

          {/* OCMF / Eichrecht */}
          <TechSection
            title="OCMF / Eichrecht"
            source="ocpp"
            hint="No public Eichrecht claim — confirm per-SKU before DE/AT resale"
          >
            <dl>
              {OCMF_FACTS.map((o) => (
                <InfoRow key={o.label} label={o.label} info={o.info} />
              ))}
            </dl>
          </TechSection>

          {/* Pricing / commercial */}
          <TechSection
            title="Pricing / commercial"
            source="none"
            hint={`${PRICING_FACTS.length} facts`}
          >
            <dl>
              {PRICING_FACTS.map((p) => (
                <InfoRow key={p.aspect} label={p.aspect} info={p.info} />
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
                <a href="/reference/alfen-api" className="text-sv-green hover:text-sv-sky">
                  Reference · API · Alfen
                </a>
                <span className="ml-2 italic text-ink-400">
                  sister AC vendor that is also OCPP-primary
                </span>
              </li>
              <li>
                <code className="rounded bg-bg-base/60 px-1.5 py-0.5 font-mono text-[10px]">
                  docs/reference/integrations/autel.md
                </code>
                <span className="ml-2 italic text-ink-400">
                  full reference with onboarding playbook, OCPP cert details, security history
                </span>
              </li>
              <li>
                <code className="rounded bg-bg-base/60 px-1.5 py-0.5 font-mono text-[10px]">
                  docs/reference/integrations/ocpp-1.6j.md
                </code>
                <span className="ml-2 italic text-ink-400">
                  shared OCPP 1.6J protocol — applies line-wide
                </span>
              </li>
            </ul>
          </TechSection>
        </div>
      </PageShell>
    </>
  );
}
