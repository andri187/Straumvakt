import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";

export type Tier = {
  label: string;
  value: string;
  source: "live" | "derived" | "pending";
};

export function SvBreadcrumb({ tiers }: { tiers: Tier[] }) {
  return (
    <nav
      aria-label="Straumvakt asset hierarchy"
      className="mb-4 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs"
    >
      {tiers.map((t, i) => {
        const isLast = i === tiers.length - 1;
        return (
          <span key={t.label} className="flex items-center gap-1.5">
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded px-1.5 py-0.5",
                isLast
                  ? "bg-brand-500/10 text-sv-sky ring-1 ring-inset ring-brand-500/25 font-medium"
                  : "text-ink-300",
              )}
              title={`${t.label} · ${
                t.source === "live"
                  ? "from Zaptec"
                  : t.source === "derived"
                    ? "derived"
                    : "pending Straumvakt mapping"
              }`}
            >
              <span className="text-[10px] uppercase tracking-brand text-ink-500">
                {t.label}
              </span>
              <span
                className={cn(
                  t.source === "pending" && "italic text-ink-500",
                )}
              >
                {t.value}
              </span>
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  t.source === "live"
                    ? "bg-sv-green"
                    : t.source === "derived"
                      ? "bg-sv-sky"
                      : "bg-ink-500",
                )}
                aria-hidden="true"
              />
            </span>
            {!isLast ? (
              <ChevronRight className="h-3 w-3 shrink-0 text-ink-600" />
            ) : null}
          </span>
        );
      })}
    </nav>
  );
}
