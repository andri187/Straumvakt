"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-client";
import type { OrgAddress, OrgMainContact } from "@straumvakt/shared/domain/orgs";

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
}

// Members of this org are loaded server-side and passed in. The picker
// surfaces only users who actually have a Membership in this org —
// avoids "main contact who can't see the data" anti-pattern.
export interface MemberOption {
  userId: string;
  displayName: string | null;
  email: string;
}

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

  // Identity
  const [displayName, setDisplayName] = useState(initial.displayName);
  const [countryCode, setCountryCode] = useState(initial.countryCode);
  const [kennitala, setKennitala] = useState(initial.kennitala ?? "");
  const [legalName, setLegalName] = useState(initial.legalName ?? "");
  const [legalForm, setLegalForm] = useState(initial.legalForm ?? "");
  const [legalFormCode, setLegalFormCode] = useState(initial.legalFormCode ?? "");
  const [vskNr, setVskNr] = useState(initial.vskNr ?? "");
  const [leiCode, setLeiCode] = useState(initial.leiCode ?? "");
  const [defaultCurrency, setDefaultCurrency] = useState(initial.defaultCurrency);
  const [regulatorLicenceNo, setRegulatorLicenceNo] = useState(initial.regulatorLicenceNo ?? "");
  const [notes, setNotes] = useState(initial.notes ?? "");
  const [roles, setRoles] = useState<string[]>(initial.roles ?? []);

  // Postal
  const [postalStreet, setPostalStreet] = useState(initial.postalAddress?.street ?? "");
  const [postalCode, setPostalCode] = useState(initial.postalAddress?.postalCode ?? "");
  const [postalCity, setPostalCity] = useState(initial.postalAddress?.city ?? "");

  // Legal
  const [legalStreet, setLegalStreet] = useState(initial.legalAddress?.street ?? "");
  const [legalPostalCode, setLegalPostalCode] = useState(initial.legalAddress?.postalCode ?? "");
  const [legalCity, setLegalCity] = useState(initial.legalAddress?.city ?? "");

  // Municipality
  const [municipalityCode, setMunicipalityCode] = useState(initial.municipalityCode ?? "");
  const [municipalityName, setMunicipalityName] = useState(initial.municipalityName ?? "");

  // Branding
  const [logoUrl, setLogoUrl] = useState(initial.branding?.logoUrl ?? "");
  const [primaryColor, setPrimaryColor] = useState(initial.branding?.primaryColor ?? "");
  const [secondaryColor, setSecondaryColor] = useState(initial.branding?.secondaryColor ?? "");

  // Main contact
  const [mainContactUserId, setMainContactUserId] = useState<string>(
    initial.mainContactUserId ?? "",
  );

  const [busy, setBusy] = useState<"idle" | "saving" | "archiving">("idle");
  const [error, setError] = useState<string | null>(null);

  function toggleRole(r: string) {
    setRoles((prev) => (prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]));
  }

  function copyPostalToLegal() {
    setLegalStreet(postalStreet);
    setLegalPostalCode(postalCode);
    setLegalCity(postalCity);
  }

  function buildAddress(street: string, code: string, city: string): OrgAddress | null {
    if (!street && !code && !city) return null;
    return { street, postalCode: code, city };
  }

  function addressEquals(a: OrgAddress | null, b: OrgAddress | null) {
    if (a == null && b == null) return true;
    if (a == null || b == null) return false;
    return a.street === b.street && a.postalCode === b.postalCode && a.city === b.city;
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
      if (legalFormCode !== (initial.legalFormCode ?? "")) patch.legalFormCode = legalFormCode || undefined;
      if (vskNr !== (initial.vskNr ?? "")) patch.vskNr = vskNr || undefined;
      if (leiCode !== (initial.leiCode ?? "")) patch.leiCode = leiCode || undefined;
      if (defaultCurrency !== initial.defaultCurrency) patch.defaultCurrency = defaultCurrency;
      if (regulatorLicenceNo !== (initial.regulatorLicenceNo ?? "")) patch.regulatorLicenceNo = regulatorLicenceNo || undefined;
      if (notes !== (initial.notes ?? "")) patch.notes = notes || undefined;
      if (JSON.stringify(roles) !== JSON.stringify(initial.roles ?? [])) patch.roles = roles;

      const newPostal = buildAddress(postalStreet, postalCode, postalCity);
      if (!addressEquals(newPostal, initial.postalAddress)) patch.postalAddress = newPostal;

      const newLegal = buildAddress(legalStreet, legalPostalCode, legalCity);
      if (!addressEquals(newLegal, initial.legalAddress)) patch.legalAddress = newLegal;

      if (municipalityCode !== (initial.municipalityCode ?? "")) patch.municipalityCode = municipalityCode || undefined;
      if (municipalityName !== (initial.municipalityName ?? "")) patch.municipalityName = municipalityName || undefined;

      // Branding — preserve unknown extras (driver-app theming).
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

      const nextContactId = mainContactUserId || null;
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
      <form onSubmit={onSave} className="space-y-4">
        {/* Identity */}
        <fieldset className="rounded border border-bg-border/60 p-3">
          <legend className="px-1 text-[10px] font-semibold uppercase tracking-brand text-ink-400">Identity</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Display name" value={displayName} onChange={setDisplayName} />
            <Field label="Country" mono value={countryCode} onChange={(v) => setCountryCode(v.toUpperCase().slice(0, 2))} hint="ISO-3166-1 alpha-2" />
            <Field label="Kennitala" value={kennitala} onChange={setKennitala} mono hint="DDMMYY-XXXX" />
            <Field label="Legal name (heiti)" value={legalName} onChange={setLegalName} />
            <Field label="Legal form (rekstrarform)" value={legalForm} onChange={setLegalForm} placeholder="Hlutafélag, almennt (hf)" />
            <Field label="Legal form code" value={legalFormCode} onChange={setLegalFormCode} mono placeholder="D1" />
            <Field label="VSK no" value={vskNr} onChange={setVskNr} mono />
            <Field label="LEI code" value={leiCode} onChange={setLeiCode} mono />
            <Field label="Default currency" value={defaultCurrency} onChange={(v) => setDefaultCurrency(v.toUpperCase().slice(0, 3))} mono />
            <Field label="Regulator licence no" value={regulatorLicenceNo} onChange={setRegulatorLicenceNo} />
          </div>
        </fieldset>

        {/* Roles */}
        <fieldset className="rounded border border-bg-border/60 p-3">
          <legend className="px-1 text-[10px] font-semibold uppercase tracking-brand text-ink-400">Roles (OCPI-aligned)</legend>
          <div className="grid grid-cols-2 gap-1 sm:grid-cols-3 md:grid-cols-4">
            {ROLES.map((r) => (
              <label key={r} className="flex cursor-pointer items-center gap-1.5 rounded px-1 py-0.5 text-[11px] text-ink-200 hover:bg-bg-base/40">
                <input type="checkbox" checked={roles.includes(r)} onChange={() => toggleRole(r)} className="h-3 w-3" />
                <span className="font-mono">{r}</span>
              </label>
            ))}
          </div>
        </fieldset>

        {/* Addresses */}
        <fieldset className="rounded border border-bg-border/60 p-3">
          <legend className="px-1 text-[10px] font-semibold uppercase tracking-brand text-ink-400">Addresses</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="mb-1 text-[10px] font-medium text-ink-400">Póstfang (postal)</p>
              <div className="space-y-2">
                <Field label="Street" value={postalStreet} onChange={setPostalStreet} compact />
                <div className="grid gap-2 sm:grid-cols-[80px_1fr]">
                  <Field label="Postal" value={postalCode} onChange={setPostalCode} compact mono />
                  <Field label="City" value={postalCity} onChange={setPostalCity} compact />
                </div>
              </div>
            </div>
            <div>
              <div className="mb-1 flex items-center justify-between">
                <p className="text-[10px] font-medium text-ink-400">Lögheimili (legal)</p>
                <button type="button" onClick={copyPostalToLegal} className="rounded border border-bg-border px-2 py-0.5 text-[10px] text-ink-400 hover:bg-bg-base/50">
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
            <Field label="Sveitarfélag code" value={municipalityCode} onChange={setMunicipalityCode} compact mono />
            <Field label="Sveitarfélag name" value={municipalityName} onChange={setMunicipalityName} compact />
          </div>
        </fieldset>

        {/* Main contact picker */}
        <fieldset className="rounded border border-bg-border/60 p-3">
          <legend className="px-1 text-[10px] font-semibold uppercase tracking-brand text-ink-400">Main contact</legend>
          {members.length === 0 ? (
            <p className="text-[11px] italic text-ink-500">
              No members yet. Invite a member to assign one as main contact.
            </p>
          ) : (
            <select
              value={mainContactUserId}
              onChange={(e) => setMainContactUserId(e.target.value)}
              className="w-full rounded-md border border-bg-border bg-bg-base/50 px-3 py-2 text-sm text-ink-50 focus:border-sv-sky focus:outline-none"
            >
              <option value="">— none —</option>
              {members.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.displayName ? `${m.displayName} (${m.email})` : m.email}
                </option>
              ))}
            </select>
          )}
        </fieldset>

        {/* Branding */}
        <fieldset className="rounded border border-bg-border/60 p-3">
          <legend className="px-1 text-[10px] font-semibold uppercase tracking-brand text-ink-400">Branding</legend>
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
