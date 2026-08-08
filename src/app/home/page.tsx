// Interim signed-in destination — 2026-08-08 relaunch.
//
// Placeholder only. The root login (src/app/page.tsx) redirects here on a
// successful admin/host session. This gets replaced once the real
// persona-specific destinations exist: a Straumvakt-employee landing page
// and a per-org landing page (starting with N1, built as a reusable
// template — see the task this file was written for). Until then this is
// just proof that the session round-trip works.

export const metadata = { title: "Signed in" };

export default function HomePlaceholderPage() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="max-w-md rounded-2xl border border-bg-border bg-bg-surface/90 p-8 text-center shadow-card">
        <h1 className="text-lg font-semibold text-ink-50">You&rsquo;re signed in.</h1>
        <p className="mt-2 text-sm text-ink-300">
          This is a placeholder. The Straumvakt-employee and organisation
          landing pages that belong here haven&rsquo;t been built yet.
        </p>
      </div>
    </div>
  );
}
