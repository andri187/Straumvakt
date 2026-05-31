/**
 * email.ts — transactional email via Resend.
 *
 * Sprint 9 / 2026-05-31 — wired alongside the org-invite flow's first
 * real-send. The helper fails OPEN with a console.warn if RESEND_API_KEY
 * is missing or the API call errors. The caller decides what to do —
 * for invite flows the route can fall back to returning the plaintext
 * token so the operator can copy it manually (same UX as pre-2026-05-31).
 *
 * Domain: straumvakt.org. From-address default: no-reply@straumvakt.org.
 * Region: eu-west-1 (Resend EU / Ireland). DKIM + SPF + DMARC live in
 * Cloudflare DNS for that zone.
 *
 * To set/rotate the API key:
 *   cd apps/api && npx wrangler secret put RESEND_API_KEY --name hlada-api-staging
 */
import type { Env } from "../bindings";

export interface SendEmailInput {
  to: string | string[];
  from?: string;
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
  // Resend supports a `tags` array of { name, value } pairs used for
  // bucket-level filtering in their dashboard. We use it to mark email
  // category (invite / password_reset / verify) so the operator can pull
  // up per-category delivery stats without grepping.
  tags?: Array<{ name: string; value: string }>;
}

export type SendEmailResult =
  | { ok: true; id: string }
  | { ok: false; reason: "binding_missing" }
  | { ok: false; reason: "send_failed"; status: number; error: string };

const DEFAULT_FROM = "Straumvakt <no-reply@straumvakt.org>";
const RESEND_ENDPOINT = "https://api.resend.com/emails";

export async function sendEmail(
  env: Env,
  input: SendEmailInput,
): Promise<SendEmailResult> {
  const apiKey = env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn(
      `[email] RESEND_API_KEY missing — failing open (no email sent). Subject: ${input.subject.slice(0, 60)}`,
    );
    return { ok: false, reason: "binding_missing" };
  }

  const body: Record<string, unknown> = {
    from: input.from ?? DEFAULT_FROM,
    to: Array.isArray(input.to) ? input.to : [input.to],
    subject: input.subject,
    html: input.html,
  };
  if (input.text) body.text = input.text;
  if (input.replyTo) body.reply_to = input.replyTo;
  if (input.tags && input.tags.length > 0) body.tags = input.tags;

  let resp: Response;
  try {
    resp = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[email] resend network error: ${errMsg}`);
    return { ok: false, reason: "send_failed", status: 0, error: errMsg };
  }

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    console.error(`[email] resend api ${resp.status}: ${errText.slice(0, 400)}`);
    return {
      ok: false,
      reason: "send_failed",
      status: resp.status,
      error: errText.slice(0, 400),
    };
  }

  const data = (await resp.json().catch(() => ({}))) as { id?: string };
  if (!data.id) {
    console.error(`[email] resend success response missing id`);
    return {
      ok: false,
      reason: "send_failed",
      status: resp.status,
      error: "missing_response_id",
    };
  }
  return { ok: true, id: data.id };
}
