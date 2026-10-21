"use client";

// Host drivers (Ökumenn) — drivers with access to the org's network, via the
// host-reachable /api/admin/orgs/:id/drivers endpoint. Concept look.

import { useEffect, useState } from "react";
import { apiFetchJson } from "@/lib/api-client";
import { useHostOrg } from "../host-shell";

type Driver = {
  userId: string;
  email: string;
  displayName: string;
  status: string;
  groups: string[];
  rfids: string[];
  addedAt: string;
};

export default function HostDrivers() {
  const org = useHostOrg();
  const [rows, setRows] = useState<Driver[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!org) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await apiFetchJson<{ drivers: Driver[] }>(
          `/api/admin/orgs/${org.orgId}/drivers`,
        );
        if (!cancelled) setRows(r.drivers);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [org]);

  return (
    <>
      <div className="head">
        <div>
          <h1>Ökumenn</h1>
          <p>
            Ökumenn með aðgang að hleðslunetinu þínu. Þú stýrir hverjir hafa
            aðgang.
          </p>
        </div>
      </div>

      {err && (
        <div
          className="card"
          style={{
            padding: "14px 18px",
            marginBottom: 16,
            borderColor: "rgba(255,107,107,.4)",
            color: "var(--red)",
          }}
        >
          {err}
        </div>
      )}

      <div className="card">
        <div className="card-h">
          Ökumenn{" "}
          <span className="sub">{rows ? `${rows.length} með aðgang` : ""}</span>
        </div>
        <table>
          <thead>
            <tr>
              <th>Ökumaður</th>
              <th>RFID</th>
              <th>Aðgangshópar</th>
              <th>Staða</th>
              <th>Bætt við</th>
            </tr>
          </thead>
          <tbody>
            {rows === null && (
              <tr>
                <td colSpan={5} className="empty">
                  Hleð…
                </td>
              </tr>
            )}
            {rows?.length === 0 && (
              <tr>
                <td colSpan={5} className="empty">
                  Engir ökumenn með aðgang enn.
                </td>
              </tr>
            )}
            {rows?.map((d) => (
              <tr key={d.userId}>
                <td>
                  <strong>{d.displayName}</strong>
                  <div className="sub">{d.email}</div>
                </td>
                <td className="mono">{d.rfids.length ? d.rfids.join(", ") : <span className="sub">—</span>}</td>
                <td className="sub">{d.groups.join(", ") || "—"}</td>
                <td>
                  <span
                    className={
                      "badge2 " + (d.status === "active" ? "s-ok" : "s-mut")
                    }
                  >
                    <span
                      className={
                        "dot " + (d.status === "active" ? "bg-ok" : "bg-mut")
                      }
                    />
                    {d.status === "active" ? "Virkur" : d.status}
                  </span>
                </td>
                <td className="sub">{d.addedAt.slice(0, 10)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
