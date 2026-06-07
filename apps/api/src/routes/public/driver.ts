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
import { enqueueCommand } from "../../repositories/outbound-commands";
import {
  listDriverInstallations,
  getDriverChargerPricing,
} from "../../repositories/driver-pricing";
import { createSelfRequest } from "../../repositories/driver-access-requests";
import {
  getDriverActiveSessions,
  resolveStoppableSession,
  listDriverSessionHistory,
  updateDriverProfile,
} from "../../repositories/driver-sessions";
import type { Env } from "../../bindings";

type Vars = { driverPayload: DriverTokenPayload };

export const publicDriver = new Hono<{ Bindings: Env; Variables: Vars }>();

// ── CORS ─────────────────────────────────────────────────────────────
//
// Origin allowlist — pilot tightened from "*" per AUD-2.
// Flutter mobile (Android/iOS) makes native HTTP requests that don't
// carry an Origin header, so CORS is irrelevant there. Flutter Web
// and the Next.js admin UI do carry an Origin, so we enumerate the
// known-safe origins explicitly.
//
// TODO: add capacitor:// or app-specific origin when mobile app deploys.
function isAllowedDriverOrigin(origin: string | undefined | null): string | null {
  if (!origin) return null;
  const allowed = [
    "https://hlada-staging.straumvakt.workers.dev",
    "https://hlada.straumvakt.workers.dev",
    // Driver WEB portal on the brand domain (ADR 0033) — bearer-token, no cookies.
    "https://straumvakt.org",
    "https://www.straumvakt.org",
    "http://localhost:3000",
  ];
  return allowed.includes(origin) ? origin : null;
}

