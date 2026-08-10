import { Key, Eye, EyeOff } from "lucide-react";
import type { Charger, Installation, StateObservation } from "@/lib/zaptec";
import { StateId } from "@/lib/zaptec-state";
import { authenticationTypeLabel } from "@/lib/zaptec-enums";

export function AuthCard({
  charger,
  installation,
  state,
}: {
  charger: Charger;
  installation: Installation | null;
  state: StateObservation[];
}) {
  const sm = new Map(state.map((s) => [s.StateId, s]));
  const v = (id: number) => sm.get(id)?.ValueAsString;

  const c = charger as Charger & {
    Pin?: string;
    PropertyAuthenticationDisabled?: boolean;
    PropertyOcppDefaultIdTag?: string;
    PropertyPinOfflinePhase?: boolean;
    PropertyOfflinePhaseOverride?: number;
    AuthenticationType?: number;
    IsAuthorizationRequired?: boolean;
  };
  const inst = installation as
    | (Installation & {
        AuthenticationType?: number;
        IsRequiredAuthentication?: boolean;
        PropertyOcppDefaultIdTag?: string;
        PropertyOfflineModeAllowAnonymous?: boolean;
        PropertyIsMinimumPowerOfflineMode?: boolean;
      })
    | null;

  const authListVer = v(StateId.AuthenticationListVersion); // 751
  const enabledNfc = v(752); // EnabledNfcTechnologies
  const currentUserUuid = v(StateId.ChargerCurrentUserUuid); // 722

  const authBypassed = c.PropertyAuthenticationDisabled === true;

  return (
    <section className="rounded-lg border border-bg-border bg-bg-surface/70 p-5 shadow-card backdrop-blur">
      <header className="mb-3 flex items-center gap-2">
        <Key className="h-4 w-4 text-sv-sky" />
        <h3 className="text-sm font-semibold text-ink-50">
          Authentication &amp; access
        </h3>
        {authBypassed ? (
          <span className="ml-auto rounded-full bg-yellow-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-brand text-yellow-200 ring-1 ring-inset ring-yellow-500/30">
            <EyeOff className="mr-1 inline h-3 w-3" />
            auth bypassed
          </span>
        ) : null}
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <p className="mb-1 text-[10px] uppercase tracking-brand text-sv-sky">
            Charger
          </p>
          <dl className="space-y-0.5 text-[11px]">
            <Kv
              label="Auth type"
              value={authenticationTypeLabel(c.AuthenticationType)}
            />
            <Kv
              label="Authorization required"
              value={
                c.IsAuthorizationRequired === true
                  ? "yes"
                  : c.IsAuthorizationRequired === false
                    ? "no"
                    : "—"
              }
            />
            <Kv
              label="Auth bypass enabled"
              value={
                c.PropertyAuthenticationDisabled === true
                  ? "yes (no card needed)"
                  : c.PropertyAuthenticationDisabled === false
                    ? "no"
                    : "—"
              }
            />
            <Kv label="Default offline ID tag" value={c.PropertyOcppDefaultIdTag ?? "—"} mono />
            <Kv
              label="Offline phase override"
              value={
                c.PropertyOfflinePhaseOverride != null
                  ? String(c.PropertyOfflinePhaseOverride)
                  : "—"
              }
            />
            <Kv
              label="Pin in offline phase"
              value={c.PropertyPinOfflinePhase ? "yes" : "no"}
            />
            <Kv
              label="Offline PIN"
              value={c.Pin ?? "—"}
              mono
              icon={c.Pin ? Eye : undefined}
            />
          </dl>
        </div>

        <div>
          <p className="mb-1 text-[10px] uppercase tracking-brand text-sv-sky">
            Installation policy
          </p>
          <dl className="space-y-0.5 text-[11px]">
            <Kv
              label="Auth type"
              value={authenticationTypeLabel(inst?.AuthenticationType)}
            />
            <Kv
              label="Auth required"
              value={inst?.IsRequiredAuthentication ? "yes" : "no"}
            />
            <Kv
              label="Offline allow anonymous"
              value={
                inst?.PropertyOfflineModeAllowAnonymous == null
                  ? "—"
                  : inst.PropertyOfflineModeAllowAnonymous
                    ? "yes"
                    : "no"
              }
            />
            <Kv
              label="Min power offline"
              value={
                inst?.PropertyIsMinimumPowerOfflineMode == null
                  ? "—"
                  : inst.PropertyIsMinimumPowerOfflineMode
                    ? "yes"
                    : "no"
              }
            />
            <Kv label="Default offline ID tag" value={inst?.PropertyOcppDefaultIdTag ?? "—"} mono />
          </dl>

          <p className="mt-3 mb-1 text-[10px] uppercase tracking-brand text-sv-sky">
            Live state
          </p>
          <dl className="space-y-0.5 text-[11px]">
            <Kv label="Auth list version (751)" value={authListVer ?? "—"} mono />
            <Kv label="Enabled NFC tech (752)" value={enabledNfc ?? "—"} mono />
            <Kv
              label="Current user UUID (722)"
              value={currentUserUuid?.slice(0, 13) ?? "— (no session)"}
              mono
            />
          </dl>
        </div>
      </div>
    </section>
  );
}

function Kv({
  label,
  value,
  mono,
  icon: Icon,
}: {
  label: string;
  value: string;
  mono?: boolean;
  icon?: typeof Eye;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-bg-border/30 pb-1 last:border-0">
      <dt className="text-ink-500">{label}</dt>
      <dd
        className={
          mono
            ? "inline-flex items-center gap-1 font-mono text-ink-200"
            : "inline-flex items-center gap-1 text-ink-200"
        }
      >
        {Icon ? <Icon className="h-3 w-3 text-ink-400" /> : null}
        {value}
      </dd>
    </div>
  );
}
