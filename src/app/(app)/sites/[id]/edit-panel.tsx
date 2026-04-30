"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-client";

const SITE_TYPES = ["standard", "workplace", "mdu", "hotel", "fleet", "retail"] as const;
const ACCESS_LEVELS = ["public", "private", "taxi_only"] as const;
const POWER_CLASSES = ["", "lt_50kw", "between_50_150kw", "between_150_500kw", "gt_500kw"] as const;

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
type Day = (typeof DAYS)[number];

interface OpeningHoursDayState {
  closed: boolean;
  open: string; // HH:MM
  close: string;
}

type Initial = {
  displayName: string;
  timezone: string;
  siteType: string;
  accessLevel: string;
  powerClass: string;
  provisioningStatus: string;
  dsoTariffId: string;
  usrfTariffId: string;
  usrfPremTariffId: string;
  xtrrfTariffId: string;
  spvivfTariffId: string;
  // Profile enrichment round 2.
  openingHours: Record<Day, OpeningHoursDayState>;
  openingNotes: string;
  accessNote: string;
  photoUrl: string;
};

export function EditSitePanel({ siteId, initial }: { siteId: string; initial: Initial }) {
  const router = useRouter();
  const [s, setS] = useState<Initial>(initial);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function set<K extends keyof Initial>(k: K, v: string) { setS((p) => ({ ...p, [k]: v })); setSaved(false); }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setError(null); setSubmitting(true); setSaved(false);
    try {
      const patch: Record<string, unknown> = {};
      if (s.displayName !== initial.displayName) patch.displayName = s.displayName;
      if (s.timezone !== initial.timezone) patch.timezone = s.timezone;
      if (s.siteType !== initial.siteType) patch.siteType = s.siteType;
      if (s.accessLevel !== initial.accessLevel) patch.accessLevel = s.accessLevel;
      if (s.powerClass !== initial.powerClass) patch.powerClass = s.powerClass || null;
      if (s.provisioningStatus !== initial.provisioningStatus) patch.provisioningStatus = s.provisioningStatus;
      for (const k of ["dsoTariffId", "usrfTariffId", "usrfPremTariffId", "xtrrfTariffId", "spvivfTariffId"] as const) {
        if (s[k] !== initial[k]) patch[k] = s[k] || null;
      }
      // Operator-domain enrichment.
      if (s.accessNote !== initial.accessNote) patch.accessNote = s.accessNote || null;
      if (s.photoUrl !== initial.photoUrl) patch.photoUrl = s.photoUrl || null;
      // openingHours: serialize the weekly grid into the API shape.
      // Only include the patch field if anything changed.
      const ohChanged =
        s.openingNotes !== initial.openingNotes ||
        DAYS.some((d) => {
          const a = s.openingHours[d];
          const b = initial.openingHours[d];
          return a.closed !== b.closed || a.open !== b.open || a.close !== b.close;
        });
      if (ohChanged) {
        const oh: Record<string, unknown> = {};
        for (const d of DAYS) {
          const day = s.openingHours[d];
          oh[d] = day.closed ? [] : [{ open: day.open, close: day.close }];
        }
        if (s.openingNotes) oh.notes = s.openingNotes;
        patch.openingHours = oh;
      }
      if (Object.keys(patch).length === 0) {
        setSubmitting(false);
        return;
      }
      const res = await apiFetch(`/api/admin/sites/${siteId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => null)) as { error?: string; issues?: { path: (string | number)[]; message: string }[] } | null;
        throw new Error(b?.issues?.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") || b?.error || `HTTP ${res.status}`);
      }
      setSaved(true); router.refresh();
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); } finally { setSubmitting(false); }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Display name" required value={s.displayName} onChange={(v) => set("displayName", v)} />
        <Field label="Timezone" value={s.timezone} onChange={(v) => set("timezone", v)} mono />
        <Select label="Site type" value={s.siteType} onChange={(v) => set("siteType", v)} options={SITE_TYPES} />
        <Select label="Access level" value={s.accessLevel} onChange={(v) => set("accessLevel", v)} options={ACCESS_LEVELS} />
        <Select label="Power class" value={s.powerClass} onChange={(v) => set("powerClass", v)} options={POWER_CLASSES} />
        <Field label="Provisioning status" value={s.provisioningStatus} onChange={(v) => set("provisioningStatus", v)} mono />
      </div>

      <fieldset className="rounded border border-bg-border/60 p-2">
        <legend className="px-1 text-[10px] font-semibold uppercase tracking-brand text-ink-400">
          Tariff anchors (per ADR 0008)
        </legend>
        <p className="mb-2 text-[10px] text-ink-500">Paste tariff UUIDs from <a href="/billing/tariffs" className="text-sv-sky hover:underline">/billing/tariffs</a>. Empty = unset.</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label="DSOF (DSO grid)" value={s.dsoTariffId} onChange={(v) => set("dsoTariffId", v)} mono compact />
          <Field label="USRF (use)" value={s.usrfTariffId} onChange={(v) => set("usrfTariffId", v)} mono compact />
          <Field label="USRF-PREM (premium use)" value={s.usrfPremTariffId} onChange={(v) => set("usrfPremTariffId", v)} mono compact />
          <Field label="XTRRF (extra)" value={s.xtrrfTariffId} onChange={(v) => set("xtrrfTariffId", v)} mono compact />
          <Field label="SPVIVF (services + VAT)" value={s.spvivfTariffId} onChange={(v) => set("spvivfTariffId", v)} mono compact />
        </div>
      </fieldset>

      {/* Opening hours — single window per day, closed toggle clears it.
          Multi-window per day is supported by the schema (up to 6); the
          UI keeps it to one for simplicity, operator falls back to API
          if a complex schedule is ever needed. */}
      <fieldset className="rounded border border-bg-border/60 p-3">
        <legend className="px-1 text-[10px] font-semibold uppercase tracking-brand text-ink-400">
          Opening hours
        </legend>
        <div className="space-y-1.5">
          {DAYS.map((d) => {
            const day = s.openingHours[d];
            return (
              <div key={d} className="flex items-center gap-3 text-xs">
                <span className="w-12 font-mono uppercase text-ink-300">{d}</span>
                <label className="flex items-center gap-1 text-ink-400">
                  <input
                    type="checkbox"
                    checked={day.closed}
                    onChange={(e) =>
                      setS((p) => ({
                        ...p,
                        openingHours: {
                          ...p.openingHours,
                          [d]: { ...p.openingHours[d], closed: e.target.checked },
                        },
                      }))
                    }
                  />{" "}
                  closed
                </label>
                {!day.closed && (
                  <>
                    <input
                      type="time"
                      value={day.open}
                      onChange={(e) =>
                        setS((p) => ({
                          ...p,
                          openingHours: {
                            ...p.openingHours,
                            [d]: { ...p.openingHours[d], open: e.target.value },
                          },
                        }))
                      }
                      className="rounded border border-bg-border bg-bg-base/50 px-2 py-0.5 font-mono text-[11px] text-ink-100"
                    />
                    <span className="text-ink-500">–</span>
                    <input
                      type="time"
                      value={day.close}
                      onChange={(e) =>
                        setS((p) => ({
                          ...p,
                          openingHours: {
                            ...p.openingHours,
                            [d]: { ...p.openingHours[d], close: e.target.value },
                          },
                        }))
                      }
                      className="rounded border border-bg-border bg-bg-base/50 px-2 py-0.5 font-mono text-[11px] text-ink-100"
                    />
                  </>
                )}
              </div>
            );
          })}
        </div>
        <label className="mt-3 block">
          <span className="block text-[11px] font-semibold uppercase tracking-brand text-ink-400">Notes</span>
          <textarea
            value={s.openingNotes}
            onChange={(e) => setS((p) => ({ ...p, openingNotes: e.target.value }))}
            rows={2}
            placeholder="e.g. Closed on bank holidays"
            className="mt-1 w-full rounded-md border border-bg-border bg-bg-base/50 px-3 py-2 text-xs text-ink-50 focus:border-sv-sky focus:outline-none"
          />
        </label>
      </fieldset>

      <fieldset className="rounded border border-bg-border/60 p-3">
        <legend className="px-1 text-[10px] font-semibold uppercase tracking-brand text-ink-400">
          Driver / installer info
        </legend>
        <div className="space-y-2">
          <label className="block">
            <span className="block text-[11px] font-semibold uppercase tracking-brand text-ink-400">Access note</span>
            <textarea
              value={s.accessNote}
              onChange={(e) => setS((p) => ({ ...p, accessNote: e.target.value }))}
              rows={2}
              placeholder="entrance, intercom code, parking instructions"
              className="mt-1 w-full rounded-md border border-bg-border bg-bg-base/50 px-3 py-2 text-xs text-ink-50 focus:border-sv-sky focus:outline-none"
            />
          </label>
          <Field label="Photo URL" value={s.photoUrl} onChange={(v) => set("photoUrl", v)} mono />
        </div>
      </fieldset>

      {error && <div className="rounded border border-rose-700/40 bg-rose-950/30 p-2 text-xs text-rose-200">{error}</div>}
      {saved && <div className="rounded border border-sv-green/40 bg-sv-green/10 p-2 text-xs text-sv-green">Saved.</div>}

      <button type="submit" disabled={submitting || s.displayName.length === 0} className="rounded-md bg-sv-green/20 px-4 py-2 text-sm font-medium text-sv-green ring-1 ring-sv-green/30 hover:bg-sv-green/30 disabled:cursor-not-allowed disabled:opacity-40">
        {submitting ? "Saving…" : "Save changes"}
      </button>
    </form>
  );
}

function Field({ label, required, value, onChange, placeholder, mono, compact }: { label: string; required?: boolean; value: string; onChange: (v: string) => void; placeholder?: string; mono?: boolean; compact?: boolean }) {
  return <label className="block"><span className="block text-[11px] font-semibold uppercase tracking-brand text-ink-400">{label}{required && <span className="ml-0.5 text-rose-400">*</span>}</span><input type="text" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={(compact ? "px-2 py-1 text-xs " : "px-3 py-2 text-sm ") + "mt-1 w-full rounded-md border border-bg-border bg-bg-base/50 text-ink-50 focus:border-sv-sky focus:outline-none " + (mono ? "font-mono" : "")} /></label>;
}
function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: readonly string[] }) {
  return <label className="block"><span className="block text-[11px] font-semibold uppercase tracking-brand text-ink-400">{label}</span><select value={value} onChange={(e) => onChange(e.target.value)} className="mt-1 w-full rounded-md border border-bg-border bg-bg-base/50 px-3 py-2 text-sm text-ink-50 focus:border-sv-sky focus:outline-none">{options.map((o) => <option key={o} value={o}>{o || "—"}</option>)}</select></label>;
}
