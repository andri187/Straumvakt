// Immutable terms snapshot (S1 historical terms/payer contract).
//
// PROBLEM (verified): costing selected the effective agreement, clauses, bearer
// rules, rate references and membership "as of the session start", but queried the
// CURRENT rows AFTER the session. Rows can be edited in place or backdated between
// the start and the first costing, so references and timestamps alone do not
// preserve what applied. `rate_references` even has no updated-at to detect it.
//
// CONTRACT: at StartTransaction the engine reads the applicable terms ONCE, as of
// the server start time, and stores them on the transaction row as a content-
// addressed snapshot (sha-256 over canonical JSON). A database trigger (migration
// 0007) refuses any later change to a non-null snapshot. Costing reads ONLY the
// snapshot: editing a rate, clause, rule or membership afterwards - before or
// after costing - cannot change what a started session is priced and attributed
// with. Corrections are new rows that apply to LATER sessions.
//
// What this deliberately does NOT do:
//   - re-evaluate sponsorship or terms mid-session (the adopted cutoff rule keeps an
//     ongoing session's coverage through completion; evaluating wholly at start IS
//     that rule);
//   - invent terms: a session started with no agreement/membership/clauses has a
//     snapshot that says so, and is costed as an explicit unresolved state;
//   - repair history: a transaction with no snapshot (started before this contract)
//     or an unreadable/tampered one is `unresolved_context`, never priced from
//     whatever the tables say today.

import type { AgreementFacts } from "./cost-session";

export const TERMS_SCHEMA = 1 as const;

export type SerializedFacts = {
  installationAgreementId: string | null;
  driverGroup: { id: string; ownerOrgId: string } | null;
  clauses: unknown[];
  rules: unknown[];
  rateReferences: unknown[];
};

export type TermsSnapshot = {
  v: typeof TERMS_SCHEMA;
  /** The server time the terms were evaluated AS OF (the session's start). */
  at: string;
  /** When the snapshot was written. */
  capturedAt: string;
  /** captured = the lookup ran (its facts may still say "no agreement"); missing = the lookup could not run. */
  status: "captured" | "missing";
  reason?: string;
  facts?: SerializedFacts;
  sha256: string;
};

const DATE_KEYS = new Set(["effectiveFrom", "effectiveUntil"]);

/** Dates -> ISO strings and bigint -> decimal strings, recursively, with stable shape. */
function toJson(v: unknown, key = ""): unknown {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "bigint") return `$bigint:${v}`;
  if (Array.isArray(v)) return v.map((x) => toJson(x));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, toJson(x, k)]));
  void key;
  return v;
}

function fromJson(v: unknown, key = ""): unknown {
  if (typeof v === "string" && /^\$bigint:-?\d+$/.test(v)) return BigInt(v.slice(8));
  if (typeof v === "string" && DATE_KEYS.has(key)) return new Date(v);
  if (Array.isArray(v)) return v.map((x) => fromJson(x));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, fromJson(x, k)]));
  return v;
}

export function canonical(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(",")}}`;
}

async function sha256Hex(text: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function buildSnapshot(input: { facts: AgreementFacts | null; at: Date; capturedAt: Date; missingReason?: string }): Promise<TermsSnapshot> {
  const body = input.facts
    ? { v: TERMS_SCHEMA as typeof TERMS_SCHEMA, at: input.at.toISOString(), status: "captured" as const, facts: toJson(input.facts) as SerializedFacts }
    : { v: TERMS_SCHEMA as typeof TERMS_SCHEMA, at: input.at.toISOString(), status: "missing" as const, reason: input.missingReason ?? "not_captured" };
  return { ...body, capturedAt: input.capturedAt.toISOString(), sha256: await sha256Hex(canonical(body)) };
}

export type Revived =
  | { ok: true; status: "captured"; facts: AgreementFacts; at: Date; sha256: string }
  | { ok: true; status: "missing"; reason: string; sha256: string }
  | { ok: false; reason: "not_captured" | "unknown_schema" | "tampered" };

export async function reviveSnapshot(raw: unknown): Promise<Revived> {
  if (raw === null || raw === undefined) return { ok: false, reason: "not_captured" };
  const s = raw as Partial<TermsSnapshot>;
  if (!s || typeof s !== "object" || s.v !== TERMS_SCHEMA || typeof s.sha256 !== "string" || typeof s.at !== "string") return { ok: false, reason: "unknown_schema" };
  const body = s.status === "captured" ? { v: s.v, at: s.at, status: s.status, facts: s.facts } : { v: s.v, at: s.at, status: s.status, reason: s.reason };
  if ((await sha256Hex(canonical(body))) !== s.sha256) return { ok: false, reason: "tampered" };
  if (s.status === "missing") return { ok: true, status: "missing", reason: s.reason ?? "not_captured", sha256: s.sha256 };
  if (s.status !== "captured" || !s.facts) return { ok: false, reason: "unknown_schema" };
  return { ok: true, status: "captured", facts: fromJson(s.facts) as AgreementFacts, at: new Date(s.at), sha256: s.sha256 };
}
