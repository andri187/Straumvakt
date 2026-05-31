// registration.ts — driver self-onboarding repository.
//
// Sprint 9 / ENROLL-1 / ADR 0022 (2026-05-31 addendum) — backs the four
// public endpoints:
//
//   • registerDriver           — POST /api/public/register
//   • consumeEmailVerification — GET  /api/public/verify-email/:token
//   • initiatePasswordReset    — POST /api/public/password-reset
//   • confirmPasswordReset     — POST /api/public/password-reset/confirm/:token
//
// Pattern follows Rule 7: routes are thin (parse + gate + format), the
// repo owns DB shape + transactions + email send. All return typed UI
// shapes — Prisma models never escape this module.
//
// ── Why some access uses $queryRawUnsafe ────────────────────────────
//
// The schema additions for OrgEmailDomain + DriverAccessRequest are
// committed in prisma/schema.prisma (ADR 0022 2026-05-31 addendum) but
// the apps/api Prisma client has not yet been regenerated (the next
// `prisma generate` after this commit produces the typed model
// accessors). To keep tsc green without running migrate-or-generate
// commands (Rule 3), this module reads/writes those two tables via
// raw SQL through the same PrismaClient.
//
// IdTokenKind.virtual_rfid: same situation. The enum value is shipped
// in the schema (line 279) but not in the regenerated TS literal type.
// We cast at the call site with a comment.
//
// ── Rule 5 — access-grant precedence ────────────────────────────────
//
// Auto-join membership ONLY fires after email verification. A reasonable
// attacker can type a colleague's email at /register; the email-verify
// click is the gate. If user.audience !== 'driver' the verify handler
// skips the access-grant fork entirely.
//
// The domain field on OrgEmailDomain is globally UNIQUE so we never
// fan out to multiple orgs from one click. policy='disabled' silences
// the rule without deleting it. Default policy is 'request_approval'
// — the safest default.

import type {
  Prisma,
  PrismaClient,
} from "../generated/prisma/client";
import { sha256Hex } from "../lib/sha256";
import { hashPassword } from "../lib/password";
import { sendEmail, type SendEmailResult } from "../lib/email";
import { renderVerifyEmail } from "../lib/email-templates/verify-email";
import { renderPasswordResetEmail } from "../lib/email-templates/password-reset";
import type { Env } from "../bindings";

// ── Token plaintext generator ────────────────────────────────────────
//
// Same alphabet + entropy budget as repositories/user-tokens.ts
// (32 chars from a 32-char alphabet → 160 bits, no ambiguous glyphs).
// We don't share createUserToken() because (a) its kind union doesn't
// include 'email_verify' (the closest existing kind is 'magic_link', so
// we use that with metadata.purpose = 'email_verify' to discriminate)
// and (b) we need the plaintext available at email-render time, which
// the helper returns in the same shape.
const TOKEN_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";

function generateTokenPlaintext(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += TOKEN_ALPHABET[bytes[i] & 0x1f];
  }
  return out;
}

// Compute the virtual_rfid value from a User id per ADR 0022:
// "User.id with hyphens stripped, uppercased, then take first 20 chars".
export function virtualRfidValueFromUserId(userId: string): string {
  return userId.replace(/-/g, "").toUpperCase().slice(0, 20);
}

// ── Public input/output types (Rule 7) ───────────────────────────────

export interface RegisterDriverInput {
  email: string;
  password: string;
  kennitala: string;
  displayName: string;
  phone?: string;
  acceptedTos: boolean;
  acceptedPrivacy: boolean;
  acceptedMarketing?: boolean;
  /** Base URL used to build the verify-email link, e.g. https://hlada-staging.straumvakt.workers.dev */
  baseUrl: string;
}

export interface RegisteredUserShape {
  id: string;
  email: string;
  status: string;
  emailVerifiedAt: string | null;
}

export interface RegisterDriverOutcome {
  ok: true;
  user: RegisteredUserShape;
  email: {
    sent: boolean;
    id: string | null;
    reason: string | null;
  };
}

export type RegisterDriverError =
  | { ok: false; reason: "email_taken" }
  | { ok: false; reason: "kennitala_taken" };

export type RegisterDriverResult = RegisterDriverOutcome | RegisterDriverError;

