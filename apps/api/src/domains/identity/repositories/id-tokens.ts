// IdToken repository — identity.id_tokens. Drizzle.
//
// Moved from src/repositories/id-tokens.ts and ported from Prisma in the same
// commit. Behaviour is unchanged; the notes below are the original ones and
// still apply.
//
// Two creation paths:
//
// 1. **Auto-mint on user create.** Every new User gets one primary
//    rfid token whose value is system-generated. The operator can
//    then program a physical card with that UID, or use it as a
//    virtual idTag. Per the 2026-05-02 conversation: "upon user
//    creation, a UID RFID should be created by Straumvakt for that
//    user."
//
// 2. **Manual add via admin form.** Operators add tokens for users
//    who already have physical cards. The value is the card's
//    factory UID (8 hex chars for MIFARE Classic, 14 for DESFire,
//    etc.). We accept any non-empty string and just enforce the
//    schema's unique constraint.
//
// Revocation is soft — status flips to 'revoked' so the row stays for
// audit history. The Authorize handler treats revoked → Blocked.

import { asc, eq, notExists, sql } from "drizzle-orm";
import type {
  IdTokenKind,
  IdTokenStatus,
  IdTokenSummary,
} from "@straumvakt/shared/domain/users";
import type { Db } from "../../../lib/drizzle";
import { idTokens, users } from "../schema";
import { RecordNotFoundError, UniqueViolationError, isUniqueViolation } from "./errors";

/** Anything that can run a statement: the client or a transaction handle. */
export type DbOrTx = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * Generate an 8-uppercase-hex RFID UID. Matches MIFARE Classic 4-byte
 * UID format, which is what the existing Dalvegur portal data uses
 * (e.g. "B6432D39", "EE43C609" — though Zaptec also has 14-hex DESFire
 * UIDs in places). 8 hex = 4 bytes = 4.3B combinations; collision
 * probability against a single existing token at our pilot scale is
 * negligible, but we still retry on a unique violation.
 *
 * Uses crypto.getRandomValues — available in Cloudflare Workers, Node
 * 20+, modern browsers. No fallback because all our targets have it.
 */
export function mintRfidValue(): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).toUpperCase().padStart(2, "0"))
    .join("");
}

