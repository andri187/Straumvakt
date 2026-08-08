"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-client";
import type { ZaptecImportResult } from "@straumvakt/shared/domain/zaptec-import";
import type { OrgSummary } from "@straumvakt/shared/domain/orgs";

interface DiscoveredChargerRow {
  id: string;
  name: string;
  serialNo: string | null;
  deviceId: string | null;
  mid: string | null;
  active: boolean | null;
  isOnline: boolean | null;
  circuitId: string;
  circuitName: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** Zaptec credentials carried over from the discover step. */
  username: string;
  password: string;
  /** Installation we're importing. */
  installation: { id: string; name: string; address: string | null; chargerCount: number };
  /** Pre-flattened charger list from the discover step, with circuit grouping carried alongside. */
  chargers: DiscoveredChargerRow[];
}

export function ImportDialog({
  open,
  onClose,
  username,
  password,
  installation,
  chargers,
}: Props) {
  const router = useRouter();
  const [orgs, setOrgs] = useState<OrgSummary[]>([]);
  const [loadingOrgs, setLoadingOrgs] = useState(false);
  const [orgId, setOrgId] = useState("");
  const [propertyDisplayName, setPropertyDisplayName] = useState("");
  const [siteDisplayName, setSiteDisplayName] = useState("");
  const [ocppPassword, setOcppPassword] = useState("");
  // Selection state — keyed by Zaptec charger Id. Default: every
  // active charger checked, every inactive charger unchecked.
  // Operator can override per-row.
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(chargers.filter((c) => c.active !== false).map((c) => c.id)),
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ZaptecImportResult | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setResult(null);
    setPropertyDisplayName(installation.name);
    setSiteDisplayName(installation.name);
    setLoadingOrgs(true);
    apiFetch("/api/admin/orgs")
      .then((r) => r.json())
      .then((d: { orgs?: OrgSummary[] }) => {
        const list = (d.orgs ?? []).filter((o) => o.status !== "archived");
        setOrgs(list);
        setOrgId(list[0]?.id ?? "");
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoadingOrgs(false));
  }, [open, installation.name]);

  async function onSubmit() {
    if (!orgId) return;
    if (selected.size === 0) {
      setError("Select at least one charger to import.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const res = await apiFetch("/api/admin/zaptec/import", {
        method: "POST",
        body: JSON.stringify({
          username,
          password,
          zaptecInstallationId: installation.id,
          orgId,
          propertyDisplayName,
          siteDisplayName,
          ocppPassword,
          chargerIds: Array.from(selected),
        }),
      });
      const body = (await res.json().catch(() => null)) as
        | (ZaptecImportResult & { ok?: boolean; error?: string; note?: string })
        | { error?: string }
        | null;
      if (!res.ok) {
        const msg = body && "error" in body ? body.error : `HTTP ${res.status}`;
        setError(humaniseError(msg ?? "import_failed"));
        return;
      }
      setResult(body as ZaptecImportResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  function done() {
    onClose();
    router.refresh();
  }

  if (!open) return null;

  // Wider when showing the success table (passwords are 64-char hex);
  // narrower for the entry form. max-h + overflow-y so a long charger
  // list doesn't push the modal off-screen.
  const widthClass = result ? "max-w-5xl" : "max-w-2xl";

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 px-4 py-8">
      <div className={`w-full ${widthClass} max-h-[90vh] overflow-y-auto rounded-lg border border-bg-border bg-bg-surface shadow-2xl`}>
        <header className="flex items-baseline justify-between border-b border-bg-border bg-bg-base/40 px-5 py-3">
          <div>
            <h2 className="text-sm font-semibold text-ink-50">Import Zaptec installation</h2>
            <p className="font-mono text-[10px] text-ink-500">{installation.id}</p>
          </div>
          {!result && (
            <button
              type="button"
              onClick={onClose}
              className="rounded p-1 text-ink-400 hover:bg-bg-base/40 hover:text-ink-100"
              aria-label="Close"
            >
              ✕
            </button>
          )}
        </header>

        {!result ? (
          <div className="space-y-4 px-5 py-4">
            <p className="text-xs text-ink-300">
              Provisions <span className="text-ink-100">{installation.name}</span>
              {installation.chargerCount > 0 && (
                <> ({installation.chargerCount} charger{installation.chargerCount === 1 ? "" : "s"})</>
              )}{" "}
              into Straumvakt as Property + Site + Installation. Identity
              strings come from each charger&apos;s Zaptec DeviceId
              (lowercased — that&apos;s what the firmware actually sends).
              The OCPP password is installation-level: paste the value
              from the Zaptec portal&apos;s OCPP config below; we&apos;ll hash
              it and apply it to every charger in the import.
            </p>

            <Field label="Org" required>
              <select
                value={orgId}
                onChange={(e) => setOrgId(e.target.value)}
                disabled={loadingOrgs || submitting}
                className="w-full rounded-md border border-bg-border bg-bg-inset px-3 py-2 text-sm text-ink-50 disabled:opacity-50"
              >
                {loadingOrgs ? (
                  <option>Loading…</option>
                ) : orgs.length === 0 ? (
                  <option value="">No active orgs — create one first.</option>
                ) : (
                  orgs.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.kennitala ? `${o.displayName} · ${o.kennitala}` : o.displayName}
                    </option>
                  ))
                )}
              </select>
            </Field>

            <Field label="Property name" required>
              <input
                type="text"
                value={propertyDisplayName}
                onChange={(e) => setPropertyDisplayName(e.target.value)}
                disabled={submitting}
                placeholder="Defaults to Zaptec installation name"
                className="w-full rounded-md border border-bg-border bg-bg-inset px-3 py-2 text-sm text-ink-50 disabled:opacity-50"
                maxLength={120}
              />
            </Field>

            <Field label="Site name" required>
              <input
                type="text"
                value={siteDisplayName}
                onChange={(e) => setSiteDisplayName(e.target.value)}
                disabled={submitting}
                placeholder="Defaults to Zaptec installation name"
                className="w-full rounded-md border border-bg-border bg-bg-inset px-3 py-2 text-sm text-ink-50 disabled:opacity-50"
                maxLength={120}
              />
            </Field>

            <Field label="Zaptec OCPP password" required>
              <input
                type="text"
                value={ocppPassword}
                onChange={(e) => setOcppPassword(e.target.value)}
                disabled={submitting}
                placeholder="From Zaptec portal → installation OCPP config"
                className="w-full rounded-md border border-bg-border bg-bg-inset px-3 py-2 font-mono text-sm text-ink-50 disabled:opacity-50"
                maxLength={200}
                autoComplete="off"
                spellCheck={false}
              />
            </Field>

            <ChargerSelector
              chargers={chargers}
              selected={selected}
              setSelected={setSelected}
              disabled={submitting}
            />

            {error && (
              <div className="rounded border border-rose-700/40 bg-rose-950/30 p-2 text-xs text-rose-200">
                {error}
              </div>
            )}

            <div className="flex justify-end gap-2 border-t border-bg-border pt-3">
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                className="rounded-md px-3 py-1.5 text-xs text-ink-300 hover:text-ink-100"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onSubmit}
                disabled={submitting || !orgId || !propertyDisplayName || !siteDisplayName || !ocppPassword || selected.size === 0}
                className="rounded-md bg-sv-green/20 px-4 py-1.5 text-xs font-medium text-sv-green ring-1 ring-sv-green/30 hover:bg-sv-green/30 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {submitting ? "Importing…" : `Import ${selected.size} charger${selected.size === 1 ? "" : "s"}`}
              </button>
            </div>
          </div>
        ) : (
          <ImportSuccessPanel result={result} onDone={done} />
        )}
      </div>
    </div>
  );
}

