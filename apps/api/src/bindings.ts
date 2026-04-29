// Worker env bindings — defined here once, imported wherever a route or
// lib accepts `env`. Mirrors what wrangler.jsonc declares.

import type { Hyperdrive, Service, Queue } from "@cloudflare/workers-types";

/**
 * Outbound-command queue message. Tiny on purpose — the row in
 * ocpp.outbound_commands is the source of truth, the message just says
 * "wake up and process this id."
 */
export interface OutboundCommandMessage {
  commandId: string;
}

export interface Env {
  // Hyperdrive — pooled Postgres to Neon. Bound on the staging env in
  // wrangler.jsonc. Production gets its own Hyperdrive resource.
  HYPERDRIVE_DB: Hyperdrive;

  // OCPP gateway service binding — admin command dispatch goes through
  // the gateway worker via env.OCPP_GATEWAY.fetch(...).
  OCPP_GATEWAY: Service;

  // Outbound-command queue — producer side is the admin enqueue route,
  // consumer side is the same Worker (queue handler in src/index.ts).
  // Messages are { commandId } pointers into ocpp.outbound_commands.
  OUTBOUND_QUEUE: Queue<OutboundCommandMessage>;

  // Secrets — set via `wrangler secret put` on the deployed worker.
  // None of these are persisted in wrangler.jsonc.
  AUTH_SECRET: string;
  ADMIN_EMAIL: string;
  ADMIN_PASSWORD: string;
  OCPP_INGEST_SECRET: string;
  // KEK for AES-GCM encryption of stored vendor portal passwords. SHA-256
  // of this secret → AES-256 key. Set via wrangler secret put.
  OCPP_CRED_KEK: string;
}
