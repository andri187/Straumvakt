"use client";

// Host agreements (Samningar) — agreements.agreements the org is party to,
// via /api/admin/orgs/:id/agreements. Concept look. Cost factors are set at
// agreement creation by Straumvakt (read-only here).

import { useEffect, useState } from "react";
import { apiFetchJson } from "@/lib/api-client";
import { useHostOrg } from "../host-shell";

type Agreement = {
  id: string;
  displayName: string;
  agreementType: string;
  status: string;
  installationDisplayName: string | null;
  effectiveFrom: string;
  effectiveUntil: string | null;
};

const TYPE_LABEL: Record<string, string> = {
  service_cpo: "Þjónustusamningur (CPO)",
  installation: "Uppsetningarsamningur",
  public_roaming: "Reikisamningur",
};

function statusCls(s: string): string {
  return s === "active" ? "s-ok" : s === "draft" ? "s-warn" : "s-mut";
}
function statusDot(s: string): string {
  return s === "active" ? "bg-ok" : s === "draft" ? "bg-warn" : "bg-mut";
}
function statusLabel(s: string): string {
  return s === "active" ? "Virkur" : s === "expired" ? "Útrunninn" : s === "draft" ? "Drög" : s;
}

export default function HostAgreements() {
  const org = useHostOrg();
  const [rows, setRows] = useState<Agreement[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!org) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await apiFetchJson<{ agreements: Agreement[] }>(
          `/api/admin/orgs/${org.orgId}/agreements`,
        );
        if (!cancelled) setRows(r.agreements);
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
          <h1>Samningar</h1>
          <p>Samningar þínir við Straumvakt. Kostnaðarþættir eru ákveðnir við stofnun og gilda áfram.</p>
        </div>
      </div>

      {err && (
        <div className="card" style={{ padding: "14px 18px", marginBottom: 16, borderColor: "rgba(255,107,107,.4)", color: "var(--red)" }}>
          {err}
        </div>
      )}

      <div className="card">
        <div className="card-h">
          Samningar <span className="sub">{rows ? `${rows.length}` : ""}</span>
        </div>
        <table>
          <thead>
            <tr>
              <th>Samningur</th>
              <th>Tegund</th>
              <th>Uppsetning</th>
              <th>Gildir frá</th>
              <th>Staða</th>
            </tr>
          </thead>
          <tbody>
            {rows === null && <tr><td colSpan={5} className="empty">Hleð…</td></tr>}
            {rows?.length === 0 && (
              <tr><td colSpan={5} className="empty">Engir samningar.</td></tr>
            )}
            {rows?.map((a) => (
              <tr key={a.id}>
                <td><strong>{a.displayName}</strong></td>
                <td className="sub">{TYPE_LABEL[a.agreementType] ?? a.agreementType}</td>
                <td className="sub">{a.installationDisplayName ?? "—"}</td>
                <td className="sub">{a.effectiveFrom.slice(0, 10)}</td>
                <td>
                  <span className={"badge2 " + statusCls(a.status)}>
                    <span className={"dot " + statusDot(a.status)} />
                    {statusLabel(a.status)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
