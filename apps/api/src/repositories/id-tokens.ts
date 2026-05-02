// IdToken repository — closure item 1 from sprint-03 retro. Wires the
// previously-orphan identity.id_tokens table to a real write path so
// the OCPP Authorize handler (sprint-03 closure item 3) has something
// to look up.
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
//    schema's @unique constraint.
//
// Revocation is soft — status flips to 'revoked' so the row stays for
// audit history. The Authorize handler treats revoked → Blocked.
//
// Scope: this file is closure item 1 work. The token table existed in
// schema since the 2026-05-02 migration; before this commit, no code
// wrote to it. After this commit, every new user has one auto-minted
// token; operators can add more from the user detail page.

import type { PrismaClient, Prisma } from "../generated/prisma/client";
import type {
  IdTokenKind,
  IdTokenStatus,
  IdTokenSummary,
} from "@straumvakt/shared/domain/users";

/**
 * Generate an 8-uppercase-hex RFID UID. Matches MIFARE Classic 4-byte
 * UID format, which is what the existing Dalvegur portal data uses
 * (e.g. "B6432D39", "EE43C609" — though Zaptec also has 14-hex DESFire
 * UIDs in places). 8 hex = 4 bytes = 4.3B combinations; collision
 * probability against a single existing token at our pilot scale is
 * negligible, but we still retry on P2002.
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

/**
 * Create an IdToken. If `value` is omitted AND `kind === 'rfid'`, mint
 * a fresh UID. On unique-constraint collision (P2002), retry with a
 * fresh mint up to 5 times before giving up — at our scale a real
 * collision is vanishingly unlikely, but we don't want to surface a
 * confusing 500 to the operator if it ever happens.
 *
 * Caller may use this either inside an existing transaction (pass
 * `tx`) or against the standalone client. The signature accepts any
 * Prisma-shaped client.
 */
export async function createIdToken(
  db: PrismaClient | Prisma.TransactionClient,
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

  // Manual value → single insert; surface P2002 to the caller.
  if (provided !== undefined) {
    const created = (await db.idToken.create({
      data: buildData(input, provided),
    })) as IdTokenRow;
    return toSummary(created);
  }

  // No value AND not rfid → can't auto-mint; require explicit value.
  if (input.kind !== "rfid") {
    throw new Error(
      `idtoken.value: required for kind '${input.kind}' (auto-mint only supports rfid)`,
    );
  }

  // Auto-mint with retry on collision.
  const MAX_ATTEMPTS = 5;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const candidate = mintRfidValue();
    try {
      const created = (await db.idToken.create({
        data: buildData(input, candidate),
      })) as IdTokenRow;
      return toSummary(created);
    } catch (err) {
      // Prisma P2002 on the @unique constraint on `value`.
      if (
        attempt < MAX_ATTEMPTS - 1 &&
        err instanceof Error &&
        err.message.includes("Unique constraint")
      ) {
        continue;
      }
      throw err;
    }
  }
  throw new Error("idtoken.mint: collided 5 times in a row — investigate");
}

function buildData(
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
): Prisma.IdTokenUncheckedCreateInput {
  return {
    userId: input.userId,
    kind: input.kind,
    value,
    label: input.label ?? null,
    vendorIssuedBy: input.vendorIssuedBy ?? null,
    vendorTokenId: input.vendorTokenId ?? null,
    expiresAt: input.expiresAt ?? null,
    scopeInstallationId: input.scopeInstallationId ?? null,
  };
}

export async function listIdTokensForUser(
  db: PrismaClient,
  userId: string,
): Promise<IdTokenSummary[]> {
  const rows = (await db.idToken.findMany({
    where: { userId },
    orderBy: [{ createdAt: "asc" }],
  })) as IdTokenRow[];
  return rows.map(toSummary);
}

/**
 * Soft-revoke. Row stays for audit; status flips to 'revoked' so the
 * Authorize handler returns Blocked. Idempotent — revoking an already-
 * revoked token is a no-op.
 */
export async function revokeIdToken(
  db: PrismaClient,
  tokenId: string,
): Promise<IdTokenSummary> {
  const row = (await db.idToken.update({
    where: { id: tokenId },
    data: { status: "revoked" },
  })) as IdTokenRow;
  return toSummary(row);
}

export async function getIdTokenById(
  db: PrismaClient,
  tokenId: string,
): Promise<IdTokenSummary | null> {
  const row = (await db.idToken.findUnique({
    where: { id: tokenId },
  })) as IdTokenRow | null;
  return row ? toSummary(row) : null;
}
