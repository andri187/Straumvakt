"use client";

import { lookupLegalForm } from "@/lib/reference/iceland-legal-forms";

export interface IdentityFormState {
  displayName: string;
  countryCode: string;
  kennitala: string;
  legalName: string;
  legalForm: string;
  legalFormCode: string;
  vskNr: string;
  leiCode: string;
  defaultCurrency: string;
  regulatorLicenceNo: string;
}

/**
 * Identity fields. legalFormCode → legalForm (label) auto-fill via
 * Fyrirtækjaskrá lookup; operator can still type the label manually
 * if the code is unknown.
 */
export function IdentitySection({
  state,
  onChange,
}: {
  state: IdentityFormState;
  onChange: (next: IdentityFormState) => void;
}) {
  function set<K extends keyof IdentityFormState>(
    key: K,
    value: IdentityFormState[K],
  ) {
    const next = { ...state, [key]: value };
    if (key === "legalFormCode" && typeof value === "string") {
      const looked = lookupLegalForm(value);
      if (looked) next.legalForm = looked;
    }
    onChange(next);
  }

  return (
    <fieldset className="rounded border border-bg-border/60 p-3">
      <legend className="px-1 text-[10px] font-semibold uppercase tracking-brand text-ink-400">
        Identity
      </legend>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label="Display name"
          required
          value={state.displayName}
          onChange={(v) => set("displayName", v)}
          placeholder="Straumvakt"
        />
        <Field
          label="Country"
          required
          value={state.countryCode}
          onChange={(v) => set("countryCode", v.toUpperCase().slice(0, 2))}
          mono
          placeholder="IS"
          hint="ISO-3166-1 alpha-2"
        />
        <Field
          label="Kennitala"
          value={state.kennitala}
          onChange={(v) => set("kennitala", v)}
          mono
          placeholder="540206-2010"
          hint="DDMMYY-XXXX (Fyrirtækjaskrá)"
        />
        <Field
          label="Legal name (heiti)"
          value={state.legalName}
          onChange={(v) => set("legalName", v)}
          placeholder="Straumvakt ehf."
        />
        <Field
          label="Legal form code"
          value={state.legalFormCode}
          onChange={(v) => set("legalFormCode", v.toUpperCase().slice(0, 5))}
          mono
          placeholder="D1"
          hint="Fyrirtækjaskrá: D1=hf, D2=ehf, D3=sf, …"
        />
        <Field
          label="Legal form (rekstrarform)"
          value={state.legalForm}
          onChange={(v) => set("legalForm", v)}
          placeholder="Hlutafélag, almennt (hf)"
        />
        <Field
          label="VSK no"
          value={state.vskNr}
          onChange={(v) => set("vskNr", v)}
          mono
        />
        <Field
          label="LEI code"
          value={state.leiCode}
          onChange={(v) => set("leiCode", v)}
          mono
        />
        <Field
          label="Default currency"
          value={state.defaultCurrency}
          onChange={(v) => set("defaultCurrency", v.toUpperCase().slice(0, 3))}
          mono
        />
        <Field
          label="Regulator licence no"
          value={state.regulatorLicenceNo}
          onChange={(v) => set("regulatorLicenceNo", v)}
        />
      </div>
    </fieldset>
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
          "mt-1 w-full rounded-md border border-bg-border bg-bg-base/50 px-3 py-2 text-sm text-ink-50 focus:border-sv-sky focus:outline-none " +
          (mono ? "font-mono" : "")
        }
      />
      {hint && <span className="mt-0.5 block text-[10px] text-ink-500">{hint}</span>}
    </label>
  );
}
