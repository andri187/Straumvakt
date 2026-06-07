"use client";

// Host dashboard — concept look (host.css classes) on live N1 data via the
// org-scoped /api/admin/orgs/:id/* endpoints. KPIs + installations table +
// live connector-status grid. (Energy/charges/drivers KPIs land once the
// host-reachable sessions endpoint exists.)

import { useEffect, useState } from "react";
import { apiFetchJson } from "@/lib/api-client";
import { useHostOrg } from "./host-shell";

type Charger = {
  chargingStationId: string;
  identityString?: string;
  siteDisplayName?: string;
  installationDisplayName?: string | null;
  online?: boolean;
  status?: string | null;
};
type Named = { id: string; displayName: string };

export default function HostDashboard() {
  const org = useHostOrg();
  const [chargers, setChargers] = useState<Charger[] | null>(null);
  const [sites, setSites] = useState<Named[] | null>(null);
  const [insts, setInsts] = useState<Named[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!org) return;
    let cancelled = false;
    (async () => {
      try {
        const [ch, si, ins] = await Promise.all([
          apiFetchJson<{ chargers: Charger[] }>(`/api/admin/orgs/${org.orgId}/chargers`),
          apiFetchJson<{ sites: Named[] }>(`/api/admin/orgs/${org.orgId}/sites`),
          apiFetchJson<{ installations: Named[] }>(`/api/admin/orgs/${org.orgId}/installations`),
        ]);
        if (cancelled) return;
        setChargers(ch.chargers);
        setSites(si.sites);
        setInsts(ins.installations);
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
          <p>Yfirlit yfir hleðslunet {org?.displayName ?? ""}.</p>
        </div>
      </div>

      {err && (
        <div className="card" style={{ padding: "14px 18px", marginBottom: 16, borderColor: "rgba(255,107,107,.4)", color: "var(--red)" }}>
          {err}
        </div>
      )}

      <div className="grid g4" style={{ marginBottom: 16 }}>
        <Kpi lbl="Stöðvar" val={chargers === null ? undefined : total} grad />
        <Kpi lbl="Nettengdar" val={chargers === null ? undefined : online} />
        <Kpi lbl="Svæði" val={sites === null ? undefined : sites.length} />
        <Kpi lbl="Uppsetningar" val={insts === null ? undefined : insts.length} />
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-h">
          Uppsetningar <span className="sub">{org?.displayName ?? ""}</span>
        </div>
        <table>
          <thead>
            <tr>
              <th>Uppsetning</th>
              <th>Stöðvar</th>
              <th>Staða</th>
            </tr>
          </thead>
          <tbody>
            {insts === null && (
              <tr><td colSpan={3} className="empty">Hleð…</td></tr>
            )}
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
            {insts?.length === 0 && (
              <tr><td colSpan={3} className="empty">Engar uppsetningar.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card">
        <div className="card-h">
          Staða stöðva <span className="sub">{total} stöðvar</span>
        </div>
        {chargers === null ? (
          <div className="empty">Hleð…</div>
        ) : (
          <div className="conns">
            {chargers.slice(0, 48).map((c) => (
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
    </>
  );
}

function Kpi({ lbl, val, grad }: { lbl: string; val: number | undefined; grad?: boolean }) {
  return (
    <div className="card kpi">
      <div className="lbl">{lbl}</div>
      <div className={"val" + (grad ? " grad" : "")}>{val === undefined ? "—" : val}</div>
    </div>
  );
}
