// Who a CDR's money belongs to — decided once, in the open, and never guessed.
//
// ── THE HOLE THIS CLOSES ─────────────────────────────────────────────────
//
// The Zaptec CDR import resolved a driver like this:
//
//     const candidates = [z.UserId, z.TokenName, z.UserUserName, z.UserEmail]
//     const idToken = await tx.idToken.findFirst({
//       where: { value: { in: candidates }, status: "active" },
//       select: { userId: true },
//     })
//
// `identity.orgId` — the org that owns the charger the session happened on —
// was already in scope four lines above, and was not used. The resolved
// `userId` then went straight onto charging.sessions.user_id and
// reports.session_ledger.driver_user_id, which is what an invoice is built
// from. So a token belonging to one org's driver, matched at another org's
// charger, attributes that charge — and its money — to a stranger.
//
// ── WHAT THE SCHEMA ACTUALLY ALLOWS, WHICH IS NOT WHAT WAS ASSUMED ───────
//
// The 2026-08-11 census recorded this as "a token collision across tenants
// bills a foreign driver". Measured against the schema on 2026-08-18, that is
// not the reachable failure: `identity.id_tokens.value` is **globally UNIQUE**
// (identity.prisma:220), so two orgs cannot hold the same value and a
// collision cannot occur. The table also has **no `org_id` column at all**, so
// there is no org-scoped lookup to write — the sole narrowing column is the
// optional `scope_installation_id`.
//
// The reachable failure is worse than a collision, because it needs no
// coincidence: the lookup has no membership check, so ANY active token in the
// entire database matches at ANY charger. And three of the four candidates are
// free-text vendor profile fields — a username or an e-mail address matched
// against a column that holds OCPP idTags. `findFirst` over `value IN (...)`
// then returns whichever row Postgres reaches first, so with two candidates
// hitting two different users the attribution is not merely wrong, it is
// non-deterministic between runs of the same import.
//
// ── THE RULE ─────────────────────────────────────────────────────────────
//
// A CDR is attributed to a driver only when ALL of these hold:
//
//   1. exactly one candidate identifier matches a token, or several match but
//      all resolve to the SAME user — otherwise the CDR is unattributed;
//   2. the token is usable — active status, not past its expiry;
//   3. the token's user is a member of the org that owns the charger.
//
// Otherwise the session is recorded UNATTRIBUTED with a named reason. That is
// not a failure state: it is the state ADR 0049's amendment already describes
// for sessions predating Authorize, which are structurally unattributable and
// must never be surfaced as errors. Being unattributed costs an operator one
// manual assignment; being attributed to the wrong driver bills a stranger and
// is discovered, if ever, by the stranger.
//
// The module is pure. It performs no I/O so the whole decision table can be
// tested without a database, and so the rule can be read in one screen.

/** Which vendor field an identifier came from, strongest first. */
export type CdrCandidateField = "vendor_user_id" | "token_name" | "username" | "email";

/** Priority order. A vendor UUID is stable; an e-mail is a display field the
 *  driver can change, and matching one against an idTag column is already a
 *  stretch. Order decides nothing on its own — it only reports WHICH field
 *  produced an otherwise unanimous match. */
export const CDR_CANDIDATE_PRIORITY: readonly CdrCandidateField[] = [
  "vendor_user_id",
  "token_name",
  "username",
  "email",
];

export interface CdrCandidate {
  field: CdrCandidateField;
  value: string;
}

/** The subset of identity.id_tokens this decision needs. */
export interface CdrTokenRow {
  value: string;
  userId: string;
  status: string;
  expiresAt: Date | null;
}

/** A (userId, orgId) pair from identity.memberships. */
export interface CdrMembership {
  userId: string;
  orgId: string;
}

export type CdrUnattributedReason =
  /** The vendor sent no usable identifier. Pre-Authorize historical sessions
   *  land here and are NOT errors — see ADR 0049's amendment. */
  | "no_candidates"
  /** Identifiers were present; none matches a token we hold. */
  | "no_matching_token"
  /** The matching token exists but is revoked, blocked or expired. */
  | "token_not_usable"
  /** Two candidates matched two different users. Never pick one. */
  | "ambiguous_candidates"
  /** The token's owner is not a member of the org that owns the charger. */
  | "driver_outside_charger_org";

export type CdrDriverResolution =
  | { kind: "attributed"; userId: string; matchedOn: CdrCandidateField }
  | { kind: "unattributed"; reason: CdrUnattributedReason };