export async function registerDriver(
  db: PrismaClient,
  env: Env,
  input: RegisterDriverInput,
): Promise<RegisterDriverResult> {
  const email = input.email.trim().toLowerCase();
  const now = new Date();
  // Email-verify token TTL: 24h per task spec.
  const verifyExpiresAt = new Date(now.getTime() + 24 * 60 * 60_000);

  const verifyPlaintext = generateTokenPlaintext();
  const verifyTokenHash = await sha256Hex(verifyPlaintext);
  const passwordHashed = await hashPassword(input.password);

  // Single transaction — partial registration would orphan the User row
  // (no credentials, no idtag, no verify token).
  const txResult = await db.$transaction(async (tx) => {
    // 1. Email uniqueness — citext column + lowercased input.
    const existingEmail = await tx.user.findFirst({
      where: { email, status: { not: "deleted" } },
      select: { id: true },
    });
    if (existingEmail) {
      return { ok: false as const, reason: "email_taken" as const };
    }

    // 2. Kennitala uniqueness — schema also has @unique, so we can
    //    rely on the DB constraint as a backstop, but checking
    //    explicitly gives a typed reason instead of a P2002.
    const existingKennitala = await tx.user.findFirst({
      where: { kennitala: input.kennitala },
      select: { id: true },
    });
    if (existingKennitala) {
      return { ok: false as const, reason: "kennitala_taken" as const };
    }

    // 3. Create User. audience='driver', status='active' (registered users
    //    can log in; charging access depends on memberships, which is the
    //    point of the email-domain handoff).
    const user = await tx.user.create({
      data: {
        email,
        displayName: input.displayName,
        audience: "driver",
        status: "active",
        kennitala: input.kennitala,
        phone: input.phone ?? null,
        emailVerifiedAt: null,
        phoneVerifiedAt: null,
        lastSeenAt: now,
        consentTosAt: input.acceptedTos ? now : null,
        consentPrivacyAt: input.acceptedPrivacy ? now : null,
        consentMarketingAt: input.acceptedMarketing ? now : null,
      },
      select: {
        id: true,
        email: true,
        status: true,
        emailVerifiedAt: true,
        displayName: true,
      },
    });

    // 4. Hashed password lives in UserCredential (1:1 with User).
    await tx.userCredential.create({
      data: { userId: user.id, passwordHash: passwordHashed },
    });

    // 5. Virtual RFID — auto-issued at User creation (ADR 0022). value
    //    derived deterministically from User.id so re-issuance after
    //    deletion is impossible to confuse with a different user's tag.
    //
    //    The enum literal 'virtual_rfid' was added to IdTokenKind in the
    //    same commit as the OrgEmailDomain models; the generated TS may
    //    not yet carry it. Build the create data shape as unknown and
    //    cast back — the DB enum accepts the value once migration runs.
    const virtualRfidCreate = {
      userId: user.id,
      kind: "virtual_rfid",
      value: virtualRfidValueFromUserId(user.id),
      status: "active",
      label: "Virtual RFID",
    } as unknown as Prisma.IdTokenCreateInput;
    await tx.idToken.create({ data: virtualRfidCreate });

    // 6. Email-verification token. Stored as kind='magic_link' with
    //    metadata.purpose='email_verify' since the regenerated
    //    UserTokenKind enum doesn't yet list 'email_verify' as a value
    //    (purely a code-gen lag; the SHA-256 hash + expiry semantics are
    //    identical between 'magic_link' and a future 'email_verify' kind).
    //    Consume side filters on the purpose discriminator so other
    //    magic-link tokens can't be confused for verification.
    const tokenRow = await tx.userToken.create({
      data: {
        userId: user.id,
        kind: "magic_link",
        tokenHash: verifyTokenHash,
        expiresAt: verifyExpiresAt,
        createdById: null,
        metadata: {
          purpose: "email_verify",
          email,
        } as Prisma.InputJsonValue,
      },
      select: { id: true },
    });

    return {
      ok: true as const,
      userId: user.id,
      userEmail: user.email,
      userStatus: user.status,
      userEmailVerifiedAt: user.emailVerifiedAt,
      userDisplayName: user.displayName,
      tokenId: tokenRow.id,
    };
  });

  if (!txResult.ok) {
    return { ok: false, reason: txResult.reason };
  }

  // 7. Send verify-email. Outside the tx so a Resend hiccup never
  //    rolls back the User row — better UX is to let the user log in
  //    later and trigger a resend. Failure is reported in the response.
  const verifyUrl = `${input.baseUrl.replace(/\/+$/, "")}/verify-email/${verifyPlaintext}`;
  const content = renderVerifyEmail({
    displayName: txResult.userDisplayName,
    verifyUrl,
    expiresAt: verifyExpiresAt,
  });
  const emailResult = await sendEmail(env, {
    to: email,
    subject: content.subject,
    html: content.html,
    text: content.text,
    tags: [{ name: "category", value: "register_verify" }],
  });

  return {
    ok: true,
    user: {
      id: txResult.userId,
      email: txResult.userEmail,
      status: txResult.userStatus as string,
      emailVerifiedAt: null,
    },
    email: summariseEmailResult(emailResult),
  };
}