publicDriver.use(
  "*",
  cors({
    origin: (origin) => isAllowedDriverOrigin(origin),
    // Driver API uses stateless bearer tokens — no cookies, so
    // credentials:false is correct and keeps preflight simple.
    credentials: false,
    allowMethods: ["GET", "POST", "PATCH", "OPTIONS"],
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
    where: {
      installationId: { in: installationIds },
      // Filter out truly-stale rows: imported once but never came
      // online and never produced telemetry. These are dupes / ghost
      // rows from the import. Operator can clean them up server-side
      // separately; we hide them from drivers regardless.
      OR: [
        { onlineSinceAt: { not: null } },
        { lastTelemetryAt: { not: null } },
      ],
    },
    select: {
      siteAssetId: true,
      bleAdvertisingId: true,
      bleAdvertisingKind: true,
      onlineSinceAt: true,
      lastTelemetryAt: true,
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
    bleAdvertisingId: string | null;
    bleAdvertisingKind: string | null;
  }> = [];

  const nowMs = Date.now();
  const TELEMETRY_FRESH_MS = 6 * 60 * 60 * 1000; // 6h
  const ONLINE_RECENT_MS = 7 * 24 * 60 * 60 * 1000; // 7d

  function stationStatus(s: {
    onlineSinceAt: Date | null;
    lastTelemetryAt: Date | null;
  }): string {
    // If we got telemetry recently, the charger is talking → Available.
    // (Charging / Preparing / etc. require a real connector status
    // projection that doesn't exist yet; for pilot, telemetry-recent
    // is the strongest signal we have.)
    if (
      s.lastTelemetryAt &&
      nowMs - s.lastTelemetryAt.getTime() < TELEMETRY_FRESH_MS
    ) {
      return "Available";
    }
    // Telemetry is stale or absent. If the charger booted (BootNotification
    // landed) within the last 7 days, treat as Available — silence may
    // mean idle, not offline. Outside that window → Offline.
    if (
      s.onlineSinceAt &&
      nowMs - s.onlineSinceAt.getTime() < ONLINE_RECENT_MS
    ) {
      return "Available";
    }
    return "Offline";
  }

  for (const s of stations) {
    const chargerName = s.siteAsset?.displayName ?? "Charger";
    const locationName = s.installation?.displayName ?? "";
    const stationLevel = stationStatus(s);
    for (const evse of s.evses) {
      for (const conn of evse.connectors) {
        const kw = conn.maxPowerKw ?? evse.maxPowerKw ?? null;
        const maxPowerKw = kw ? Number(kw) : 0;
        // Connector-level status takes precedence when it's a meaningful
        // value (Charging / Preparing / Faulted etc.). When it's the
        // default 'unknown', fall back to the station-level heuristic.
        const connStatus = mapConnectorStatus(conn.status);
        const status = connStatus === "Available" ? stationLevel : connStatus;
        rows.push({
          chargerId: s.siteAssetId,
          connectorId: conn.id,
          displayName: chargerName,
          locationName,
          status,
          maxPowerKw: Math.round(maxPowerKw * 10) / 10,
          bleAdvertisingId: s.bleAdvertisingId,
          bleAdvertisingKind: s.bleAdvertisingKind,
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

// ── POST /api/driver/start-session ──────────────────────────────────
//
// Phase 3 — driver requests RemoteStartTransaction on a connector.
// The driver's virtual RFID token (the IdToken row owned by them with
// the right scope) is resolved server-side; the app never sees or
// chooses an idTag.
//
// Flow:
//   1. Validate connector belongs to a charger covered by an active
//      DriverGroupMembership for this user.
//   2. Pick the driver's preferred IdToken (evccid > rfid > manual)
//      that's installation-scoped or unscoped.
//   3. Enqueue ocpp.outbound_commands row with controlDomain='remote_start'
//      and OUTBOUND_QUEUE notification — same path the admin remote-start
//      endpoint uses, so the dispatcher already knows how to process it.
//   4. Return 202 with {commandId, status, session: <preparing>}.
//
// We DON'T wait for the OCPP gateway to forward and ack — that's
// async. The mobile app polls /sessions/current (Phase 2) to see the
// session land in 'Preparing'/'Charging'.

const startSessionSchema = z.object({
  connectorId: z.string().uuid(),
});

publicDriver.post("/start-session", requireDriver, async (c) => {
  const raw = await c.req.json().catch(() => null);
  const parsed = startSessionSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: "validation", message: "connectorId required (uuid)." }, 400);
  }

  const { userId } = c.get("driverPayload");
  const prisma = makePrisma(c.env);
  const now = new Date();

  // Resolve connector → evse → station → installation + ocpp identity.
  const connector = await prisma.connector.findUnique({
    where: { id: parsed.data.connectorId },
    select: {
      id: true,
      connectorIndex: true,
      evse: {
        select: {
          chargingStation: {
            select: {
              siteAssetId: true,
              orgId: true,
              installationId: true,
              siteAsset: { select: { displayName: true } },
              ocppIdentities: {
                select: { id: true, orgId: true },
                take: 1,
              },
            },
          },
        },
      },
    },
  });

  if (!connector) {
    return c.json(
      { error: "not_found", message: "Charger not found." },
      404,
    );
  }

  const station = connector.evse.chargingStation;
  const installationId = station.installationId;
  const ocppIdentity = station.ocppIdentities[0];

  if (!installationId) {
    return c.json(
      { error: "not_configured", message: "Charger isn't placed at an installation yet." },
      503,
    );
  }
  if (!ocppIdentity) {
    return c.json(
      { error: "not_configured", message: "Charger has no OCPP identity. Contact your operator." },
      503,
    );
  }

  // Verify driver has membership at this installation.
  const membership = await prisma.driverGroupMembership.findFirst({
    where: {
      userId,
      driverGroup: {
        agreement: {
          agreementType: "installation",
          installationId,
          status: "active",
          effectiveFrom: { lte: now },
          OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: now } }],
        },
      },
    },
    select: { id: true },
  });
  if (!membership) {
    return c.json(
      { error: "no_access", message: "You don't have access to this charger." },
      403,
    );
  }

  // Pick the driver's idTag — prefer evccid (Autocharge / vehicle ID)
  // over rfid (physical card) over manual (operator-set static value).
  const tokens = await prisma.idToken.findMany({
    where: {
      userId,
      status: "active",
      kind: { in: ["manual", "rfid", "evccid"] },
      OR: [
        { scopeInstallationId: null },
        { scopeInstallationId: installationId },
      ],
    },
    select: { id: true, value: true, kind: true, label: true },
  });

  if (tokens.length === 0) {
    return c.json(
      {
        error: "no_token",
        message: "You don't have an active token for this charger. Contact your operator.",
      },
      403,
    );
  }

  const order: Record<string, number> = { evccid: 0, rfid: 1, manual: 2 };
  tokens.sort((a, b) => (order[a.kind] ?? 99) - (order[b.kind] ?? 99));
  const chosen = tokens[0];

  // Enqueue the RemoteStartTransaction. OCPP 1.6 §6.21: connectorId is
  // the integer connector number (1-based) — NOT our DB uuid. The
  // dispatcher already knows how to translate this payload via
  // src/lib/dispatch-targets.ts.
  const enqueued = await enqueueCommand(prisma, c.env.OUTBOUND_QUEUE, {
    orgId: ocppIdentity.orgId,
    identityId: ocppIdentity.id,
    controlDomain: "remote_start",
    routedTo: "ocpp",
    payload: {
      connectorId: connector.connectorIndex,
      idTag: chosen.value,
    },
    correlationId: crypto.randomUUID(),
    requestedBy: userId,
  });

  return c.json(
    {
      commandId: enqueued.id,
      status: "accepted",
      tokenKind: chosen.kind,
      tokenLabel: chosen.label,
      session: {
        sessionId: enqueued.id,
        connectorId: parsed.data.connectorId,
        chargerName: station.siteAsset?.displayName ?? "Charger",
        status: "Preparing",
        startedAt: now.toISOString(),
        powerKw: 0,
        energyKwh: 0,
        costIsk: 0,
      },
    },
    202,
  );
});

// ── POST /api/driver/stop-session ───────────────────────────────────
//
// Driver requests RemoteStopTransaction on one of THEIR in-progress
// sessions. Mirrors start-session's enqueue path: resolve the session +
// its OCPP identity + protocol transactionId, then enqueue an
// ocpp.outbound_commands row with controlDomain='remote_stop'. OCPP 1.6
// §6.23 stops by transactionId, so we never guess a connector-based
// stop — if the session has no protocol transaction id yet we 409.
//
// Ownership is enforced in the repository (WHERE user_id = driver), so a
// driver can never stop another driver's session — 404 for any sessionId
// that isn't theirs (don't leak existence).

const stopSessionSchema = z.object({
  sessionId: z.string().uuid(),
});

publicDriver.post("/stop-session", requireDriver, async (c) => {
  const raw = await c.req.json().catch(() => null);
  const parsed = stopSessionSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: "validation", message: "sessionId required (uuid)." }, 400);
  }

  const { userId } = c.get("driverPayload");
  const prisma = makePrisma(c.env);
  const now = new Date();

  const resolved = await resolveStoppableSession(prisma, userId, parsed.data.sessionId);

  if (resolved.kind === "not_found") {
    return c.json(
      { error: "not_found", message: "No active session with that id." },
      404,
    );
  }
  if (resolved.kind === "no_ocpp_identity") {
    return c.json(
      {
        error: "not_stoppable",
        message: "This session isn't on an OCPP charger we can stop remotely.",
      },
      409,
    );
  }
  if (resolved.kind === "no_transaction_id") {
    return c.json(
      {
        error: "not_stoppable",
        message: "The session hasn't reported a transaction id yet. Try again shortly.",
      },
      409,
    );
  }

  const session = resolved.session;

  // Enqueue RemoteStopTransaction. Payload is passed verbatim to the
  // gateway as the OCPP 1.6 §6.23 action payload — { transactionId }.
  const enqueued = await enqueueCommand(prisma, c.env.OUTBOUND_QUEUE, {
    orgId: session.orgId,
    identityId: session.identityId,
    controlDomain: "remote_stop",
    routedTo: "ocpp",
    payload: {
      transactionId: session.transactionId,
    },
    correlationId: crypto.randomUUID(),
    requestedBy: userId,
  });

  return c.json(
    {
      commandId: enqueued.id,
      status: "accepted",
      session: {
        sessionId: session.sessionId,
        connectorId: session.connectorId,
        chargerName: session.chargerName,
        status: "Finishing",
        startedAt: session.startedAt,
        powerKw: 0,
        energyKwh: 0,
        costIsk: 0,
      },
    },
    202,
  );
});

