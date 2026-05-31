// Sprint 9 / ENROLL-1 — POST /api/public/register validation + happy path.
//
// The repository (registerDriver) is mocked at module-load time so the
// route test only exercises Zod parsing, rate-limit fail-open, the
// origin → baseUrl derivation, and the response shape mapping. Repo
// behaviour is tested in registration.test.ts.

import { describe, it, expect, vi, beforeEach } from "vitest";

const { registerDriverMock } = vi.hoisted(() => ({
  registerDriverMock: vi.fn(),
}));

vi.mock("../../repositories/registration", () => ({
  registerDriver: registerDriverMock,
}));

vi.mock("../../lib/prisma", () => ({
  makePrisma: () => ({}),
}));

import { publicRegister } from "./register";
import type { Env } from "../../bindings";

const VALID_BODY = {
  email: "driver@n1.is",
  password: "supersecretpw",
  kennitala: "1234567890",
  displayName: "Driver One",
  acceptedTos: true,
  acceptedPrivacy: true,
};

// Hono's Bindings type is exact; tests pass a minimal stub through
// `unknown as Env`. The rate-limit binding is undefined so the
// middleware fails-open with a warn (matches dev env behaviour).
const TEST_ENV = {} as unknown as Env;

function makeRequest(body: unknown, init?: { origin?: string }): Request {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (init?.origin) headers["origin"] = init.origin;
  return new Request("http://localhost/", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

describe("POST /api/public/register", () => {
  beforeEach(() => {
    registerDriverMock.mockReset();
  });

  it("returns 400 on missing required fields", async () => {
    const res = await publicRegister.fetch(makeRequest({ email: "x@y.z" }), TEST_ENV);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("validation");
  });

  it("returns 400 on bad kennitala (not 10 digits)", async () => {
    const res = await publicRegister.fetch(
      makeRequest({ ...VALID_BODY, kennitala: "12345" }),
      TEST_ENV,
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 if acceptedTos is false", async () => {
    const res = await publicRegister.fetch(
      makeRequest({ ...VALID_BODY, acceptedTos: false }),
      TEST_ENV,
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 if password too short", async () => {
    const res = await publicRegister.fetch(
      makeRequest({ ...VALID_BODY, password: "short" }),
      TEST_ENV,
    );
    expect(res.status).toBe(400);
  });

  it("returns 409 with email_taken when repo reports duplicate email", async () => {
    registerDriverMock.mockResolvedValueOnce({ ok: false, reason: "email_taken" });
    const res = await publicRegister.fetch(makeRequest(VALID_BODY), TEST_ENV);
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("email_taken");
  });

  it("returns 409 with kennitala_taken when repo reports duplicate kennitala", async () => {
    registerDriverMock.mockResolvedValueOnce({
      ok: false,
      reason: "kennitala_taken",
    });
    const res = await publicRegister.fetch(makeRequest(VALID_BODY), TEST_ENV);
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("kennitala_taken");
  });

  it("returns 201 with user + email summary on success", async () => {
    registerDriverMock.mockResolvedValueOnce({
      ok: true,
      user: {
        id: "user-uuid-1",
        email: "driver@n1.is",
        status: "active",
        emailVerifiedAt: null,
      },
      email: { sent: true, id: "email_id_1", reason: null },
    });
    const res = await publicRegister.fetch(
      makeRequest(VALID_BODY, { origin: "https://example.test" }),
      TEST_ENV,
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      user: { id: string };
      email: { sent: boolean };
    };
    expect(body.user.id).toBe("user-uuid-1");
    expect(body.email.sent).toBe(true);
    expect(registerDriverMock).toHaveBeenCalledOnce();
    const firstCall = registerDriverMock.mock.calls[0]![2] as {
      baseUrl: string;
    };
    expect(firstCall.baseUrl).toBe("https://example.test");
  });

  it("rejects unknown fields (strict mode)", async () => {
    const res = await publicRegister.fetch(
      makeRequest({ ...VALID_BODY, extraneous: "junk" }),
      TEST_ENV,
    );
    expect(res.status).toBe(400);
  });
});
