import type { Prisma, PrismaClient } from "../generated/prisma/client";

/**
 * createDriver — the single source of truth for what a driver IS.
 *
 * ## Why this exists
 *
 * Before this module there were five places that created a User
 * (registration, admin create, invite consume, host-invite consume,
 * bootstrap) and exactly ONE of them issued the virtual_rfid that
 * ADR 0022 requires. The other four were not careless: the rule was
 * only ever expressed as code inside `registerDriver`, so there was
 * nothing for them to be checked against.
 *
 * The consequence was live: a driver created by any path other than
 * self-enrollment had no idTag, and therefore could not start a charge
 * from the app at all — OCPP RemoteStartTransaction has nowhere to put
 * a driver who has no charge-point credential.
 *
 * This module is that rule, made executable. Every invariant that must
 * hold for EVERY driver lives here and nowhere else.
 *
 * ## What is in scope
 *
 * Exactly the things that are true of a driver regardless of how they
 * arrived:
 *
 *   - the User row, with audience='driver'
 *   - email + kennitala uniqueness, returned as typed reasons
 *   - the virtual_rfid (ADR 0022)
 *
 * ## What is deliberately NOT in scope
 *
 * Anything about HOW the driver arrived belongs to the caller:
 *
 *   - org membership          — a driver may legitimately have none
 *                               ("homeless", ADR 0043)
 *   - password / credential   — set now, or later via an invite link
 *   - invite consumption      — caller's flow
 *   - email sending           — caller's flow, and must not happen
 *                               inside a transaction that may roll back
 *
 * ## Transaction discipline
 *
 * This function does NOT open a transaction. It accepts the caller's
 * client so it can compose: a host-invite creates a driver AND a
 * membership AND consumes the invite, and a driver that committed
 * independently of the membership would leave a half-enrolled user with
 * no clean rollback. Same signature convention as `createUserToken` in
 * user-tokens.ts.
 *
 * ## `source` is metadata, never control flow
 *
 * How the driver was created is worth recording — support and analytics
 * both want it. It is never worth branching on. The moment a
 * `if (source === ...)` appears in this file, it is five paths again
 * wearing one name, and the drift this module exists to prevent starts
 * over.
 */

// ── Virtual RFID ─────────────────────────────────────────────────────
//
// ADR 0022 (2026-05-31 addendum): "User.id with hyphens stripped,
// uppercased, then take first 20 chars". 20 is not arbitrary — an OCPP
// 1.6J idTag is CiString20Type, a hard 20-character ceiling, so this is
// the longest value that can physically be presented to a charge point.
//
// NOTE — known open decision, deliberately NOT changed here.
// Deriving the token from User.id makes it a reversible function of the
// user id, and the operator's stated preference (2026-08-03) is a random
// unique value instead. That is the better design, but changing the
// derivation and consolidating the call sites in one step would conflate
// two changes and make either one hard to reason about if it goes wrong.
// This module preserves TODAY's behaviour exactly. Switching to random
// is an ADR 0022 amendment plus a change to this one function — and
// because every path now routes through here, it becomes a one-line
// change instead of a five-file one. That is the point.
export function virtualRfidValueFromUserId(userId: string): string {
  return userId.replace(/-/g, "").toUpperCase().slice(0, 20);
}

/** How the driver record came into existence. Recorded, never branched on. */
export type DriverSource =
  | "self_registration"
  | "admin_create"
  | "invite"
  | "host_invite"
  | "bootstrap";

export interface CreateDriverInput {
  email: string;
  /** Optional: self-enrollment collects it, an admin invite may not. */
  kennitala?: string | null;
  displayName?: string | null;
  phone?: string | null;
  firstName?: string | null;
  middleName?: string | null;
  lastName?: string | null;
  locale?: string | null;
  timezone?: string | null;
  /**
   * Consent timestamps. Only self-enrollment can genuinely capture
   * these — an admin creating a user has not obtained consent from
   * them, and must not pretend to have.
   */
  consentTosAt?: Date | null;
  consentPrivacyAt?: Date | null;
  consentMarketingAt?: Date | null;
  /**
   * 'active' for paths where the person is present (registration,
   * invite consume). Callers that create a placeholder ahead of the
   * person may pass 'suspended'.
   */
  status?: "active" | "suspended";
}

export interface CreateDriverOptions {
  source: DriverSource;
  /** Injected so callers inside a transaction share one clock. */
  now?: Date;
}

export interface CreatedDriver {
  id: string;
  email: string;
  displayName: string | null;
  status: string;
  emailVerifiedAt: Date | null;
  /** The idTag this driver presents at a charge point. */
  virtualRfid: string;
}

export type CreateDriverResult =
  | { ok: true; driver: CreatedDriver }
  | { ok: false; reason: "email_taken" }
  | { ok: false; reason: "kennitala_taken" };

export async function createDriver(
  db: PrismaClient | Prisma.TransactionClient,
  input: CreateDriverInput,
  opts: CreateDriverOptions,
): Promise<CreateDriverResult> {
  const now = opts.now ?? new Date();
  // citext column, but lowercase explicitly so the uniqueness probe and
  // the insert agree regardless of collation config.
  const email = input.email.trim().toLowerCase();

  // Uniqueness is checked explicitly rather than left to the unique
  // constraints, so callers get a typed reason instead of having to
  // interpret a P2002. The constraints remain the real backstop against
  // the race between this probe and the insert.
  const existingEmail = await db.user.findFirst({
    where: { email, status: { not: "deleted" } },
    select: { id: true },
  });
  if (existingEmail) return { ok: false, reason: "email_taken" };

  if (input.kennitala) {
    const existingKennitala = await db.user.findFirst({
      where: { kennitala: input.kennitala },
      select: { id: true },
    });
    if (existingKennitala) return { ok: false, reason: "kennitala_taken" };
  }

  const user = await db.user.create({
    data: {
      email,
      displayName: input.displayName ?? null,
      audience: "driver",
      status: input.status ?? "active",
      kennitala: input.kennitala ?? null,
      phone: input.phone ?? null,
      firstName: input.firstName ?? null,
      middleName: input.middleName ?? null,
      lastName: input.lastName ?? null,
      ...(input.locale ? { locale: input.locale } : {}),
      ...(input.timezone ? { timezone: input.timezone } : {}),
      emailVerifiedAt: null,
      phoneVerifiedAt: null,
      lastSeenAt: now,
      consentTosAt: input.consentTosAt ?? null,
      consentPrivacyAt: input.consentPrivacyAt ?? null,
      consentMarketingAt: input.consentMarketingAt ?? null,
    },
    select: {
      id: true,
      email: true,
      displayName: true,
      status: true,
      emailVerifiedAt: true,
    },
  });

  // The invariant the other four paths were missing. A driver without
  // this cannot be presented to a charge point at all.
  const virtualRfid = virtualRfidValueFromUserId(user.id);
  const virtualRfidCreate = {
    userId: user.id,
    kind: "virtual_rfid",
    value: virtualRfid,
    status: "active",
    label: "Virtual RFID",
  } as unknown as Prisma.IdTokenCreateInput;
  await db.idToken.create({ data: virtualRfidCreate });

  return {
    ok: true,
    driver: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      status: user.status,
      emailVerifiedAt: user.emailVerifiedAt,
      virtualRfid,
    },
  };
}
