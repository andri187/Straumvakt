// UserToken repository — one-shot, time-boxed authentication
// artefacts (Sprint 5.6 / ADR 0017).
//
// Three operations:
//
//   • createUserToken — generate plaintext, hash it, persist the
//     hash + metadata, return plaintext ONCE for the caller to
//     embed in a link. Plaintext is never persisted.
//
//   • consumeUserToken — look up by hash, verify not expired and
//     not already used, atomically mark used, return user + meta.
//     Each token is genuinely one-shot — concurrent consume calls
//     race; the loser sees `usedAt != null` and gets rejected.
//
//   • revokeUserToken — set used_at to now without checking expiry.
//     Idempotent. Used by the inviter to cancel an outstanding
//     invite they decided shouldn't go through.
//
// The plaintext shape is 32 chars from a 32-char Crockford-style
// alphabet (a–z minus l/o + 2–9), giving ~160 bits of entropy. URL-
// safe, no ambiguous glyphs (since invite links may be transcribed
// from email/SMS by hand on mobile when the recipient doesn't get
// auto-link rendering).

import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { userTokens } from "@straumvakt/shared/db/identity";
import type { Db } from "../lib/drizzle";
import { sha256Hex } from "../lib/sha256";

/** The client or a transaction handle — createUserToken is called inside one. */
type DbOrTx = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

const TOKEN_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";

function generateTokenPlaintext(): string {
  // 32 bytes → 32 chars (5 bits per char, no modulo bias since
  // alphabet length is exactly 32). 32 × 5 = 160 bits of entropy.
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += TOKEN_ALPHABET[bytes[i] & 0x1f];
  }
  return out;
}

export type UserTokenKind = "invite" | "magic_link" | "password_reset";

export interface CreateUserTokenInput {
  userId: string;
  kind: UserTokenKind;
  ttlMinutes: number;
  createdById?: string | null;
  metadata?: Record<string, unknown>;
}

export interface CreateUserTokenResult {
  id: string;
  /** Plaintext returned ONCE — never persisted. Caller must capture. */
  plaintext: string;
  expiresAt: Date;
}

export async function createUserToken(
  db: DbOrTx,
  input: CreateUserTokenInput,
): Promise<CreateUserTokenResult> {
  if (input.ttlMinutes <= 0) {
    throw new Error("ttl_minutes_must_be_positive");
  }
  const plaintext = generateTokenPlaintext();
  const tokenHash = await sha256Hex(plaintext);
  const expiresAt = new Date(Date.now() + input.ttlMinutes * 60_000);

  const [row] = await db
    .insert(userTokens)
    .values({
      userId: input.userId,
      kind: input.kind,
      tokenHash,
      expiresAt,
      createdById: input.createdById ?? null,
      metadata: input.metadata ?? {},
    })
    .returning({ id: userTokens.id, expiresAt: userTokens.expiresAt });

  return { id: row!.id, plaintext, expiresAt: row!.expiresAt };
}

export type ConsumeUserTokenOutcome =
  | {
      ok: true;
      tokenId: string;
      userId: string;
      kind: UserTokenKind;
      metadata: Record<string, unknown>;
    }
  | { ok: false; reason: "not_found" | "expired" | "already_used" | "wrong_kind" };

/**
 * Atomic consume: verify not expired + not used, then mark used.
 * The marker write is conditional on `usedAt IS NULL` so concurrent
 * consume attempts on the same plaintext are safe — only one wins.
 *
 * Pass `expectedKind` to bind a token's intended use site (e.g. an
 * invite-consume route should refuse a `magic_link` token even if
 * its plaintext somehow lands there).
 */
