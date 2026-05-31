// registration.test.ts — unit tests for the driver self-onboarding repo.
//
// Sprint 9 / ENROLL-1 / ADR 0022 addendum.
//
// Coverage:
//   register / email_taken / kennitala_taken
//   register / writes user + credential + idtoken + verify token
//   register / virtual_rfid value derived from user id
//   register / sends verify-email tagged register_verify
//   register / acceptedMarketing=true sets consent timestamp
//   register / acceptedMarketing=false leaves consent null
//
//   consumeEmailVerification / invalid token  → invalid_or_expired
//   consumeEmailVerification / wrong purpose  → invalid_or_expired
//   consumeEmailVerification / expired token  → invalid_or_expired
//   consumeEmailVerification / already used   → invalid_or_expired
//   consumeEmailVerification / valid, no domain rule → no_match
//   consumeEmailVerification / policy=disabled       → disabled
//   consumeEmailVerification / policy=auto_join + group → auto_join_granted
//   consumeEmailVerification / policy=auto_join, no default group → auto_join_no_default_group
//   consumeEmailVerification / policy=request_approval, no install → request_no_installation
//   consumeEmailVerification / policy=request_approval, install present → request_pending
//   consumeEmailVerification / non-driver audience → no_match (Rule 5 guard)
//
//   initiatePasswordReset / unknown email → silent no-op (no token, no send)
//   initiatePasswordReset / known email   → creates token, sends email
//
//   confirmPasswordReset / invalid token  → invalid_or_expired
//   confirmPasswordReset / wrong kind     → invalid_or_expired
//   confirmPasswordReset / expired        → invalid_or_expired
//   confirmPasswordReset / already used   → invalid_or_expired
//   confirmPasswordReset / valid          → ok, credential upserted, token consumed
//
//   virtualRfidValueFromUserId / shape derivation
//
// The Prisma client is hand-rolled — only the call shapes the repo
// actually uses. Unrelated shapes throw so future regressions are loud.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  registerDriver,
  consumeEmailVerification,
  initiatePasswordReset,
  confirmPasswordReset,
  virtualRfidValueFromUserId,
} from "./registration";
import type { PrismaClient } from "../generated/prisma/client";
import type { Env } from "../bindings";

// ── Test doubles ─────────────────────────────────────────────────────

interface UserRow {
  id: string;
  email: string;
  status: string;
  displayName: string | null;
  audience: string;
  emailVerifiedAt: Date | null;
  kennitala: string | null;
  consentTosAt: Date | null;
  consentPrivacyAt: Date | null;
  consentMarketingAt: Date | null;
  lastSeenAt: Date | null;
}

interface CredentialRow {
  userId: string;
  passwordHash: string | null;
}

interface IdTokenRow {
  userId: string;
  kind: string;
  value: string;
  status: string;
  label: string | null;
}

interface UserTokenRow {
  id: string;
  userId: string;
  kind: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  metadata: Record<string, unknown>;
}

interface OrgEmailDomainRowRaw {
  id: string;
  org_id: string;
  domain: string;
  policy: string;
  default_driver_group_id: string | null;
}

interface InstallAgreementRow {
  installation_id: string;
  counterparty_org_id: string;
  agreement_type: string;
  status: string;
  created_at: Date;
}

interface DriverGroupMembershipRow {
  id: string;
  driverGroupId: string;
  userId: string;
}

interface DriverAccessRequestRow {
  id: string;
  user_id: string;
  installation_id: string;
  triggered_by: string;
  org_email_domain_id: string | null;
  status: string;
}

interface FakeState {
  users: UserRow[];
  credentials: CredentialRow[];
  idTokens: IdTokenRow[];
  userTokens: UserTokenRow[];
  orgEmailDomains: OrgEmailDomainRowRaw[];
  installAgreements: InstallAgreementRow[];
  driverGroupMemberships: DriverGroupMembershipRow[];
  driverAccessRequests: DriverAccessRequestRow[];
}