export interface CdrDriverResolutionInput {
  /** The org that owns the charger the session physically happened on. */
  chargerOrgId: string;
  candidates: readonly CdrCandidate[];
  /** Token rows already fetched for those candidate values. */
  tokens: readonly CdrTokenRow[];
  /** Memberships of the candidate users, in ANY org — the function decides
   *  which ones count, so the caller cannot accidentally pre-filter the check
   *  away. */
  memberships: readonly CdrMembership[];
  /** Evaluation time, injected so expiry is testable. */
  now: Date;
}

function tokenIsUsable(token: CdrTokenRow, now: Date): boolean {
  if (token.status !== "active") return false;
  if (token.expiresAt !== null && token.expiresAt.getTime() <= now.getTime()) return false;
  return true;
}

/**
 * Decide who a CDR belongs to, or refuse.
 *
 * @throws when `chargerOrgId` is empty — a caller that does not know which org
 * owns the charger cannot be allowed to fall back to an unscoped match, which
 * is precisely the behaviour being removed. Missing org context is a broken
 * caller, not an unattributable session, so it fails loudly rather than
 * quietly producing an unattributed row that looks routine.
 */
export function resolveCdrDriver(input: CdrDriverResolutionInput): CdrDriverResolution {
  if (!input.chargerOrgId) {
    throw new Error("cdr_driver_resolution_requires_charger_org");
  }

  if (input.candidates.length === 0) {
    return { kind: "unattributed", reason: "no_candidates" };
  }

  // Keyed to a LIST, not to a row. A Map<string, CdrTokenRow> would let a
  // later row overwrite an earlier one with the same value, silently
  // discarding the exact ambiguity this function exists to detect — and
  // `value` being UNIQUE today is a property of the current schema, not an
  // invariant this decision may lean on.
  const byValue = new Map<string, CdrTokenRow[]>();
  for (const t of input.tokens) {
    const bucket = byValue.get(t.value);
    if (bucket) bucket.push(t);
    else byValue.set(t.value, [t]);
  }

  // Walk candidates in priority order, collecting every distinct user any of
  // them resolves to. Collect ALL of them before deciding: stopping at the
  // first hit is how a non-deterministic `findFirst` becomes a deterministic
  // wrong answer, which is not an improvement.
  const ordered = [...input.candidates].sort(
    (a, b) =>
      CDR_CANDIDATE_PRIORITY.indexOf(a.field) - CDR_CANDIDATE_PRIORITY.indexOf(b.field),
  );

  const matched: Array<{ field: CdrCandidateField; token: CdrTokenRow }> = [];
  for (const c of ordered) {
    for (const token of byValue.get(c.value) ?? []) {
      matched.push({ field: c.field, token });
    }
  }

  if (matched.length === 0) {
    return { kind: "unattributed", reason: "no_matching_token" };
  }

  const distinctUsers = new Set(matched.map((m) => m.token.userId));
  if (distinctUsers.size > 1) {
    // Two identifiers on one CDR pointing at two people. One of them is
    // wrong and nothing here can say which.
    return { kind: "unattributed", reason: "ambiguous_candidates" };
  }

  const usable = matched.find((m) => tokenIsUsable(m.token, input.now));
  if (!usable) {
    return { kind: "unattributed", reason: "token_not_usable" };
  }

  const userId = usable.token.userId;
  const isMember = input.memberships.some(
    (m) => m.userId === userId && m.orgId === input.chargerOrgId,
  );
  if (!isMember) {
    // The token is real, active and belongs to a real driver — just not one
    // this host has any relationship with. Attributing here is exactly the
    // cross-tenant billing this module exists to prevent.
    return { kind: "unattributed", reason: "driver_outside_charger_org" };
  }

  return { kind: "attributed", userId, matchedOn: usable.field };
}

/**
 * Build the candidate list from the vendor's fields, dropping blanks.
 *
 * Separate from the decision so the caller cannot smuggle an extra identifier
 * in, and so "which vendor fields are we willing to treat as identity?" is one
 * reviewable list rather than an inline array literal in a 500-line importer.
 */
export function cdrCandidatesFromVendorFields(fields: {
  vendorUserId?: string | null;
  tokenName?: string | null;
  username?: string | null;
  email?: string | null;
}): CdrCandidate[] {
  const out: CdrCandidate[] = [];
  const push = (field: CdrCandidateField, value: string | null | undefined) => {
    const v = value?.trim();
    if (v) out.push({ field, value: v });
  };
  push("vendor_user_id", fields.vendorUserId);
  push("token_name", fields.tokenName);
  push("username", fields.username);
  push("email", fields.email);
  return out;
}
