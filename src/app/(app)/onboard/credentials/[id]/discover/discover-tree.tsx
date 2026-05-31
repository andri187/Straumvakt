"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-client";
import type {
  VendorCredentialProbe,
  VendorCredentialProbeCharger,
  VendorCredentialProbeChargerStatus,
  VendorCredentialProbeInstallation,
} from "@straumvakt/shared/domain/vendor-credential-probe";

// Sprint 9 — PROBE-2 discovery tree. Renders the installation →
// charger inventory with the four-state status badges. The "Attach"
// and "Onboard" buttons are stubbed (disabled, tooltip points to
// PROBE-3 / PROBE-4) so the operator can see exactly where they'll
// land when the sibling agents merge.

export function DiscoverTree({
  credentialId,
  initialProbe,
}: {
  credentialId: string;
  initialProbe: VendorCredentialProbe;
}) {
  const router = useRouter();
  const [probe, setProbe] = useState<VendorCredentialProbe>(initialProbe);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setError(null);
    setBusy(true);
    try {
      const res = await apiFetch(
        `/api/admin/vendor-credentials/${credentialId}/probe`,
        { method: "POST" },
      );
      const body = (await res.json().catch(() => null)) as
        | { probe: VendorCredentialProbe; error?: undefined }
        | { error: string }
        | null;
      if (!res.ok || !body || "error" in body) {
        setError(
          (body as { error?: string } | null)?.error ?? `HTTP ${res.status}`,
        );
        return;
      }
      setProbe(body.probe);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const { summary, installations } = probe;
  const hasInstallations = installations.length > 0;

  return (
    <div>
      <SummaryTile summary={summary} />

      <div className="mb-4 flex items-center justify-end gap-2">
        {error && <span className="text-[11px] text-rose-300">{error}</span>}
        <button
          type="button"
          onClick={refresh}
          disabled={busy}
          className="rounded border border-bg-border bg-bg-base/40 px-3 py-1 text-xs text-ink-300 hover:bg-bg-raised hover:text-ink-50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? "Re-probing…" : "Refresh"}
        </button>
      </div>

      {!hasInstallations ? (
        <div className="rounded border border-dashed border-bg-border p-8 text-center text-sm text-ink-400">
          <p>No installations visible to this credential in Zaptec.</p>
          <p className="mt-2 text-xs text-ink-500">
            Either the credential has no installations attached, or Zaptec returned
            an empty list. Check the credential's portal permissions.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-bg-border/60 rounded-md border border-bg-border bg-bg-base/30">
          {installations.map((inst) => (
            <InstallationRow key={inst.zaptecInstallationId} inst={inst} />
          ))}
        </div>
      )}
    </div>
  );
}

function SummaryTile({
  summary,
}: {
  summary: VendorCredentialProbe["summary"];
}) {
  return (
    <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
      <Tile label="Installations" value={summary.totalInstallations} />
      <Tile label="Chargers" value={summary.totalChargers} />
      <Tile
        label="Onboarded"
        value={summary.onboardedTotal}
        tone={summary.onboardedTotal > 0 ? "emerald" : "neutral"}
      />
      <Tile
        label="Needs attach"
        value={summary.needsAttachTotal}
        tone={summary.needsAttachTotal > 0 ? "amber" : "neutral"}
      />
      <Tile
        label="Not onboarded"
        value={summary.notOnboardedTotal}
        tone={summary.notOnboardedTotal > 0 ? "sky" : "neutral"}
      />
    </div>
  );
}

function Tile({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: number;
  tone?: "neutral" | "emerald" | "amber" | "sky";
}) {
  const valueTone =
    tone === "emerald"
      ? "text-emerald-300"
      : tone === "amber"
        ? "text-amber-300"
        : tone === "sky"
          ? "text-sv-sky"
          : "text-ink-100";
  return (
    <div className="rounded-md border border-bg-border bg-bg-base/40 px-3 py-2.5">
      <div className="text-[10px] uppercase tracking-brand text-ink-500">
        {label}
      </div>
      <div className={`mt-0.5 text-xl font-semibold tabular-nums ${valueTone}`}>
        {value}
      </div>
    </div>
  );
}

function InstallationRow({
  inst,
}: {
  inst: VendorCredentialProbeInstallation;
}) {
  const allOnboarded =
    inst.totalCount > 0 && inst.onboardedCount === inst.totalCount;
  const noneOnboarded = inst.onboardedCount === 0;
  return (
    <details className="group" open={inst.totalCount > 0 && inst.totalCount <= 12}>
      <summary className="flex cursor-pointer items-center gap-3 px-4 py-2.5 hover:bg-bg-base/20">
        <span className="text-ink-500 transition-transform group-open:rotate-90">
          ▸
        </span>
        <div className="flex flex-1 items-baseline gap-2 min-w-0">
          <span className="text-sm font-medium text-ink-50 truncate">
            {inst.name}
          </span>
          {inst.address && (
            <span className="text-[11px] text-ink-400 truncate">{inst.address}</span>
          )}
          <span className="font-mono text-[10px] text-ink-500 truncate">
            {inst.zaptecInstallationId.slice(0, 8)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={
              "rounded px-1.5 py-0.5 text-[10px] " +
              (allOnboarded
                ? "bg-emerald-500/10 text-emerald-300"
                : noneOnboarded
                  ? "bg-sv-sky/10 text-sv-sky"
                  : "bg-amber-500/10 text-amber-300")
            }
          >
            {inst.onboardedCount}/{inst.totalCount} onboarded
          </span>
          {noneOnboarded && inst.totalCount > 0 && (
            <button
              type="button"
              disabled
              title="Coming soon — PROBE-4 will wire whole-installation onboard"
              className="rounded border border-bg-border bg-bg-base/40 px-2.5 py-1 text-[11px] text-ink-400 disabled:cursor-not-allowed disabled:opacity-50"
              onClick={(e) => e.stopPropagation()}
            >
              Onboard installation
            </button>
          )}
        </div>
      </summary>
      <div className="border-t border-bg-border/40 bg-bg-base/20 px-4 py-2">
        {inst.chargers.length === 0 ? (
          <p className="px-1 py-2 text-[11px] italic text-ink-500">
            No chargers on this installation.
          </p>
        ) : (
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="text-[10px] uppercase tracking-brand text-ink-500">
                <th className="py-1.5 pl-2 pr-3 font-medium">Serial / Name</th>
                <th className="py-1.5 pr-3 font-medium">Zaptec UUID</th>
                <th className="py-1.5 pr-3 font-medium">Status</th>
                <th className="py-1.5 pr-3 font-medium">Our org</th>
                <th className="py-1.5 pr-2 text-right font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y divide-bg-border/40">
              {inst.chargers.map((ch) => (
                <ChargerRow key={ch.zaptecChargerId} ch={ch} />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </details>
  );
}

function ChargerRow({ ch }: { ch: VendorCredentialProbeCharger }) {
  return (
    <tr className="hover:bg-bg-base/30">
      <td className="py-1.5 pl-2 pr-3">
        <div className="font-mono text-ink-100">
          {ch.serialNumber ?? ch.displayName}
        </div>
        {ch.serialNumber && ch.displayName !== ch.serialNumber && (
          <div className="text-[10px] text-ink-400">{ch.displayName}</div>
        )}
      </td>
      <td className="py-1.5 pr-3 font-mono text-[10px] text-ink-500">
        {ch.zaptecChargerId.slice(0, 8)}…
      </td>
      <td className="py-1.5 pr-3">
        <StatusBadge status={ch.status} />
      </td>
      <td className="py-1.5 pr-3 text-xs">
        {ch.ourOrgName ? (
          <span className="text-ink-200">{ch.ourOrgName}</span>
        ) : (
          <span className="text-ink-500">—</span>
        )}
      </td>
      <td className="py-1.5 pr-2 text-right">
        <ChargerAction status={ch.status} />
      </td>
    </tr>
  );
}

function StatusBadge({ status }: { status: VendorCredentialProbeChargerStatus }) {
  const { label, tone } = ((): {
    label: string;
    tone: "emerald" | "amber" | "sky" | "neutral";
  } => {
    switch (status) {
      case "onboarded_linked":
        return { label: "Linked to this credential", tone: "emerald" };
      case "onboarded_unlinked":
        return { label: "Onboarded — needs attach", tone: "amber" };
      case "onboarded_other_credential":
        return { label: "Onboarded under different credential", tone: "sky" };
      case "not_onboarded":
        return { label: "Not onboarded", tone: "neutral" };
    }
  })();
  const cls =
    tone === "emerald"
      ? "border-emerald-700/40 bg-emerald-950/40 text-emerald-300"
      : tone === "amber"
        ? "border-amber-700/40 bg-amber-950/40 text-amber-300"
        : tone === "sky"
          ? "border-sv-sky/40 bg-sv-sky/10 text-sv-sky"
          : "border-bg-border bg-bg-base/40 text-ink-300";
  return (
    <span
      className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium ${cls}`}
    >
      {label}
    </span>
  );
}

function ChargerAction({
  status,
}: {
  status: VendorCredentialProbeChargerStatus;
}) {
  // PROBE-3 / PROBE-4 will wire these. Disabled stubs make the
  // landing spot visible to the operator (and to the integration agent).
  if (status === "onboarded_unlinked") {
    return (
      <button
        type="button"
        disabled
        title="Coming soon — PROBE-3 will wire the attach-to-credential action"
        className="rounded border border-amber-700/40 bg-amber-950/30 px-2 py-0.5 text-[10px] text-amber-300/80 disabled:cursor-not-allowed disabled:opacity-50"
      >
        Attach to credential
      </button>
    );
  }
  if (status === "not_onboarded") {
    return (
      <button
        type="button"
        disabled
        title="Coming soon — PROBE-4 will wire the per-charger onboard action"
        className="rounded border border-bg-border bg-bg-base/40 px-2 py-0.5 text-[10px] text-ink-400 disabled:cursor-not-allowed disabled:opacity-50"
      >
        Onboard charger
      </button>
    );
  }
  return null;
}
