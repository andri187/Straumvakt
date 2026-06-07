"use client";

// Host chargers — concept look (host.css), real N1 chargers grouped by
// installation with tabs. Read-only; config/tariff stay operator-set.

import { useEffect, useState } from "react";
import { apiFetchJson } from "@/lib/api-client";
import { useHostOrg } from "../host-shell";

type Charger = {
  chargingStationId: string;
  identityString?: string;
  siteDisplayName?: string;
  installationDisplayName?: string | null;
  connectorType?: string;
  maxPowerKw?: number | null;
  online?: boolean;
  status?: string | null;
};

function groupBy<T>(arr: T[], key: (t: T) => string): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const x of arr) {
    const k = key(x);
    (out[k] ??= []).push(x);
  }
  return out;
}

export default function HostChargers() {
  const org = useHostOrg();
  const [rows, setRows] = useState<Charger[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<string | null>(null);

  useEffect(() => {
    if (!org) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await apiFetchJson<{ chargers: Charger[] }>(
          `/api/admin/orgs/${org.orgId}/chargers`,
        );
        if (!cancelled) setRows(r.chargers);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [org]);

  const groups = groupBy(
    rows ?? [],
    (c) => c.installationDisplayName || c.siteDisplayName || "Hleðslustöðvar",
  );
  const names = Object.keys(groups);
  const active = tab && names.includes(tab) ? tab : names[0];
  const list = active ? groups[active] : [];

  return (
    <>
      <div className="head">
        <div>
          <h1>Hleðslustöðvar</h1>
          <p>Stöðvar á þínu neti. Uppsetning og verðskrá eru í höndum Straumvaktar.</p>
        </div>
      </div>

      {err && (
        <div className="card" style={{ padding: "14px 18px", marginBottom: 16, borderColor: "rgba(255,107,107,.4)", color: "var(--red)" }}>
          {err}
        </div>
      )}

      {rows === null ? (
        <div className="card"><div className="empty">Hleð…</div></div>
      ) : (
        <>
          {names.length > 1 && (
            <div className="tabs">
              {names.map((n) => (
                <div
                  key={n}
                  className={"tab" + (n === active ? " active" : "")}
                  onClick={() => setTab(n)}
                >
                  {n} · {groups[n].length}
                </div>
              ))}
            </div>
          )}

          <div className="card">
            <div className="card-h">
              Stöðvar <span className="sub">{active ?? ""} · {list.length} stöðvar</span>
              <span className="badge2 s-ok"><span className="dot bg-ok" />Samningur virkur</span>
            </div>
            <table>
              <thead>
                <tr>
                  <th>Stöð</th>
                  <th>Tengi</th>
                  <th>Afl</th>
                  <th>Staða</th>
                </tr>
              </thead>
              <tbody>
                {list.map((c) => (
                  <tr key={c.chargingStationId}>
                    <td className="mono">{c.identityString ?? c.chargingStationId.slice(0, 8)}</td>
                    <td className="sub">{c.connectorType ?? "Type 2"}</td>
                    <td>{c.maxPowerKw ? `${c.maxPowerKw} kW` : "—"}</td>
                    <td>
                      <span className={"badge2 " + (c.online ? "s-ok" : "s-bad")}>
                        <span className={"dot " + (c.online ? "bg-ok" : "bg-bad")} />
                        {c.online ? "Nettengd" : (c.status ?? "Ótengd")}
                      </span>
                    </td>
                  </tr>
                ))}
                {list.length === 0 && (
                  <tr><td colSpan={4} className="empty">Engar stöðvar.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
