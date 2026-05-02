"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-client";
import type {
  OrgAddress,
  OrgContact,
  OrgMainContact,
} from "@straumvakt/shared/domain/orgs";
import {
  IdentitySection,
  type IdentityFormState,
} from "../identity-section";
import {
  AddressSection,
  buildAddressForSubmit,
  initialAddressState,
  type AddressSectionState,
} from "../address-section";
import {
  AdditionalContactsList,
  MainContactPicker,
  buildContactsForSubmit,
  splitContacts,
  type MainContactState,
  type MemberOption,
} from "../contacts-section";

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

// Operator branding — surfaces on driver app + the operator console's
// org-scoped pages once those land.
type BrandingBlock = {
  logoUrl?: string;
  primaryColor?: string;
  secondaryColor?: string;
};

export interface OrgInitial {
  displayName: string;
  countryCode: string;
  status: string;
  kennitala: string | null;
  legalName: string | null;
  legalForm: string | null;
  legalFormCode: string | null;
  vskNr: string | null;
  leiCode: string | null;
  defaultCurrency: string;
  regulatorLicenceNo: string | null;
  notes: string | null;
  roles: string[];
  postalAddress: OrgAddress | null;
  legalAddress: OrgAddress | null;
  municipalityCode: string | null;
  municipalityName: string | null;
  branding: BrandingBlock & Record<string, unknown>;
  mainContactUserId: string | null;
  mainContact: OrgMainContact | null;
  contacts: OrgContact[];
}

export type { MemberOption } from "../contacts-section";

