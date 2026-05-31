/**
 * password-reset.ts — driver / operator password reset email template.
 *
 * Sprint 9 / ENROLL-1 — sent from POST /api/public/password-reset whenever
 * the email matches a User row. Defensive copy: the email tells the
 * recipient they can safely ignore the message if they didn't request a
 * reset, mirroring the anti-enumeration response on the endpoint
 * (always 200 / { ok: true }, never reveal whether the email is known).
 *
 * Layout primitives reused from common.ts so brand voice + Gmail / Outlook
 * compatibility stay identical to invite.ts and verify-email.ts.
 */
import {
  emailLayout,
  heading,
  paragraph,
  ctaButton,
  fallbackLinkLine,
} from "./common";

export interface PasswordResetEmailInput {
  /** Optional first-name / display-name to personalise the greeting. */
  displayName?: string | null;
  /** Full URL the recipient clicks, e.g. https://hlada-staging.../password-reset/abc123 */
  resetUrl: string;
  /** When the reset link stops working. */
  expiresAt: Date;
}

export interface EmailContent {
  subject: string;
  html: string;
  text: string;
}

export function renderPasswordResetEmail(
  input: PasswordResetEmailInput,
): EmailContent {
  const subject = "Reset your Straumvakt password";
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
    heading("Reset your password") +
    paragraph(`Hi ${greetingName} —`) +
    paragraph(
      "We received a password reset request for your Straumvakt account. Click below to set a new password.",
    ) +
    ctaButton("Reset password", input.resetUrl) +
    paragraph(
      "If you didn't request this, you can safely ignore this email — your password won't change.",
    ) +
    fallbackLinkLine(
      "Button not clicking? Paste this link in your browser:",
      input.resetUrl,
    );

  const html = emailLayout({
    preheader: "Reset your Straumvakt password.",
    body,
    footerNote: `This reset link expires on ${expiresHuman} (Reykjavík time).`,
  });

  const text =
    `Reset your Straumvakt password.\n\n` +
    `Hi ${greetingName} — we received a reset request for your account.\n\n` +
    `Set a new password:\n${input.resetUrl}\n\n` +
    `Link expires ${expiresHuman} (Reykjavík time).\n` +
    `If you didn't request this, ignore this email — your password won't change.\n\n` +
    `Straumvakt`;

  return { subject, html, text };
}
