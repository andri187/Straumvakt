"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-client";

/**
 * Bulk-toggle Zaptec's AuthenticationRequired flag across a tree
 * scope. Per-row button on the /sites tree — click to enable or
 * disable OCPP Basic-Auth on every Zaptec charger underneath.
 *
 * Same effect as ticking "Authorisation required" in the Zaptec
 * portal, just bulk-applied via API. Confirms before firing so a
 * misclick at site level doesn't silently flip 30+ chargers.
 *
 * Cascade scope:
 *   site         → every charger on every installation under the site
 *   installation → every charger under the installation
 *   circuit      → every charger on the circuit
 *   charger      → a single charger
 *
 * After success, router.refresh() re-fetches the tree so the
 * API/OCPP emblems pick up the new state on next charger reconnect
 * (typically within ~30s for chargers that aren't in long backoff).
 */
type Scope =
  | { kind: "site"; siteId: string }
  | { kind: "installation"; installationId: string }
  | { kind: "circuit"; circuitId: string }
  | { kind: "charger"; chargingStationId: string };

export function ZaptecAuthToggle({
  scope,
  enabled,
  count,
  label,
}: {
  scope: Scope;
  /** True = button will SEND auth-on (turn it on). False = button will SEND auth-off. */
  enabled: boolean;
  /** Approximate count of chargers in scope, for the confirm dialog + button label. */
  count: number;
  /** Visible label, e.g. site name "Dalvegur 10 - 14". */
  label: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function fire() {
    if (count === 0) return;
    const verb = enabled ? "enable" : "disable";
    if (
      !window.confirm(
        `${verb.charAt(0).toUpperCase() + verb.slice(1)} OCPP auth on ${count} charger${count === 1 ? "" : "s"} under "${label}"?\n\nThis writes to the Zaptec portal via API. Reversible — you can toggle back any time.`,
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const res = await apiFetch("/api/admin/zaptec/bulk-auth", {
        method: "POST",
        body: JSON.stringify({ scope, enabled }),
      });
      const body = (await res.json().catch(() => null)) as
        | {
            ok?: boolean;
            updated?: number;
            attempted?: number;
            failed?: { identityString: string | null; reason: string }[];
            error?: string;
          }
        | null;
      if (!res.ok) {
        alert(`Bulk auth toggle failed: ${body?.error ?? `HTTP ${res.status}`}`);
        return;
      }
      const failedCount = body?.failed?.length ?? 0;
      if (failedCount > 0) {
        alert(
          `Updated ${body?.updated ?? 0} / ${body?.attempted ?? 0}.\n` +
            `Failed:\n${(body?.failed ?? [])
              .map((f) => `  • ${f.identityString ?? "?"} — ${f.reason}`)
              .join("\n")}`,
        );
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const tone = enabled
    ? "border-sv-green/40 bg-sv-green/10 text-sv-green hover:bg-sv-green/20"
    : "border-rose-500/30 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20";

  return (
    <button
      type="button"
      onClick={fire}
      disabled={busy || count === 0}
      title={
        count === 0
          ? "No Zaptec chargers in this scope."
          : `${enabled ? "Enable" : "Disable"} OCPP auth on ${count} charger${count === 1 ? "" : "s"}`
      }
      className={
        "shrink-0 rounded border px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-brand disabled:cursor-not-allowed disabled:opacity-40 " +
        tone
      }
    >
      {busy ? "…" : enabled ? `auth on` : `auth off`}
    </button>
  );
}
