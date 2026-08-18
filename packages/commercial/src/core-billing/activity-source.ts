// The port between the flat-fee feeder and the activity tables.
//
// ── WHY A PORT AND NOT A DRIZZLE CALL ───────────────────────────────────
//
// `flat-fee.ts` is pure and stays pure. It prices a month; it has no business
// knowing that the counts come from Postgres, still less from which ORM. The
// feeder therefore depends on this interface, and `apps/api` supplies the
// implementation that reads `reports.connector_activity_month` and
// `reports.driver_activity_month` through Drizzle.
//
// That is not architecture for its own sake. It is what lets the first-invoice
// dry run exercise the ENTIRE path — activity → statement → invoice document →
// validator → header — with **no database and no network**, by handing the same
// feeder a fixture-backed port. If the feeder called Drizzle directly, the only
// way to see an invoice before migration `0002` is applied would be to apply
// migration `0002`.
//
// ── THE RULE THIS PORT ENFORCES ─────────────────────────────────────────
//
// **Absent rows are `unavailable`, never zero.**
//
// A count of zero and a count nobody could take look identical on an invoice,
// and only one of them is honest. `reports.*_activity_month` has no row for a
// connector nobody could evidence, so "no rows" means "we do not know", and the
// port is required to say so. An adapter that returns `measured(0, …)` for an
// empty table would produce a 0 kr invoice for an org that owes money, which is
// the exact failure the whole activity-source lane exists to prevent.

import { periodBounds, type BillingPeriodRef } from "./period-close";
import {
  generateFlatFeeStatement,
  measured,
  unavailable,
  type CountEvidence,
  type FlatFeeInput,
  type FlatFeeResult,
} from "./flat-fee";

/**
 * What the feeder needs from the world.
 *
 * Both methods return `CountEvidence`, not a number, so an adapter physically
 * cannot express "I looked and found nothing" as a zero — it has to choose
 * `measured` or `unavailable`, and choosing wrongly is visible in review.
 */
export interface ActivitySourcePort {
  /** Distinct connectors with an activity row for the period. */
  connectorCount(period: BillingPeriodRef): Promise<CountEvidence>;
  /** Distinct drivers with an activity row for the period. */
  driverCount(period: BillingPeriodRef): Promise<CountEvidence>;
}

/**
 * Turn a row count into evidence, applying the absent-is-unknown rule once.
 *
 * Every adapter should build its `CountEvidence` through this rather than
 * constructing it inline, so the rule lives in one place and an adapter cannot
 * quietly disagree with it.
 *
 * `expectRowsWhenPopulated` is what distinguishes the two zeroes. An org that
 * genuinely has no connectors is not the same as an org whose activity job has
 * not run, and only the caller knows which it is looking at — so it has to say.
 */
export function countFromRows(
  rowCount: number,
  opts: { activityJobHasRun: boolean; source: "activity_month_table" },
): CountEvidence {
  if (!opts.activityJobHasRun) return unavailable("no_activity_source");
  if (rowCount === 0) return unavailable("no_activity_source");
  return measured(rowCount, opts.source);
}

/**
 * Price one org-month, taking the counts from the port.
 *
 * The signature deliberately mirrors `generateFlatFeeStatement` minus the two
 * count fields: everything else about a flat-fee period — the rate references,
 * the plug-time contract — still comes from the caller, because those are
 * agreement facts and not activity facts.
 */
export async function generateFlatFeeStatementFromSource(
  port: ActivitySourcePort,
  input: Omit<FlatFeeInput, "activeConnectors" | "activeDrivers">,
): Promise<FlatFeeResult> {
  // Bound-check the period before spending two queries on it. periodBounds
  // throws on month 0 or 13, and a caller that got the period wrong should
  // find out before the counts, not after.
  periodBounds(input.period);

  const [activeConnectors, activeDrivers] = await Promise.all([
    port.connectorCount(input.period),
    port.driverCount(input.period),
  ]);

  return generateFlatFeeStatement({ ...input, activeConnectors, activeDrivers });
}
