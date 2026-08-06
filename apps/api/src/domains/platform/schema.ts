// platform — logs, audit, issues, webhooks — Drizzle table declarations.
//
// Postgres schemas: events · audit · issues · webhooks
//
// Everything may import platform. Platform imports nothing.
//
// Additive. Prisma still owns these tables and still generates a client for
// them; nothing here replaces anything yet.
//
// First drafted by scripts/drizzle-scaffold-from-prisma.mjs from
// prisma/schema/platform.prisma, then OWNED BY HAND. Re-running the scaffolder
// over this file discards the hand edits — which is survivable, because
// test/parity/domain-schemas.test.ts checks all 98 tables against
// information_schema and goes red the moment one is lost.
//
// Relations and foreign keys are deliberately NOT declared: Drizzle needs
// them only for db.query relational reads, every ported repository uses
// explicit joins, and a wrong FK declaration would be a silent lie about
// cascade behaviour.

import { bigint, boolean, date, index, integer, jsonb, pgSchema, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const auditSchema = pgSchema("audit");
export const eventsSchema = pgSchema("events");
export const issuesSchema = pgSchema("issues");
export const webhooksSchema = pgSchema("webhooks");

export const issueSubjectEnum = issuesSchema.enum("IssueSubject", ["charger", "ocpp_identity", "connector", "session", "site", "user", "other"]);
export const issueSeverityEnum = issuesSchema.enum("IssueSeverity", ["low", "medium", "high", "critical"]);
export const issueStatusEnum = issuesSchema.enum("IssueStatus", ["open", "triaged", "assigned", "in_progress", "waiting", "resolved", "closed"]);
export const retentionClassEnum = eventsSchema.enum("RetentionClass", ["financial", "operational", "raw_protocol", "aggregate", "issue_history"]);
export const actorKindEnum = auditSchema.enum("ActorKind", ["user", "system", "vendor_webhook", "ocpp_worker"]);

/** Prisma model `IssueTicket` — issues.tickets */
export const tickets = issuesSchema.table(
  "tickets",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    orgId: uuid("org_id").notNull(),
    subjectType: issueSubjectEnum("subject_type").notNull(),
    subjectId: uuid("subject_id"),
    category: text("category").notNull(),
    severity: issueSeverityEnum("severity").notNull().default("medium"),
    status: issueStatusEnum("status").notNull().default("open"),
    detectedBy: text("detected_by").notNull(),
    assignedToUserId: uuid("assigned_to_user_id"),
    assignedToContractorId: uuid("assigned_to_contractor_id"),
    slaTargetAt: timestamp("sla_target_at", { withTimezone: true, precision: 6, mode: "date" }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true, precision: 6, mode: "date" }),
    resolutionSummary: text("resolution_summary"),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().$defaultFn(() => new Date()).$onUpdateFn(() => new Date()),
  },
  (t) => [
    index().on(t.orgId, t.status, t.severity),
    index().on(t.subjectType, t.subjectId),
  ],
);

/** Prisma model `TicketEvent` — issues.ticket_events */
export const ticketEvents = issuesSchema.table(
  "ticket_events",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    ticketId: uuid("ticket_id").notNull(),
    eventType: text("event_type").notNull(),
    actorUserId: uuid("actor_user_id"),
    payload: jsonb("payload").notNull().default({}),
    occurredAt: timestamp("occurred_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    index().on(t.ticketId, t.occurredAt),
  ],
);

/** Prisma model `DetectionRule` — issues.detection_rules */
export const detectionRules = issuesSchema.table(
  "detection_rules",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    orgId: uuid("org_id").notNull(),
    ruleKey: text("rule_key").notNull(),
    config: jsonb("config").notNull().default({}),
    enabled: boolean("enabled").notNull().default(true),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().$defaultFn(() => new Date()).$onUpdateFn(() => new Date()),
  },
  (t) => [
    uniqueIndex().on(t.orgId, t.ruleKey),
  ],
);

/** Prisma model `EventLogEntry` — events.event_log */
export const eventLog = eventsSchema.table(
  "event_log",
  {
    id: uuid("id").notNull(),
    orgId: uuid("org_id").notNull(),
    aggregateType: text("aggregate_type").notNull(),
    aggregateId: uuid("aggregate_id").notNull(),
    eventType: text("event_type").notNull(),
    schemaVersion: integer("schema_version").notNull().default(1),
    payload: jsonb("payload").notNull(),
    metadata: jsonb("metadata").notNull().default({}),
    retentionClass: retentionClassEnum("retention_class").notNull().default("operational"),
    occurredAt: timestamp("occurred_at", { withTimezone: true, precision: 6, mode: "date" }).notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.id, t.recordedAt] }),
    index().on(t.orgId, t.occurredAt),
    index().on(t.aggregateType, t.aggregateId, t.occurredAt),
    index().on(t.eventType, t.occurredAt),
  ],
);

