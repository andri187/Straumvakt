/**
 * POST /api/admin/dev/provision-identity
 *
 * Dev / staging only. Creates a full Org → Host → Property → Site →
 * Charger (SiteAsset) → OCPPIdentity → Connector chain so you can
 * point a real charger at the gateway URL with a known Basic-Auth
 * password. Replaced by the Sprint 9.1 onboarding wizard eventually.
 *
 * Env gated: returns 404 when `NEXT_PUBLIC_APP_ENV === 'production'`.
 * Admin-session gated: under `/api/admin/*` the middleware already
 * enforces this; defense-in-depth `requireAdmin()` inside the handler.
 *
 * Password handling (Rule 2 grey zone — documented, intentional):
 *   • We generate a random 32-byte secret, SHA-256 it into the
 *     persisted `authSecretHash`, and return the plaintext password
 *     ONCE in the response body. Same pattern Zaptec / Easee use
 *     with their portals. Never logged. Never stored plaintext.
 *   • The operator is responsible for copying this password into
 *     the charger's OCPP config. Regeneration means re-provisioning.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { requireAdmin, unauthorized } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { sha256Hex } from "@/lib/ocpp/internal-auth";

const BodySchema = z.object({
  displayName: z.string().min(1).max(120),
  identityString: z.string().min(3).max(64).regex(/^[A-Za-z0-9._:-]+$/, {
    message: "identityString: alphanumerics, '.', '_', ':', '-' only",
  }),
  connectorType: z.string().min(1).max(32).default("Type2"),
  maxPowerKw: z.number().positive().max(1000).optional(),
  orgSlug: z.string().min(3).max(40).regex(/^[a-z0-9-]+$/).optional(),
  countryCode: z.string().length(2).default("IS"),
});

function generatePassword(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, "0");
  return hex;
}

export async function POST(req: Request) {
  if (process.env.NEXT_PUBLIC_APP_ENV === "production") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const session = await requireAdmin();
  if (!session) return unauthorized();

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "malformed json" }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "invalid body" },
      { status: 400 },
    );
  }
  const body = parsed.data;

  const password = generatePassword();
  const authSecretHash = await sha256Hex(password);

  const orgSlug =
    body.orgSlug ?? `dev-${randomUUID().slice(0, 8)}`;

  // Build the whole chain in one transaction so a partial failure
  // doesn't leave orphan rows.
  const result = await prisma().$transaction(async (tx) => {
    const org = await tx.organization.create({
      data: {
        slug: orgSlug,
        displayName: body.displayName,
        countryCode: body.countryCode,
      },
      select: { id: true, slug: true },
    });

    // ChargerHost dropped per ADR 0009 — Property attaches directly to Org.
    const property = await tx.property.create({
      data: {
        orgId: org.id,
        displayName: body.displayName,
      },
      select: { id: true },
    });

    const site = await tx.site.create({
      data: {
        orgId: org.id,
        propertyId: property.id,
        displayName: body.displayName,
      },
      select: { id: true },
    });

    const siteAsset = await tx.siteAsset.create({
      data: {
        orgId: org.id,
        siteId: site.id,
        kind: "charger",
        displayName: body.identityString,
      },
      select: { id: true },
    });

    await tx.charger.create({
      data: {
        siteAssetId: siteAsset.id,
        orgId: org.id,
      },
    });

    const identity = await tx.ocppIdentity.create({
      data: {
        orgId: org.id,
        chargerId: siteAsset.id,
        identityString: body.identityString,
        authSecretHash,
        ocppVersion: "ocpp_1_6",
        assetClass: "ac",
      },
      select: { id: true },
    });

    const connector = await tx.connector.create({
      data: {
        orgId: org.id,
        ocppIdentityId: identity.id,
        connectorIndex: 1,
        type: body.connectorType,
        maxPowerKw: body.maxPowerKw,
      },
      select: { id: true, connectorIndex: true },
    });

    return {
      orgId: org.id,
      orgSlug: org.slug,
      propertyId: property.id,
      siteId: site.id,
      chargerId: siteAsset.id,
      ocppIdentityId: identity.id,
      connectorId: connector.id,
    };
  });

  return NextResponse.json(
    {
      ok: true,
      ...result,
      identityString: body.identityString,
      password,
      note:
        "Copy this password into the charger's OCPP config — it is not stored plaintext and cannot be retrieved again. Re-provision to rotate.",
    },
    { status: 201 },
  );
}
