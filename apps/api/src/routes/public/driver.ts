// Sprint 9 / 2026-05-10 — Driver-app public API (Phase 1 foundation).
//
// Implements the OpenAPI contract from C:\Users\Andri\Documents\New
// project\driver-app-api\openapi.yaml. The standalone driver-app-api
// (mock-server / real-driver-bridge) is retired in favour of this
// native implementation in the Straumvakt API Worker.
//
// Phase 1 routes:
//   POST /api/driver/login       email + password → AuthSession
//   GET  /api/driver/me          bearer-auth → DriverProfile
//   GET  /api/driver/chargers    bearer-auth → DriverCharger[]
//
// Auth model:
//   - Stateless HMAC-signed bearer tokens (no driver_sessions table).
//   - Access token TTL 1h; refresh token TTL 30d.
//   - Tokens carry sub='driver' and kind='access'|'refresh'; admin
//     tokens carry sub='admin'. Same secret, but verify() checks sub
//     so cross-mint is impossible.
//
// CORS is mounted at the route level so admin endpoints stay
// origin-locked. Pilot allows '*'; lock to the Flutter web build's
// domain when published.

import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import { makePrisma } from "../../lib/prisma";
import { verifyPassword } from "../../lib/password";
import {
  mintDriverToken,
  verifyDriverToken,
  driverSessionConfig,
  type DriverTokenPayload,
} from "../../lib/driver-session";
import type { Env } from "../../bindings";

type Vars = { driverPayload: DriverTokenPayload };

export const publicDriver = new Hono<{ Bindings: Env; Variables: Vars }>();

// ── CORS ─────────────────────────────────────────────────────────────
//
// Pilot: allow any origin. Flutter mobile (Android/iOS) doesn't apply
// CORS (native HTTP); Flutter Web does. Restrict to the published web
// build's domain when that lands.
publicDriver.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    maxAge: 600,
  }),
);

// ── Driver auth middleware ──────────────────────────────────────────
//
// Reads Authorization: Bearer <access-token>, verifies, attaches the
// payload to the context. Used by every route except /login.
async function requireDriver(c: any, next: any) {
  const auth = c.req.header("authorization") ?? c.req.header("Authorization");
  if (!auth || !auth.toLowerCase().startsWith("bearer ")) {
    return c.json({ error: "unauthenticated", message: "Missing bearer token." }, 401);
  }
  const token = auth.slice(7).trim();
  const payload = await verifyDriverToken(c.env.AUTH_SECRET, token, "access");
  if (!payload) {
    return c.json({ error: "unauthenticated", message: "Invalid or expired token." }, 401);
  }
  c.set("driverPayload", payload);
  await next();
}

// ── POST /api/driver/login ──────────────────────────────────────────

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(200),
});

publicDriver.post("/login", async (c) => {
  const raw = await c.req.json().catch(() => null);
  const parsed = loginSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: "validation", message: "Invalid email or password format." }, 400);
  }
  const { email, password } = parsed.data;
  const prisma = makePrisma(c.env);

  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      displayName: true,
      locale: true,
      audience: true,
      status: true,
      credentials: { select: { passwordHash: true } },
    },
  });

  // Equalise CPU on miss to slow user-enum probes — verifyPassword
  // is the expensive step regardless of whether the user exists.
  const dummyHash =
    "100000$0000000000000000000000000000000000000000000000000000000000000000$0000000000000000000000000000000000000000000000000000000000000000";
  const passwordHash = user?.credentials?.passwordHash ?? null;
  const ok = await verifyPassword(password, passwordHash ?? dummyHash).catch(() => false);

  // Don't distinguish between "no user", "no password set", "wrong
  // password" — generic auth_failed for all three.
  if (!user || !passwordHash || !ok) {
    return c.json({ error: "auth_failed", message: "Email or password incorrect." }, 401);
  }
  if (user.status !== "active") {
    return c.json({ error: "auth_failed", message: "Account is not active." }, 401);
  }
  if (user.audience !== "driver") {
    return c.json(
      { error: "wrong_audience", message: "This account isn't a driver account. Contact your administrator." },
      403,
    );
  }

  const access = await mintDriverToken(c.env.AUTH_SECRET, {
    userId: user.id,
    email: user.email,
    kind: "access",
  });
  const refresh = await mintDriverToken(c.env.AUTH_SECRET, {
    userId: user.id,
    email: user.email,
    kind: "refresh",
  });

  // Resolve a primary org name if the driver has any membership —
  // keeps the AuthSession.driver.organizationName field meaningful.
  const primaryOrg = await prisma.membership.findFirst({
    where: { userId: user.id },
    include: { organization: { select: { displayName: true } } },
  });

  return c.json({
    accessToken: access.token,
    refreshToken: refresh.token,
    expiresInSeconds: access.ttlSeconds,
    driver: {
      id: user.id,
      email: user.email,
      displayName: user.displayName ?? user.email,
      locale: user.locale,
      organizationName: primaryOrg?.organization.displayName,
    },
  });
});