function makeState(seed: Partial<FakeState> = {}): FakeState {
  return {
    users: seed.users ?? [],
    credentials: seed.credentials ?? [],
    idTokens: seed.idTokens ?? [],
    userTokens: seed.userTokens ?? [],
    orgEmailDomains: seed.orgEmailDomains ?? [],
    installAgreements: seed.installAgreements ?? [],
    driverGroupMemberships: seed.driverGroupMemberships ?? [],
    driverAccessRequests: seed.driverAccessRequests ?? [],
  };
}

let idCounter = 1;
function nextId(): string {
  // Produce a stable, hyphenated-UUID-shaped string per call. Real DB
  // uses gen_random_uuid(); these are deterministic so test assertions
  // can compare across runs.
  const n = (idCounter++).toString(16).padStart(12, "0");
  return `00000000-0000-4000-8000-${n}`;
}

function makeFakePrisma(state: FakeState): PrismaClient {
  const txClient = {
    user: {
      findFirst: async ({ where, select }: { where: { email?: string; kennitala?: string; status?: { not?: string } }; select?: unknown }) => {
        void select;
        return (
          state.users.find((u) => {
            if (where.email !== undefined && u.email !== where.email) return false;
            if (where.kennitala !== undefined && u.kennitala !== where.kennitala) return false;
            if (where.status?.not !== undefined && u.status === where.status.not) return false;
            return true;
          }) ?? null
        );
      },
      findUnique: async ({ where }: { where: { id?: string } }) => {
        return state.users.find((u) => u.id === where.id) ?? null;
      },
      create: async ({ data }: { data: Partial<UserRow> }) => {
        const row: UserRow = {
          id: nextId(),
          email: data.email ?? "",
          status: data.status ?? "active",
          displayName: data.displayName ?? null,
          audience: data.audience ?? "operator",
          emailVerifiedAt: data.emailVerifiedAt ?? null,
          kennitala: data.kennitala ?? null,
          consentTosAt: data.consentTosAt ?? null,
          consentPrivacyAt: data.consentPrivacyAt ?? null,
          consentMarketingAt: data.consentMarketingAt ?? null,
          lastSeenAt: data.lastSeenAt ?? null,
        };
        state.users.push(row);
        return row;
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<UserRow> }) => {
        const u = state.users.find((x) => x.id === where.id);
        if (!u) throw new Error("user_not_found");
        Object.assign(u, data);
        return u;
      },
    },
    userCredential: {
      create: async ({ data }: { data: { userId: string; passwordHash: string } }) => {
        const row: CredentialRow = { userId: data.userId, passwordHash: data.passwordHash };
        state.credentials.push(row);
        return row;
      },
      upsert: async ({
        where,
        create,
        update,
      }: {
        where: { userId: string };
        create: { userId: string; passwordHash: string };
        update: { passwordHash: string };
      }) => {
        const existing = state.credentials.find((c) => c.userId === where.userId);
        if (existing) {
          existing.passwordHash = update.passwordHash;
          return existing;
        }
        const row = { userId: create.userId, passwordHash: create.passwordHash };
        state.credentials.push(row);
        return row;
      },
    },
    idToken: {
      create: async ({ data }: { data: Partial<IdTokenRow> }) => {
        const row: IdTokenRow = {
          userId: data.userId ?? "",
          kind: data.kind ?? "",
          value: data.value ?? "",
          status: data.status ?? "active",
          label: data.label ?? null,
        };
        state.idTokens.push(row);
        return row;
      },
    },
    userToken: {
      findUnique: async ({ where }: { where: { tokenHash: string } }) => {
        return state.userTokens.find((t) => t.tokenHash === where.tokenHash) ?? null;
      },
      create: async ({ data }: { data: Partial<UserTokenRow> & { metadata?: unknown } }) => {
        const row: UserTokenRow = {
          id: nextId(),
          userId: data.userId ?? "",
          kind: data.kind ?? "",
          tokenHash: data.tokenHash ?? "",
          expiresAt: data.expiresAt ?? new Date(0),
          usedAt: null,
          metadata: (data.metadata as Record<string, unknown>) ?? {},
        };
        state.userTokens.push(row);
        return row;
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: { id: string; usedAt: null };
        data: { usedAt: Date };
      }) => {
        const row = state.userTokens.find(
          (t) => t.id === where.id && t.usedAt === where.usedAt,
        );
        if (!row) return { count: 0 };
        row.usedAt = data.usedAt;
        return { count: 1 };
      },
    },
    driverGroupMembership: {
      create: async ({
        data,
      }: {
        data: { driverGroupId: string; userId: string };
      }) => {
        const row: DriverGroupMembershipRow = {
          id: nextId(),
          driverGroupId: data.driverGroupId,
          userId: data.userId,
        };
        state.driverGroupMemberships.push(row);
        return row;
      },
    },
    // $queryRaw uses tagged template literals — the first arg is a
    // TemplateStringsArray. The fake decodes the SQL text and dispatches.
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join("?");
      if (sql.includes("FROM tenancy.org_email_domains")) {
        const domain = values[0] as string;
        const matches = state.orgEmailDomains.filter((d) => d.domain === domain);
        return matches;
      }
      if (sql.includes("FROM agreements.agreements")) {
        const orgId = values[0] as string;
        return state.installAgreements
          .filter(
            (a) =>
              a.counterparty_org_id === orgId &&
              a.agreement_type === "installation" &&
              a.status === "active" &&
              a.installation_id != null,
          )
          .sort((a, b) => a.created_at.getTime() - b.created_at.getTime())
          .slice(0, 1)
          .map((a) => ({ id: a.installation_id }));
      }
      if (sql.includes("INSERT INTO agreements.driver_access_requests")) {
        const row: DriverAccessRequestRow = {
          id: nextId(),
          user_id: values[0] as string,
          installation_id: values[1] as string,
          triggered_by: "email_domain_match",
          org_email_domain_id: values[2] as string,
          status: "pending",
        };
        state.driverAccessRequests.push(row);
        return [{ id: row.id }];
      }
      throw new Error(`unexpected raw SQL: ${sql}`);
    },
  };

  // PrismaClient surface — $transaction with a callback runs synchronously
  // against the same fake (no real isolation; rollback would require a
  // snapshot — out of scope for the test surface).
  const client: unknown = {
    ...txClient,
    $transaction: async <T>(cb: (tx: typeof txClient) => Promise<T>) => {
      return cb(txClient);
    },
  };
  return client as PrismaClient;
}

