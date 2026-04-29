// Zaptec onboarding wizard — discover + import.
//
// Discover: exchanges credentials for a short-lived access token,
// lists installations, fetches each hierarchy in parallel, returns a
// nested tree the wizard renders. No DB writes.
//
// Import: provisions one installation (and its chargers) into the
// Straumvakt schema in a single transaction. See repositories/zaptec-
// import.ts for the multi-table tx + OCPP password generation.

import { Hono } from "hono";
import { ZaptecImportInput } from "@straumvakt/shared/inputs/zaptec-import";
import { z } from "zod";
import { requireAdmin, type AuthVars } from "../../lib/auth-middleware";
import { makePrisma } from "../../lib/prisma";
import {
  getInstallationHierarchy,
  getZaptecAccessToken,
  listInstallations,
  type ZaptecError,
  type ZaptecHierarchyCircuit,
  type ZaptecHierarchyCharger,
} from "../../lib/zaptec";
import { importZaptecInstallation } from "../../repositories/zaptec-import";
import type { Env } from "../../bindings";

const DiscoverBody = z.object({
  username: z.string().min(1).max(200),
  password: z.string().min(1).max(200),
});

function zaptecErrorResponse(err: ZaptecError) {
  switch (err.kind) {
    case "unreachable":
      return { code: 502 as const, body: { error: "zaptec_unreachable" as const } };
    case "invalid_credentials":
      return { code: 401 as const, body: { error: "invalid_credentials" as const } };
    case "no_token":
      return { code: 502 as const, body: { error: "zaptec_oauth_no_token" as const } };
    case "oauth":
      return { code: 502 as const, body: { error: "zaptec_oauth_error" as const, status: err.status } };
    case "list":
      return { code: 502 as const, body: { error: "zaptec_list_error" as const, status: err.status } };
  }
}

export const adminZaptec = new Hono<{ Bindings: Env; Variables: AuthVars }>();

adminZaptec.use("*", requireAdmin);

adminZaptec.post("/discover", async (c) => {
  const raw = (await c.req.json().catch(() => null)) as unknown;
  const parsed = DiscoverBody.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: "validation", issues: parsed.error.issues }, 400);
  }
  const { username, password } = parsed.data;

  const tokenResult = await getZaptecAccessToken(username, password);
  if (!tokenResult.ok) {
    const r = zaptecErrorResponse(tokenResult.error);
    return c.json(r.body, r.code);
  }
  const accessToken = tokenResult.value;

  const instResult = await listInstallations(accessToken);
  if (!instResult.ok) {
    const r = zaptecErrorResponse(instResult.error);
    return c.json(r.body, r.code);
  }
  const rawInstallations = instResult.value.filter(
    (i): i is { Id: string; Name: string } & typeof i =>
      typeof i.Id === "string" && typeof i.Name === "string",
  );

  // Hierarchy fetch — failures don't bring down the whole response.
  const hierarchies = await Promise.all(
    rawInstallations.map(async (i) => {
      const r = await getInstallationHierarchy(accessToken, i.Id);
      return { id: i.Id, hierarchy: r.ok ? r.value : null };
    }),
  );
  const hierarchyById = new Map(hierarchies.map((h) => [h.id, h.hierarchy]));

  const installations = rawInstallations.map((i) => {
    const h = hierarchyById.get(i.Id);
    const circuits = (h?.Circuits ?? [])
      .filter((cc): cc is ZaptecHierarchyCircuit & { Id: string } => typeof cc.Id === "string")
      .map((cc) => ({
        id: cc.Id,
        name: cc.Name ?? "(unnamed circuit)",
        maxCurrent: cc.MaxCurrent ?? null,
        isActive: cc.IsActive ?? true,
        chargers: (cc.Chargers ?? [])
          .filter((ch): ch is ZaptecHierarchyCharger & { Id: string } => typeof ch.Id === "string")
          .map((ch) => ({
            id: ch.Id,
            name: ch.Name ?? "(unnamed charger)",
            serialNo: ch.SerialNo ?? null,
            deviceId: ch.DeviceId ?? null,
            mid: ch.MID ?? null,
            active: ch.Active ?? null,
          })),
      }));

    const chargerCount =
      i.ActiveChargerCount ?? circuits.reduce((sum, cc) => sum + cc.chargers.length, 0);

    return {
      id: i.Id,
      name: i.Name,
      address:
        [i.Address, i.City, i.ZipCode].filter((s): s is string => !!s).join(", ") || null,
      activeChargerCount: chargerCount,
      maxCurrent: i.MaxCurrent ?? null,
      timezone: i.TimeZoneIanaName ?? null,
      circuits,
    };
  });

  return c.json({ installations });
});

adminZaptec.post("/import", async (c) => {
  const raw = (await c.req.json().catch(() => null)) as unknown;
  const parsed = ZaptecImportInput.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: "validation", issues: parsed.error.issues }, 400);
  }
  const db = makePrisma(c.env);
  try {
    const result = await importZaptecInstallation(db, parsed.data);
    return c.json(
      {
        ok: true,
        ...result,
        note: "Each ocppPassword is shown once. Set it as the OCPP Basic-Auth password on the corresponding charger; only the SHA-256 hash is stored on our side.",
      },
      201,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Surface known errors with appropriate status codes.
    if (msg.startsWith("zaptec_")) {
      return c.json({ error: msg }, 502);
    }
    if (msg === "invalid_credentials") return c.json({ error: msg }, 401);
    if (msg === "vendor_zaptec_missing" || msg === "org_not_found") {
      return c.json({ error: msg }, 400);
    }
    if (msg === "installation_not_accessible") return c.json({ error: msg }, 404);
    // Anything else: log full stack + structured error fields so wrangler tail
    // surfaces the real cause instead of the generic onError 'internal'.
    console.error("[zaptec.import] unhandled", {
      message: msg,
      name: err instanceof Error ? err.name : "non-error",
      stack: err instanceof Error ? err.stack : undefined,
      input: {
        zaptecInstallationId: parsed.data.zaptecInstallationId,
        orgId: parsed.data.orgId,
      },
    });
    return c.json({ error: "import_failed", message: msg }, 500);
  }
});
