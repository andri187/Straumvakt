"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const ROLES = [
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

export function CreateOrgForm() {
  const router = useRouter();
  const [slug, setSlug] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [countryCode, setCountryCode] = useState("IS");
  const [kennitala, setKennitala] = useState("");
  const [legalName, setLegalName] = useState("");
  const [legalForm, setLegalForm] = useState("");
  const [vskNr, setVskNr] = useState("");
  const [leiCode, setLeiCode] = useState("");
  const [defaultCurrency, setDefaultCurrency] = useState("ISK");
  const [regulatorLicenceNo, setRegulatorLicenceNo] = useState("");
  const [notes, setNotes] = useState("");
  const [roles, setRoles] = useState<string[]>([]);
  const [addrStreet, setAddrStreet] = useState("");
  const [addrCity, setAddrCity] = useState("");
  const [addrPostal, setAddrPostal] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleRole(r: string) {
    setRoles((prev) =>
      prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r],
    );
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const addresses =
        addrStreet || addrCity || addrPostal
          ? { primary: { street: addrStreet || undefined, city: addrCity || undefined, postal_code: addrPostal || undefined, country: countryCode } }
          : {};
      const contacts =
        contactName || contactEmail || contactPhone
          ? { primary: { name: contactName || undefined, email: contactEmail || undefined, phone: contactPhone || undefined } }
          : {};
      const body = {
        slug,
        displayName,
        countryCode,
        kennitala: kennitala || undefined,
        legalName: legalName || undefined,
        legalForm: legalForm || undefined,
        vskNr: vskNr || undefined,
        leiCode: leiCode || undefined,
        defaultCurrency,
        regulatorLicenceNo: regulatorLicenceNo || undefined,
        notes: notes || undefined,
        roles,
        addresses,
        contacts,
        branding: {},
      };
      const res = await fetch("/api/admin/orgs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => null)) as
          | { error?: string; issues?: { path: (string | number)[]; message: string }[] }
          | null;
        const msg = b?.issues?.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") || b?.error || `HTTP ${res.status}`;
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

  const valid = slug.length > 0 && displayName.length > 0 && countryCode.length === 2;

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Slug" required value={slug} onChange={setSlug} placeholder="straumvakt-pilot" mono hint="lowercase, dashes only" />
        <Field label="Display name" required value={displayName} onChange={setDisplayName} placeholder="Straumvakt" />
        <Field label="Country" required value={countryCode} onChange={(v) => setCountryCode(v.toUpperCase().slice(0, 2))} placeholder="IS" mono hint="ISO-3166-1 alpha-2" />
        <Field label="Kennitala" value={kennitala} onChange={setKennitala} placeholder="700101-9999" mono hint="DDMMYY-XXXX" />
        <Field label="Legal name" value={legalName} onChange={setLegalName} placeholder="Straumvakt ehf." />
        <Field label="Legal form" value={legalForm} onChange={setLegalForm} placeholder="ehf. / hf. / sf." />
        <Field label="VSK no" value={vskNr} onChange={setVskNr} mono />
        <Field label="LEI code" value={leiCode} onChange={setLeiCode} mono />
        <Field label="Default currency" value={defaultCurrency} onChange={(v) => setDefaultCurrency(v.toUpperCase().slice(0, 3))} mono />
        <Field label="Regulator licence no" value={regulatorLicenceNo} onChange={setRegulatorLicenceNo} />
      </div>

      <fieldset className="rounded border border-bg-border/60 p-2">
        <legend className="px-1 text-[10px] font-semibold uppercase tracking-brand text-ink-400">Roles</legend>
        <div className="grid grid-cols-2 gap-1 sm:grid-cols-3 md:grid-cols-4">
          {ROLES.map((r) => (
            <label key={r} className="flex cursor-pointer items-center gap-1.5 rounded px-1 py-0.5 text-[11px] text-ink-200 hover:bg-bg-base/40">
              <input type="checkbox" checked={roles.includes(r)} onChange={() => toggleRole(r)} className="h-3 w-3" />
              <span className="font-mono">{r}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-2">
        <fieldset className="rounded border border-bg-border/60 p-2">
          <legend className="px-1 text-[10px] font-semibold uppercase tracking-brand text-ink-400">Address</legend>
          <div className="space-y-2">
            <Field label="Street" value={addrStreet} onChange={setAddrStreet} compact />
            <div className="grid gap-2 sm:grid-cols-2">
              <Field label="City" value={addrCity} onChange={setAddrCity} compact />
              <Field label="Postal code" value={addrPostal} onChange={setAddrPostal} compact />
            </div>
          </div>
        </fieldset>

        <fieldset className="rounded border border-bg-border/60 p-2">
          <legend className="px-1 text-[10px] font-semibold uppercase tracking-brand text-ink-400">Primary contact</legend>
          <div className="space-y-2">
            <Field label="Name" value={contactName} onChange={setContactName} compact />
            <div className="grid gap-2 sm:grid-cols-2">
              <Field label="Email" value={contactEmail} onChange={setContactEmail} compact />
              <Field label="Phone" value={contactPhone} onChange={setContactPhone} compact />
            </div>
          </div>
        </fieldset>
      </div>

      <label className="block">
        <span className="block text-[11px] font-semibold uppercase tracking-brand text-ink-400">Notes</span>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="mt-1 w-full rounded-md border border-bg-border bg-bg-base/50 px-3 py-2 text-sm text-ink-50 focus:border-sv-sky focus:outline-none" />
      </label>

      {error && (
        <div className="rounded border border-rose-700/40 bg-rose-950/30 p-2 text-xs text-rose-200">{error}</div>
      )}

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
