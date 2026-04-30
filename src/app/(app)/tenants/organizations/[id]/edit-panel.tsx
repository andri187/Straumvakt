"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-client";

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

type AddressBlock = { street?: string; city?: string; postal_code?: string; country?: string };
type ContactBlock = { name?: string; email?: string; phone?: string };
// Operator branding — surfaces on driver app + the operator console's
// org-scoped pages once those land. logoUrl and the two color fields
// cover most CSMS branding needs; the JSONB column accepts arbitrary
// extras for future driver-app theming.
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
  vskNr: string | null;
  leiCode: string | null;
  defaultCurrency: string;
  regulatorLicenceNo: string | null;
  notes: string | null;
  roles: string[];
  addresses: { primary?: AddressBlock } & Record<string, unknown>;
  contacts: { primary?: ContactBlock } & Record<string, unknown>;
  branding: BrandingBlock & Record<string, unknown>;
}

export function OrgEditPanel({ orgId, initial }: { orgId: string; initial: OrgInitial }) {
  const router = useRouter();
  const isArchived = initial.status === "archived";

  const [displayName, setDisplayName] = useState(initial.displayName);
  const [countryCode, setCountryCode] = useState(initial.countryCode);
  const [kennitala, setKennitala] = useState(initial.kennitala ?? "");
  const [legalName, setLegalName] = useState(initial.legalName ?? "");
  const [legalForm, setLegalForm] = useState(initial.legalForm ?? "");
  const [vskNr, setVskNr] = useState(initial.vskNr ?? "");
  const [leiCode, setLeiCode] = useState(initial.leiCode ?? "");
  const [defaultCurrency, setDefaultCurrency] = useState(initial.defaultCurrency);
  const [regulatorLicenceNo, setRegulatorLicenceNo] = useState(initial.regulatorLicenceNo ?? "");
  const [notes, setNotes] = useState(initial.notes ?? "");
  const [roles, setRoles] = useState<string[]>(initial.roles ?? []);

  const initialAddr = initial.addresses?.primary ?? {};
  const [addrStreet, setAddrStreet] = useState(initialAddr.street ?? "");
  const [addrCity, setAddrCity] = useState(initialAddr.city ?? "");
  const [addrPostal, setAddrPostal] = useState(initialAddr.postal_code ?? "");

  const initialContact = initial.contacts?.primary ?? {};
  const [contactName, setContactName] = useState(initialContact.name ?? "");
  const [contactEmail, setContactEmail] = useState(initialContact.email ?? "");
  const [contactPhone, setContactPhone] = useState(initialContact.phone ?? "");

  const initialBranding = initial.branding ?? {};
  const [logoUrl, setLogoUrl] = useState(initialBranding.logoUrl ?? "");
  const [primaryColor, setPrimaryColor] = useState(initialBranding.primaryColor ?? "");
  const [secondaryColor, setSecondaryColor] = useState(initialBranding.secondaryColor ?? "");

  const [busy, setBusy] = useState<"idle" | "saving" | "archiving">("idle");
  const [error, setError] = useState<string | null>(null);

  function toggleRole(r: string) {
    setRoles((prev) => (prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]));
  }

  async function onSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setBusy("saving");
    try {
      const patch: Record<string, unknown> = {};
      if (displayName !== initial.displayName) patch.displayName = displayName;
      if (countryCode !== initial.countryCode) patch.countryCode = countryCode;
      if (kennitala !== (initial.kennitala ?? "")) patch.kennitala = kennitala || undefined;
      if (legalName !== (initial.legalName ?? "")) patch.legalName = legalName || undefined;
      if (legalForm !== (initial.legalForm ?? "")) patch.legalForm = legalForm || undefined;
      if (vskNr !== (initial.vskNr ?? "")) patch.vskNr = vskNr || undefined;
      if (leiCode !== (initial.leiCode ?? "")) patch.leiCode = leiCode || undefined;
      if (defaultCurrency !== initial.defaultCurrency) patch.defaultCurrency = defaultCurrency;
      if (regulatorLicenceNo !== (initial.regulatorLicenceNo ?? "")) patch.regulatorLicenceNo = regulatorLicenceNo || undefined;
      if (notes !== (initial.notes ?? "")) patch.notes = notes || undefined;
      if (JSON.stringify(roles) !== JSON.stringify(initial.roles ?? [])) patch.roles = roles;

      const newAddr = { street: addrStreet || undefined, city: addrCity || undefined, postal_code: addrPostal || undefined, country: countryCode };
      const oldAddr = { street: initialAddr.street ?? undefined, city: initialAddr.city ?? undefined, postal_code: initialAddr.postal_code ?? undefined, country: initialAddr.country ?? undefined };
      if (JSON.stringify(newAddr) !== JSON.stringify(oldAddr)) {
        patch.addresses = (addrStreet || addrCity || addrPostal) ? { ...initial.addresses, primary: newAddr } : { ...initial.addresses, primary: undefined };
      }

      const newContact = { name: contactName || undefined, email: contactEmail || undefined, phone: contactPhone || undefined };
      const oldContact = { name: initialContact.name ?? undefined, email: initialContact.email ?? undefined, phone: initialContact.phone ?? undefined };
      if (JSON.stringify(newContact) !== JSON.stringify(oldContact)) {
        patch.contacts = (contactName || contactEmail || contactPhone) ? { ...initial.contacts, primary: newContact } : { ...initial.contacts, primary: undefined };
      }

      // Branding — preserve existing extras (driver-app theming etc.)
      // by spreading initial.branding then overwriting the editable
      // keys; empty string clears the field from the JSON object.
      const brandingChanged =
        (logoUrl || "") !== (initialBranding.logoUrl ?? "") ||
        (primaryColor || "") !== (initialBranding.primaryColor ?? "") ||
        (secondaryColor || "") !== (initialBranding.secondaryColor ?? "");
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
        const body = (await res.json().catch(() => null)) as { error?: string; issues?: { path: (string | number)[]; message: string }[] } | null;
        throw new Error(body?.issues?.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") || body?.error || `HTTP ${res.status}`);
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
      <form onSubmit={onSave} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Display name" value={displayName} onChange={setDisplayName} />
          <Field label="Country" mono value={countryCode} onChange={(v) => setCountryCode(v.toUpperCase().slice(0, 2))} hint="ISO-3166-1 alpha-2" />
          <Field label="Kennitala" value={kennitala} onChange={setKennitala} mono hint="DDMMYY-XXXX" />
          <Field label="Legal name" value={legalName} onChange={setLegalName} />
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

        <fieldset className="rounded border border-bg-border/60 p-2">
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
              <Field label="Primary color" value={primaryColor} onChange={setPrimaryColor} compact mono placeholder="#3EE9A7" />
              <Field label="Secondary color" value={secondaryColor} onChange={setSecondaryColor} compact mono placeholder="#2BB6E8" />
            </div>
          </div>
        </fieldset>

        <label className="block">
          <span className="block text-[11px] font-semibold uppercase tracking-brand text-ink-400">Notes</span>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="mt-1 w-full rounded-md border border-bg-border bg-bg-base/50 px-3 py-2 text-sm text-ink-50 focus:border-sv-sky focus:outline-none" />
        </label>

        {error && <div className="rounded border border-rose-700/40 bg-rose-950/30 p-2 text-xs text-rose-200">{error}</div>}
        <button type="submit" disabled={busy !== "idle"} className="rounded-md bg-sv-green/20 px-4 py-2 text-sm font-medium text-sv-green ring-1 ring-sv-green/30 transition-colors hover:bg-sv-green/30 disabled:cursor-not-allowed disabled:opacity-40">
          {busy === "saving" ? "Saving…" : "Save changes"}
        </button>
      </form>

      <div className="border-t border-bg-border/40 pt-3">
        {!isArchived ? (
          <button type="button" onClick={onArchive} disabled={busy !== "idle"} className="w-full rounded-md bg-rose-500/10 px-3 py-2 text-xs font-medium text-rose-300 ring-1 ring-rose-500/20 transition-colors hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-40">
            {busy === "archiving" ? "Archiving…" : "Archive organization"}
          </button>
        ) : (
          <p className="text-xs text-ink-500">Archived — kept for audit + foreign-key integrity.</p>
        )}
      </div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder, mono, hint, compact }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; mono?: boolean; hint?: string; compact?: boolean }) {
  return (
    <label className="block">
      <span className="block text-[11px] font-semibold uppercase tracking-brand text-ink-400">{label}</span>
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
