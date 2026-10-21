// Where an invoice number comes from, and what it costs.
//
// ── THE INVARIANT, STATED BEFORE THE MECHANISM ──────────────────────────
//
// Icelandic law requires sales invoices "fyrirfram tölusett með áprentuð númer
// í samfelldri töluröð" — pre-numbered, in an UNBROKEN sequence. That is TWO
// requirements and they are not the same one:
//
//   UNIQUE    no two documents ever carry the same number.
//   GAP-FREE  every ordinal between the first and the last is accounted for —
//             either by a live document or by one recorded VOID.
//
// **They do not conflict, and the whole point of the mechanism below is that
// it delivers both.** The reason to say so explicitly is that the obvious
// implementation delivers only one:
//
//   a Postgres SEQUENCE   unique, NOT gap-free. `nextval` is non-transactional
//                         by design, so a rolled-back issue burns its value
//                         permanently. Correct for surrogate keys, wrong for a
//                         legal document number.
//   a counter ROW         both, because the increment participates in the
//                         issuing transaction and rolls back with it.
//
// **The mechanism chosen is the counter row, and its cost is real: allocation
// SERIALISES per (org, series, year).** Two concurrent issues for one org-year
// block each other on `SELECT … FOR UPDATE`. At one invoice per org per month
// that contention is nil, and throughput is not the axis worth trading
// correctness on here.
//
// **If they ever did conflict, gap-free wins.** A duplicate number is
// detectable by anyone holding both documents; a hole is detectable only by
// whoever audits the series, and it is the thing the statute names.
//
// ── CRASH SEMANTICS ─────────────────────────────────────────────────────
//
// If the process dies between allocation and commit, **nothing is consumed.**
// The counter increment, the `document_numbers` row and the statement are one
// transaction; a crash rolls back all three. The next attempt allocates the
// same ordinal.
//
// This is why there is deliberately **no release operation.** A number can only
// be spent by a committed transaction, and a committed number is never taken
// back — it is recorded `voided` in place, and the sequence still accounts for
// it.
//
// ── WHAT WOULD CHANGE IF THE ACCOUNTANT ANSWERS DIFFERENTLY ─────────────
//
// The outstanding question (retention, numbering, corrections, and the
// *yfirlýsing seljanda eða hönnuðar hugbúnaðarins*) could move three things,
// and each is a one-place change by construction:
//
//   1. **A shared series across orgs** instead of per-org. Drop `org_id` from
//      the series key. The store is keyed `(org, series, year)`; making it
//      `(series, year)` is a migration and a constant, not a redesign.
//   2. **Credit notes on their own series** rather than sharing the invoice
//      series. `purpose` is already carried on every allocation; issuing a
//      credit note from series "SVK" instead of "SV" is a caller argument.
//   3. **No year reset** — a single perpetual series. `periodYear` becomes a
//      constant in the key. B's `number.ts` already carries
//      `resetOnYearRollover` for exactly this.
//
// Nothing here waits on that answer.

import { and, eq, sql } from "drizzle-orm";
import { documentNumberSeries, documentNumbers } from "@straumvakt/shared/db/commercial";
import { formatDocumentNumber } from "@straumvakt/contracts/invoice/number";
import type { Db } from "../drizzle";

/** What a number is spent on. Text, not an enum — see the schema note. */
export const DOCUMENT_PURPOSES = ["invoice", "credit_note", "correction"] as const;
export type DocumentPurpose = (typeof DOCUMENT_PURPOSES)[number];

export interface AllocationRequest {
  orgId: string;
  series: string;
  /** Drives the sequence key and the rendered number. */
  year: number;
  purpose: DocumentPurpose;
  /** The statement this number is for. One number per (statement, purpose). */
  statementId: string;
  /**
   * The caller's key. **Never generated.** A generated key makes every retry a
   * fresh allocation, which is an idempotency mechanism that guarantees the
   * duplicate it was added to prevent.
   */
  idempotencyKey: string;
  issuedByUserId: string;
  issuedAt: Date;
}

export type AllocationOutcome =
  | { kind: "allocated"; documentNumber: string; ordinal: number }
  /** Same key, same request. The number already allocated, not a new one. */
  | { kind: "reused"; documentNumber: string; ordinal: number }
  /**
   * A DIFFERENT key for a (statement, purpose) that already has a number.
   * Refused rather than allocating a second — two keys for one invoice is one
   * invoice and one caller bug, and spending another number would hide it.
   */
  | { kind: "refused"; reason: "statement_already_numbered"; documentNumber: string }
  | { kind: "refused"; reason: "idempotency_key_required"; documentNumber?: undefined };

/**
 * The port. A fixture adapter drives the tests; the Drizzle adapter below is
 * written and has never executed, because `0004` has not been applied.
 */
export interface DocumentNumberStorePort {
  allocate(req: AllocationRequest): Promise<AllocationOutcome>;
  /** Record a committed number as spent-without-a-live-document. Never a delete. */
  voidNumber(input: {
    orgId: string;
    documentNumber: string;
    reason: string;
    at: Date;
  }): Promise<{ kind: "voided" } | { kind: "refused"; reason: string }>;
  /** Every ordinal in the series that is neither issued nor voided. */
  findGaps(orgId: string, series: string, year: number): Promise<number[]>;
}

/**
 * Validate a request before it can touch a sequence.
 *
 * Pure, so the refusal is testable without a database and cannot be skipped by
 * an adapter that forgets it.
 */
export function checkAllocationRequest(
  req: AllocationRequest,
): { ok: true } | { ok: false; reason: "idempotency_key_required" } {
  if (!req.idempotencyKey?.trim()) return { ok: false, reason: "idempotency_key_required" };
  return { ok: true };
}

