// Real-DB tests for ADR 0053 — driver invites are identity-bound.
//
// ── WHY THIS LIVES IN test/parity/, AND WHAT "ROLLED BACK" ACTUALLY MEANS
// HERE ────────────────────────────────────────────────────────────────
//
// This suite was asked for as "real-DB rolled-back transaction tests,
// following driver-group-memberships-route.test.ts's pattern, no fake
// clients." That file does not exist in this repo — every existing
// route/repo test (register.test.ts, charging-stations.test.ts,
// registration.test.ts, driver-access-requests.test.ts) mocks the
// repository or hand-rolls a fake Prisma client. The only real-database
// convention that DOES exist is this directory: a separate vitest config,
// a live Postgres via PARITY_DATABASE_URL against the Neon TEST branch
// (br-withered-hat-abtc5gzi), serial execution, generous timeouts. This
// file follows that convention rather than inventing a third one.
//
// "Rolled back" could not mean a literal wrapping SQL transaction here:
// both /redeem-invite and /claim-invite call makePrisma(c.env) themselves
// and manage their own inner prisma.$transaction — there is no seam for a
// test to inject an outer transaction around an HTTP-level route.fetch()
// call without changing production code to accept an injected client,
// which is out of scope for a bug fix. So this suite does the practical
// equivalent instead: every fixture (org, agreement, driver group, user)
// is created by the test, tracked by id, and deleted in a guaranteed
// `afterEach` regardless of pass/fail. Real DB, no fakes, no residue —
// just not a literal ROLLBACK. Said plainly here so it isn't mistaken for
// the thing it was asked for and isn't.
//
// WHY A REAL DB AND NOT A FAKE FOR THIS SPECIFIC FIX: the bug ADR 0053
// fixes is about ordering (identity check BEFORE the conditional claim)
// and atomicity (the claim's WHERE usedAt IS NULL race) inside a real
// prisma.$transaction. A hand-rolled fake Prisma client would re-encode
// that same ordering by hand — asserting the fake behaves the way the
// test author believes the code should behave, which is circular. Only a
// real transaction against a real database can show the claim actually
// stays unconsumed when the check rejects.
//
// RUN: PARITY_DATABASE_URL=<neon-test-branch-url> npm --prefix apps/api run test:parity
//
// NOT RUN FROM WHERE THIS FILE WAS WRITTEN: authored via Claude Code
// working through a bridge into the developer's machine, with no network
// path to Neon from either that bridge or the cloud sandbox it ran
// alongside (DNS resolution to neon.tech fails from both). This file is
// believed correct against the schema and route code it was written
// against, but has not actually been executed. Run it for real before
// trusting the green.

import { afterAll, afterEach, describe, expect, it } from "vitest";
import { closeAll, getApiPrisma, hasDb, PARITY_URL } from "./_harness";
import { publicDriver } from "../../src/routes/public/driver";
import { publicInvites } from "../../src/routes/public/invites";
import { createDriverInvite } from "../../src/repositories/host-invites";
import { mintDriverToken } from "../../src/lib/driver-session";
import { hashPassword } from "../../src/lib/password";
import { sha256Hex } from "../../src/lib/sha256";
import type { Env } from "../../src/bindings";

const AUTH_SECRET = "test-parity-driver-invite-secret-not-for-prod";

// ── env + request plumbing ──────────────────────────────────────────────

function testEnv(): Env {
  return {
    HYPERDRIVE_DB: { connectionString: PARITY_URL } as unknown as Env["HYPERDRIVE_DB"],
    AUTH_SECRET,
    // DRIVER_LOGIN_RATE_LIMITER intentionally omitted — the middleware
    // fails OPEN with a warn when the binding is absent (see
    // src/lib/rate-limit.ts), which is the correct behaviour to exercise
    // here since these tests are not about rate limiting.
  } as unknown as Env;
}

