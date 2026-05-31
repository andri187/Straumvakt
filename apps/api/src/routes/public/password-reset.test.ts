// Sprint 9 / ENROLL-1 — password-reset route handler tests.

import { describe, it, expect, vi, beforeEach } from "vitest";

const { initiateMock, confirmMock } = vi.hoisted(() => ({
  initiateMock: vi.fn(),
  confirmMock: vi.fn(),
}));

vi.mock("../../repositories/registration", () => ({
  initiatePasswordReset: initiateMock,
  confirmPasswordReset: confirmMock,
}));

vi.mock("../../lib/prisma", () => ({
  makePrisma: () => ({}),
}));

import { publicPasswordReset } from "./password-reset";
import type { Env } from "../../bindings";

const TEST_ENV = {} as unknown as Env;

function postJson(path: string, body: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/public/password-reset", () => {
  beforeEach(() => {
    initiateMock.mockReset();
    confirmMock.mockReset();
  });

  it("returns 400 on missing email", async () => {
    const res = await publicPasswordReset.fetch(postJson("/", {}), TEST_ENV);
    expect(res.status).toBe(400);
  });

  it("returns 400 on bad email format", async () => {
    const res = await publicPasswordReset.fetch(
      postJson("/", { email: "not-an-email" }),
      TEST_ENV,
    );
    expect(res.status).toBe(400);
  });

  it("returns 200/ok regardless of whether email is known (anti-enumeration)", async () => {
    initiateMock.mockResolvedValueOnce(undefined);
    const res = await publicPasswordReset.fetch(
      postJson("/", { email: "unknown@example.com" }),
      TEST_ENV,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it("calls initiatePasswordReset with baseUrl from Origin header", async () => {
    initiateMock.mockResolvedValueOnce(undefined);
    const req = new Request("http://localhost/", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://example.test",
      },
      body: JSON.stringify({ email: "test@example.com" }),
    });
    await publicPasswordReset.fetch(req, TEST_ENV);
    expect(initiateMock).toHaveBeenCalledOnce();
    const arg = initiateMock.mock.calls[0]![2] as { baseUrl: string };
    expect(arg.baseUrl).toBe("https://example.test");
  });
});

describe("POST /api/public/password-reset/confirm/:token", () => {
  beforeEach(() => {
    confirmMock.mockReset();
  });

  it("returns 404 on short token", async () => {
    const res = await publicPasswordReset.fetch(
      postJson("/confirm/short", { newPassword: "supersecretpw" }),
      TEST_ENV,
    );
    expect(res.status).toBe(404);
  });

  it("returns 400 on short password", async () => {
    const res = await publicPasswordReset.fetch(
      postJson("/confirm/abcdefghij", { newPassword: "short" }),
      TEST_ENV,
    );
    expect(res.status).toBe(400);
  });

  it("returns 404 when repo says invalid", async () => {
    confirmMock.mockResolvedValueOnce({
      ok: false,
      reason: "invalid_or_expired",
    });
    const res = await publicPasswordReset.fetch(
      postJson("/confirm/abcdefghij", { newPassword: "supersecretpw" }),
      TEST_ENV,
    );
    expect(res.status).toBe(404);
  });

  it("returns 200/ok on success", async () => {
    confirmMock.mockResolvedValueOnce({ ok: true });
    const res = await publicPasswordReset.fetch(
      postJson("/confirm/abcdefghij", { newPassword: "supersecretpw" }),
      TEST_ENV,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });
});
