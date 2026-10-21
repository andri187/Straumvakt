"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-client";

/**
 * Combined OCPP emblem + Auth toggle. Replaces the previous pair
 * (separate "OCPP" status pill + "Auth on/off" button) with a
 * single clickable indicator that encodes the full OCPP config:
 *
 *   green  — OCPP mode set AND Basic-Auth enabled (fully configured,
 *            ready for our gateway)
 *   amber  — OCPP mode set but Basic-Auth DISABLED (the bug we keep
 *            hitting — Zaptec connects anonymously). Click → enable.
 *   red    — Some chargers in scope have OCPP misconfigured at a
 *            level we can't auto-fix (AuthenticationType ≠ OCPP).
 *            Click is disabled — fix in Zaptec portal.
 *   grey   — Unknown (Zaptec API unreachable / non-Zaptec scope).
 *
 * For aggregate scopes (site/installation/circuit), the worst-state
 * across the children wins so the operator's eye lands on rows that
 * need fixing.
 */
type Scope =
  | { kind: "site"; siteId: string }
  | { kind: "installation"; installationId: string }
  | { kind: "circuit"; circuitId: string }
  | { kind: "charger"; chargingStationId: string };

export type OcppEmblemState =
  | "ready"        // OCPP configured + auth enabled
  | "auth-off"     // OCPP configured but auth disabled — fixable
  | "misconfigured"// AuthenticationType ≠ OCPP — not auto-fixable
  | "unknown";

export function OcppEmblem({
  scope,
  state,
  count,
  label,
}: {
  scope: Scope;
  state: OcppEmblemState;
  /** Approximate count of chargers in scope, for the confirm dialog. */
  count: number;
  /** Visible label, e.g. site name "Dalvegur 10 - 14". */
  label: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  // Click semantics:
  //  - state="ready"     → flip auth OFF (rare, but enable the round-trip)
  //  - state="auth-off"  → flip auth ON (the common fix)
  //  - state="misconfigured" / "unknown" → button disabled
  const clickable = state === "ready" || state === "auth-off";
  const targetEnable = state === "auth-off";

  async function fire() {
    if (!clickable || count === 0) return;
    const verb = targetEnable ? "Enable" : "Disable";
    if (
      !window.confirm(
        `${verb} OCPP Basic-Auth on ${count} charger${count === 1 ? "" : "s"} under "${label}"?\n\n` +
          `Writes to Zaptec portal via API. Reversible — click again to toggle back.`,
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const res = await apiFetch("/api/admin/zaptec/bulk-auth", {
        method: "POST",
        body: JSON.stringify({ scope, enabled: targetEnable }),
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
        alert(`Toggle failed: ${body?.error ?? `HTTP ${res.status}`}`);
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

  const tone = (() => {
    switch (state) {
      case "ready":
        return "border-sv-green/40 bg-sv-green/10 text-sv-green hover:bg-sv-green/20";
      case "auth-off":
        return "border-amber-500/40 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20";
      case "misconfigured":
        return "border-rose-500/40 bg-rose-500/10 text-rose-300";
      case "unknown":
        return "border-bg-border bg-bg-base/30 text-ink-600";
    }
  })();
  const dotTone = (() => {
    switch (state) {
      case "ready":
        return "bg-sv-green";
      case "auth-off":
        return "bg-amber-400";
      case "misconfigured":
        return "bg-rose-400";
      case "unknown":
        return "bg-ink-600";
    }
  })();
  const title = (() => {
    if (count === 0) return "No Zaptec chargers in this scope.";
    switch (state) {
      case "ready":
        return `OCPP fully configured for ${count} — click to disable auth`;
      case "auth-off":
        return `OCPP mode set but Basic-Auth DISABLED on ${count} — click to enable`;
      case "misconfigured":
        return `AuthenticationType ≠ OCPP on some chargers — fix in Zaptec portal`;
      case "unknown":
        return `OCPP config unknown — Zaptec API unreachable`;
    }
  })();

  return (
    <button
      type="button"
      onClick={fire}
      disabled={busy || !clickable || count === 0}
      title={title}
      className={
        "inline-flex shrink-0 items-center gap-1 rounded border px-1 py-0.5 text-[9px] font-mono uppercase tracking-brand disabled:cursor-not-allowed " +
        tone
      }
    >
      <span className={`h-1.5 w-1.5 rounded-full ${dotTone}`} />
      {busy ? "…" : "OCPP"}
    </button>
  );
}
