import { ConceptViewer } from "./concept-viewer";

export const metadata = { title: "Design concepts" };

export default function ConceptsPage() {
  return (
    <div className="mx-auto max-w-7xl px-6 py-8">
      <div className="mb-4">
        <h1 className="text-xl font-semibold tracking-tight text-ink-50">
          Design concepts
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-400">
          Interactive persona mockups — the four Straumvakt views (operator
          admin, host portal, driver portal, technician/contractor). Standalone
          HTML, not wired to data. Green <code className="text-sv-green">new</code>{" "}
          / amber <code className="text-amber-300">soon</code> tags mark what is
          built vs. aspirational. See{" "}
          <code className="text-ink-300">docs/app/four-views-alignment.md</code>{" "}
          for the gap check.
        </p>
      </div>
      <ConceptViewer />
    </div>
  );
}
