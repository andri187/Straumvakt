import { cookies } from "next/headers";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { Topbar } from "@/components/topbar";
import { PageShell } from "@/components/page-shell";
import { MobileAppPreview } from "@/components/mobile-app-preview";
import { adminSessionConfig, verifyAdminSession } from "@/lib/admin-session";

export const metadata = { title: "Mobile App" };

/**
 * Lightweight presentation of the driver-app mock — phone-frame-shaped
 * carousel of the four hero images (n1, Ísorka, ON, Straumvakt).
 *
 * Not the actual Flutter app — this is a presentation. The Flutter
 * web build that previously sat behind an iframe was much heavier
 * than the use case warranted; replaced with a small native React
 * component (see src/components/mobile-app-preview.tsx) that loads
 * the same four hero images directly.
 *
 * Hero images come through `npm run sync:detour-assets` from
 * E:\Claude\CPMS\mobile-app\mock1\build\web\assets\assets\images\.
 */
export default async function MobileAppPage() {
  const jar = await cookies();
  const token = jar.get(adminSessionConfig.SESSION_COOKIE_NAME)?.value;
  const session = await verifyAdminSession(token);
  const email = session?.email;

  const heroPresent = existsSync(
    resolve(
      process.cwd(),
      "public",
      "mobile-app-mock",
      "assets",
      "assets",
      "images",
      "straumvakt_hero_image.png",
    ),
  );

  return (
    <>
      <Topbar title="Mobile App" email={email} />
      <PageShell
        title="Mobile App preview"
        description="Lightweight presentation of the driver app — phone-frame mockup with the partner-network hero images."
      >
        {!heroPresent ? (
          <div className="rounded-lg border border-bg-border bg-bg-surface/70 p-6 shadow-card backdrop-blur">
            <h2 className="text-sm font-semibold text-ink-50">
              Hero images not synced yet
            </h2>
            <p className="mt-2 text-sm text-ink-300">
              The hero images aren&apos;t in{" "}
              <code className="rounded bg-bg-base/60 px-1.5 py-0.5 font-mono text-xs">
                public/mobile-app-mock/assets/assets/images/
              </code>
              . Run:
            </p>
            <pre className="mt-3 overflow-x-auto rounded bg-bg-base/60 p-3 font-mono text-xs text-ink-100">
              npm run sync:detour-assets
            </pre>
            <p className="mt-3 text-xs text-ink-400">
              Source:{" "}
              <code className="font-mono">
                E:\Claude\CPMS\mobile-app\mock1\assets\images\
              </code>
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            <MobileAppPreview />
            <div className="mx-auto max-w-md rounded-lg border border-bg-border bg-bg-surface/70 p-4 text-center shadow-card backdrop-blur">
              <p className="text-xs text-ink-300">
                Auto-advances every 4 s · hover to pause · click dots or use
                ←/→ to step
              </p>
              <p className="mt-1 text-[11px] text-ink-500">
                Native React presentation — no Flutter framework loaded. The
                actual driver app will live elsewhere; this tab is for visual
                review.
              </p>
            </div>
          </div>
        )}
      </PageShell>
    </>
  );
}