function makeEnv(): Env {
  return { RESEND_API_KEY: "re_test" } as unknown as Env;
}

function isoIn(ms: number): Date {
  return new Date(Date.now() + ms);
}

// ── Tests ────────────────────────────────────────────────────────────

describe("virtualRfidValueFromUserId", () => {
  it("strips hyphens, uppercases, takes first 20 chars", () => {
    const out = virtualRfidValueFromUserId(
      "abcdef12-3456-7890-abcd-ef1234567890",
    );
    expect(out).toBe("ABCDEF1234567890ABCD");
    expect(out.length).toBe(20);
  });
});

describe("registerDriver", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    idCounter = 1;
    fetchSpy = vi.spyOn(globalThis, "fetch");
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ id: "email_id_1" }), { status: 200 }),
    );
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    warnSpy.mockRestore();
  });

  const baseInput = {
    email: "Driver@N1.is",
    password: "supersecretpw",
    kennitala: "1234567890",
    displayName: "Driver One",
    acceptedTos: true,
    acceptedPrivacy: true,
    baseUrl: "https://example.test",
  } as const;

  it("rejects when email already exists (case-insensitive)", async () => {
    const state = makeState({
      users: [
        {
          id: "u-exist",
          email: "driver@n1.is",
          status: "active",
          displayName: null,
          audience: "driver",
          emailVerifiedAt: null,
          kennitala: "0000000000",
          consentTosAt: null,
          consentPrivacyAt: null,
          consentMarketingAt: null,
          lastSeenAt: null,
        },
      ],
    });
    const db = makeFakePrisma(state);
    const r = await registerDriver(db, makeEnv(), baseInput);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("email_taken");
  });

  it("rejects when kennitala already exists", async () => {
    const state = makeState({
      users: [
        {
          id: "u-exist",
          email: "other@example.com",
          status: "active",
          displayName: null,
          audience: "driver",
          emailVerifiedAt: null,
          kennitala: "1234567890",
          consentTosAt: null,
          consentPrivacyAt: null,
          consentMarketingAt: null,
          lastSeenAt: null,
        },
      ],
    });
    const db = makeFakePrisma(state);
    const r = await registerDriver(db, makeEnv(), baseInput);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("kennitala_taken");
  });

  it("creates user + credential + virtual_rfid IdToken + verify token", async () => {
    const state = makeState();
    const db = makeFakePrisma(state);
    const r = await registerDriver(db, makeEnv(), baseInput);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(state.users).toHaveLength(1);
    expect(state.users[0].email).toBe("driver@n1.is");
    expect(state.users[0].audience).toBe("driver");
    expect(state.users[0].status).toBe("active");
    expect(state.users[0].emailVerifiedAt).toBeNull();
    expect(state.users[0].kennitala).toBe("1234567890");
    expect(state.credentials).toHaveLength(1);
    expect(state.credentials[0].userId).toBe(state.users[0].id);
    expect(state.credentials[0].passwordHash).toMatch(/^pbkdf2:sha256:/);
    expect(state.idTokens).toHaveLength(1);
    expect(state.idTokens[0].kind).toBe("virtual_rfid");
    expect(state.idTokens[0].value).toBe(
      virtualRfidValueFromUserId(state.users[0].id),
    );
    expect(state.idTokens[0].label).toBe("Virtual RFID");
    expect(state.userTokens).toHaveLength(1);
    expect(state.userTokens[0].kind).toBe("magic_link");
    expect(state.userTokens[0].metadata.purpose).toBe("email_verify");
  });

  it("sends verify-email tagged register_verify", async () => {
    const state = makeState();
    const db = makeFakePrisma(state);
    await registerDriver(db, makeEnv(), baseInput);
    expect(fetchSpy).toHaveBeenCalledOnce();
    const [, init] = fetchSpy.mock.calls[0]!;
    const body = JSON.parse((init?.body as string) ?? "{}");
    expect(body.subject).toContain("Verify your email");
    expect(body.tags).toEqual([
      { name: "category", value: "register_verify" },
    ]);
    // Email body should embed the verify URL with the expected base
    expect(body.html).toContain("https://example.test/verify-email/");
  });

  it("respects acceptedMarketing true → consent timestamp set", async () => {
    const state = makeState();
    const db = makeFakePrisma(state);
    await registerDriver(db, makeEnv(), { ...baseInput, acceptedMarketing: true });
    expect(state.users[0].consentMarketingAt).toBeInstanceOf(Date);
  });

  it("respects acceptedMarketing false/missing → consent timestamp null", async () => {
    const state = makeState();
    const db = makeFakePrisma(state);
    await registerDriver(db, makeEnv(), {
      ...baseInput,
      acceptedMarketing: false,
    });
    expect(state.users[0].consentMarketingAt).toBeNull();
  });

  it("returns user shape with emailVerifiedAt=null + email send summary", async () => {
    const state = makeState();
    const db = makeFakePrisma(state);
    const r = await registerDriver(db, makeEnv(), baseInput);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.user.emailVerifiedAt).toBeNull();
    expect(r.user.email).toBe("driver@n1.is");
    expect(r.email.sent).toBe(true);
    expect(r.email.id).toBe("email_id_1");
  });
});

