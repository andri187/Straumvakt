// Worker env bindings — defined here once, imported wherever a route or
// lib accepts `env`. Mirrors what wrangler.jsonc declares.

import type { Hyperdrive, Service } from "@cloudflare/workers-types";

export interface Env {
  // Hyperdrive — pooled Postgres to Neon. Bound on the staging env in
  // wrangler.jsonc. Production gets its own Hyperdrive resource.
  HYPERDRIVE_DB: Hyperdrive;

  // OCPP gateway service binding — admin command dispatch goes through
  // the gateway worker via env.OCPP_GATEWAY.fetch(...).
  OCPP_GATEWAY: Service;

  // Secrets — set via `wrangler secret put` on the deployed worker.
  // None of these are persisted in wrangler.jsonc.
  AUTH_SECRET: string;
  ADMIN_EMAIL: string;
  ADMIN_PASSWORD: string;
  OCPP_INGEST_SECRET: string;
}
