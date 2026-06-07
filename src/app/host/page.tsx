"use client";

// Host dashboard — concept look (host.css) on live N1 data. KPIs (month energy
// + charges from the sessions summary, station counts), installations table,
// recent charges, and a live connector-status grid. All via org-scoped
// /api/admin/orgs/:id/* endpoints.

import { useEffect, useState } from "react";
import { apiFetchJson } from "@/lib/api-client";
import { useHostOrg } from "./host-shell";

type Charger = {
  chargingStationId: string;
  identityString?: string;
  installationDisplayName?: string | null;
  online?: boolean;
};
type Named = { id: string; displayName: string };
type RecentSession = {
  id: string;
  startedAt: string;
  station: string;
  energyKwh: number | null;
  status: string;
};
type SessionSummary = {
  totalCount: number;
  totalEnergyKwh: number;
  monthCount: number;
  monthEnergyKwh: number;
  recent: RecentSession[];
};

function sessionBadge(status: string): { cls: string; dot: string; label: string } {
  if (status === "in_progress") return { cls: "s-live", dot: "bg-live", label: "Í hleðslu" };
  if (status === "completed") return { cls: "s-ok", dot: "bg-ok", label: "Lokið" };
  if (status === "faulted" || status === "aborted") return { cls: "s-bad", dot: "bg-bad", label: status };
  return { cls: "s-mut", dot: "bg-mut", label: status };
}

export default function HostDashboard() {
  const org = useHostOrg();
  const [chargers, setChargers] = useState<Charger[] | null>(null);
  const [sites, setSites] = useState<Named[] | null>(null);
  const [insts, setInsts] = useState<Named[] | null>(null);
  const [sessions, setSessions] = useState<SessionSummary | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!org) return;
    let cancelled = false;
    (async () => {
      try {
        const [ch, si, ins, se] = await Promise.all([
          apiFetchJson<{ chargers: Charger[] }>(`/api/admin/orgs/${org.orgId}/chargers`),
          apiFetchJson<{ sites: Named[] }>(`/api/admin/orgs/${org.orgId}/sites`),
          apiFetchJson<{ installations: Named[] }>(`/api/admin/orgs/${org.orgId}/installations`),
          apiFetchJson<{ summary: SessionSummary }>(`/api/admin/orgs/${org.orgId}/sessions`),
        ]);
        if (cancelled) return;
        setChargers(ch.chargers);
        setSites(si.sites);
        setInsts(ins.installations);
        setSessions(se.summary);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [org]);

  const total = chargers?.length ?? 0;
  const online = chargers?.filter((c) => c.online).length ?? 0;
  const countByInst = (name: string) =>
    chargers?.filter((c) => (c.installationDisplayName ?? "") === name).length ?? 0;

  return (
    <>
      <div className="head">
        <div>
          <h1>Mælaborð</h1>
          <p>Yfirlit yfir hleðslunet {org?.displayName ?? ""} — þennan mánuð.</p>
        </div>
      </div>

      {err && (
        <div className="card" style={{ padding: "14px 18px", marginBottom: 16, borderColor: "rgba(255,107,107,.4)", color: "var(--red)" }}>
          {err}
        </div>
      )}

      <div className="grid g4" style={{ marginBottom: 16 }}>
        <Kpi lbl="Orka í mánuðinum" val={sessions ? `${sessions.monthEnergyKwh.toLocaleString("is-IS")} kWh` : undefined} grad />
        <Kpi lbl="Hleðslur í mánuðinum" val={sessions ? String(sessions.monthCount) : undefined} />
        <Kpi lbl="Stöðvar" val={chargers === null ? undefined : `${online} / ${total}`} sub="nettengdar" />
        <Kpi lbl="Hleðslur alls" val={sessions ? sessions.totalCount.toLocaleString("is-IS") : undefined} />
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-h">
          Uppsetningar <span className="sub">{org?.displayName ?? ""}</span>
        </div>
        <table>
          <thead>
            <tr><th>Uppsetning</th><th>Stöðvar</th><th>Staða</th></tr>
          </thead>
          <tbody>
            {insts === null && <tr><td colSpan={3} className="empty">Hleð…</td></tr>}
            {insts?.map((i) => {
              const n = countByInst(i.displayName);
              return (
                <tr key={i.id}>
                  <td><strong>{i.displayName}</strong></td>
                  <td>{n}</td>
                  <td>
                    <span className={"badge2 " + (n > 0 ? "s-ok" : "s-mut")}>
                      <span className={"dot " + (n > 0 ? "bg-ok" : "bg-mut")} />
                      {n > 0 ? "Virk" : "Engar stöðvar"}
                    </span>
                  </td>
                </tr>
              );
            })}
            {insts?.length === 0 && <tr><td colSpan={3} className="empty">Engar uppsetningar.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="grid g2">
        <div className="card">
          <div className="card-h">Nýlegar hleðslur <span className="sub">síðustu 10</span></div>
          <table>
            <thead>
              <tr><th>Stöð</th><th>Orka</th><th>Staða</th><th>Tími</th></tr>
            </thead>
            <tbody>
              {sessions === null && <tr><td colSpan={4} className="empty">Hleð…</td></tr>}
              {sessions?.recent.length === 0 && (
                <tr><td colSpan={4} className="empty">Engar hleðslur enn.</td></tr>
              )}
              {sessions?.recent.map((s) => {
                const b = sessionBadge(s.status);
                return (
                  <tr key={s.id}>
                    <td className="mono">{s.station}</td>
                    <td>{s.energyKwh === null ? "—" : `${s.energyKwh} kWh`}</td>
                    <td><span className={"badge2 " + b.cls}><span className={"dot " + b.dot} />{b.label}</span></td>
                    <td className="sub">{s.startedAt.slice(0, 16).replace("T", " ")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="card" style={{ alignSelf: "start" }}>
          <div className="card-h">Staða stöðva <span className="sub">{total} stöðvar</span></div>
          {chargers === null ? (
            <div className="empty">Hleð…</div>
          ) : (
            <div className="conns">
              {chargers.slice(0, 24).map((c) => (
                <div key={c.chargingStationId} className={"conn " + (c.online ? "ok" : "bad")}>
                  <div>
                    <div className="id">{(c.identityString ?? c.chargingStationId).slice(-4)}</div>
                    {c.online ? "Nettengd" : "Ótengd"}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function Kpi({ lbl, val, grad, sub }: { lbl: string; val: string | undefined; grad?: boolean; sub?: string }) {
  return (
    <div className="card kpi">
      <div className="lbl">{lbl}</div>
      <div className={"val" + (grad ? " grad" : "")}>{val === undefined ? "—" : val}</div>
      {sub && <div className="delta flat">{sub}</div>}
    </div>
  );
}
