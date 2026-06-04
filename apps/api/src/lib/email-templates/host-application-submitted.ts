// ADR 0026 §6 — operator notification when a public /apply form is
// submitted. Sent to the operator inbox so a human can work the lead in
// the /applications surface. Reply-To is set to the applicant so the
// operator can respond directly.

export interface HostApplicationSubmittedEmailInput {
  applicationId: string;
  companyName: string;
  contactName: string;
  contactEmail: string;
  contactPhone?: string | null;
  siteType: "multi_dwelling" | "company";
  siteCount: number;
  totalEstimatedChargers: number;
  totalEstimatedDrivers: number;
  description?: string | null;
}

export interface EmailContent {
  subject: string;
  html: string;
  text: string;
}

const SITE_TYPE_LABEL: Record<"multi_dwelling" | "company", string> = {
  multi_dwelling: "Multi-dwelling (HOA / building)",
  company: "Company (employer / fleet)",
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderHostApplicationSubmittedEmail(
  input: HostApplicationSubmittedEmailInput,
): EmailContent {
  const typeLabel = SITE_TYPE_LABEL[input.siteType];
  const subject = `New host application: ${input.companyName} (${typeLabel})`;

  const phoneLine = input.contactPhone
    ? `Phone: ${input.contactPhone}`
    : "Phone: —";
  const descLine = input.description
    ? input.description
    : "(no description provided)";

  const text = [
    `New host application received.`,
    ``,
    `Company:   ${input.companyName}`,
    `Type:      ${typeLabel}`,
    `Contact:   ${input.contactName} <${input.contactEmail}>`,
    phoneLine,
    `Sites:     ${input.siteCount}`,
    `Est. chargers: ${input.totalEstimatedChargers}`,
    `Est. drivers:  ${input.totalEstimatedDrivers}`,
    ``,
    `Description:`,
    descLine,
    ``,
    `Review and convert in the operator console → Applications.`,
    `Application id: ${input.applicationId}`,
  ].join("\n");

  const html = `
    <div style="font-family: system-ui, sans-serif; line-height: 1.5; color: #111;">
      <h2 style="margin: 0 0 12px;">New host application</h2>
      <table style="border-collapse: collapse;">
        <tr><td style="padding: 2px 12px 2px 0; color:#555;">Company</td><td><strong>${escapeHtml(input.companyName)}</strong></td></tr>
        <tr><td style="padding: 2px 12px 2px 0; color:#555;">Type</td><td>${escapeHtml(typeLabel)}</td></tr>
        <tr><td style="padding: 2px 12px 2px 0; color:#555;">Contact</td><td>${escapeHtml(input.contactName)} &lt;${escapeHtml(input.contactEmail)}&gt;</td></tr>
        <tr><td style="padding: 2px 12px 2px 0; color:#555;">Phone</td><td>${escapeHtml(input.contactPhone ?? "—")}</td></tr>
        <tr><td style="padding: 2px 12px 2px 0; color:#555;">Sites</td><td>${input.siteCount}</td></tr>
        <tr><td style="padding: 2px 12px 2px 0; color:#555;">Est. chargers</td><td>${input.totalEstimatedChargers}</td></tr>
        <tr><td style="padding: 2px 12px 2px 0; color:#555;">Est. drivers</td><td>${input.totalEstimatedDrivers}</td></tr>
      </table>
      <p style="margin: 12px 0 4px; color:#555;">Description</p>
      <p style="margin: 0 0 16px; white-space: pre-wrap;">${escapeHtml(descLine)}</p>
      <p style="margin: 0; color:#555; font-size: 13px;">
        Review and convert in the operator console → Applications.<br/>
        Application id: <code>${escapeHtml(input.applicationId)}</code>
      </p>
    </div>
  `.trim();

  return { subject, html, text };
}
