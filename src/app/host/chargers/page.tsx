"use client";

// Host chargers — Site → Installation → Circuit → Charger tree (mirrors the
// operator /sites view), host.css-styled. Read-only; setup + pricing stay
// Straumvakt-set. Dedup: a site with a single same-named installation renders
// once (the installation's vendor/status fold onto the site row) rather than
// listing "Dalvegur 10 - 14" twice.

import { useEffect, useState, type CSSProperties } from "react";
import { apiFetchJson } from "@/lib/api-client";
import { useHostOrg } from "../host-shell";
import { usePremium } from "@/lib/premium";
import type {
  SiteTreeNode,
  SiteTreeInstallationNode,
  SiteTreeCircuitNode,
  SiteTreeChargerNode,
} from "@straumvakt/shared/domain/site-tree";

// ###.###,## — Icelandic grouping (period thousands, comma decimal).
function fmtKwh(v: number | null): string {
  if (v == null) return "—";
  const [whole, frac] = v.toFixed(2).split(".");
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${frac}`;
}
const norm = (s: string) => s.trim().toLowerCase();

function chargerCategory(c: SiteTreeChargerNode): "faulted" | "offline" | "in-use" | "available" {
  const real = c.connectors.filter((k) => k.source != null);
  if (real.some((k) => k.status === "Faulted")) return "faulted";
  if (!c.online || real.length === 0 || real.some((k) => k.status === "Unavailable")) return "offline";
  const inUse = (s: string) =>
    ["Preparing", "Charging", "SuspendedEV", "SuspendedEVSE", "Finishing", "Reserved"].includes(s);
  if (real.some((k) => inUse(k.status))) return "in-use";
  return "available";
}
const DOT: Record<string, string> = {
  faulted: "var(--red)",
  offline: "var(--muted)",
  "in-use": "var(--blue)",
  available: "var(--green)",
};

export default function HostChargers() {
  const org = useHostOrg();
  const [tree, setTree] = useState<SiteTreeNode[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [showDecom, setShowDecom] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!org) return;
    let cancelled = false;
    setTree(null);
    (async () => {
      try {
        const r = await apiFetchJson<{ tree: SiteTreeNode[] }>(
          `/api/admin/orgs/${org.orgId}/sites/tree${showDecom ? "?includeDecommissioned=true" : ""}`,
        );
        if (cancelled) return;
        setTree(r.tree);
        // Default: everything expanded (matches the at-a-glance fleet view).
        const ids = new Set<string>();
        for (const s of r.tree) {
          ids.add(s.id);
          for (const i of s.installations) {
            ids.add(i.id);
            for (const cir of i.circuits) ids.add(cir.id);
          }
          for (const cir of s.orphanCircuits) ids.add(cir.id);
        }
        setOpen(ids);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [org, showDecom]);

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <>
      <div className="head">
        <div>
          <h1>Hleðslustöðvar</h1>
          <p>Svæði → kerfi → straumrás → stöð. Uppsetning og verðskrá eru í höndum Straumvaktar.</p>
        </div>
      </div>

      {err && (
        <div className="card" style={{ padding: "14px 18px", marginBottom: 16, borderColor: "rgba(255,107,107,.4)", color: "var(--red)" }}>
          {err}
        </div>
      )}

      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 10 }}>
        <div className="sub" style={{ textTransform: "uppercase", letterSpacing: ".1em", fontSize: 11 }}>
          Öll svæði {tree ? `(${tree.length})` : ""}
        </div>
        <button
          type="button"
          className="btn sm"
          onClick={() => setShowDecom((v) => !v)}
          style={showDecom ? { borderColor: "rgba(245,180,80,.5)", color: "var(--amber, #f5b450)" } : undefined}
        >
          {showDecom ? "Fela afskráðar" : "Sýna afskráðar"}
        </button>
      </div>

      {tree === null ? (
        <div className="card"><div className="empty">Hleð…</div></div>
      ) : tree.length === 0 ? (
        <div className="card"><div className="empty">Engin svæði enn.</div></div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          {tree.map((s) => (
            <SiteRow key={s.id} site={s} open={open} toggle={toggle} />
          ))}
        </div>
      )}
    </>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <span style={{ display: "inline-block", width: 14, color: "var(--muted)", transition: "transform .15s", transform: open ? "rotate(90deg)" : "none" }}>
      ▸
    </span>
  );
}
// Lifetime kWh is a PREMIUM feature — hidden unless the Premium preview is on.
function KwhPill({ value }: { value: number | null }) {
  const { enabled } = usePremium();
  if (!enabled) return null;
  return (
    <span className="mono" style={{ fontSize: 11, padding: "2px 7px", borderRadius: 6, background: "rgba(43,211,201,.1)", color: "var(--teal)", border: "1px solid rgba(43,211,201,.3)", whiteSpace: "nowrap" }}>
      {fmtKwh(value)} kWh
    </span>
  );
}
function CountPill({ online, offline }: { online: number; offline: number }) {
  return (
    <span className="mono" style={{ display: "inline-flex", gap: 6, fontSize: 11 }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 6px", borderRadius: 6, background: "rgba(62,233,167,.12)", color: "var(--green)" }}>
        <span style={{ width: 6, height: 6, borderRadius: 99, background: "var(--green)" }} />{online}
      </span>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 6px", borderRadius: 6, background: "rgba(255,255,255,.05)", color: "var(--muted)" }}>
        <span style={{ width: 6, height: 6, borderRadius: 99, background: "var(--muted)" }} />{offline}
      </span>
    </span>
  );
}

const ROW: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "9px 14px",
  cursor: "pointer",
  borderTop: "1px solid var(--border)",
};

function SiteRow({ site, open, toggle }: { site: SiteTreeNode; open: Set<string>; toggle: (id: string) => void }) {
  const isOpen = open.has(site.id);
  // Dedup: single installation, same name, no orphans → fold it onto the site.
  const only =
    site.installations.length === 1 && site.orphanCircuits.length === 0 && site.orphanChargers.length === 0
      ? site.installations[0]
      : null;
  const merged = only && norm(only.displayName) === norm(site.displayName) ? only : null;

  return (
    <div>
      <div style={{ ...ROW, borderTop: "none" }} onClick={() => toggle(site.id)}>
        <Chevron open={isOpen} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <span style={{ fontWeight: 700 }}>{site.displayName}</span>{" "}
          <span className="sub" style={{ fontSize: 12 }}>
            {site.orgDisplayName} · {site.propertyDisplayName} · <span className="mono">{site.siteType}/{site.accessLevel}</span>
            {merged?.vendorSlug ? <> · <span className="mono">{merged.vendorSlug}</span></> : null}
            {merged ? <> · <span className="mono">{merged.onboardingStatus}</span></> : null}
          </span>
        </div>
        <KwhPill value={site.lifetimeEnergyKWhTotal} />
        <CountPill online={site.chargersOnline} offline={site.chargersOffline} />
      </div>

      {isOpen && (
        <div>
          {merged ? (
            <InstallationBody installation={merged} open={open} toggle={toggle} depth={1} />
          ) : (
            site.installations.map((inst) => (
              <InstallationRow key={inst.id} installation={inst} open={open} toggle={toggle} />
            ))
          )}
          {site.orphanCircuits.map((cir) => (
            <CircuitRow key={cir.id} circuit={cir} open={open} toggle={toggle} depth={1} />
          ))}
          {site.orphanChargers.map((c) => (
            <ChargerLine key={c.chargingStationId} charger={c} depth={1} />
          ))}
        </div>
      )}
    </div>
  );
}

function InstallationRow({ installation, open, toggle }: { installation: SiteTreeInstallationNode; open: Set<string>; toggle: (id: string) => void }) {
  const isOpen = open.has(installation.id);
  return (
    <div>
      <div style={{ ...ROW, paddingLeft: 30 }} onClick={() => toggle(installation.id)}>
        <Chevron open={isOpen} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <span style={{ fontWeight: 600, fontSize: 13 }}>{installation.displayName}</span>{" "}
          {installation.vendorSlug && <span className="mono sub" style={{ fontSize: 11 }}>{installation.vendorSlug}</span>}{" "}
          <span className="mono sub" style={{ fontSize: 11 }}>{installation.onboardingStatus}</span>
        </div>
        <KwhPill value={installation.lifetimeEnergyKWhTotal} />
        <CountPill online={installation.chargersOnline} offline={installation.chargersOffline} />
      </div>
      {isOpen && <InstallationBody installation={installation} open={open} toggle={toggle} depth={2} />}
    </div>
  );
}

function InstallationBody({ installation, open, toggle, depth }: { installation: SiteTreeInstallationNode; open: Set<string>; toggle: (id: string) => void; depth: number }) {
  return (
    <div>
      {installation.circuits.map((cir) => (
        <CircuitRow key={cir.id} circuit={cir} open={open} toggle={toggle} depth={depth} />
      ))}
      {installation.directChargers.map((c) => (
        <ChargerLine key={c.chargingStationId} charger={c} depth={depth} />
      ))}
    </div>
  );
}

function CircuitRow({ circuit, open, toggle, depth }: { circuit: SiteTreeCircuitNode; open: Set<string>; toggle: (id: string) => void; depth: number }) {
  const isOpen = open.has(circuit.id);
  return (
    <div>
      <div style={{ ...ROW, paddingLeft: 14 + depth * 16 }} onClick={() => toggle(circuit.id)}>
        <Chevron open={isOpen} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: 13 }}>{circuit.displayName}</span>{" "}
          <span className="mono sub" style={{ fontSize: 11 }}>
            {circuit.phaseCount}-fasa{circuit.ampereCeiling ? ` · ${circuit.ampereCeiling}A` : ""}
          </span>
        </div>
        <KwhPill value={circuit.lifetimeEnergyKWhTotal} />
        <span className="sub" style={{ fontSize: 11 }}>{circuit.chargers.length} stöðvar</span>
      </div>
      {isOpen &&
        circuit.chargers.map((c) => <ChargerLine key={c.chargingStationId} charger={c} depth={depth + 1} />)}
    </div>
  );
}

function ChargerLine({ charger, depth }: { charger: SiteTreeChargerNode; depth: number }) {
  const { enabled: premium } = usePremium();
  const primary = charger.displayName || charger.serialNumber || charger.identityString || charger.chargingStationId.slice(0, 8);
  const secondary =
    charger.serialNumber && charger.serialNumber !== primary ? charger.serialNumber : null;
  const cat = chargerCategory(charger);
  const statusText = charger.online ? "nettengd" : "ótengd";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 14px", paddingLeft: 14 + depth * 16 + 14, borderTop: "1px solid var(--border)", opacity: charger.decommissioned ? 0.55 : 1 }}>
      <span title={cat} style={{ width: 8, height: 8, borderRadius: 99, background: DOT[cat], flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: 13 }}>{primary}</span>{" "}
        {secondary && <span className="mono sub" style={{ fontSize: 11 }}>{secondary}</span>}
        {charger.decommissioned && (
          <span className="sub" style={{ fontSize: 10, marginLeft: 6, color: "var(--amber,#f5b450)" }}>afskráð</span>
        )}
      </div>
      <span className="sub" style={{ fontSize: 11 }}>{statusText}</span>
      {premium && (
        <span className="mono sub" style={{ fontSize: 11, whiteSpace: "nowrap" }}>{fmtKwh(charger.lifetimeEnergyKWh)} kWh</span>
      )}
    </div>
  );
}
