import { describe, it, expect } from "vitest";
import { renderVerifyEmail } from "./verify-email";

describe("renderVerifyEmail", () => {
  const baseInput = {
    displayName: "Driver One",
    verifyUrl: "https://hlada-staging.straumvakt.workers.dev/verify-email/abc123",
    expiresAt: new Date("2026-05-31T15:30:00Z"),
  };

  it("returns subject mentioning verify + Straumvakt", () => {
    const out = renderVerifyEmail(baseInput);
    expect(out.subject).toContain("Verify your email");
    expect(out.subject).toContain("Straumvakt");
  });

  it("embeds the verify URL in both html and text", () => {
    const out = renderVerifyEmail(baseInput);
    expect(out.html).toContain(baseInput.verifyUrl);
    expect(out.text).toContain(baseInput.verifyUrl);
  });

  it("uses display name in body when given", () => {
    const out = renderVerifyEmail(baseInput);
    expect(out.html).toContain("Driver One");
    expect(out.text).toContain("Driver One");
  });

  it("falls back to a neutral greeting when display name missing", () => {
    const out = renderVerifyEmail({ ...baseInput, displayName: null });
    expect(out.html).toContain("Hi there");
    expect(out.text).toContain("Hi there");
  });

  it("renders an expiry note in Reykjavík time", () => {
    const out = renderVerifyEmail(baseInput);
    // The localised string contains the year and zone hint at minimum.
    expect(out.html).toContain("Reykjavík time");
    expect(out.text).toContain("Reykjavík time");
  });
});
