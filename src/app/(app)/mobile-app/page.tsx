import { cookies } from "next/headers";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { Topbar } from "@/components/topbar";
import { PageShell } from "@/components/page-shell";
import { adminSessionConfig, verifyAdminSession } from "@/lib/admin-session";

export const metadata = { title: "Mobile App" };

/**
 * Detour panel — embeds the Flutter Web mock of the driver app from
 * E:\Claude\CPMS\mobile-app\mock1\build\web. The static build is
 * synced into public/mobile-app-mock/ via `npm run sync:detour-assets`
 * (gitignored — refresh after Flutter rebuilds).
 *
 * This is operator-only preview, not the deployed driver app.
 */
export default async function MobileAppPage() {
  const jar = await cookies();
  const token = jar.get(adminSessionConfig.SESSION_COOKIE_NAME)?.value;
  const session = await verifyAdminSession(token);
  const email = session?.email;

  const mockPresent = existsSync(
    resolve(process.cwd(), "public", "mobile-app-mock", "index.html"),
  );

  return (
    <>
      <Topbar title="Mobile App" email={email} />
      <PageShell
        title="Mobile App preview"
        description="Embedded Flutter Web build of the driver app mock. Updated by `npm run sync:detour-assets`."
      >
        {!mockPresent ? (
          <div className="rounded-lg border border-bg-border bg-bg-surface/70 p-6 shadow-card backdrop-blur">
            <h2 className="text-sm font-semibold text-ink-50">
              Mock not synced yet
            </h2>
            <p className="mt-2 text-sm text-ink-300">
              The Flutter Web build hasn&apos;t been copied into{" "}
              <code className="rounded bg-bg-base/60 px-1.5 py-0.5 font-mono text-xs">
                public/mobile-app-mock/
              </code>
              . Run:
            </p>
            <pre className="mt-3 overflow-x-auto rounded bg-bg-base/60 p-3 font-mono text-xs text-ink-100">
              npm run sync:detour-assets
            </pre>
            <p className="mt-3 text-xs text-ink-400">
              Source:{" "}
              <code className="font-mono">
                E:\Claude\CPMS\mobile-app\mock1\build\web
              </code>
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-bg-border bg-bg-surface/70 shadow-card backdrop-blur">
            <div className="flex items-center justify-between border-b border-bg-border bg-bg-base/40 px-4 py-2">
              <span className="text-xs font-semibold uppercase tracking-brand text-sv-sky">
                Live preview
              </span>
              <a
                href="/mobile-app-mock/index.html"
                target="_blank"
                rel="noreferrer"
                className="text-xs text-ink-300 hover:text-ink-50"
              >
                Open in new tab ↗
              </a>
            </div>
            <iframe
              src="/mobile-app-mock/index.html"
              title="Driver app mock"
              className="block h-[80vh] w-full border-0 bg-white"
            />
          </div>
        )}
      </PageShell>
    </>
  );
}
