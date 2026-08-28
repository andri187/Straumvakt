// Generating money twice, made structurally impossible.
//
// ── THE SHAPE OF THE BUG ─────────────────────────────────────────────────
//
// lib/agreement/persist.ts:359 does this:
//
//     const existing = await prisma.agreementBillingLine.count({ where: { sessionId } })
//     if (existing > 0) return { ok: true, emitted: 0, alreadyExisted: true }
//     ...
//     await prisma.agreementBillingLine.createMany({ data: lines })
//
// Two separate round trips, no transaction between them, against a table
// whose only relevant index is `@@index([sessionId, factorCode, kind])` — a
// plain index, not unique (commercial.prisma:799). Two cron ticks that overlap
// both read zero and both insert. The session is billed twice, and nothing in
// the database says it should not have been.
//
// The header of billing-tick.ts states the opposite — "Idempotent —
// resolveAndPersistForSession skips sessions that already have lines, so a
// double-tick is safe." That is true of a SEQUENTIAL double-tick and false of
// a concurrent one, which is the only kind a cron actually produces.
//
// ── WHY A COUNT CAN NEVER BE THE ANSWER ──────────────────────────────────
//
// `count() === 0` asks a question about the past that stops being true before
// the answer is used. No amount of care at the call site fixes it, because the
// gap is between two statements and not inside either. Only two things
// actually close it:
//
//   1. a UNIQUE constraint, so the loser of a race gets an error instead of a
//      second row; and
//   2. a decision expressed as "which of these natural keys is absent?"
//      instead of "how many rows are there?", so that a partially-completed
//      batch resumes correctly rather than being skipped wholesale.
//
// This module is (2), pure and testable. (1) is a migration: the Core tables
// already have it — see below — and `agreements.billing_lines` does not, which
// is recorded as a finding in the migration preflight pack.
//
// ── WHAT 0002 ALREADY GUARANTEES (verified 2026-08-18) ───────────────────
//
//   billing.session_settlements         session_id           PRIMARY KEY
//   billing.settlement_components       (session_id, kind)   UNIQUE
//   billing.settlement_holds            (session_id, reason) UNIQUE
//   billing.statements                  (period_id, recipient_kind, recipient_id) UNIQUE
//   billing.statement_lines             (statement_id, line_no) UNIQUE
//   billing.mutation_receipts           (org_id, scope, idempotency_key) UNIQUE
//   billing.statement_exports           (org_id, idempotency_key) UNIQUE
//   billing.statement_delivery_attempts (statement_id, idempotency_key) UNIQUE
//   billing.billing_periods             (org_id, period_year, period_month) UNIQUE
//
// session_settlements is keyed by PRIMARY KEY rather than by a unique index,
// which is stronger than the prompt described, not weaker. Every key the
// prompt named is present.

/** A natural key: the identity a row HAS, as opposed to the id it was given. */
export type NaturalKey = string;

/**
 * Every generation run must carry one of these. There is no default and no
 * generated fallback, on purpose — see `requireIdempotencyKey`.
 */
export interface GenerationRunKey {
  orgId: string;
  /** What is being generated. Matches billing.mutation_receipts.scope. */
  scope: string;
  /** Supplied by the caller — the cron tick id, the operator's request id. */
  idempotencyKey: string;
}

/**
 * Refuse to proceed without an idempotency key.
 *
 * The tempting alternative is `idempotencyKey ?? crypto.randomUUID()`, which
 * makes every call unique and therefore makes every retry a fresh generation —
 * an idempotency mechanism that guarantees the thing it was added to prevent.
 * A caller that cannot name its run is a caller that cannot be retried safely,
 * and it must be fixed rather than defaulted.
 *
 * @throws when the key is missing, blank, or whitespace only.
 */
export function requireIdempotencyKey(run: {
  orgId?: string | null;
  scope?: string | null;
  idempotencyKey?: string | null;
}): GenerationRunKey {
  const orgId = run.orgId?.trim();
  const scope = run.scope?.trim();
  const idempotencyKey = run.idempotencyKey?.trim();
  if (!orgId) throw new Error("generation_run_requires_org_id");
  if (!scope) throw new Error("generation_run_requires_scope");
  if (!idempotencyKey) throw new Error("generation_run_requires_idempotency_key");
  return { orgId, scope, idempotencyKey };
}

/** The receipt key. Mirrors the UNIQUE on billing.mutation_receipts. */
export function mutationReceiptKey(run: GenerationRunKey): NaturalKey {
  return joinKey([run.orgId, run.scope, run.idempotencyKey]);
}

/** billing.session_settlements — PRIMARY KEY (session_id). */
export function sessionSettlementKey(sessionId: string): NaturalKey {
  return joinKey([sessionId]);
}

/** billing.settlement_components — UNIQUE (session_id, kind). */
export function settlementComponentKey(sessionId: string, kind: string): NaturalKey {
  return joinKey([sessionId, kind]);
}

/** billing.settlement_holds — UNIQUE (session_id, reason). */
export function settlementHoldKey(sessionId: string, reason: string): NaturalKey {
  return joinKey([sessionId, reason]);
}

/** billing.statements — UNIQUE (period_id, recipient_kind, recipient_id). */
export function statementNaturalKey(
  periodId: string,
  recipientKind: string,
  recipientId: string,
): NaturalKey {
  return joinKey([periodId, recipientKind, recipientId]);
}

