import { cookies } from "next/headers";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { Topbar } from "@/components/topbar";
import { PageShell } from "@/components/page-shell";
import { adminSessionConfig, verifyAdminSession } from "@/lib/admin-session";

export const metadata = { title: "Reference" };

type ReferenceDoc = {
  slug: string;
  title: string;
  summary: string;
  htmlPath: string;
  mdPath: string;
};

const docs: ReferenceDoc[] = [
  {
    slug: "iceland-energy-parties",
    title: "Iceland — energy parties",
    summary:
      "Catalogue of Icelandic DSOs, retailers, and energy-market actors with logos. Reference data for the Customer Plan / tariff / OCPI roaming work in Sprints 4 and beyond.",
    htmlPath: "/reference/iceland-energy-parties.html",
    mdPath: "/reference/iceland-energy-parties.md",
  },
];

export default async function ReferencePage({
  searchParams,
}: {
  searchParams: Promise<{ doc?: string }>;
}) {
  const jar = await cookies();
  const token = jar.get(adminSessionConfig.SESSION_COOKIE_NAME)?.value;
  const session = await verifyAdminSession(token);
  const email = session?.email;

  const params = await searchParams;
  const active = docs.find((d) => d.slug === params.doc) ?? docs[0];
  const synced = existsSync(
    resolve(process.cwd(), "public", "reference", `${active.slug}.html`),
  );

  return (
    <>
      <Topbar title="Reference" email={email} />
      <PageShell
        title="Reference"
        description="Domain references the Straumvakt build draws on. Markdown source lives in docs/reference/; the HTML is synced into public/ for embedding."
      >
        <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
          <aside className="rounded-lg border border-bg-border bg-bg-surface/70 p-4 shadow-card backdrop-blur">
            <h2 className="text-xs font-semibold uppercase tracking-brand text-sv-sky">
              Documents
            </h2>
            <ul className="mt-3 space-y-1">
              {docs.map((d) => {
                const isActive = d.slug === active.slug;
                return (
                  <li key={d.slug}>
                    <a
                      href={`/reference?doc=${d.slug}`}
                      className={
                        "block rounded-md px-3 py-2 text-sm transition-colors " +
                        (isActive
                          ? "bg-bg-base/60 text-ink-50"
                          : "text-ink-300 hover:bg-bg-base/40 hover:text-ink-50")
                      }
                    >
                      {d.title}
                    </a>
                  </li>
                );
              })}
            </ul>
          </aside>

          <section className="overflow-hidden rounded-lg border border-bg-border bg-bg-surface/70 shadow-card backdrop-blur">
            <header className="border-b border-bg-border bg-bg-base/40 px-5 py-4">
              <h2 className="text-base font-semibold text-ink-50">
                {active.title}
              </h2>
              <p className="mt-1 text-xs text-ink-300">{active.summary}</p>
              {synced && (
                <div className="mt-2 flex gap-3 text-xs text-ink-400">
                  <a
                    href={active.htmlPath}
                    target="_blank"
                    rel="noreferrer"
                    className="hover:text-ink-50"
                  >
                    HTML ↗
                  </a>
                  <a
                    href={active.mdPath}
                    target="_blank"
                    rel="noreferrer"
                    className="hover:text-ink-50"
                  >
                    Markdown ↗
                  </a>
                </div>
              )}
            </header>

            {synced ? (
              <iframe
                src={active.htmlPath}
                title={active.title}
                className="block h-[78vh] w-full border-0 bg-white"
              />
            ) : (
              <div className="p-6">
                <p className="text-sm text-ink-200">
                  Reference assets aren&apos;t synced yet. Run:
                </p>
                <pre className="mt-3 overflow-x-auto rounded bg-bg-base/60 p-3 font-mono text-xs text-ink-100">
                  npm run sync:detour-assets
                </pre>
              </div>
            )}
          </section>
        </div>
      </PageShell>
    </>
  );
}
