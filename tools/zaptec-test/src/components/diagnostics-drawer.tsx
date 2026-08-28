"use client";

import { useState } from "react";
import { ChevronDown, Database } from "lucide-react";
import type { StateObservation } from "@/lib/zaptec";
import { describeStateId, type StateGroup } from "@/lib/zaptec-state";
import { cn } from "@/lib/cn";

const GROUP_ORDER: StateGroup[] = [
  "Operation",
  "Connectivity",
  "Electrical",
  "Metering",
  "Session",
  "Versions",
  "Environment",
  "Diagnostics",
  "Other",
];

export function DiagnosticsDrawer({ state }: { state: StateObservation[] }) {
  const [openGroups, setOpenGroups] = useState<Set<StateGroup>>(new Set());
  const [open, setOpen] = useState(false);

  const grouped = new Map<StateGroup, (StateObservation & { _label: string })[]>();
  for (const s of state) {
    const meta = describeStateId(s.StateId);
    const list = grouped.get(meta.group) ?? [];
    list.push({ ...s, _label: meta.label });
    grouped.set(meta.group, list);
  }

  return (
    <section className="rounded-lg border border-bg-border bg-bg-surface/70 shadow-card backdrop-blur">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-5 py-3 text-left hover:bg-bg-raised/40 rounded-lg"
        aria-expanded={open}
      >
        <Database className="h-4 w-4 text-sv-sky" />
        <h3 className="text-sm font-semibold text-ink-50">Raw observations</h3>
        <span className="text-xs text-ink-400">{state.length} observations across {grouped.size} groups</span>
        <ChevronDown
          className={cn(
            "ml-auto h-4 w-4 text-ink-400 transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {open ? (
        <div className="border-t border-bg-border px-5 pb-5 pt-3 space-y-2">
          {GROUP_ORDER.map((g) => {
            const list = grouped.get(g);
            if (!list?.length) return null;
            list.sort((a, b) => a.StateId - b.StateId);
            const isOpen = openGroups.has(g);
            return (
              <div key={g} className="rounded-md border border-bg-border bg-bg-inset/40">
                <button
                  type="button"
                  onClick={() =>
                    setOpenGroups((prev) => {
                      const next = new Set(prev);
                      if (next.has(g)) next.delete(g);
                      else next.add(g);
                      return next;
                    })
                  }
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs"
                >
                  <ChevronDown
                    className={cn(
                      "h-3 w-3 text-ink-400 transition-transform",
                      isOpen && "rotate-180",
                    )}
                  />
                  <span className="font-semibold uppercase tracking-brand text-sv-sky">
                    {g}
                  </span>
                  <span className="text-ink-500">· {list.length}</span>
                </button>
                {isOpen ? (
                  <div className="border-t border-bg-border overflow-hidden">
                    <table className="w-full text-xs">
                      <thead className="bg-bg-inset/60 text-left text-[10px] uppercase tracking-brand text-ink-500">
                        <tr>
                          <th className="px-3 py-1.5 font-medium w-14">ID</th>
                          <th className="px-3 py-1.5 font-medium">Label</th>
                          <th className="px-3 py-1.5 font-medium">Value</th>
                          <th className="px-3 py-1.5 font-medium w-36">Updated</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-bg-border">
                        {list.map((s, i) => (
                          <tr key={`${s.StateId}-${i}`} className="hover:bg-bg-raised/40">
                            <td className="px-3 py-1.5 font-mono text-ink-400">
                              {s.StateId}
                            </td>
                            <td className="px-3 py-1.5 text-ink-200">
                              {s._label}
                            </td>
                            <td className="px-3 py-1.5 font-mono text-ink-100 break-all max-w-sm">
                              {s.ValueAsString ? (
                                s.ValueAsString.length > 120 ? (
                                  <details>
                                    <summary className="cursor-pointer text-sv-sky">
                                      {s.ValueAsString.slice(0, 80)}… (show all)
                                    </summary>
                                    <pre className="mt-1 whitespace-pre-wrap break-all text-[10px] text-ink-300">
                                      {s.ValueAsString}
                                    </pre>
                                  </details>
                                ) : (
                                  s.ValueAsString
                                )
                              ) : (
                                <span className="text-ink-500">—</span>
                              )}
                            </td>
                            <td className="px-3 py-1.5 font-mono text-[10px] text-ink-500">
                              {s.Timestamp
                                ? new Date(s.Timestamp)
                                    .toISOString()
                                    .replace("T", " ")
                                    .slice(0, 19)
                                : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
