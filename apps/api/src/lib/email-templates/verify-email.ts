/**
 * verify-email.ts — driver self-registration email-verification template.
 *
 * Sprint 9 / ENROLL-1 / ADR 0022 (2026-05-31 addendum) — sent immediately
 * after a successful POST /api/public/register. The recipient clicks the
 * link in the email to confirm they own the address; the GET /api/public/
 * verify-email/:token handler flips User.emailVerifiedAt + (per the org
 * email-domain policy) writes a DriverGroupMembership or DriverAccessRequest.
 *
 * The template intentionally mirrors invite.ts so brand voice, layout
 * primitives, and footer behaviour stay consistent across transactional
 * emails. Differences:
 *   - subject: welcome + verify framing, not invitation framing
 *   - body: short — verification is a one-click confirmation, no role
 *     or scope language
 *   - footer note: shorter expiry hint (24h vs 72h for invites)
 */
import {
  emailLayout,
  heading,
  paragraph,
  ctaButton,
  fallbackLinkLine,
} from "./common";

export interface VerifyEmailInput {
  /** Optional first-name / display-name to personalise the greeting. */
  displayName?: string | null;
  /** Full URL the recipient clicks, e.g. https://hlada-staging.../verify-email/abc123 */
  verifyUrl: string;
  /** When the verification link stops working. ISO Date. */
  expiresAt: Date;
}

export interface EmailContent {
  subject: string;
  html: string;
  text: string;
}

export function renderVerifyEmail(input: VerifyEmailInput): EmailContent {
  const subject = "Verify your email for Straumvakt";
  const greetingName =
    input.displayName && input.displayName.trim().length > 0
      ? input.displayName.trim()
      : "there";
  const expiresHuman = input.expiresAt.toLocaleString("en-IS", {
    timeZone: "Atlantic/Reykjavik",
    dateStyle: "long",
    timeStyle: "short",
  });

  const body =
    heading("Welcome to Straumvakt") +
    paragraph(`Hi ${greetingName} — thanks for signing up.`) +
    paragraph(
      "Tap the button below to confirm this is your email address. Once verified, you can start charging at any Straumvakt-enabled installation you're entitled to.",
    ) +
    ctaButton("Verify email", input.verifyUrl) +
    fallbackLinkLine(
      "Button not clicking? Paste this link in your browser:",
      input.verifyUrl,
    );

  const html = emailLayout({
    preheader: "Confirm your email address to finish signing up to Straumvakt.",
    body,
    footerNote: `This verification link expires on ${expiresHuman} (Reykjavík time). If you didn't sign up for Straumvakt you can safely ignore this email.`,
  });

  const text =
    `Welcome to Straumvakt.\n\n` +
    `Hi ${greetingName} — confirm your email address to finish signing up:\n` +
    `${input.verifyUrl}\n\n` +
    `Link expires ${expiresHuman} (Reykjavík time).\n` +
    `If you didn't sign up, ignore this email.\n\n` +
    `Straumvakt`;

  return { subject, html, text };
}