/**
 * Render an ordinal the way the series says.
 *
 * Delegates to B's `formatDocumentNumber` rather than reimplementing it, so
 * the number on the invoice and the number in the store cannot drift.
 */
export function renderNumber(series: string, year: number, ordinal: number, padWidth: number): string {
  return formatDocumentNumber({ orgScope: "", series, padWidth }, year, ordinal);
}

/**
 * The Drizzle adapter. **Written, never executed** — `0004` is unapplied.
 *
 * The shape is the whole of the correctness argument, so it is spelled out:
 *
 *   1. everything happens inside ONE transaction, supplied by the caller, which
 *      is the same transaction that writes the statement;
 *   2. the idempotency lookup happens FIRST, so a retry never reaches the
 *      counter;
 *   3. the counter row is taken with `FOR UPDATE`, which is what serialises
 *      concurrent issuers and is the cost named in the header;
 *   4. the insert's three unique indexes are the real guarantees — the checks
 *      above are the fast path, and the indexes are what holds when two
 *      processes race past them.
 */
export function makeDrizzleNumberStore(db: Db): DocumentNumberStorePort {
  return {
    async allocate(req) {
      const check = checkAllocationRequest(req);
      if (!check.ok) return { kind: "refused", reason: "idempotency_key_required" };

      return db.transaction(async (tx) => {
        // 1. Same key, already allocated? Return it. A retry must never reach
        //    the counter.
        const prior = await tx
          .select({
            documentNumber: documentNumbers.documentNumber,
            ordinal: documentNumbers.ordinal,
          })
          .from(documentNumbers)
          .where(
            and(
              eq(documentNumbers.orgId, req.orgId),
              eq(documentNumbers.series, req.series),
              eq(documentNumbers.periodYear, req.year),
              eq(documentNumbers.idempotencyKey, req.idempotencyKey),
            ),
          )
          .limit(1);
        if (prior[0]) {
          return { kind: "reused", documentNumber: prior[0].documentNumber, ordinal: prior[0].ordinal };
        }

        // 2. Does this (statement, purpose) already hold a number? Then this is
        //    a DIFFERENT key for the same logical issue. Refuse; do not spend
        //    another ordinal.
        const forStatement = await tx
          .select({ documentNumber: documentNumbers.documentNumber })
          .from(documentNumbers)
          .where(
            and(
              eq(documentNumbers.statementId, req.statementId),
              eq(documentNumbers.purpose, req.purpose),
            ),
          )
          .limit(1);
        if (forStatement[0]) {
          return {
            kind: "refused",
            reason: "statement_already_numbered",
            documentNumber: forStatement[0].documentNumber,
          };
        }

        // 3. Take the counter. `FOR UPDATE` is the serialisation point.
        const seriesRows = await tx.execute<{
          id: string;
          next_ordinal: number;
          pad_width: number;
        }>(sql`
          SELECT id, next_ordinal, pad_width
          FROM billing.document_number_series
          WHERE org_id = ${req.orgId}
            AND series = ${req.series}
            AND period_year = ${req.year}
          FOR UPDATE
        `);

        let ordinal: number;
        let padWidth: number;
        const row = seriesRows.rows?.[0];
        if (row) {
          ordinal = row.next_ordinal;
          padWidth = row.pad_width;
          await tx
            .update(documentNumberSeries)
            .set({ nextOrdinal: ordinal + 1 })
            .where(eq(documentNumberSeries.id, row.id));
        } else {
          // First document of the year for this org. Inserting the series row
          // and taking ordinal 1 in the same transaction means a concurrent
          // first-issuer collides on the series unique index rather than both
          // taking 1.
          ordinal = 1;
          padWidth = 6;
          await tx.insert(documentNumberSeries).values({
            orgId: req.orgId,
            series: req.series,
            periodYear: req.year,
            nextOrdinal: 2,
          });
        }

        const documentNumber = renderNumber(req.series, req.year, ordinal, padWidth);
        await tx.insert(documentNumbers).values({
          orgId: req.orgId,
          series: req.series,
          periodYear: req.year,
          ordinal,
          documentNumber,
          purpose: req.purpose,
          status: "issued",
          statementId: req.statementId,
          idempotencyKey: req.idempotencyKey,
          issuedByUserId: req.issuedByUserId,
          issuedAt: req.issuedAt,
        });

        return { kind: "allocated", documentNumber, ordinal };
      });
    },

    async voidNumber(input) {
      const updated = await db
        .update(documentNumbers)
        .set({ status: "voided", voidedAt: input.at, voidReason: input.reason })
        .where(
          and(
            eq(documentNumbers.orgId, input.orgId),
            eq(documentNumbers.documentNumber, input.documentNumber),
            eq(documentNumbers.status, "issued"),
          ),
        )
        .returning({ id: documentNumbers.id });
      return updated.length > 0
        ? { kind: "voided" }
        : { kind: "refused", reason: "number_not_found_or_already_voided" };
    },

    async findGaps(orgId, series, year) {
      const rows = await db
        .select({ ordinal: documentNumbers.ordinal })
        .from(documentNumbers)
        .where(
          and(
            eq(documentNumbers.orgId, orgId),
            eq(documentNumbers.series, series),
            eq(documentNumbers.periodYear, year),
          ),
        );
      // Voided ordinals are PRESENT rows, so they are not gaps — that is the
      // entire reason void is a status and not a delete.
      const seen = new Set(rows.map((r) => r.ordinal));
      const highest = rows.reduce((m, r) => Math.max(m, r.ordinal), 0);
      const gaps: number[] = [];
      for (let i = 1; i < highest; i++) if (!seen.has(i)) gaps.push(i);
      return gaps;
    },
  };
}
