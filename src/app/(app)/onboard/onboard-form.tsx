"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const ORG_ROLES = [
  "csms_provider",
  "operator",
  "service_contractor",
  "installer",
  "vendor",
  "asset_owner",
  "payer",
  "beneficiary",
  "customer",
  "retailer",
  "dso",
  "tso",
  "producer",
  "aggregator",
  "public_charging",
  "home_charging",
  "emsp",
  "roaming_hub",
  "payment_processor",
  "insurance_provider",
  "regulator",
] as const;

const SITE_TYPES = ["standard", "workplace", "mdu", "hotel", "fleet", "retail"] as const;
const ACCESS_LEVELS = ["public", "private", "taxi_only"] as const;
const POWER_CLASSES = [
  "",
  "lt_50kw",
  "between_50_150kw",
  "between_150_500kw",
  "gt_500kw",
] as const;
const CONNECTOR_TYPES = ["Type2", "CCS2", "CHAdeMO", "Schuko"] as const;
const OCPP_VERSIONS = ["ocpp_1_6", "ocpp_2_0_1", "ocpp_2_1"] as const;
const ASSET_CLASSES = ["ac", "dc"] as const;

type FormState = {
  // Org
  orgSlug: string;
  orgDisplayName: string;
  orgKennitala: string;
  orgLegalName: string;
  orgRoles: string[];
  orgCountryCode: string;
  orgDefaultCurrency: string;
  orgLegalForm: string;
  orgVskNr: string;
  orgLeiCode: string;
  orgRegulatorLicenceNo: string;
  orgNotes: string;
  orgAddressStreet: string;
  orgAddressCity: string;
  orgAddressPostalCode: string;
  orgContactName: string;
  orgContactEmail: string;
  orgContactPhone: string;
  // Property
  propertyDisplayName: string;
  propertyStreet: string;
  propertyCity: string;
  propertyPostalCode: string;
  propertyLatitude: string;
  propertyLongitude: string;
  // Site
  siteDisplayName: string;
  siteType: string;
  siteTimezone: string;
  siteAccessLevel: string;
  sitePowerClass: string;
  // Station
  stationVendor: string;
  stationModel: string;
  stationSerialNumber: string;
  stationFirmwareVersion: string;
  stationInstallDate: string;
  // EVSE
  evseIndex: string;
  evseMaxPowerKw: string;
  evsePhaseCount: string;
  // Connector
  connectorType: string;
  connectorIndex: string;
  connectorMaxPowerKw: string;
  // Identity
  identityString: string;
  ocppVersion: string;
  assetClass: string;
};

const INITIAL: FormState = {
  orgSlug: "",
  orgDisplayName: "",
  orgKennitala: "",
  orgLegalName: "",
  orgRoles: [],
  orgCountryCode: "IS",
  orgDefaultCurrency: "ISK",
  orgLegalForm: "",
  orgVskNr: "",
  orgLeiCode: "",
  orgRegulatorLicenceNo: "",
  orgNotes: "",
  orgAddressStreet: "",
  orgAddressCity: "",
  orgAddressPostalCode: "",
  orgContactName: "",
  orgContactEmail: "",
  orgContactPhone: "",
  propertyDisplayName: "",
  propertyStreet: "",
  propertyCity: "",
  propertyPostalCode: "",
  propertyLatitude: "",
  propertyLongitude: "",
  siteDisplayName: "",
  siteType: "standard",
  siteTimezone: "Atlantic/Reykjavik",
  siteAccessLevel: "private",
  sitePowerClass: "",
  stationVendor: "",
  stationModel: "",
  stationSerialNumber: "",
  stationFirmwareVersion: "",
  stationInstallDate: "",
  evseIndex: "1",
  evseMaxPowerKw: "",
  evsePhaseCount: "",
  connectorType: "Type2",
  connectorIndex: "1",
  connectorMaxPowerKw: "",
  identityString: "",
  ocppVersion: "ocpp_1_6",
  assetClass: "ac",
};

