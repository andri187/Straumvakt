"use client";

import { useEffect, useState } from "react";

type Step = "credentials" | "preview" | "result";

export function ZaptecWizardForm({ orgOptions }: { orgOptions: { id: string; label: string }[] }) {
  const [step, setStep] = useState<Step>("credentials");
  const [orgId, setOrgId] = useState(orgOptions[0]?.id ?? "");
  const [siteId, setSiteId] = useState("");
  const [sites, setSites] = useState<{ id: string; displayName: string }[]>([]);
  const [zaptecUser, setZaptecUser] = useState("");
  const [zaptecPass, setZaptecPass] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!orgId) return;
    fetch(`/api/admin/orgs/${orgId}/sites`).then((r) => r.json()).then((d: { sites?: { id: string; displayName: string }[] }) => {
      const list = d.sites ?? [];
      setSites(list);
      setSiteId(list[0]?.id ?? "");
    });
  }, [orgId]);

  async function onConnect(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      // Stub — real implementation will exchange creds for OAuth tokens
      // server-side via /api/admin/zaptec/auth and pull /installations
      // from the Zaptec API. For now, surface the intended behaviour.
      await new Promise((r) => setTimeout(r, 400));
      setError("Zaptec OAuth integration not yet implemented. Milestone 2.7. Use /installations for manual create until wired.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <ol className="flex items-center gap-2 text-xs">
        <Pill active={step === "credentials"} done={false}>1. Credentials</Pill>
        <span className="text-ink-600">→</span>
        <Pill active={step === "preview"} done={false}>2. Preview</Pill>
        <span className="text-ink-600">→</span>
        <Pill active={step === "result"} done={false}>3. Save</Pill>
      </ol>

      {step === "credentials" && (
        <form onSubmit={onConnect} className="space-y-3 rounded-md border border-bg-border bg-bg-base/30 p-4">
          <Select label="Organization" required value={orgId} onChange={setOrgId} options={orgOptions.map((o) => ({ value: o.id, label: o.label }))} />
          <Select label="Site" required value={siteId} onChange={setSiteId} options={sites.map((s) => ({ value: s.id, label: s.displayName }))} placeholder={sites.length === 0 ? "(no sites for this org)" : undefined} />
          <Field label="Zaptec username" required value={zaptecUser} onChange={setZaptecUser} placeholder="user@straumvakt.is" mono />
          <Field label="Zaptec password" required value={zaptecPass} onChange={setZaptecPass} type="password" />
          <p className="rounded border border-bg-border/40 bg-bg-base/40 p-2 text-[10px] text-ink-400">
            Password is exchanged server-side for an OAuth refresh token immediately and never persisted in plaintext.
            Stored under <code className="font-mono">installations.credentials_ref</code> as a Cloudflare KV key.
          </p>

          {error && <div className="rounded border border-rose-700/40 bg-rose-950/30 p-2 text-xs text-rose-200">{error}</div>}

          <button type="submit" disabled={submitting || !orgId || !siteId || zaptecUser.length === 0 || zaptecPass.length === 0} className="w-full rounded-md bg-sv-green/20 px-3 py-2 text-sm font-medium text-sv-green ring-1 ring-sv-green/30 hover:bg-sv-green/30 disabled:cursor-not-allowed disabled:opacity-40">
            {submitting ? "Connecting…" : "Connect to Zaptec"}
          </button>
        </form>
      )}

      {step === "preview" && (
        <div className="rounded-md border border-bg-border bg-bg-base/30 p-4">
          <p className="text-sm text-ink-300">Discovered installations / circuits / chargers will be listed here for review and selective import. Stub — not implemented.</p>
        </div>
      )}

      {step === "result" && (
        <div className="rounded-md border border-bg-border bg-bg-base/30 p-4">
          <p className="text-sm text-ink-300">Import summary lands here with audit log entry counts. Stub — not implemented.</p>
        </div>
      )}
    </div>
  );
}

function Pill({ children, active, done }: { children: React.ReactNode; active: boolean; done: boolean }) {
  return (
    <span className={
      "rounded-full px-2 py-1 ring-1 " +
      (active ? "bg-sv-sky/20 text-sv-sky ring-sv-sky/40" : done ? "bg-sv-green/20 text-sv-green ring-sv-green/40" : "bg-bg-base/40 text-ink-400 ring-bg-border")
    }>
      {children}
    </span>
  );
}

function Field({ label, required, value, onChange, placeholder, mono, type = "text" }: { label: string; required?: boolean; value: string; onChange: (v: string) => void; placeholder?: string; mono?: boolean; type?: string }) {
  return <label className="block"><span className="block text-[11px] font-semibold uppercase tracking-brand text-ink-400">{label}{required && <span className="ml-0.5 text-rose-400">*</span>}</span><input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={"mt-1 w-full rounded-md border border-bg-border bg-bg-base/50 px-3 py-2 text-sm text-ink-50 focus:border-sv-sky focus:outline-none " + (mono ? "font-mono" : "")} /></label>;
}
function Select({ label, required, value, onChange, options, placeholder }: { label: string; required?: boolean; value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; placeholder?: string }) {
  return <label className="block"><span className="block text-[11px] font-semibold uppercase tracking-brand text-ink-400">{label}{required && <span className="ml-0.5 text-rose-400">*</span>}</span><select value={value} onChange={(e) => onChange(e.target.value)} className="mt-1 w-full rounded-md border border-bg-border bg-bg-base/50 px-3 py-2 text-sm text-ink-50 focus:border-sv-sky focus:outline-none">{placeholder && <option value="" disabled>{placeholder}</option>}{options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>;
}