// ── GET /api/driver/sessions/current ────────────────────────────────
//
// The driver's in-progress session(s). Read-only; reads charging.sessions
// WHERE user_id = driver AND status='in_progress'. Empty array when the
// driver isn't charging.

publicDriver.get("/sessions/current", requireDriver, async (c) => {
  const { userId } = c.get("driverPayload");
  const prisma = makePrisma(c.env);
  const sessions = await getDriverActiveSessions(prisma, userId);
  return c.json({ sessions });
});

// ── GET /api/driver/sessions/history ────────────────────────────────
//
// Past (billed) sessions for this driver from reports.session_ledger,
// newest-first, paginated via skip/limit. Driver-scoped in the repo.

const historyQuerySchema = z.object({
  skip: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

publicDriver.get("/sessions/history", requireDriver, async (c) => {
  const parsed = historyQuerySchema.safeParse({
    skip: c.req.query("skip"),
    limit: c.req.query("limit"),
  });
  if (!parsed.success) {
    return c.json(
      { error: "validation", message: "skip/limit must be non-negative integers (limit ≤ 100)." },
      400,
    );
  }
  const { userId } = c.get("driverPayload");
  const prisma = makePrisma(c.env);
  const sessions = await listDriverSessionHistory(prisma, userId, {
    skip: parsed.data.skip,
    limit: parsed.data.limit,
  });
  return c.json({ sessions });
});

// ── PATCH /api/driver/me ────────────────────────────────────────────
//
// Update the driver's own profile. Only displayName + locale are
// driver-editable; everything else (email, audience, status) is admin-
// only. Empty body is a no-op that returns the current profile.

const updateMeSchema = z.object({
  displayName: z.string().trim().min(1).max(200).optional(),
  locale: z.string().trim().min(2).max(10).optional(),
});

publicDriver.patch("/me", requireDriver, async (c) => {
  const raw = await c.req.json().catch(() => null);
  const parsed = updateMeSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    return c.json(
      { error: "validation", message: "displayName (1–200 chars) and/or locale (2–10 chars) only." },
      400,
    );
  }
  const { userId } = c.get("driverPayload");
  const prisma = makePrisma(c.env);
  const profile = await updateDriverProfile(prisma, userId, parsed.data);
  if (!profile) {
    return c.json({ error: "not_found", message: "User no longer exists." }, 404);
  }
  return c.json(profile);
});

// ── GET /api/driver/installations ───────────────────────────────────
//
// GAP-3 / 2026-05-31 — pre-session preview surface.
//
// Returns installations the driver can charge at RIGHT NOW. Filters out:
//   1. installations where the agreement isn't active at now()
//   2. installations where the agreement has zero clauses (operator
//      hasn't filled the pricing in yet — surfacing them would lock
//      the driver into a session they can't see the price of)
//
// The pricingSummary headline is INDICATIVE — the canonical billing
// math runs at session-stop in the agreements resolver. BearerRule
// overrides and TRD/WRK substitutions are not walked here.

publicDriver.get("/installations", requireDriver, async (c) => {
  const { userId } = c.get("driverPayload");
  const prisma = makePrisma(c.env);
  const installations = await listDriverInstallations(prisma, userId);
  return c.json({ installations });
});

// ── GET /api/driver/chargers/:id/pricing ────────────────────────────
//
// Full clause breakdown for one charger. Access check at single-
// installation scope. 404s for both "doesn't exist" and "you don't
// have access" — same response so we don't leak existence.

publicDriver.get("/chargers/:id/pricing", requireDriver, async (c) => {
  const { userId } = c.get("driverPayload");
  const id = c.req.param("id");
  if (!id) {
    return c.json({ error: "validation", message: "Charger id required." }, 400);
  }
  const prisma = makePrisma(c.env);
  const pricing = await getDriverChargerPricing(prisma, userId, id);
  if (!pricing) {
    return c.json({ error: "not_found", message: "Charger not found." }, 404);
  }
  // signedReceiptSupported is included in the pricing object returned by the
  // repository; pass it through directly — no logic change at this layer.
  return c.json(pricing);
});

// ── POST /api/driver/access-requests ────────────────────────────────
//
// ADR 0022 (2026-05-31 addendum) — driver self-onboarding R1 path.
// A driver who's signed up but isn't yet a member of any DriverGroup
// taps "Request access to this charger" in the mobile app. We log a
// row on agreements.driver_access_requests with triggeredBy='self_request'
// and email both the driver (receipt) and the org's main contact
// (inbound notification).
//
// Validations:
//   - installationId must exist.
//   - Driver must not already have an active membership covering the
//     installation (409 already_have_access).
//   - Driver must not already have a pending request for the same
//     installation (409 already_requested).
//
// Email sends fail OPEN — a Resend outage doesn't block the response.

const accessRequestSchema = z.object({
  installationId: z.string().uuid(),
});

publicDriver.post("/access-requests", requireDriver, async (c) => {
  const raw = await c.req.json().catch(() => null);
  const parsed = accessRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json(
      {
        error: "validation",
        message: "installationId is required (uuid).",
      },
      400,
    );
  }

  const { userId } = c.get("driverPayload");
  const prisma = makePrisma(c.env);

  // Pass the request's origin so the receipt email links back to the
  // same console (staging vs production) the driver is using.
  const origin = c.req.header("origin") ?? c.req.header("referer");
  let baseUrl: string | undefined;
  if (origin) {
    try {
      baseUrl = new URL(origin).origin;
    } catch {
      baseUrl = undefined;
    }
  }

  const result = await createSelfRequest(
    prisma,
    c.env,
    userId,
    parsed.data.installationId,
    { baseUrl },
  );

  if ("error" in result) {
    if (result.error === "installation_not_found") {
      return c.json(
        { error: "not_found", message: "Installation not found." },
        404,
      );
    }
    if (result.error === "already_have_access") {
      return c.json({ error: "already_have_access" }, 409);
    }
    if (result.error === "already_requested") {
      return c.json(
        {
          error: "already_requested",
          existingRequestId: result.existingRequestId,
        },
        409,
      );
    }
    if (result.error === "user_not_found") {
      return c.json(
        { error: "unauthenticated", message: "User no longer exists." },
        401,
      );
    }
    return c.json({ error: "internal" }, 500);
  }

  return c.json({ accessRequest: result.accessRequest }, 201);
});

// ── Health ──────────────────────────────────────────────────────────
publicDriver.get("/health", (c) =>
  c.json({ ok: true, service: "straumvakt-driver-api", config: driverSessionConfig }),
);
