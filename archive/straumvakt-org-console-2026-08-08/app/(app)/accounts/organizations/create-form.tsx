"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-client";
import type { OrgContact } from "@straumvakt/shared/domain/orgs";
import {
  IdentitySection,
  type IdentityFormState,
} from "./identity-section";
import {
  AddressSection,
  buildAddressForSubmit,
  type AddressSectionState,
} from "./address-section";
import {
  AdditionalContactsList,
  MainContactPicker,
  buildContactsForSubmit,
  type MainContactState,
} from "./contacts-section";

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

const BLANK_IDENTITY: IdentityFormState = {
  displayName: "",
  countryCode: "IS",
  kennitala: "",
  legalName: "",
  legalForm: "",
  legalFormCode: "",
  vskNr: "",
  leiCode: "",
  defaultCurrency: "ISK",
  regulatorLicenceNo: "",
};

const BLANK_ADDRESS: AddressSectionState = {
  postal: { street: "", postalCode: "", city: "" },
  legalDiffers: false,
  legal: { street: "", postalCode: "", city: "" },
  municipality: { code: "", name: "" },
};

const BLANK_MAIN: MainContactState = {
  mode: "none",
  userId: "",
  rawName: "",
  rawEmail: "",
  rawPhone: "",
};

export function CreateOrgForm() {
  const router = useRouter();
  const [identity, setIdentity] = useState(BLANK_IDENTITY);
  const [address, setAddress] = useState(BLANK_ADDRESS);
  const [main, setMain] = useState(BLANK_MAIN);
  const [additional, setAdditional] = useState<OrgContact[]>([]);
  const [roles, setRoles] = useState<string[]>([]);
  const [kind, setKind] = useState<string>("");
  const [notes, setNotes] = useState("");
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
      const addr = buildAddressForSubmit(address);
      const contactPayload = buildContactsForSubmit(main, additional);
      const body = {
        displayName: identity.displayName,
        countryCode: identity.countryCode,
        kennitala: identity.kennitala || undefined,
        legalName: identity.legalName || undefined,
        legalForm: identity.legalForm || undefined,
        legalFormCode: identity.legalFormCode || undefined,
        vskNr: identity.vskNr || undefined,
        leiCode: identity.leiCode || undefined,
        defaultCurrency: identity.defaultCurrency,
        regulatorLicenceNo: identity.regulatorLicenceNo || undefined,
        notes: notes || undefined,
        roles,
        kind: kind || undefined,
        postalAddress: addr.postalAddress,
        legalAddress: addr.legalAddress,
        municipalityCode: addr.municipalityCode ?? undefined,
        municipalityName: addr.municipalityName ?? undefined,
        branding: {},
        mainContactUserId: contactPayload.mainContactUserId,
        contacts: contactPayload.contacts,
      };
      const res = await apiFetch("/api/admin/orgs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => null)) as
          | {
              error?: string;
              issues?: { path: (string | number)[]; message: string }[];
            }
          | null;
        const msg =
          b?.issues
            ?.map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; ") ||
          b?.error ||
          `HTTP ${res.status}`;
        throw new Error(msg);
      }
      router.push("/accounts/organizations");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  const valid =
    identity.displayName.length > 0 && identity.countryCode.length === 2;

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <IdentitySection state={identity} onChange={setIdentity} />

      <fieldset className="rounded border border-bg-border/60 p-3">
        <legend className="px-1 text-[10px] font-semibold uppercase tracking-brand text-ink-400">
          Roles (OCPI-aligned)
        </legend>
        <div className="grid grid-cols-2 gap-1 sm:grid-cols-3 md:grid-cols-4">
          {ROLES.map((r) => (
            <label
              key={r}
              className="flex cursor-pointer items-center gap-1.5 rounded px-1 py-0.5 text-[11px] text-ink-200 hover:bg-bg-base/40"
            >
              <input
                type="checkbox"
                checked={roles.includes(r)}
                onChange={() => toggleRole(r)}
                className="h-3 w-3"
              />
              <span className="font-mono">{r}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <label className="block">
        <span className="block text-[11px] font-semibold uppercase tracking-brand text-ink-400">
          Host classification (ADR 0026)
        </span>
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value)}
          className="mt-1 w-full rounded-md border border-bg-border bg-bg-base/50 px-3 py-2 text-sm text-ink-50 focus:border-sv-sky focus:outline-none"
        >
          <option value="">Not a host (operator / vendor / …)</option>
          <option value="multi_dwelling">Multi-dwelling (HOA / building)</option>
          <option value="company">Company (employer / fleet)</option>
        </select>
      </label>

      <AddressSection state={address} onChange={setAddress} />

      <MainContactPicker state={main} onChange={setMain} members={[]} />

      <AdditionalContactsList contacts={additional} onChange={setAdditional} />

      <label className="block">
        <span className="block text-[11px] font-semibold uppercase tracking-brand text-ink-400">
          Notes
        </span>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          className="mt-1 w-full rounded-md border border-bg-border bg-bg-base/50 px-3 py-2 text-sm text-ink-50 focus:border-sv-sky focus:outline-none"
        />
      </label>

      {error && (
        <div className="rounded border border-rose-700/40 bg-rose-950/30 p-2 text-xs text-rose-200">
          {error}
        </div>
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
