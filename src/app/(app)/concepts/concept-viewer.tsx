"use client";

import { useState } from "react";

// The four persona mockups are served as standalone static HTML from
// /public/concepts/*.html (snapshot of docs/app/*.html). This viewer is a
// full-height surface: a sticky TOP NAV BAR to jump between the views, with
// the selected view filling the rest of the screen. The page is gated by
// the (app) layout's admin-session check.
const VIEWS = [
  { key: "admin", label: "Operator admin", src: "/concepts/admin.html" },
  { key: "host", label: "Host portal", src: "/concepts/host.html" },
  { key: "driver", label: "Driver portal", src: "/concepts/driver.html" },
  { key: "technician", label: "Technician", src: "/concepts/technician.html" },
] as const;

export function ConceptViewer() {
  const [active, setActive] = useState<(typeof VIEWS)[number]>(VIEWS[0]);
  return (
    <div className="flex h-screen flex-col">
      {/* top nav bar — jump between persona views */}
      <header className="sticky top-0 z-10 flex items-center gap-4 border-b border-bg-border bg-bg-surface/85 px-5 py-2.5 backdrop-blur">
        <span className="shrink-0 text-[11px] font-semibold uppercase tracking-brand text-ink-500">
          Persona views
        </span>
        <nav className="flex flex-wrap items-center gap-1.5">
          {VIEWS.map((v) => (
            <button
              key={v.key}
              type="button"
              onClick={() => setActive(v)}
              className={
                "rounded-md border px-3 py-1.5 text-sm font-medium transition-colors " +
                (active.key === v.key
                  ? "border-brand-500/40 bg-brand-500/15 text-sv-sky"
                  : "border-transparent text-ink-300 hover:bg-bg-raised hover:text-ink-50")
              }
            >
              {v.label}
            </button>
          ))}
        </nav>
        <a
          href={active.src}
          target="_blank"
          rel="noreferrer"
          className="ml-auto shrink-0 text-xs text-ink-400 hover:text-sv-sky"
        >
          open full ↗
        </a>
      </header>

      <iframe
        key={active.key}
        src={active.src}
        title={active.label}
        className="w-full flex-1 border-0 bg-bg-surface"
      />
    </div>
  );
}
