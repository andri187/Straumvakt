/**
 * access-request-approved.ts — driver-facing approval notification.
 *
 * ADR 0022 / 2026-05-31 — sent when an operator approves a pending
 * DriverAccessRequest. The driver now has a DriverGroupMembership row
 * that grants charging access at the named installation. Send-stop:
 * tell them they can charge, point them at the app.
 */
import { emailLayout, heading, paragraph, ctaButton, fallbackLinkLine } from "./common";

export interface AccessRequestApprovedEmailInput {
  installationDisplayName: string;
  siteDisplayName?: string;
  driverName: string;
  /** When the operator approved — rendered Reykjavík-local. */
  approvedAt: Date;
  /** Deep link to the chargers list / installation view in the app. */
  chargersUrl: string;
  /** Optional operator name to personalise the notification. */
  approvedBy?: string;
}

export interface EmailContent {
  subject: string;
  html: string;
  text: string;
}

export function renderAccessRequestApprovedEmail(
  input: AccessRequestApprovedEmailInput,
): EmailContent {
  const subject = `You can charge at ${input.installationDisplayName} now`;
  const approvedHuman = input.approvedAt.toLocaleString("en-IS", {
    timeZone: "Atlantic/Reykjavik",
    dateStyle: "long",
    timeStyle: "short",
  });
  const location = input.siteDisplayName
    ? `${input.installationDisplayName} (${input.siteDisplayName})`
    : input.installationDisplayName;
  const approver = input.approvedBy
    ? `${input.approvedBy} approved your request`
    : "Your request was approved";

  const body =
    heading(`Access granted to ${input.installationDisplayName}`) +
    paragraph(`Hi ${input.driverName},`) +
    paragraph(
      `${approver}. You can now start a charging session at ${location} straight from the app.`,
    ) +
    paragraph(
      "Open the Straumvakt app, pick a connector, and tap Start charging. Pricing for this installation is shown before the session begins.",
    ) +
    ctaButton("Open the app", input.chargersUrl) +
    fallbackLinkLine(
      "Button not clicking? Paste this link in your browser:",
      input.chargersUrl,
    );

  const html = emailLayout({
    preheader: `You're approved to charge at ${input.installationDisplayName}.`,
    body,
    footerNote: `Approved on ${approvedHuman} (Reykjavík time).`,
  });

  const text =
    `Hi ${input.driverName},\n\n` +
    `${approver}. You can now charge at ${location}.\n\n` +
    `Open the Straumvakt app to start a session:\n${input.chargersUrl}\n\n` +
    `Approved ${approvedHuman} (Reykjavík time).\n\n` +
    `Straumvakt`;

  return { subject, html, text };
}
