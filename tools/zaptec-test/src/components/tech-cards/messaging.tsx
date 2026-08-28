import { Radio, Lock } from "lucide-react";
import type { MessagingConnectionDetails } from "@/lib/zaptec";

// Real-time push channel via Azure Service Bus AMQP. We deliberately do NOT
// render the password — only the host, topic, and protocol metadata to
// demonstrate that the channel is provisioned. Anyone wanting to actually
// subscribe needs to fetch the credentials server-side.

export function MessagingCard({
  details,
  installationId,
}: {
  details: MessagingConnectionDetails | null;
  installationId: string;
}) {
  return (
    <section className="rounded-lg border border-bg-border bg-bg-surface/70 p-5 shadow-card backdrop-blur">
      <header className="mb-3 flex items-center gap-2">
        <Radio className="h-4 w-4 text-sv-sky" />
        <h3 className="text-sm font-semibold text-ink-50">
          Real-time push channel
        </h3>
        <span className="ml-auto text-[10px] uppercase tracking-brand text-ink-500">
          /api/installation/{installationId.slice(0, 8)}/messagingConnectionDetails
        </span>
      </header>

      {!details ? (
        <p className="text-xs text-ink-400">
          Real-time push not configured for this installation. Polling at 5 s
          is the only live channel.
        </p>
      ) : (
        <>
          <p className="text-xs text-ink-300">
            Zaptec exposes a per-installation Azure Service Bus AMQP channel.
            Subscribe here to replace polling with sub-second push for state
            and session events.
          </p>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
            <Kv label="Protocol" value="AMQP 1.0 (Azure Service Bus)" />
            <Kv label="TLS" value={details.UseSSL ? "required" : "optional"} />
            <Kv label="Host" value={details.Host} mono truncate />
            <Kv label="Port" value={String(details.Port)} mono />
            <Kv label="Topic" value={details.Topic} mono truncate />
            <Kv label="Subscription" value={details.Subscription} mono />
            <Kv label="Type code" value={String(details.Type)} mono />
            <Kv
              label="Username"
              value={details.Username.slice(0, 24) + "…"}
              mono
              truncate
            />
            <Kv
              label="Password"
              value="•••••••• (server-side only)"
              icon={Lock}
            />
          </dl>
          <p className="mt-3 text-[11px] text-ink-400">
            Credentials are short-lived shared-access signatures. They are
            never sent to the browser — the API route fetches and forwards
            messages on the technician&apos;s behalf.
          </p>
        </>
      )}
    </section>
  );
}

function Kv({
  label,
  value,
  mono,
  truncate,
  icon: Icon,
}: {
  label: string;
  value: string;
  mono?: boolean;
  truncate?: boolean;
  icon?: typeof Lock;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-bg-border/30 pb-1 last:border-0">
      <dt className="shrink-0 text-ink-500">{label}</dt>
      <dd
        className={
          (mono ? "font-mono " : "") +
          (truncate ? "max-w-[60%] truncate " : "") +
          "inline-flex items-center gap-1 text-ink-200"
        }
      >
        {Icon ? <Icon className="h-3 w-3 text-ink-400" /> : null}
        {value}
      </dd>
    </div>
  );
}
