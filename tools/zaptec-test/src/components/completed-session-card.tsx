import { History } from "lucide-react";
import type { StateObservation } from "@/lib/zaptec";
import { StateId } from "@/lib/zaptec-state";

type OcmfRead = {
  TM?: string; // timestamp
  TX?: string; // B=begin, T=tick, E=end
  RV?: string; // reading value
  RU?: string; // unit
};

type CompletedSession = {
  SessionId?: string;
  Energy?: string;
  StartDateTime?: string;
  EndDateTime?: string;
  ReliableClock?: boolean;
  StoppedByRFID?: boolean;
  AuthenticationCode?: string | null;
  SignedSession?: string;
};

function parseOcmf(signed: string | undefined): OcmfRead[] {
  if (!signed) return [];
  // OCMF format: "OCMF|<json>|<sig?>" — JSON blob with RD array
  const pipe = signed.indexOf("|");
  if (pipe < 0) return [];
  const payload = signed.slice(pipe + 1);
  const endPipe = payload.lastIndexOf("|");
  const json = endPipe > 0 ? payload.slice(0, endPipe) : payload;
  try {
    const parsed = JSON.parse(json) as { RD?: OcmfRead[] };
    return parsed.RD ?? [];
  } catch {
    return [];
  }
}

function fmtDuration(startIso: string, endIso: string): string {
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h}h ${m}m`;
}

export function CompletedSessionCard({ state }: { state: StateObservation[] }) {
  const raw = state.find((s) => s.StateId === StateId.CompletedSession)?.ValueAsString;
  if (!raw) return null;

  let parsed: CompletedSession;
  try {
    parsed = JSON.parse(raw) as CompletedSession;
  } catch {
    return null;
  }

  const reads = parseOcmf(parsed.SignedSession);
  const kwh = parsed.Energy ? Number(parsed.Energy) : null;
  const duration =
    parsed.StartDateTime && parsed.EndDateTime
      ? fmtDuration(parsed.StartDateTime, parsed.EndDateTime)
      : "—";

  // For sparkline-like visualization, extract the cumulative meter curve
  const meterReads = reads
    .filter((r) => r.RV && r.TM)
    .map((r) => ({
      t: new Date(r.TM!.replace(",", ".")).getTime(),
      v: Number(r.RV),
    }))
    .filter((r) => Number.isFinite(r.t) && Number.isFinite(r.v));

  let mini: string | null = null;
  if (meterReads.length > 1) {
    const min = Math.min(...meterReads.map((r) => r.v));
    const max = Math.max(...meterReads.map((r) => r.v));
    const range = max - min || 1;
    const W = 220;
    const H = 40;
    mini = meterReads
      .map((r, i) => {
        const x = (i / (meterReads.length - 1)) * W;
        const y = H - ((r.v - min) / range) * H;
        return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  }

  return (
    <section className="rounded-lg border border-bg-border bg-bg-surface/70 p-5 shadow-card backdrop-blur">
      <header className="mb-4 flex items-center gap-2">
        <History className="h-4 w-4 text-sv-sky" />
        <h3 className="text-sm font-semibold text-ink-50">Last completed session</h3>
        <span className="ml-auto text-[10px] uppercase tracking-brand text-ink-500">
          from StateId 723 · OCMF signed
        </span>
      </header>

      <div className="grid gap-5 sm:grid-cols-[auto_1fr] sm:items-center">
        <div className="grid grid-cols-3 gap-6 sm:grid-cols-1 sm:gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-brand text-ink-500">Energy</p>
            <p className="text-2xl font-semibold text-sv-green tabular-nums">
              {kwh != null ? kwh.toFixed(3) : "—"}
              <span className="ml-1 text-xs font-normal text-ink-400">kWh</span>
            </p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-brand text-ink-500">Duration</p>
            <p className="text-sm font-semibold text-ink-100">{duration}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-brand text-ink-500">Meter readings</p>
            <p className="text-sm font-semibold text-ink-100">{meterReads.length}</p>
          </div>
        </div>

        <div className="min-w-0">
          {mini ? (
            <svg viewBox="0 0 220 40" className="w-full overflow-visible" height={40}>
              <path d={mini} fill="none" stroke="#3EE9A7" strokeWidth={1.5} />
            </svg>
          ) : null}
          <div className="mt-2 flex items-center justify-between gap-4 text-[10px] text-ink-500">
            <span>
              Start{" "}
              {parsed.StartDateTime
                ? new Date(parsed.StartDateTime).toLocaleString(undefined, {
                    hour: "2-digit",
                    minute: "2-digit",
                    day: "2-digit",
                    month: "short",
                  })
                : "—"}
            </span>
            <span>
              End{" "}
              {parsed.EndDateTime
                ? new Date(parsed.EndDateTime).toLocaleString(undefined, {
                    hour: "2-digit",
                    minute: "2-digit",
                    day: "2-digit",
                    month: "short",
                  })
                : "—"}
            </span>
          </div>
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1 border-t border-bg-border pt-3 text-[11px] sm:grid-cols-4">
        <DlRow
          label="Session Id"
          value={parsed.SessionId?.slice(0, 8) ?? "—"}
          mono
        />
        <DlRow
          label="Reliable clock"
          value={parsed.ReliableClock ? "yes" : "no"}
        />
        <DlRow
          label="Stopped by RFID"
          value={parsed.StoppedByRFID ? "yes" : "no"}
        />
        <DlRow
          label="Auth code"
          value={parsed.AuthenticationCode ?? "—"}
          mono
        />
      </dl>
    </section>
  );
}

function DlRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-ink-500">{label}</dt>
      <dd className={mono ? "font-mono text-ink-200" : "text-ink-200"}>{value}</dd>
    </div>
  );
}
