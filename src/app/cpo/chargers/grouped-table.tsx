import { Fragment } from "react";
import Link from "next/link";
import type { Route } from "next";
import { groupChargers } from "@/lib/installations/charger-groups";
import type { ChargerListRow } from "@/lib/installations/drizzle-store";
import { LiveConnection } from "./live-status";
import "./chargers.css";

/**
 * Registered chargers grouped installation -> circuit, by stable id. Status is whatever the shared live mechanism has
 * reported for the charger, or "Unknown — not connected"; nothing here claims a live socket. Counts are of rows shown.
 */
export function GroupedChargers({ rows }: { rows: ChargerListRow[] }) {
  return (
    <div className="ws-table-wrap">
      <table className="ws-table cg-table">
        <thead>
          <tr>
            {["Charger", "OCPP identity", "Equipment", "Status"].map((c) => (
              <th key={c} scope="col">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        {groupChargers(rows).map((g) => (
          <tbody key={g.installationId}>
            <tr className="cg-inst">
              <th colSpan={4} scope="colgroup">
                <span className="cg-kind">Installation</span>
                <Link href={`/cpo/installations?id=${g.installationId}` as Route}>{g.installationName}</Link>
                <span className="cg-count">{g.count} shown</span>
              </th>
            </tr>
            {g.circuits.map((c) => (
              <Fragment key={c.circuitId ?? "none"}>
                <tr className="cg-circ">
                  <th colSpan={4} scope="colgroup">
                    <span className="cg-kind">Circuit</span>
                    {c.circuitId === null ? "Not on a circuit" : c.circuitName ?? "(unnamed)"}
                    <span className="cg-count">{c.chargers.length}</span>
                  </th>
                </tr>
                {c.chargers.map((r) => (
                  <tr key={r.deviceId} className="cg-row">
                    <td className="cg-label">{r.label || "(unnamed)"}</td>
                    <td>
                      <code className="cg-id">{r.chargePointId}</code>
                    </td>
                    <td>{[r.vendor, r.model].filter(Boolean).join(" ") || "Not recorded"}</td>
                    <td>
                      <LiveConnection deviceId={r.deviceId} />
                    </td>
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        ))}
      </table>
    </div>
  );
}
