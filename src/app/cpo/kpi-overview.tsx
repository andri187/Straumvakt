// KPI-only Overview for the shared test login. A server component: native
// details/summary, no client JavaScript, no fetches. Nothing here is a live
// measurement; every observed value is `Not measured` until a bounded
// aggregate source exists, and targets are proposals, never observations.

import type { Actor } from "@/lib/installations/actor";
import styles from "./kpi-overview.module.css";

export type KpiEvidence = {
  /** Where the figure came from, e.g. `Local test · 2026-10-31 20:12 UTC`. */
  label: string;
  lines: readonly string[];
};

export type Kpi = {
  key: string;
  name: string;
  unit: string;
  target: string;
  definition: string;
  method: string;
  /** Source / window / freshness of the live value. */
  source: string;
  evidence?: KpiEvidence;
};

export const KPIS: readonly Kpi[] = [
  {
    key: "command",
    name: "Command correctness",
    unit: "wire commands per stop attempt",
    target: "At most 1; no false stopped outcomes (proposed)",
    definition:
      "Repeated stop requests for the same attempt must not duplicate a command. An offline or expired attempt may send none. Accepted commands and uncertain outcomes must never be recorded as a confirmed session stop.",
    method:
      "Count commands per durable attempt and false stopped outcomes over a stated window, with sample count and offline, expired, accepted and confirmed-stop outcomes separated.",
    source: "Unavailable: no live aggregate is collected or served.",
    evidence: {
      label: "Local test · 2026-10-31 20:12 UTC",
      lines: [
        "100 simultaneous first deliveries of one attempt gave 1 wire send, 1 retained record and 100 accepted replies, in a local workerd runtime with SQLite-backed Durable Object storage.",
        "This is one simulated device, not 100 chargers, and not proof of a real session stop.",
      ],
    },
  },
  {
    key: "recovery",
    name: "Session and financial recovery",
    unit: "age of oldest stopped session without a priced result",
    target: "Recovered at the next healthy recovery pass (proposed)",
    definition:
      "Committed stop evidence that was not priced, because a trigger was lost, is found and settled exactly once by an independent recovery pass.",
    method:
      "Oldest age and count of sessions waiting for pricing, plus held and failed outcomes, per window.",
    source: "Unavailable: independent recovery is not built, so nothing is collected.",
  },
  {
    key: "ui-db",
    name: "UI database amplification",
    unit: "periodic data SQL queries per subscribed viewer-minute",
    target: "0 per viewer-minute (proposed)",
    definition:
      "Additional viewers of an unchanged installation must not add periodic database reads of the same data.",
    method:
      "Compare source-side query counts with 1, 10 and 100 viewers over 30 minutes. Count initial loads, authorization and shared repair reads separately.",
    source: "Unavailable: shared live updates are not built; current views poll.",
  },
  {
    key: "freshness",
    name: "Live-data freshness",
    unit: "seconds from gateway receipt to visible status (p95)",
    target: "5 seconds or less while connected (proposed)",
    definition:
      "Delivery delay from gateway receipt to rendered status or progress. Observation age is tracked separately; a gap is shown as stale, never as current.",
    method:
      "Correlate gateway receipt with UI render, accounting for clock offset. Report p50, p95 and p99, sample count and window; keep charger-clock age separate.",
    source: "Unavailable: no latency samples are collected.",
  },
  {
    key: "efficiency",
    name: "Processing efficiency",
    unit: "RPCs, client constructions and SQL transactions, counted separately",
    target: "20 to 1 RPC/client per full batch (proposed)",
    definition:
      "Work needed to store meter events with identical evidence. Stage 4a batches transport and reuses a client but keeps per-event transactions. Stage 4b separately evaluates SQL batching.",
    method:
      "Compare the same 20-event chunk: 95% fewer RPCs/client constructions at full occupancy; proposed practical target at least 80%. Report SQL transactions separately, along with batch occupancy, retries and failures.",
    source: "Unavailable: batched ingestion is not built and no baseline is recorded.",
    evidence: {
      label: "Local unit fixture · 2026-10-31 20:12 UTC",
      lines: [
        "For an original stop request plus 100 redeliveries: 2 stop-record writes, 1 alarm set, 0 engine calls.",
        "Logical storage operations in a test double. Not billable cloud operations, and lifecycle database work is not included.",
      ],
    },
  },
  {
    key: "opex",
    name: "Total recurring OPEX per billable connector",
    unit: "USD per billable connector per month",
    target: "Well below 1 (goal, not a measured value)",
    definition:
      "All recurring operating cost of Straumvakt itself: cloud, storage, integrations, invoicing and collection of its own fees, email, domain, support, accounting and tooling, divided by billable connectors.",
    method:
      "Complete monthly bills and labour estimate, with fleet size, billed CPOs, activity and retention stated. Observed, estimated and unknown items are kept apart; stations and connectors are counted separately.",
    source: "Unavailable: no complete bill or labour data is connected, so no all-in figure exists.",
  },
];

/**
 * Platform KPI visibility is for the verified shared test login only. Any
 * other actor, including one that does not exist yet, is denied by default.
 */
export function canViewPlatformKpis(actor: Actor | null): boolean {
  return actor !== null && actor.kind === "shared_login" && actor.platformOperator === true;
}

export function KpiOverview() {
  return (
    <section aria-labelledby="kpi-heading">
      <h1 id="kpi-heading">Overview</h1>
      <p className={styles.lead}>
        Key indicators for the shared test login. Values show Not measured
        until a measurement source exists.
      </p>
      <ul className={styles.grid}>
        {KPIS.map((kpi) => (
          <li key={kpi.key} className={styles.card}>
            <details>
              <summary className={styles.summary}>
                <span className={styles.name}>{kpi.name}</span>
                <span className={styles.value}>Not measured</span>
                <span className={styles.meta}>Unit: {kpi.unit}</span>
                <span className={styles.meta}>Target: {kpi.target}</span>
              </summary>
              <dl className={styles.details}>
                <dt>Definition</dt>
                <dd>{kpi.definition}</dd>
                <dt>Measurement</dt>
                <dd>{kpi.method}</dd>
                <dt>Source, window and freshness</dt>
                <dd>{kpi.source}</dd>
              </dl>
              {kpi.evidence ? (
                <div className={styles.evidence}>
                  <strong>{kpi.evidence.label}</strong>
                  {kpi.evidence.lines.map((line) => (
                    <p key={line}>{line}</p>
                  ))}
                </div>
              ) : null}
            </details>
          </li>
        ))}
      </ul>
      <p className={styles.footer}>
        Targets are proposals. Local test results are not live measurements.
      </p>
    </section>
  );
}