export function OrgEditPanel({
  orgId,
  initial,
  members,
}: {
  orgId: string;
  initial: OrgInitial;
  members: MemberOption[];
}) {
  const router = useRouter();
  const isArchived = initial.status === "archived";

  const [identity, setIdentity] = useState<IdentityFormState>({
    displayName: initial.displayName,
    countryCode: initial.countryCode,
    kennitala: initial.kennitala ?? "",
    legalName: initial.legalName ?? "",
    legalForm: initial.legalForm ?? "",
    legalFormCode: initial.legalFormCode ?? "",
    vskNr: initial.vskNr ?? "",
    leiCode: initial.leiCode ?? "",
    defaultCurrency: initial.defaultCurrency,
    regulatorLicenceNo: initial.regulatorLicenceNo ?? "",
  });
  const [address, setAddress] = useState<AddressSectionState>(
    initialAddressState(initial),
  );
  const [roles, setRoles] = useState<string[]>(initial.roles ?? []);
  const [notes, setNotes] = useState(initial.notes ?? "");

  // Branding
  const [logoUrl, setLogoUrl] = useState(initial.branding?.logoUrl ?? "");
  const [primaryColor, setPrimaryColor] = useState(
    initial.branding?.primaryColor ?? "",
  );
  const [secondaryColor, setSecondaryColor] = useState(
    initial.branding?.secondaryColor ?? "",
  );

  // Contacts — split stored array into main + additional, then
  // pre-populate the picker mode based on whether a User is linked.
  const split = splitContacts(initial.contacts);
  const initialMain: MainContactState = initial.mainContactUserId
    ? {
        mode: "user",
        userId: initial.mainContactUserId,
        rawName: "",
        rawEmail: "",
        rawPhone: "",
      }
    : split.main
      ? {
          mode: "raw",
          userId: "",
          rawName: split.main.name,
          rawEmail: split.main.email ?? "",
          rawPhone: split.main.phone ?? "",
        }
      : {
          mode: "none",
          userId: "",
          rawName: "",
          rawEmail: "",
          rawPhone: "",
        };
  const [main, setMain] = useState(initialMain);
  const [additional, setAdditional] = useState(split.additional);

  const [busy, setBusy] = useState<"idle" | "saving" | "archiving">("idle");
  const [error, setError] = useState<string | null>(null);

  function toggleRole(r: string) {
    setRoles((prev) =>
      prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r],
    );
  }

  async function onSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setBusy("saving");
    try {
      const addr = buildAddressForSubmit(address);
      const contactPayload = buildContactsForSubmit(main, additional);
      const patch: Record<string, unknown> = {};

      // Identity diffs
      if (identity.displayName !== initial.displayName) patch.displayName = identity.displayName;
      if (identity.countryCode !== initial.countryCode) patch.countryCode = identity.countryCode;
      if (identity.kennitala !== (initial.kennitala ?? "")) patch.kennitala = identity.kennitala || undefined;
      if (identity.legalName !== (initial.legalName ?? "")) patch.legalName = identity.legalName || undefined;
      if (identity.legalForm !== (initial.legalForm ?? "")) patch.legalForm = identity.legalForm || undefined;
      if (identity.legalFormCode !== (initial.legalFormCode ?? "")) patch.legalFormCode = identity.legalFormCode || undefined;
      if (identity.vskNr !== (initial.vskNr ?? "")) patch.vskNr = identity.vskNr || undefined;
      if (identity.leiCode !== (initial.leiCode ?? "")) patch.leiCode = identity.leiCode || undefined;
      if (identity.defaultCurrency !== initial.defaultCurrency) patch.defaultCurrency = identity.defaultCurrency;
      if (identity.regulatorLicenceNo !== (initial.regulatorLicenceNo ?? "")) patch.regulatorLicenceNo = identity.regulatorLicenceNo || undefined;

      if (notes !== (initial.notes ?? "")) patch.notes = notes || undefined;
      if (JSON.stringify(roles) !== JSON.stringify(initial.roles ?? [])) patch.roles = roles;

      // Address diffs — always send addr if it changes anything.
      const newPostalSerialised = JSON.stringify(addr.postalAddress);
      const oldPostalSerialised = JSON.stringify(initial.postalAddress);
      if (newPostalSerialised !== oldPostalSerialised) patch.postalAddress = addr.postalAddress;

      const newLegalSerialised = JSON.stringify(addr.legalAddress);
      const oldLegalSerialised = JSON.stringify(initial.legalAddress);
      if (newLegalSerialised !== oldLegalSerialised) patch.legalAddress = addr.legalAddress;

      if ((addr.municipalityCode ?? "") !== (initial.municipalityCode ?? "")) {
        patch.municipalityCode = addr.municipalityCode ?? undefined;
      }
      if ((addr.municipalityName ?? "") !== (initial.municipalityName ?? "")) {
        patch.municipalityName = addr.municipalityName ?? undefined;
      }

      // Branding
      const brandingChanged =
        (logoUrl || "") !== (initial.branding?.logoUrl ?? "") ||
        (primaryColor || "") !== (initial.branding?.primaryColor ?? "") ||
        (secondaryColor || "") !== (initial.branding?.secondaryColor ?? "");
      if (brandingChanged) {
        const next: Record<string, unknown> = { ...initial.branding };
        if (logoUrl) next.logoUrl = logoUrl;
        else delete next.logoUrl;
        if (primaryColor) next.primaryColor = primaryColor;
        else delete next.primaryColor;
        if (secondaryColor) next.secondaryColor = secondaryColor;
        else delete next.secondaryColor;
        patch.branding = next;
      }

      // Contacts (main + additional both go through buildContactsForSubmit)
      const newContactsSerialised = JSON.stringify(contactPayload.contacts);
      const oldContactsSerialised = JSON.stringify(initial.contacts ?? []);
      if (newContactsSerialised !== oldContactsSerialised) patch.contacts = contactPayload.contacts;

      const nextContactId = contactPayload.mainContactUserId;
      if (nextContactId !== initial.mainContactUserId) patch.mainContactUserId = nextContactId;

      if (Object.keys(patch).length === 0) {
        setBusy("idle");
        return;
      }

      const res = await apiFetch(`/api/admin/orgs/${orgId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: string; issues?: { path: (string | number)[]; message: string }[] }
          | null;
        throw new Error(
          body?.issues?.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") ||
            body?.error ||
            `HTTP ${res.status}`,
        );
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy("idle");
    }
  }

  async function onArchive() {
    if (!window.confirm("Archive this organization? Rows are preserved.")) return;
    setError(null);
    setBusy("archiving");
    try {
      const res = await apiFetch(`/api/admin/orgs/${orgId}/archive`, { method: "POST" });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy("idle");
    }
  }

  return (
    <div className="space-y-3">
      <form onSubmit={onSave} className="space-y-4">
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

        <AddressSection state={address} onChange={setAddress} />

        <MainContactPicker state={main} onChange={setMain} members={members} />

        <AdditionalContactsList contacts={additional} onChange={setAdditional} />

        <fieldset className="rounded border border-bg-border/60 p-3">
          <legend className="px-1 text-[10px] font-semibold uppercase tracking-brand text-ink-400">
            Branding
          </legend>
          <p className="mb-2 text-[10px] text-ink-500">
            Logo + theme colors. Used by the driver app + org-scoped operator
            views. JSON column accepts arbitrary extras (driver-app theme keys
            etc.) which round-trip on save.
          </p>
          <div className="space-y-2">
            <Field label="Logo URL" value={logoUrl} onChange={setLogoUrl} compact mono />
            <div className="grid gap-2 sm:grid-cols-2">
              <Field
                label="Primary color"
                value={primaryColor}
                onChange={setPrimaryColor}
                compact
                mono
                placeholder="#3EE9A7"
              />
              <Field
                label="Secondary color"
                value={secondaryColor}
                onChange={setSecondaryColor}
                compact
                mono
                placeholder="#2BB6E8"
              />
            </div>
          </div>
        </fieldset>

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
          disabled={busy !== "idle"}
          className="rounded-md bg-sv-green/20 px-4 py-2 text-sm font-medium text-sv-green ring-1 ring-sv-green/30 transition-colors hover:bg-sv-green/30 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy === "saving" ? "Saving…" : "Save changes"}
        </button>
      </form>

      <div className="border-t border-bg-border/40 pt-3">
        {!isArchived ? (
          <button
            type="button"
            onClick={onArchive}
            disabled={busy !== "idle"}
            className="w-full rounded-md bg-rose-500/10 px-3 py-2 text-xs font-medium text-rose-300 ring-1 ring-rose-500/20 transition-colors hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy === "archiving" ? "Archiving…" : "Archive organization"}
          </button>
        ) : (
          <p className="text-xs text-ink-500">
            Archived — kept for audit + foreign-key integrity.
          </p>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  mono,
  compact,
}: {
  label: string;
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
      </span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={
          (compact ? "px-2 py-1 text-xs " : "px-3 py-2 text-sm ") +
          "mt-1 w-full rounded-md border border-bg-border bg-bg-base/50 text-ink-50 focus:border-sv-sky focus:outline-none " +
          (mono ? "font-mono" : "")
        }
      />
    </label>
  );
}
