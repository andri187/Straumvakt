// Smoke tests for the four access-request email templates
// (Sprint 9 ENROLL-2). Verifies subject lines, mandatory body fragments,
// and that the rendered HTML escapes user-supplied input.

import { describe, expect, it } from "vitest";
import { renderAccessRequestSubmittedEmail } from "./access-request-submitted";
import { renderAccessRequestApprovedEmail } from "./access-request-approved";
import { renderAccessRequestDeniedEmail } from "./access-request-denied";
import { renderAccessRequestInboundEmail } from "./access-request-inbound";

const FIXED_DATE = new Date("2026-05-31T12:00:00.000Z");

describe("renderAccessRequestSubmittedEmail", () => {
  it("renders subject + html + text with the installation name", () => {
    const out = renderAccessRequestSubmittedEmail({
      installationDisplayName: "Dalvegur",
      siteDisplayName: "Kópavogur",
      driverName: "Ásta Driver",
      createdAt: FIXED_DATE,
      statusUrl: "https://hlada-staging.straumvakt.workers.dev/account/access-requests",
    });
    expect(out.subject).toContain("Dalvegur");
    expect(out.subject).toContain("pending");
    expect(out.html).toContain("Dalvegur");
    expect(out.html).toContain("Kópavogur");
    expect(out.html).toContain("Ásta Driver");
    expect(out.text).toContain("Dalvegur");
    expect(out.text).toContain("Ásta Driver");
  });

  it("renders without the optional site name", () => {
    const out = renderAccessRequestSubmittedEmail({
      installationDisplayName: "Solo Installation",
      driverName: "Driver",
      createdAt: FIXED_DATE,
      statusUrl: "https://example.test",
    });
    expect(out.html).toContain("Solo Installation");
    expect(out.html).not.toContain("undefined");
  });
});

describe("renderAccessRequestApprovedEmail", () => {
  it("includes the approver name when supplied", () => {
    const out = renderAccessRequestApprovedEmail({
      installationDisplayName: "Dalvegur",
      driverName: "Driver",
      approvedAt: FIXED_DATE,
      chargersUrl: "https://example.test/chargers",
      approvedBy: "Operator Olafur",
    });
    expect(out.subject).toContain("Dalvegur");
    expect(out.html).toContain("Operator Olafur approved your request");
  });

  it("falls back when approver is omitted", () => {
    const out = renderAccessRequestApprovedEmail({
      installationDisplayName: "Dalvegur",
      driverName: "Driver",
      approvedAt: FIXED_DATE,
      chargersUrl: "https://example.test/chargers",
    });
    expect(out.html).toContain("Your request was approved");
  });
});

describe("renderAccessRequestDeniedEmail", () => {
  it("surfaces the denial reason in body + text", () => {
    const out = renderAccessRequestDeniedEmail({
      installationDisplayName: "Dalvegur",
      driverName: "Driver",
      denialReason: "Customer agreement expired",
      deniedAt: FIXED_DATE,
      supportUrl: "https://example.test/installations",
    });
    expect(out.subject).toContain("declined");
    expect(out.html).toContain("Customer agreement expired");
    expect(out.text).toContain("Customer agreement expired");
  });

  it("escapes HTML in the denial reason to prevent injection", () => {
    const out = renderAccessRequestDeniedEmail({
      installationDisplayName: "Dalvegur",
      driverName: "Driver",
      denialReason: "<script>evil()</script>",
      deniedAt: FIXED_DATE,
      supportUrl: "https://example.test",
    });
    expect(out.html).not.toContain("<script>evil()</script>");
    expect(out.html).toContain("&lt;script&gt;");
  });
});

describe("renderAccessRequestInboundEmail", () => {
  it("renders for the self-request trigger", () => {
    const out = renderAccessRequestInboundEmail({
      driverName: "Ásta Driver",
      driverEmail: "asta@example.is",
      installationDisplayName: "Dalvegur",
      siteDisplayName: "Kópavogur",
      requestedAt: FIXED_DATE,
      triggeredBy: "self_request",
      inboxUrl: "https://example.test/people/access-requests",
    });
    expect(out.subject).toContain("Ásta Driver");
    expect(out.subject).toContain("Dalvegur");
    expect(out.html).toContain("Triggered from the driver app");
    expect(out.html).toContain("asta@example.is");
  });

  it("uses different copy for the email-domain-match trigger", () => {
    const out = renderAccessRequestInboundEmail({
      driverName: "Driver",
      driverEmail: "driver@n1.is",
      installationDisplayName: "Dalvegur",
      requestedAt: FIXED_DATE,
      triggeredBy: "email_domain_match",
      inboxUrl: "https://example.test/people/access-requests",
    });
    expect(out.html).toContain("email-domain rule");
  });
});
