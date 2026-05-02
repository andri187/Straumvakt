"use client";

import type { OrgAddress } from "@straumvakt/shared/domain/orgs";
import { lookupPostalCode } from "@/lib/reference/iceland-postal-codes";

export interface AddressFormState {
  street: string;
  postalCode: string;
  city: string;
}

export interface MunicipalityState {
  code: string;
  name: string;
}

export interface AddressSectionState {
  postal: AddressFormState;
  // Whether the operator wants to enter a different legal address.
  legalDiffers: boolean;
  legal: AddressFormState;
  municipality: MunicipalityState;
}

/**
 * Single-address-by-default fieldset. Iceland default is one address
 * (postal = legal). Operator opts into a separate legal address with
 * the toggle. Postal-code change auto-fills city + sveitarfélag from
 * the static lookup.
 */
export function AddressSection({
  state,
  onChange,
}: {
  state: AddressSectionState;
  onChange: (next: AddressSectionState) => void;
}) {
  function setPostalField(field: keyof AddressFormState, value: string) {
    const next = { ...state, postal: { ...state.postal, [field]: value } };
    if (field === "postalCode") {
      const looked = lookupPostalCode(value);
      if (looked) {
        next.postal.city = looked.city;
        next.municipality = {
          code: looked.municipalityCode,
          name: looked.municipalityName,
        };
        // Mirror to legal too unless operator has decoupled them.
        if (!state.legalDiffers) {
          next.legal = { ...next.postal };
        }
      }
    }
    // Mirror postal → legal when not decoupled.
    if (!state.legalDiffers) {
      next.legal = { ...next.postal };
    }
    onChange(next);
  }

  function setLegalField(field: keyof AddressFormState, value: string) {
    const next = { ...state, legal: { ...state.legal, [field]: value } };
    onChange(next);
  }

  function toggleLegalDiffers(differs: boolean) {
    const next: AddressSectionState = { ...state, legalDiffers: differs };
    if (!differs) {
      // Re-couple: legal mirrors postal.
      next.legal = { ...state.postal };
    }
    onChange(next);
  }

  function setMunicipality(field: keyof MunicipalityState, value: string) {
    onChange({
      ...state,
      municipality: { ...state.municipality, [field]: value },
    });
  }

  return (
    <fieldset className="rounded border border-bg-border/60 p-3">
      <legend className="px-1 text-[10px] font-semibold uppercase tracking-brand text-ink-400">
        Address
      </legend>

      <div className="space-y-3">
        <Field
          label="Street (gata)"
          value={state.postal.street}
          onChange={(v) => setPostalField("street", v)}
          placeholder="Dalvegi 10-14"
        />
        <div className="grid gap-2 sm:grid-cols-[100px_1fr]">
          <Field
            label="Postal code"
            value={state.postal.postalCode}
            onChange={(v) => setPostalField("postalCode", v)}
            mono
            placeholder="201"
          />
          <Field
            label="City"
            value={state.postal.city}
            onChange={(v) => setPostalField("city", v)}
            placeholder="Kópavogur"
          />
        </div>
        <div className="grid gap-2 sm:grid-cols-[100px_1fr]">
          <Field
            label="Sveitarfélag code"
            value={state.municipality.code}
            onChange={(v) => setMunicipality("code", v)}
            mono
            placeholder="1000"
            hint="Hagstofa"
          />
          <Field
            label="Sveitarfélag name"
            value={state.municipality.name}
            onChange={(v) => setMunicipality("name", v)}
            placeholder="Kópavogur"
          />
        </div>

        <label className="flex cursor-pointer items-center gap-2 text-[11px] text-ink-300">
          <input
            type="checkbox"
            checked={state.legalDiffers}
            onChange={(e) => toggleLegalDiffers(e.target.checked)}
            className="h-3 w-3"
          />
          Lögheimili er önnur en póstfang (legal address differs)
        </label>

        {state.legalDiffers && (
          <div className="space-y-2 rounded border border-bg-border/40 bg-bg-base/30 p-2">
            <p className="text-[10px] uppercase tracking-brand text-ink-500">
              Lögheimili
            </p>
            <Field
              label="Street"
              value={state.legal.street}
              onChange={(v) => setLegalField("street", v)}
              compact
            />
            <div className="grid gap-2 sm:grid-cols-[100px_1fr]">
              <Field
                label="Postal"
                value={state.legal.postalCode}
                onChange={(v) => setLegalField("postalCode", v)}
                compact
                mono
              />
              <Field
                label="City"
                value={state.legal.city}
                onChange={(v) => setLegalField("city", v)}
                compact
              />
            </div>
          </div>
        )}
      </div>
    </fieldset>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  mono,
  hint,
  compact,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
  hint?: string;
  compact?: boolean;
}) {
  return (
    <label className="block">
      <span className="block text-[10px] font-semibold uppercase tracking-brand text-ink-500">
        {label}
      </span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={
          (compact ? "px-2 py-1 text-xs " : "px-3 py-2 text-sm ") +
          "mt-0.5 w-full rounded-md border border-bg-border bg-bg-base/50 text-ink-50 focus:border-sv-sky focus:outline-none " +
          (mono ? "font-mono" : "")
        }
      />
      {hint && <span className="mt-0.5 block text-[10px] text-ink-500">{hint}</span>}
    </label>
  );
}

/**
 * Build the address payload for the API. When legal doesn't differ
 * from postal, we still send the same data on both fields so the DB
 * round-trips are stable; the UI reads back legalDiffers by
 * comparing the two on load.
 */
export function buildAddressForSubmit(state: AddressSectionState): {
  postalAddress: OrgAddress | null;
  legalAddress: OrgAddress | null;
  municipalityCode: string | null;
  municipalityName: string | null;
} {
  const postal = state.postal;
  const legal = state.legalDiffers ? state.legal : state.postal;
  const postalAddress: OrgAddress | null =
    postal.street || postal.postalCode || postal.city
      ? {
          street: postal.street,
          postalCode: postal.postalCode,
          city: postal.city,
        }
      : null;
  const legalAddress: OrgAddress | null =
    legal.street || legal.postalCode || legal.city
      ? {
          street: legal.street,
          postalCode: legal.postalCode,
          city: legal.city,
        }
      : null;
  return {
    postalAddress,
    legalAddress,
    municipalityCode: state.municipality.code || null,
    municipalityName: state.municipality.name || null,
  };
}

/**
 * Initial state from a saved org. Detects "legalDiffers" by comparing
 * the two address blocks on load — operators expect the toggle to
 * pre-flip when their data has them stored separately.
 */
export function initialAddressState(initial: {
  postalAddress: OrgAddress | null;
  legalAddress: OrgAddress | null;
  municipalityCode: string | null;
  municipalityName: string | null;
}): AddressSectionState {
  const postal: AddressFormState = {
    street: initial.postalAddress?.street ?? "",
    postalCode: initial.postalAddress?.postalCode ?? "",
    city: initial.postalAddress?.city ?? "",
  };
  const legal: AddressFormState = {
    street: initial.legalAddress?.street ?? "",
    postalCode: initial.legalAddress?.postalCode ?? "",
    city: initial.legalAddress?.city ?? "",
  };
  const differs =
    !!initial.legalAddress &&
    (legal.street !== postal.street ||
      legal.postalCode !== postal.postalCode ||
      legal.city !== postal.city);
  return {
    postal,
    legalDiffers: differs,
    legal: differs ? legal : { ...postal },
    municipality: {
      code: initial.municipalityCode ?? "",
      name: initial.municipalityName ?? "",
    },
  };
}