/** billing.statement_lines — UNIQUE (statement_id, line_no). */
export function statementLineKey(statementId: string, lineNo: number): NaturalKey {
  if (!Number.isInteger(lineNo) || lineNo < 1) {
    // A derived line number that is not a positive integer means the caller
    // computed it from a count or an array index and got it wrong. Line 0 and
    // line 1.5 are both a corrupted document, not a recoverable state.
    throw new Error("statement_line_no_must_be_a_positive_integer");
  }
  return joinKey([statementId, String(lineNo)]);
}

/**
 * agreements.billing_lines — the LEGACY table.
 *
 * `@@index([sessionId, factorCode, kind])` exists and is NOT unique, so this
 * key is currently advisory: it lets the writer skip rows it can see, and it
 * cannot stop a concurrent writer. Making it binding needs a dedupe-then-index
 * migration, written up in the preflight pack and deliberately unapplied.
 */
export function agreementBillingLineKey(
  sessionId: string,
  factorCode: string,
  kind: string,
): NaturalKey {
  return joinKey([sessionId, factorCode, kind]);
}

// ASCII unit separator (U+001F), built with fromCharCode rather than written as
// a literal so that no editor, linter or copy-paste can silently strip an
// invisible control character out of a key derivation. Not "-" or ":" — both
// occur inside UUID-adjacent values and inside factor codes, and a separator
// that can appear in a component makes ("a|b", "c") and ("a", "b|c") the same
// key.
const SEPARATOR = String.fromCharCode(0x1f);

function joinKey(parts: readonly string[]): NaturalKey {
  for (const p of parts) {
    if (p.includes(SEPARATOR)) throw new Error("natural_key_component_contains_separator");
  }
  return parts.join(SEPARATOR);
}

// ── The batch plan ───────────────────────────────────────────────────────

export interface GenerationPlan<T> {
  /** Rows whose natural key is absent downstream — these are written. */
  toWrite: T[];
  /** Rows already present. Not an error; the expected state on a re-run. */
  alreadyPresent: T[];
  /** Two candidates in ONE batch claiming the same natural key. */
  conflicting: T[];
}

/**
 * Decide what a generation run should write, by natural key.
 *
 * This replaces `if (count > 0) skip-everything`. The difference matters in
 * exactly the case that hurts: a batch that died halfway leaves some keys
 * present and some absent, and a count-based check reads "some exist" and
 * skips the rest **forever** — under-billing silently, which is the failure
 * nobody notices because nothing errors.
 *
 * `conflicting` is separated from `toWrite` rather than deduplicated into it.
 * Two candidate rows claiming one natural key inside a single batch means the
 * generator produced contradictory input; silently keeping the first is a
 * decision this function is not entitled to make.
 */
export function planGeneration<T>(
  candidates: readonly T[],
  keyOf: (row: T) => NaturalKey,
  existingKeys: Iterable<NaturalKey>,
): GenerationPlan<T> {
  const present = new Set(existingKeys);
  const claimedInBatch = new Set<NaturalKey>();

  const plan: GenerationPlan<T> = { toWrite: [], alreadyPresent: [], conflicting: [] };
  for (const row of candidates) {
    const key = keyOf(row);
    if (present.has(key)) {
      plan.alreadyPresent.push(row);
      continue;
    }
    if (claimedInBatch.has(key)) {
      plan.conflicting.push(row);
      continue;
    }
    claimedInBatch.add(key);
    plan.toWrite.push(row);
  }
  return plan;
}

/**
 * Assign statement line numbers deterministically, from the content.
 *
 * `lineNo: i + 1` over an array is only as stable as the array's order. If the
 * order comes from a query without a total ordering, a regenerate can produce
 * the same lines under different numbers, and `(statement_id, line_no)` then
 * makes the SECOND generation collide with the first on rows that are not the
 * same rows — a unique violation that looks like idempotency working while
 * actually hiding a reordering.
 *
 * Sorting by a caller-supplied stable discriminator first makes the numbering
 * a function of content rather than of arrival.
 */
export function assignStableLineNumbers<T>(
  lines: readonly T[],
  discriminatorOf: (line: T) => string,
): Array<{ line: T; lineNo: number }> {
  const decorated = lines.map((line, index) => ({
    line,
    index,
    discriminator: discriminatorOf(line),
  }));
  decorated.sort((a, b) =>
    a.discriminator === b.discriminator
      ? a.index - b.index
      : a.discriminator < b.discriminator
        ? -1
        : 1,
  );
  return decorated.map((d, i) => ({ line: d.line, lineNo: i + 1 }));
}

// ── Write outcomes ───────────────────────────────────────────────────────

export type WriteOutcome = "written" | "duplicate" | "failed";

/**
 * Classify a driver error so a unique violation reads as idempotent success.
 *
 * Once the constraint exists, the loser of a race MUST get an error — that is
 * the point. What must not happen is that error propagating as a failed
 * billing run, because then a correctly-prevented double-write looks identical
 * to a broken one, and the operator learns to ignore both.
 *
 * Postgres 23505 is unique_violation; Prisma wraps it as P2002.
 */
export function classifyWriteError(err: unknown): WriteOutcome {
  const code = extractCode(err);
  if (code === "23505" || code === "P2002") return "duplicate";
  return "failed";
}

function extractCode(err: unknown): string | null {
  if (typeof err !== "object" || err === null) return null;
  const withCode = err as { code?: unknown; cause?: unknown };
  if (typeof withCode.code === "string") return withCode.code;
  if (withCode.cause) return extractCode(withCode.cause);
  return null;
}
