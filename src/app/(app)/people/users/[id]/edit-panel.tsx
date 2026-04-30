"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-client";

const STATUSES = ["active", "suspended", "deleted"] as const;
type UserStatusValue = (typeof STATUSES)[number];

interface InitialAddress {
  street: string;
  city: string;
  postalCode: string;
  countryCode: string;
}

interface InitialState {
  email: string;
  displayName: string;
  status: string;
  kennitala: string;
  phone: string;
  locale: string;
  notes: string;
  // Profile enrichment round 2 (Sprint 3).
  firstName: string;
  middleName: string;
  lastName: string;
  dateOfBirth: string; // yyyy-mm-dd or empty string
  photoUrl: string;
  address: InitialAddress;
}

export function UserEditPanel({ userId, initial }: { userId: string; initial: InitialState }) {
  const router = useRouter();
  const [email, setEmail] = useState(initial.email);
  const [displayName, setDisplayName] = useState(initial.displayName);
  const [status, setStatus] = useState<UserStatusValue>(initial.status as UserStatusValue);
  const [kennitala, setKennitala] = useState(initial.kennitala);
  const [phone, setPhone] = useState(initial.phone);
  const [locale, setLocale] = useState(initial.locale);
  const [notes, setNotes] = useState(initial.notes);
  const [firstName, setFirstName] = useState(initial.firstName);
  const [middleName, setMiddleName] = useState(initial.middleName);
  const [lastName, setLastName] = useState(initial.lastName);
  const [dateOfBirth, setDateOfBirth] = useState(initial.dateOfBirth);
  const [photoUrl, setPhotoUrl] = useState(initial.photoUrl);
  const [street, setStreet] = useState(initial.address.street);
  const [city, setCity] = useState(initial.address.city);
  const [postalCode, setPostalCode] = useState(initial.address.postalCode);
  const [countryCode, setCountryCode] = useState(initial.address.countryCode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const patch: Record<string, unknown> = {};
      if (email !== initial.email) patch.email = email;
      if (displayName !== initial.displayName) patch.displayName = displayName || undefined;
      if (status !== initial.status) patch.status = status;
      if (kennitala !== initial.kennitala) patch.kennitala = kennitala || undefined;
      if (phone !== initial.phone) patch.phone = phone || undefined;
      if (locale !== initial.locale) patch.locale = locale;
      if (notes !== initial.notes) patch.notes = notes || undefined;
      if (firstName !== initial.firstName) patch.firstName = firstName || null;
      if (middleName !== initial.middleName) patch.middleName = middleName || null;
      if (lastName !== initial.lastName) patch.lastName = lastName || null;
      if (dateOfBirth !== initial.dateOfBirth) patch.dateOfBirth = dateOfBirth || null;
      if (photoUrl !== initial.photoUrl) patch.photoUrl = photoUrl || null;
      const addrChanged =
        street !== initial.address.street ||
        city !== initial.address.city ||
        postalCode !== initial.address.postalCode ||
        countryCode !== initial.address.countryCode;
      if (addrChanged) {
        const addrPatch: Record<string, string> = {};
        if (street) addrPatch.street = street;
        if (city) addrPatch.city = city;
        if (postalCode) addrPatch.postalCode = postalCode;
        if (countryCode) addrPatch.countryCode = countryCode;
        patch.address = addrPatch;
      }

      if (Object.keys(patch).length === 0) {
        setBusy(false);
        return;
      }
      const res = await apiFetch(`/api/admin/users/${userId}`, {
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
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSave} className="space-y-5">
      {/* Identity */}
      <fieldset className="space-y-3">
        <legend className="text-[10px] font-semibold uppercase tracking-brand text-sv-sky">Identity</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Email" value={email} onChange={setEmail} mono />
          <Field label="Display name" value={displayName} onChange={setDisplayName} hint="Operator-facing label" />
          <label className="block">
            <span className="block text-[11px] font-semibold uppercase tracking-brand text-ink-400">Status</span>
            <select value={status} onChange={(e) => setStatus(e.target.value as UserStatusValue)} className="mt-1 w-full rounded-md border border-bg-border bg-bg-base/50 px-3 py-2 text-sm text-ink-50 focus:border-sv-sky focus:outline-none">
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <Field label="Kennitala" value={kennitala} onChange={setKennitala} mono hint="DDMMYY-XXXX" />
        </div>
      </fieldset>

      {/* Personal */}
      <fieldset className="space-y-3 border-t border-bg-border/40 pt-4">
        <legend className="text-[10px] font-semibold uppercase tracking-brand text-sv-sky">Personal details</legend>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="First name" value={firstName} onChange={setFirstName} />
          <Field label="Middle name" value={middleName} onChange={setMiddleName} />
          <Field label="Last name" value={lastName} onChange={setLastName} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="block text-[11px] font-semibold uppercase tracking-brand text-ink-400">Date of birth</span>
            <input type="date" value={dateOfBirth} onChange={(e) => setDateOfBirth(e.target.value)} className="mt-1 w-full rounded-md border border-bg-border bg-bg-base/50 px-3 py-2 text-sm text-ink-50 focus:border-sv-sky focus:outline-none" />
          </label>
          <Field label="Photo URL" value={photoUrl} onChange={setPhotoUrl} mono placeholder="https://…" />
        </div>
      </fieldset>

      {/* Contact */}
      <fieldset className="space-y-3 border-t border-bg-border/40 pt-4">
        <legend className="text-[10px] font-semibold uppercase tracking-brand text-sv-sky">Contact</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Phone" value={phone} onChange={setPhone} mono />
          <Field label="Locale" value={locale} onChange={setLocale} mono hint="e.g. is, en" />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Street" value={street} onChange={setStreet} />
          <Field label="City" value={city} onChange={setCity} />
          <Field label="Postal code" value={postalCode} onChange={setPostalCode} mono />
          <Field label="Country" value={countryCode} onChange={setCountryCode} mono hint="ISO 3166-1 alpha-2" />
        </div>
      </fieldset>

      {/* Notes */}
      <fieldset className="space-y-3 border-t border-bg-border/40 pt-4">
        <legend className="text-[10px] font-semibold uppercase tracking-brand text-sv-sky">Notes</legend>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className="w-full rounded-md border border-bg-border bg-bg-base/50 px-3 py-2 text-sm text-ink-50 focus:border-sv-sky focus:outline-none" />
      </fieldset>

      {error && <div className="rounded border border-rose-700/40 bg-rose-950/30 p-2 text-xs text-rose-200">{error}</div>}
      <button type="submit" disabled={busy} className="rounded-md bg-sv-green/20 px-4 py-2 text-sm font-medium text-sv-green ring-1 ring-sv-green/30 hover:bg-sv-green/30 disabled:cursor-not-allowed disabled:opacity-40">
        {busy ? "Saving…" : "Save changes"}
      </button>
    </form>
  );
}

function Field({ label, value, onChange, placeholder, mono, hint }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; mono?: boolean; hint?: string }) {
  return (
    <label className="block">
      <span className="block text-[11px] font-semibold uppercase tracking-brand text-ink-400">{label}</span>
      <input type="text" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={"mt-1 w-full rounded-md border border-bg-border bg-bg-base/50 px-3 py-2 text-sm text-ink-50 focus:border-sv-sky focus:outline-none " + (mono ? "font-mono" : "")} />
      {hint && <span className="mt-0.5 block text-[10px] text-ink-500">{hint}</span>}
    </label>
  );
}
