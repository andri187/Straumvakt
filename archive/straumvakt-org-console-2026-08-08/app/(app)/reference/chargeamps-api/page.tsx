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
  EAPI_FACTS,
  EAPI_ENDPOINTS,
  OCPP_FACTS,
  ONBOARD_STEPS,
  END_USER_AUTH,
  LOCAL_INTERFACE,
  OCMF_FACTS,
  QUIRKS,
  ADAPTER_STATUS,
} from "@/lib/reference/chargeamps-info";
import { adminSessionConfig, verifyAdminSession } from "@/lib/admin-session";

export const metadata = { title: "Charge Amps API" };

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

export default async function ChargeAmpsApiPage() {
  const jar = await cookies();
  const token = jar.get(adminSessionConfig.SESSION_COOKIE_NAME)?.value;
  const session = await verifyAdminSession(token);
  const email = session?.email;

  return (
    <>
      <Topbar title="Reference · API · Charge Amps" email={email} />
      <PageShell
        title="Charge Amps API & OCPP"
        description="Field-by-field reference of Charge Amps integration. Swedish AC vendor; the easiest of the Nordic AC vendors to onboard — public-Swagger EAPI + partner portal flips OCPP URL OTA. See docs/reference/integrations/chargeamps.md for the full doc."
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
                Type 2 AC only — no DC product line. Halo has a Schuko aux outlet but it's not
                exposed as a separate OCPP connector.
              </p>
            </div>
            <div className="h-px flex-1 bg-bg-border/50" />
          </div>

          {/* Vendor identity */}
          <TechSection title="Vendor" source="api" hint="chargeamps.com">
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
                    <th className="px-3 py-1.5 font-medium w-44">Power</th>
                    <th className="px-3 py-1.5 font-medium">Connector</th>
                    <th className="px-3 py-1.5 font-medium w-28 text-center">MID</th>
                    <th className="px-3 py-1.5 font-medium w-32 text-center">RCD</th>
                    <th className="px-3 py-1.5 font-medium">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-bg-border/40">
                  {MODELS.map((m) => (
                    <tr key={m.model} className="hover:bg-bg-raised/30">
                      <td className="px-3 py-1.5 font-mono text-ink-200">{m.model}</td>
                      <td className="px-3 py-1.5 text-[10px] text-ink-300">{m.power}</td>
                      <td className="px-3 py-1.5 text-[10px] text-ink-300">{m.connector}</td>
                      <td className="px-3 py-1.5 text-center text-[10px] text-ink-400">{m.mid}</td>
                      <td className="px-3 py-1.5 text-center text-[10px] text-ink-400">{m.rcd}</td>
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
            hint={`${CLOUD_SURFACES.length} surfaces · my.charge.space`}
          >
            <dl>
              {CLOUD_SURFACES.map((c) => (
                <InfoRow key={c.surface} label={c.surface} info={c.info} />
              ))}
            </dl>
          </TechSection>

          {/* Section divider — REST EAPI */}
          <div className="mt-4 flex items-center gap-3">
            <div className="h-px flex-1 bg-bg-border/50" />
            <div className="flex flex-col items-center gap-1 px-3">
              <SourceBadge source="api" />
              <p className="text-[11px] text-ink-300 text-center max-w-md">
                EAPI — public Swagger, partner-issued apiKey
              </p>
              <p className="text-[10px] text-ink-500 text-center max-w-md leading-tight">
                Use as a side-channel for fleet metadata, historical sessions, remote start/stop
                fallback. <strong className="text-yellow-200">No realtime push</strong> — use OCPP
                for live state.
              </p>
            </div>
            <div className="h-px flex-1 bg-bg-border/50" />
          </div>

          <TechSection
            title="EAPI — facts"
            source="api"
            hint="eapi.charge.space/swagger · JWT 120 min"
          >
            <dl>
              {EAPI_FACTS.map((e) => (
                <InfoRow key={e.label} label={e.label} info={e.info} />
              ))}
            </dl>
          </TechSection>

          <TechSection
            title="EAPI v5 endpoints"
            source="api"
            hint={`${EAPI_ENDPOINTS.length} endpoints · /api/v5/...`}
          >
            <p className="mb-3 text-[11px] text-ink-400">
              Auth flow: send <code className="font-mono text-[10px]">apiKey</code> as a header on
              every call (including login). Login returns a JWT + refreshToken. Use{" "}
              <code className="font-mono text-[10px]">Authorization: Bearer …</code> on subsequent
              calls. On <code className="font-mono text-[10px]">401</code>, full re-login (not just
              refresh).
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
                  {EAPI_ENDPOINTS.map((e, i) => (
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

          {/* Section divider — OCPP */}
          <div className="mt-4 flex items-center gap-3">
            <div className="h-px flex-1 bg-bg-border/50" />
            <div className="flex flex-col items-center gap-1 px-3">
              <SourceBadge source="ocpp" />
              <p className="text-[11px] text-ink-300 text-center max-w-md">
                OCPP 1.6J — primary realtime path
              </p>
              <p className="text-[10px] text-ink-500 text-center max-w-md leading-tight">
                Backend URL flippable OTA from the partner portal. CAPI ↔ OCPP are mutually
                exclusive — moving to Straumvakt drops the Charge Amps app's live-control features.
              </p>
            </div>
            <div className="h-px flex-1 bg-bg-border/50" />
          </div>

          <TechSection
            title="OCPP support"
            source="ocpp"
            hint="1.6J only · firmware ≥ 158 · Halo fw184+"
          >
            <dl>
              {OCPP_FACTS.map((o) => (
                <InfoRow key={o.label} label={o.label} info={o.info} />
              ))}
            </dl>
          </TechSection>

          {/* Onboarding */}
          <TechSection
            title="Onboarding — partner cloud → Straumvakt (zero-touch OTA)"
            source="ocpp"
            hint={`${ONBOARD_STEPS.length} steps · no on-site visit required`}
          >
            <p className="mb-3 text-[11px] text-ink-400">
              The partner portal at <code className="font-mono text-[10px]">my.charge.space/partner/</code>{" "}
              flips the charger's OCPP URL <strong>OTA</strong>. Closer to Zaptec's "claim it in
              Zaptec Portal" model than Easee's per-device dance.
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
            hint={`${END_USER_AUTH.length} modes · MIFARE Type A 13.56 MHz`}
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
            hint="Wi-Fi hotspot at 192.168.250.1 · no public Modbus map"
          >
            <dl>
              {LOCAL_INTERFACE.map((l) => (
                <InfoRow key={l.interfaceLabel} label={l.interfaceLabel} info={l.info} />
              ))}
            </dl>
          </TechSection>

          {/* OCMF / Eichrecht */}
          <TechSection
            title="OCMF / Eichrecht — by model"
            source="ocpp"
            hint="Standard line is MID; Dawn Professional DE is Eichrecht-certified"
          >
            <div className="overflow-hidden rounded-md border border-bg-border/70">
              <table className="w-full text-[11px]">
                <thead className="bg-bg-inset/40 text-left text-[10px] uppercase tracking-brand text-ink-500">
                  <tr>
                    <th className="px-3 py-1.5 font-medium">Model</th>
                    <th className="px-3 py-1.5 font-medium">MID</th>
                    <th className="px-3 py-1.5 font-medium">OCMF / Eichrecht</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-bg-border/40">
                  {OCMF_FACTS.map((o) => (
                    <tr key={o.model} className="hover:bg-bg-raised/30">
                      <td className="px-3 py-1.5 font-mono text-ink-200">{o.model}</td>
                      <td className="px-3 py-1.5 italic text-ink-300">{o.mid}</td>
                      <td className="px-3 py-1.5 italic text-ink-300">{o.ocmf}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </TechSection>

          {/* Quirks / known issues */}
          <TechSection
            title="Quirks / known issues"
            source="both"
            hint={`${QUIRKS.length} items · capture on first probe`}
          >
            <dl>
              {QUIRKS.map((q) => (
                <InfoRow key={q.quirk} label={q.quirk} info={q.info} />
              ))}
            </dl>
          </TechSection>

          {/* Cross-link */}
          <TechSection title="See also" source="none">
            <ul className="space-y-1.5 text-xs">
              <li>
                <a href="/reference/easee-api" className="text-sv-green hover:text-sv-sky">
                  Reference · API · Easee
                </a>
                <span className="ml-2 italic text-ink-400">
                  Nordic peer with REST API + SignalR push (the realtime channel Charge Amps lacks)
                </span>
              </li>
              <li>
                <a href="/reference/zaptec-api" className="text-sv-green hover:text-sv-sky">
                  Reference · API · Zaptec
                </a>
                <span className="ml-2 italic text-ink-400">
                  primary AC vendor with full Cloud API + live integration
                </span>
              </li>
              <li>
                <a href="/reference/nexblue-api" className="text-sv-green hover:text-sv-sky">
                  Reference · API · NexBlue
                </a>
                <span className="ml-2 italic text-ink-400">
                  Nordic peer with similar OTA OCPP-URL channel; REST API undocumented
                </span>
              </li>
              <li>
                <code className="rounded bg-bg-base/60 px-1.5 py-0.5 font-mono text-[10px]">
                  docs/reference/integrations/chargeamps.md
                </code>
                <span className="ml-2 italic text-ink-400">
                  full reference with EAPI shape, onboarding playbook, quirks
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