// ── consumeEmailVerification ─────────────────────────────────────────

import { sha256Hex } from "../lib/sha256";

async function seedVerifyToken(
  state: FakeState,
  plaintext: string,
  opts: {
    userId: string;
    purpose?: string;
    kind?: string;
    expiresAt?: Date;
    usedAt?: Date | null;
  },
): Promise<void> {
  state.userTokens.push({
    id: nextId(),
    userId: opts.userId,
    kind: opts.kind ?? "magic_link",
    tokenHash: await sha256Hex(plaintext),
    expiresAt: opts.expiresAt ?? isoIn(60 * 60_000),
    usedAt: opts.usedAt ?? null,
    metadata: { purpose: opts.purpose ?? "email_verify" },
  });
}

function seedDriver(state: FakeState, id: string, email: string, audience = "driver"): void {
  state.users.push({
    id,
    email,
    status: "active",
    displayName: "Driver",
    audience,
    emailVerifiedAt: null,
    kennitala: null,
    consentTosAt: null,
    consentPrivacyAt: null,
    consentMarketingAt: null,
    lastSeenAt: null,
  });
}

describe("consumeEmailVerification", () => {
  beforeEach(() => {
    idCounter = 100;
  });

  it("returns invalid_or_expired for unknown token", async () => {
    const state = makeState();
    const db = makeFakePrisma(state);
    const r = await consumeEmailVerification(db, "nope-not-a-token");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("invalid_or_expired");
  });

  it("returns invalid_or_expired for wrong-purpose magic_link token", async () => {
    const state = makeState();
    seedDriver(state, "user-1", "x@example.com");
    await seedVerifyToken(state, "tk-wrong-purpose", {
      userId: "user-1",
      purpose: "other",
    });
    const db = makeFakePrisma(state);
    const r = await consumeEmailVerification(db, "tk-wrong-purpose");
    expect(r.ok).toBe(false);
  });

  it("returns invalid_or_expired for expired token", async () => {
    const state = makeState();
    seedDriver(state, "user-1", "x@example.com");
    await seedVerifyToken(state, "tk-expired", {
      userId: "user-1",
      expiresAt: new Date(Date.now() - 60_000),
    });
    const db = makeFakePrisma(state);
    const r = await consumeEmailVerification(db, "tk-expired");
    expect(r.ok).toBe(false);
  });

  it("returns invalid_or_expired for already-used token", async () => {
    const state = makeState();
    seedDriver(state, "user-1", "x@example.com");
    await seedVerifyToken(state, "tk-used", {
      userId: "user-1",
      usedAt: new Date(),
    });
    const db = makeFakePrisma(state);
    const r = await consumeEmailVerification(db, "tk-used");
    expect(r.ok).toBe(false);
  });

  it("no_match when no OrgEmailDomain row exists", async () => {
    const state = makeState();
    seedDriver(state, "user-1", "user@unknown-domain.com");
    await seedVerifyToken(state, "tk-no-match", { userId: "user-1" });
    const db = makeFakePrisma(state);
    const r = await consumeEmailVerification(db, "tk-no-match");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.accessOutcome.kind).toBe("no_match");
    expect(state.users[0].emailVerifiedAt).toBeInstanceOf(Date);
  });

  it("disabled when matching domain has policy='disabled'", async () => {
    const state = makeState({
      orgEmailDomains: [
        {
          id: "d-1",
          org_id: "org-1",
          domain: "n1.is",
          policy: "disabled",
          default_driver_group_id: null,
        },
      ],
    });
    seedDriver(state, "user-1", "drv@n1.is");
    await seedVerifyToken(state, "tk-disabled", { userId: "user-1" });
    const db = makeFakePrisma(state);
    const r = await consumeEmailVerification(db, "tk-disabled");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.accessOutcome.kind).toBe("disabled");
  });

  it("auto_join_granted when policy='auto_join' + default group present", async () => {
    const state = makeState({
      orgEmailDomains: [
        {
          id: "d-1",
          org_id: "org-1",
          domain: "n1.is",
          policy: "auto_join",
          default_driver_group_id: "dg-1",
        },
      ],
    });
    seedDriver(state, "user-1", "drv@n1.is");
    await seedVerifyToken(state, "tk-auto", { userId: "user-1" });
    const db = makeFakePrisma(state);
    const r = await consumeEmailVerification(db, "tk-auto");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.accessOutcome.kind).toBe("auto_join_granted");
    expect(state.driverGroupMemberships).toHaveLength(1);
    expect(state.driverGroupMemberships[0].driverGroupId).toBe("dg-1");
    expect(state.driverGroupMemberships[0].userId).toBe("user-1");
  });

  it("auto_join_no_default_group when policy='auto_join' but no default", async () => {
    const state = makeState({
      orgEmailDomains: [
        {
          id: "d-1",
          org_id: "org-1",
          domain: "n1.is",
          policy: "auto_join",
          default_driver_group_id: null,
        },
      ],
    });
    seedDriver(state, "user-1", "drv@n1.is");
    await seedVerifyToken(state, "tk-auto-broken", { userId: "user-1" });
    const db = makeFakePrisma(state);
    const r = await consumeEmailVerification(db, "tk-auto-broken");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.accessOutcome.kind).toBe("auto_join_no_default_group");
    expect(state.driverGroupMemberships).toHaveLength(0);
  });

  it("request_no_installation when policy='request_approval' but no install agreement", async () => {
    const state = makeState({
      orgEmailDomains: [
        {
          id: "d-1",
          org_id: "org-1",
          domain: "n1.is",
          policy: "request_approval",
          default_driver_group_id: null,
        },
      ],
    });
    seedDriver(state, "user-1", "drv@n1.is");
    await seedVerifyToken(state, "tk-req-empty", { userId: "user-1" });
    const db = makeFakePrisma(state);
    const r = await consumeEmailVerification(db, "tk-req-empty");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.accessOutcome.kind).toBe("request_no_installation");
    expect(state.driverAccessRequests).toHaveLength(0);
  });

  it("request_pending when policy='request_approval' + install agreement present", async () => {
    const state = makeState({
      orgEmailDomains: [
        {
          id: "d-1",
          org_id: "org-1",
          domain: "n1.is",
          policy: "request_approval",
          default_driver_group_id: null,
        },
      ],
      installAgreements: [
        {
          installation_id: "inst-1",
          counterparty_org_id: "org-1",
          agreement_type: "installation",
          status: "active",
          created_at: new Date("2026-01-01"),
        },
      ],
    });
    seedDriver(state, "user-1", "drv@n1.is");
    await seedVerifyToken(state, "tk-req-ok", { userId: "user-1" });
    const db = makeFakePrisma(state);
    const r = await consumeEmailVerification(db, "tk-req-ok");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.accessOutcome.kind).toBe("request_pending");
    expect(state.driverAccessRequests).toHaveLength(1);
    expect(state.driverAccessRequests[0].installation_id).toBe("inst-1");
    expect(state.driverAccessRequests[0].org_email_domain_id).toBe("d-1");
    expect(state.driverAccessRequests[0].status).toBe("pending");
  });

  it("operator audience skips the access-grant fork (Rule 5 guard)", async () => {
    const state = makeState({
      orgEmailDomains: [
        {
          id: "d-1",
          org_id: "org-1",
          domain: "n1.is",
          policy: "auto_join",
          default_driver_group_id: "dg-1",
        },
      ],
    });
    seedDriver(state, "user-1", "agent@n1.is", "operator");
    await seedVerifyToken(state, "tk-operator", { userId: "user-1" });
    const db = makeFakePrisma(state);
    const r = await consumeEmailVerification(db, "tk-operator");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.accessOutcome.kind).toBe("no_match");
    expect(state.driverGroupMemberships).toHaveLength(0);
  });
});