type Result = {
  orgId: string;
  orgSlug: string;
  propertyId: string;
  siteId: string;
  chargingStationId: string;
  evseId: string;
  connectorId: string;
  ocppIdentityId: string;
  identityString: string;
  ocppPassword: string;
};

export function OnboardForm() {
  const router = useRouter();
  const [s, setS] = useState<FormState>(INITIAL);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  function set<K extends keyof FormState>(k: K, v: FormState[K]) {
    setS((prev) => ({ ...prev, [k]: v }));
  }

  function toggleRole(role: string) {
    setS((prev) =>
      prev.orgRoles.includes(role)
        ? { ...prev, orgRoles: prev.orgRoles.filter((r) => r !== role) }
        : { ...prev, orgRoles: [...prev.orgRoles, role] },
    );
  }

  function toNum(v: string): number | undefined {
    if (v.trim() === "") return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const body = {
        ...s,
        orgRoles: s.orgRoles,
        propertyLatitude: toNum(s.propertyLatitude),
        propertyLongitude: toNum(s.propertyLongitude),
        evseIndex: toNum(s.evseIndex) ?? 1,
        evseMaxPowerKw: toNum(s.evseMaxPowerKw),
        evsePhaseCount: toNum(s.evsePhaseCount),
        connectorIndex: toNum(s.connectorIndex) ?? 1,
        connectorMaxPowerKw: toNum(s.connectorMaxPowerKw),
        sitePowerClass: s.sitePowerClass === "" ? undefined : s.sitePowerClass,
      };
      const res = await fetch("/api/admin/onboarding/chains", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => null)) as
        | (Result & { ok: boolean })
        | { error?: string; issues?: { path: (string | number)[]; message: string }[] }
        | null;
      if (!res.ok || !json || !("ok" in json)) {
        const e = json as
          | { error?: string; issues?: { path: (string | number)[]; message: string }[] }
          | null;
        const issues = e?.issues
          ?.map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ");
        throw new Error(issues || e?.error || `HTTP ${res.status}`);
      }
      setResult(json);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (result) {
    return <ResultCard result={result} onReset={() => setResult(null)} />;
  }

  const valid =
    s.orgSlug.length > 0 &&
    s.orgDisplayName.length > 0 &&
    s.orgKennitala.length > 0 &&
    s.orgLegalName.length > 0 &&
    s.orgRoles.length > 0 &&
    s.propertyDisplayName.length > 0 &&
    s.siteDisplayName.length > 0 &&
    s.stationVendor.length > 0 &&
    s.stationModel.length > 0 &&
    s.stationSerialNumber.length > 0 &&
    s.identityString.length >= 3;

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <Section title="Organization">
        <Grid>
          <Field label="Slug" required value={s.orgSlug} onChange={(v) => set("orgSlug", v)} placeholder="kronan-pilot" mono hint="lowercase, dashes only" />
          <Field label="Display name" required value={s.orgDisplayName} onChange={(v) => set("orgDisplayName", v)} placeholder="Krónan ehf." />
          <Field label="Kennitala" required value={s.orgKennitala} onChange={(v) => set("orgKennitala", v)} placeholder="700101-9999" mono hint="DDMMYY-XXXX" />
          <Field label="Legal name" required value={s.orgLegalName} onChange={(v) => set("orgLegalName", v)} placeholder="Krónan ehf." />
          <Field label="Country code" value={s.orgCountryCode} onChange={(v) => set("orgCountryCode", v.toUpperCase().slice(0, 2))} placeholder="IS" mono />
          <Field label="Default currency" value={s.orgDefaultCurrency} onChange={(v) => set("orgDefaultCurrency", v.toUpperCase().slice(0, 3))} placeholder="ISK" mono />
          <Field label="Legal form" value={s.orgLegalForm} onChange={(v) => set("orgLegalForm", v)} placeholder="ehf. / hf. / sf." />
          <Field label="VSK number" value={s.orgVskNr} onChange={(v) => set("orgVskNr", v)} mono />
          <Field label="LEI code" value={s.orgLeiCode} onChange={(v) => set("orgLeiCode", v)} mono />
          <Field label="Regulator licence no" value={s.orgRegulatorLicenceNo} onChange={(v) => set("orgRegulatorLicenceNo", v)} />
        </Grid>
        <div className="mt-3">
          <Label required>Roles</Label>
          <p className="mb-2 text-[10px] text-ink-500">Select every role this org plays in the Iceland charging market. At least one required.</p>
          <div className="grid grid-cols-3 gap-1">
            {ORG_ROLES.map((r) => (
              <label key={r} className="flex cursor-pointer items-center gap-2 rounded border border-bg-border bg-bg-base/30 px-2 py-1 text-xs text-ink-200 transition-colors hover:bg-bg-base/60">
                <input type="checkbox" checked={s.orgRoles.includes(r)} onChange={() => toggleRole(r)} className="h-3 w-3" />
                <span className="font-mono">{r}</span>
              </label>
            ))}
          </div>
        </div>
        <div className="mt-3">
          <Label>Notes</Label>
          <textarea
            value={s.orgNotes}
            onChange={(e) => set("orgNotes", e.target.value)}
            rows={2}
            className="mt-1 w-full rounded-md border border-bg-border bg-bg-base/50 px-3 py-2 text-sm text-ink-50 ring-1 ring-transparent transition-colors focus:border-sv-sky focus:ring-sv-sky/20 focus:outline-none"
          />
        </div>
        <SubSection title="Address (optional)">
          <Grid cols={3}>
            <Field label="Street" value={s.orgAddressStreet} onChange={(v) => set("orgAddressStreet", v)} />
            <Field label="City" value={s.orgAddressCity} onChange={(v) => set("orgAddressCity", v)} />
            <Field label="Postal code" value={s.orgAddressPostalCode} onChange={(v) => set("orgAddressPostalCode", v)} />
          </Grid>
        </SubSection>
        <SubSection title="Primary contact (optional)">
          <Grid cols={3}>
            <Field label="Name" value={s.orgContactName} onChange={(v) => set("orgContactName", v)} />
            <Field label="Email" value={s.orgContactEmail} onChange={(v) => set("orgContactEmail", v)} />
            <Field label="Phone" value={s.orgContactPhone} onChange={(v) => set("orgContactPhone", v)} />
          </Grid>
        </SubSection>
      </Section>

      <Section title="Property">
        <Grid>
          <Field label="Display name" required value={s.propertyDisplayName} onChange={(v) => set("propertyDisplayName", v)} placeholder="Krónan Akureyri" />
          <Field label="Street" value={s.propertyStreet} onChange={(v) => set("propertyStreet", v)} />
          <Field label="City" value={s.propertyCity} onChange={(v) => set("propertyCity", v)} />
          <Field label="Postal code" value={s.propertyPostalCode} onChange={(v) => set("propertyPostalCode", v)} />
          <Field label="Latitude" value={s.propertyLatitude} onChange={(v) => set("propertyLatitude", v)} mono placeholder="65.6835" />
          <Field label="Longitude" value={s.propertyLongitude} onChange={(v) => set("propertyLongitude", v)} mono placeholder="-18.1262" />
        </Grid>
      </Section>

      <Section title="Site">
        <Grid>
          <Field label="Display name" required value={s.siteDisplayName} onChange={(v) => set("siteDisplayName", v)} placeholder="Akureyri parking lot" />
          <Select label="Site type" value={s.siteType} onChange={(v) => set("siteType", v)} options={SITE_TYPES} />
          <Select label="Access level" value={s.siteAccessLevel} onChange={(v) => set("siteAccessLevel", v)} options={ACCESS_LEVELS} />
          <Select label="Power class" value={s.sitePowerClass} onChange={(v) => set("sitePowerClass", v)} options={POWER_CLASSES} optional />
          <Field label="Timezone" value={s.siteTimezone} onChange={(v) => set("siteTimezone", v)} mono />
        </Grid>
      </Section>

      <Section title="Charging station">
        <Grid>
          <Field label="Vendor" required value={s.stationVendor} onChange={(v) => set("stationVendor", v)} placeholder="Zaptec" />
          <Field label="Model" required value={s.stationModel} onChange={(v) => set("stationModel", v)} placeholder="Pro" />
          <Field label="Serial number" required value={s.stationSerialNumber} onChange={(v) => set("stationSerialNumber", v)} placeholder="ZAP-12345" mono />
          <Field label="Firmware version" value={s.stationFirmwareVersion} onChange={(v) => set("stationFirmwareVersion", v)} mono />
          <Field label="Install date" value={s.stationInstallDate} onChange={(v) => set("stationInstallDate", v)} placeholder="2026-04-26" mono hint="YYYY-MM-DD" />
        </Grid>
      </Section>

      <Section title="EVSE">
        <Grid cols={3}>
          <Field label="EVSE index" value={s.evseIndex} onChange={(v) => set("evseIndex", v)} mono hint="1..N within station" />
          <Field label="Max power (kW)" value={s.evseMaxPowerKw} onChange={(v) => set("evseMaxPowerKw", v)} mono />
          <Field label="Phase count" value={s.evsePhaseCount} onChange={(v) => set("evsePhaseCount", v)} mono placeholder="3" />
        </Grid>
      </Section>

      <Section title="Connector">
        <Grid cols={3}>
          <Select label="Connector type" required value={s.connectorType} onChange={(v) => set("connectorType", v)} options={CONNECTOR_TYPES} />
          <Field label="Connector index" value={s.connectorIndex} onChange={(v) => set("connectorIndex", v)} mono />
          <Field label="Max power (kW)" value={s.connectorMaxPowerKw} onChange={(v) => set("connectorMaxPowerKw", v)} mono placeholder="22" />
        </Grid>
      </Section>

      <Section title="OCPP identity">
        <Grid cols={3}>
          <Field label="Identity string" required value={s.identityString} onChange={(v) => set("identityString", v)} placeholder="kronan-akureyri-01" mono hint="alphanum + . _ : -" />
          <Select label="OCPP version" value={s.ocppVersion} onChange={(v) => set("ocppVersion", v)} options={OCPP_VERSIONS} />
          <Select label="Asset class" value={s.assetClass} onChange={(v) => set("assetClass", v)} options={ASSET_CLASSES} />
        </Grid>
      </Section>

      {error && (
        <div className="rounded border border-rose-700/40 bg-rose-950/30 p-3 text-xs text-rose-200">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={submitting || !valid}
        className="w-full rounded-md bg-sv-green/20 px-4 py-3 text-sm font-medium text-sv-green ring-1 ring-sv-green/30 transition-colors hover:bg-sv-green/30 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {submitting ? "Creating chain…" : "Create chain"}
      </button>
    </form>
  );
}

function ResultCard({ result, onReset }: { result: Result; onReset: () => void }) {
  const [copied, setCopied] = useState(false);
  async function copyPwd() {
    await navigator.clipboard.writeText(result.ocppPassword);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  return (
    <div className="space-y-4">
      <div className="rounded-md border border-sv-green/40 bg-sv-green/10 p-4">
        <h2 className="text-lg font-semibold text-sv-green">Chain created</h2>
        <p className="mt-1 text-sm text-ink-300">All 8 entities provisioned in one transaction.</p>
      </div>

      <div className="rounded-md border border-amber-700/50 bg-amber-950/30 p-4">
        <h3 className="text-sm font-semibold text-amber-200">OCPP Basic-Auth password — one-time reveal</h3>
        <p className="mt-1 text-xs text-amber-300/80">
          Copy now. Cannot be retrieved again. Re-onboard to rotate.
        </p>
        <div className="mt-3 flex items-center gap-2">
          <code className="flex-1 select-all break-all rounded border border-bg-border bg-bg-base/60 px-3 py-2 font-mono text-xs text-ink-50">
            {result.ocppPassword}
          </code>
          <button
            type="button"
            onClick={copyPwd}
            className="rounded-md bg-sv-sky/20 px-3 py-2 text-xs font-medium text-sv-sky ring-1 ring-sv-sky/30 transition-colors hover:bg-sv-sky/30"
          >
            {copied ? "Copied ✓" : "Copy"}
          </button>
        </div>
        <p className="mt-2 text-[10px] font-mono text-amber-300/60">
          Identity string: {result.identityString}
        </p>
      </div>

      <div className="rounded-md border border-bg-border bg-bg-base/30 p-4">
        <h3 className="mb-2 text-sm font-semibold text-ink-50">Created entities</h3>
        <dl className="grid grid-cols-1 gap-1 font-mono text-xs sm:grid-cols-2">
          <Row k="Org slug" v={result.orgSlug} />
          <Row k="Org id" v={result.orgId} />
          <Row k="Property id" v={result.propertyId} />
          <Row k="Site id" v={result.siteId} />
          <Row k="ChargingStation id" v={result.chargingStationId} />
          <Row k="EVSE id" v={result.evseId} />
          <Row k="Connector id" v={result.connectorId} />
          <Row k="OcppIdentity id" v={result.ocppIdentityId} />
        </dl>
      </div>

      <div className="flex gap-2">
        <a
          href={`/tenants/organizations/${result.orgId}`}
          className="rounded-md bg-sv-sky/20 px-3 py-2 text-sm font-medium text-sv-sky ring-1 ring-sv-sky/30 transition-colors hover:bg-sv-sky/30"
        >
          View organization →
        </a>
        <button
          type="button"
          onClick={onReset}
          className="rounded-md bg-bg-base/40 px-3 py-2 text-sm font-medium text-ink-300 ring-1 ring-bg-border transition-colors hover:bg-bg-base/60"
        >
          Onboard another
        </button>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-2 border-b border-bg-border/50 py-1 last:border-b-0">
      <dt className="text-ink-400">{k}</dt>
      <dd className="select-all text-ink-100">{v}</dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="rounded-md border border-bg-border bg-bg-base/20 p-4">
      <legend className="px-2 text-sm font-semibold uppercase tracking-brand text-ink-300">{title}</legend>
      {children}
    </fieldset>
  );
}

function SubSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-4">
      <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-brand text-ink-400">{title}</h4>
      {children}
    </div>
  );
}

