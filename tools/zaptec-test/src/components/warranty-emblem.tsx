import { ShieldCheck, ShieldOff, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/cn";
import { computeWarranty, fmtYears, type WarrantyStatus } from "@/lib/warranty";

export type WarrantyEmblemProps = {
  commissionIso: string | null | undefined;
  // Visual size preset
  variant?: "badge" | "card" | "icon";
  // Adds a soft brand glow when in warranty (used in list rows for emphasis)
  glow?: boolean;
};

function tone(w: WarrantyStatus): "green" | "amber" | "red" | "grey" {
  if (w.commissionedAt == null) return "grey";
  if (!w.inWarranty) return "red";
  if (w.daysRemaining != null && w.daysRemaining < 180) return "amber";
  return "green";
}

const TONES = {
  green: {
    ring: "ring-sv-green/40",
    bg: "bg-sv-green/10",
    text: "text-sv-green",
    icon: ShieldCheck,
    label: "In warranty",
  },
  amber: {
    ring: "ring-yellow-500/40",
    bg: "bg-yellow-500/10",
    text: "text-yellow-300",
    icon: ShieldAlert,
    label: "Warranty ends soon",
  },
  red: {
    ring: "ring-red-500/40",
    bg: "bg-red-500/10",
    text: "text-red-300",
    icon: ShieldOff,
    label: "Out of warranty",
  },
  grey: {
    ring: "ring-ink-500/40",
    bg: "bg-ink-600/10",
    text: "text-ink-400",
    icon: ShieldAlert,
    label: "Warranty unknown",
  },
} as const;

export function WarrantyEmblem({
  commissionIso,
  variant = "badge",
  glow = false,
}: WarrantyEmblemProps) {
  const w = computeWarranty(commissionIso);
  const t = TONES[tone(w)];
  const Icon = t.icon;

  const fmtDate = (d: Date | null) =>
    d
      ? d.toLocaleDateString(undefined, {
          year: "numeric",
          month: "short",
          day: "2-digit",
        })
      : "—";

  const title = w.commissionedAt
    ? `Commissioned ${fmtDate(w.commissionedAt)} · warranty ${
        w.inWarranty ? "ends" : "ended"
      } ${fmtDate(w.expiresAt)}`
    : "Commission date unknown";

  // Glow only when in warranty
  const glowCls = glow && w.inWarranty
    ? "shadow-[0_0_12px_rgba(62,233,167,0.45)]"
    : "";

  if (variant === "icon") {
    // Two-state only: green ShieldCheck (in warranty) or red ShieldOff (out).
    // No amber/grey here — the list view wants a binary at-a-glance signal.
    const inWarranty = w.inWarranty;
    const ringCls = inWarranty
      ? "ring-sv-green/40 bg-sv-green/10 text-sv-green"
      : "ring-red-500/40 bg-red-500/10 text-red-300";
    const glowOn = inWarranty
      ? "shadow-[0_0_12px_rgba(62,233,167,0.55)]"
      : "";
    const IconCmp = inWarranty ? ShieldCheck : ShieldOff;
    return (
      <span
        className={cn(
          "inline-flex h-6 w-6 items-center justify-center rounded-full ring-1 ring-inset",
          ringCls,
          glow ? glowOn : "",
        )}
        title={title}
        aria-label={inWarranty ? "In warranty" : "Out of warranty"}
      >
        <IconCmp className="h-3 w-3" />
      </span>
    );
  }

  if (variant === "badge") {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-brand ring-1 ring-inset",
          t.ring,
          t.bg,
          t.text,
          glowCls,
        )}
        title={title}
      >
        <Icon className="h-3 w-3" />
        {t.label}
      </span>
    );
  }

  // Card variant — compact, with dates
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-lg p-4 ring-1 ring-inset",
        t.ring,
        t.bg,
      )}
    >
      <span
        className={cn(
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset",
          t.ring,
          "bg-bg-surface/60",
          t.text,
        )}
      >
        <Icon className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className={cn("text-sm font-semibold", t.text)}>{t.label}</p>
        <p className="mt-0.5 text-xs text-ink-300">
          {w.commissionedAt ? (
            <>
              Commissioned {fmtDate(w.commissionedAt)} ·{" "}
              {fmtYears(w.yearsInService)} in service
            </>
          ) : (
            "Commission date not reported by Zaptec"
          )}
        </p>
        {w.expiresAt ? (
          <p className="mt-0.5 text-xs text-ink-400">
            Warranty {w.inWarranty ? "ends" : "ended"} {fmtDate(w.expiresAt)}
            {w.daysRemaining != null ? (
              <span className="ml-1 text-ink-500">
                (
                {w.daysRemaining >= 0
                  ? `${w.daysRemaining} days left`
                  : `${Math.abs(w.daysRemaining)} days ago`}
                )
              </span>
            ) : null}
          </p>
        ) : null}
      </div>
    </div>
  );
}
