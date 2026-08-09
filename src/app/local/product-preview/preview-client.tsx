"use client";

import { useEffect, useState } from "react";

type PreviewSurface = "staff" | "cpo" | "driver";

const SURFACES: readonly { id: PreviewSurface; label: string }[] = [
  { id: "staff", label: "Straumvakt admin" },
  { id: "cpo", label: "Organisation admin" },
  { id: "driver", label: "Driver" },
];

export function ProductPreview() {
  const [surface, setSurface] = useState<PreviewSurface>("staff");

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get(
      "surface",
    );
    if (
      requested === "staff" ||
      requested === "cpo" ||
      requested === "driver"
    ) {
      setSurface(requested);
    }
  }, []);

  return (
    <main className="min-h-screen bg-bg-base text-ink-50">
      <header className="border-b border-bg-border bg-bg-surface">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-normal text-brand-300">
              Local preview
            </div>
            <h1 className="mt-1 text-lg font-semibold">
              Product-to-market workflow
            </h1>
          </div>
          <div
            className="grid w-full grid-cols-[1.2fr_1.4fr_.65fr] border border-bg-border sm:flex sm:w-auto"
            role="tablist"
            aria-label="Product surface"
          >
            {SURFACES.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={surface === item.id}
                onClick={() => setSurface(item.id)}
                className={`min-w-0 px-2 py-2 text-[11px] font-medium sm:shrink-0 sm:px-4 sm:text-xs ${surface === item.id ? "bg-brand-400 text-bg-base" : "text-ink-300"}`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        {surface === "staff" ? <StaffPreview /> : null}
        {surface === "cpo" ? <CpoPreview /> : null}
        {surface === "driver" ? <DriverPreview /> : null}
      </div>
    </main>
  );
}

function StaffPreview() {
  return (
    <div className="grid gap-5">
      <PreviewHeader
        eyebrow="Platform operations"
        title="Morning queue"
        meta="demo-staff@straumvakt.test"
      />
      <div className="grid gap-px border border-bg-border bg-bg-border sm:grid-cols-4">
        <PreviewMetric label="Applications" value="3" tone="amber" />
        <PreviewMetric label="Unknown chargers" value="7" tone="amber" />
        <PreviewMetric label="Active sessions" value="12" tone="mint" />
        <PreviewMetric label="Organisations" value="18" />
      </div>
      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <PreviewTable
          title="Organisation applications"
          columns={["Organisation", "Contact", "Sites", "State"]}
          rows={[
            ["Demo North Energy", "ops@north.test", "4", "Review"],
            ["Demo Harbour", "admin@harbour.test", "2", "New"],
            ["Demo Housing 12", "board@housing.test", "1", "Offer"],
          ]}
        />
        <section className="border border-bg-border bg-bg-surface">
          <div className="border-b border-bg-border px-4 py-3 text-xs font-semibold">
            Workflow readiness
          </div>
          <StatusRow label="Application queue" state="Ready" tone="mint" />
          <StatusRow
            label="Organisation aggregate"
            state="Backend required"
            tone="amber"
          />
          <StatusRow label="Support context" state="Read only" tone="blue" />
          <StatusRow
            label="Audit trail"
            state="Backend required"
            tone="amber"
          />
        </section>
      </div>
    </div>
  );
}

function CpoPreview() {
  return (
    <div className="grid gap-5">
      <PreviewHeader
        eyebrow="Demo North Energy"
        title="Charging operations"
        meta="Organisation admin"
      />
      <div className="grid gap-px border border-bg-border bg-bg-border sm:grid-cols-4">
        <PreviewMetric label="Chargers" value="24" />
        <PreviewMetric label="Online" value="22" tone="mint" />
        <PreviewMetric label="Pending access" value="3" tone="amber" />
        <PreviewMetric label="Active drivers" value="146" />
      </div>
      <div className="grid gap-5 lg:grid-cols-[1.45fr_1fr]">
        <PreviewTable
          title="Fleet inventory"
          columns={["Identity", "Installation", "Hardware", "State"]}
          rows={[
            ["DEMO-CP-001", "Main office", "Zaptec Pro", "Online"],
            ["DEMO-CP-002", "Main office", "Zaptec Pro", "Charging"],
            ["DEMO-CP-017", "Warehouse", "Easee Charge", "Offline"],
          ]}
        />
        <section className="border border-bg-border bg-bg-surface">
          <div className="border-b border-bg-border px-4 py-3 text-xs font-semibold">
            Driver access requests
          </div>
          {[
            ["Ada Demo", "Main office"],
            ["Bjarni Demo", "Warehouse"],
            ["Cara Demo", "Main office"],
          ].map(([name, site]) => (
            <div
              key={name}
              className="flex items-center justify-between gap-3 border-b border-bg-border px-4 py-3 last:border-b-0"
            >
              <div>
                <strong className="text-xs">{name}</strong>
                <div className="text-[11px] text-ink-500">{site}</div>
              </div>
              <span className="border border-amber-300/35 bg-amber-300/10 px-2 py-1 text-[10px] text-amber-200">
                Pending
              </span>
            </div>
          ))}
        </section>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-4 border border-dashed border-bg-border px-4 py-4">
        <div>
          <strong className="text-sm">Driver visibility policy</strong>
          <p className="mt-1 text-xs text-ink-500">
            No explicit visibility contract.
          </p>
        </div>
        <button
          disabled
          className="border border-bg-border px-4 py-2 text-xs text-ink-500"
        >
          Configure visibility
        </button>
      </div>
    </div>
  );
}

function DriverPreview() {
  return (
    <div className="mx-auto grid max-w-4xl gap-6 md:grid-cols-2">
      <section className="border border-bg-border bg-bg-surface p-5">
        <div className="text-[10px] font-semibold uppercase tracking-normal text-brand-300">
          Registered driver
        </div>
        <h2 className="mt-2 text-xl font-semibold">No charging access yet</h2>
        <p className="mt-2 text-sm leading-relaxed text-ink-400">
          demo-driver@straumvakt.test
        </p>
        <div className="mt-6 grid gap-3">
          <button className="h-11 bg-brand-400 text-sm font-semibold text-bg-base">
            Use invitation
          </button>
          <button
            disabled
            className="h-11 border border-bg-border text-sm text-ink-500"
          >
            Use installation code
          </button>
        </div>
        <div className="mt-5 border-l-2 border-amber-300 bg-amber-300/10 px-4 py-3 text-xs text-ink-300">
          Installation codes require the join contract.
        </div>
      </section>
      <section className="border border-bg-border bg-bg-surface p-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-[10px] uppercase tracking-normal text-ink-500">
              Active sessions
            </div>
            <h2 className="mt-1 text-xl font-semibold">Choose a charge</h2>
          </div>
          <span className="grid h-8 w-8 place-items-center rounded-full bg-brand-400 text-sm font-bold text-bg-base">
            2
          </span>
        </div>
        <div className="mt-5 grid gap-3">
          <DriverSession
            name="Main office 02"
            energy="12.8 kWh"
            power="7.1 kW"
            cost="Pending"
          />
          <DriverSession
            name="Warehouse 01"
            energy="4.2 kWh"
            power="Unavailable"
            cost="1,240 kr"
          />
        </div>
      </section>
    </div>
  );
}

function PreviewHeader({
  eyebrow,
  title,
  meta,
}: {
  eyebrow: string;
  title: string;
  meta: string;
}) {
  return (
    <header className="flex min-w-0 flex-wrap items-end justify-between gap-4 border-b border-bg-border pb-4">
      <div className="min-w-0">
        <div className="text-[10px] font-semibold uppercase tracking-normal text-brand-300">
          {eyebrow}
        </div>
        <h2 className="mt-1 text-2xl font-semibold">{title}</h2>
      </div>
      <span className="w-full min-w-0 break-all text-xs text-ink-500 sm:w-auto sm:break-normal sm:text-right">
        {meta}
      </span>
    </header>
  );
}

function PreviewMetric({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "mint" | "amber";
}) {
  const color =
    tone === "mint"
      ? "text-emerald-300"
      : tone === "amber"
        ? "text-amber-300"
        : "text-ink-50";
  return (
    <div className="bg-bg-surface p-4">
      <div className="text-[10px] uppercase tracking-normal text-ink-500">
        {label}
      </div>
      <div className={`mt-1 text-2xl font-semibold ${color}`}>{value}</div>
    </div>
  );
}

function PreviewTable({
  title,
  columns,
  rows,
}: {
  title: string;
  columns: string[];
  rows: string[][];
}) {
  return (
    <section className="overflow-x-auto border border-bg-border">
      <div className="border-b border-bg-border bg-bg-surface px-4 py-3 text-xs font-semibold">
        {title}
      </div>
      <table className="w-full min-w-[34rem] text-left text-xs">
        <thead className="text-[10px] uppercase tracking-normal text-ink-500">
          <tr>
            {columns.map((column) => (
              <th key={column} className="px-4 py-3 font-medium">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-bg-border">
          {rows.map((row) => (
            <tr key={row.join("|")}>
              {row.map((cell, index) => (
                <td key={`${index}-${cell}`} className="px-4 py-3 text-ink-300">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function StatusRow({
  label,
  state,
  tone,
}: {
  label: string;
  state: string;
  tone: "mint" | "amber" | "blue";
}) {
  const cls =
    tone === "mint"
      ? "text-emerald-300"
      : tone === "amber"
        ? "text-amber-300"
        : "text-sky-300";
  return (
    <div className="flex items-center justify-between gap-4 border-b border-bg-border px-4 py-3 last:border-b-0">
      <span className="text-xs text-ink-300">{label}</span>
      <span className={`text-[10px] font-semibold ${cls}`}>{state}</span>
    </div>
  );
}

function DriverSession({
  name,
  energy,
  power,
  cost,
}: {
  name: string;
  energy: string;
  power: string;
  cost: string;
}) {
  return (
    <button
      type="button"
      className="grid w-full grid-cols-[1fr_auto] gap-3 border border-bg-border p-4 text-left"
    >
      <div>
        <strong className="text-sm">{name}</strong>
        <div className="mt-1 text-xs text-ink-500">
          {energy} | {power}
        </div>
      </div>
      <span className="text-xs text-amber-300">{cost}</span>
    </button>
  );
}
