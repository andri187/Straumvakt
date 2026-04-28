/**
 * POST /api/admin/zaptec/discover
 *
 * Body: { username: string; password: string }
 *
 * Exchanges the credentials for a Zaptec OAuth access token (one-shot,
 * not persisted), lists installations the credentials grant access to,
 * fetches each installation's circuit+charger hierarchy in parallel,
 * and returns a nested tree the onboarding wizard renders as
 * expandable rows.
 *
 * Security:
 *   - Admin session required.
 *   - Username/password are read once, used to mint the OAuth token,
 *     and never logged, persisted, or echoed back.
 *   - Only the Zaptec installation summary + hierarchy is returned —
 *     no token, no credentials, no internal IDs.
 *
 * Pre-import: this endpoint does not write any rows to Neon. Persistence
 * happens at the per-installation import step (milestone 2.7), which
 * stashes a refresh-token reference under `installations.credentials_ref`.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireAdmin, unauthorized } from "@/lib/api-auth";

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
  DeviceType?: number | null;
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

export async function POST(req: NextRequest) {
  const session = await requireAdmin();
  if (!session) return unauthorized();

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "malformed json" }, { status: 400 });
  }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation", issues: parsed.error.issues },
      { status: 400 },
    );
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
    cache: "no-store",
  }).catch(() => null);

  if (!tokenRes) {
    return NextResponse.json({ error: "zaptec_unreachable" }, { status: 502 });
  }
  if (!tokenRes.ok) {
    if (tokenRes.status === 400 || tokenRes.status === 401) {
      return NextResponse.json(
        { error: "invalid_credentials" },
        { status: 401 },
      );
    }
    return NextResponse.json(
      { error: "zaptec_oauth_error", status: tokenRes.status },
      { status: 502 },
    );
  }

  const tokenJson = (await tokenRes.json().catch(() => null)) as
    | { access_token?: string }
    | null;
  const accessToken = tokenJson?.access_token;
  if (!accessToken) {
    return NextResponse.json(
      { error: "zaptec_oauth_no_token" },
      { status: 502 },
    );
  }

  // Step 2 — list installations.
  const instRes = await fetch(`${ZAPTEC_BASE}/api/installation`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  }).catch(() => null);

  if (!instRes) {
    return NextResponse.json({ error: "zaptec_unreachable" }, { status: 502 });
  }
  if (!instRes.ok) {
    return NextResponse.json(
      { error: "zaptec_list_error", status: instRes.status },
      { status: 502 },
    );
  }
  const instJson = (await instRes.json().catch(() => null)) as
    | { Data?: ZaptecInstallationSummary[] }
    | null;
  const rawInstallations = (instJson?.Data ?? []).filter(
    (i): i is ZaptecInstallationSummary & { Id: string; Name: string } =>
      typeof i.Id === "string" && typeof i.Name === "string",
  );

  // Step 3 — fetch each installation's hierarchy in parallel. One missing
  // hierarchy doesn't fail the whole response; that installation just
  // surfaces with an empty circuits[] so the wizard can still render it.
  const hierarchies = await Promise.all(
    rawInstallations.map(async (i) => {
      try {
        const r = await fetch(
          `${ZAPTEC_BASE}/api/installation/${i.Id}/hierarchy`,
          {
            headers: { Authorization: `Bearer ${accessToken}` },
            cache: "no-store",
          },
        );
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
      .filter((c): c is ZaptecHierarchyCircuit & { Id: string } =>
        typeof c.Id === "string",
      )
      .map((c) => ({
        id: c.Id,
        name: c.Name ?? "(unnamed circuit)",
        maxCurrent: c.MaxCurrent ?? null,
        isActive: c.IsActive ?? true,
        chargers: (c.Chargers ?? [])
          .filter(
            (ch): ch is ZaptecHierarchyCharger & { Id: string } =>
              typeof ch.Id === "string",
          )
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
      i.ActiveChargerCount ??
      circuits.reduce((sum, c) => sum + c.chargers.length, 0);

    return {
      id: i.Id,
      name: i.Name,
      address:
        [i.Address, i.City, i.ZipCode]
          .filter((s): s is string => !!s)
          .join(", ") || null,
      activeChargerCount: chargerCount,
      maxCurrent: i.MaxCurrent ?? null,
      timezone: i.TimeZoneIanaName ?? null,
      circuits,
    };
  });

  return NextResponse.json({ installations });
}