/** Prisma model `ArchiveWatermark` — events.archive_watermark */
export const archiveWatermark = eventsSchema.table(
  "archive_watermark",
  {
    retentionClass: retentionClassEnum("retention_class").notNull(),
    day: date("day", { mode: "date" }).notNull(),
    objectCount: bigint("object_count", { mode: "bigint" }).notNull().default(0n),
    lastWriteAt: timestamp("last_write_at", { withTimezone: true, precision: 6, mode: "date" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.retentionClass, t.day] }),
    index().on(t.day),
  ],
);

/** Prisma model `IdempotencyKey` — events.idempotency_keys */
export const idempotencyKeys = eventsSchema.table(
  "idempotency_keys",
  {
    scope: text("scope").notNull(),
    key: text("key").notNull(),
    result: jsonb("result"),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true, precision: 6, mode: "date" }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.scope, t.key] }),
    index().on(t.expiresAt),
  ],
);

/** Prisma model `AuditAction` — audit.actions */
export const actions = auditSchema.table(
  "actions",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    orgId: uuid("org_id").notNull(),
    actorUserId: uuid("actor_user_id"),
    actorKind: actorKindEnum("actor_kind").notNull(),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: uuid("target_id"),
    metadata: jsonb("metadata").notNull().default({}),
    occurredAt: timestamp("occurred_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    index().on(t.orgId, t.occurredAt),
    index().on(t.targetType, t.targetId, t.occurredAt),
  ],
);

/** Prisma model `WebhookSubscription` — webhooks.subscriptions */
export const subscriptions = webhooksSchema.table(
  "subscriptions",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    orgId: uuid("org_id").notNull(),
    name: text("name").notNull(),
    endpointUrl: text("endpoint_url").notNull(),
    signingSecretRef: text("signing_secret_ref").notNull(),
    // HAND-EDIT, not from the scaffolder. Prisma types this as a non-null
    // list; Postgres allows NULL, because Prisma does NOT emit NOT NULL for
    // scalar list columns. Four columns in this database are affected and
    // only tenancy.memberships.scope_* escape it, via a hand-written
    // migration. Declared to match the DATABASE, which is what a query
    // actually returns. See docs/notes/2026-08-06-schema-database-drift-
    // reconciliation.md; restoring the constraints is a staging migration.
    scopes: text("scopes").array(),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().$defaultFn(() => new Date()).$onUpdateFn(() => new Date()),
  },
  (t) => [
    index().on(t.orgId),
  ],
);

/** Prisma model `WebhookDelivery` — webhooks.deliveries */
export const deliveries = webhooksSchema.table(
  "deliveries",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    subscriptionId: uuid("subscription_id").notNull(),
    eventId: uuid("event_id").notNull(),
    attempt: integer("attempt").notNull(),
    status: text("status").notNull(),
    responseCode: integer("response_code"),
    responseBody: text("response_body"),
    deliveredAt: timestamp("delivered_at", { withTimezone: true, precision: 6, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    index().on(t.subscriptionId, t.createdAt),
  ],
);

/** Prisma model `WebhookDeadLetter` — webhooks.dead_letters */
export const deadLetters = webhooksSchema.table(
  "dead_letters",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    subscriptionId: uuid("subscription_id").notNull(),
    eventId: uuid("event_id").notNull(),
    payload: jsonb("payload").notNull(),
    lastError: text("last_error"),
    movedAt: timestamp("moved_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    index().on(t.subscriptionId, t.movedAt),
  ],
);

/** Prisma model `ProtocolLogEntry` — events.protocol_log */
export const protocolLog = eventsSchema.table(
  "protocol_log",
  {
    id: uuid("id").notNull(),
    orgId: uuid("org_id").notNull(),
    aggregateType: text("aggregate_type").notNull(),
    aggregateId: uuid("aggregate_id").notNull(),
    eventType: text("event_type").notNull(),
    schemaVersion: integer("schema_version").notNull().default(1),
    payload: jsonb("payload").notNull(),
    metadata: jsonb("metadata").notNull().default({}),
    retentionClass: retentionClassEnum("retention_class").notNull().default("raw_protocol"),
    occurredAt: timestamp("occurred_at", { withTimezone: true, precision: 6, mode: "date" }).notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.id, t.recordedAt] }),
    index().on(t.orgId, t.occurredAt),
    index().on(t.aggregateType, t.aggregateId, t.occurredAt),
    index().on(t.eventType, t.occurredAt),
  ],
);

