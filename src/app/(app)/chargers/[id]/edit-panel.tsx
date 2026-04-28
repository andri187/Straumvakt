"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const CONNECTOR_TYPES = ["Type2", "CCS2", "CHAdeMO", "Schuko"] as const;

type Initial = {
  stationVendor: string;
  stationModel: string;
  stationSerialNumber: string;
  stationFirmwareVersion: string;
  installationId: string;
  circuitId: string;
  evseId: string;
  evseMaxPowerKw: string;
  evsePhaseCount: string;
  connectorId: string;
  connectorType: string;
  connectorMaxPowerKw: string;
};

export function EditChargerPanel({
  chargingStationId,
  installationOptions,
  circuitOptions,
  initial,
}: {
  chargingStationId: string;
  installationOptions: { id: string; displayName: string }[];
  circuitOptions: { id: string; displayName: string }[];
  initial: Initial;
}) {
  const router = useRouter();
  const [s, setS] = useState<Initial>(initial);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function set<K extends keyof Initial>(k: K, v: string) { setS((p) => ({ ...p, [k]: v })); setSaved(false); }

  function toNum(v: string): number | undefined {
    if (v.trim() === "") return undefined;
    const n = Number(v); return Number.isFinite(n) ? n : undefined;
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setError(null); setSubmitting(true); setSaved(false);
    try {
      const body: Record<string, unknown> = {
        stationVendor: s.stationVendor,
        stationModel: s.stationModel,
        stationSerialNumber: s.stationSerialNumber,
        stationFirmwareVersion: s.stationFirmwareVersion || undefined,
        installationId: s.installationId || null,
        circuitId: s.circuitId || null,
      };
      if (s.evseId) {
        body.evseId = s.evseId;
        body.evseMaxPowerKw = toNum(s.evseMaxPowerKw) ?? null;
        body.evsePhaseCount = toNum(s.evsePhaseCount) ?? null;
      }
      if (s.connectorId) {
        body.connectorId = s.connectorId;
        body.connectorType = s.connectorType;
        body.connectorMaxPowerKw = toNum(s.connectorMaxPowerKw) ?? null;
      }
      const res = await fetch(`/api/admin/charging-stations/${chargingStationId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => null)) as { error?: string; issues?: { path: (string | number)[]; message: string }[] } | null;
        throw new Error(b?.issues?.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") || b?.error || `HTTP ${res.status}`);
      }
      setSaved(true); router.refresh();
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); } finally { setSubmitting(false); }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <fieldset className="rounded border border-bg-border/60 p-3">
        <legend className="px-1 text-[10px] font-semibold uppercase tracking-brand text-ink-300">Charging station</legend>
        <div className="space-y-2">
          <Field label="Vendor" required value={s.stationVendor} onChange={(v) => set("stationVendor", v)} />
          <Field label="Model" required value={s.stationModel} onChange={(v) => set("stationModel", v)} />
          <Field label="Serial number" required value={s.stationSerialNumber} onChange={(v) => set("stationSerialNumber", v)} mono />
          <Field label="Firmware version" value={s.stationFirmwareVersion} onChange={(v) => set("stationFirmwareVersion", v)} mono />
          <Select label="Installation" value={s.installationId} onChange={(v) => set("installationId", v)} options={[{ value: "", label: "— none —" }, ...installationOptions.map((i) => ({ value: i.id, label: i.displayName }))]} />
          <Select label="Circuit" value={s.circuitId} onChange={(v) => set("circuitId", v)} options={[{ value: "", label: "— none —" }, ...circuitOptions.map((c) => ({ value: c.id, label: c.displayName }))]} />
        </div>
      </fieldset>

      {s.evseId && (
        <fieldset className="rounded border border-bg-border/60 p-3">
          <legend className="px-1 text-[10px] font-semibold uppercase tracking-brand text-ink-300">EVSE</legend>
          <div className="space-y-2">
            <Field label="Max power (kW)" value={s.evseMaxPowerKw} onChange={(v) => set("evseMaxPowerKw", v)} mono />
            <Field label="Phase count" value={s.evsePhaseCount} onChange={(v) => set("evsePhaseCount", v)} mono />
          </div>
        </fieldset>
      )}

      {s.connectorId && (
        <fieldset className="rounded border border-bg-border/60 p-3">
          <legend className="px-1 text-[10px] font-semibold uppercase tracking-brand text-ink-300">Connector</legend>
          <div className="space-y-2">
            <Select label="Type" value={s.connectorType} onChange={(v) => set("connectorType", v)} options={CONNECTOR_TYPES.map((t) => ({ value: t, label: t }))} />
            <Field label="Max power (kW)" value={s.connectorMaxPowerKw} onChange={(v) => set("connectorMaxPowerKw", v)} mono />
          </div>
        </fieldset>
      )}

      {error && <div className="rounded border border-rose-700/40 bg-rose-950/30 p-2 text-xs text-rose-200">{error}</div>}
      {saved && <div className="rounded border border-sv-green/40 bg-sv-green/10 p-2 text-xs text-sv-green">Saved.</div>}

      <button type="submit" disabled={submitting} className="rounded-md bg-sv-green/20 px-3 py-2 text-sm font-medium text-sv-green ring-1 ring-sv-green/30 hover:bg-sv-green/30 disabled:cursor-not-allowed disabled:opacity-40">
        {submitting ? "Saving…" : "Save changes"}
      </button>

      <p className="text-[10px] text-ink-500">
        OCPP identity (Basic-Auth password) is not editable from here. To rotate, re-provision a new charger and decommission this one.
      </p>
    </form>
  );
}

function Field({ label, required, value, onChange, mono }: { label: string; required?: boolean; value: string; onChange: (v: string) => void; mono?: boolean }) {
  return <label className="block"><span className="block text-[11px] font-semibold uppercase tracking-brand text-ink-400">{label}{required && <span className="ml-0.5 text-rose-400">*</span>}</span><input type="text" value={value} onChange={(e) => onChange(e.target.value)} className={"mt-1 w-full rounded-md border border-bg-border bg-bg-base/50 px-3 py-2 text-sm text-ink-50 focus:border-sv-sky focus:outline-none " + (mono ? "font-mono" : "")} /></label>;
}
function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return <label className="block"><span className="block text-[11px] font-semibold uppercase tracking-brand text-ink-400">{label}</span><select value={value} onChange={(e) => onChange(e.target.value)} className="mt-1 w-full rounded-md border border-bg-border bg-bg-base/50 px-3 py-2 text-sm text-ink-50 focus:border-sv-sky focus:outline-none">{options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>;
}
