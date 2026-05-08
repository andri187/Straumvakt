// Sprint 9 / 2026-05-08 — standalone session detail page.
// Renders the full enriched session record human-readably. Source is
// /api/admin/billing/sessions/:id/full which returns:
//   - session header (charger / installation / driver / timing / energy / cost)
//   - OCMF identity (RFID UID today, EVCCID vehicle MAC / EMAID once
//     Zaptec ships PnC firmware — same column, different content)
//   - OCMF receipt block (gateway, format version, signed-session kWh)
//   - AMQP-derived telemetry samples (live_session_samples)
//   - Power-time intervals from OCMF or EnergyDetails
//   - Raw 723 JSON + raw OCMF envelope (collapsed accordion)

import Link from "next/link";
import { notFound } from "next/navigation";
import { apiFetchServer } from "@/lib/api-client-server";
import { ChargeChart, type PowerInterval } from "../charge-chart";
import { SamplePowerChart } from "./sample-power-chart";
import { RawBlobAccordion } from "./raw-blob-accordion";

export const dynamic = "force-dynamic";

interface SessionTelemetrySample {
  observedAt: string;
  powerW: number | null;
  energyWh: number | null;
  stateId: number;
}

interface SessionFullDetail {
  sessionId: string;
  orgId: string;
  orgDisplayName: string | null;
  siteId: string | null;
  siteDisplayName: string | null;
  installationId: string | null;
  installationDisplayName: string | null;
  chargingStationId: string | null;
  chargerDisplayName: string | null;
  chargerSerial: string | null;
  chargerVendor: string | null;
  chargerModel: string | null;
  chargerFirmware: string | null;
  driverIdTag: string | null;
  driverUserId: string | null;
  driverDisplayName: string | null;
  driverEmail: string | null;
  startedAt: string;
  endedAt: string | null;
  durationSec: number | null;
  chargeTimeSec: number | null;
  idleTimeSec: number | null;
  energyKwh: string;
  totalEnergyWh: string | null;
  costIskMinor: string | null;
  costFormatted: string | null;
  stopReason: string | null;
  identity: {
    type: string | null;
    typeLabel: string;
    value: string | null;
    level: string | null;
    flags: string[];
    status: boolean | null;
  } | null;
  ocmf: {
    formatVersion: string | null;
    gatewayId: string | null;
    gatewaySerial: string | null;
    gatewayVersion: string | null;
    firstReadingKwh: string | null;
    lastReadingKwh: string | null;
    signedSessionKwh: string | null;
    signedSessionRaw: string | null;
    capturedAt: string | null;
  } | null;
  timeSeriesSource: "ocmf" | "energyDetails" | null;
  intervals: PowerInterval[];
  samples: SessionTelemetrySample[];
  rawCompletedSession: object | null;
}

function formatDuration(sec: number | null): string {
  if (sec === null) return "—";
  if (sec === 0) return "0s";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("is-IS", {
    dateStyle: "short",
    timeStyle: "medium",
  });
}

function identityBadgeColor(type: string | null): string {
  if (!type) return "bg-bg-raised/60 text-ink-300 ring-bg-border";
  if (type === "EVCCID") return "bg-purple-400/15 text-purple-300 ring-purple-400/30";
  if (type === "EMAID") return "bg-emerald-400/15 text-emerald-300 ring-emerald-400/30";
  if (type === "ISO14443" || type === "ISO15693") return "bg-sv-sky/15 text-sv-sky ring-sv-sky/30";
  if (type === "PHONE_NUMBER") return "bg-amber-400/15 text-amber-300 ring-amber-400/30";
  if (type === "DENIED" || type === "NONE") return "bg-rose-400/15 text-rose-300 ring-rose-400/30";
  return "bg-bg-raised/60 text-ink-300 ring-bg-border";
}

function levelBadgeColor(level: string | null): string {
  if (!level) return "bg-bg-raised/60 text-ink-300 ring-bg-border";
  if (level === "SECURE" || level === "CERTIFIED") return "bg-emerald-400/15 text-emerald-300 ring-emerald-400/30";
  if (level === "VERIFIED" || level === "TRUSTED") return "bg-sv-sky/15 text-sv-sky ring-sv-sky/30";
  if (level === "HEARSAY") return "bg-amber-400/15 text-amber-300 ring-amber-400/30";
  if (level === "INVALID" || level === "MISMATCH" || level === "OUTDATED")
    return "bg-rose-400/15 text-rose-300 ring-rose-400/30";
  return "bg-bg-raised/60 text-ink-300 ring-bg-border";
}

