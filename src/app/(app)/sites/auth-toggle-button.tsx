"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-client";

/**
 * Single state-aware Auth toggle. Color reflects current state of
 * Zaptec's AuthenticationRequired flag in scope:
 *
 *   green     — auth ON across all chargers in scope
 *   red       — auth OFF across all chargers
 *   amber     — mixed (some on, some off — aggregate scopes only)
 *   grey      — unknown (Zaptec API unreachable / non-Zaptec scope)
 *
 * Click toggles to the opposite state. For mixed scopes, click sets
 * everything to ON (the more common operator intent — fix the
 * misconfigured ones to match the working ones). The confirm dialog
 * spells out exactly which direction it's about to go so a misclick
 * doesn't silently flip 30+ chargers.
 *
 * Same OCPP-handler-semantics caveat as elsewhere: this writes the
 * Zaptec portal flag the operator could flip manually. Reversible.
 */
type Scope =
  | { kind: "site"; siteId: string }
  | { kind: "installation"; installationId: string }
  | { kind: "circuit"; circuitId: string }
  | { kind: "charger"; chargingStationId: string };

export type AuthState = "all-on" | "all-off" | "mixed" | "unknown";

export function ZaptecAuthToggle({
  scope,
  state,
  count,
  label,
}: {
  scope: Scope;
  state: AuthState;
  /** Approximate count of chargers in scope, for the confirm dialog. */
  count: number;
  /** Visible label, e.g. site name "Dalvegur 10 - 14". */
  label: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  // What clicking the button DOES. From "all-on" we go to off; from
  // anything else (off, mixed, unknown) we default to on.
  const targetEnable = state !== "all-on";

  async function fire() {
    if (count === 0 || state === "unknown") return;
    const verb = targetEnable ? "Enable" : "Disable";
    const stateDesc =
      state === "all-on"
        ? "currently ON for all"
        : state === "all-off"
          ? "currently OFF for all"
          : "currently MIXED";
    if (
      !window.confirm(
        `${verb} OCPP auth on ${count} charger${count === 1 ? "" : "s"} under "${label}"?\n\nState: ${stateDesc}.\nWrites to Zaptec portal via API. Reversible — click again to toggle back.`,
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

  const tone =
    state === "all-on"
      ? "border-sv-green/40 bg-sv-green/10 text-sv-green hover:bg-sv-green/20"
      : state === "all-off"
        ? "border-rose-500/40 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20"
        : state === "mixed"
          ? "border-amber-500/40 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20"
          : "border-bg-border bg-bg-base/30 text-ink-600";

  const title = (() => {
    if (count === 0) return "No Zaptec chargers in this scope.";
    if (state === "unknown") return "Zaptec auth state unknown — Zaptec API unreachable.";
    const target = targetEnable ? "Enable" : "Disable";
    if (state === "all-on") return `Auth ON for all ${count} — click to ${target.toLowerCase()}`;
    if (state === "all-off") return `Auth OFF for all ${count} — click to ${target.toLowerCase()}`;
    return `Auth MIXED across ${count} — click to enable on all`;
  })();

  return (
    <button
      type="button"
      onClick={fire}
      disabled={busy || count === 0 || state === "unknown"}
      title={title}
      className={
        "shrink-0 rounded border px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-brand disabled:cursor-not-allowed disabled:opacity-40 " +
        tone
      }
    >
      {busy ? "…" : "Auth"}
    </button>
  );
}
