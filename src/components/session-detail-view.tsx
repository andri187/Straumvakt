"use client";

// Shared read-only "charging session detail" view, rendered by both the
// host portal (/host/sessions/[id]) and the driver portal
// (/driver/history/[id]). Both portals render inside .host-root, so this
// component uses the scoped host.css classes (card / card-h / kv / sub /
// mono / badge2 / grid). It mirrors the rich apps/api SessionFullDetail
// shape but deliberately omits operator-only / heavy data (samples[],
// intervals[], rawCompletedSession) — those are never surfaced here.

import type { ReactNode } from "react";

// TS shape matching only the fields we render from SessionFullDetail.
// Every field is optional / nullable — the view stays robust to nulls.
export type SessionDetail = {
  sessionId: string;
  orgId?: string | null;
  orgDisplayName?: string | null;
  siteId?: string | null;
  siteDisplayName?: string | null;
  installationId?: string | null;
  installationDisplayName?: string | null;
  chargingStationId?: string | null;
  chargerDisplayName?: string | null;
  chargerSerial?: string | null;
  chargerVendor?: string | null;
  chargerModel?: string | null;
  chargerFirmware?: string | null;

  driverIdTag?: string | null;
  driverUserId?: string | null;
  driverDisplayName?: string | null;
  driverEmail?: string | null;

  startedAt?: string | null;
  endedAt?: string | null;
  durationSec?: number | null;
  chargeTimeSec?: number | null;
  idleTimeSec?: number | null;

  status?: string | null;

  energyKwh?: string | null;
  totalEnergyWh?: string | null;
  costExVatMinor?: string | null;
  costIncVatMinor?: string | null;
  stopReason?: string | null;

  identity?: {
    type?: string | null;
    typeLabel?: string | null;
    value?: string | null;
    level?: string | null;
  } | null;

  vehicleIdentity?: {
    confidenceTier?: string | null;
    link?: {
      plcMac?: string | null;
      plcMacOuiVendor?: string | null;
    } | null;
    protocol?: {
      pncSucceeded?: boolean | null;
    } | null;
  } | null;

  ocmf?: {
    firstReadingKwh?: string | null;
    lastReadingKwh?: string | null;
    signedSessionKwh?: string | null;
    provenance?: "live" | "backfilled" | null;
  } | null;
};

// aurar (1/100 króna) → "1.234,56 kr." (is-IS). Input is string-or-null.
function kr(minor: string | null | undefined): string | null {
  if (minor === null || minor === undefined || minor === "") return null;
  const n = Number(minor);
  if (!Number.isFinite(n)) return null;
  return (
    (n / 100).toLocaleString("is-IS", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }) + " kr."
  );
}

// ISO → "2026-06-07 13:45"
function ts(s: string | null | undefined): string | null {
  if (!s) return null;
  return s.slice(0, 16).replace("T", " ");
}

// seconds → "1 klst 23 mín 4 sek" (drops zero leading units)
function dur(sec: number | null | undefined): string | null {
  if (sec === null || sec === undefined || sec < 0) return null;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const parts: string[] = [];
  if (h) parts.push(`${h} klst`);
  if (m) parts.push(`${m} mín`);
  if (s || parts.length === 0) parts.push(`${s} sek`);
  return parts.join(" ");
}

function statusBadge(status: string | null | undefined): {
  cls: string;
  dot: string;
  label: string;
} {
  switch (status) {
    case "in_progress":
    case "active":
      return { cls: "s-live", dot: "bg-live", label: "Í hleðslu" };
    case "completed":
      return { cls: "s-ok", dot: "bg-ok", label: "Lokið" };
    case "faulted":
      return { cls: "s-bad", dot: "bg-bad", label: "Bilun" };
    case "aborted":
      return { cls: "s-bad", dot: "bg-bad", label: "Hætt við" };
    default:
      return { cls: "s-mut", dot: "bg-mut", label: status ?? "Óþekkt" };
  }
}

// A kv row that renders nothing when its value is null/empty — keeps the
// cards free of blank junk.
function Row({ k, v }: { k: string; v: ReactNode | null | undefined }) {
  if (v === null || v === undefined || v === "") return null;
  return (
    <div className="kv">
      <span className="k">{k}</span>
      <span className="v">{v}</span>
    </div>
  );
}

