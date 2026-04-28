"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const STATUSES = ["active", "suspended", "deleted"] as const;
type UserStatusValue = (typeof STATUSES)[number];

interface InitialState {
  email: string;
  displayName: string;
  status: string;
  kennitala: string;
  phone: string;
  locale: string;
  notes: string;
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

      if (Object.keys(patch).length === 0) {
        setBusy(false);
        return;
      }
      const res = await fetch(`/api/admin/users/${userId}`, {
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
    <form onSubmit={onSave} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Email" value={email} onChange={setEmail} mono />
        <Field label="Display name" value={displayName} onChange={setDisplayName} />
        <label className="block">
          <span className="block text-[11px] font-semibold uppercase tracking-brand text-ink-400">Status</span>
          <select value={status} onChange={(e) => setStatus(e.target.value as UserStatusValue)} className="mt-1 w-full rounded-md border border-bg-border bg-bg-base/50 px-3 py-2 text-sm text-ink-50 focus:border-sv-sky focus:outline-none">
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <Field label="Kennitala" value={kennitala} onChange={setKennitala} mono hint="DDMMYY-XXXX" />
        <Field label="Phone" value={phone} onChange={setPhone} mono />
        <Field label="Locale" value={locale} onChange={setLocale} mono hint="e.g. is, en" />
      </div>

      <label className="block">
        <span className="block text-[11px] font-semibold uppercase tracking-brand text-ink-400">Notes</span>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="mt-1 w-full rounded-md border border-bg-border bg-bg-base/50 px-3 py-2 text-sm text-ink-50 focus:border-sv-sky focus:outline-none" />
      </label>

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
