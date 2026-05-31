import { describe, it, expect } from "vitest";
import { renderPasswordResetEmail } from "./password-reset";

describe("renderPasswordResetEmail", () => {
  const baseInput = {
    displayName: "Driver One",
    resetUrl: "https://hlada-staging.straumvakt.workers.dev/password-reset/xyz789",
    expiresAt: new Date("2026-05-31T15:30:00Z"),
  };

  it("returns subject naming password reset", () => {
    const out = renderPasswordResetEmail(baseInput);
    expect(out.subject).toContain("Reset your Straumvakt password");
  });

  it("embeds the reset URL in both html and text", () => {
    const out = renderPasswordResetEmail(baseInput);
    expect(out.html).toContain(baseInput.resetUrl);
    expect(out.text).toContain(baseInput.resetUrl);
  });

  it("includes the anti-enumeration safe-to-ignore phrasing", () => {
    const out = renderPasswordResetEmail(baseInput);
    expect(out.html).toContain("safely ignore");
    expect(out.text).toContain("ignore");
  });

  it("falls back to a neutral greeting when display name missing", () => {
    const out = renderPasswordResetEmail({ ...baseInput, displayName: null });
    expect(out.html).toContain("Hi there");
    expect(out.text).toContain("Hi there");
  });
});
