/**
 * invite.ts — operator invite email template.
 *
 * Sent from org-invites flow when a Straumvakt operator invites a
 * teammate or a customer agent into an org. Was previously hand-copied
 * by the operator; this template is the first real-send.
 */
import { emailLayout, heading, paragraph, ctaButton, fallbackLinkLine } from "./common";

export interface InviteEmailInput {
  /** Org being invited to, e.g. "N1 ehf". */
  orgDisplayName: string;
  /** Full URL the recipient clicks, e.g. https://hlada-staging.straumvakt.workers.dev/invite/abc123 */
  inviteUrl: string;
  /** Optional role name, e.g. "operator". Surfaced in the body so the recipient knows what scope. */
  roleLabel?: string;
  /** When the invite link stops working. ISO string. Rendered in human-readable form. */
  expiresAt: Date;
  /** Optional first-name of the operator who issued the invite. */
  inviterName?: string;
}

export interface EmailContent {
  subject: string;
  html: string;
  text: string;
}

export function renderInviteEmail(input: InviteEmailInput): EmailContent {
  const subject = `You've been invited to ${input.orgDisplayName} on Straumvakt`;
  const inviter = input.inviterName ? input.inviterName : "A Straumvakt operator";
  const role = input.roleLabel ? input.roleLabel : "user";
  const expiresHuman = input.expiresAt.toLocaleString("en-IS", {
    timeZone: "Atlantic/Reykjavik",
    dateStyle: "long",
    timeStyle: "short",
  });

  const body =
    heading(`Welcome to ${input.orgDisplayName}`) +
    paragraph(`${inviter} has invited you to join ${input.orgDisplayName} on Straumvakt as a ${role}.`) +
    paragraph("Click the button below to set your password and finish signing up.") +
    ctaButton("Accept invitation", input.inviteUrl) +
    fallbackLinkLine("Button not clicking? Paste this link in your browser:", input.inviteUrl);

  const html = emailLayout({
    preheader: `${inviter} invited you to ${input.orgDisplayName} on Straumvakt.`,
    body,
    footerNote: `This invitation expires on ${expiresHuman} (Reykjavík time). If you weren't expecting this email, you can safely ignore it.`,
  });

  const text =
    `${inviter} invited you to ${input.orgDisplayName} on Straumvakt as a ${role}.\n\n` +
    `Accept the invitation:\n${input.inviteUrl}\n\n` +
    `Link expires ${expiresHuman} (Reykjavík time).\n` +
    `If you weren't expecting this, ignore the email.\n\n` +
    `Straumvakt`;

  return { subject, html, text };
}
