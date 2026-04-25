import { cookies } from "next/headers";
import { Topbar } from "@/components/topbar";
import { PageShell } from "@/components/page-shell";
import { adminSessionConfig, verifyAdminSession } from "@/lib/admin-session";

export const metadata = { title: "Technical Read" };

/**
 * Technical Read — comprehensive per-charger diagnostic page.
 *
 * Phase A (this commit): page anatomy scaffold matching the reference
 * implementation in `E:\Claude\zaptec-test\src\app\technician\page.tsx`.
 * Picker row, identity strip, API/OCPP section dividers, actions panel
 * shape, diagnostics drawer, V3 lineage panel — all visible, all
 * placeholdered with the visual grammars (status banner / KPI ribbon /
 * two-column metadata / table / live tile + sparkline) the operator's
 * design narrative calls out.
 *
 * Phase B (subsequent commits): port the live data wiring + per-card
 * decoders from zaptec-test into Straumvakt's design tokens. Each
 * card lands as its own commit so the partial state is always
 * working.
 *
 * Until Phase B lands, this page renders structure but no live data;
 * it's a navigation target you can click around.
 */
export default async function TechnicalReadPage() {
  const jar = await cookies();
  const token = jar.get(adminSessionConfig.SESSION_COOKIE_NAME)?.value;
  const session = await verifyAdminSession(token);
  const email = session?.email;

  return (
    <>
      <Topbar title="Technical Read" email={email} />
      <PageShell
        title="Technical Read"
        description="Per-charger diagnostic surface. API + OCPP data side-by-side, source-labelled at the section level, action-grouped by outcome."
      >
        {/* Phase-A scaffold banner */}
        <section className="mb-5 rounded-lg border border-amber-700/40 bg-amber-950/20 p-4 shadow-card backdrop-blur">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 inline-flex h-5 items-center rounded bg-amber-700/30 px-2 text-[10px] font-semibold uppercase tracking-brand text-amber-200">
              Scaffold
            </span>
            <div className="flex-1 text-xs text-ink-200">
              Page anatomy is in place. Live Zaptec API + OCPP wiring lands
              progressively in Phase B (one card per commit). No real charger
              data yet — picker, dividers, and card frames are visible so
              navigation and design tokens can be reviewed before porting
              individual decoders.
            </div>
          </div>
        </section>

        {/* Picker row */}
        <section className="mb-4 rounded-lg border border-bg-border bg-bg-surface/70 p-4 shadow-card backdrop-blur">
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
            <label className="block">
              <span className="text-[10px] font-semibold uppercase tracking-brand text-sv-sky">
                Installation
              </span>
              <select
                disabled
                className="mt-1 w-full rounded-md border border-bg-border bg-bg-base/40 px-3 py-2 text-sm text-ink-300 disabled:opacity-50"
              >
                <option>— no Zaptec credentials configured —</option>
              </select>
            </label>
            <label className="block">
              <span className="text-[10px] font-semibold uppercase tracking-brand text-sv-sky">
                Charger
              </span>
              <select
                disabled
                className="mt-1 w-full rounded-md border border-bg-border bg-bg-base/40 px-3 py-2 text-sm text-ink-300 disabled:opacity-50"
              >
                <option>—</option>
              </select>
            </label>
            <div className="flex items-end">
              <span className="inline-flex items-center gap-2 rounded-md border border-bg-border bg-bg-base/40 px-3 py-2 text-xs text-ink-400">
                <span className="h-2 w-2 rounded-full bg-ink-500" />
                Offline
              </span>
            </div>
          </div>
        </section>

        {/* Identity strip — pills row + warranty card placeholder */}
        <section className="mb-4 rounded-lg border border-bg-border bg-bg-surface/70 p-5 shadow-card backdrop-blur">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-700/40 bg-emerald-950/30 px-2.5 py-1 text-[11px] font-medium text-emerald-200">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              CPO · tenancy.organizations
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-bg-border bg-bg-base/40 px-2.5 py-1 text-[11px] font-medium text-ink-300">
              Charger Owner · pending Straumvakt onboarding
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-bg-border bg-bg-base/40 px-2.5 py-1 text-[11px] font-medium text-ink-300">
              Warranty · unknown
            </span>
          </div>
          <div className="mt-2 text-xs text-ink-400">
            <span className="italic">
              Installation name, address, host support phone &amp; email appear
              here once a charger is selected.
            </span>
          </div>
        </section>

        {/* API/Vendor REST section divider */}
        <SectionDivider
          source="api"
          title="Vendor REST API · Zaptec"
          subtitle="Curated installation, charger, and session data fetched from Zaptec's API. Cards in this section are populated on first poll."
        />

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <CardFrame label="Alarms · status banner">
            Severity-coloured banner with decoded SmartWarnings bitmask
            (35 flags) lands in Phase B.
          </CardFrame>
          <CardFrame label="Live · KPI ribbon + sparklines">
            kW hero, phase rows L1/L2/L3 with 200×20 sparklines, polling
            indicator. Updates every 5 s.
          </CardFrame>
          <CardFrame label="Installation · two-column metadata">
            Tiny labels, right-aligned values, dotted dividers. Mono font
            for IDs.
          </CardFrame>
          <CardFrame label="Charger · two-column metadata">
            Same shape — operator-actionable identifiers (vendor serial,
            firmware, IMEI, etc.).
          </CardFrame>
          <CardFrame label="Charge History · table">
            Right-aligned numbers, mono session IDs, hover-row highlight.
          </CardFrame>
          <CardFrame label="Firmware · table">
            Per-charger firmware list with version, OTA status, last
            update.
          </CardFrame>
          <CardFrame label="DLB · status banner + KPI ribbon">
            Dynamic load balancing — phase distribution, per-circuit
            ceilings.
          </CardFrame>
          <CardFrame label="Authentication · table">
            RFID pins, app users, OCPI tokens visible to this installation.
          </CardFrame>
          <CardFrame label="Hardware · two-column metadata" />
          <CardFrame label="Environment · two-column metadata">
            Cellular dBm bars, Wi-Fi RSSI, ambient temperature.
          </CardFrame>
          <CardFrame label="Installation features · checkbox grid" full>
            13-flag Features bitmask decoded as labelled checkboxes.
          </CardFrame>
          <CardFrame label="Messaging · two-column metadata + masked secrets" full>
            Service Bus password masked with <code>••••••••</code>.
          </CardFrame>
        </div>

        {/* OCPP section divider */}
        <div className="mt-8">
          <SectionDivider
            source="ocpp"
            title="OCPP 1.6J"
            subtitle="When connected: live mirror via the gateway Worker. When disconnected: shape rendered with dimmed placeholders so the structure stays legible."
            stateChip="disconnected"
          />
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <CardFrame label="Connection · status banner">
            BootNotification + Heartbeat trace, last-seen freshness.
          </CardFrame>
          <CardFrame label="Connector status · status banner per connector" />
          <CardFrame label="MeterValues · KPI ribbon">
            Per-row source pill: green API mirror / yellow OCPP-only.
          </CardFrame>
          <CardFrame label="Configuration · table" placeholder>
            38 standard OCPP 1.6 keys — dimmed until connected.
          </CardFrame>
          <CardFrame label="Authorization log · table" placeholder>
            ID-tag attempts, accept/reject outcome — dimmed until connected.
          </CardFrame>
          <CardFrame label="Recent messages · table" placeholder>
            28-entry catalogue (direction, action, when-it-appears).
          </CardFrame>
          <CardFrame label="Charging profiles · table" placeholder full />
        </div>

        {/* Actions panel — by outcome */}
        <div className="mt-8">
          <SectionDivider
            source="control"
            title="Actions"
            subtitle="Grouped by outcome (Session / Power / Diagnostics / Configuration). Each row offers per-transport buttons (OCPP first, API fallback). Two-step confirm shows the literal wire form before firing."
          />
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          <CardFrame label="Session · pause / stop / resume" />
          <CardFrame label="Power · take offline / restore" />
          <CardFrame label="Diagnostics · request log / reboot" />
        </div>

        <CardFrame label="Configuration · OCPP key get / set" full extraClass="mt-4" />

        {/* Diagnostics drawer */}
        <details className="mt-8 rounded-lg border border-bg-border bg-bg-surface/70 shadow-card backdrop-blur">
          <summary className="cursor-pointer list-none px-5 py-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-ink-50">
                  Diagnostics drawer
                </h2>
                <p className="mt-1 text-xs text-ink-400">
                  All 80 raw state observations grouped by category. Long
                  values (OCMF blob, certificates) get per-row{" "}
                  <code>&lt;details&gt;</code> so the table doesn&apos;t blow
                  up.
                </p>
              </div>
              <span className="text-xs text-ink-400">click to expand</span>
            </div>
          </summary>
          <div className="border-t border-bg-border px-5 py-4">
            <p className="text-xs text-ink-300">
              Renders the full StateId table with category grouping (Operation
              / Connectivity / Electrical / Metering / Versions / Diagnostics)
              once the live decoder lands in Phase B. Each group is
              independently collapsible.
            </p>
          </div>
        </details>

        {/* V3 lineage panel */}
        <section className="mt-8 rounded-lg border border-bg-border bg-bg-surface/70 p-5 shadow-card backdrop-blur">
          <h2 className="text-xs font-semibold uppercase tracking-brand text-sv-sky">
            V3 asset hierarchy
          </h2>
          <p className="mt-1 text-xs text-ink-400">
            Vertical lineage: Org → Charger Host → Property → Site → Installation
            → Circuit → SiteAsset → OCPP Identity → Connector. Each tier tagged
            Zaptec live / Derived / Pending so the source of every row is
            obvious.
          </p>
          <ul className="mt-4 space-y-1.5 font-mono text-xs">
            {[
              ["Org", "tenancy.organizations", "Pending"],
              ["Charger Host", "hosts.charger_hosts", "Pending"],
              ["Property", "properties.properties", "Pending"],
              ["Site", "properties.sites", "Pending"],
              ["Installation", "properties.installations", "Pending"],
              ["Circuit", "(not in V3 schema yet)", "Derived"],
              ["SiteAsset", "properties.site_assets", "Pending"],
              ["OCPP Identity", "ocpp.ocpp_identities", "Pending"],
              ["Connector", "ocpp.connectors", "Pending"],
            ].map(([tier, source, tag]) => (
              <li
                key={tier}
                className="flex items-center justify-between gap-3 border-l-2 border-bg-border pl-3"
              >
                <span className="font-sans text-ink-100">{tier}</span>
                <span className="flex-1 text-[11px] text-ink-400">{source}</span>
                <span
                  className={
                    "rounded-full px-2 py-0.5 text-[10px] font-medium " +
                    (tag === "Pending"
                      ? "bg-bg-base/60 text-ink-400"
                      : tag === "Derived"
                      ? "bg-amber-950/30 text-amber-200"
                      : "bg-emerald-950/30 text-emerald-200")
                  }
                >
                  {tag}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </PageShell>
    </>
  );
}

function SectionDivider({
  source,
  title,
  subtitle,
  stateChip,
}: {
  source: "api" | "ocpp" | "control";
  title: string;
  subtitle: string;
  stateChip?: "connected" | "disconnected" | "stale";
}) {
  const sourceColor =
    source === "api"
      ? "bg-emerald-950/30 text-emerald-200 border-emerald-700/40"
      : source === "ocpp"
      ? "bg-sky-950/30 text-sky-200 border-sky-700/40"
      : "bg-violet-950/30 text-violet-200 border-violet-700/40";
  return (
    <div className="flex items-center gap-3">
      <hr className="flex-1 border-bg-border" />
      <div className="flex flex-col items-center gap-1 text-center">
        <div className="flex items-center gap-2">
          <span
            className={
              "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-brand " +
              sourceColor
            }
          >
            {source.toUpperCase()}
          </span>
          <span className="text-sm font-semibold text-ink-50">{title}</span>
          {stateChip && (
            <span className="inline-flex items-center rounded-full border border-bg-border bg-bg-base/40 px-2 py-0.5 text-[10px] text-ink-400">
              {stateChip}
            </span>
          )}
        </div>
        <span className="max-w-xl text-[11px] text-ink-400">{subtitle}</span>
      </div>
      <hr className="flex-1 border-bg-border" />
    </div>
  );
}

function CardFrame({
  label,
  children,
  full,
  placeholder,
  extraClass,
}: {
  label: string;
  children?: React.ReactNode;
  full?: boolean;
  placeholder?: boolean;
  extraClass?: string;
}) {
  return (
    <article
      className={
        "rounded-lg border bg-bg-surface/70 p-4 shadow-card backdrop-blur " +
        (placeholder
          ? "border-dashed border-bg-border/60 "
          : "border-bg-border ") +
        (full ? "lg:col-span-full " : "") +
        (extraClass ?? "")
      }
    >
      <h3
        className={
          "text-[10px] font-semibold uppercase tracking-brand " +
          (placeholder ? "text-ink-500" : "text-sv-sky")
        }
      >
        {label}
      </h3>
      <p
        className={
          "mt-2 text-xs " + (placeholder ? "italic text-ink-500" : "text-ink-300")
        }
      >
        {children ??
          (placeholder
            ? "— when connected —"
            : "Phase B will render the live data here.")}
      </p>
    </article>
  );
}
