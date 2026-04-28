"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const CONNECTOR_TYPES = ["Type2", "CCS2", "CHAdeMO", "Schuko"] as const;
const OCPP_VERSIONS = ["ocpp_1_6", "ocpp_2_0_1", "ocpp_2_1"] as const;
const ASSET_CLASSES = ["ac", "dc"] as const;

type Result = {
  chargingStationId: string;
  evseId: string;
  connectorId: string;
  ocppIdentityId: string;
  identityString: string;
  ocppPassword: string;
};

export function CreateChargerForm({ orgOptions }: { orgOptions: { id: string; label: string }[] }) {
  const router = useRouter();
  const [orgId, setOrgId] = useState(orgOptions[0]?.id ?? "");
  const [siteId, setSiteId] = useState("");
  const [installationId, setInstallationId] = useState("");
  const [circuitId, setCircuitId] = useState("");
  const [sites, setSites] = useState<{ id: string; displayName: string }[]>([]);
  const [installations, setInstallations] = useState<{ id: string; displayName: string }[]>([]);
  const [circuits, setCircuits] = useState<{ id: string; displayName: string }[]>([]);
  const [stationVendor, setStationVendor] = useState("");
  const [stationModel, setStationModel] = useState("");
  const [stationSerialNumber, setStationSerialNumber] = useState("");
  const [stationFirmwareVersion, setStationFirmwareVersion] = useState("");
  const [evseIndex, setEvseIndex] = useState("1");
  const [evseMaxPowerKw, setEvseMaxPowerKw] = useState("");
  const [evsePhaseCount, setEvsePhaseCount] = useState("");
  const [connectorIndex, setConnectorIndex] = useState("1");
  const [connectorType, setConnectorType] = useState<typeof CONNECTOR_TYPES[number]>("Type2");
  const [connectorMaxPowerKw, setConnectorMaxPowerKw] = useState("");
  const [identityString, setIdentityString] = useState("");
  const [ocppVersion, setOcppVersion] = useState<typeof OCPP_VERSIONS[number]>("ocpp_1_6");
  const [assetClass, setAssetClass] = useState<typeof ASSET_CLASSES[number]>("ac");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!orgId) return;
    fetch(`/api/admin/orgs/${orgId}/sites`).then((r) => r.json()).then((d: { sites?: { id: string; displayName: string }[] }) => {
      const list = d.sites ?? []; setSites(list); setSiteId(list[0]?.id ?? "");
    });
  }, [orgId]);

  useEffect(() => {
    if (!siteId) { setInstallations([]); setCircuits([]); return; }
    fetch(`/api/admin/sites/${siteId}/installations`).then((r) => r.json()).then((d: { installations?: { id: string; displayName: string }[] }) => setInstallations(d.installations ?? []));
    fetch(`/api/admin/sites/${siteId}/circuits`).then((r) => r.json()).then((d: { circuits?: { id: string; displayName: string }[] }) => setCircuits(d.circuits ?? []));
  }, [siteId]);

  function toNum(v: string): number | undefined {
    if (v.trim() === "") return undefined;
    const n = Number(v); return Number.isFinite(n) ? n : undefined;
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setError(null); setSubmitting(true);
    try {
      const res = await fetch("/api/admin/chargers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          orgId, siteId,
          installationId: installationId || undefined,
          circuitId: circuitId || undefined,
          stationVendor, stationModel, stationSerialNumber,
          stationFirmwareVersion: stationFirmwareVersion || undefined,
          evseIndex: toNum(evseIndex) ?? 1,
          evseMaxPowerKw: toNum(evseMaxPowerKw),
          evsePhaseCount: toNum(evsePhaseCount),
          connectorIndex: toNum(connectorIndex) ?? 1,
          connectorType,
          connectorMaxPowerKw: toNum(connectorMaxPowerKw),
          identityString,
          ocppVersion,
          assetClass,
        }),
      });
      const json = (await res.json().catch(() => null)) as Result & { ok: boolean; error?: string; issues?: { path: (string | number)[]; message: string }[] } | null;
      if (!res.ok || !json?.ok) {
        const issues = json?.issues?.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
        throw new Error(issues || json?.error || `HTTP ${res.status}`);
      }
      setResult(json); router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally { setSubmitting(false); }
  }

  if (result) {
    return (
      <div className="space-y-3">
        <div className="rounded-md border border-amber-700/50 bg-amber-950/30 p-3">
          <h3 className="text-xs font-semibold text-amber-200">OCPP password — one-time reveal</h3>
          <code className="mt-2 block break-all rounded border border-bg-border bg-bg-base/60 p-2 font-mono text-[11px] text-ink-50">{result.ocppPassword}</code>
          <button type="button" onClick={async () => { await navigator.clipboard.writeText(result.ocppPassword); setCopied(true); setTimeout(() => setCopied(false), 2000); }} className="mt-2 rounded bg-sv-sky/20 px-2 py-1 text-[11px] text-sv-sky">
            {copied ? "Copied ✓" : "Copy"}
          </button>
          <p className="mt-2 text-[10px] font-mono text-amber-300/60">Identity: {result.identityString}</p>
        </div>
        <button type="button" onClick={() => { setResult(null); setIdentityString(""); setStationSerialNumber(""); }} className="w-full rounded-md bg-bg-base/40 px-3 py-2 text-xs ring-1 ring-bg-border hover:bg-bg-base/60">
          Add another charger
        </button>
      </div>
    );
  }

  const valid = orgId && siteId && stationVendor.length > 0 && stationModel.length > 0 && stationSerialNumber.length > 0 && identityString.length >= 3;

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Section title="Location">
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label="Organization" required value={orgId} onChange={setOrgId} options={orgOptions.map((o) => ({ value: o.id, label: o.label }))} />
          <Select label="Site" required value={siteId} onChange={setSiteId} options={sites.map((s) => ({ value: s.id, label: s.displayName }))} placeholder={sites.length === 0 ? "(no sites)" : undefined} />
          <Select label="Installation (optional)" value={installationId} onChange={setInstallationId} options={[{ value: "", label: "— none —" }, ...installations.map((i) => ({ value: i.id, label: i.displayName }))]} />
          <Select label="Circuit (optional)" value={circuitId} onChange={setCircuitId} options={[{ value: "", label: "— none —" }, ...circuits.map((c) => ({ value: c.id, label: c.displayName }))]} />
        </div>
      </Section>

      <Section title="Charging station">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Vendor" required value={stationVendor} onChange={setStationVendor} placeholder="Zaptec" />
          <Field label="Model" required value={stationModel} onChange={setStationModel} placeholder="Pro" />
          <Field label="Serial number" required value={stationSerialNumber} onChange={setStationSerialNumber} mono placeholder="ZAP-12345" />
          <Field label="Firmware version" value={stationFirmwareVersion} onChange={setStationFirmwareVersion} mono />
        </div>
      </Section>

      <Section title="EVSE & Connector">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="EVSE index" value={evseIndex} onChange={setEvseIndex} mono />
          <Field label="EVSE max kW" value={evseMaxPowerKw} onChange={setEvseMaxPowerKw} mono />
          <Field label="EVSE phases" value={evsePhaseCount} onChange={setEvsePhaseCount} mono placeholder="3" />
          <Field label="Connector index" value={connectorIndex} onChange={setConnectorIndex} mono />
          <Select label="Connector type" required value={connectorType} onChange={(v) => setConnectorType(v as typeof CONNECTOR_TYPES[number])} options={CONNECTOR_TYPES.map((t) => ({ value: t, label: t }))} />
          <Field label="Connector max kW" value={connectorMaxPowerKw} onChange={setConnectorMaxPowerKw} mono placeholder="22" />
        </div>
      </Section>

      <Section title="OCPP identity">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Identity string" required value={identityString} onChange={setIdentityString} mono placeholder="straumvakt-test-01" />
          <Select label="OCPP version" value={ocppVersion} onChange={(v) => setOcppVersion(v as typeof OCPP_VERSIONS[number])} options={OCPP_VERSIONS.map((v) => ({ value: v, label: v }))} />
          <Select label="Asset class" value={assetClass} onChange={(v) => setAssetClass(v as typeof ASSET_CLASSES[number])} options={ASSET_CLASSES.map((v) => ({ value: v, label: v }))} />
        </div>
      </Section>

      {error && <div className="rounded border border-rose-700/40 bg-rose-950/30 p-2 text-xs text-rose-200">{error}</div>}
      <button type="submit" disabled={submitting || !valid} className="w-full rounded-md bg-sv-green/20 px-3 py-2 text-sm font-medium text-sv-green ring-1 ring-sv-green/30 hover:bg-sv-green/30 disabled:cursor-not-allowed disabled:opacity-40">
        {submitting ? "Creating…" : "Create charger"}
      </button>
    </form>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="rounded-md border border-bg-border/60 p-3">
      <legend className="px-1 text-[10px] font-semibold uppercase tracking-brand text-ink-300">{title}</legend>
      {children}
    </fieldset>
  );
}

function Field({ label, required, value, onChange, placeholder, mono }: { label: string; required?: boolean; value: string; onChange: (v: string) => void; placeholder?: string; mono?: boolean }) {
  return <label className="block"><span className="block text-[11px] font-semibold uppercase tracking-brand text-ink-400">{label}{required && <span className="ml-0.5 text-rose-400">*</span>}</span><input type="text" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={"mt-1 w-full rounded-md border border-bg-border bg-bg-base/50 px-3 py-2 text-sm text-ink-50 focus:border-sv-sky focus:outline-none " + (mono ? "font-mono" : "")} /></label>;
}
function Select({ label, required, value, onChange, options, placeholder }: { label: string; required?: boolean; value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; placeholder?: string }) {
  return <label className="block"><span className="block text-[11px] font-semibold uppercase tracking-brand text-ink-400">{label}{required && <span className="ml-0.5 text-rose-400">*</span>}</span><select value={value} onChange={(e) => onChange(e.target.value)} className="mt-1 w-full rounded-md border border-bg-border bg-bg-base/50 px-3 py-2 text-sm text-ink-50 focus:border-sv-sky focus:outline-none">{placeholder && <option value="" disabled>{placeholder}</option>}{options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>;
}