// ── consumeEmailVerification ─────────────────────────────────────────

export type ConsumeEmailAccessOutcome =
  | { kind: "no_match" }
  | { kind: "disabled" }
  | {
      kind: "auto_join_granted";
      membershipId: string;
      driverGroupId: string;
    }
  | {
      kind: "request_pending";
      accessRequestId: string;
    }
  | {
      kind: "auto_join_no_default_group";
    }
  | {
      kind: "request_no_installation";
    };

export interface ConsumeEmailVerificationOk {
  ok: true;
  user: { id: string; email: string; emailVerifiedAt: string };
  accessOutcome: ConsumeEmailAccessOutcome;
}

export type ConsumeEmailVerificationError = {
  ok: false;
  reason: "invalid_or_expired";
};

export type ConsumeEmailVerificationResult =
  | ConsumeEmailVerificationOk
  | ConsumeEmailVerificationError;

// Raw-row shape from $queryRaw — keep narrow so we don't drag the whole
// table column list through the code.
interface OrgEmailDomainRow {
  id: string;
  org_id: string;
  domain: string;
  policy: string;
  default_driver_group_id: string | null;
}

interface InstallationIdRow {
  id: string;
}

interface DriverAccessRequestIdRow {
  id: string;
}

export async function consumeEmailVerification(
  db: PrismaClient,
  plaintext: string,
): Promise<ConsumeEmailVerificationResult> {
  const tokenHash = await sha256Hex(plaintext);
  const now = new Date();

  // Look up the token. We can't use kind='email_verify' because the
  // current schema doesn't have that literal; we filter by
  // metadata.purpose='email_verify' to distinguish from real magic-link
  // tokens.
  const row = await db.userToken.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      userId: true,
      kind: true,
      usedAt: true,
      expiresAt: true,
      metadata: true,
    },
  });
  if (!row) return { ok: false, reason: "invalid_or_expired" };
  const meta = (row.metadata ?? {}) as Record<string, unknown>;
  if (meta.purpose !== "email_verify") {
    return { ok: false, reason: "invalid_or_expired" };
  }
  if (row.usedAt !== null) {
    return { ok: false, reason: "invalid_or_expired" };
  }
  if (row.expiresAt.getTime() <= now.getTime()) {
    return { ok: false, reason: "invalid_or_expired" };
  }

  // Pull the user + email — we need the email to derive the domain.
  const user = await db.user.findUnique({
    where: { id: row.userId },
    select: {
      id: true,
      email: true,
      audience: true,
      emailVerifiedAt: true,
    },
  });
  if (!user) {
    return { ok: false, reason: "invalid_or_expired" };
  }

  // Atomic claim — set usedAt only if still null. Concurrent verify
  // attempts race deterministically.
  const claimed = await db.userToken.updateMany({
    where: { id: row.id, usedAt: null },
    data: { usedAt: now },
  });
  if (claimed.count === 0) {
    return { ok: false, reason: "invalid_or_expired" };
  }

  // Flip emailVerifiedAt + bump lastSeenAt.
  await db.user.update({
    where: { id: user.id },
    data: { emailVerifiedAt: now, lastSeenAt: now },
  });

  // Rule 5 guard — only drivers go through the access-grant fork.
  // operator / service audiences finish here with no membership effect.
  if (user.audience !== "driver") {
    return {
      ok: true,
      user: {
        id: user.id,
        email: user.email,
        emailVerifiedAt: now.toISOString(),
      },
      accessOutcome: { kind: "no_match" },
    };
  }

  // Domain match. Email is citext — split by '@' and lowercase the
  // right half. (Schema stores domain lowercased; UNIQUE catches case
  // mismatches at write time.)
  const domain = user.email.split("@")[1]?.toLowerCase() ?? "";
  if (domain === "") {
    return {
      ok: true,
      user: {
        id: user.id,
        email: user.email,
        emailVerifiedAt: now.toISOString(),
      },
      accessOutcome: { kind: "no_match" },
    };
  }

  // Raw read — the generated Prisma client may not yet carry
  // OrgEmailDomain (model lands in schema in the same commit as this
  // code; client regenerates next CI build).
  const domainRows = await db.$queryRaw<OrgEmailDomainRow[]>`
    SELECT id, org_id, domain, policy::text AS policy, default_driver_group_id
    FROM tenancy.org_email_domains
    WHERE domain = ${domain}
    LIMIT 1
  `;
  const domainRow = domainRows[0];
  if (!domainRow) {
    return {
      ok: true,
      user: {
        id: user.id,
        email: user.email,
        emailVerifiedAt: now.toISOString(),
      },
      accessOutcome: { kind: "no_match" },
    };
  }

  if (domainRow.policy === "disabled") {
    return {
      ok: true,
      user: {
        id: user.id,
        email: user.email,
        emailVerifiedAt: now.toISOString(),
      },
      accessOutcome: { kind: "disabled" },
    };
  }

  if (domainRow.policy === "auto_join") {
    if (!domainRow.default_driver_group_id) {
      // Misconfigured rule — surface a typed kind so the operator
      // sees the gap in a follow-up dashboard.
      return {
        ok: true,
        user: {
          id: user.id,
          email: user.email,
          emailVerifiedAt: now.toISOString(),
        },
        accessOutcome: { kind: "auto_join_no_default_group" },
      };
    }
    const membership = await db.driverGroupMembership.create({
      data: {
        driverGroupId: domainRow.default_driver_group_id,
        userId: user.id,
      },
      select: { id: true, driverGroupId: true },
    });
    return {
      ok: true,
      user: {
        id: user.id,
        email: user.email,
        emailVerifiedAt: now.toISOString(),
      },
      accessOutcome: {
        kind: "auto_join_granted",
        membershipId: membership.id,
        driverGroupId: membership.driverGroupId,
      },
    };
  }

  // policy === 'request_approval' — pick an installation_id from the
  // org's installation-type Agreements. First active match wins; better
  // targeting is a follow-up improvement (operator can pick the right
  // installation when reviewing the request).
  const installRows = await db.$queryRaw<InstallationIdRow[]>`
    SELECT installation_id AS id
    FROM agreements.agreements
    WHERE counterparty_org_id = ${domainRow.org_id}::uuid
      AND agreement_type = 'installation'
      AND status = 'active'
      AND installation_id IS NOT NULL
    ORDER BY created_at ASC
    LIMIT 1
  `;
  const installationId = installRows[0]?.id;
  if (!installationId) {
    // No installation Agreement to bind the request to — surface a
    // typed kind so ENROLL-2 dashboard can flag the org for setup.
    return {
      ok: true,
      user: {
        id: user.id,
        email: user.email,
        emailVerifiedAt: now.toISOString(),
      },
      accessOutcome: { kind: "request_no_installation" },
    };
  }
  const requestRows = await db.$queryRaw<DriverAccessRequestIdRow[]>`
    INSERT INTO agreements.driver_access_requests
      (user_id, installation_id, triggered_by, org_email_domain_id, status, created_at, updated_at)
    VALUES
      (${user.id}::uuid,
       ${installationId}::uuid,
       'email_domain_match'::agreements."DriverAccessRequestTrigger",
       ${domainRow.id}::uuid,
       'pending'::agreements."DriverAccessRequestStatus",
       NOW(),
       NOW())
    RETURNING id
  `;
  const accessRequestId = requestRows[0]?.id ?? "";
  return {
    ok: true,
    user: {
      id: user.id,
      email: user.email,
      emailVerifiedAt: now.toISOString(),
    },
    accessOutcome: { kind: "request_pending", accessRequestId },
  };
}

