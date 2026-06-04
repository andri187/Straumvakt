"use client";

import { useState } from "react";

// The four persona mockups are served as standalone static HTML from
// /public/concepts/*.html (snapshot of docs/app/*.html). This viewer tabs
// between them inside the admin shell. The page itself is gated by the
// (app) layout's admin-session check.
const VIEWS = [
  {
    key: "admin",
    label: "Operator admin",
    src: "/concepts/admin.html",
    desc: "Straumvakt staff console — administer all hosts, onboard, diagnose, access & auth, billing.",
  },
  {
    key: "host",
    label: "Host portal",
    src: "/concepts/host.html",
    desc: "Host-admin self-service — their own chargers, drivers, billing-homes, invoices.",
  },
  {
    key: "driver",
    label: "Driver portal",
    src: "/concepts/driver.html",
    desc: "End-user driver — the web mirror of the mobile app (charging, cost, access, redeem).",
  },
  {
    key: "technician",
    label: "Technician / contractor",
    src: "/concepts/technician.html",
    desc: "Field-service (Tengill / contracted) — aspirational, gated on ADR 0032 + Tengill.",
  },
] as const;

export function ConceptViewer() {
  const [active, setActive] = useState<(typeof VIEWS)[number]>(VIEWS[0]);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {VIEWS.map((v) => (
          <button
            key={v.key}
            type="button"
            onClick={() => setActive(v)}
            className={
              "rounded-md border px-3 py-1.5 text-sm transition-colors " +
              (active.key === v.key
                ? "border-brand-500/40 bg-brand-500/15 text-sv-sky"
                : "border-bg-border bg-bg-base/40 text-ink-300 hover:bg-bg-raised hover:text-ink-50")
            }
          >
            {v.label}
          </button>
        ))}
      </div>
      <p className="text-xs text-ink-400">
        {active.desc}{" "}
        <a
          href={active.src}
          target="_blank"
          rel="noreferrer"
          className="text-sv-sky hover:underline"
        >
          open full ↗
        </a>
      </p>
      <iframe
        key={active.key}
        src={active.src}
        title={active.label}
        className="w-full rounded-lg border border-bg-border bg-bg-surface"
        style={{ height: "calc(100vh - 230px)", minHeight: 520 }}
      />
    </div>
  );
}
