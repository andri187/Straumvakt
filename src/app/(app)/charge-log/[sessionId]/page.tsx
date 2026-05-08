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
  status: string | null;
  energyKwh: string;
  totalEnergyWh: string | null;
  costIskMinor: string | null;
  costFormatted: string | null;
  costExVatMinor: string | null;
  costIncVatMinor: string | null;
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
    provenance: "live" | "backfilled" | null;
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

  const placeholder = "—";
  const formatMinorIsk = (m: string | null) =>
    m === null ? placeholder : `${(Number(m) / 100).toLocaleString("is-IS", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kr`;

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <Link href="/charge-log" className="mb-4 inline-block text-xs text-ink-400 hover:text-sv-sky">
        ← Back to charge log
      </Link>

      {/* HEADER */}
      <header className="mb-6 border-b border-bg-border pb-4">
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <span className="text-xs uppercase tracking-wide text-ink-500">Charging session</span>
          {session.status && <StatusPill status={session.status} />}
        </div>
        <h1 className="text-2xl font-semibold text-ink-50">
          {session.energyKwh} kWh · {formatDuration(session.durationSec)}
          {session.costFormatted ? <span className="ml-2 text-ink-300">· {session.costFormatted}</span> : null}
        </h1>
        <p className="mt-1 text-sm text-ink-400">
          <span className="text-ink-200">{driverLine}</span>
          {" · "}
          {session.chargerDisplayName ?? placeholder}
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

      {/* COST */}
      <section className="mb-6 rounded-lg border border-bg-border bg-bg-base/30 p-5">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-400">Cost</h2>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 md:grid-cols-3">
          <Stat label="Ex-VAT" value={formatMinorIsk(session.costExVatMinor)} />
          <Stat label="Inc-VAT" value={formatMinorIsk(session.costIncVatMinor)} />
          <Stat label="Stop reason" value={session.stopReason ?? placeholder} />
        </dl>
      </section>

      {/* TIMING */}
      <section className="mb-6 rounded-lg border border-bg-border bg-bg-base/30 p-5">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-400">Timing</h2>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 md:grid-cols-4">
          <Stat label="Started" value={formatDateTime(session.startedAt)} />
          <Stat label="Ended" value={formatDateTime(session.endedAt)} />
          <Stat label="Plug duration" value={formatDuration(session.durationSec)} />
          <Stat
            label="Charging"
            value={formatDuration(session.chargeTimeSec)}
            accent={session.chargeTimeSec !== null ? "emerald" : undefined}
          />
          <Stat
            label="Idle"
            value={formatDuration(session.idleTimeSec)}
            accent={session.idleTimeSec !== null ? "amber" : undefined}
          />
        </dl>
        {session.chargeTimeSec !== null && session.idleTimeSec !== null ? (
          <div className="mt-4">
            <TimingBar chargeSec={session.chargeTimeSec} idleSec={session.idleTimeSec} />
          </div>
        ) : (
          <p className="mt-3 text-xs italic text-ink-500">
            Charge / idle split not derived — needs per-interval data from OCMF or AMQP.
          </p>
        )}
      </section>

      {/* IDENTITY */}
      <section className="mb-6 rounded-lg border border-bg-border bg-bg-base/30 p-5">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-400">
          Identification
        </h2>
        {session.identity ? (
          <>
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
            <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2 text-sm md:grid-cols-2">
              <KV label="Type" value={session.identity.type ?? placeholder} />
              <KV label="Level (confidence)" value={session.identity.level ?? placeholder} />
              <KV label="Identifier" value={session.identity.value ?? placeholder} />
              <KV
                label="Identified flag"
                value={
                  session.identity.status === null
                    ? placeholder
                    : session.identity.status
                      ? "true"
                      : "false"
                }
              />
            </dl>
            {session.identity.type === "EVCCID" && (
              <p className="mt-3 text-xs text-purple-300">
                This is the vehicle&apos;s PLC MAC address from an ISO 15118 Plug &amp; Charge handshake.
              </p>
            )}
            {session.identity.type === "EMAID" && (
              <p className="mt-3 text-xs text-emerald-300">
                This is the contract certificate identifier from an ISO 15118 Plug &amp; Charge session.
              </p>
            )}
            {session.identity.flags.length > 0 ? (
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
            ) : (
              <div className="mt-3 text-xs text-ink-500">Flags: {placeholder}</div>
            )}
          </>
        ) : (
          <p className="text-xs italic text-ink-500">
            No OCMF identity captured. Slot reserved for ISO 14443 RFID UID, ISO 15118 vehicle MAC (EVCCID),
            or PnC contract (EMAID) — populated when Zaptec firmware ships ISO 15118 PnC support.
          </p>
        )}
        <div className="mt-3 text-xs text-ink-500">
          Legacy <span className="font-mono text-ink-300">idTag</span> on session row:{" "}
          <span className="font-mono">{session.driverIdTag ?? placeholder}</span>
        </div>
      </section>

      {/* POWER OVER TIME (OCMF intervals) */}
      <section className="mb-6 rounded-lg border border-bg-border bg-bg-base/30 p-5">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-400">
          Power timeline
          <span className="ml-2 text-[10px] font-normal text-ink-500">
            source: {session.timeSeriesSource ?? placeholder}
          </span>
        </h2>
        {session.intervals.length > 0 ? (
          <ChargeChart intervals={session.intervals} source={session.timeSeriesSource} />
        ) : (
          <p className="text-xs italic text-ink-500">
            No interval data — needs OCMF readings or EnergyDetails on the imported CDR.
          </p>
        )}
      </section>

      {/* AMQP TELEMETRY SAMPLES */}
      <section className="mb-6 rounded-lg border border-bg-border bg-bg-base/30 p-5">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-400">
          Live telemetry samples
          <span className="ml-2 text-[10px] font-normal text-ink-500">
            {session.samples.length} samples · AMQP path
          </span>
        </h2>
        {session.samples.length > 0 ? (
          <SamplePowerChart samples={session.samples} />
        ) : (
          <p className="text-xs italic text-ink-500">
            0 samples — AMQP feed silent during this window. Source is{" "}
            <span className="font-mono">charging.live_session_samples</span>, populated by AMQP
            StateId 513/553/501-509 via the Fly consumer.
          </p>
        )}
      </section>

      {/* OCMF RECEIPT */}
      <section className="mb-6 rounded-lg border border-bg-border bg-bg-base/30 p-5">
        <h2 className="mb-3 flex flex-wrap items-center gap-2 text-sm font-semibold uppercase tracking-wide text-ink-400">
          <span>OCMF signed-meter receipt</span>
          {session.ocmf?.provenance && (
            <span
              className={
                "rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-brand ring-1 ring-inset " +
                (session.ocmf.provenance === "live"
                  ? "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30"
                  : "bg-amber-500/15 text-amber-300 ring-amber-500/30")
              }
              title={
                session.ocmf.provenance === "live"
                  ? "Captured live via AMQP StateId 723 (CompletedSession)"
                  : "Backfilled after the fact from /chargehistory raw_payload — synthetic capturedAt"
              }
            >
              {session.ocmf.provenance}
            </span>
          )}
        </h2>
        {session.ocmf ? (
          <>
            <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm md:grid-cols-2">
              <KV label="Format version" value={session.ocmf.formatVersion ?? placeholder} />
              <KV label="Captured" value={formatDateTime(session.ocmf.capturedAt)} />
              <KV label="Gateway id" value={session.ocmf.gatewayId ?? placeholder} />
              <KV label="Gateway serial" value={session.ocmf.gatewaySerial ?? placeholder} />
              <KV label="Gateway firmware" value={session.ocmf.gatewayVersion ?? placeholder} />
              <KV
                label="Signed kWh"
                value={
                  session.ocmf.signedSessionKwh
                    ? `${session.ocmf.signedSessionKwh} kWh`
                    : placeholder
                }
              />
              <KV
                label="First reading"
                value={
                  session.ocmf.firstReadingKwh
                    ? `${session.ocmf.firstReadingKwh} kWh`
                    : placeholder
                }
              />
              <KV
                label="Last reading"
                value={
                  session.ocmf.lastReadingKwh
                    ? `${session.ocmf.lastReadingKwh} kWh`
                    : placeholder
                }
              />
            </dl>
            {!includeRaw ? (
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
          </>
        ) : (
          <p className="text-xs italic text-ink-500">
            No OCMF data on this session. Backfill captured 110 historical sessions on
            2026-05-08; rows imported afterward only get OCMF if AMQP StateId 723
            (CompletedSession) fires for them.
          </p>
        )}
      </section>

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

function StatusPill({ status }: { status: string }) {
  const tone =
    status === "completed"
      ? "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30"
      : status === "active"
        ? "bg-sv-sky/15 text-sv-sky ring-sv-sky/30"
        : status === "aborted" || status === "failed"
          ? "bg-rose-500/15 text-rose-300 ring-rose-500/30"
          : "bg-ink-500/15 text-ink-300 ring-bg-border";
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-brand ring-1 ring-inset ${tone}`}
    >
      {status}
    </span>
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
