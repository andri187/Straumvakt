// Straumvakt "RoadToMarket" — connected TEST API + static frontend host.
//
// SAFE BY CONSTRUCTION: this worker binds NO gateway, NO queues, NO cron,
// NO email, NO R2. It can only read/write the isolated test Postgres DB
// (straumvakt_test) via the Neon serverless driver. It cannot reach the live
// fleet, send email, or issue charger commands — those code paths do not exist
// here. External effects are impossible, not merely disabled by a banner.
//
// It reuses the PROVEN model (harvested Drizzle schema tables, the org-scope +
// permission shape from apps/api) without reviving the 187-endpoint legacy
// surface: only the read/identity operations the console needs are exposed,
// as one resource family with server-enforced tenancy (manifest: "one
// resource, many scopes").
import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { neon } from "@neondatabase/serverless";

const COOKIE = "straumvakt_test_session"; // host-only; never a parent-domain cookie
const TTL_SEC = 12 * 60 * 60;

// ---- crypto helpers (Web Crypto; runs in Workers) ----
const enc = new TextEncoder();
const b64url = (buf) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64urlToBytes = (s) => {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
};
async function hmacKey(secret) {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
async function signSession(secret, payload) {
  const data = b64url(enc.encode(JSON.stringify(payload)));
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return `${data}.${b64url(sig)}`;
}
async function verifySession(secret, token) {
  if (!token || !token.includes(".")) return null;
  const [data, sig] = token.split(".");
  const key = await hmacKey(secret);
  const ok = await crypto.subtle.verify("HMAC", key, b64urlToBytes(sig), enc.encode(data));
  if (!ok) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(data)));
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}
// PBKDF2 verify, matching the seed format pbkdf2$sha256$<iters>$<saltHex>$<hashHex>
function hex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function verifyPassword(stored, password) {
  if (!stored || !stored.startsWith("pbkdf2$")) return false;
  const [, algo, itersStr, saltHex, hashHex] = stored.split("$");
  if (algo !== "sha256") return false;
  const iterations = parseInt(itersStr, 10);
  const salt = Uint8Array.from(saltHex.match(/../g).map((h) => parseInt(h, 16)));
  const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations, hash: "SHA-256" }, keyMaterial, 32 * 8);
  return hex(bits) === hashHex;
}

const db = (c) => neon(c.env.DATABASE_URL);
const json = (c, obj, status = 200) => c.json(obj, status);

// ---- identity resolution (mirrors apps/api /me + org-scope) ----
async function resolveIdentity(c, payload) {
  const sql = db(c);
  const [grant] = await sql`SELECT role::text AS role FROM identity.platform_grants WHERE user_id = ${payload.userId} AND status = 'active' LIMIT 1`;
  const memberships = await sql`
    SELECT m.org_id AS "orgId", o.display_name AS "displayName", o.kind::text AS kind, m.role::text AS role
    FROM tenancy.memberships m JOIN tenancy.organizations o ON o.id = m.org_id
    WHERE m.user_id = ${payload.userId} AND m.status = 'active'`;
  const isPlatform = !!grant;
  const persona = isPlatform
    ? "operator"
    : memberships.some((m) => m.role === "host_admin")
    ? "host_admin"
    : memberships.length
    ? "member"
    : "none";
  return { email: payload.email, userId: payload.userId, persona, isPlatform, platformRole: grant?.role ?? null, orgs: memberships };
}

const app = new Hono();

// ---- auth ----
app.post("/api/admin/login", async (c) => {
  let body;
  try { body = await c.req.json(); } catch { return json(c, { error: "validation" }, 400); }
  const email = (body?.email ?? "").trim().toLowerCase();
  const password = body?.password ?? "";
  if (!email || !password) return json(c, { error: "validation" }, 400);
  const sql = db(c);
  const [row] = await sql`
    SELECT u.id, u.email::text AS email, u.audience::text AS audience, uc.password_hash AS hash
    FROM identity.users u JOIN identity.user_credentials uc ON uc.user_id = u.id
    WHERE u.email = ${email} LIMIT 1`;
  if (!row || row.audience === "driver" || !(await verifyPassword(row.hash, password))) {
    return json(c, { error: "invalid_credentials" }, 401);
  }
  const token = await signSession(c.env.AUTH_SECRET, {
    sub: "admin", email: row.email, userId: row.id, exp: Math.floor(Date.now() / 1000) + TTL_SEC,
  });
  setCookie(c, COOKIE, token, {
    httpOnly: true, secure: true, sameSite: "Lax", path: "/", maxAge: TTL_SEC,
  }); // host-only: no domain attribute -> never collides with *.straumvakt.org
  return json(c, { ok: true, email: row.email });
});

app.post("/api/admin/logout", (c) => {
  deleteCookie(c, COOKIE, { path: "/" });
  return json(c, { ok: true });
});

// ---- auth guard for everything else under /api/admin ----
app.use("/api/admin/*", async (c, next) => {
  const p = c.req.path;
  if (p === "/api/admin/login" || p === "/api/admin/logout") return next();
  const payload = await verifySession(c.env.AUTH_SECRET, getCookie(c, COOKIE));
  if (!payload) return json(c, { error: "unauthorized" }, 401);
  c.set("identity", await resolveIdentity(c, payload));
  return next();
});

app.get("/api/admin/me", (c) => json(c, c.get("identity")));

// helper: assert caller may act on :orgId (platform, or active member)
function orgGuard(c) {
  const id = c.get("identity");
  const orgId = c.req.param("orgId");
  if (id.isPlatform) return orgId;
  if (id.orgs.some((o) => o.orgId === orgId)) return orgId;
  return null;
}

