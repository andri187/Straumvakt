"use client";

import { useRouter } from "next/navigation";
import { Package, Plug, Wifi, WifiOff } from "lucide-react";

export type PickerInstallation = {
  id: string;
  name: string;
  chargers: Array<{
    id: string;
    name: string;
    online: boolean;
  }>;
};

export function ChargerPicker({
  installations,
  selectedInstallationId,
  selectedChargerId,
}: {
  installations: PickerInstallation[];
  selectedInstallationId: string;
  selectedChargerId: string;
}) {
  const router = useRouter();
  const currentInst = installations.find((i) => i.id === selectedInstallationId);
  const currentCharger = currentInst?.chargers.find((c) => c.id === selectedChargerId);

  function pickInstallation(newId: string) {
    const inst = installations.find((i) => i.id === newId);
    const firstCharger = inst?.chargers[0]?.id;
    const params = new URLSearchParams();
    params.set("installation", newId);
    if (firstCharger) params.set("charger", firstCharger);
    router.push(`/technician?${params.toString()}`);
  }

  function pickCharger(newId: string) {
    const params = new URLSearchParams();
    params.set("installation", selectedInstallationId);
    params.set("charger", newId);
    router.push(`/technician?${params.toString()}`);
  }

  return (
    <section className="mb-6 grid gap-4 rounded-xl border border-bg-border bg-bg-surface/70 p-5 shadow-card backdrop-blur sm:grid-cols-2">
      {/* Installation dropdown */}
      <div>
        <label
          htmlFor="installation-picker"
          className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-brand text-sv-sky"
        >
          <Package className="h-3 w-3" />
          Installation
        </label>
        <div className="relative mt-1.5">
          <select
            id="installation-picker"
            value={selectedInstallationId}
            onChange={(e) => pickInstallation(e.target.value)}
            className="w-full appearance-none rounded-md border border-bg-border bg-bg-inset/60 px-3 py-2.5 pr-9 text-sm font-semibold text-ink-50 hover:bg-bg-raised/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            {installations.map((i) => (
              <option key={i.id} value={i.id} className="bg-bg-surface">
                {i.name} · {i.chargers.length} chargers
              </option>
            ))}
          </select>
          <span
            aria-hidden="true"
            className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-400"
          >
            ▾
          </span>
        </div>
        <p className="mt-1 text-[11px] text-ink-500">
          {installations.length} installation{installations.length === 1 ? "" : "s"}
          {" "}available
        </p>
      </div>

      {/* Charger dropdown */}
      <div>
        <label
          htmlFor="charger-picker"
          className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-brand text-sv-sky"
        >
          <Plug className="h-3 w-3" />
          Charger
          {currentCharger ? (
            <span
              className={
                currentCharger.online
                  ? "ml-1 inline-flex items-center gap-1 text-sv-green"
                  : "ml-1 inline-flex items-center gap-1 text-red-300"
              }
            >
              {currentCharger.online ? (
                <Wifi className="h-3 w-3" />
              ) : (
                <WifiOff className="h-3 w-3" />
              )}
              {currentCharger.online ? "online" : "offline"}
            </span>
          ) : null}
        </label>
        <div className="relative mt-1.5">
          <select
            id="charger-picker"
            value={selectedChargerId}
            onChange={(e) => pickCharger(e.target.value)}
            disabled={!currentInst || currentInst.chargers.length === 0}
            className="w-full appearance-none rounded-md border border-bg-border bg-bg-inset/60 px-3 py-2.5 pr-9 text-sm font-semibold text-ink-50 hover:bg-bg-raised/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:opacity-60"
          >
            {(currentInst?.chargers ?? []).map((c) => (
              <option key={c.id} value={c.id} className="bg-bg-surface">
                {c.name} {c.online ? "· online" : "· offline"}
              </option>
            ))}
            {!currentInst?.chargers.length ? (
              <option value="" className="bg-bg-surface">
                No chargers in this installation
              </option>
            ) : null}
          </select>
          <span
            aria-hidden="true"
            className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-400"
          >
            ▾
          </span>
        </div>
        <p className="mt-1 text-[11px] text-ink-500">
          {currentInst?.chargers.length ?? 0} charger
          {currentInst?.chargers.length === 1 ? "" : "s"} in this installation
        </p>
      </div>
    </section>
  );
}
