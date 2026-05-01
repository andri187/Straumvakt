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
  ONBOARD_SCENARIOS,
  PATH_A_STEPS,
  PATH_B_OCPP_CALLS,
  VERIFY_CHECKLIST,
  VENDOR_INFO,
  INTEGRATION_PATHS,
  OCPP_CONFIG_KEYS,
  MODBUS_INFO,
  ADAPTER_STATUS,
} from "@/lib/reference/alfen-info";
import { adminSessionConfig, verifyAdminSession } from "@/lib/admin-session";

export const metadata = { title: "Alfen API" };

export default async function AlfenApiPage() {
  const jar = await cookies();
  const token = jar.get(adminSessionConfig.SESSION_COOKIE_NAME)?.value;
  const session = await verifyAdminSession(token);
  const email = session?.email;

  return (
    <>
      <Topbar title="Reference · API · Alfen" email={email} />
      <PageShell
        title="Alfen API & OCPP"
        description="Field-by-field reference of Alfen integration. Onboarding leads — Alfen has no public Cloud API and onboarding decisions are made before any code runs. See docs/reference/integrations/alfen.md for the full doc."
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

          {/* ───── ONBOARDING SECTION (leads — Alfen-specific structural choice) ───── */}

          <div className="mt-2 flex items-center gap-3">
            <div className="h-px flex-1 bg-bg-border/50" />
            <div className="flex flex-col items-center gap-1 px-3">
              <span className="inline-flex items-center gap-1 rounded bg-yellow-500/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-brand text-yellow-300 ring-1 ring-inset ring-yellow-500/30">
                Onboarding-first
              </span>
              <p className="text-[11px] text-ink-300 text-center max-w-md">
                Read this section before anything else
              </p>
              <p className="text-[10px] text-ink-500 text-center max-w-md leading-tight">
                Unlike Zaptec / Easee, Alfen onboarding has hard structural constraints — no
                manufacturer-cloud channel exists for remote URL changes.
              </p>
            </div>
            <div className="h-px flex-1 bg-bg-border/50" />
          </div>

          {/* Onboarding decision matrix */}
          <TechSection
            title="Onboarding decision matrix"
            source="ocpp"
            hint={`${ONBOARD_SCENARIOS.length} scenarios · choose path before any code runs`}
          >
            <p className="mb-3 text-[11px] text-ink-400">
              First decision point of every Alfen sales motion. OTA-by-default like Zaptec /
              Easee is <strong className="text-yellow-200">not</strong> available — paths
              depend on prior state and access.
            </p>
            <div className="overflow-hidden rounded-md border border-bg-border/70">
              <table className="w-full text-[11px]">
                <thead className="bg-bg-inset/40 text-left text-[10px] uppercase tracking-brand text-ink-500">
                  <tr>
                    <th className="px-3 py-1.5 font-medium">Scenario</th>
                    <th className="px-3 py-1.5 font-medium w-20 text-center">OTA?</th>
                    <th className="px-3 py-1.5 font-medium">Path</th>
                    <th className="px-3 py-1.5 font-medium w-32">Lead time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-bg-border/40">
                  {ONBOARD_SCENARIOS.map((s) => (
                    <tr key={s.scenario} className="hover:bg-bg-raised/30">
                      <td className="px-3 py-1.5 text-ink-200">{s.scenario}</td>
                      <td className="px-3 py-1.5 text-center">
                        {s.ota === "yes" ? (
                          <span className="text-sv-green">✓</span>
                        ) : s.ota === "no" ? (
                          <span className="text-red-300">✗</span>
                        ) : (
                          <span className="text-yellow-300">~</span>
                        )}
                      </td>
                      <td className="px-3 py-1.5 italic text-ink-300">{s.path}</td>
                      <td className="px-3 py-1.5 text-[10px] text-ink-400">{s.leadTime}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </TechSection>

          {/* Path A — on-site / VPN */}
          <TechSection
            title="Cutover playbook · Path A — ACE Service Installer"
            source="api"
            hint="On-site or VPN to charger LAN"
          >
            <p className="mb-3 text-[11px] text-ink-400">
              Most reliable path. Requires LAN access (physical or VPN) and the installer
              password. ACE Service Installer is Windows-only.
            </p>
            <dl>
              {PATH_A_STEPS.map((s) => (
                <InfoRow key={s.step} label={s.step} info={s.info} />
              ))}
            </dl>
          </TechSection>

          {/* Path B — outgoing operator cooperates */}
          <TechSection
            title="Cutover playbook · Path B — outgoing operator cooperates (OTA)"
            source="ocpp"
            hint="Send these four OCPP calls to the outgoing CPO"
          >
            <p className="mb-3 text-[11px] text-ink-400">
              When the outgoing CPO cooperates per their contract, send this scripted sequence
              — zero on-site work required.
            </p>
            <div className="overflow-hidden rounded-md border border-bg-border/70">
              <table className="w-full text-[11px]">
                <thead className="bg-bg-inset/40 text-left text-[10px] uppercase tracking-brand text-ink-500">
                  <tr>
                    <th className="px-3 py-1.5 font-medium w-44">OCPP message</th>
                    <th className="px-3 py-1.5 font-medium">Payload</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-bg-border/40">
                  {PATH_B_OCPP_CALLS.map((c, i) => (
                    <tr key={i} className="hover:bg-bg-raised/30">
                      <td className="px-3 py-1.5 font-mono text-sv-sky">{c.message}</td>
                      <td className="px-3 py-1.5 font-mono text-[10px] text-ink-200">
                        {c.payload}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </TechSection>

          {/* Verification checklist */}
          <TechSection
            title="Verification checklist"
            source="ocpp"
            hint="Run after every cutover before declaring done"
          >
            <dl>
              {VERIFY_CHECKLIST.map((v) => (
                <InfoRow key={v.check} label={v.check} info={v.info} />
              ))}
            </dl>
          </TechSection>

          {/* ───── REST / VENDOR PROFILE SECTION ───── */}

          <div className="mt-4 flex items-center gap-3">
            <div className="h-px flex-1 bg-bg-border/50" />
            <div className="flex flex-col items-center gap-1 px-3">
              <SourceBadge source="api" />
              <p className="text-[11px] text-ink-300 text-center max-w-md">
                Vendor profile · integration paths
              </p>
              <p className="text-[10px] text-ink-500 text-center max-w-md leading-tight">
                Documentation view — every row below describes what the field means.
              </p>
            </div>
            <div className="h-px flex-1 bg-bg-border/50" />
          </div>

          {/* Vendor identity */}
          <TechSection title="Vendor" source="api" hint="alfen.com">
            <dl>
              {VENDOR_INFO.map((v) => (
                <InfoRow key={v.label} label={v.label} info={v.info} />
              ))}
            </dl>
          </TechSection>

          {/* Integration paths */}
          <TechSection
            title="Integration paths"
            source="api"
            hint="OCPP-primary; Modbus + ICU Connect alternatives"
          >
            <dl>
              {INTEGRATION_PATHS.map((p) => (
                <InfoRow key={p.path} label={p.path} info={p.info} />
              ))}
            </dl>
          </TechSection>

          {/* ───── OCPP SECTION ───── */}

          <div className="mt-4 flex items-center gap-3">
            <div className="h-px flex-1 bg-bg-border/50" />
            <div className="flex flex-col items-center gap-1 px-3">
              <SourceBadge source="ocpp" />
              <p className="text-[11px] text-ink-300 text-center max-w-md">
                OCPP 1.6J / 2.0.1 · Alfen implementation
              </p>
              <p className="text-[10px] text-ink-500 text-center max-w-md leading-tight">
                Alfen-specific writable config keys. Standard OCPP 1.6 keys are also supported —
                see docs/reference/integrations/ocpp-1.6j.md for the shared vocabulary.
              </p>
            </div>
            <div className="h-px flex-1 bg-bg-border/50" />
          </div>

          {/* OCPP config keys */}
          <TechSection
            title="OCPP configuration keys (Alfen-specific)"
            source="ocpp"
            hint={`${OCPP_CONFIG_KEYS.length} keys · GetConfiguration / ChangeConfiguration`}
          >
            <p className="mb-3 text-[11px] text-ink-400">
              Beyond the OCPP 1.6 Appendix B standard keys, Alfen exposes these vendor
              extensions. Full list of standard + vendor keys lives in the{" "}
              <em>ACE NG9 Backoffice Configuration Keys</em> PDF on knowledge.alfen.com.
            </p>
            <div className="overflow-hidden rounded-md border border-bg-border/70">
              <table className="w-full text-[11px]">
                <thead className="bg-bg-inset/40 text-left text-[10px] uppercase tracking-brand text-ink-500">
                  <tr>
                    <th className="px-3 py-1.5 font-medium">Key</th>
                    <th className="px-3 py-1.5 font-medium w-32">RW</th>
                    <th className="px-3 py-1.5 font-medium">Description</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-bg-border/40">
                  {OCPP_CONFIG_KEYS.map((k) => (
                    <tr key={k.key} className="hover:bg-bg-raised/30">
                      <td className="px-3 py-1.5 font-mono text-ink-200">{k.key}</td>
                      <td className="px-3 py-1.5 font-mono text-[10px] text-ink-400">{k.rw}</td>
                      <td className="px-3 py-1.5 italic text-ink-300">{k.info}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </TechSection>

          {/* ───── MODBUS SECTION ───── */}

          <div className="mt-4 flex items-center gap-3">
            <div className="h-px flex-1 bg-bg-border/50" />
            <div className="flex flex-col items-center gap-1 px-3">
              <span className="inline-flex items-center gap-1 rounded bg-purple-500/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-brand text-purple-300 ring-1 ring-inset ring-purple-500/30">
                Modbus TCP
              </span>
              <p className="text-[11px] text-ink-300 text-center max-w-md">
                On-prem local-network access (paid license)
              </p>
              <p className="text-[10px] text-ink-500 text-center max-w-md leading-tight">
                Closest thing to a local API. Requires the Active Load Balancing license,
                which is a paid Alfen feature.
              </p>
            </div>
            <div className="h-px flex-1 bg-bg-border/50" />
          </div>

          <TechSection title="Modbus TCP overview" source="api" hint="Port 502 · ALB license required">
            <dl>
              {MODBUS_INFO.map((m) => (
                <InfoRow key={m.label} label={m.label} info={m.info} />
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
                <span className="ml-2 italic text-ink-400">
                  sibling AC vendor with REST API + SignalR push
                </span>
              </li>
              <li>
                <code className="rounded bg-bg-base/60 px-1.5 py-0.5 font-mono text-[10px]">
                  docs/reference/integrations/alfen.md
                </code>
                <span className="ml-2 italic text-ink-400">
                  full 605-line reference with onboarding playbook, OCPP keys, Modbus details,
                  production-adapter checklist
                </span>
              </li>
              <li>
                <code className="rounded bg-bg-base/60 px-1.5 py-0.5 font-mono text-[10px]">
                  docs/reference/integrations/ocpp-1.6j.md
                </code>
                <span className="ml-2 italic text-ink-400">
                  shared OCPP 1.6J protocol — applies to all three AC vendors
                </span>
              </li>
            </ul>
          </TechSection>
        </div>
      </PageShell>
    </>
  );
}
