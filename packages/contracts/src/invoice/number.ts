// Document numbering.
//
// ── THE DECISION: GAP-FREE, AND IT IS NOT A PREFERENCE ──────────────────
//
// Icelandic law requires sales invoices "fyrirfram tölusett með áprentuð
// númer í samfelldri töluröð" — pre-numbered, printed numbers, in an UNBROKEN
// sequence — and explicitly says numbering generated only at print time by a
// computer does not satisfy it. (Skatturinn, Skráning tekna; reg. 50/1993.)
// The seller must also keep a copy in sequence order.
//
// "Samfelld töluröð" settles the gap-free vs gap-tolerant question from
// outside the codebase. See docs/notes/2026-08-18-invoice-delivery-decision.md
// §3.2 for the full citation and the one open question sent to the accountant.
//
// ── WHAT GAP-FREE ACTUALLY FORCES ───────────────────────────────────────
//
// 1. You cannot allocate a number and then decide not to use it. There is no
//    "release" operation, because a released number leaves a hole that cannot
//    be filled later — the documents around it are already in someone else's
//    books.
// 2. A number that gets spent without producing a delivered document must be
//    recorded as VOIDED, in place. Void is not a gap: the sequence still
//    accounts for every number.
// 3. Allocation must commit in the same transaction as the document. This
//    module is pure and cannot enforce that, so it is shaped to make the
//    correct usage the obvious one: `issue()` hands back the next state and
//    the number together, and the caller persists both or neither.
//
// ── WHY YEAR-SCOPED SERIES ARE STILL "SAMFELLD" ─────────────────────────
//
// The sequence key is `series:year` by default. Restarting at 1 each year is
// standard Icelandic practice and keeps each year's series unbroken, which is
// what the requirement asks of a series. `resetOnYearRollover: false` gives a
// single perpetual series for anyone who prefers it. Both are gap-free; the
// flag only decides how many sequences exist.

export interface SequenceConfig {
  /** Tenant scope. FOCUS.md rule 5 — a sequence is never global. */
  orgScope: string;
  /** Human-facing series prefix, e.g. "SV". */
  series: string;
  /** Restart numbering at 1 on 1 January. Default true. */
  resetOnYearRollover?: boolean;
  /** Zero-padding width for the numeric part. Default 6. */
  padWidth?: number;
}

export interface SequenceState {
  readonly config: SequenceConfig;
  /** sequenceKey -> next unissued ordinal. */
  readonly next: Readonly<Record<string, number>>;
  /**
   * idempotencyKey -> the number already allocated for it.
   *
   * This is what makes retry safe. A caller that crashes after allocating and
   * before persisting the document re-enters with the same idempotency key and
   * gets the same number back — no gap, no duplicate.
   */
  readonly allocated: Readonly<Record<string, string>>;
  /** Numbers spent without producing a live document. Recorded, not reclaimed. */
  readonly voided: readonly string[];
}

export interface Allocation {
  readonly state: SequenceState;
  readonly documentNumber: string;
  /** True when this idempotency key had already been allocated. */
  readonly reused: boolean;
}

export function emptySequence(config: SequenceConfig): SequenceState {
  return { config, next: {}, allocated: {}, voided: [] };
}

export function sequenceKey(config: SequenceConfig, year: number): string {
  const reset = config.resetOnYearRollover !== false;
  return reset
    ? `${config.orgScope}:${config.series}:${year}`
    : `${config.orgScope}:${config.series}`;
}

export function formatDocumentNumber(
  config: SequenceConfig,
  year: number,
  ordinal: number,
): string {
  const pad = config.padWidth ?? 6;
  const reset = config.resetOnYearRollover !== false;
  const body = String(ordinal).padStart(pad, "0");
  return reset ? `${config.series}-${year}-${body}` : `${config.series}-${body}`;
}

export interface IssueRequest {
  /**
   * Stable per-document key. Same document, same key, forever.
   *
   * Deriving it from (orgId, period, kind) rather than from a random id is
   * what makes a retried month-end run idempotent instead of duplicating every
   * invoice. The caller owns that derivation; this module only requires that
   * it be stable.
   */
  idempotencyKey: string;
  /** The year the document is issued in. Drives the sequence key. */
  year: number;
}

/**
 * Allocate the next number, or return the one already allocated for this key.
 *
 * PURE. Returns the next state; it does not mutate the input. The caller MUST
 * persist the returned state in the same transaction that persists the
 * document. Persisting the state without the document leaves a spent number
 * that must then be voided; persisting the document without the state
 * duplicates the number on the next run, which is worse.
 */
export function issue(state: SequenceState, req: IssueRequest): Allocation {
  const existing = state.allocated[req.idempotencyKey];
  if (existing !== undefined) {
    return { state, documentNumber: existing, reused: true };
  }
  const key = sequenceKey(state.config, req.year);
  const ordinal = state.next[key] ?? 1;
  const documentNumber = formatDocumentNumber(state.config, req.year, ordinal);
  return {
    state: {
      config: state.config,
      next: { ...state.next, [key]: ordinal + 1 },
      allocated: { ...state.allocated, [req.idempotencyKey]: documentNumber },
      voided: state.voided,
    },
    documentNumber,
    reused: false,
  };
}

/**
 * Record that a number was spent without producing a live document.
 *
 * There is deliberately no `release`. Voiding keeps the sequence unbroken;
 * releasing would break it, and the break is not repairable after the
 * neighbouring documents have been delivered.
 */
export function voidNumber(state: SequenceState, documentNumber: string): SequenceState {
  if (state.voided.includes(documentNumber)) return state;
  return { ...state, voided: [...state.voided, documentNumber] };
}

/**
 * Every ordinal missing from the issued set, per sequence key.
 *
 * Used by the validator and by the tests that prove the gap-free property.
 * A non-empty result is a compliance defect, not a warning.
 */
export function findGaps(
  state: SequenceState,
  issuedNumbers: readonly string[],
): Record<string, number[]> {
  const seen = new Set([...issuedNumbers, ...state.voided]);
  const out: Record<string, number[]> = {};
  for (const [key, nextOrdinal] of Object.entries(state.next)) {
    const parts = key.split(":");
    const year = state.config.resetOnYearRollover !== false ? Number(parts[2]) : NaN;
    const gaps: number[] = [];
    for (let i = 1; i < nextOrdinal; i++) {
      const n = formatDocumentNumber(state.config, year, i);
      if (!seen.has(n)) gaps.push(i);
    }
    if (gaps.length > 0) out[key] = gaps;
  }
  return out;
}