export async function consumeUserToken(
  db: Db,
  plaintext: string,
  expectedKind: UserTokenKind,
): Promise<ConsumeUserTokenOutcome> {
  const tokenHash = await sha256Hex(plaintext);
  const [row] = await db
    .select({
      id: userTokens.id,
      userId: userTokens.userId,
      kind: userTokens.kind,
      expiresAt: userTokens.expiresAt,
      usedAt: userTokens.usedAt,
      metadata: userTokens.metadata,
    })
    .from(userTokens)
    .where(eq(userTokens.tokenHash, tokenHash))
    .limit(1);
  if (!row) return { ok: false, reason: "not_found" };
  if (row.kind !== expectedKind) return { ok: false, reason: "wrong_kind" };
  if (row.usedAt !== null) return { ok: false, reason: "already_used" };
  if (row.expiresAt.getTime() <= Date.now()) {
    return { ok: false, reason: "expired" };
  }

  // Conditional update — only set used_at if it's still null. If
  // a concurrent consumer raced and won, our updateMany returns
  // count=0 and we report already_used. Postgres's row-level lock
  // ordering makes the race resolution deterministic.
  // Prisma's updateMany returned { count }. Drizzle has none on a plain
  // UPDATE, so RETURNING the id makes the claim observable — an empty array
  // IS "someone else won the race". The conditional itself is unchanged and
  // is still what makes the token one-shot.
  const claimed = await db
    .update(userTokens)
    .set({ usedAt: new Date() })
    .where(and(eq(userTokens.id, row.id), isNull(userTokens.usedAt)))
    .returning({ id: userTokens.id });
  if (claimed.length === 0) {
    return { ok: false, reason: "already_used" };
  }

  return {
    ok: true,
    tokenId: row.id,
    userId: row.userId,
    kind: row.kind as UserTokenKind,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
  };
}

/**
 * Mark a token used without consuming. Used by the inviter to
 * cancel an outstanding invite. Idempotent — re-revoking a token
 * that's already used returns silently.
 */
export async function revokeUserToken(
  db: Db,
  tokenId: string,
): Promise<{ revoked: boolean }> {
  const result = await db
    .update(userTokens)
    .set({ usedAt: new Date() })
    .where(and(eq(userTokens.id, tokenId), isNull(userTokens.usedAt)))
    .returning({ id: userTokens.id });
  return { revoked: result.length > 0 };
}

/**
 * Operator-side listing: outstanding tokens for a user (or all
 * users if userId omitted), filtered by kind. Used by the
 * /invites admin page in Sprint 5.7 to surface pending invites
 * with their expiry + creation timestamps.
 */
export async function listOutstandingUserTokens(
  db: Db,
  filter: { userId?: string; kind?: UserTokenKind },
): Promise<
  Array<{
    id: string;
    userId: string;
    kind: UserTokenKind;
    expiresAt: Date;
    createdAt: Date;
    createdById: string | null;
    metadata: Record<string, unknown>;
  }>
> {
  // Prisma dropped `where` keys that were undefined; Drizzle needs them
  // filtered out explicitly or `eq(col, undefined)` becomes invalid SQL.
  const conditions = [isNull(userTokens.usedAt), gt(userTokens.expiresAt, new Date())];
  if (filter.userId !== undefined) conditions.push(eq(userTokens.userId, filter.userId));
  if (filter.kind !== undefined) conditions.push(eq(userTokens.kind, filter.kind));

  const rows = await db
    .select({
      id: userTokens.id,
      userId: userTokens.userId,
      kind: userTokens.kind,
      expiresAt: userTokens.expiresAt,
      createdAt: userTokens.createdAt,
      createdById: userTokens.createdById,
      metadata: userTokens.metadata,
    })
    .from(userTokens)
    .where(and(...conditions))
    .orderBy(desc(userTokens.createdAt));
  return rows.map((r) => ({
    id: r.id,
    userId: r.userId,
    kind: r.kind as UserTokenKind,
    expiresAt: r.expiresAt,
    createdAt: r.createdAt,
    createdById: r.createdById,
    metadata: (r.metadata ?? {}) as Record<string, unknown>,
  }));
}