function Grid({ children, cols = 2 }: { children: React.ReactNode; cols?: 2 | 3 }) {
  return (
    <div className={`grid gap-3 ${cols === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
      {children}
    </div>
  );
}

function Label({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <span className="block text-[11px] font-semibold uppercase tracking-brand text-ink-400">
      {children}
      {required && <span className="ml-0.5 text-rose-400">*</span>}
    </span>
  );
}

function Field({
  label,
  required,
  hint,
  value,
  onChange,
  placeholder,
  mono,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
}) {
  return (
    <label className="block">
      <Label required={required}>{label}</Label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={
          "mt-1 w-full rounded-md border border-bg-border bg-bg-base/50 px-3 py-2 text-sm text-ink-50 ring-1 ring-transparent transition-colors focus:border-sv-sky focus:ring-sv-sky/20 focus:outline-none " +
          (mono ? "font-mono" : "")
        }
      />
      {hint && <span className="mt-0.5 block text-[10px] text-ink-500">{hint}</span>}
    </label>
  );
}

function Select({
  label,
  required,
  optional,
  value,
  onChange,
  options,
}: {
  label: string;
  required?: boolean;
  optional?: boolean;
  value: string;
  onChange: (v: string) => void;
  options: readonly string[];
}) {
  return (
    <label className="block">
      <Label required={required}>{label}</Label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-md border border-bg-border bg-bg-base/50 px-3 py-2 text-sm text-ink-50 ring-1 ring-transparent transition-colors focus:border-sv-sky focus:ring-sv-sky/20 focus:outline-none"
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o === "" ? (optional ? "—" : "—") : o}
          </option>
        ))}
      </select>
    </label>
  );
}
