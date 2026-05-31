/**
 * access-request-denied.ts — driver-facing decline notification.
 *
 * ADR 0022 / 2026-05-31 — sent when an operator denies a pending
 * DriverAccessRequest. The operator MUST supply a denial reason at
 * the inbox endpoint; we render that reason inline so the driver
 * knows whether to follow up out-of-band or accept the outcome.
 */
import { emailLayout, heading, paragraph, ctaButton, fallbackLinkLine } from "./common";

export interface AccessRequestDeniedEmailInput {
  installationDisplayName: string;
  siteDisplayName?: string;
  driverName: string;
  /** Required text the operator typed when denying. */
  denialReason: string;
  /** When the operator denied — rendered Reykjavík-local. */
  deniedAt: Date;
  /** Deep link the driver can use to contact their operator / browse other installations. */
  supportUrl: string;
}

export interface EmailContent {
  subject: string;
  html: string;
  text: string;
}

export function renderAccessRequestDeniedEmail(
  input: AccessRequestDeniedEmailInput,
): EmailContent {
  const subject = `Your request for ${input.installationDisplayName} was declined`;
  const deniedHuman = input.deniedAt.toLocaleString("en-IS", {
    timeZone: "Atlantic/Reykjavik",
    dateStyle: "long",
    timeStyle: "short",
  });
  const location = input.siteDisplayName
    ? `${input.installationDisplayName} (${input.siteDisplayName})`
    : input.installationDisplayName;

  const body =
    heading("Request declined") +
    paragraph(`Hi ${input.driverName},`) +
    paragraph(
      `We're sorry — your request to charge at ${location} wasn't approved this time.`,
    ) +
    paragraph(`Reason: ${input.denialReason}`) +
    paragraph(
      "If you think this was a mistake, contact the operator listed in the app, or browse other installations you have access to.",
    ) +
    ctaButton("Find another installation", input.supportUrl) +
    fallbackLinkLine(
      "Button not clicking? Paste this link in your browser:",
      input.supportUrl,
    );

  const html = emailLayout({
    preheader: `Your access request for ${input.installationDisplayName} was declined.`,
    body,
    footerNote: `Declined on ${deniedHuman} (Reykjavík time).`,
  });

  const text =
    `Hi ${input.driverName},\n\n` +
    `Your request to charge at ${location} wasn't approved.\n\n` +
    `Reason: ${input.denialReason}\n\n` +
    `If you think this was a mistake, contact the operator listed in the app.\n\n` +
    `Find another installation:\n${input.supportUrl}\n\n` +
    `Declined ${deniedHuman} (Reykjavík time).\n\n` +
    `Straumvakt`;

  return { subject, html, text };
}
