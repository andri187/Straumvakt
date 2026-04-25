import { cookies } from "next/headers";
import { Topbar } from "@/components/topbar";
import { PageShell } from "@/components/page-shell";
import { adminSessionConfig, verifyAdminSession } from "@/lib/admin-session";

export const metadata = { title: "Technical Read" };

/**
 * Technical Read — comprehensive per-charger diagnostic page.
 *
 * Phase A (this commit): embed the existing zaptec-test technician
 * page running on http://localhost:3100. The Zaptec API has real
 * OAuth credentials configured in zaptec-test/.env, and the chargers
 * are wired to the Straumvakt OCPP gateway URL — so what's served at
 * :3100 is real live data.
 *
 * Iframe gets the operator the exact UI tonight. The native port
 * (47 source files: lib/zaptec.ts client, 11 tech-cards, 5 ocpp-cards,
 * 3 live components) lands progressively in Phase B, swapping the
 * iframe out for in-Straumvakt components without changing the route.
 *
 * URL params are forwarded so /technical-read?installation=…&charger=…
 * pre-selects the same installation/charger inside the iframe as a
 * top-level link would.
 */
const ZAPTEC_TEST_BASE = "http://localhost:3100";
const TECHNICIAN_PATH = "/technician";

export default async function TechnicalReadPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const jar = await cookies();
  const token = jar.get(adminSessionConfig.SESSION_COOKIE_NAME)?.value;
  const session = await verifyAdminSession(token);
  const email = session?.email;

  const sp = await searchParams;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (typeof v === "string") qs.set(k, v);
  }
  // Tell zaptec-test to render in "embedded" mode — its Sidebar
  // self-hides and globals.css drops the left margin on <main> so
  // only Straumvakt's outer chrome remains. See zaptec-test
  // src/components/sidebar.tsx + globals.css.
  qs.set("embedded", "1");
  const iframeUrl = `${ZAPTEC_TEST_BASE}${TECHNICIAN_PATH}?${qs.toString()}`;

  return (
    <>
      <Topbar title="Technical Read" email={email} />
      <PageShell
        title="Technical Read"
        description="Live charger diagnostics — installation hierarchy, identity strip, API + OCPP cards, actions panel, diagnostics drawer, V3 lineage. Fed by the Zaptec API + Straumvakt OCPP gateway."
      >
        {/* Phase note */}
        <section className="mb-4 rounded-lg border border-amber-700/40 bg-amber-950/20 p-3 shadow-card backdrop-blur">
          <div className="flex flex-wrap items-start gap-3">
            <span className="inline-flex h-5 items-center rounded bg-amber-700/30 px-2 text-[10px] font-semibold uppercase tracking-brand text-amber-200">
              Phase A
            </span>
            <span className="flex-1 text-xs text-ink-200">
              Iframe of the zaptec-test technician page on{" "}
              <code className="rounded bg-bg-base/60 px-1.5 py-0.5 font-mono text-[11px]">
                localhost:3100
              </code>
              . Real Zaptec OAuth credentials live in{" "}
              <code className="font-mono text-[11px]">zaptec-test/.env</code> —
              not duplicated to Straumvakt. Phase B ports the 47 source files
              into native Straumvakt components so this iframe goes away.
            </span>
          </div>
        </section>

        {/* Iframe header bar */}
        <div className="overflow-hidden rounded-lg border border-bg-border bg-bg-surface/70 shadow-card backdrop-blur">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-bg-border bg-bg-base/40 px-4 py-2">
            <div className="flex items-center gap-2 text-xs text-ink-300">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-700/40 bg-emerald-950/30 px-2 py-0.5 text-[10px] font-medium text-emerald-200">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                Live source
              </span>
              <code className="break-all font-mono text-[11px] text-ink-400">
                {iframeUrl}
              </code>
            </div>
            <a
              href={iframeUrl}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-ink-300 hover:text-ink-50"
            >
              Open in new tab ↗
            </a>
          </div>
          <iframe
            src={iframeUrl}
            title="Technical Read — zaptec-test technician view"
            className="block h-[88vh] w-full border-0 bg-white"
          />
        </div>

        {/* Fallback note shown above the iframe when :3100 isn't up */}
        <p className="mt-3 text-[11px] text-ink-500">
          If the panel above is blank, start the zaptec-test app on port
          3100 (<code className="font-mono">cd E:\Claude\zaptec-test &amp;&amp; npm run dev</code>{" "}
          — note the <code className="font-mono">PORT=3100</code> in its
          package.json or <code className="font-mono">next dev -p 3100</code>).
        </p>
      </PageShell>
    </>
  );
}