async function callClaimInvite(body: unknown) {
  const req = new Request("http://test/claim-invite", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return publicDriver.fetch(req, testEnv());
}

async function callRedeemInvite(accessToken: string, body: unknown) {
  const req = new Request("http://test/redeem-invite", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  });
  return publicDriver.fetch(req, testEnv());
}

async function callLogin(email: string, password: string) {
  const req = new Request("http://test/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return publicDriver.fetch(req, testEnv());
}

async function callConsumeOrgInvite(body: unknown) {
  const req = new Request("http://test/consume", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return publicInvites.fetch(req, testEnv());
}

async function accessTokenFor(userId: string, email: string): Promise<string> {
  const minted = await mintDriverToken(AUTH_SECRET, { userId, email, kind: "access" });
  return minted.token;
}

// ── fixture tracking + guaranteed cleanup ───────────────────────────────
//
// No literal transaction rollback (see header) — instead every id this
// suite creates is tracked here and deleted in `afterEach`, in FK-safe
// order, regardless of whether the test passed. `afterEach` runs even on
// assertion failure, so a red test still leaves the branch clean.

const created = {
  orgIds: new Set<string>(),
  agreementIds: new Set<string>(),
  driverGroupIds: new Set<string>(),
  userIds: new Set<string>(),
};

function trackOrg(id: string) {
  created.orgIds.add(id);
  return id;
}
function trackAgreement(id: string) {
  created.agreementIds.add(id);
  return id;
}
function trackDriverGroup(id: string) {
  created.driverGroupIds.add(id);
  return id;
}
function trackUser(id: string) {
  created.userIds.add(id);
  return id;
}

async function cleanupAll() {
  if (!hasDb) return;
  const prisma = getApiPrisma();
  const orgIds = [...created.orgIds];
  const userIds = [...created.userIds];
  const driverGroupIds = [...created.driverGroupIds];
  const agreementIds = [...created.agreementIds];

  // Children before parents. AuditAction references both org (cascade) and
  // actor user (no cascade — an FK violation would block user deletion), so
  // audit rows go first regardless.
  if (orgIds.length) {
    await prisma.auditAction.deleteMany({ where: { orgId: { in: orgIds } } });
  }
  if (userIds.length) {
    await prisma.driverGroupMembership.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.userToken.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.userCredential.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.membership.deleteMany({ where: { userId: { in: userIds } } });
  }
  if (driverGroupIds.length) {
    await prisma.driverGroup.deleteMany({ where: { id: { in: driverGroupIds } } });
  }
  if (agreementIds.length) {
    await prisma.agreement.deleteMany({ where: { id: { in: agreementIds } } });
  }
  if (userIds.length) {
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
  if (orgIds.length) {
    await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
  }

  created.orgIds.clear();
  created.userIds.clear();
  created.driverGroupIds.clear();
  created.agreementIds.clear();
}

// ── fixture builders ─────────────────────────────────────────────────────

/** A host org that owns one DriverGroup under one installation Agreement. */
async function makeOrgAndDriverGroup(label: string) {
  const prisma = getApiPrisma();
  const org = await prisma.organization.create({
    data: { displayName: `TEST parity ${label} org`, countryCode: "IS" },
    select: { id: true },
  });
  trackOrg(org.id);

  const agreement = await prisma.agreement.create({
    data: {
      agreementType: "installation",
      counterpartyOrgId: org.id,
      displayName: `TEST parity ${label} agreement`,
      effectiveFrom: new Date("2026-01-01T00:00:00Z"),
      status: "active",
    },
    select: { id: true },
  });
  trackAgreement(agreement.id);

  const driverGroup = await prisma.driverGroup.create({
    data: {
      agreementId: agreement.id,
      ownerOrgId: org.id,
      displayName: `TEST parity ${label} group`,
    },
    select: { id: true },
  });
  trackDriverGroup(driverGroup.id);

  return { orgId: org.id, agreementId: agreement.id, driverGroupId: driverGroup.id };
}

/** A plain user to act as the host-admin inviter (audience=operator). */
async function makeInviter() {
  const prisma = getApiPrisma();
  const inviter = await prisma.user.create({
    data: {
      email: `test-parity-inviter-${crypto.randomUUID()}@example.invalid`,
      audience: "operator",
      status: "active",
    },
    select: { id: true },
  });
  trackUser(inviter.id);
  return inviter.id;
}

/**
 * A driver already holding the group membership + a real password — the
 * "authenticated driver" side of the control-case reproduction, and a
 * ready-made caller for the mismatch tests.
 */
async function makeExistingDriver(driverGroupId: string, label: string) {
  const prisma = getApiPrisma();
  const email = `test-parity-${label}-${crypto.randomUUID()}@example.invalid`;
  const user = await prisma.user.create({
    data: { email, audience: "driver", status: "active" },
    select: { id: true },
  });
  trackUser(user.id);
  await prisma.userCredential.create({
    data: { userId: user.id, passwordHash: await hashPassword("Sup3rSecret!") },
  });
  await prisma.driverGroupMembership.create({
    data: { driverGroupId, userId: user.id },
  });
  return { userId: user.id, email };
}

/** Mint a driver invite exactly the way the host portal does. */
async function mintInvite(orgId: string, driverGroupId: string, invitedByUserId: string, email: string) {
  const prisma = getApiPrisma();
  const outcome = await createDriverInvite(prisma, {
    orgId,
    driverGroupId,
    email,
    invitedByUserId,
    ttlHours: 24,
  });
  if (!outcome.ok) {
    throw new Error(`fixture setup failed: createDriverInvite returned ${outcome.reason}`);
  }
  // createDriverInvite find-or-creates the invitee user; track it for cleanup.
  const tokenRow = await prisma.userToken.findUniqueOrThrow({
    where: { id: outcome.invite.tokenId },
    select: { userId: true },
  });
  trackUser(tokenRow.userId);
  return outcome.invite; // { token (plaintext), tokenId, driverGroupId, email, ... }
}

// ─────────────────────────────────────────────────────────────────────────

describe.skipIf(!hasDb)("ADR 0053 — driver invite redemption is identity-bound", () => {
  afterAll(closeAll);
  afterEach(cleanupAll);

  it("reproduces the June 2026 control case: a code minted for A is rejected when B redeems, and A can still redeem afterward", async () => {
    const { orgId, driverGroupId } = await makeOrgAndDriverGroup("control-case");
    const inviterId = await makeInviter();
    const invite = await mintInvite(orgId, driverGroupId, inviterId, "test-invite@example.invalid");
    const bystander = await makeExistingDriver(driverGroupId, "bystander");

    const bystanderToken = await accessTokenFor(bystander.userId, bystander.email);
    const rejectRes = await callRedeemInvite(bystanderToken, { token: invite.token });

    expect(rejectRes.status).toBe(404);
    const rejectBody = (await rejectRes.json()) as { error: string };
    expect(rejectBody.error).toBe("not_found");

    // Nothing was granted, and the invite was NOT burned — the exact
    // failure the June incident produced: a 200 that consumed the token
    // and left the real invitee with nothing. A rejected attempt today
    // must leave both of those unchanged.
    const prisma = getApiPrisma();
    const bystanderMembership = await prisma.driverGroupMembership.findUnique({
      where: { driverGroupId_userId: { driverGroupId, userId: bystander.userId } },
    });
    expect(bystanderMembership).toBeNull();

    const tokenAfterReject = await prisma.userToken.findUniqueOrThrow({
      where: { id: invite.tokenId },
      select: { usedAt: true },
    });
    expect(tokenAfterReject.usedAt).toBeNull();

    // The rejection is recorded server-side — the record the June incident
    // needed and did not have.
    const rejectionAudit = await prisma.auditAction.findFirst({
      where: { orgId, action: "driver_invite.redemption_rejected", targetId: invite.tokenId },
    });
    expect(rejectionAudit).not.toBeNull();
    expect(rejectionAudit?.actorUserId).toBe(bystander.userId);
    const meta = rejectionAudit?.metadata as Record<string, unknown>;
    expect(meta.attemptedByUserId).toBe(bystander.userId);

    // The real invitee can still redeem — this is the half that actually
    // cost the June invitee their invite.
    const tokenRow = await prisma.userToken.findUniqueOrThrow({
      where: { id: invite.tokenId },
      select: { userId: true, user: { select: { email: true } } },
    });
    // The invitee is a passwordless placeholder (ADR 0053 §4) — claim first.
    const claimRes = await callClaimInvite({ token: invite.token, password: "Sup3rSecret!" });
    expect(claimRes.status).toBe(200);

    const loginRes = await callLogin(tokenRow.user.email, "Sup3rSecret!");
    expect(loginRes.status).toBe(200);
    const { accessToken } = (await loginRes.json()) as { accessToken: string };

    const redeemRes = await callRedeemInvite(accessToken, { token: invite.token });
    expect(redeemRes.status).toBe(200);
    const redeemBody = (await redeemRes.json()) as { ok: boolean; driverGroupId: string };
    expect(redeemBody.ok).toBe(true);
    expect(redeemBody.driverGroupId).toBe(driverGroupId);

    const finalMembership = await prisma.driverGroupMembership.findUnique({
      where: { driverGroupId_userId: { driverGroupId, userId: tokenRow.userId } },
    });
    expect(finalMembership).not.toBeNull();
  });

  it("legitimate self-redemption succeeds without a claim step when the invitee already has a password", async () => {
    const { orgId, driverGroupId } = await makeOrgAndDriverGroup("self-redeem");
    const inviterId = await makeInviter();
    const email = `test-parity-self-${crypto.randomUUID()}@example.invalid`;
    const invite = await mintInvite(orgId, driverGroupId, inviterId, email);

    // Give the invitee a password directly (skips /claim-invite — this
    // exercises the "already had credentials somehow" branch of the same
    // route, not the bootstrap path).
    const prisma = getApiPrisma();
    const tokenRow = await prisma.userToken.findUniqueOrThrow({
      where: { id: invite.tokenId },
      select: { userId: true },
    });
    await prisma.userCredential.create({
      data: { userId: tokenRow.userId, passwordHash: await hashPassword("Sup3rSecret!") },
    });

    const accessToken = await accessTokenFor(tokenRow.userId, email);
    const res = await callRedeemInvite(accessToken, { token: invite.token });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);

    const membership = await prisma.driverGroupMembership.findUnique({
      where: { driverGroupId_userId: { driverGroupId, userId: tokenRow.userId } },
    });
    expect(membership).not.toBeNull();
  });

  it("replay: redeeming an already-used code still returns 410 already_used", async () => {
    const { orgId, driverGroupId } = await makeOrgAndDriverGroup("replay");
    const inviterId = await makeInviter();
    const email = `test-parity-replay-${crypto.randomUUID()}@example.invalid`;
    const invite = await mintInvite(orgId, driverGroupId, inviterId, email);

    const prisma = getApiPrisma();
    const tokenRow = await prisma.userToken.findUniqueOrThrow({
      where: { id: invite.tokenId },
      select: { userId: true },
    });
    await prisma.userCredential.create({
      data: { userId: tokenRow.userId, passwordHash: await hashPassword("Sup3rSecret!") },
    });
    const accessToken = await accessTokenFor(tokenRow.userId, email);

    const first = await callRedeemInvite(accessToken, { token: invite.token });
    expect(first.status).toBe(200);

    const second = await callRedeemInvite(accessToken, { token: invite.token });
    expect(second.status).toBe(410);
    const body = (await second.json()) as { error: string };
    expect(body.error).toBe("already_used");
  });

  it("already-a-member edge case: re-redeeming a still-valid code is a no-op grant, no duplicate membership, token still burned, no error", async () => {
    const { driverGroupId, orgId } = await makeOrgAndDriverGroup("already-member");
    const inviterId = await makeInviter();
    const email = `test-parity-already-member-${crypto.randomUUID()}@example.invalid`;
    const invite = await mintInvite(orgId, driverGroupId, inviterId, email);

    const prisma = getApiPrisma();
    const tokenRow = await prisma.userToken.findUniqueOrThrow({
      where: { id: invite.tokenId },
      select: { userId: true },
    });
    await prisma.userCredential.create({
      data: { userId: tokenRow.userId, passwordHash: await hashPassword("Sup3rSecret!") },
    });
    // Already a member BEFORE redeeming — e.g. added by another route, or a
    // second invite to the same group.
    await prisma.driverGroupMembership.create({
      data: { driverGroupId, userId: tokenRow.userId },
    });

    const accessToken = await accessTokenFor(tokenRow.userId, email);
    const res = await callRedeemInvite(accessToken, { token: invite.token });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);

    const memberships = await prisma.driverGroupMembership.findMany({
      where: { driverGroupId, userId: tokenRow.userId },
    });
    expect(memberships).toHaveLength(1); // no duplicate

    const tokenAfter = await prisma.userToken.findUniqueOrThrow({
      where: { id: invite.tokenId },
      select: { usedAt: true },
    });
    expect(tokenAfter.usedAt).not.toBeNull(); // still burned
  });

  it("expiry and unknown-code responses are unchanged, and the identity-mismatch response is byte-identical to unknown-code", async () => {
    const { orgId, driverGroupId } = await makeOrgAndDriverGroup("expiry-unknown-mismatch");
    const inviterId = await makeInviter();

    // -- unknown code: no such token exists at all.
    const someone = await makeExistingDriver(driverGroupId, "caller");
    const someoneToken = await accessTokenFor(someone.userId, someone.email);
    const unknownRes = await callRedeemInvite(someoneToken, { token: "totally-unknown-code-1234567890" });
    expect(unknownRes.status).toBe(404);
    const unknownBody = await unknownRes.json();
    expect(unknownBody).toEqual({ error: "not_found", message: "Boð fannst ekki." });

    // -- expired: minted, but already past expiresAt. createDriverInvite
    // only accepts ttlHours > 0, so mint normally then backdate expiresAt
    // directly — this exercises the SAME check the route always had; ADR
    // 0053 did not touch expiry handling.
    const expiredEmail = `test-parity-expired-${crypto.randomUUID()}@example.invalid`;
    const expiredInvite = await mintInvite(orgId, driverGroupId, inviterId, expiredEmail);
    const prisma = getApiPrisma();
    await prisma.userToken.update({
      where: { id: expiredInvite.tokenId },
      data: { expiresAt: new Date("2020-01-01T00:00:00Z") },
    });
    const expiredTokenRow = await prisma.userToken.findUniqueOrThrow({
      where: { id: expiredInvite.tokenId },
      select: { userId: true },
    });
    const expiredUserToken = await accessTokenFor(expiredTokenRow.userId, expiredEmail);
    const expiredRes = await callRedeemInvite(expiredUserToken, { token: expiredInvite.token });
    expect(expiredRes.status).toBe(410);
    const expiredBody = (await expiredRes.json()) as { error: string };
    expect(expiredBody.error).toBe("expired");

    // -- identity mismatch: minted for one user, redeemed by an unrelated
    // one. Must read as EXACTLY the unknown-code response — status and
    // body both — so the endpoint cannot be used to enumerate which codes
    // exist. This is ADR 0053's §3 in one assertion.
    const mismatchEmail = `test-parity-mismatch-bound-${crypto.randomUUID()}@example.invalid`;
    const mismatchInvite = await mintInvite(orgId, driverGroupId, inviterId, mismatchEmail);
    const stranger = await makeExistingDriver(driverGroupId, "stranger");
    const strangerToken = await accessTokenFor(stranger.userId, stranger.email);
    const mismatchRes = await callRedeemInvite(strangerToken, { token: mismatchInvite.token });
    expect(mismatchRes.status).toBe(unknownRes.status);
    const mismatchBody = await mismatchRes.json();
    expect(mismatchBody).toEqual(unknownBody);
  });

  it("cross-tenant mint guard is unchanged: an org cannot mint an invite into a DriverGroup it doesn't own", async () => {
    const groupOwner = await makeOrgAndDriverGroup("cross-tenant-owner");
    const otherOrg = await makeOrgAndDriverGroup("cross-tenant-other");
    const inviterId = await makeInviter();

    const outcome = await createDriverInvite(getApiPrisma(), {
      orgId: otherOrg.orgId, // does NOT own groupOwner.driverGroupId
      driverGroupId: groupOwner.driverGroupId,
      email: `test-parity-cross-tenant-${crypto.randomUUID()}@example.invalid`,
      invitedByUserId: inviterId,
      ttlHours: 24,
    });

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reason).toBe("driver_group_wrong_org");
    }

    // No token should have been minted for the attempt.
    const prisma = getApiPrisma();
    const tokens = await prisma.userToken.findMany({
      where: { driverGroupId: groupOwner.driverGroupId, kind: "driver" },
    });
    expect(tokens).toHaveLength(0);
  });

  it("POST /api/public/invites/consume (org invites, ADR 0026) is untouched by ADR 0053", async () => {
    const prisma = getApiPrisma();
    const org = await prisma.organization.create({
      data: { displayName: "TEST parity org-invite org", countryCode: "IS" },
      select: { id: true },
    });
    trackOrg(org.id);

    const email = `test-parity-org-invite-${crypto.randomUUID()}@example.invalid`;
    const user = await prisma.user.create({
      data: { email, audience: "operator", status: "active" },
      select: { id: true },
    });
    trackUser(user.id);

    await prisma.membership.create({
      data: { orgId: org.id, userId: user.id, role: "admin", status: "invited" },
    });

    const plaintext = crypto.randomUUID();
    const tokenHash = await sha256Hex(plaintext);
    const orgInviteToken = await prisma.userToken.create({
      data: {
        userId: user.id,
        kind: "invite",
        tokenHash,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        metadata: { orgId: org.id, role: "admin", email },
      },
      select: { id: true },
    });

    const res = await callConsumeOrgInvite({ token: plaintext, password: "Sup3rSecret!" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; userId: string; orgId: string; email: string };
    expect(body).toEqual({ ok: true, userId: user.id, orgId: org.id, email });

    const membership = await prisma.membership.findUnique({
      where: { orgId_userId: { orgId: org.id, userId: user.id } },
      select: { status: true },
    });
    expect(membership?.status).toBe("active");

    const tokenAfter = await prisma.userToken.findUniqueOrThrow({
      where: { id: orgInviteToken.id },
      select: { usedAt: true },
    });
    expect(tokenAfter.usedAt).not.toBeNull();
  });
});

