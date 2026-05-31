/**
 * access-request-submitted.ts — driver-facing receipt email.
 *
 * ADR 0022 / 2026-05-31 — sent when a self-registered driver clicks
 * "Request access to this charger" in the mobile app. Confirms the
 * request is logged and tells them an operator will review it. No
 * action required from the driver; this is a "we got it" receipt.
 */
import { emailLayout, heading, paragraph, ctaButton, fallbackLinkLine } from "./common";

export interface AccessRequestSubmittedEmailInput {
  /** Where the driver requested access, e.g. "Dalvegur — Kópavogur". */
  installationDisplayName: string;
  /** Optional site name for richer body copy. */
  siteDisplayName?: string;
  /** Driver's display name (falls back to email if not set upstream). */
  driverName: string;
  /** When the request was created — rendered Reykjavík-local. */
  createdAt: Date;
  /** Deep link into the mobile app so the driver can see request status. */
  statusUrl: string;
}

export interface EmailContent {
  subject: string;
  html: string;
  text: string;
}

export function renderAccessRequestSubmittedEmail(
  input: AccessRequestSubmittedEmailInput,
): EmailContent {
  const subject = `Your access request for ${input.installationDisplayName} is pending`;
  const createdHuman = input.createdAt.toLocaleString("en-IS", {
    timeZone: "Atlantic/Reykjavik",
    dateStyle: "long",
    timeStyle: "short",
  });
  const location = input.siteDisplayName
    ? `${input.installationDisplayName} (${input.siteDisplayName})`
    : input.installationDisplayName;

  const body =
    heading("Request received") +
    paragraph(`Hi ${input.driverName},`) +
    paragraph(
      `We've logged your request to charge at ${location}. An operator will review it shortly — you'll get another email as soon as a decision is made.`,
    ) +
    paragraph(
      "There's nothing else you need to do right now. Most requests are reviewed within one business day.",
    ) +
    ctaButton("View request status", input.statusUrl) +
    fallbackLinkLine(
      "Button not clicking? Paste this link in your browser:",
      input.statusUrl,
    );

  const html = emailLayout({
    preheader: `Your access request for ${input.installationDisplayName} is being reviewed.`,
    body,
    footerNote: `Requested on ${createdHuman} (Reykjavík time). If this wasn't you, contact your operator immediately.`,
  });

  const text =
    `Hi ${input.driverName},\n\n` +
    `We've logged your request to charge at ${location}. An operator will review it shortly.\n\n` +
    `Most requests are reviewed within one business day. You'll get another email when a decision is made.\n\n` +
    `View request status:\n${input.statusUrl}\n\n` +
    `Requested ${createdHuman} (Reykjavík time).\n\n` +
    `Straumvakt`;

  return { subject, html, text };
}
