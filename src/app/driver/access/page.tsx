"use client";

// Mínir aðgangar — installations the driver can charge at right now, with the
// indicative per-kWh headline. Live via /api/driver/installations.

import { useEffect, useState } from "react";
import { driverFetch } from "../driver-auth";

type Inst = {
  id: string;
  displayName: string;
  siteDisplayName: string;
  siteAddress: string | null;
  chargerCount: number;
  availableConnectorCount: number;
  pricingSummary: {
    perKwhMinor?: string;
    currency: string;
    vatRatePct: string;
    vatInclusive: boolean;
  };
};

export default function DriverAccess() {
  const [rows, setRows] = useState<Inst[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await driverFetch<{ installations: Inst[] }>(
          "/api/driver/installations",
        );
        if (!cancelled) setRows(r.installations);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <div className="head">
        <div>
          <h1>Mínir aðgangar</h1>
          <p>
            Staðir þar sem þú getur hlaðið núna. Verð er leiðbeinandi —
            endanlegt verð reiknast við lok hleðslu.
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
          Aðgangar{" "}
          <span className="sub">{rows ? `${rows.length} staðir` : ""}</span>
        </div>
        <table>
          <thead>
            <tr>
              <th>Staður</th>
              <th>Svæði</th>
              <th>Stöðvar</th>
              <th>Lausar</th>
              <th>Verð (leiðb.)</th>
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
                  Engir aðgangar enn. Leystu inn boð frá hýsli.
                </td>
              </tr>
            )}
            {rows?.map((i) => (
              <tr key={i.id}>
                <td>
                  <strong>{i.displayName}</strong>
                </td>
                <td className="sub">
                  {i.siteDisplayName}
                  {i.siteAddress ? ` · ${i.siteAddress}` : ""}
                </td>
                <td>{i.chargerCount}</td>
                <td>
                  <span
                    className={
                      "badge2 " +
                      (i.availableConnectorCount > 0 ? "s-ok" : "s-mut")
                    }
                  >
                    <span
                      className={
                        "dot " +
                        (i.availableConnectorCount > 0 ? "bg-ok" : "bg-mut")
                      }
                    />
                    {i.availableConnectorCount}
                  </span>
                </td>
                <td className="sub">
                  {i.pricingSummary?.perKwhMinor
                    ? `${(Number(i.pricingSummary.perKwhMinor) / 100).toLocaleString("is-IS", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kr/kWh${i.pricingSummary.vatInclusive ? "" : " + VSK"}`
                    : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