describe.skipIf(!hasDb)("ADR 0053 §4 — POST /api/driver/claim-invite", () => {
  afterAll(closeAll);
  afterEach(cleanupAll);

  it("sets a credential on the bound user only, and leaves the token unconsumed", async () => {
    const { orgId, driverGroupId } = await makeOrgAndDriverGroup("claim-bound-only");
    const inviterId = await makeInviter();
    const boundEmail = `test-parity-claim-bound-${crypto.randomUUID()}@example.invalid`;
    const invite = await mintInvite(orgId, driverGroupId, inviterId, boundEmail);

    // An unrelated, credential-less user — must be untouched by the claim.
    // This is the "only the bound user" half of the assertion; the other
    // half (refusing to touch a user who already HAS a credential) is its
    // own test below, since that is the actually load-bearing rule.
    const prisma = getApiPrisma();
    const untouched = await prisma.user.create({
      data: {
        email: `test-parity-claim-untouched-${crypto.randomUUID()}@example.invalid`,
        audience: "driver",
        status: "active",
      },
      select: { id: true },
    });
    trackUser(untouched.id);

    const res = await callClaimInvite({ token: invite.token, password: "Sup3rSecret!" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; email: string };
    expect(body).toEqual({ ok: true, email: boundEmail });

    const tokenRow = await prisma.userToken.findUniqueOrThrow({
      where: { id: invite.tokenId },
      select: { userId: true, usedAt: true },
    });
    // Claiming is not redeeming — the token stays unconsumed.
    expect(tokenRow.usedAt).toBeNull();

    const boundCredential = await prisma.userCredential.findUnique({
      where: { userId: tokenRow.userId },
    });
    expect(boundCredential).not.toBeNull();

    const untouchedCredential = await prisma.userCredential.findUnique({
      where: { userId: untouched.id },
    });
    expect(untouchedCredential).toBeNull();

    const boundUser = await prisma.user.findUniqueOrThrow({
      where: { id: tokenRow.userId },
      select: { emailVerifiedAt: true },
    });
    expect(boundUser.emailVerifiedAt).not.toBeNull();

    const claimAudit = await prisma.auditAction.findFirst({
      where: { orgId, action: "driver_invite.claimed", targetId: invite.tokenId },
    });
    expect(claimAudit).not.toBeNull();
  });

  it("refuses with 409 already_claimed when the bound user already has a credential, and does not overwrite it", async () => {
    const { orgId, driverGroupId } = await makeOrgAndDriverGroup("claim-already-claimed");
    const inviterId = await makeInviter();
    const email = `test-parity-claim-already-${crypto.randomUUID()}@example.invalid`;
    const invite = await mintInvite(orgId, driverGroupId, inviterId, email);

    const prisma = getApiPrisma();
    const tokenRow = await prisma.userToken.findUniqueOrThrow({
      where: { id: invite.tokenId },
      select: { userId: true },
    });
    const originalHash = await hashPassword("OriginalPassword1");
    await prisma.userCredential.create({
      data: { userId: tokenRow.userId, passwordHash: originalHash },
    });

    const res = await callClaimInvite({ token: invite.token, password: "AttackerChosenPassword1" });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("already_claimed");

    const credentialAfter = await prisma.userCredential.findUniqueOrThrow({
      where: { userId: tokenRow.userId },
    });
    expect(credentialAfter.passwordHash).toBe(originalHash);
  });

  it("full loop: claim → login → redeem completes end to end for a fresh invitee", async () => {
    const { orgId, driverGroupId } = await makeOrgAndDriverGroup("claim-login-redeem");
    const inviterId = await makeInviter();
    const email = `test-parity-full-loop-${crypto.randomUUID()}@example.invalid`;
    const invite = await mintInvite(orgId, driverGroupId, inviterId, email);

    const claimRes = await callClaimInvite({ token: invite.token, password: "Sup3rSecret!" });
    expect(claimRes.status).toBe(200);

    const loginRes = await callLogin(email, "Sup3rSecret!");
    expect(loginRes.status).toBe(200);
    const { accessToken } = (await loginRes.json()) as { accessToken: string };

    const redeemRes = await callRedeemInvite(accessToken, { token: invite.token });
    expect(redeemRes.status).toBe(200);
    const redeemBody = (await redeemRes.json()) as { ok: boolean; driverGroupId: string };
    expect(redeemBody.ok).toBe(true);
    expect(redeemBody.driverGroupId).toBe(driverGroupId);

    const prisma = getApiPrisma();
    const tokenRow = await prisma.userToken.findUniqueOrThrow({
      where: { id: invite.tokenId },
      select: { userId: true, usedAt: true },
    });
    expect(tokenRow.usedAt).not.toBeNull();
    const membership = await prisma.driverGroupMembership.findUnique({
      where: { driverGroupId_userId: { driverGroupId, userId: tokenRow.userId } },
    });
    expect(membership).not.toBeNull();
  });
});
