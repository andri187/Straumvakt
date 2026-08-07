// ADR 0026 §6 — public host-application (RFQ) intake.
//
//   POST /api/public/host-applications   — submit the /apply form
//
// No auth gate: this is the going-public front door. The route is
// allow-listed in middleware.ts (isPublicApplyPath). Persists to
// tenancy.host_applications and notifies the operator inbox (fail-open).

import { Hono } from "hono";
import { z } from "zod";
import { makeDrizzle } from "../../lib/drizzle";
import { createHostApplication } from "../../repositories/host-applications";
import type { Env } from "../../bindings";

export const publicHostApplications = new Hono<{ Bindings: Env }>();

const SiteSchema = z.object({
  address: z.string().trim().min(1).max(500),
  estimatedChargers: z.number().int().min(1).max(100000),
  estimatedDrivers: z.number().int().min(1).max(100000),
});

const SubmitBody = z.object({
  companyName: z.string().trim().min(1).max(200),
  contactName: z.string().trim().min(1).max(200),
  contactEmail: z.string().trim().email().max(200),
  contactPhone: z.string().trim().min(3).max(40).optional(),
  // Kennitala optional at this stage (operator collects formally on
  // contract signing, per ADR 0026 §6). 10 digits when supplied.
  kennitala: z
    .string()
    .trim()
    .regex(/^\d{10}$/, "kennitala_must_be_10_digits")
    .optional(),
  siteType: z.enum(["multi_dwelling", "company"]),
  sites: z.array(SiteSchema).min(1).max(200),
  description: z.string().trim().max(4000).optional(),
});

publicHostApplications.post("/", async (c) => {
  const raw = (await c.req.json().catch(() => null)) as unknown;
  const parsed = SubmitBody.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: "validation", issues: parsed.error.issues }, 400);
  }

  const db = makeDrizzle(c.env);
  const result = await createHostApplication(db, c.env, parsed.data);

  // Return the new id + the email-delivery outcome (so the form can show
  // "we'll be in touch" regardless of whether the operator notification
  // sent — the row is persisted either way).
  return c.json(
    { ok: true, id: result.application.id, email: result.email },
    201,
  );
});
