// Sprint 9 / ENROLL-1 — GET /api/public/verify-email/:token response mapping.

import { describe, it, expect, vi, beforeEach } from "vitest";

const { consumeMock } = vi.hoisted(() => ({
  consumeMock: vi.fn(),
}));

vi.mock("../../repositories/registration", () => ({
  consumeEmailVerification: consumeMock,
}));

vi.mock("../../lib/prisma", () => ({
  makePrisma: () => ({}),
}));

import { publicEmailVerification } from "./email-verification";
import type { Env } from "../../bindings";

const TEST_ENV = {} as unknown as Env;

function makeReq(token: string, method: "GET" | "POST" = "GET"): Request {
  return new Request(`http://localhost/${token}`, { method });
}

describe("GET /api/public/verify-email/:token", () => {
  beforeEach(() => consumeMock.mockReset());

  it("returns 404 on missing/short token", async () => {
    const res = await publicEmailVerification.fetch(makeReq("x"), TEST_ENV);
    expect(res.status).toBe(404);
  });

  it("returns 404 when repo says invalid", async () => {
    consumeMock.mockResolvedValueOnce({
      ok: false,
      reason: "invalid_or_expired",
    });
    const res = await publicEmailVerification.fetch(
      makeReq("abcdefghij"),
      TEST_ENV,
    );
    expect(res.status).toBe(404);
  });

  it("returns auto_join_granted shape on policy=auto_join + group", async () => {
    consumeMock.mockResolvedValueOnce({
      ok: true,
      user: {
        id: "u1",
        email: "x@n1.is",
        emailVerifiedAt: "2026-05-31T00:00:00.000Z",
      },
      accessOutcome: {
        kind: "auto_join_granted",
        membershipId: "m1",
        driverGroupId: "dg1",
      },
    });
    const res = await publicEmailVerification.fetch(
      makeReq("abcdefghij"),
      TEST_ENV,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      verified: boolean;
      accessGranted: boolean;
      membershipId: string;
      driverGroupId: string;
    };
    expect(body.verified).toBe(true);
    expect(body.accessGranted).toBe(true);
    expect(body.membershipId).toBe("m1");
    expect(body.driverGroupId).toBe("dg1");
  });

  it("returns request_pending shape", async () => {
    consumeMock.mockResolvedValueOnce({
      ok: true,
      user: {
        id: "u1",
        email: "x@n1.is",
        emailVerifiedAt: "2026-05-31T00:00:00.000Z",
      },
      accessOutcome: { kind: "request_pending", accessRequestId: "req-1" },
    });
    const res = await publicEmailVerification.fetch(
      makeReq("abcdefghij"),
      TEST_ENV,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      verified: boolean;
      accessGranted: boolean;
      accessRequestId: string;
    };
    expect(body.verified).toBe(true);
    expect(body.accessGranted).toBe(false);
    expect(body.accessRequestId).toBe("req-1");
  });

  it("returns no_match passthrough with outcome label", async () => {
    consumeMock.mockResolvedValueOnce({
      ok: true,
      user: {
        id: "u1",
        email: "x@unknown.com",
        emailVerifiedAt: "2026-05-31T00:00:00.000Z",
      },
      accessOutcome: { kind: "no_match" },
    });
    const res = await publicEmailVerification.fetch(
      makeReq("abcdefghij"),
      TEST_ENV,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      verified: boolean;
      accessGranted: boolean;
      outcome: string;
    };
    expect(body.accessGranted).toBe(false);
    expect(body.outcome).toBe("no_match");
  });

  it("POST alias works identically", async () => {
    consumeMock.mockResolvedValueOnce({
      ok: true,
      user: {
        id: "u1",
        email: "x@n1.is",
        emailVerifiedAt: "2026-05-31T00:00:00.000Z",
      },
      accessOutcome: { kind: "no_match" },
    });
    const res = await publicEmailVerification.fetch(
      makeReq("abcdefghij", "POST"),
      TEST_ENV,
    );
    expect(res.status).toBe(200);
  });
});