export default async function SessionDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ sessionId: string }>;
  searchParams: Promise<{ include?: string }>;
}) {
  const { sessionId } = await params;
  const { include } = await searchParams;
  const includeRaw = include === "raw";

  const url = `/api/admin/billing/sessions/${sessionId}/full${includeRaw ? "?include=raw" : ""}`;
  const res = await apiFetchServer(url);
  if (res.status === 404) notFound();
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const { session } = (await res.json()) as { session: SessionFullDetail };

  const driverLine =
    session.driverDisplayName ??
    session.driverEmail ??
    session.driverIdTag ??
    "Unknown driver";

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <Link href="/charge-log" className="mb-4 inline-block text-xs text-ink-400 hover:text-sv-sky">
        ← Back to charge log
      </Link>

      {/* HEADER */}
      <header className="mb-6 border-b border-bg-border pb-4">
        <div className="mb-1 text-xs uppercase tracking-wide text-ink-500">Charging session</div>
        <h1 className="text-2xl font-semibold text-ink-50">
          {session.energyKwh} kWh · {formatDuration(session.durationSec)}
          {session.costFormatted ? <span className="ml-2 text-ink-300">· {session.costFormatted}</span> : null}
        </h1>
        <p className="mt-1 text-sm text-ink-400">
          <span className="text-ink-200">{driverLine}</span>
          {" · "}
          {session.chargerDisplayName ?? "—"}
          {session.installationDisplayName && <> · {session.installationDisplayName}</>}
          {session.siteDisplayName && <> · {session.siteDisplayName}</>}
          {session.orgDisplayName && (
            <>
              {" · "}
              <span className="text-ink-300">{session.orgDisplayName}</span>
            </>
          )}
        </p>
        <div className="mt-2 font-mono text-[10px] text-ink-500">
          session {session.sessionId}
        </div>
      </header>

      {/* TIMING */}
      <section className="mb-6 rounded-lg border border-bg-border bg-bg-base/30 p-5">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-400">Timing</h2>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 md:grid-cols-4">
          <Stat label="Started" value={formatDateTime(session.startedAt)} />
          <Stat label="Ended" value={formatDateTime(session.endedAt)} />
          <Stat label="Plug duration" value={formatDuration(session.durationSec)} />
          {session.chargeTimeSec !== null && (
            <Stat
              label="Charging"
              value={formatDuration(session.chargeTimeSec)}
              accent="emerald"
            />
          )}
          {session.idleTimeSec !== null && (
            <Stat
              label="Idle"
              value={formatDuration(session.idleTimeSec)}
              accent="amber"
            />
          )}
          {session.stopReason && <Stat label="Stop reason" value={session.stopReason} />}
        </dl>
        {session.chargeTimeSec !== null && session.idleTimeSec !== null && (
          <div className="mt-4">
            <TimingBar chargeSec={session.chargeTimeSec} idleSec={session.idleTimeSec} />
          </div>
        )}
      </section>

      {/* IDENTITY */}
      {session.identity ? (
        <section className="mb-6 rounded-lg border border-bg-border bg-bg-base/30 p-5">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-400">
            Identification
          </h2>
          <div className="flex flex-wrap items-center gap-3">
            <span
              className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ring-1 ring-inset ${identityBadgeColor(session.identity.type)}`}
            >
              {session.identity.type ?? "UNKNOWN"} — {session.identity.typeLabel}
            </span>
            {session.identity.level && (
              <span
                className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${levelBadgeColor(session.identity.level)}`}
              >
                {session.identity.level}
              </span>
            )}
            {session.identity.status === true && (
              <span className="text-xs text-emerald-300">✓ identified</span>
            )}
            {session.identity.status === false && (
              <span className="text-xs text-rose-300">✗ not identified</span>
            )}
          </div>
          {session.identity.value && (
            <div className="mt-3">
              <div className="mb-1 text-xs uppercase tracking-wide text-ink-500">Identifier</div>
              <code className="block break-all rounded bg-bg-base/50 px-3 py-2 font-mono text-sm text-ink-100">
                {session.identity.value}
              </code>
              {session.identity.type === "EVCCID" && (
                <p className="mt-2 text-xs text-purple-300">
                  This is the vehicle&apos;s PLC MAC address from an ISO 15118 Plug &amp; Charge
                  handshake.
                </p>
              )}
              {session.identity.type === "EMAID" && (
                <p className="mt-2 text-xs text-emerald-300">
                  This is the contract certificate identifier from an ISO 15118 Plug &amp; Charge
                  session.
                </p>
              )}
            </div>
          )}
          {session.identity.flags.length > 0 && (
            <div className="mt-3">
              <div className="mb-1 text-xs uppercase tracking-wide text-ink-500">Flags</div>
              <div className="flex flex-wrap gap-1">
                {session.identity.flags.map((f) => (
                  <span
                    key={f}
                    className="inline-flex rounded bg-bg-raised/60 px-1.5 py-0.5 font-mono text-[10px] text-ink-300"
                  >
                    {f}
                  </span>
                ))}
              </div>
            </div>
          )}
          {session.driverIdTag && session.identity.value !== session.driverIdTag && (
            <div className="mt-3 text-xs text-ink-500">
              Legacy <span className="text-ink-300 font-mono">idTag</span>: <span className="font-mono">{session.driverIdTag}</span>
            </div>
          )}
        </section>
      ) : null}

      {/* POWER OVER TIME (OCMF intervals) */}
      {session.intervals.length > 0 ? (
        <section className="mb-6 rounded-lg border border-bg-border bg-bg-base/30 p-5">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-400">
            Power timeline
            <span className="ml-2 text-[10px] font-normal text-ink-500">
              source: {session.timeSeriesSource}
            </span>
          </h2>
          <ChargeChart intervals={session.intervals} source={session.timeSeriesSource} />
        </section>
      ) : null}

      {/* AMQP TELEMETRY SAMPLES */}
      {session.samples.length > 0 ? (
        <section className="mb-6 rounded-lg border border-bg-border bg-bg-base/30 p-5">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-400">
            Live telemetry samples
            <span className="ml-2 text-[10px] font-normal text-ink-500">
              {session.samples.length} samples · AMQP path
            </span>
          </h2>
          <SamplePowerChart samples={session.samples} />
        </section>
      ) : null}

      {/* OCMF RECEIPT */}
      {session.ocmf ? (
        <section className="mb-6 rounded-lg border border-bg-border bg-bg-base/30 p-5">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-400">
            OCMF signed-meter receipt
          </h2>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm md:grid-cols-2">
            <KV label="Format version" value={session.ocmf.formatVersion ?? "—"} />
            <KV label="Captured" value={formatDateTime(session.ocmf.capturedAt)} />
            <KV label="Gateway id" value={session.ocmf.gatewayId ?? "—"} />
            <KV label="Gateway serial" value={session.ocmf.gatewaySerial ?? "—"} />
            <KV label="Gateway firmware" value={session.ocmf.gatewayVersion ?? "—"} />
            <KV
              label="Signed kWh"
              value={
                session.ocmf.signedSessionKwh
                  ? `${session.ocmf.signedSessionKwh} kWh`
                  : "—"
              }
            />
            {session.ocmf.firstReadingKwh && (
              <KV
                label="First reading"
                value={`${session.ocmf.firstReadingKwh} kWh`}
              />
            )}
            {session.ocmf.lastReadingKwh && (
              <KV
                label="Last reading"
                value={`${session.ocmf.lastReadingKwh} kWh`}
              />
            )}
          </dl>
          {!includeRaw && session.identity ? (
            <div className="mt-4 text-xs">
              <a
                href={`/charge-log/${session.sessionId}?include=raw`}
                className="text-sv-sky hover:underline"
              >
                Load raw OCMF envelope + completed-session JSON →
              </a>
            </div>
          ) : null}
          {includeRaw && session.ocmf.signedSessionRaw && (
            <RawBlobAccordion title="Raw OCMF envelope" content={session.ocmf.signedSessionRaw} />
          )}
        </section>
      ) : null}

      {/* CHARGER */}
      <section className="mb-6 rounded-lg border border-bg-border bg-bg-base/30 p-5">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-400">
          Charger
        </h2>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm md:grid-cols-2">
          <KV label="Display name" value={session.chargerDisplayName ?? "—"} />
          <KV label="Serial" value={session.chargerSerial ?? "—"} />
          <KV
            label="Vendor / Model"
            value={
              [session.chargerVendor, session.chargerModel].filter(Boolean).join(" ") || "—"
            }
          />
          <KV label="Firmware" value={session.chargerFirmware ?? "—"} />
          {session.installationDisplayName && (
            <KV label="Installation" value={session.installationDisplayName} />
          )}
          {session.siteDisplayName && (
            <KV label="Site" value={session.siteDisplayName} />
          )}
        </dl>
      </section>

      {/* RAW 723 BLOB (only when ?include=raw) */}
      {includeRaw && session.rawCompletedSession ? (
        <section className="mb-6">
          <RawBlobAccordion
            title="Raw 723 CompletedSession JSON"
            content={JSON.stringify(session.rawCompletedSession, null, 2)}
          />
        </section>
      ) : null}
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: "emerald" | "amber";
}) {
  const valueClass =
    accent === "emerald"
      ? "text-emerald-300"
      : accent === "amber"
        ? "text-amber-300"
        : "text-ink-50";
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-ink-500">{label}</dt>
      <dd className={`mt-0.5 font-mono text-sm font-semibold ${valueClass}`}>{value}</dd>
    </div>
  );
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-ink-500">{label}</dt>
      <dd className="mt-0.5 break-all font-mono text-ink-200">{value}</dd>
    </div>
  );
}

function TimingBar({ chargeSec, idleSec }: { chargeSec: number; idleSec: number }) {
  const total = Math.max(1, chargeSec + idleSec);
  const chargePct = (chargeSec / total) * 100;
  const idlePct = (idleSec / total) * 100;
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs text-ink-500">
        <span>charging</span>
        <span>idle</span>
      </div>
      <div className="flex h-3 overflow-hidden rounded">
        <div
          className="bg-emerald-400/70"
          style={{ width: `${chargePct}%` }}
          title={`${formatDuration(chargeSec)} charging`}
        />
        <div
          className="bg-amber-400/40"
          style={{ width: `${idlePct}%` }}
          title={`${formatDuration(idleSec)} idle`}
        />
      </div>
      <div className="mt-1 flex justify-between text-xs text-ink-400">
        <span>{formatDuration(chargeSec)}</span>
        <span>{formatDuration(idleSec)}</span>
      </div>
    </div>
  );
}