// cross-org list — platform only (mirrors platform.tenant.read)
app.get("/api/admin/orgs", async (c) => {
  const id = c.get("identity");
  if (!id.isPlatform) return json(c, { error: "forbidden", reason: "platform_only" }, 403);
  const sql = db(c);
  const orgs = await sql`
    SELECT o.id, o.display_name AS "displayName", o.country_code AS "countryCode", o.kind::text AS kind,
           o.status::text AS status, o.roles::text[] AS roles,
           (SELECT count(*)::int FROM assets.charging_stations cs WHERE cs.org_id = o.id) AS "chargerCount",
           (SELECT count(*)::int FROM tenancy.memberships m WHERE m.org_id = o.id AND m.role = 'driver' AND m.status='active') AS "driverCount"
    FROM tenancy.organizations o ORDER BY o.display_name`;
  return json(c, { orgs });
});

// org-scoped reads
app.get("/api/admin/orgs/:orgId/chargers", async (c) => {
  const orgId = orgGuard(c); if (!orgId) return json(c, { error: "forbidden" }, 403);
  const sql = db(c);
  const chargers = await sql`
    SELECT cs.site_asset_id AS id, sa.display_name AS name, cs.vendor, cs.model, cs.serial_number AS serial,
           cs.online_since_at AS "onlineSinceAt", i.display_name AS installation, s.display_name AS site,
           (SELECT conn.status FROM assets.evses e JOIN assets.connectors conn ON conn.evse_id = e.id
             WHERE e.charging_station_id = cs.site_asset_id ORDER BY conn.connector_index LIMIT 1) AS status
    FROM assets.charging_stations cs
    JOIN properties.site_assets sa ON sa.id = cs.site_asset_id
    LEFT JOIN properties.installations i ON i.id = cs.installation_id
    LEFT JOIN properties.sites s ON s.id = sa.site_id
    WHERE cs.org_id = ${orgId} ORDER BY sa.display_name`;
  return json(c, { chargers });
});

app.get("/api/admin/orgs/:orgId/drivers", async (c) => {
  const orgId = orgGuard(c); if (!orgId) return json(c, { error: "forbidden" }, 403);
  const sql = db(c);
  const drivers = await sql`
    SELECT u.id AS "userId", u.email::text AS email, u.display_name AS "displayName",
           m.status::text AS status, dg.display_name AS "group"
    FROM tenancy.memberships m
    JOIN identity.users u ON u.id = m.user_id
    LEFT JOIN agreements.driver_group_memberships dgm ON dgm.user_id = u.id
    LEFT JOIN agreements.driver_groups dg ON dg.id = dgm.driver_group_id AND dg.owner_org_id = ${orgId}
    WHERE m.org_id = ${orgId} AND m.role = 'driver' ORDER BY u.display_name`;
  return json(c, { drivers });
});

app.get("/api/admin/orgs/:orgId/sessions", async (c) => {
  const orgId = orgGuard(c); if (!orgId) return json(c, { error: "forbidden" }, 403);
  const sql = db(c);
  const sessions = await sql`
    SELECT s.id, sa.display_name AS charger, u.display_name AS driver, s.started_at AS "startedAt",
           s.ended_at AS "endedAt", s.energy_wh AS "energyWh", s.status::text AS status,
           l.cost_isk_minor AS "costIskMinor"
    FROM charging.sessions s
    LEFT JOIN properties.site_assets sa ON sa.id = s.charging_station_id
    LEFT JOIN identity.users u ON u.id = s.user_id
    LEFT JOIN reports.session_ledger l ON l.session_id = s.id
    WHERE s.org_id = ${orgId} ORDER BY s.started_at DESC`;
  return json(c, { sessions });
});

app.get("/api/admin/orgs/:orgId/installations", async (c) => {
  const orgId = orgGuard(c); if (!orgId) return json(c, { error: "forbidden" }, 403);
  const sql = db(c);
  const installations = await sql`
    SELECT i.id, i.display_name AS "displayName", s.display_name AS site
    FROM properties.installations i LEFT JOIN properties.sites s ON s.id = i.site_id
    WHERE i.org_id = ${orgId} ORDER BY i.display_name`;
  return json(c, { installations });
});

app.get("/api/admin/orgs/:orgId/sites", async (c) => {
  const orgId = orgGuard(c); if (!orgId) return json(c, { error: "forbidden" }, 403);
  const sql = db(c);
  const sites = await sql`
    SELECT s.id, s.display_name AS "displayName",
           (SELECT count(*)::int FROM properties.site_assets sa WHERE sa.site_id = s.id AND sa.kind = 'charger') AS "chargerCount"
    FROM properties.sites s WHERE s.org_id = ${orgId} ORDER BY s.display_name`;
  return json(c, { sites });
});

app.get("/api/admin/orgs/:orgId/agreements", async (c) => {
  const orgId = orgGuard(c); if (!orgId) return json(c, { error: "forbidden" }, 403);
  const sql = db(c);
  const agreements = await sql`
    SELECT id, agreement_type::text AS type, display_name AS "displayName", status::text AS status,
           effective_from AS "effectiveFrom", effective_until AS "effectiveUntil"
    FROM agreements.agreements WHERE cpo_org_id = ${orgId} OR counterparty_org_id = ${orgId}
    ORDER BY effective_from DESC`;
  return json(c, { agreements });
});

// health (no auth)
app.get("/api/health", (c) => json(c, { ok: true, service: "road-to-market-test", ts: new Date().toISOString() }));

// API 404
app.all("/api/*", (c) => json(c, { error: "not_found" }, 404));

// ---- static frontend (served from the ASSETS binding) ----
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) return app.fetch(request, env, ctx);
    return env.ASSETS.fetch(request);
  },
};
