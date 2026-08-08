// Money lines — whose money is moving, and what Straumvakt's role is on it.
//
// ── WHY THIS IS A SHAPE AND NOT TWO CONSTANTS ───────────────────────────
//
// The market phase has two money lines and it is tempting to hardcode them:
// "the host↔driver one" and "the platform-fee one". That is the mistake this
// file exists to prevent. The parked lines — Straumvakt↔individual driver,
// agent lines for a retailer or a contractor — have the same structure and
// differ only in the three fields below. Hardcoding two cases means a third
// arrives as a schema change instead of a row.
//
// ── WHY THE DISTINCTION IS LOAD-BEARING ─────────────────────────────────
//
// Money we merely PRESENT carries obligations money we EARN does not: VAT
// posture, remittance, and whose name is on the claim all differ. The invoice
// header is the legal artefact — an Icelandic claim names a kröfuhafi, and
// getting it wrong is not a cosmetic bug.
//
// TYPES ONLY. No math, no resolution, no rates. Cost computation is Rule 5
// and lives in the commercial module, harvested in a later, gated pass.
//
// Lineage: legacy ADR 0031 Q2.1 + its 2026-06-14 amendment (agent posture,
// host is principal on driver-facing money); FOCUS.md rule 3.

/**
 * A party on a money line.
 *
 * Deliberately a discriminated union rather than a bare id: an individual
 * driver is not an organisation, and "Straumvakt" is not a row anyone should
 * have to look up to reason about a line. The parked
 * Straumvakt↔individual-driver line needs `user`, which is why it is here now
 * rather than added later.
 */
export type PartyRef =
  | { kind: "org"; orgId: string }
  | { kind: "user"; userId: string }
  | { kind: "platform" };

/**
 * Straumvakt's role on a line.
 *
 * - `principal` — Straumvakt earns this. Its own name is on the claim.
 * - `agent`     — Straumvakt presents someone else's claim and remits.
 *                 The claim names the earning party.
 */
export type MoneyPosture = "agent" | "principal";

/**
 * One money line.
 *
 * `whoseMoney` is the party that EARNS the revenue — not the one that
 * collects it, and not the one that issues the document. When `posture` is
 * `agent` those three differ, which is the entire reason this type exists.
 */
export interface MoneyLine {
  /** The party whose revenue this is. */
  whoseMoney: PartyRef;
  /** Straumvakt's role. */
  posture: MoneyPosture;
  /** The party being billed. */
  counterparty: PartyRef;
}

/**
 * Who the claim is held by — the kröfuhafi.
 *
 * Always the earning party. On an agent line the document is rendered
 * "Straumvakt f.h. &lt;party&gt;"; on a principal line it is Straumvakt's own
 * claim. Derived rather than stored so the two can never disagree.
 */
export function claimHolder(line: MoneyLine): PartyRef {
  return line.whoseMoney;
}

/** True when Straumvakt is presenting money it does not earn. */
export function isOnBehalfOf(line: MoneyLine): boolean {
  return line.posture === "agent";
}

/**
 * The lines the platform knows about, as data.
 *
 * Descriptive, not prescriptive — a catalogue for reasoning and for naming
 * things in the UI. A line's ACTUAL parties come from the agreement; this is
 * the shape each one takes, and whether it is live for market.
 *
 * `status` is deliberately here: "which of these can I bill today" is a
 * question the codebase should be able to answer without reading FOCUS.md.
 */
export type MoneyLineKind =
  /** Host earns; driver pays; Straumvakt presents and remits. */
  | "host_to_driver"
  /** Straumvakt earns; host pays. The flat connector fee — the market line. */
  | "platform_to_host"
  /** Straumvakt earns; an individual driver pays directly. Parked. */
  | "platform_to_individual"
  /** A retailer or DSO earns; Straumvakt presents. Parked. */
  | "supplier_to_payer"
  /** Straumvakt earns; a contractor pays (legacy ADR 0034). Parked. */
  | "platform_to_contractor";

export interface MoneyLineDescriptor {
  kind: MoneyLineKind;
  posture: MoneyPosture;
  /** Live for the market phase, or parked. */
  status: "live" | "parked";
  /** One line, for humans reading a UI or a log. */
  note: string;
}

export const MONEY_LINES: readonly MoneyLineDescriptor[] = [
  {
    kind: "platform_to_host",
    posture: "principal",
    status: "live",
    note: "Flat connector fee. Straumvakt's own revenue, billed per connector to the org — needs no driver attribution, which is why it ships first.",
  },
  {
    kind: "host_to_driver",
    posture: "agent",
    status: "parked",
    note: "The host's revenue. Straumvakt presents the claim on their behalf and remits. Un-parked by attribution, immediately after the first invoice.",
  },
  {
    kind: "platform_to_individual",
    posture: "principal",
    status: "parked",
    note: "Straumvakt billing an individual driver directly, with no host in between.",
  },
  {
    kind: "supplier_to_payer",
    posture: "agent",
    status: "parked",
    note: "A retailer's energy price or a DSO's distribution tariff, presented through the same engine. Every rate arrives as an agreement, never as a special case.",
  },
  {
    kind: "platform_to_contractor",
    posture: "principal",
    status: "parked",
    note: "Straumvakt bills a contractor for work created for them on the platform (legacy ADR 0034).",
  },
] as const;
