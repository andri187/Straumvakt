// S2 — invite consume hardening.
//
// This route had no test file at all, which is how the password-overwrite
// Critical survived. The invariants asserted here are the ones that make
// the route safe to expose to an unauthenticated bearer:
//
//   1. A user who already has a password cannot have it overwritten.
//   2. A refusal must NOT burn the invite — the real invitee still needs it.
//   3. An admin-cleared password (row present, column null) is still
//      claimable, so clearing a password is not a permanent lockout.
//
// The fake models the four Prisma calls the handler makes and records
// them, so "the token was never claimed" is asserted directly rather than
// inferred from a status code.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../lib/audit", () => ({
  recordAuditAction: vi.fn(async () => undefined),
}));

const state = vi.hoisted(() => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  token: null as any,
  credential: null as { passwordHash: string | null } | null,
  claimCount: 1,
  calls: [] as string[],
}));

vi.mock("../../lib/prisma", () => {
  const tx = {
    userToken: {
      findUnique: async () => {
        state.calls.push("token.findUnique");
        return state.token;
      },
      updateMany: async () => {
        state.calls.push("token.updateMany");
        return { count: state.claimCount };
      },
    },
    userCredential: {
      findUnique: async () => {
        state.calls.push("credential.findUnique");
        return state.credential;
      },
      upsert: async (args: { create: { passwordHash: string } }) => {
        state.calls.push("credential.upsert");
        state.credential = { passwordHash: args.create.passwordHash };
        return state.credential;
      },
    },
    membership: {
      updateMany: async () => {
        state.calls.push("membership.updateMany");
        return { count: 1 };
      },
    },
    user: {
      update: async () => {
        state.calls.push("user.update");
        return {};
      },
    },
  };
  return {
    makePrisma: () => ({
      ...tx,
      $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    }),
  };
});

import { publicInvites } from "./invites";
import type { Env } from "../../bindings";

const TEST_ENV = {} as unknown as Env;

const FUTURE = new Date(Date.now() + 60 * 60 * 1000);
const PAST = new Date(Date.now() - 60 * 60 * 1000);

function validToken(overrides: Record<string, unknown> = {}) {
  return {
    id: "tok-1",
    userId: "user-anna",
    kind: "invite",
    usedAt: null,
    expiresAt: FUTURE,
    metadata: { orgId: "org_alpha", email: "driver-anna@example.test" },
    ...overrides,
  };
}

function consume(body: unknown): Request {
  return new Request("http://localhost/consume", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const GOOD = { token: "invite-token-value", password: "<redacted-but-long>" };

describe("POST /api/public/invites/consume — S2", () => {
  beforeEach(() => {
    state.token = validToken();
    state.credential = null;
    state.claimCount = 1;
    state.calls = [];
  });

  it("refuses with 409 when the user already has a password", async () => {
    state.credential = { passwordHash: "pbkdf2:sha256:100000:AAAA:BBBB" };
    const res = await publicInvites.fetch(consume(GOOD), TEST_ENV);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "already_claimed" });
  });

  it("leaves the existing hash byte-identical on refusal", async () => {
    const original = "pbkdf2:sha256:100000:AAAA:BBBB";
    state.credential = { passwordHash: original };
    await publicInvites.fetch(consume(GOOD), TEST_ENV);
    expect(state.credential.passwordHash).toBe(original);
    expect(state.calls).not.toContain("credential.upsert");
  });

  // The ordering invariant. A guard placed after the claim would return
  // the same 409 and still burn the token, locking out the real invitee —
  // the deadlock ADR 0053 fixed on the driver path.
  it("does NOT burn the invite on refusal", async () => {
    state.credential = { passwordHash: "pbkdf2:sha256:100000:AAAA:BBBB" };
    await publicInvites.fetch(consume(GOOD), TEST_ENV);
    expect(state.calls).not.toContain("token.updateMany");
    expect(state.calls.indexOf("credential.findUnique")).toBeLessThan(
      state.calls.length,
    );
  });

  it("succeeds when the user has no credential row", async () => {
    const res = await publicInvites.fetch(consume(GOOD), TEST_ENV);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: true,
      userId: "user-anna",
      orgId: "org_alpha",
    });
    expect(state.calls).toContain("token.updateMany");
    expect(state.calls).toContain("credential.upsert");
  });

  // password_hash is nullable and clearUserPasswordHash nulls it while
  // keeping the row. A row-existence guard would make an admin-initiated
  // password clear a permanent lockout.
  it("succeeds when a credential row exists with a null hash", async () => {
    state.credential = { passwordHash: null };
    const res = await publicInvites.fetch(consume(GOOD), TEST_ENV);
    expect(res.status).toBe(200);
    expect(state.credential.passwordHash).not.toBeNull();
  });

  it("claims the token before writing the credential", async () => {
    await publicInvites.fetch(consume(GOOD), TEST_ENV);
    expect(state.calls.indexOf("credential.findUnique")).toBeLessThan(
      state.calls.indexOf("token.updateMany"),
    );
    expect(state.calls.indexOf("token.updateMany")).toBeLessThan(
      state.calls.indexOf("credential.upsert"),
    );
  });

  it("returns 410 already_used when a concurrent consumer won the claim", async () => {
    state.claimCount = 0;
    const res = await publicInvites.fetch(consume(GOOD), TEST_ENV);
    expect(res.status).toBe(410);
    expect(await res.json()).toEqual({ error: "already_used" });
  });

  it("returns 404 for an unknown token", async () => {
    state.token = null;
    const res = await publicInvites.fetch(consume(GOOD), TEST_ENV);
    expect(res.status).toBe(404);
  });

  it("returns 404 for a token of another kind", async () => {
    state.token = validToken({ kind: "driver" });
    const res = await publicInvites.fetch(consume(GOOD), TEST_ENV);
    expect(res.status).toBe(404);
  });

  it("returns 410 for an expired token", async () => {
    state.token = validToken({ expiresAt: PAST });
    const res = await publicInvites.fetch(consume(GOOD), TEST_ENV);
    expect(res.status).toBe(410);
    expect(await res.json()).toEqual({ error: "expired" });
  });

  // Was 410 — the status map sent everything except not_found to "gone".
  // Unusable stored metadata is a server-side data fault, not a spent token.
  it("returns 400 for malformed metadata, not 410", async () => {
    state.token = validToken({ metadata: { orgId: "org_alpha" } }); // no email
    const res = await publicInvites.fetch(consume(GOOD), TEST_ENV);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "malformed_metadata" });
  });

  it("returns 400 on a body that fails validation", async () => {
    const res = await publicInvites.fetch(consume({ token: "x" }), TEST_ENV);
    expect(res.status).toBe(400);
  });

  // Non-strict by design: apps/mobile/lib/api/client.dart posts a third
  // field, kennitala. Making the schema strict would 400 every installed
  // mobile client, so D-02 is a product decision, not a cleanup. Pinned
  // so that turning it strict has to change this test on purpose.
  it("still accepts the extra kennitala field the mobile client sends", async () => {
    const res = await publicInvites.fetch(
      consume({ ...GOOD, kennitala: "1234567890" }),
      TEST_ENV,
    );
    expect(res.status).toBe(200);
  });
});