// ── initiatePasswordReset ────────────────────────────────────────────

describe("initiatePasswordReset", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    idCounter = 200;
    fetchSpy = vi.spyOn(globalThis, "fetch");
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ id: "email_id_reset" }), { status: 200 }),
    );
  });
  afterEach(() => fetchSpy.mockRestore());

  it("unknown email → silent no-op (no token, no send)", async () => {
    const state = makeState();
    const db = makeFakePrisma(state);
    await initiatePasswordReset(db, makeEnv(), {
      email: "nobody@example.com",
      baseUrl: "https://example.test",
    });
    expect(state.userTokens).toHaveLength(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("known email → creates token + sends email", async () => {
    const state = makeState();
    seedDriver(state, "user-1", "drv@n1.is");
    const db = makeFakePrisma(state);
    await initiatePasswordReset(db, makeEnv(), {
      email: "drv@n1.is",
      baseUrl: "https://example.test",
    });
    expect(state.userTokens).toHaveLength(1);
    expect(state.userTokens[0].kind).toBe("password_reset");
    expect(fetchSpy).toHaveBeenCalledOnce();
    const [, init] = fetchSpy.mock.calls[0]!;
    const body = JSON.parse((init?.body as string) ?? "{}");
    expect(body.subject).toContain("Reset your Straumvakt password");
    expect(body.tags).toEqual([
      { name: "category", value: "password_reset" },
    ]);
    expect(body.html).toContain("https://example.test/password-reset/");
  });

  it("ignores deleted-status users", async () => {
    const state = makeState();
    state.users.push({
      id: "user-deleted",
      email: "del@n1.is",
      status: "deleted",
      displayName: null,
      audience: "driver",
      emailVerifiedAt: null,
      kennitala: null,
      consentTosAt: null,
      consentPrivacyAt: null,
      consentMarketingAt: null,
      lastSeenAt: null,
    });
    const db = makeFakePrisma(state);
    await initiatePasswordReset(db, makeEnv(), {
      email: "del@n1.is",
      baseUrl: "https://example.test",
    });
    expect(state.userTokens).toHaveLength(0);
  });
});

// ── confirmPasswordReset ─────────────────────────────────────────────

async function seedResetToken(
  state: FakeState,
  plaintext: string,
  opts: { userId: string; expiresAt?: Date; usedAt?: Date | null; kind?: string },
): Promise<void> {
  state.userTokens.push({
    id: nextId(),
    userId: opts.userId,
    kind: opts.kind ?? "password_reset",
    tokenHash: await sha256Hex(plaintext),
    expiresAt: opts.expiresAt ?? isoIn(60 * 60_000),
    usedAt: opts.usedAt ?? null,
    metadata: {},
  });
}

describe("confirmPasswordReset", () => {
  beforeEach(() => {
    idCounter = 300;
  });

  it("invalid token → invalid_or_expired", async () => {
    const state = makeState();
    const db = makeFakePrisma(state);
    const r = await confirmPasswordReset(db, "no-such", "newsecretpw");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("invalid_or_expired");
  });

  it("wrong kind → invalid_or_expired", async () => {
    const state = makeState();
    seedDriver(state, "user-1", "x@n1.is");
    await seedResetToken(state, "tk-magic", {
      userId: "user-1",
      kind: "magic_link",
    });
    const db = makeFakePrisma(state);
    const r = await confirmPasswordReset(db, "tk-magic", "newsecretpw");
    expect(r.ok).toBe(false);
  });

  it("expired → invalid_or_expired", async () => {
    const state = makeState();
    seedDriver(state, "user-1", "x@n1.is");
    await seedResetToken(state, "tk-exp", {
      userId: "user-1",
      expiresAt: new Date(Date.now() - 60_000),
    });
    const db = makeFakePrisma(state);
    const r = await confirmPasswordReset(db, "tk-exp", "newsecretpw");
    expect(r.ok).toBe(false);
  });

  it("already used → invalid_or_expired", async () => {
    const state = makeState();
    seedDriver(state, "user-1", "x@n1.is");
    await seedResetToken(state, "tk-used", {
      userId: "user-1",
      usedAt: new Date(),
    });
    const db = makeFakePrisma(state);
    const r = await confirmPasswordReset(db, "tk-used", "newsecretpw");
    expect(r.ok).toBe(false);
  });

  it("valid → upserts credential + marks token consumed + bumps lastSeenAt", async () => {
    const state = makeState();
    seedDriver(state, "user-1", "x@n1.is");
    await seedResetToken(state, "tk-good", { userId: "user-1" });
    const db = makeFakePrisma(state);
    const r = await confirmPasswordReset(db, "tk-good", "newsecretpw");
    expect(r.ok).toBe(true);
    const tokRow = state.userTokens.find((t) => t.userId === "user-1");
    expect(tokRow?.usedAt).toBeInstanceOf(Date);
    expect(state.credentials).toHaveLength(1);
    expect(state.credentials[0].userId).toBe("user-1");
    expect(state.credentials[0].passwordHash).toMatch(/^pbkdf2:sha256:/);
    expect(state.users[0].lastSeenAt).toBeInstanceOf(Date);
  });
});
