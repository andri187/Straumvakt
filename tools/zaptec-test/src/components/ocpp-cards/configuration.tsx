"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { TechSection } from "@/components/tech-section";
import { OCPP_STANDARD_CONFIG_KEYS, type OcppConfigGroup } from "@/lib/ocpp";
import { cn } from "@/lib/cn";

const GROUPS: OcppConfigGroup[] = [
  "Core",
  "Local Auth List",
  "Reservation",
  "Smart Charging",
  "Firmware",
  "Vendor",
];

export function OcppConfigurationCard({
  ocppConnected,
}: {
  ocppConnected: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [openGroups, setOpenGroups] = useState<Set<OcppConfigGroup>>(new Set(["Core"]));

  const grouped = new Map<OcppConfigGroup, typeof OCPP_STANDARD_CONFIG_KEYS>();
  for (const k of OCPP_STANDARD_CONFIG_KEYS) {
    const list = grouped.get(k.group) ?? [];
    list.push(k);
    grouped.set(k.group, list);
  }

  const total = OCPP_STANDARD_CONFIG_KEYS.length;

  return (
    <TechSection
      title="OCPP configuration"
      source="ocpp"
      state={ocppConnected ? { kind: "connected" } : { kind: "disconnected" }}
      hint={`${total} standard keys · GetConfiguration / ChangeConfiguration`}
    >
      <p className="mb-3 text-[11px] text-ink-400">
        OCPP 1.6J Appendix B defines a standard set of configuration keys grouped by
        feature profile. Vendors add their own keys. The CSMS reads them via{" "}
        <span className="font-mono text-ink-300">GetConfiguration</span> and writes them via{" "}
        <span className="font-mono text-ink-300">ChangeConfiguration</span>. All values
        are transmitted as strings even when typed.
      </p>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 rounded-md border border-bg-border bg-bg-inset/40 px-3 py-2 text-xs text-ink-200 hover:bg-bg-raised/40"
      >
        <ChevronDown
          className={cn(
            "h-3 w-3 text-ink-400 transition-transform",
            open && "rotate-180",
          )}
        />
        {open ? "Hide" : "Show"} all {total} keys
      </button>

      {open ? (
        <div className="mt-3 space-y-3">
          {GROUPS.map((g) => {
            const list = grouped.get(g);
            if (!list?.length) return null;
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
                  <span className="text-ink-500">· {list.length} keys</span>
                </button>
                {isOpen ? (
                  <div className="border-t border-bg-border overflow-hidden">
                    <table className="w-full text-xs">
                      <thead className="bg-bg-inset/60 text-left text-[10px] uppercase tracking-brand text-ink-500">
                        <tr>
                          <th className="px-3 py-1.5 font-medium">Key</th>
                          <th className="px-3 py-1.5 font-medium w-14">Type</th>
                          <th className="px-3 py-1.5 font-medium w-16">RW</th>
                          <th className="px-3 py-1.5 font-medium">Description</th>
                          <th className="px-3 py-1.5 font-medium w-32">Live value</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-bg-border/60">
                        {list.map((k) => (
                          <tr key={k.key}>
                            <td className="px-3 py-1.5 font-mono text-[11px] text-ink-200">
                              {k.key}
                            </td>
                            <td className="px-3 py-1.5 font-mono text-[10px] text-ink-400">
                              {k.type}
                              {k.unit ? ` (${k.unit})` : ""}
                            </td>
                            <td className="px-3 py-1.5 text-[10px] text-ink-400">
                              {k.readonly ? "RO" : "RW"}
                            </td>
                            <td className="px-3 py-1.5 text-[11px] text-ink-300">
                              {k.description}
                            </td>
                            <td className="px-3 py-1.5 font-mono text-[11px] italic text-ink-600">
                              —
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
    </TechSection>
  );
}
