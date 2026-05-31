/**
 * common.ts — shared layout primitives for transactional email templates.
 *
 * Keeps the HTML small, brand-consistent, and tested-once. Templates
 * (invite.ts, password-reset.ts, verify.ts) compose these without
 * inventing their own layouts.
 *
 * Design constraint: must render in Gmail / Outlook / Apple Mail.
 * That means table-based layout, inline styles, no CSS variables, no
 * external assets (logos inline as SVG or remote-fetched). Resend
 * doesn't rewrite these — what we send is what arrives.
 *
 * The brand palette mirrors the operator UI's sv-sky / ink tokens but
 * stays inline-RGB because email clients drop CSS custom-property
 * declarations.
 */

const BRAND = {
  // sv-sky — primary accent
  sky: "#7DD3FC",
  // bg-base — dark page surface (rendered light-mode-only for email
  // since dark-mode-aware email is a different design conversation)
  pageBg: "#F3F4F6",
  cardBg: "#FFFFFF",
  ink900: "#0F172A",
  ink600: "#475569",
  ink400: "#94A3B8",
  border: "#E2E8F0",
} as const;

interface LayoutInput {
  preheader: string; // hidden preview text shown by inbox clients
  body: string; // already-rendered HTML for the card body
  footerNote?: string; // small grey line under the CTA, e.g. expiry hint
}

/**
 * Renders the wrapping table layout + Straumvakt header + footer.
 * Caller passes a fully-rendered <tr>...</tr> string for the body.
 */
export function emailLayout({ preheader, body, footerNote }: LayoutInput): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width" />
    <title>Straumvakt</title>
  </head>
  <body style="margin:0;padding:0;background-color:${BRAND.pageBg};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${BRAND.ink900};">
    <span style="display:none!important;visibility:hidden;mso-hide:all;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${escapeHtml(preheader)}</span>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:${BRAND.pageBg};">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560" style="max-width:560px;background-color:${BRAND.cardBg};border:1px solid ${BRAND.border};border-radius:8px;overflow:hidden;">
            <tr>
              <td style="padding:24px 32px;border-bottom:1px solid ${BRAND.border};">
                <div style="font-size:18px;font-weight:600;color:${BRAND.ink900};letter-spacing:-0.01em;">Straumvakt</div>
              </td>
            </tr>
            <tr>
              <td style="padding:32px;">
                ${body}
              </td>
            </tr>
            ${footerNote
              ? `<tr>
                  <td style="padding:0 32px 24px 32px;font-size:12px;color:${BRAND.ink400};line-height:1.5;">
                    ${escapeHtml(footerNote)}
                  </td>
                </tr>`
              : ""}
            <tr>
              <td style="padding:16px 32px;background-color:#F8FAFC;border-top:1px solid ${BRAND.border};font-size:12px;color:${BRAND.ink400};">
                Sent by Straumvakt &middot; <a href="https://hlada.straumvakt.workers.dev" style="color:${BRAND.ink600};text-decoration:none;">hlada.straumvakt.workers.dev</a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

/**
 * Renders a primary action button row. Use inside emailLayout body.
 */
export function ctaButton(label: string, href: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;">
    <tr>
      <td align="center" style="background-color:${BRAND.ink900};border-radius:6px;">
        <a href="${escapeAttr(href)}" style="display:inline-block;padding:12px 24px;color:#FFFFFF;text-decoration:none;font-size:14px;font-weight:500;">${escapeHtml(label)}</a>
      </td>
    </tr>
  </table>`;
}

export function paragraph(text: string): string {
  return `<p style="margin:0 0 16px 0;font-size:14px;line-height:1.6;color:${BRAND.ink600};">${escapeHtml(text)}</p>`;
}

export function heading(text: string): string {
  return `<h1 style="margin:0 0 16px 0;font-size:20px;font-weight:600;color:${BRAND.ink900};letter-spacing:-0.01em;">${escapeHtml(text)}</h1>`;
}

export function fallbackLinkLine(label: string, href: string): string {
  return `<p style="margin:24px 0 0 0;font-size:12px;line-height:1.5;color:${BRAND.ink400};">
    ${escapeHtml(label)}<br/>
    <a href="${escapeAttr(href)}" style="color:${BRAND.ink600};word-break:break-all;">${escapeHtml(href)}</a>
  </p>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(s: string): string {
  return s.replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