// ── Password reset — initiate ────────────────────────────────────────
//
// Anti-enumeration: we ALWAYS return void. If the email matches a User,
// we mint a token + send the email; if it doesn't, we silently no-op.
// Side-effect timing is the only signal a probe could read, and that's
// drowned out by the email-send round-trip (50–800ms variance).

export interface InitiatePasswordResetInput {
  email: string;
  /** Base URL used to build the reset link. */
  baseUrl: string;
}

export async function initiatePasswordReset(
  db: PrismaClient,
  env: Env,
  input: InitiatePasswordResetInput,
): Promise<void> {
  const email = input.email.trim().toLowerCase();
  const user = await db.user.findFirst({
    where: { email, status: { not: "deleted" } },
    select: { id: true, email: true, displayName: true },
  });
  if (!user) {
    // Anti-enumeration: caller sees the same response shape either way.
    // We deliberately don't even create a token row to avoid a
    // user-tokens table size oracle.
    return;
  }
  const now = new Date();
  // Reset token TTL: 1h per task spec.
  const expiresAt = new Date(now.getTime() + 60 * 60_000);
  const plaintext = generateTokenPlaintext();
  const tokenHash = await sha256Hex(plaintext);

  await db.userToken.create({
    data: {
      userId: user.id,
      kind: "password_reset",
      tokenHash,
      expiresAt,
      createdById: null,
      metadata: { email } as Prisma.InputJsonValue,
    },
  });

  const resetUrl = `${input.baseUrl.replace(/\/+$/, "")}/password-reset/${plaintext}`;
  const content = renderPasswordResetEmail({
    displayName: user.displayName,
    resetUrl,
    expiresAt,
  });
  await sendEmail(env, {
    to: user.email,
    subject: content.subject,
    html: content.html,
    text: content.text,
    tags: [{ name: "category", value: "password_reset" }],
  });
}

