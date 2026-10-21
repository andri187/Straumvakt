// The billing period store — `billing_periods` and its transition log.
//
// ── WHY THIS LIVES IN lib/billing AND NOT IN repositories/ ──────────────
//
// Repositories belong in `apps/api/src/repositories/`, and this is a
// repository. It sits here because the round-3 lane boundary gives Claude A
// `apps/api/src/lib/billing/**` outright and `apps/api/src/repositories/` only
// as `activity-month*`. Two agents creating files in one directory is the
// avoidable conflict this round was split to prevent. **Move it to
// `repositories/period-store.ts` when the lanes merge** — nothing here depends
// on the location.
//
// ── DELTA 9.8 ───────────────────────────────────────────────────────────
//
// `billing.billing_periods` was created by 0002 and never written to. So
// nothing recorded that the activity aggregation had run, and the port's
// adapter took `activityJobHasRun` as a caller-supplied boolean whose only
// honest value was `false` — every period held.
//
// The fine-grained state lives in `billing.period_transitions` (migration
// 0003, append-only) and is DERIVED by replaying the log. `billing_periods`
// keeps the coarse `open | closing | closed` enum in step, computed from the
// fine state by `coarseStateOf` so the two cannot disagree.
//
// ── WRITTEN, NEVER EXECUTED ─────────────────────────────────────────────
//
// Neither 0002 nor 0003 has been applied to any database. Every function here
// is typed against the real tables and has never run. The fixture adapter in
// the dry run is what the tests drive, exactly as `ActivitySourcePort`
// established — had this called Drizzle directly from the feeder, the only way
// to see an invoice before 0002 was applied would be to apply 0002.

import { and, asc, eq, inArray } from "drizzle-orm";
import { billingPeriods, periodTransitions } from "@straumvakt/shared/db/commercial";
import {
  applyPeriodEvent,
  coarseStateOf,
  periodBounds,
  type BillingPeriodRef,
  type PeriodEvent,
  type PeriodLifecycleState,
  type PeriodStateReader,
  type PeriodTransition,
} from "@straumvakt/commercial";
import type { Db } from "../drizzle";

/**
 * Tenant confinement, required. `null` means platform-wide and must be written
 * deliberately — the shape established for the ledger in the 2026-08-18
 * scoping round, so a caller who has not thought about tenancy does not
 * compile.
 */
export interface PeriodAccess {
  restrictToOrgIds: string[] | null;
}

function assertOrgInScope(orgId: string, access: PeriodAccess): void {
  if (access.restrictToOrgIds === null) return;
  if (!access.restrictToOrgIds.includes(orgId)) {
    // A refusal, not an empty result. An org the caller may not see and an org
    // with no periods are different facts, and only one is a bug worth finding.
    throw new Error("period_org_not_in_scope");
  }
}

/**
 * Replay the transition log into the current fine state.
 *
 * The log is the record; the state is derived from it. That is FOCUS rule 4's
 * shape applied to the lifecycle: no row anywhere stores the fine state, so no
 * row can disagree with the history.
 *
 * An empty log means the period was never opened, which is `not_opened` — the
 * absence of rows, not a row saying "nothing yet".
 */
export function replayTransitions(
  rows: readonly { toState: string }[],
): PeriodLifecycleState {
  if (rows.length === 0) return "not_opened";
  return rows[rows.length - 1]!.toState as PeriodLifecycleState;
}

/** Read one period's fine state. */
export async function readPeriodState(
  db: Db,
  period: BillingPeriodRef,
  access: PeriodAccess,
): Promise<PeriodLifecycleState> {
  assertOrgInScope(period.orgId, access);
  const rows = await db
    .select({ toState: periodTransitions.toState })
    .from(periodTransitions)
    .where(
      and(
        eq(periodTransitions.orgId, period.orgId),
        eq(periodTransitions.periodYear, period.year),
        eq(periodTransitions.periodMonth, period.month),
        access.restrictToOrgIds === null
          ? undefined
          : inArray(periodTransitions.orgId, access.restrictToOrgIds),
      ),
    )
    .orderBy(asc(periodTransitions.occurredAt));
  return replayTransitions(rows);
}

/** The `PeriodStateReader` the activity port depends on, over Drizzle. */
export function makePeriodStateReader(db: Db, access: PeriodAccess): PeriodStateReader {
  return { stateOf: (period) => readPeriodState(db, period, access) };
}

export interface PeriodEventInput {
  period: BillingPeriodRef;
  event: PeriodEvent;
  actorUserId: string;
  asOf: Date;
  reason?: string | null;
}

export type PeriodEventOutcome =
  | { kind: "applied"; from: PeriodLifecycleState; to: PeriodLifecycleState }
  | { kind: "noop"; state: PeriodLifecycleState }
  | { kind: "refused"; state: PeriodLifecycleState; reason: string };

/**
 * Apply one lifecycle event and persist it.
 *
 * The decision is the pure state machine's; this only persists what it
 * returns. Both writes go in one transaction, because a transition row without
 * its `billing_periods` update leaves the coarse enum lying about the period,
 * and the enum is what every un-ported Prisma reader still believes.
 *
 * Idempotency is the unique index `(org_id, period_year, period_month, event)`
 * on `period_transitions`: no event occurs twice in one period's life, so a
 * retried month-end job collides in the database rather than double-recording.
 * The pure machine's `noop` catches the common case first; the index catches
 * the concurrent one.
 */
export async function applyPeriodEventAndPersist(
  db: Db,
  input: PeriodEventInput,
  access: PeriodAccess,
): Promise<PeriodEventOutcome> {
  assertOrgInScope(input.period.orgId, access);

  const state = await readPeriodState(db, input.period, access);
  const decision: PeriodTransition = applyPeriodEvent({
    state,
    event: input.event,
    period: input.period,
    asOf: input.asOf,
    actorUserId: input.actorUserId,
  });

  if (decision.kind === "noop") return { kind: "noop", state: decision.state };
  if (decision.kind === "refused") {
    return { kind: "refused", state: decision.state, reason: decision.reason };
  }

  const { start, end } = periodBounds(input.period);
  const coarse = coarseStateOf(decision.to);

  await db.transaction(async (tx) => {
    await tx
      .insert(billingPeriods)
      .values({
        orgId: input.period.orgId,
        periodYear: input.period.year,
        periodMonth: input.period.month,
        periodStart: start,
        periodEnd: end,
        state: coarse,
        ...(decision.to === "closed"
          ? { closedAt: input.asOf, closedByUserId: input.actorUserId }
          : {}),
      })
      .onConflictDoUpdate({
        target: [
          billingPeriods.orgId,
          billingPeriods.periodYear,
          billingPeriods.periodMonth,
        ],
        set: {
          // Only the coarse state and the close stamps move. period_start /
          // period_end are facts about the calendar and must never be rewritten
          // by a later transition — a period whose bounds shift is a period
          // whose invoice covered a different month than it says.
          state: coarse,
          ...(decision.to === "closed"
            ? { closedAt: input.asOf, closedByUserId: input.actorUserId }
            : {}),
        },
      });

    await tx.insert(periodTransitions).values({
      orgId: input.period.orgId,
      periodYear: input.period.year,
      periodMonth: input.period.month,
      fromState: decision.from,
      toState: decision.to,
      event: input.event,
      actorUserId: input.actorUserId,
      reason: input.reason ?? null,
      occurredAt: input.asOf,
    });
  });

  return { kind: "applied", from: decision.from, to: decision.to };
}