/**
 * Per-charger selection table grouped by Zaptec circuit. Default
 * state: every Active=true charger checked, every Active=false
 * unchecked. Operator can override per-row or use the per-circuit
 * "select all in circuit" toggle. Each row also surfaces:
 *   • Active status — Zaptec's own enabled flag for the charger.
 *   • Online status — IsOnline from the bulk /api/chargers list,
 *     showing whether Zaptec cloud sees the charger right now.
 * Both of those help the operator skip stale rows (decommissioned
 * units that are still in Zaptec's hierarchy) at import time.
 */
function ChargerSelector({
  chargers,
  selected,
  setSelected,
  disabled,
}: {
  chargers: DiscoveredChargerRow[];
  selected: Set<string>;
  setSelected: (next: Set<string>) => void;
  disabled: boolean;
}) {
  if (chargers.length === 0) return null;

  // Group rows by circuit for a cleaner visual hierarchy.
  const byCircuit = new Map<string, { name: string; chargers: DiscoveredChargerRow[] }>();
  for (const c of chargers) {
    const e = byCircuit.get(c.circuitId) ?? { name: c.circuitName, chargers: [] };
    e.chargers.push(c);
    byCircuit.set(c.circuitId, e);
  }
  const circuits = Array.from(byCircuit.entries());

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }
  function selectAll() {
    setSelected(new Set(chargers.map((c) => c.id)));
  }
  function selectNone() {
    setSelected(new Set());
  }
  function selectActiveOnly() {
    setSelected(new Set(chargers.filter((c) => c.active !== false).map((c) => c.id)));
  }
  function toggleCircuit(circuitId: string, allSelected: boolean) {
    const next = new Set(selected);
    const inCircuit = chargers.filter((c) => c.circuitId === circuitId).map((c) => c.id);
    if (allSelected) inCircuit.forEach((id) => next.delete(id));
    else inCircuit.forEach((id) => next.add(id));
    setSelected(next);
  }

  return (
    <div className="rounded-md border border-bg-border bg-bg-base/40">
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-bg-border/40 px-3 py-2">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-brand text-ink-300">
            Chargers ({selected.size} of {chargers.length} selected)
          </h3>
          <p className="text-[10px] text-ink-500">
            Inactive chargers are unticked by default. The OCPP password applies to every selected row.
          </p>
        </div>
        <div className="flex shrink-0 gap-1.5 text-[10px]">
          <SelectorButton onClick={selectAll} disabled={disabled}>
            All
          </SelectorButton>
          <SelectorButton onClick={selectActiveOnly} disabled={disabled}>
            Active only
          </SelectorButton>
          <SelectorButton onClick={selectNone} disabled={disabled}>
            None
          </SelectorButton>
        </div>
      </header>

      <div className="max-h-72 overflow-y-auto">
        <table className="w-full table-fixed text-left text-[11px]">
          <thead className="sticky top-0 bg-bg-inset/60 text-[10px] uppercase tracking-brand text-ink-500 backdrop-blur">
            <tr>
              <th className="w-8 px-2 py-1.5" />
              <th className="w-[28%] px-2 py-1.5 font-medium">Charger</th>
              <th className="w-[18%] px-2 py-1.5 font-medium">Device ID</th>
              <th className="w-[12%] px-2 py-1.5 font-medium">Active</th>
              <th className="w-[12%] px-2 py-1.5 font-medium">Online</th>
              <th className="w-[18%] px-2 py-1.5 font-medium">Circuit</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-bg-border/30">
            {circuits.flatMap(([circuitId, c]) => {
              const inCircuit = c.chargers;
              const allSelected = inCircuit.every((ch) => selected.has(ch.id));
              const anySelected = inCircuit.some((ch) => selected.has(ch.id));
              return [
                <tr key={`${circuitId}:header`} className="bg-bg-base/30">
                  <td className="px-2 py-1.5 align-middle">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      ref={(el) => {
                        if (el) el.indeterminate = !allSelected && anySelected;
                      }}
                      onChange={() => toggleCircuit(circuitId, allSelected)}
                      disabled={disabled}
                      aria-label={`Select all chargers on ${c.name}`}
                    />
                  </td>
                  <td colSpan={5} className="px-2 py-1.5 align-middle text-[11px] text-ink-200">
                    <span className="font-medium">{c.name}</span>
                    <span className="ml-2 text-ink-500">({inCircuit.length})</span>
                  </td>
                </tr>,
                ...inCircuit.map((ch) => (
                  <tr key={ch.id} className="hover:bg-bg-raised/20">
                    <td className="px-2 py-1.5 align-middle">
                      <input
                        type="checkbox"
                        checked={selected.has(ch.id)}
                        onChange={() => toggle(ch.id)}
                        disabled={disabled}
                        aria-label={`Select ${ch.name}`}
                      />
                    </td>
                    <td className="px-2 py-1.5 align-middle">
                      <div className="text-ink-100 truncate">{ch.name}</div>
                      <div className="font-mono text-[9px] text-ink-500 truncate">{ch.serialNo ?? ch.id.slice(0, 8)}</div>
                    </td>
                    <td className="px-2 py-1.5 align-middle font-mono text-[10px] text-ink-300 truncate">
                      {ch.deviceId ?? "—"}
                    </td>
                    <td className="px-2 py-1.5 align-middle">
                      <ActiveBadge active={ch.active} />
                    </td>
                    <td className="px-2 py-1.5 align-middle">
                      <OnlineBadge online={ch.isOnline} />
                    </td>
                    <td className="px-2 py-1.5 align-middle text-ink-300 truncate">{ch.circuitName}</td>
                  </tr>
                )),
              ];
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SelectorButton({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded border border-bg-border bg-bg-base/50 px-2 py-1 text-ink-200 hover:bg-bg-base/70 hover:text-ink-50 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function ActiveBadge({ active }: { active: boolean | null }) {
  if (active === null) return <span className="text-ink-500">—</span>;
  return active ? (
    <span className="inline-flex items-center gap-1 rounded bg-sv-green/10 px-1.5 py-0.5 text-[10px] text-sv-green ring-1 ring-sv-green/30">
      <span className="h-1.5 w-1.5 rounded-full bg-sv-green" />
      active
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded bg-bg-base/60 px-1.5 py-0.5 text-[10px] text-ink-400 ring-1 ring-bg-border">
      <span className="h-1.5 w-1.5 rounded-full bg-ink-500" />
      inactive
    </span>
  );
}

function OnlineBadge({ online }: { online: boolean | null }) {
  if (online === null) return <span className="text-ink-500">—</span>;
  return online ? (
    <span className="inline-flex items-center gap-1 rounded bg-emerald-950/40 px-1.5 py-0.5 text-[10px] text-emerald-300 ring-1 ring-emerald-700/30">
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
      online
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded bg-bg-base/60 px-1.5 py-0.5 text-[10px] text-ink-400 ring-1 ring-bg-border">
      <span className="h-1.5 w-1.5 rounded-full bg-ink-500" />
      offline
    </span>
  );
}

function ImportSuccessPanel({
  result,
  onDone,
}: {
  result: ZaptecImportResult;
  onDone: () => void;
}) {
  return (
    <div className="space-y-4 px-5 py-4">
      <div className="rounded border border-sv-green/40 bg-sv-green/10 p-3 text-xs text-sv-green">
        <p className="font-medium">
          Imported {result.chargers.length} charger{result.chargers.length === 1 ? "" : "s"}.
        </p>
        <p className="mt-1 text-sv-green/80">
          OCPP password applied installation-wide. Make sure the
          Zaptec portal&apos;s OCPP URL is set to{" "}
          <code className="font-mono">
            wss://straumvakt-ocpp-staging.straumvakt.workers.dev/ocpp/&#123;deviceId&#125;
          </code>{" "}
          — Zaptec substitutes <code className="font-mono">&#123;deviceId&#125;</code> per
          charger.
        </p>
      </div>

      <div className="rounded-md border border-bg-border bg-bg-base/30">
        <table className="w-full table-fixed text-left text-xs">
          <thead className="bg-bg-inset/40 text-[10px] uppercase tracking-brand text-ink-500">
            <tr>
              <th className="w-[40%] px-3 py-2 font-medium">Charger</th>
              <th className="w-[60%] px-3 py-2 font-medium">Identity (DeviceId)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-bg-border/40">
            {result.chargers.map((c) => (
              <tr key={c.ocppIdentityId}>
                <td className="break-words px-3 py-2 text-ink-100">{c.displayName}</td>
                <td className="break-all px-3 py-2 font-mono text-[11px] text-ink-200">{c.identityString}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex justify-end gap-2 border-t border-bg-border pt-3">
        <button
          type="button"
          onClick={onDone}
          className="rounded-md bg-sv-green/20 px-3 py-1.5 text-xs font-medium text-sv-green ring-1 ring-sv-green/30 hover:bg-sv-green/30"
        >
          Done
        </button>
      </div>
    </div>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-brand text-ink-400">
        {label}
        {required && <span className="ml-1 text-rose-400">*</span>}
      </span>
      {children}
    </label>
  );
}

function humaniseError(code: string): string {
  switch (code) {
    case "invalid_credentials":
      return "Zaptec rejected the credentials. Run the Discover step again.";
    case "vendor_zaptec_missing":
      return "The Zaptec vendor row is not configured in the hardware catalogue. Ask an admin to add it before importing.";
    case "org_not_found":
      return "Selected org no longer exists.";
    case "installation_not_accessible":
      return "These credentials no longer have access to that installation.";
    case "zaptec_unreachable":
      return "Could not reach api.zaptec.com — check network and retry.";
    default:
      return code.startsWith("zaptec_")
        ? `Zaptec API error: ${code}`
        : `Import failed: ${code}`;
  }
}