interface IdTokenRow {
  id: string;
  userId: string;
  kind: IdTokenKind;
  value: string;
  vendorIssuedBy: string | null;
  vendorTokenId: string | null;
  label: string | null;
  status: IdTokenStatus;
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  scopeInstallationId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function toSummary(row: IdTokenRow): IdTokenSummary {
  return {
    id: row.id,
    userId: row.userId,
    kind: row.kind,
    value: row.value,
    vendorIssuedBy: row.vendorIssuedBy,
    vendorTokenId: row.vendorTokenId,
    label: row.label,
    status: row.status,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    scopeInstallationId: row.scopeInstallationId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** The columns the summary needs, and only those. Prisma's `findMany` with no
 *  `select` returned every column; the mapper used thirteen of them. */
const SUMMARY_COLUMNS = {
  id: idTokens.id,
  userId: idTokens.userId,
  kind: idTokens.kind,
  value: idTokens.value,
  vendorIssuedBy: idTokens.vendorIssuedBy,
  vendorTokenId: idTokens.vendorTokenId,
  label: idTokens.label,
  status: idTokens.status,
  expiresAt: idTokens.expiresAt,
  lastUsedAt: idTokens.lastUsedAt,
  scopeInstallationId: idTokens.scopeInstallationId,
  createdAt: idTokens.createdAt,
  updatedAt: idTokens.updatedAt,
} as const;

/**
 * Create an IdToken. If `value` is omitted AND `kind === 'rfid'`, mint
 * a fresh UID. On unique-constraint collision, retry with a fresh mint
 * up to 5 times before giving up — at our scale a real collision is
 * vanishingly unlikely, but we don't want to surface a confusing 500 to
 * the operator if it ever happens.
 *
 * Caller may use this either inside an existing transaction or against
 * the standalone client.
 */
export async function createIdToken(
  db: DbOrTx,
  input: {
    userId: string;
    kind: IdTokenKind;
    value?: string;
    label?: string;
    vendorIssuedBy?: string;
    vendorTokenId?: string;
    expiresAt?: Date;
    scopeInstallationId?: string;
  },
): Promise<IdTokenSummary> {
  const provided = input.value?.trim();
  if (provided !== undefined && provided.length === 0) {
    throw new Error("idtoken.value: empty string not allowed");
  }

  // Manual value → single insert; surface the conflict to the caller.
  if (provided !== undefined) {
    return toSummary(await insertOne(db, input, provided));
  }

  // No value AND not rfid → can't auto-mint; require explicit value.
  if (input.kind !== "rfid") {
    throw new Error(
      `idtoken.value: required for kind '${input.kind}' (auto-mint only supports rfid)`,
    );
  }

  const MAX_ATTEMPTS = 5;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      return toSummary(await insertOne(db, input, mintRfidValue()));
    } catch (err) {
      if (attempt < MAX_ATTEMPTS - 1 && err instanceof UniqueViolationError) continue;
      throw err;
    }
  }
  throw new Error("idtoken.mint: collided 5 times in a row — investigate");
}

async function insertOne(
  db: DbOrTx,
  input: {
    userId: string;
    kind: IdTokenKind;
    label?: string;
    vendorIssuedBy?: string;
    vendorTokenId?: string;
    expiresAt?: Date;
    scopeInstallationId?: string;
  },
  value: string,
): Promise<IdTokenRow> {
  try {
    const [row] = await db
      .insert(idTokens)
      .values({
        userId: input.userId,
        kind: input.kind,
        value,
        label: input.label ?? null,
        vendorIssuedBy: input.vendorIssuedBy ?? null,
        vendorTokenId: input.vendorTokenId ?? null,
        expiresAt: input.expiresAt ?? null,
        scopeInstallationId: input.scopeInstallationId ?? null,
        // id, created_at and updated_at come from the column declarations in
        // ../schema.ts — id and updated_at client-side, created_at from the
        // database. The split is not uniform; the header there explains it.
      })
      .returning(SUMMARY_COLUMNS);
    return row as IdTokenRow;
  } catch (err) {
    if (isUniqueViolation(err)) throw new UniqueViolationError(err.constraint, err);
    throw err;
  }
}

export async function listIdTokensForUser(
  db: Db,
  userId: string,
): Promise<IdTokenSummary[]> {
  const rows = (await db
    .select(SUMMARY_COLUMNS)
    .from(idTokens)
    .where(eq(idTokens.userId, userId))
    .orderBy(asc(idTokens.createdAt))) as IdTokenRow[];

  // The system-issued virtual_rfid sorts first, whatever its created_at.
  //
  // It is the credential every driver is meant to have from the moment
  // the account exists — the app's identity at a charge point. Cards,
  // EVCCIDs and proxy tokens are additions to it. Ordering by
  // created_at alone buries it for any driver whose card was enrolled
  // first, which is every driver predating automatic issuance.
  //
  // A driver has at most one virtual_rfid, so this is a stable partition
  // rather than a sort key: the vRFID, then everything else in
  // enrolment order.
  const virtual = rows.filter((r) => r.kind === "virtual_rfid");
  const rest = rows.filter((r) => r.kind !== "virtual_rfid");
  return [...virtual, ...rest].map(toSummary);
}

/**
 * Soft-revoke. Row stays for audit; status flips to 'revoked' so the
 * Authorize handler returns Blocked. Idempotent — revoking an already-
 * revoked token is a no-op.
 */
export async function revokeIdToken(db: Db, tokenId: string): Promise<IdTokenSummary> {
  const [row] = await db
    .update(idTokens)
    .set({ status: "revoked" })
    .where(eq(idTokens.id, tokenId))
    .returning(SUMMARY_COLUMNS);
  if (!row) throw new RecordNotFoundError(`id_token ${tokenId}`);
  return toSummary(row as IdTokenRow);
}

export async function getIdTokenById(db: Db, tokenId: string): Promise<IdTokenSummary | null> {
  const [row] = await db
    .select(SUMMARY_COLUMNS)
    .from(idTokens)
    .where(eq(idTokens.id, tokenId))
    .limit(1);
  return row ? toSummary(row as IdTokenRow) : null;
}

/**
 * Hard delete — physically removes the row. Loses audit history.
 * Distinct from `revokeIdToken` (soft, status='revoked', row preserved).
 *
 * Raises the driver's foreign-key error if a FK constraint blocks deletion
 * (e.g. a ChargeSession.idTokenId references this row). The route handler
 * catches that and returns 409 so the operator gets a clear "still
 * referenced — revoke instead" instead of a 500.
 */
export async function hardDeleteIdToken(db: Db, tokenId: string): Promise<void> {
  // DELETE of a row that is not there is a no-op in SQL, where Prisma raised
  // P2025 and the route turned that into a 404. RETURNING makes the
  // difference visible so the 404 survives the port.
  const deleted = await db
    .delete(idTokens)
    .where(eq(idTokens.id, tokenId))
    .returning({ id: idTokens.id });
  if (deleted.length === 0) throw new RecordNotFoundError(`id_token ${tokenId}`);
}

/**
 * Patch the editable subset of an IdToken row. Only fields that don't
 * compromise audit or transfer ownership are exposed:
 *   • value — the OCPP-resolution key. Editing repoints which idTag
 *     authorizes; the UI displays a warning.
 *   • label — cosmetic.
 *   • scopeInstallationId — restricts/widens which install the token
 *     authorizes at (null = global).
 *   • expiresAt — extend or set expiry.
 *
 * Disallowed via this path (need different operator flows):
 *   • userId — token transfer between drivers
 *   • kind — RFID vs eMAID semantics
 *   • status — revoke is a separate operation; hard-delete is too
 *
 * Pass `undefined` to leave a field unchanged. Pass `null` (where
 * permitted) to clear it.
 */
export async function updateIdToken(
  db: Db,
  tokenId: string,
  patch: {
    value?: string;
    label?: string | null;
    scopeInstallationId?: string | null;
    expiresAt?: Date | null;
  },
): Promise<IdTokenSummary> {
  const data: Record<string, unknown> = {};
  if (patch.value !== undefined) {
    const v = patch.value.trim();
    if (v.length === 0) {
      throw new Error("idtoken.value: empty string not allowed");
    }
    data.value = v;
  }
  if (patch.label !== undefined) {
    const l = patch.label?.trim();
    data.label = l && l.length > 0 ? l : null;
  }
  if (patch.scopeInstallationId !== undefined) {
    data.scopeInstallationId = patch.scopeInstallationId;
  }
  if (patch.expiresAt !== undefined) {
    data.expiresAt = patch.expiresAt;
  }

  try {
    const [row] = await db
      .update(idTokens)
      .set(data)
      .where(eq(idTokens.id, tokenId))
      .returning(SUMMARY_COLUMNS);
    if (!row) throw new RecordNotFoundError(`id_token ${tokenId}`);
    return toSummary(row as IdTokenRow);
  } catch (err) {
    if (isUniqueViolation(err)) throw new UniqueViolationError(err.constraint, err);
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────
// One-shot backfill — give pre-existing User rows their primary RFID
// ─────────────────────────────────────────────────────────────────────

export interface BackfillRfidReport {
  /** Users scanned that had zero IdToken rows. */
  scanned: number;
  /** Users for which a new primary RFID was minted. */
  minted: number;
  /** Users where minting threw (DB constraint, etc). */
  errors: number;
  /** Per-user details. Trimmed to the first 100 of each so a large
   *  backfill doesn't return a 5 MB JSON. */
  mintedDetails: Array<{ userId: string; email: string; value: string }>;
  errorDetails: Array<{ userId: string; email: string; error: string }>;
}

/**
 * Find every User row that has zero IdToken rows and mint one primary
 * RFID for them. Idempotent — re-running skips users who now have at
 * least one IdToken (active OR otherwise). The operator runs this
 * once after the closure-item-1 deploy lands so existing users line
 * up with the new "every user has a primary RFID" invariant.
 *
 * Per-user errors are collected, not thrown. A single user failing
 * (a collision against an exotic value, etc) shouldn't abort the whole
 * backfill — the operator can re-run after triage.
 */
export async function backfillPrimaryRfidForUsersWithoutTokens(
  db: Db,
): Promise<BackfillRfidReport> {
  // Prisma expressed this as `idTokens: { none: {} }`, which it compiles to
  // exactly this NOT EXISTS. Kept as a correlated subquery rather than a
  // LEFT JOIN … IS NULL so the planner can stop at the first match.
  const rows = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(
      notExists(
        db.select({ one: sql`1` }).from(idTokens).where(eq(idTokens.userId, users.id)),
      ),
    )
    .orderBy(asc(users.createdAt));

  const mintedDetails: BackfillRfidReport["mintedDetails"] = [];
  const errorDetails: BackfillRfidReport["errorDetails"] = [];

  for (const u of rows) {
    try {
      const token = await createIdToken(db, {
        userId: u.id,
        kind: "rfid",
        label: "Primary (backfill)",
      });
      mintedDetails.push({ userId: u.id, email: u.email, value: token.value });
    } catch (err) {
      errorDetails.push({
        userId: u.id,
        email: u.email,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    scanned: rows.length,
    minted: mintedDetails.length,
    errors: errorDetails.length,
    mintedDetails: mintedDetails.slice(0, 100),
    errorDetails: errorDetails.slice(0, 100),
  };
}
