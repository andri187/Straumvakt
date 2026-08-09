"use client";

import { useMemo, useState } from "react";
import {
  PRODUCT_WORKFLOWS,
  readinessCounts,
  type ContractState,
  type ProductSurface,
} from "@/lib/product-readiness";

const STATE_LABEL: Record<ContractState, string> = {
  ready: "Ready",
  read_only: "Read only",
  blocked: "Backend required",
  unsafe: "Security blocked",
};

const STATE_CLASS: Record<ContractState, string> = {
  ready: "border-emerald-400/40 bg-emerald-400/10 text-emerald-200",
  read_only: "border-sky-400/40 bg-sky-400/10 text-sky-200",
  blocked: "border-amber-300/40 bg-amber-300/10 text-amber-200",
  unsafe: "border-red-400/40 bg-red-400/10 text-red-200",
};

type StateFilter = ContractState | "all";
type SurfaceFilter = ProductSurface | "all";

export function ReadinessView() {
  const counts = readinessCounts();
  const [state, setState] = useState<StateFilter>("all");
  const [surface, setSurface] = useState<SurfaceFilter>("all");
  const [query, setQuery] = useState("");

  const workflows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return PRODUCT_WORKFLOWS.filter((workflow) => {
      const matchesState = state === "all" || workflow.state === state;
      const matchesSurface = surface === "all" || workflow.surface === surface;
      const matchesQuery =
        !needle ||
        workflow.label.toLowerCase().includes(needle) ||
        workflow.dependency.toLowerCase().includes(needle);
      return matchesState && matchesSurface && matchesQuery;
    });
  }, [query, state, surface]);

  return (
    <>
      <dl className="mt-6 grid gap-px border border-bg-border bg-bg-border sm:grid-cols-4">
        {(
          [
            ["Ready", counts.ready, "ready"],
            ["Read only", counts.read_only, "read_only"],
            ["Backend required", counts.blocked, "blocked"],
            ["Security blocked", counts.unsafe, "unsafe"],
          ] as const
        ).map(([label, value, filter]) => (
          <button
            key={label}
            type="button"
            className={`bg-bg-base p-4 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-300 ${state === filter ? "ring-1 ring-inset ring-brand-300" : ""}`}
            onClick={() => setState(state === filter ? "all" : filter)}
            aria-pressed={state === filter}
          >
            <span className="block text-[11px] uppercase tracking-normal text-ink-500">
              {label}
            </span>
            <span className="mt-1 block text-2xl font-semibold tabular-nums text-ink-50">
              {value}
            </span>
          </button>
        ))}
      </dl>

      <div className="mt-5 grid gap-3 border border-bg-border bg-bg-surface p-3 sm:grid-cols-[1fr_auto]">
        <label className="grid gap-1 text-xs text-ink-400">
          Search workflows or dependencies
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="min-h-10 border border-bg-border bg-bg-base px-3 text-sm text-ink-50 outline-none focus-visible:border-brand-300"
          />
        </label>
        <label className="grid gap-1 text-xs text-ink-400">
          Surface
          <select
            value={surface}
            onChange={(event) => setSurface(event.target.value as SurfaceFilter)}
            className="min-h-10 border border-bg-border bg-bg-base px-3 text-sm text-ink-50 outline-none focus-visible:border-brand-300"
          >
            <option value="all">All surfaces</option>
            <option value="staff">Straumvakt admin</option>
            <option value="cpo">Organisation admin</option>
            <option value="driver">Driver</option>
          </select>
        </label>
      </div>

      <p className="mt-3 text-xs text-ink-500" role="status" aria-live="polite">
        Showing {workflows.length} of {PRODUCT_WORKFLOWS.length} product workflows.
      </p>

      <div className="mt-3 overflow-x-auto border border-bg-border">
        <table className="w-full min-w-[48rem] text-left text-sm">
          <caption className="org-sr-only">
            Product workflow readiness; no repository-health or work-view data
          </caption>
          <thead className="bg-bg-surface text-[11px] uppercase tracking-normal text-ink-500">
            <tr>
              <th scope="col" className="px-4 py-3 font-medium">Surface</th>
              <th scope="col" className="px-4 py-3 font-medium">Workflow</th>
              <th scope="col" className="px-4 py-3 font-medium">State</th>
              <th scope="col" className="px-4 py-3 font-medium">Next dependency</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-bg-border">
            {workflows.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-ink-400">
                  No product workflow matches these filters.
                </td>
              </tr>
            ) : (
              workflows.map((workflow) => (
                <tr key={workflow.id}>
                  <td className="px-4 py-3 uppercase text-ink-500">
                    {workflow.surface}
                  </td>
                  <td className="px-4 py-3 font-medium text-ink-100">
                    {workflow.label}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex border px-2 py-1 text-[11px] font-semibold ${STATE_CLASS[workflow.state]}`}
                    >
                      {STATE_LABEL[workflow.state]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-ink-400">{workflow.dependency}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

