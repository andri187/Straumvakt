"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-client";
import type {
  CredentialApplyResult,
  CredentialChargerNode,
  CredentialCircuitNode,
  CredentialInstallationNode,
  CredentialManageTree,
} from "@straumvakt/shared/domain/credential-management";

// Client tree-with-checkboxes for vendor-credential management.
// Mirrors the /sites tree visual hierarchy (installation → circuit →
// charger). Initial selection = chargers currently imported into our
// DB; the diff against the user's edits is applied via POST /apply.

export function ManageTree({
  credentialId,
  initialTree,
}: {
  credentialId: string;
  initialTree: CredentialManageTree;
}) {
  const router = useRouter();

  const initiallyImportedIds = useMemo(() => {
    const set = new Set<string>();
    for (const inst of initialTree.installations) {
      for (const cir of inst.circuits) {
        for (const ch of cir.chargers) {
          if (ch.imported) set.add(ch.zaptecId);
        }
      }
    }
    return set;
  }, [initialTree]);

  // Manageable = chargers under an installation that's already in our
  // DB. Operator can only add/remove these. Unimported-installation
  // chargers stay read-only.
  const manageableIds = useMemo(() => {
    const set = new Set<string>();
    for (const inst of initialTree.installations) {
      if (!inst.imported) continue;
      for (const cir of inst.circuits) {
        for (const ch of cir.chargers) {
          set.add(ch.zaptecId);
        }
      }
    }
    return set;
  }, [initialTree]);

  const [selected, setSelected] = useState<Set<string>>(new Set(initiallyImportedIds));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CredentialApplyResult | null>(null);

  function toggle(zaptecId: string) {
    if (!manageableIds.has(zaptecId)) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(zaptecId)) next.delete(zaptecId);
      else next.add(zaptecId);
      return next;
    });
  }

  function toggleAllForInstallation(inst: CredentialInstallationNode, on: boolean) {
    if (!inst.imported) return;
    setSelected((prev) => {
      const next = new Set(prev);
      for (const cir of inst.circuits) {
        for (const ch of cir.chargers) {
          if (on) next.add(ch.zaptecId);
          else next.delete(ch.zaptecId);
        }
      }
      return next;
    });
  }

  // Diff vs initial — drives the Apply button label and disable state.
  const toAddCount = useMemo(() => {
    let n = 0;
    for (const id of selected) if (!initiallyImportedIds.has(id)) n++;
    return n;
  }, [selected, initiallyImportedIds]);

  const toRemoveCount = useMemo(() => {
    let n = 0;
    for (const id of initiallyImportedIds) if (!selected.has(id)) n++;
    return n;
  }, [selected, initiallyImportedIds]);

  const dirty = toAddCount + toRemoveCount > 0;

  async function apply() {
    if (!dirty) return;
    if (toRemoveCount > 0) {
      const confirmed = window.confirm(
        `Apply changes?\n\n` +
          `• Add ${toAddCount} charger(s) to our DB\n` +
          `• Remove ${toRemoveCount} charger(s) — this deletes their sessions and OCPP identity (Zaptec untouched)\n\n` +
          `Continue?`,
      );
      if (!confirmed) return;
    }
    setError(null);
    setResult(null);
    setBusy(true);
    try {
      const res = await apiFetch(
        `/api/admin/vendor-credentials/${credentialId}/apply`,
        {
          method: "POST",
          body: JSON.stringify({
            selectedZaptecChargerIds: Array.from(selected),
          }),
        },
      );
      const body = (await res.json().catch(() => null)) as
        | { result: CredentialApplyResult; error?: undefined }
        | { error: string }
        | null;
      if (!res.ok || !body || "error" in body) {
        setError((body as { error?: string } | null)?.error ?? `HTTP ${res.status}`);
        return;
      }
      setResult(body.result);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const importedInstallations = initialTree.installations.filter((i) => i.imported);
  const unimportedInstallations = initialTree.installations.filter((i) => !i.imported);

  return (
    <div>
      <div className="sticky top-0 z-10 mb-4 flex items-center gap-3 rounded-md border border-bg-border bg-bg-base/90 px-4 py-2.5 backdrop-blur">
        <div className="text-xs text-ink-300">
          <span className="font-mono text-sv-sky">{selected.size}</span> selected
          {dirty && (
            <span className="ml-3 text-ink-400">
              {toAddCount > 0 && (
                <span className="text-emerald-300">+{toAddCount} add</span>
              )}
              {toAddCount > 0 && toRemoveCount > 0 && <span className="mx-1">·</span>}
              {toRemoveCount > 0 && (
                <span className="text-rose-300">−{toRemoveCount} remove</span>
              )}
            </span>
          )}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {error && <span className="text-[11px] text-rose-300">{error}</span>}
          <button
            type="button"
            disabled={!dirty || busy}
            onClick={() => setSelected(new Set(initiallyImportedIds))}
            className="rounded border border-bg-border bg-bg-base/40 px-3 py-1 text-xs text-ink-300 hover:bg-bg-raised hover:text-ink-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Reset
          </button>
          <button
            type="button"
            disabled={!dirty || busy}
            onClick={apply}
            className="rounded bg-sv-sky/90 px-3 py-1 text-xs font-medium text-bg-base hover:bg-sv-sky disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? "Applying…" : `Apply${dirty ? ` (${toAddCount + toRemoveCount})` : ""}`}
          </button>
        </div>
      </div>

      {result && <ResultBanner result={result} onDismiss={() => setResult(null)} />}

      {importedInstallations.length === 0 && unimportedInstallations.length === 0 ? (
        <div className="rounded border border-dashed border-bg-border p-6 text-center text-sm text-ink-500">
          No installations returned by Zaptec for this credential.
        </div>
      ) : (
        <div className="divide-y divide-bg-border/60 rounded-md border border-bg-border bg-bg-base/30">
          {importedInstallations.map((inst) => (
            <InstallationRow
              key={inst.zaptecId}
              inst={inst}
              selected={selected}
              onToggleCharger={toggle}
              onToggleAll={(on) => toggleAllForInstallation(inst, on)}
            />
          ))}
          {unimportedInstallations.length > 0 && (
            <div className="bg-bg-inset/30 px-4 py-3">
              <p className="mb-2 text-[10px] uppercase tracking-brand text-ink-500">
                Not imported — use the wizard to onboard
              </p>
              {unimportedInstallations.map((inst) => (
                <InstallationRow
                  key={inst.zaptecId}
                  inst={inst}
                  selected={selected}
                  onToggleCharger={toggle}
                  onToggleAll={() => {}}
                  readOnly
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ResultBanner({
  result,
  onDismiss,
}: {
  result: CredentialApplyResult;
  onDismiss: () => void;
}) {
  const total =
    result.added + result.removed + result.failed.length + result.skipped.length;
  const allOk = result.failed.length === 0 && result.skipped.length === 0;
  return (
    <div
      className={
        "mb-4 rounded-md border p-3 text-xs " +
        (allOk
          ? "border-emerald-700/40 bg-emerald-950/30 text-emerald-200"
          : "border-amber-700/40 bg-amber-950/30 text-amber-200")
      }
    >
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <span className="font-medium">Applied —</span>{" "}
          <span className="text-emerald-300">+{result.added}</span> added,{" "}
          <span className="text-rose-300">−{result.removed}</span> removed
          {result.failed.length > 0 && (
            <span className="ml-1 text-rose-300">· {result.failed.length} failed</span>
          )}
          {result.skipped.length > 0 && (
            <span className="ml-1 text-ink-400">· {result.skipped.length} skipped</span>
          )}
          {total === 0 && <span className="ml-1 text-ink-400">— no changes</span>}
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="text-ink-400 hover:text-ink-50"
          aria-label="Dismiss"
        >
          ×
        </button>
      </div>
      {(result.failed.length > 0 || result.skipped.length > 0) && (
        <ul className="mt-2 space-y-0.5 font-mono text-[10px]">
          {result.failed.map((f) => (
            <li key={`f-${f.zaptecId}`} className="text-rose-300">
              fail · {f.zaptecId.slice(0, 8)} · {f.reason}
            </li>
          ))}
          {result.skipped.map((s) => (
            <li key={`s-${s.zaptecId}`} className="text-ink-400">
              skip · {s.zaptecId.slice(0, 8)} · {s.reason}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function InstallationRow({
  inst,
  selected,
  onToggleCharger,
  onToggleAll,
  readOnly = false,
}: {
  inst: CredentialInstallationNode;
  selected: Set<string>;
  onToggleCharger: (id: string) => void;
  onToggleAll: (on: boolean) => void;
  readOnly?: boolean;
}) {
  const allChargers = inst.circuits.flatMap((c) => c.chargers);
  const total = allChargers.length;
  const totalImportable = allChargers.length;
  const totalSelected = allChargers.filter((c) => selected.has(c.zaptecId)).length;
  const allSelected = total > 0 && totalSelected === totalImportable;
  const someSelected = totalSelected > 0 && !allSelected;

  return (
    <details className="group" open={inst.imported && total > 0 && total <= 12}>
      <summary className="flex cursor-pointer items-center gap-3 px-4 py-2.5 hover:bg-bg-base/20">
        <span className="text-ink-500 transition-transform group-open:rotate-90">▸</span>
        {!readOnly && inst.imported ? (
          <input
            type="checkbox"
            checked={allSelected}
            ref={(el) => {
              if (el) el.indeterminate = someSelected;
            }}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => onToggleAll(e.target.checked)}
            className="h-4 w-4 cursor-pointer accent-sv-sky"
            aria-label={`Select all chargers under ${inst.name}`}
          />
        ) : (
          <span className="h-4 w-4" />
        )}
        <div className="flex flex-1 items-baseline gap-2 min-w-0">
          <span className="text-sm font-medium text-ink-50 truncate">{inst.name}</span>
          {inst.imported ? (
            <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-300">
              imported
            </span>
          ) : (
            <span className="rounded bg-ink-800/60 px-1.5 py-0.5 text-[10px] text-ink-400">
              not imported
            </span>
          )}
          <span className="font-mono text-[10px] text-ink-500 truncate">
            {inst.zaptecId.slice(0, 8)}
          </span>
        </div>
        <span className="text-[11px] text-ink-400">
          {totalSelected}/{total} selected
        </span>
      </summary>
      <div className="border-t border-bg-border/40 bg-bg-base/20 px-4 py-2">
        {inst.circuits.length === 0 ? (
          <p className="px-1 py-2 text-[11px] italic text-ink-500">No circuits.</p>
        ) : (
          inst.circuits.map((cir) => (
            <CircuitRow
              key={cir.zaptecId}
              circuit={cir}
              selected={selected}
              onToggleCharger={onToggleCharger}
              readOnly={readOnly || !inst.imported}
            />
          ))
        )}
      </div>
    </details>
  );
}

function CircuitRow({
  circuit,
  selected,
  onToggleCharger,
  readOnly,
}: {
  circuit: CredentialCircuitNode;
  selected: Set<string>;
  onToggleCharger: (id: string) => void;
  readOnly: boolean;
}) {
  return (
    <details
      className="group/c"
      open={circuit.chargers.length > 0 && circuit.chargers.length <= 8}
    >
      <summary
        className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 hover:bg-bg-base/30"
        style={{ paddingLeft: "1.75rem" }}
      >
        <span className="text-[10px] text-ink-500 transition-transform group-open/c:rotate-90">
          ▸
        </span>
        <span className="text-xs text-ink-200">{circuit.name}</span>
        <span className="font-mono text-[10px] text-ink-500">
          {circuit.maxCurrent != null ? `${circuit.maxCurrent}A` : ""}
        </span>
        <span className="ml-auto text-[10px] text-ink-500">
          {circuit.chargers.length} charger
          {circuit.chargers.length === 1 ? "" : "s"}
        </span>
      </summary>
      <div>
        {circuit.chargers.length === 0 ? (
          <p
            style={{ paddingLeft: "3rem" }}
            className="py-1 text-[11px] italic text-ink-500"
          >
            No chargers on this circuit.
          </p>
        ) : (
          circuit.chargers.map((ch) => (
            <ChargerLine
              key={ch.zaptecId}
              charger={ch}
              selected={selected.has(ch.zaptecId)}
              onToggle={() => onToggleCharger(ch.zaptecId)}
              readOnly={readOnly}
            />
          ))
        )}
      </div>
    </details>
  );
}

function ChargerLine({
  charger,
  selected,
  onToggle,
  readOnly,
}: {
  charger: CredentialChargerNode;
  selected: boolean;
  onToggle: () => void;
  readOnly: boolean;
}) {
  const primary = charger.deviceId || charger.serialNo || charger.name || charger.zaptecId.slice(0, 8);
  const secondary = charger.name && charger.name !== primary ? charger.name : null;
  const onlineDot = charger.isOnline ? "bg-emerald-400" : "bg-ink-600";
  return (
    <label
      className={
        "flex items-center gap-2 rounded px-2 py-1 text-xs " +
        (readOnly ? "opacity-60" : "cursor-pointer hover:bg-bg-base/30")
      }
      style={{ paddingLeft: "3rem" }}
    >
      <input
        type="checkbox"
        checked={selected}
        disabled={readOnly}
        onChange={onToggle}
        className="h-4 w-4 accent-sv-sky disabled:cursor-not-allowed"
      />
      <span
        className={`h-2 w-2 shrink-0 rounded-full ${onlineDot}`}
        title={charger.isOnline ? "Online (Zaptec)" : "Offline (Zaptec)"}
      />
      <span className="font-mono text-ink-100 truncate">{primary}</span>
      {secondary && (
        <span className="text-[11px] text-ink-400 truncate">{secondary}</span>
      )}
      {!charger.active && (
        <span className="rounded bg-amber-950/40 px-1 py-0.5 text-[9px] text-amber-300">
          decommissioned
        </span>
      )}
      <span className="ml-auto flex items-center gap-2 text-[10px] text-ink-500">
        {charger.imported ? (
          <span className="text-emerald-300/80">in DB</span>
        ) : (
          <span>not in DB</span>
        )}
      </span>
    </label>
  );
}
