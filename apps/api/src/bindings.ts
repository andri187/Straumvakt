// Worker env bindings — defined here once, imported wherever a route or
// lib accepts `env`. Mirrors what wrangler.jsonc declares.

import type {
  Hyperdrive,
  R2Bucket,
  Service,
  Queue,
} from "@cloudflare/workers-types";
import type { IngestEvent } from "./lib/ocpp/event-envelope";

/**
 * Outbound-command queue message. Tiny on purpose — the row in
 * ocpp.outbound_commands is the source of truth, the message just says
 * "wake up and process this id."
 */
export interface OutboundCommandMessage {
  commandId: string;
}

/**
 * Inbound OCPP event envelope (Sprint 5 / ADR 0017). Produced by the
 * gateway DO on every translated OCPP message; consumed by this Worker.
 * Shape is the canonical `IngestEvent` so the existing
 * `parseIngestEvent` validator + `ingestEvent` repository call work
 * unchanged across the queue boundary.
 */
export type OcppEventMessage = IngestEvent;

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

  // Sprint 7.4 / ADR 0018 Decision 3 — archive queue + R2 bucket.
  // The inbound OCPP events consumer fans out each accepted envelope
  // to ARCHIVE_QUEUE; a separate consumer drains it to EVIDENCE_BUCKET
  // per the documented key scheme. Two queues so an R2 outage cannot
  // block Postgres ack on the inbound side.
  ARCHIVE_QUEUE: Queue<OcppEventMessage>;
  EVIDENCE_BUCKET: R2Bucket;

  // Secrets — set via `wrangler secret put` on the deployed worker.
  // None of these are persisted in wrangler.jsonc.
  AUTH_SECRET: string;
  ADMIN_EMAIL: string;
  ADMIN_PASSWORD: string;
  OCPP_INGEST_SECRET: string;
  // KEK for AES-GCM encryption of stored vendor portal passwords. SHA-256
  // of this secret → AES-256 key. Set via wrangler secret put.
  OCPP_CRED_KEK: string;
  // Sprint 8.9 — shared bearer secret for inbound Zaptec webhooks
  // (AuthenticationType=1). Operator pastes the same value into the
  // Zaptec portal's "Auth payload" field (or as Authorization header)
  // so we can reject spoofed callbacks. Set via wrangler secret put.
  // Optional today — when unset, every webhook returns 503 so the
  // route can't be quietly enabled without a secret in place.
  ZAPTEC_WEBHOOK_SECRET?: string;
  // Diagnostic-only fail-open. Set to "1" or "true" while
  // discovering the exact shape of Zaptec's webhook auth. Bypasses
  // the bearer check, logs every request header + body, accepts the
  // call so the operator can see one real callback land. MUST be
  // unset before going to production — leaving this on lets anyone
  // spoof Accept/Reject decisions and ledger writes. Set via
  // wrangler secret put.
  ZAPTEC_WEBHOOK_DIAGNOSTIC?: string;
  // Deployment environment tag. Set to "staging" for the staging worker
  // via `wrangler secret put APP_ENV --env staging`. Left unset (or set
  // to "production") on the production worker. Used as a safety guard to
  // prevent diagnostic/fail-open modes from running in production.
  APP_ENV?: string;
}

/**
 * Discriminated union of all queue message types this Worker may
 * consume. The `queue()` handler dispatches by `batch.queue` (queue
 * name) — see src/index.ts.
 */
export type QueueMessage = OutboundCommandMessage | OcppEventMessage;
