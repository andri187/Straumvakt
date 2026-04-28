// Straumvakt API Worker — Phase 1 of ADR 0013.
//
// This is the API tier. It runs on Cloudflare Workers, talks to Neon via
// Hyperdrive + PrismaPg, and serves /api/* for the operator console (and
// eventually the driver app and the OCPI gateway). No UI rendering, no
// Next.js, no OpenNext — Wrangler+esbuild bundles this directly so the
// Prisma 7 prisma-client generator's `runtime: "cloudflare"` output works
// without any of the externalize gymnastics the monolith needed.

import { Hono } from "hono";
import { adminOrgs } from "./routes/admin/orgs";
import type { Env } from "./bindings";

const app = new Hono<{ Bindings: Env }>();

// Health check — useful for Cloudflare's deployment verification and for
// catching basic plumbing problems without touching the database.
app.get("/health", (c) => c.json({ ok: true, service: "hlada-api" }));

// Admin endpoints — operator-only, gated by the admin HMAC session that
// the UI mints on /api/admin/login. Login itself lands when the auth
// route is migrated; for now the orgs routes assume an authenticated
// caller (the UI passes the cookie through).
app.route("/api/admin/orgs", adminOrgs);

// 404 for anything else under /api/ — keeps the Worker's error surface
// predictable for the UI.
app.notFound((c) => c.json({ error: "not_found", path: c.req.path }, 404));

// Generic error handler — returns shape the UI knows how to render.
app.onError((err, c) => {
  console.error(err);
  return c.json(
    { error: "internal", message: err instanceof Error ? err.message : String(err) },
    500,
  );
});

export default app;