export function SessionDetailView({ detail }: { detail: SessionDetail }) {
  const b = statusBadge(detail.status);

  const id = detail.identity;
  const hasIdentity =
    !!detail.driverIdTag ||
    !!detail.driverDisplayName ||
    !!detail.driverEmail ||
    !!(id && (id.value || id.typeLabel));

  const ocmf = detail.ocmf;

  const v = detail.vehicleIdentity;
  const hasVehicle =
    !!v &&
    ((v.confidenceTier && v.confidenceTier !== "none") ||
      !!v.link?.plcMac ||
      !!v.link?.plcMacOuiVendor ||
      v.protocol?.pncSucceeded != null);

  const energyKwhRow =
    detail.energyKwh != null && detail.energyKwh !== ""
      ? `${detail.energyKwh} kWh`
      : null;
  const totalWhRow =
    detail.totalEnergyWh != null && detail.totalEnergyWh !== ""
      ? `${detail.totalEnergyWh} Wh`
      : null;

  return (
    <>
      {/* ── Yfirlit ── */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-h">
          Yfirlit
          <span className={"badge2 " + b.cls}>
            <span className={"dot " + b.dot} />
            {b.label}
          </span>
        </div>
        <div style={{ padding: "4px 18px 14px" }}>
          <Row k="Stöð" v={detail.chargerDisplayName} />
          <Row k="Raðnúmer" v={detail.chargerSerial} />
          <Row k="Framleiðandi" v={detail.chargerVendor} />
          <Row k="Gerð" v={detail.chargerModel} />
          <Row k="Hugbúnaður" v={detail.chargerFirmware} />
          <Row k="Svæði" v={detail.siteDisplayName} />
          <Row k="Uppsetning" v={detail.installationDisplayName} />
          <Row k="Hófst" v={ts(detail.startedAt)} />
          <Row k="Lauk" v={ts(detail.endedAt)} />
          <Row k="Lengd" v={dur(detail.durationSec)} />
          <Row k="Hleðslutími" v={dur(detail.chargeTimeSec)} />
          <Row k="Biðtími" v={dur(detail.idleTimeSec)} />
        </div>
      </div>

      <div className="grid g2">
        {/* ── Orka & kostnaður ── */}
        <div className="card" style={{ alignSelf: "start" }}>
          <div className="card-h">Orka &amp; kostnaður</div>
          <div style={{ padding: "4px 18px 14px" }}>
            <Row k="Orka" v={energyKwhRow} />
            <Row k="Heildarorka" v={totalWhRow} />
            <Row k="Kostnaður án vsk" v={kr(detail.costExVatMinor)} />
            <Row k="Kostnaður m. vsk" v={kr(detail.costIncVatMinor)} />
            <Row k="Stöðvunarástæða" v={detail.stopReason} />
          </div>
        </div>

        {/* ── Auðkenning ── */}
        {hasIdentity && (
          <div className="card" style={{ alignSelf: "start" }}>
            <div className="card-h">Auðkenning</div>
            <div style={{ padding: "4px 18px 14px" }}>
              <Row
                k="Auðkenni (idTag)"
                v={
                  detail.driverIdTag ? (
                    <span className="mono">{detail.driverIdTag}</span>
                  ) : null
                }
              />
              <Row k="Ökumaður" v={detail.driverDisplayName} />
              <Row k="Netfang" v={detail.driverEmail} />
              <Row k="OCMF tegund" v={id?.typeLabel} />
              <Row
                k="OCMF gildi"
                v={id?.value ? <span className="mono">{id.value}</span> : null}
              />
              <Row k="OCMF vissustig" v={id?.level} />
            </div>
          </div>
        )}
      </div>

      {/* ── Undirritaður mælir (OCMF) ── */}
      {ocmf && (
        <div className="card" style={{ marginTop: 16, alignSelf: "start" }}>
          <div className="card-h">
            Undirritaður mælir
            {ocmf.provenance && (
              <span className="sub">
                {ocmf.provenance === "live" ? "rauntími" : "eftirá"}
              </span>
            )}
          </div>
          <div style={{ padding: "4px 18px 14px" }}>
            <Row
              k="Fyrsta mæling"
              v={
                ocmf.firstReadingKwh != null && ocmf.firstReadingKwh !== ""
                  ? `${ocmf.firstReadingKwh} kWh`
                  : null
              }
            />
            <Row
              k="Síðasta mæling"
              v={
                ocmf.lastReadingKwh != null && ocmf.lastReadingKwh !== ""
                  ? `${ocmf.lastReadingKwh} kWh`
                  : null
              }
            />
            <Row
              k="Undirrituð lota"
              v={
                ocmf.signedSessionKwh != null && ocmf.signedSessionKwh !== ""
                  ? `${ocmf.signedSessionKwh} kWh`
                  : null
              }
            />
            {ocmf.signedSessionKwh != null && ocmf.signedSessionKwh !== "" && (
              <div className="sub" style={{ paddingTop: 8 }}>
                Lotan ber undirritaðan mæli frá hleðslustöðinni.
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Ökutækjaauðkenni (Autocharge) ── */}
      {hasVehicle && v && (
        <div className="card" style={{ marginTop: 16, alignSelf: "start" }}>
          <div className="card-h">Ökutækjaauðkenni</div>
          <div style={{ padding: "4px 18px 14px" }}>
            <Row
              k="Vissustig"
              v={
                v.confidenceTier && v.confidenceTier !== "none"
                  ? v.confidenceTier
                  : null
              }
            />
            <Row
              k="PLC MAC"
              v={
                v.link?.plcMac ? (
                  <span className="mono">{v.link.plcMac}</span>
                ) : null
              }
            />
            <Row k="Framleiðandi (OUI)" v={v.link?.plcMacOuiVendor} />
            <Row
              k="Plug & Charge"
              v={
                v.protocol?.pncSucceeded == null
                  ? null
                  : v.protocol.pncSucceeded
                    ? "Tókst"
                    : "Mistókst"
              }
            />
          </div>
        </div>
      )}
    </>
  );
}
