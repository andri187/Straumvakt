"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-client";
import type { ZaptecImportResult } from "@straumvakt/shared/domain/zaptec-import";
import type { OrgSummary } from "@straumvakt/shared/domain/orgs";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Zaptec credentials carried over from the discover step. */
  username: string;
  password: string;
  /** Installation we're importing. */
  installation: { id: string; name: string; address: string | null; chargerCount: number };
}

export function ImportDialog({ open, onClose, username, password, installation }: Props) {
  const router = useRouter();
  const [orgs, setOrgs] = useState<OrgSummary[]>([]);
  const [loadingOrgs, setLoadingOrgs] = useState(false);
  const [orgId, setOrgId] = useState("");
  const [propertyDisplayName, setPropertyDisplayName] = useState("");
  const [siteDisplayName, setSiteDisplayName] = useState("");
  const [ocppPassword, setOcppPassword] = useState("");
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
                      {o.displayName} ({o.slug})
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
                disabled={submitting || !orgId || !propertyDisplayName || !siteDisplayName || !ocppPassword}
                className="rounded-md bg-sv-green/20 px-4 py-1.5 text-xs font-medium text-sv-green ring-1 ring-sv-green/30 hover:bg-sv-green/30 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {submitting ? "Importing…" : "Import"}
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
