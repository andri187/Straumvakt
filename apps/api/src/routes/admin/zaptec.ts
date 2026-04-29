// Zaptec onboarding wizard — discover step.
//
// Ported 1:1 from src/app/api/admin/zaptec/discover/route.ts so the UI
// wizard's apiFetch call reaches the API Worker instead of 404'ing on
// the UI Worker after the cutover. No Prisma — pure HTTP-out to
// Zaptec's API; we just translate the result shape.
//
// Body: { username: string; password: string }
// Returns: { installations: [{ id, name, address?, activeChargerCount?,
//   maxCurrent?, timezone?, circuits: [{ id, name, maxCurrent?,
//   isActive, chargers: [{ id, name, serialNo?, deviceId?, mid?, active? }] }] }] }
//
// Credentials are exchanged for an access token once and never logged
// or persisted. Per-installation persistence happens at the import step
// (milestone 2.7).

import { Hono } from "hono";
import { z } from "zod";
import { requireAdmin, type AuthVars } from "../../lib/auth-middleware";
import type { Env } from "../../bindings";

const ZAPTEC_BASE = "https://api.zaptec.com";

const Body = z.object({
  username: z.string().min(1).max(200),
  password: z.string().min(1).max(200),
});

type ZaptecInstallationSummary = {
  Id?: string;
  Name?: string;
  Address?: string;
  City?: string;
  ZipCode?: string;
  ActiveChargerCount?: number;
  MaxCurrent?: number;
  TimeZoneIanaName?: string;
};

type ZaptecHierarchyCharger = {
  Id?: string;
  Name?: string | null;
  SerialNo?: string | null;
  DeviceId?: string | null;
  MID?: string | null;
  Active?: boolean | null;
};

type ZaptecHierarchyCircuit = {
  Id?: string;
  Name?: string | null;
  MaxCurrent?: number;
  IsActive?: boolean;
  Chargers?: ZaptecHierarchyCharger[] | null;
};

type ZaptecHierarchy = {
  Id?: string;
  Circuits?: ZaptecHierarchyCircuit[] | null;
};

export const adminZaptec = new Hono<{ Bindings: Env; Variables: AuthVars }>();

adminZaptec.use("*", requireAdmin);

adminZaptec.post("/discover", async (c) => {
  const raw = (await c.req.json().catch(() => null)) as unknown;
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: "validation", issues: parsed.error.issues }, 400);
  }
  const { username, password } = parsed.data;

  // Step 1 — exchange credentials for an access token.
  const tokenRes = await fetch(`${ZAPTEC_BASE}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "password",
      username,
      password,
      scope: "openid",
    }),

  }).catch(() => null);

  if (!tokenRes) return c.json({ error: "zaptec_unreachable" }, 502);
  if (!tokenRes.ok) {
    if (tokenRes.status === 400 || tokenRes.status === 401) {
      return c.json({ error: "invalid_credentials" }, 401);
    }
    return c.json({ error: "zaptec_oauth_error", status: tokenRes.status }, 502);
  }

  const tokenJson = (await tokenRes.json().catch(() => null)) as
    | { access_token?: string }
    | null;
  const accessToken = tokenJson?.access_token;
  if (!accessToken) return c.json({ error: "zaptec_oauth_no_token" }, 502);

  // Step 2 — list installations.
  const instRes = await fetch(`${ZAPTEC_BASE}/api/installation`, {
    headers: { Authorization: `Bearer ${accessToken}` },

  }).catch(() => null);

  if (!instRes) return c.json({ error: "zaptec_unreachable" }, 502);
  if (!instRes.ok) {
    return c.json({ error: "zaptec_list_error", status: instRes.status }, 502);
  }
  const instJson = (await instRes.json().catch(() => null)) as
    | { Data?: ZaptecInstallationSummary[] }
    | null;
  const rawInstallations = (instJson?.Data ?? []).filter(
    (i): i is ZaptecInstallationSummary & { Id: string; Name: string } =>
      typeof i.Id === "string" && typeof i.Name === "string",
  );

  // Step 3 — fetch each installation's hierarchy in parallel. A missing
  // hierarchy doesn't fail the whole response; that installation just
  // surfaces with an empty circuits[].
  const hierarchies = await Promise.all(
    rawInstallations.map(async (i) => {
      try {
        const r = await fetch(`${ZAPTEC_BASE}/api/installation/${i.Id}/hierarchy`, {
          headers: { Authorization: `Bearer ${accessToken}` },
      
        });
        if (!r.ok) return { id: i.Id, hierarchy: null };
        const h = (await r.json().catch(() => null)) as ZaptecHierarchy | null;
        return { id: i.Id, hierarchy: h };
      } catch {
        return { id: i.Id, hierarchy: null };
      }
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
