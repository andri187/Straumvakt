// Straumvakt API Worker — Phase 1 of ADR 0013.
//
// This is the API tier. It runs on Cloudflare Workers, talks to Neon via
// Hyperdrive + PrismaPg, and serves /api/* for the operator console (and
// eventually the driver app and the OCPI gateway). No UI rendering, no
// Next.js, no OpenNext — Wrangler+esbuild bundles this directly so the
// Prisma 7 prisma-client generator's `runtime: "cloudflare"` output works
// without any externalize gymnastics the monolith needed.

import { Hono } from "hono";
import { adminAuth } from "./routes/admin/auth";
import { adminOrgs } from "./routes/admin/orgs";
import { adminProperties } from "./routes/admin/properties";
import { adminSites } from "./routes/admin/sites";
import { adminInstallations } from "./routes/admin/installations";
import { adminCircuits } from "./routes/admin/circuits";
import { adminUsers } from "./routes/admin/users";
import { adminMemberships } from "./routes/admin/memberships";
import type { Env } from "./bindings";

const app = new Hono<{ Bindings: Env }>();

app.get("/health", (c) => c.json({ ok: true, service: "hlada-api" }));

// Auth — login mints the admin HMAC cookie, logout clears it. Required
// by every other admin route via the requireAdmin middleware.
app.route("/api/admin", adminAuth);

// Admin entity routes — all gated by requireAdmin inside their files.
app.route("/api/admin/orgs", adminOrgs);
app.route("/api/admin/properties", adminProperties);
app.route("/api/admin/sites", adminSites);
app.route("/api/admin/installations", adminInstallations);
app.route("/api/admin/circuits", adminCircuits);
app.route("/api/admin/users", adminUsers);
app.route("/api/admin/memberships", adminMemberships);
// /api/admin/charging-stations + /api/admin/chargers — multi-table create
// transaction (SiteAsset + ChargingStation + EVSE + Connector + OcppIdentity)
// stays on the monolith until next port pass. List/detail/update will land
// in a follow-up commit on this branch.

app.notFound((c) => c.json({ error: "not_found", path: c.req.path }, 404));

app.onError((err, c) => {
  console.error(err);
  return c.json(
    { error: "internal", message: err instanceof Error ? err.message : String(err) },
    500,
  );
});

export default app;