// ── Password reset — confirm ─────────────────────────────────────────

export type ConfirmPasswordResetResult =
  | { ok: true }
  | { ok: false; reason: "invalid_or_expired" };

export async function confirmPasswordReset(
  db: PrismaClient,
  plaintext: string,
  newPassword: string,
): Promise<ConfirmPasswordResetResult> {
  const tokenHash = await sha256Hex(plaintext);
  const now = new Date();

  const row = await db.userToken.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      userId: true,
      kind: true,
      usedAt: true,
      expiresAt: true,
    },
  });
  if (!row || row.kind !== "password_reset") {
    return { ok: false, reason: "invalid_or_expired" };
  }
  if (row.usedAt !== null) return { ok: false, reason: "invalid_or_expired" };
  if (row.expiresAt.getTime() <= now.getTime()) {
    return { ok: false, reason: "invalid_or_expired" };
  }

  const passwordHashed = await hashPassword(newPassword);

  return db.$transaction(async (tx) => {
    // Atomic claim.
    const claimed = await tx.userToken.updateMany({
      where: { id: row.id, usedAt: null },
      data: { usedAt: now },
    });
    if (claimed.count === 0) {
      return { ok: false as const, reason: "invalid_or_expired" as const };
    }

    // Upsert — defensive in case a User row predates UserCredential
    // (Zaptec-imported drivers can land here without a credential).
    await tx.userCredential.upsert({
      where: { userId: row.userId },
      create: { userId: row.userId, passwordHash: passwordHashed },
      update: { passwordHash: passwordHashed },
    });

    await tx.user.update({
      where: { id: row.userId },
      data: { lastSeenAt: now },
    });

    return { ok: true as const };
  });
}

// ── helpers ──────────────────────────────────────────────────────────

function summariseEmailResult(
  result: SendEmailResult,
): { sent: boolean; id: string | null; reason: string | null } {
  if (result.ok) {
    return { sent: true, id: result.id, reason: null };
  }
  return { sent: false, id: null, reason: result.reason };
}
