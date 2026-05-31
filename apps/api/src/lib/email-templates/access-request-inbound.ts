/**
 * access-request-inbound.ts — operator-facing inbox notification.
 *
 * ADR 0022 / 2026-05-31 — sent to the org's main contact (or any role
 * with member.write — pilot just hits Organization.mainContactUserId)
 * when a self-registered driver requests access to one of their
 * installations. CTA goes to /people/access-requests in the operator
 * console.
 */
import { emailLayout, heading, paragraph, ctaButton, fallbackLinkLine } from "./common";

export interface AccessRequestInboundEmailInput {
  /** Driver who issued the request. */
  driverName: string;
  driverEmail: string;
  /** Installation they want to charge at. */
  installationDisplayName: string;
  siteDisplayName?: string;
  /** Receipt-style timestamp. */
  requestedAt: Date;
  /** Trigger source — UI distinguishes self-request from email-domain-match in copy. */
  triggeredBy: "self_request" | "email_domain_match";
  /** Operator-console deep link to the inbox row. */
  inboxUrl: string;
}

export interface EmailContent {
  subject: string;
  html: string;
  text: string;
}

export function renderAccessRequestInboundEmail(
  input: AccessRequestInboundEmailInput,
): EmailContent {
  const subject = `${input.driverName} requested access to ${input.installationDisplayName}`;
  const requestedHuman = input.requestedAt.toLocaleString("en-IS", {
    timeZone: "Atlantic/Reykjavik",
    dateStyle: "long",
    timeStyle: "short",
  });
  const location = input.siteDisplayName
    ? `${input.installationDisplayName} (${input.siteDisplayName})`
    : input.installationDisplayName;
  const triggerLine =
    input.triggeredBy === "email_domain_match"
      ? "Your org's email-domain rule routed this for manual approval."
      : "Triggered from the driver app's request-access flow.";

  const body =
    heading("New access request") +
    paragraph(
      `${input.driverName} (${input.driverEmail}) wants to charge at ${location}.`,
    ) +
    paragraph(triggerLine) +
    paragraph(
      "Review the request and choose approve or deny in the operator console. Denying requires a short reason that goes to the driver.",
    ) +
    ctaButton("Review access requests", input.inboxUrl) +
    fallbackLinkLine(
      "Button not clicking? Paste this link in your browser:",
      input.inboxUrl,
    );

  const html = emailLayout({
    preheader: `New access request from ${input.driverName} for ${input.installationDisplayName}.`,
    body,
    footerNote: `Submitted on ${requestedHuman} (Reykjavík time). One email per request; if you batch-approve, you'll get one email per row.`,
  });

  const text =
    `New access request\n\n` +
    `${input.driverName} (${input.driverEmail}) wants to charge at ${location}.\n` +
    `${triggerLine}\n\n` +
    `Review in the operator console:\n${input.inboxUrl}\n\n` +
    `Submitted ${requestedHuman} (Reykjavík time).\n\n` +
    `Straumvakt`;

  return { subject, html, text };
}
