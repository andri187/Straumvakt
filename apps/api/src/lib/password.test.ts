// PBKDF2 password hashing tests.

import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password";

describe("hashPassword + verifyPassword", () => {
  it("verifies the same plaintext against its own hash", async () => {
    const stored = await hashPassword("correct horse battery staple");
    expect(stored.startsWith("pbkdf2:sha256:")).toBe(true);
    expect(await verifyPassword("correct horse battery staple", stored)).toBe(true);
  });

  it("rejects a different plaintext", async () => {
    const stored = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("wrong password", stored)).toBe(false);
  });

  it("each hash uses a fresh random salt (same plaintext → different hashes)", async () => {
    const a = await hashPassword("samepw");
    const b = await hashPassword("samepw");
    expect(a).not.toBe(b);
    // But both verify.
    expect(await verifyPassword("samepw", a)).toBe(true);
    expect(await verifyPassword("samepw", b)).toBe(true);
  });

  it("rejects malformed stored shapes", async () => {
    expect(await verifyPassword("x", "")).toBe(false);
    expect(await verifyPassword("x", "garbage")).toBe(false);
    expect(await verifyPassword("x", "pbkdf2:sha256:100:notb64:notb64")).toBe(false);
    expect(await verifyPassword("x", "argon2:something:else:..")).toBe(false);
  });

  it("rejects empty plaintext", async () => {
    await expect(hashPassword("")).rejects.toThrow("password_empty");
    const stored = await hashPassword("hunter2");
    expect(await verifyPassword("", stored)).toBe(false);
  });
});
