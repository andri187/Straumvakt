import { Building2, Briefcase } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  DEMO_CPO,
  hostForInstallation,
  hostTypeLabel,
  type DemoChargerHost,
} from "@/lib/sv-demo-context";

// Compact identity strip: "CPO Straumvakt · Owner Dalvegur húsfélag"
// used on installation pages and charger detail headers.
export function SvIdentityBadges({
  installationId,
  demoTag = true,
  className,
}: {
  installationId: string | undefined;
  demoTag?: boolean;
  className?: string;
}) {
  const host = hostForInstallation(installationId);
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <IdentityBadge
        icon={Building2}
        role="CPO"
        name={DEMO_CPO.displayName}
        sub={`${DEMO_CPO.countryCode} · tenancy.organizations`}
        tone="brand"
      />
      <IdentityBadge
        icon={Briefcase}
        role="Owner"
        name={host.displayName}
        sub={`${hostTypeLabel(host.type)} · hosts.charger_hosts`}
        tone={host.id === "demo-host-unassigned" ? "grey" : "green"}
      />
      {demoTag ? (
        <span
          className="rounded-full bg-ink-600/30 px-2 py-0.5 text-[10px] uppercase tracking-brand text-ink-400 ring-1 ring-inset ring-ink-500/30"
          title="In production this comes from Prisma. This scratch app uses a hard-coded demo mapping per Zaptec installation."
        >
          demo mapping
        </span>
      ) : null}
    </div>
  );
}

export function IdentityBadge({
  icon: Icon,
  role,
  name,
  sub,
  tone,
}: {
  icon: typeof Building2;
  role: string;
  name: string;
  sub?: string;
  tone: "brand" | "green" | "grey";
}) {
  const tones = {
    brand: "bg-brand-500/10 text-sv-sky ring-brand-500/30",
    green: "bg-sv-green/10 text-sv-green ring-sv-green/30",
    grey: "bg-ink-600/20 text-ink-300 ring-ink-500/40",
  }[tone];
  const iconTone = {
    brand: "text-sv-sky",
    green: "text-sv-green",
    grey: "text-ink-400",
  }[tone];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-lg px-3 py-1.5 ring-1 ring-inset",
        tones,
      )}
      title={sub}
    >
      <Icon className={cn("h-3.5 w-3.5 shrink-0", iconTone)} />
      <span className="flex flex-col leading-tight">
        <span className="text-[10px] uppercase tracking-brand opacity-70">
          {role}
        </span>
        <span className="text-xs font-semibold">{name}</span>
      </span>
    </span>
  );
}

export function HostSupportInfo({
  installationId,
}: {
  installationId: string | undefined;
}) {
  const host = hostForInstallation(installationId);
  if (!host.supportPhone && !host.supportEmail) return null;
  return (
    <p className="text-xs text-ink-400">
      Host support:{" "}
      {host.supportPhone ? (
        <a className="text-sv-sky hover:underline" href={`tel:${host.supportPhone}`}>
          {host.supportPhone}
        </a>
      ) : null}
      {host.supportPhone && host.supportEmail ? " · " : null}
      {host.supportEmail ? (
        <a className="text-sv-sky hover:underline" href={`mailto:${host.supportEmail}`}>
          {host.supportEmail}
        </a>
      ) : null}
    </p>
  );
}

export type { DemoChargerHost };
