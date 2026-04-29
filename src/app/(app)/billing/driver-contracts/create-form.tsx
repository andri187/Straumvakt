"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-client";

const OWNER_TYPES = ["workplace", "family_group", "self"] as const;
const STATUSES = ["pending_configuration", "active", "superseded", "archived"] as const;

export function CreateDriverContractForm({ orgOptions }: { orgOptions: { id: string; label: string }[] }) {
  const router = useRouter();
  const [orgId, setOrgId] = useState(orgOptions[0]?.id ?? "");
  const [userId, setUserId] = useState("");
  const [users, setUsers] = useState<{ id: string; label: string }[]>([]);
  const [ownerType, setOwnerType] = useState<typeof OWNER_TYPES[number]>("self");
  const [ownerId, setOwnerId] = useState("");
  const [wrkpfTariffId, setWrkpfTariffId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [status, setStatus] = useState<typeof STATUSES[number]>("pending_configuration");
  const [validFrom, setValidFrom] = useState(new Date().toISOString().slice(0, 10));
  const [validUntil, setValidUntil] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!orgId) return;
    apiFetch(`/api/admin/orgs/${orgId}/users`).then((r) => r.json()).then((d: { users?: { id: string; label: string }[] }) => {
      const list = d.users ?? [];
      setUsers(list);
      setUserId(list[0]?.id ?? "");
      // sensible default: self-paid owner is the user themself
      setOwnerId(list[0]?.id ?? "");
    });
  }, [orgId]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setError(null); setSubmitting(true);
    try {
      const res = await apiFetch("/api/admin/driver-contracts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          orgId, userId, ownerType, ownerId,
          wrkpfTariffId: wrkpfTariffId || undefined,
          displayName, status,
          validFrom,
          validUntil: validUntil || undefined,
        }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => null)) as { error?: string; issues?: { path: (string | number)[]; message: string }[] } | null;
        throw new Error(b?.issues?.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") || b?.error || `HTTP ${res.status}`);
      }
      router.push("/billing/driver-contracts");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally { setSubmitting(false); }
  }

  const valid = orgId && userId && ownerId.length > 0 && displayName.length > 0 && validFrom.length === 10;

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Select label="Organization" required value={orgId} onChange={setOrgId} options={orgOptions.map((o) => ({ value: o.id, label: o.label }))} />
        <Select label="Driver (user)" required value={userId} onChange={setUserId} options={users.map((u) => ({ value: u.id, label: u.label }))} placeholder={users.length === 0 ? "(no members)" : undefined} />
        <Select label="Owner type" required value={ownerType} onChange={(v) => setOwnerType(v as typeof OWNER_TYPES[number])} options={OWNER_TYPES.map((o) => ({ value: o, label: o }))} />
        <Field label="Owner id (UUID)" required value={ownerId} onChange={setOwnerId} mono hint="org id for workplace; family-group id; user id for self" />
        <Field label="WRKPF tariff id (workplace only)" value={wrkpfTariffId} onChange={setWrkpfTariffId} mono />
        <Field label="Display name" required value={displayName} onChange={setDisplayName} placeholder="Workplace contract for Anna" />
        <Select label="Status" value={status} onChange={(v) => setStatus(v as typeof STATUSES[number])} options={STATUSES.map((s) => ({ value: s, label: s }))} />
        <Field label="Valid from (YYYY-MM-DD)" required value={validFrom} onChange={setValidFrom} mono />
        <Field label="Valid until (optional)" value={validUntil} onChange={setValidUntil} mono />
      </div>

      {error && <div className="rounded border border-rose-700/40 bg-rose-950/30 p-2 text-xs text-rose-200">{error}</div>}
      <button type="submit" disabled={submitting || !valid} className="rounded-md bg-sv-green/20 px-4 py-2 text-sm font-medium text-sv-green ring-1 ring-sv-green/30 hover:bg-sv-green/30 disabled:cursor-not-allowed disabled:opacity-40">
        {submitting ? "Creating…" : "Create driver contract"}
      </button>
    </form>
  );
}

function Field({ label, required, hint, value, onChange, placeholder, mono }: { label: string; required?: boolean; hint?: string; value: string; onChange: (v: string) => void; placeholder?: string; mono?: boolean }) {
  return <label className="block"><span className="block text-[11px] font-semibold uppercase tracking-brand text-ink-400">{label}{required && <span className="ml-0.5 text-rose-400">*</span>}</span><input type="text" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={"mt-1 w-full rounded-md border border-bg-border bg-bg-base/50 px-3 py-2 text-sm text-ink-50 focus:border-sv-sky focus:outline-none " + (mono ? "font-mono" : "")} />{hint && <span className="mt-0.5 block text-[10px] text-ink-500">{hint}</span>}</label>;
}
function Select({ label, required, value, onChange, options, placeholder }: { label: string; required?: boolean; value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; placeholder?: string }) {
  return <label className="block"><span className="block text-[11px] font-semibold uppercase tracking-brand text-ink-400">{label}{required && <span className="ml-0.5 text-rose-400">*</span>}</span><select value={value} onChange={(e) => onChange(e.target.value)} className="mt-1 w-full rounded-md border border-bg-border bg-bg-base/50 px-3 py-2 text-sm text-ink-50 focus:border-sv-sky focus:outline-none">{placeholder && <option value="" disabled>{placeholder}</option>}{options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>;
}
