"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-client";

// OCPI-aligned tenant taxonomy (ADR 0014). Trimmed from 21 to 13 —
// dropped values were billing concepts (payer/beneficiary/customer →
// Contract / CostCenter / DriverContract) or operational profiles
// without a behaviour consumer.
const ROLES = [
  "cpo",
  "emsp",
  "hub",
  "nsp",
  "site_host",
  "service_contractor",
  "installer",
  "vendor",
  "regulator",
  "dso",
  "tso",
  "retailer",
  "payment_processor",
] as const;

export function CreateOrgForm() {
  const router = useRouter();
  const [displayName, setDisplayName] = useState("");
  const [countryCode, setCountryCode] = useState("IS");
  const [kennitala, setKennitala] = useState("");
  const [legalName, setLegalName] = useState("");
  const [legalForm, setLegalForm] = useState("");
  const [legalFormCode, setLegalFormCode] = useState("");
  const [vskNr, setVskNr] = useState("");
  const [leiCode, setLeiCode] = useState("");
  const [defaultCurrency, setDefaultCurrency] = useState("ISK");
  const [regulatorLicenceNo, setRegulatorLicenceNo] = useState("");
  const [notes, setNotes] = useState("");
  const [roles, setRoles] = useState<string[]>([]);

  // Postal address ("Póstfang"). Iceland-only scope: street + postal + city.
  const [postalStreet, setPostalStreet] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [postalCity, setPostalCity] = useState("");

  // Legal address ("Lögheimili"). Often equals postal but Fyrirtækjaskrá
  // tracks them separately so the operator can register a P.O. box for
  // mail while keeping the registered address at the head office.
  const [legalStreet, setLegalStreet] = useState("");
  const [legalPostalCode, setLegalPostalCode] = useState("");
  const [legalCity, setLegalCity] = useState("");

  // "Sveitarfélag" — Hagstofa 4-digit municipality code + label.
  const [municipalityCode, setMunicipalityCode] = useState("");
  const [municipalityName, setMunicipalityName] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleRole(r: string) {
    setRoles((prev) =>
      prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r],
    );
  }

  function buildAddress(street: string, code: string, city: string) {
    if (!street && !code && !city) return null;
    return { street, postalCode: code, city };
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const body = {
        displayName,
        countryCode,
        kennitala: kennitala || undefined,
        legalName: legalName || undefined,
        legalForm: legalForm || undefined,
        legalFormCode: legalFormCode || undefined,
        vskNr: vskNr || undefined,
        leiCode: leiCode || undefined,
        defaultCurrency,
        regulatorLicenceNo: regulatorLicenceNo || undefined,
        notes: notes || undefined,
        roles,
        postalAddress: buildAddress(postalStreet, postalCode, postalCity),
        legalAddress: buildAddress(legalStreet, legalPostalCode, legalCity),
        municipalityCode: municipalityCode || undefined,
        municipalityName: municipalityName || undefined,
        branding: {},
        // mainContactUserId: assigned post-create via the edit panel,
        // once the org has at least one Membership to pick from.
        mainContactUserId: null,
      };
      const res = await apiFetch("/api/admin/orgs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => null)) as
          | { error?: string; issues?: { path: (string | number)[]; message: string }[] }
          | null;
        const msg =
          b?.issues?.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") ||
          b?.error ||
          `HTTP ${res.status}`;
        throw new Error(msg);
      }
      router.push("/tenants/organizations");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  // Copy postal → legal helper. Common case: postal and lögheimili match.
  function copyPostalToLegal() {
    setLegalStreet(postalStreet);
    setLegalPostalCode(postalCode);
    setLegalCity(postalCity);
  }

  const valid = displayName.length > 0 && countryCode.length === 2;

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {/* Identity — kennitala leads now that slug is gone. */}
      <fieldset className="rounded border border-bg-border/60 p-3">
        <legend className="px-1 text-[10px] font-semibold uppercase tracking-brand text-ink-400">
          Identity
        </legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Display name" required value={displayName} onChange={setDisplayName} placeholder="Straumvakt" />
          <Field label="Country" required value={countryCode} onChange={(v) => setCountryCode(v.toUpperCase().slice(0, 2))} placeholder="IS" mono hint="ISO-3166-1 alpha-2" />
          <Field label="Kennitala" value={kennitala} onChange={setKennitala} placeholder="540206-2010" mono hint="DDMMYY-XXXX (Fyrirtækjaskrá)" />
          <Field label="Legal name (heiti)" value={legalName} onChange={setLegalName} placeholder="Straumvakt ehf." />
          <Field label="Legal form (rekstrarform)" value={legalForm} onChange={setLegalForm} placeholder="Hlutafélag, almennt (hf)" hint="Long label as shown by Fyrirtækjaskrá" />
          <Field label="Legal form code" value={legalFormCode} onChange={setLegalFormCode} placeholder="D1" mono hint="Fyrirtækjaskrá code (D1 = hf, D2 = ehf, …)" />
          <Field label="VSK no" value={vskNr} onChange={setVskNr} mono />
          <Field label="LEI code" value={leiCode} onChange={setLeiCode} mono />
          <Field label="Default currency" value={defaultCurrency} onChange={(v) => setDefaultCurrency(v.toUpperCase().slice(0, 3))} mono />
          <Field label="Regulator licence no" value={regulatorLicenceNo} onChange={setRegulatorLicenceNo} />
        </div>
      </fieldset>

      {/* Roles. */}
      <fieldset className="rounded border border-bg-border/60 p-3">
        <legend className="px-1 text-[10px] font-semibold uppercase tracking-brand text-ink-400">
          Roles (OCPI-aligned)
        </legend>
        <div className="grid grid-cols-2 gap-1 sm:grid-cols-3 md:grid-cols-4">
          {ROLES.map((r) => (
            <label key={r} className="flex cursor-pointer items-center gap-1.5 rounded px-1 py-0.5 text-[11px] text-ink-200 hover:bg-bg-base/40">
              <input type="checkbox" checked={roles.includes(r)} onChange={() => toggleRole(r)} className="h-3 w-3" />
              <span className="font-mono">{r}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {/* Addresses (postal + legal) — Iceland-shaped triple. */}
      <fieldset className="rounded border border-bg-border/60 p-3">
        <legend className="px-1 text-[10px] font-semibold uppercase tracking-brand text-ink-400">
          Addresses
        </legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="mb-1 text-[10px] font-medium text-ink-400">
              Póstfang (postal)
            </p>
            <div className="space-y-2">
              <Field label="Street" value={postalStreet} onChange={setPostalStreet} compact placeholder="Dalvegi 10-14" />
              <div className="grid gap-2 sm:grid-cols-[80px_1fr]">
                <Field label="Postal" value={postalCode} onChange={setPostalCode} compact mono placeholder="201" />
                <Field label="City" value={postalCity} onChange={setPostalCity} compact placeholder="Kópavogur" />
              </div>
            </div>
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between">
              <p className="text-[10px] font-medium text-ink-400">
                Lögheimili (legal)
              </p>
              <button
                type="button"
                onClick={copyPostalToLegal}
                className="rounded border border-bg-border px-2 py-0.5 text-[10px] text-ink-400 hover:bg-bg-base/50"
              >
                Copy from postal
              </button>
            </div>
            <div className="space-y-2">
              <Field label="Street" value={legalStreet} onChange={setLegalStreet} compact />
              <div className="grid gap-2 sm:grid-cols-[80px_1fr]">
                <Field label="Postal" value={legalPostalCode} onChange={setLegalPostalCode} compact mono />
                <Field label="City" value={legalCity} onChange={setLegalCity} compact />
              </div>
            </div>
          </div>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-[120px_1fr]">
          <Field label="Sveitarfélag code" value={municipalityCode} onChange={setMunicipalityCode} compact mono hint="Hagstofa (e.g. 1000)" />
          <Field label="Sveitarfélag name" value={municipalityName} onChange={setMunicipalityName} compact placeholder="Kópavogur" />
        </div>
      </fieldset>

      <label className="block">
        <span className="block text-[11px] font-semibold uppercase tracking-brand text-ink-400">Notes</span>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="mt-1 w-full rounded-md border border-bg-border bg-bg-base/50 px-3 py-2 text-sm text-ink-50 focus:border-sv-sky focus:outline-none" />
      </label>

      {error && (
        <div className="rounded border border-rose-700/40 bg-rose-950/30 p-2 text-xs text-rose-200">{error}</div>
      )}

      <p className="text-[11px] text-ink-500">
        Main contact is assigned after creation, once a member is invited.
      </p>

      <button
        type="submit"
        disabled={submitting || !valid}
        className="rounded-md bg-sv-green/20 px-4 py-2 text-sm font-medium text-sv-green ring-1 ring-sv-green/30 transition-colors hover:bg-sv-green/30 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {submitting ? "Creating…" : "Create organization"}
      </button>
    </form>
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
  compact,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
  compact?: boolean;
}) {
  return (
    <label className="block">
      <span className="block text-[11px] font-semibold uppercase tracking-brand text-ink-400">
        {label}
        {required && <span className="ml-0.5 text-rose-400">*</span>}
      </span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={
          (compact ? "px-2 py-1 text-xs " : "px-3 py-2 text-sm ") +
          "mt-1 w-full rounded-md border border-bg-border bg-bg-base/50 text-ink-50 ring-1 ring-transparent transition-colors focus:border-sv-sky focus:ring-sv-sky/20 focus:outline-none " +
          (mono ? "font-mono" : "")
        }
      />
      {hint && <span className="mt-0.5 block text-[10px] text-ink-500">{hint}</span>}
    </label>
  );
}