// ── GET /api/driver/me ──────────────────────────────────────────────

publicDriver.get("/me", requireDriver, async (c) => {
  const { userId } = c.get("driverPayload");
  const prisma = makePrisma(c.env);
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      displayName: true,
      locale: true,
    },
  });
  if (!user) {
    return c.json({ error: "not_found", message: "User no longer exists." }, 404);
  }
  const primaryOrg = await prisma.membership.findFirst({
    where: { userId },
    include: { organization: { select: { displayName: true } } },
  });
  return c.json({
    id: user.id,
    email: user.email,
    displayName: user.displayName ?? user.email,
    locale: user.locale,
    organizationName: primaryOrg?.organization.displayName,
  });
});

// ── GET /api/driver/chargers ────────────────────────────────────────
//
// Walks the agreement chain:
//   DriverGroupMembership → DriverGroup → Agreement
//     (type='installation', active, effective at now)
//     → Installation → ChargingStation → connectors
//
// Returns one row per (charger × connector). For pilot the connector
// count is typically 1, so most installations produce one row per
// charger.

publicDriver.get("/chargers", requireDriver, async (c) => {
  const { userId } = c.get("driverPayload");
  const prisma = makePrisma(c.env);
  const now = new Date();

  // Fetch all installation Agreements the driver has membership at.
  const memberships = await prisma.driverGroupMembership.findMany({
    where: {
      userId,
      driverGroup: {
        agreement: {
          agreementType: "installation",
          status: "active",
          effectiveFrom: { lte: now },
          OR: [
            { effectiveUntil: null },
            { effectiveUntil: { gt: now } },
          ],
        },
      },
    },
    select: {
      driverGroup: {
        select: {
          agreement: {
            select: {
              installationId: true,
              installation: {
                select: {
                  id: true,
                  displayName: true,
                  site: { select: { displayName: true } },
                  // ChargingStations live under the installation via
                  // installationId on the charging_stations table.
                },
              },
            },
          },
        },
      },
    },
  });

  // Distinct installation IDs the driver may charge at.
  const installationIds = Array.from(
    new Set(
      memberships
        .map((m) => m.driverGroup.agreement.installationId)
        .filter((id): id is string => !!id),
    ),
  );
  if (installationIds.length === 0) {
    return c.json({ chargers: [] });
  }

  // Walk: ChargingStation → EVSE[] → Connector[]. Connector.maxPowerKw
  // is authoritative (Decimal), falls back to EVSE.maxPowerKw if the
  // connector row hasn't been enriched.
  const stations = await prisma.chargingStation.findMany({
    where: { installationId: { in: installationIds } },
    select: {
      siteAssetId: true,
      siteAsset: { select: { displayName: true } },
      installation: { select: { displayName: true } },
      evses: {
        select: {
          id: true,
          maxPowerKw: true,
          status: true,
          connectors: {
            select: {
              id: true,
              connectorIndex: true,
              type: true,
              maxPowerKw: true,
              status: true,
            },
            orderBy: { connectorIndex: "asc" },
          },
        },
      },
    },
    orderBy: [{ siteAssetId: "asc" }],
  });

  const rows: Array<{
    chargerId: string;
    connectorId: string;
    displayName: string;
    locationName: string;
    status: string;
    maxPowerKw: number;
  }> = [];

  for (const s of stations) {
    const chargerName = s.siteAsset?.displayName ?? "Charger";
    const locationName = s.installation?.displayName ?? "";
    for (const evse of s.evses) {
      for (const conn of evse.connectors) {
        const kw = conn.maxPowerKw ?? evse.maxPowerKw ?? null;
        const maxPowerKw = kw ? Number(kw) : 0;
        rows.push({
          chargerId: s.siteAssetId,
          connectorId: conn.id,
          displayName: chargerName,
          locationName,
          status: mapConnectorStatus(conn.status),
          maxPowerKw: Math.round(maxPowerKw * 10) / 10,
        });
      }
    }
  }

  return c.json({ chargers: rows });
});

// OCPP 1.6 statusNotification → OpenAPI ConnectorStatus enum.
// Defaults to 'Available' for unknown / null values; a v1.1 extension
// can pull richer state from the telemetry cache.
function mapConnectorStatus(raw: string | null | undefined): string {
  if (!raw) return "Available";
  const v = raw.toLowerCase();
  if (v.includes("charg")) return "Charging";
  if (v.includes("prepar")) return "Preparing";
  if (v.includes("finish")) return "Finishing";
  if (v.includes("susp") && v.includes("ev") && !v.includes("evse")) return "SuspendedEV";
  if (v.includes("susp") && v.includes("evse")) return "SuspendedEVSE";
  if (v.includes("unav")) return "Unavailable";
  if (v.includes("fault")) return "Faulted";
  if (v.includes("offline")) return "Offline";
  return "Available";
}

// ── Health ──────────────────────────────────────────────────────────
publicDriver.get("/health", (c) =>
  c.json({ ok: true, service: "straumvakt-driver-api", config: driverSessionConfig }),
);
