// commercial — agreements, tariffs, invoices, priced records — Drizzle table declarations.
//
// Postgres schemas: billing · agreements · entitlements · reports
//
// Top of the chain. THREE BILLING GENERATIONS COEXIST HERE — ADR 0025's
// premises are wrong and decisions D1-D5 are unanswered. Declaring these
// tables changes nothing about that; nothing here is to be deleted or
// restructured until they are answered.
//
// Additive. Prisma still owns these tables and still generates a client for
// them; nothing here replaces anything yet.
//
// First drafted by scripts/drizzle-scaffold-from-prisma.mjs from
// prisma/schema/commercial.prisma, then OWNED BY HAND. Re-running the scaffolder
// over this file discards the hand edits — which is survivable, because
// test/parity/domain-schemas.test.ts checks all 98 tables against
// information_schema and goes red the moment one is lost.
//
// Relations and foreign keys are deliberately NOT declared: Drizzle needs
// them only for db.query relational reads, every ported repository uses
// explicit joins, and a wrong FK declaration would be a silent lie about
// cascade behaviour.

import { sql } from "drizzle-orm";
import { bigint, boolean, customType, date, index, integer, jsonb, numeric, pgSchema, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const agreementsSchema = pgSchema("agreements");
export const billingSchema = pgSchema("billing");
export const entitlementsSchema = pgSchema("entitlements");
export const reportsSchema = pgSchema("reports");

export const balanceTypeEnum = billingSchema.enum("BalanceType", ["prepaid", "postpaid", "non_paying", "pay_immediately", "postpaid_immediately"]);
export const planCategoryEnum = billingSchema.enum("PlanCategory", ["single_tariff", "membership", "roaming", "guest_otp"]);
export const terminationBehaviorEnum = billingSchema.enum("TerminationBehavior", ["terminate", "evergreen", "rollover"]);
export const billingTxTypeEnum = billingSchema.enum("BillingTxType", ["payment", "refund", "penalty", "credit", "contract_charge", "external_payment"]);
export const invoiceStatusEnum = billingSchema.enum("InvoiceStatus", ["draft", "issued", "paid", "void"]);
export const costFactorAnchorEnum = billingSchema.enum("CostFactorAnchor", ["org", "property", "site", "installation", "circuit", "charger", "driver_contract"]);
export const costFactorStatusEnum = billingSchema.enum("CostFactorStatus", ["draft", "active", "archived"]);
export const contractScopeTypeEnum = billingSchema.enum("ContractScopeType", ["org", "property", "site", "installation", "charger"]);
export const contractStatusEnum = billingSchema.enum("ContractStatus", ["pending_configuration", "active", "superseded", "archived"]);
export const driverContractOwnerTypeEnum = billingSchema.enum("DriverContractOwnerType", ["workplace", "family_group", "self"]);
export const agreementTypeEnum = agreementsSchema.enum("AgreementType", ["service_cpo", "service_contractor", "service_workplace", "installation", "workplace"]);
export const agreementStatusEnum = agreementsSchema.enum("AgreementStatus", ["draft", "active", "expired"]);
export const bearerTypeEnum = agreementsSchema.enum("BearerType", ["org", "usr", "trd"]);
export const ruleScopeTypeEnum = agreementsSchema.enum("RuleScopeType", ["site", "installation", "circuit", "charger"]);
export const ruleAudienceTypeEnum = agreementsSchema.enum("RuleAudienceType", ["driver_group", "user"]);
export const rateBasisEnum = agreementsSchema.enum("RateBasis", ["per_kwh", "per_minute", "per_day", "per_session", "per_connector"]);
export const billingLineKindEnum = agreementsSchema.enum("BillingLineKind", ["passthrough", "markup"]);
export const agrCostFactorStatusEnum = agreementsSchema.enum("AgrCostFactorStatus", ["draft", "active", "archived"]);
export const billObjectKindEnum = billingSchema.enum("BillObjectKind", ["apartment", "unit", "stall", "company", "department", "cost_center", "other"]);
export const billObjectStatusEnum = billingSchema.enum("BillObjectStatus", ["active", "inactive"]);
export const driverAccessRequestTriggerEnum = agreementsSchema.enum("DriverAccessRequestTrigger", ["self_request", "email_domain_match"]);
export const driverAccessRequestStatusEnum = agreementsSchema.enum("DriverAccessRequestStatus", ["pending", "approved", "denied", "withdrawn"]);

/** Prisma model `Tariff` — billing.tariffs */
export const tariffs = billingSchema.table(
  "tariffs",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    orgId: uuid("org_id").notNull(),
    displayName: text("display_name").notNull(),
    rule: jsonb("rule").notNull(),
    currency: text("currency").notNull(),
    validFrom: timestamp("valid_from", { withTimezone: true, precision: 6, mode: "date" }).notNull(),
    validUntil: timestamp("valid_until", { withTimezone: true, precision: 6, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    index().on(t.orgId),
  ],
);

/** Prisma model `CustomerPlan` — billing.customer_plans */

/** Prisma model `Subscription` — billing.subscriptions */

/** Prisma model `BillingTransaction` — billing.billing_transactions */

/** Prisma model `Invoice` — billing.invoices */

/** Prisma model `InvoiceLine` — billing.invoice_lines */

/** Prisma model `Statement` — billing.statements */

/** Prisma model `FeatureFlag` — entitlements.feature_flags */

/** Prisma model `EnterpriseLicense` — entitlements.enterprise_licenses */

/** Prisma model `CostFactor` — billing.cost_factors */
export const billingCostFactors = billingSchema.table(
  "cost_factors",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    code: text("code").notNull(),
    displayName: text("display_name").notNull(),
    description: text("description"),
    anchorTier: costFactorAnchorEnum("anchor_tier").notNull(),
    defaultVatRatePct: numeric("default_vat_rate_pct", { precision: 4, scale: 2 }).notNull(),
    defaultCurrency: text("default_currency").notNull().default("ISK"),
    status: costFactorStatusEnum("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().$defaultFn(() => new Date()).$onUpdateFn(() => new Date()),
  },
);

/** Prisma model `TariffDefinition` — billing.tariff_definitions */
export const tariffDefinitions = billingSchema.table(
  "tariff_definitions",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    orgId: uuid("org_id").notNull(),
    costFactorId: uuid("cost_factor_id").notNull(),
    displayName: text("display_name").notNull(),
    computeRule: jsonb("compute_rule").notNull(),
    vatRatePct: numeric("vat_rate_pct", { precision: 4, scale: 2 }).notNull(),
    currency: text("currency").notNull().default("ISK"),
    validFrom: timestamp("valid_from", { withTimezone: true, precision: 6, mode: "date" }).notNull(),
    validUntil: timestamp("valid_until", { withTimezone: true, precision: 6, mode: "date" }),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().$defaultFn(() => new Date()).$onUpdateFn(() => new Date()),
  },
  (t) => [
    index().on(t.orgId, t.costFactorId, t.validFrom),
  ],
);

/** Prisma model `CostCenter` — billing.cost_centers */
export const costCenters = billingSchema.table(
  "cost_centers",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    orgId: uuid("org_id").notNull(),
    code: text("code").notNull(),
    displayName: text("display_name").notNull(),
    payerOrgId: uuid("payer_org_id"),
    payerUserId: uuid("payer_user_id"),
    beneficiaryOrgId: uuid("beneficiary_org_id"),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().$defaultFn(() => new Date()).$onUpdateFn(() => new Date()),
  },
  (t) => [
    uniqueIndex().on(t.orgId, t.code),
  ],
);

/** Prisma model `Contract` — billing.contracts */
export const contracts = billingSchema.table(
  "contracts",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    orgId: uuid("org_id").notNull(),
    counterpartyOrgId: uuid("counterparty_org_id"),
    scopeType: contractScopeTypeEnum("scope_type").notNull(),
    scopeId: uuid("scope_id"),
    parentContractId: uuid("parent_contract_id"),
    displayName: text("display_name").notNull(),
    status: contractStatusEnum("status").notNull().default("pending_configuration"),
    validFrom: timestamp("valid_from", { withTimezone: true, precision: 6, mode: "date" }).notNull(),
    validUntil: timestamp("valid_until", { withTimezone: true, precision: 6, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().$defaultFn(() => new Date()).$onUpdateFn(() => new Date()),
  },
  (t) => [
    index().on(t.orgId, t.scopeType, t.scopeId),
    index().on(t.counterpartyOrgId),
  ],
);

/** Prisma model `ContractFactorAssignment` — billing.contract_factor_assignments */

/** Prisma model `DriverContract` — billing.driver_contracts */
export const driverContracts = billingSchema.table(
  "driver_contracts",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    orgId: uuid("org_id").notNull(),
    userId: uuid("user_id").notNull(),
    scopeType: contractScopeTypeEnum("scope_type"),
    scopeId: uuid("scope_id"),
    parentContractId: uuid("parent_contract_id"),
    ownerType: driverContractOwnerTypeEnum("owner_type").notNull(),
    ownerId: uuid("owner_id").notNull(),
    wrkpfTariffId: uuid("wrkpf_tariff_id"),
    displayName: text("display_name").notNull(),
    status: contractStatusEnum("status").notNull().default("pending_configuration"),
    validFrom: timestamp("valid_from", { withTimezone: true, precision: 6, mode: "date" }).notNull(),
    validUntil: timestamp("valid_until", { withTimezone: true, precision: 6, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().$defaultFn(() => new Date()).$onUpdateFn(() => new Date()),
  },
  (t) => [
    index().on(t.orgId, t.userId, t.validFrom),
  ],
);

/** Prisma model `DriverContractFactorOverride` — billing.driver_contract_factor_overrides */

/** Prisma model `ContractPeriodAccumulator` — billing.contract_period_accumulators */

/** Prisma model `BillingLine` — billing.billing_lines */
export const billingBillingLines = billingSchema.table(
  "billing_lines",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    orgId: uuid("org_id").notNull(),
    sessionId: uuid("session_id").notNull(),
    costFactorId: uuid("cost_factor_id").notNull(),
    costFactorCode: text("cost_factor_code").notNull(),
    costCenterId: uuid("cost_center_id").notNull(),
    amountExVatMinor: bigint("amount_ex_vat_minor", { mode: "bigint" }).notNull(),
    vatRatePct: numeric("vat_rate_pct", { precision: 4, scale: 2 }).notNull(),
    vatAmountMinor: bigint("vat_amount_minor", { mode: "bigint" }).notNull(),
    amountIncVatMinor: bigint("amount_inc_vat_minor", { mode: "bigint" }).notNull(),
    currency: text("currency").notNull(),
    computationDetail: jsonb("computation_detail").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    index().on(t.orgId, t.sessionId),
    index().on(t.costCenterId, t.createdAt),
  ],
);

/** Prisma model `BillingPeriodSummary` — reports.billing_period_summary */

/** Prisma model `SessionLedger` — reports.session_ledger */
export const sessionLedger = reportsSchema.table(
  "session_ledger",
  {
    sessionId: uuid("session_id").primaryKey(),
    orgId: uuid("org_id").notNull(),
    siteId: uuid("site_id"),
    chargingStationId: uuid("charging_station_id"),
    driverUserId: uuid("driver_user_id"),
    driverIdTag: text("driver_id_tag"),
    startedAt: timestamp("started_at", { withTimezone: true, precision: 6, mode: "date" }).notNull(),
    stoppedAt: timestamp("stopped_at", { withTimezone: true, precision: 6, mode: "date" }),
    durationSec: integer("duration_sec"),
    energyKwh: numeric("energy_kwh", { precision: 10, scale: 3 }).notNull().default("0"),
    costIskMinor: bigint("cost_isk_minor", { mode: "bigint" }),
    tariffDefinitionId: uuid("tariff_definition_id"),
    computedAt: timestamp("computed_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().defaultNow(),
    verifiedSource: text("verified_source"),
    enrichmentStatus: text("enrichment_status"),
  },
  (t) => [
    index().on(t.orgId, t.startedAt),
    index().on(t.driverUserId, t.startedAt),
    index().on(t.chargingStationId, t.startedAt),
  ],
);

/** Prisma model `AgreementCostFactor` — agreements.cost_factors */
export const agreementsCostFactors = agreementsSchema.table(
  "cost_factors",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    code: text("code").notNull(),
    displayNameIs: text("display_name_is").notNull(),
    displayNameEn: text("display_name_en").notNull(),
    description: text("description"),
    status: agrCostFactorStatusEnum("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().$defaultFn(() => new Date()).$onUpdateFn(() => new Date()),
  },
);

/** Prisma model `RateReference` — agreements.rate_references */
export const rateReferences = agreementsSchema.table(
  "rate_references",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    code: text("code").notNull(),
    costFactorId: uuid("cost_factor_id").notNull(),
    supplierOrgId: uuid("supplier_org_id"),
    basis: rateBasisEnum("basis").notNull(),
    priceMinor: bigint("price_minor", { mode: "bigint" }).notNull(),
    currency: text("currency").notNull().default("ISK"),
    vatRatePct: numeric("vat_rate_pct", { precision: 4, scale: 2 }).notNull(),
    effectiveFrom: timestamp("effective_from", { withTimezone: true, precision: 6, mode: "date" }).notNull(),
    effectiveUntil: timestamp("effective_until", { withTimezone: true, precision: 6, mode: "date" }),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    index().on(t.code, t.effectiveFrom),
    index().on(t.costFactorId, t.effectiveFrom),
  ],
);

/** Prisma model `Agreement` — agreements.agreements */
export const agreements = agreementsSchema.table(
  "agreements",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    agreementType: agreementTypeEnum("agreement_type").notNull(),
    counterpartyOrgId: uuid("counterparty_org_id").notNull(),
    cpoOrgId: uuid("cpo_org_id"),
    installationId: uuid("installation_id"),
    defaultDriverGroupId: uuid("default_driver_group_id"),
    displayName: text("display_name").notNull(),
    status: agreementStatusEnum("status").notNull().default("draft"),
    effectiveFrom: timestamp("effective_from", { withTimezone: true, precision: 6, mode: "date" }).notNull(),
    effectiveUntil: timestamp("effective_until", { withTimezone: true, precision: 6, mode: "date" }),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().$defaultFn(() => new Date()).$onUpdateFn(() => new Date()),
  },
  (t) => [
    index().on(t.counterpartyOrgId, t.status),
    index().on(t.cpoOrgId),
    index().on(t.installationId),
    index().on(t.effectiveFrom),
  ],
);

/**
 * A half-open UTC interval, `[from, until)`. ADR 0054's temporal column.
 *
 * DUPLICATED, ON PURPOSE, from packages/shared/src/db/assets.ts. The files in
 * this directory are deliberately independent — the deps-graph gate keeps them
 * that way, and one db file importing another would create the first edge.
 * Drizzle's `customType` is a declaration, not state: two of them describe the
 * same Postgres type and cannot drift into disagreeing about it, because the
 * only thing either says is the string "tstzrange".
 *
 * The CONSTRAINT is not here. Drizzle cannot express `WITHOUT OVERLAPS` or
 * `EXCLUDE`; migration 0006 carries it, hand-written, and the snapshot does not
 * know it exists. Same divergence as 0005, declared the same way.
 */
const tstzrange = customType<{ data: string }>({ dataType: () => "tstzrange" });

/** Prisma model `AgreementClause` — agreements.agreement_clauses */
export const agreementClauses = agreementsSchema.table(
  "agreement_clauses",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    agreementId: uuid("agreement_id").notNull(),
    costFactorId: uuid("cost_factor_id").notNull(),
    defaultBearerType: bearerTypeEnum("default_bearer_type").notNull(),
    defaultBearerRef: uuid("default_bearer_ref"),
    defaultRateRefCode: text("default_rate_ref_code"),
    allocationJson: jsonb("allocation_json").notNull(),
    /** `[from, until)`. SR-1. Open-ended is `[from,)`, never NULL. */
    period: tstzrange("period").notNull().default(sql`tstzrange(now(), NULL, '[)')`),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().$defaultFn(() => new Date()).$onUpdateFn(() => new Date()),
  },
  (t) => [
    // The pair unique is GONE — see migration 0006. It said "one clause per
    // factor, ever", which is exactly what SR-1 needs to stop being true: a
    // rate that changed in July is two clauses for one factor. Uniqueness
    // moved onto the INTERVAL, and Drizzle cannot declare that.
    index().on(t.agreementId, t.costFactorId),
  ],
);

/** Prisma model `DriverGroup` — agreements.driver_groups */
export const driverGroups = agreementsSchema.table(
  "driver_groups",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    agreementId: uuid("agreement_id").notNull(),
    ownerOrgId: uuid("owner_org_id").notNull(),
    displayName: text("display_name").notNull(),
    scopeFilterJson: jsonb("scope_filter_json").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().$defaultFn(() => new Date()).$onUpdateFn(() => new Date()),
  },
  (t) => [
    index().on(t.agreementId),
    index().on(t.ownerOrgId),
  ],
);

/** Prisma model `DriverGroupMembership` — agreements.driver_group_memberships */
export const driverGroupMemberships = agreementsSchema.table(
  "driver_group_memberships",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    driverGroupId: uuid("driver_group_id").notNull(),
    userId: uuid("user_id").notNull(),
    addedAt: timestamp("added_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().defaultNow(),
    /**
     * `[from, until)`. SR-2 / ADR 0054 decision 4.
     *
     * `added_at` stays: it is when the ROW was written, which is an audit
     * fact and not always the same instant as when the membership became
     * valid. `period` is the validity, and it is what every access check and
     * every driver-count reads.
     */
    period: tstzrange("period").notNull().default(sql`tstzrange(now(), NULL, '[)')`),
  },
  (t) => [
    // UNIQUE (driver_group_id, user_id) is GONE — migration 0006. It made
    // move-out-then-move-in inexpressible: the second row collided with the
    // first, so the only way to re-add a driver was to DELETE the history of
    // their first stay. Uniqueness is on the interval now, which Drizzle
    // cannot declare, so the plain index is what remains here.
    index().on(t.driverGroupId, t.userId),
    index().on(t.userId),
  ],
);

/** Prisma model `BillObject` — billing.bill_objects */
export const billObjects = billingSchema.table(
  "bill_objects",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    orgId: uuid("org_id").notNull(),
    installationId: uuid("installation_id"),
    kind: billObjectKindEnum("kind").notNull(),
    label: text("label").notNull(),
    parentId: uuid("parent_id"),
    ownerUserId: uuid("owner_user_id"),
    ownerOrgId: uuid("owner_org_id"),
    status: billObjectStatusEnum("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().$defaultFn(() => new Date()).$onUpdateFn(() => new Date()),
  },
  (t) => [
    index().on(t.orgId, t.installationId),
    index().on(t.ownerUserId),
    index().on(t.ownerOrgId),
  ],
);

/** Prisma model `BillObjectMember` — billing.bill_object_members */
export const billObjectMembers = billingSchema.table(
  "bill_object_members",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    billObjectId: uuid("bill_object_id").notNull(),
    userId: uuid("user_id").notNull(),
    effectiveFrom: timestamp("effective_from", { withTimezone: true, precision: 6, mode: "date" }).notNull().defaultNow(),
    effectiveTo: timestamp("effective_to", { withTimezone: true, precision: 6, mode: "date" }),
  },
  (t) => [
    index().on(t.userId, t.effectiveTo),
    index().on(t.billObjectId),
  ],
);

/** Prisma model `DriverAccessRequest` — agreements.driver_access_requests */
export const driverAccessRequests = agreementsSchema.table(
  "driver_access_requests",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    userId: uuid("user_id").notNull(),
    installationId: uuid("installation_id").notNull(),
    triggeredBy: driverAccessRequestTriggerEnum("triggered_by").notNull(),
    orgEmailDomainId: uuid("org_email_domain_id"),
    status: driverAccessRequestStatusEnum("status").notNull().default("pending"),
    reviewedByUserId: uuid("reviewed_by_user_id"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true, precision: 6, mode: "date" }),
    denialReason: text("denial_reason"),
    resultingMembershipId: uuid("resulting_membership_id"),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().$defaultFn(() => new Date()).$onUpdateFn(() => new Date()),
  },
  (t) => [
    index().on(t.status, t.installationId),
    index().on(t.userId, t.status),
  ],
);

/** Prisma model `BearerRule` — agreements.bearer_rules */
export const bearerRules = agreementsSchema.table(
  "bearer_rules",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    agreementId: uuid("agreement_id").notNull(),
    costFactorId: uuid("cost_factor_id").notNull(),
    scopeType: ruleScopeTypeEnum("scope_type"),
    scopeId: uuid("scope_id"),
    audienceType: ruleAudienceTypeEnum("audience_type"),
    audienceId: uuid("audience_id"),
    bearerType: bearerTypeEnum("bearer_type"),
    bearerRef: uuid("bearer_ref"),
    rateRefCode: text("rate_ref_code"),
    allocationJson: jsonb("allocation_json"),
    effectiveFrom: timestamp("effective_from", { withTimezone: true, precision: 6, mode: "date" }).notNull(),
    effectiveUntil: timestamp("effective_until", { withTimezone: true, precision: 6, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().$defaultFn(() => new Date()).$onUpdateFn(() => new Date()),
  },
  (t) => [
    index().on(t.agreementId, t.costFactorId, t.audienceType, t.audienceId, t.scopeType, t.scopeId, t.effectiveFrom),
    index().on(t.effectiveFrom),
  ],
);

/** Prisma model `AgreementBillingLine` — agreements.billing_lines */
export const agreementsBillingLines = agreementsSchema.table(
  "billing_lines",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    agreementId: uuid("agreement_id").notNull(),
    billableEventType: text("billable_event_type").notNull().default("session"),
    sessionId: uuid("session_id"),
    factorCode: text("factor_code").notNull(),
    kind: billingLineKindEnum("kind").notNull(),
    basisType: rateBasisEnum("basis_type").notNull(),
    basisQuantity: numeric("basis_quantity", { precision: 14, scale: 4 }).notNull(),
    unitPriceMinor: bigint("unit_price_minor", { mode: "bigint" }).notNull(),
    amountExVatMinor: bigint("amount_ex_vat_minor", { mode: "bigint" }).notNull(),
    vatRatePct: numeric("vat_rate_pct", { precision: 4, scale: 2 }).notNull(),
    vatAmountMinor: bigint("vat_amount_minor", { mode: "bigint" }).notNull(),
    amountIncVatMinor: bigint("amount_inc_vat_minor", { mode: "bigint" }).notNull(),
    currency: text("currency").notNull().default("ISK"),
    bearerType: bearerTypeEnum("bearer_type").notNull(),
    bearerRef: uuid("bearer_ref"),
    recipientOrgId: uuid("recipient_org_id"),
    recipientUserId: uuid("recipient_user_id"),
    rateRefId: uuid("rate_ref_id"),
    ruleId: uuid("rule_id"),
    computationDetail: jsonb("computation_detail").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    index().on(t.agreementId, t.billableEventType),
    index().on(t.sessionId, t.factorCode, t.kind),
    index().on(t.recipientOrgId, t.createdAt),
  ],
);

// ─────────────────────────────────────────────────────────────────────────────
// CORE BILLING — the persistence layer for packages/commercial/src/core-billing
// ─────────────────────────────────────────────────────────────────────────────
//
// A FOURTH generation, and the reason it is not a fifth mistake: the eleven
// tables below are the exact durable shape the eleven PURE modules in
// core-billing already compute. Nothing here invents a concept. Every enum
// value is copied from a union type that already exists and is already tested
// — ReviewReason, ProvenanceState, PeriodState, CloseBlocker,
// StatementLineKind, DeliveryState, CorrectionReason. If a value here is not
// in the corresponding TypeScript union, that is a bug in this file.
//
// Three properties are load-bearing and are enforced by KEYS, not by handler
// code, because handler code is what was missing every previous time:
//
//   1. RATE LOCK-IN. settlement_components stores the unit price and the
//      effective window per component, denormalised. Editing a rate row later
//      cannot restate a settled session, because the price is not read back
//      through a foreign key — it is a copy. This is the property
//      resolve-tariff-chain.ts cannot have: it reads Site.dsoTariffId at STOP
//      and has no timestamp parameter at all.
//
//   2. NO DOUBLE-BILLING. session_settlements is keyed on session_id ALONE,
//      and statements on (period_id, recipient_kind, recipient_id). A retried
//      commit collides instead of inserting. Contrast persist.ts:359-401,
//      which counts-then-inserts against a table with no unique constraint and
//      double-bills under two concurrent ticks.
//
//   3. NO SILENT ZERO. A session that cannot be settled gets a row in
//      settlement_holds naming a ReviewReason, and is listed by id on the
//      statement it was excluded from. Excluding a session and pricing it at
//      zero look identical on a bill; they must not look identical here.
//
// Money is bigint aurar (1/100 ISK) everywhere, matching agreements.billing_lines
// and reports.session_ledger. The one exception is the *_isk columns, which
// hold the BILLED whole-króna figure — the sum of rounded lines, not the
// rounding of a sum. money.ts:sumRoundedLinesIsk is the authority on why those
// two differ by up to n/2 aurar and why the customer-facing number is the
// former.

export const periodStateEnum = billingSchema.enum("PeriodState", ["open", "closing", "closed"]);
export const settlementStatusEnum = billingSchema.enum("SettlementStatus", ["settled", "billing_review_required"]);
export const settlementProvenanceEnum = billingSchema.enum("SettlementProvenance", ["ocpp", "cdr", "manual", "unknown"]);
export const provenanceStateEnum = billingSchema.enum("ProvenanceState", ["estimated", "ocpp_derived", "cdr_pending", "cdr_confirmed", "cdr_mismatch", "corrected", "held_manual_review"]);
export const reviewReasonEnum = billingSchema.enum("ReviewReason", ["no_rate_at_session_start", "meter_unresolvable", "cdr_mismatch_beyond_tolerance", "negative_or_impossible_energy", "missing_session_times", "unsupported_compute_rule", "manual_hold"]);
export const rateComponentKindEnum = billingSchema.enum("RateComponentKind", ["dso", "retailer", "cpo_addon"]);
export const statementRecipientKindEnum = billingSchema.enum("StatementRecipientKind", ["driver", "organisation"]);
export const statementLineKindEnum = billingSchema.enum("StatementLineKind", ["session_energy", "plug_time", "subscription_connector", "subscription_driver", "cap_relief", "correction"]);
export const deliveryChannelEnum = billingSchema.enum("DeliveryChannel", ["email", "download", "webhook"]);
export const deliveryStateEnum = billingSchema.enum("DeliveryState", ["pending", "sending", "sent", "retrying", "failed", "abandoned"]);
export const correctionReasonEnum = billingSchema.enum("CorrectionReason", ["cdr_mismatch_resolved", "meter_fault", "tariff_misapplied", "duplicate_session", "customer_dispute", "operator_goodwill"]);

/**
 * billing.billing_periods — one row per org per calendar month.
 *
 * Core bills whole calendar months (Iceland-only framing, ADR-locked), so the
 * natural key is (org_id, period_year, period_month) and there is no free date
 * range. `state` is period-close.ts's PeriodState verbatim.
 *
 * `blockers_at_close` records WHAT was outstanding at the moment the operator
 * closed, not merely how many. A period closed over three held sessions is a
 * different fact from one closed clean, and six months later nobody will
 * remember which it was.
 */
export const billingPeriods = billingSchema.table(
  "billing_periods",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    orgId: uuid("org_id").notNull(),
    periodYear: integer("period_year").notNull(),
    periodMonth: integer("period_month").notNull(),
    periodStart: timestamp("period_start", { withTimezone: true, precision: 6, mode: "date" }).notNull(),
    periodEnd: timestamp("period_end", { withTimezone: true, precision: 6, mode: "date" }).notNull(),
    state: periodStateEnum("state").notNull().default("open"),
    currency: text("currency").notNull().default("ISK"),
    closedAt: timestamp("closed_at", { withTimezone: true, precision: 6, mode: "date" }),
    closedByUserId: uuid("closed_by_user_id"),
    /** CloseBlocker[] present at close, empty array when closed clean. */
    blockersAtClose: jsonb("blockers_at_close"),
    reopenedAt: timestamp("reopened_at", { withTimezone: true, precision: 6, mode: "date" }),
    reopenedByUserId: uuid("reopened_by_user_id"),
    reopenReason: text("reopen_reason"),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().$defaultFn(() => new Date()).$onUpdateFn(() => new Date()),
  },
  (t) => [
    uniqueIndex().on(t.orgId, t.periodYear, t.periodMonth),
    index().on(t.orgId, t.state),
  ],
);

/**
 * billing.session_settlements — the priced snapshot, one per session.
 *
 * PRIMARY KEY IS session_id, deliberately, and it is the whole idempotency
 * story: a session can be settled once. reports.session_ledger already proves
 * the pattern works (session_id @id, three separate writers all upsert safely).
 *
 * A settled session in a CLOSED period is immutable. Corrections do not edit
 * this row — they land as a `correction` statement line in a LATER period,
 * which is what period-close.ts's CorrectionReason exists for. That is the
 * accounting answer, and it is also the only answer that survives an auditor
 * asking what the customer was told in July.
 */
export const sessionSettlements = billingSchema.table(
  "session_settlements",
  {
    sessionId: uuid("session_id").primaryKey(),
    orgId: uuid("org_id").notNull(),
    periodId: uuid("period_id").notNull(),
    connectorId: uuid("connector_id"),
    /** Null for an unattributed session: it still settles, it just has nobody to bill. */
    driverUserId: uuid("driver_user_id"),

    /** The instant rate lock-in resolves against. NOT NULL: a session with no
     *  start time is `missing_session_times`, held, never guessed. */
    startedAt: timestamp("started_at", { withTimezone: true, precision: 6, mode: "date" }).notNull(),
    stoppedAt: timestamp("stopped_at", { withTimezone: true, precision: 6, mode: "date" }),

    energyWh: integer("energy_wh"),
    meterStartWh: integer("meter_start_wh"),
    meterStopWh: integer("meter_stop_wh"),
    cdrEnergyKwh: numeric("cdr_energy_kwh", { precision: 10, scale: 3 }),

    plugTimeSeconds: integer("plug_time_seconds"),
    // No DB default, matching every other money column in this file. A bigint
    // default is not merely unidiomatic here — drizzle-kit cannot serialise
    // one into the snapshot and dies with "Do not know how to serialize a
    // BigInt". More usefully: a session with no plug-time fee should say 0n
    // because the caller decided so, not because the database filled it in.
    plugTimeFeeMinor: bigint("plug_time_fee_minor", { mode: "bigint" }).notNull(),

    amountExVatMinor: bigint("amount_ex_vat_minor", { mode: "bigint" }).notNull(),
    vatRatePct: numeric("vat_rate_pct", { precision: 4, scale: 2 }).notNull(),
    vatMinor: bigint("vat_minor", { mode: "bigint" }).notNull(),
    totalIncVatMinor: bigint("total_inc_vat_minor", { mode: "bigint" }).notNull(),
    /** The BILLED figure: whole ISK, half-up. Stored because it is what the
     *  customer was shown, and recomputing it later would silently adopt
     *  whatever rounding rule is current then. */
    totalIsk: bigint("total_isk", { mode: "bigint" }).notNull(),
    currency: text("currency").notNull().default("ISK"),

    status: settlementStatusEnum("status").notNull(),
    provenance: settlementProvenanceEnum("provenance").notNull(),
    provenanceState: provenanceStateEnum("provenance_state").notNull(),
    rateSelectionPolicy: text("rate_selection_policy").notNull().default("start_rate"),

    pricedAt: timestamp("priced_at", { withTimezone: true, precision: 6, mode: "date" }).notNull(),
    committedAt: timestamp("committed_at", { withTimezone: true, precision: 6, mode: "date" }),
    /** Human-readable reason string from the snapshot, kept verbatim so support
     *  quotes the same sentence the operator saw. */
    explanation: text("explanation").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().$defaultFn(() => new Date()).$onUpdateFn(() => new Date()),
  },
  (t) => [
    index().on(t.orgId, t.periodId),
    index().on(t.periodId, t.status),
    index().on(t.orgId, t.driverUserId, t.startedAt),
    index().on(t.orgId, t.connectorId, t.startedAt),
  ],
);

/**
 * billing.settlement_components — the price breakdown, one row per rate
 * component (dso / retailer / cpo_addon).
 *
 * THIS TABLE IS RATE LOCK-IN. `unit_price_minor`, `effective_from` and
 * `effective_until` are COPIES, not joins. `rate_version_id` records which row
 * supplied them so the figure is traceable, but nothing reads the price back
 * through it. Editing agreements.rate_references after the fact therefore
 * cannot restate a settled session — which is exactly what happens today,
 * where reports.session_ledger stores one mutable tariff_definition_id and the
 * compute_rule JSONB behind it is edited in place.
 */
export const settlementComponents = billingSchema.table(
  "settlement_components",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    sessionId: uuid("session_id").notNull(),
    orgId: uuid("org_id").notNull(),
    kind: rateComponentKindEnum("kind").notNull(),
    /** Which rate row priced this. For tracing only — never read back for price. */
    rateVersionId: uuid("rate_version_id").notNull(),
    /** ex-VAT aurar per kWh, copied at settlement time. */
    unitPriceMinor: bigint("unit_price_minor", { mode: "bigint" }).notNull(),
    effectiveFrom: timestamp("effective_from", { withTimezone: true, precision: 6, mode: "date" }).notNull(),
    effectiveUntil: timestamp("effective_until", { withTimezone: true, precision: 6, mode: "date" }),
    amountExVatMinor: bigint("amount_ex_vat_minor", { mode: "bigint" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    // One component of each kind per session. A retried commit collides.
    uniqueIndex().on(t.sessionId, t.kind),
    index().on(t.orgId, t.rateVersionId),
  ],
);

/**
 * billing.settlement_holds — why a session is not billable, and who cleared it.
 *
 * One row per (session, reason): a session can be held for more than one
 * reason at once and an operator must clear each. `resolution_note` is NOT
 * NULL once resolved because "resolved" with no reason is indistinguishable
 * from a mis-click, and this is the table an auditor reads when a customer
 * disputes a charge.
 */
export const settlementHolds = billingSchema.table(
  "settlement_holds",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    sessionId: uuid("session_id").notNull(),
    orgId: uuid("org_id").notNull(),
    reason: reviewReasonEnum("reason").notNull(),
    detail: text("detail"),
    raisedAt: timestamp("raised_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true, precision: 6, mode: "date" }),
    resolvedByUserId: uuid("resolved_by_user_id"),
    /** accept_cdr | accept_meter | write_off | correct_next_period */
    resolution: text("resolution"),
    resolutionNote: text("resolution_note"),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex().on(t.sessionId, t.reason),
    index().on(t.orgId, t.resolvedAt),
  ],
);

/**
 * billing.statements — one document per recipient per period.
 *
 * The unique key is (period_id, recipient_kind, recipient_id): a driver has
 * exactly one statement for July. `statement_key` carries statement.ts's
 * deterministic FNV-1a identity, so a regenerate that produces different
 * content is DETECTABLE rather than silently overwriting — that is the
 * `already_generated_with_different_content` refusal the pure module already
 * returns and nothing could previously act on.
 *
 * `excluded_session_ids` is on the header, not inferred: a session left off a
 * bill must be nameable, and only sessions of THIS org may appear there.
 */
export const statements = billingSchema.table(
  "statements",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    orgId: uuid("org_id").notNull(),
    periodId: uuid("period_id").notNull(),
    recipientKind: statementRecipientKindEnum("recipient_kind").notNull(),
    recipientId: uuid("recipient_id").notNull(),
    /** statementIdentity() — deterministic over (period, recipient, sessionIds). */
    statementKey: text("statement_key").notNull(),
    /** Sum of the ROUNDED line amounts. Not the rounding of the sum. */
    totalIsk: bigint("total_isk", { mode: "bigint" }).notNull(),
    currency: text("currency").notNull().default("ISK"),
    excludedSessionIds: jsonb("excluded_session_ids").notNull(),
    generatedAt: timestamp("generated_at", { withTimezone: true, precision: 6, mode: "date" }).notNull(),
    generatedByUserId: uuid("generated_by_user_id"),
    supersededByStatementId: uuid("superseded_by_statement_id"),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().$defaultFn(() => new Date()).$onUpdateFn(() => new Date()),
  },
  (t) => [
    uniqueIndex().on(t.periodId, t.recipientKind, t.recipientId),
    index().on(t.orgId, t.periodId),
    index().on(t.orgId, t.recipientKind, t.recipientId),
  ],
);

/**
 * billing.statement_lines — what the recipient is actually shown.
 *
 * `amount_minor` is the unrounded aurar figure kept for audit; `amount_isk` is
 * the billed whole-króna figure, and the header total is the SUM OF THESE, not
 * a rounding of the aurar sum. On the canonical three-line fixture those two
 * differ (889 vs 888) and the customer-facing answer is 889.
 *
 * `line_no` is part of the unique key so a regenerate cannot interleave old
 * and new lines, and so the document has a stable printed order.
 */
export const statementLines = billingSchema.table(
  "statement_lines",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    statementId: uuid("statement_id").notNull(),
    orgId: uuid("org_id").notNull(),
    lineNo: integer("line_no").notNull(),
    kind: statementLineKindEnum("kind").notNull(),
    description: text("description").notNull(),
    quantity: numeric("quantity", { precision: 14, scale: 4 }),
    unit: text("unit"),
    unitPriceMinor: bigint("unit_price_minor", { mode: "bigint" }),
    /** Unrounded aurar — audit trail. */
    amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
    /** Billed whole ISK, half-up. These sum to statements.total_isk. */
    amountIsk: bigint("amount_isk", { mode: "bigint" }).notNull(),
    sessionId: uuid("session_id"),
    correctsSessionId: uuid("corrects_session_id"),
    correctionReason: correctionReasonEnum("correction_reason"),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex().on(t.statementId, t.lineNo),
    index().on(t.orgId, t.sessionId),
  ],
);

/**
 * billing.statement_delivery_attempts — the provider-proof chain email has
 * never had.
 *
 * Modelled on ocpp.outbound_commands, which already does this correctly in
 * this codebase: status, attempts, not_before, last_attempt_at, result JSONB,
 * and a claim performed as a single atomic conditional UPDATE.
 *
 * `provider_message_id` is the point of the table. Today sendEmail returns
 * { ok, id } and all eight call sites drop it, and because email.ts fails OPEN
 * when RESEND_API_KEY is absent, a statement "delivered" with no provider
 * configured is indistinguishable from one that reached the customer. The
 * `not_configured` DeliveryState exists so those two stop looking alike.
 *
 * (`not_configured` is a SendOutcomeKind rather than a DeliveryState in
 * delivery-log.ts; it is recorded here in `outcome_kind`, and the attempt's
 * own state is `failed`. Keeping both columns is what lets "we never tried"
 * be distinguished from "we tried and it bounced".)
 */
export const statementDeliveryAttempts = billingSchema.table(
  "statement_delivery_attempts",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    statementId: uuid("statement_id").notNull(),
    orgId: uuid("org_id").notNull(),
    channel: deliveryChannelEnum("channel").notNull().default("email"),
    state: deliveryStateEnum("state").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    notBefore: timestamp("not_before", { withTimezone: true, precision: 6, mode: "date" }),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true, precision: 6, mode: "date" }),
    /** ack | retriable | permanent | not_configured — SendOutcomeKind. */
    outcomeKind: text("outcome_kind"),
    /** The Resend message id, or the webhook's ack. The proof. */
    providerMessageId: text("provider_message_id"),
    /** Address at time of send. Recipients change; the record must not. */
    destination: text("destination"),
    lastError: text("last_error"),
    result: jsonb("result"),
    /** Client-supplied, so a retried send is recognisably the same request. */
    idempotencyKey: text("idempotency_key").notNull(),
    requestedByUserId: uuid("requested_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().$defaultFn(() => new Date()).$onUpdateFn(() => new Date()),
  },
  (t) => [
    uniqueIndex().on(t.statementId, t.idempotencyKey),
    index().on(t.orgId, t.state),
    index().on(t.state, t.notBefore),
  ],
);

/**
 * billing.statement_exports — an operator asked for a file; this is what they got.
 *
 * There is no file export anywhere in the tree today (zero hits for text/csv,
 * Content-Disposition or attachment; across apps/api/src and src), so this
 * table has no legacy to reconcile with. `content_hash` makes "the number in
 * the export differs from the number on screen" a checkable claim rather than
 * an argument.
 */
export const statementExports = billingSchema.table(
  "statement_exports",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    orgId: uuid("org_id").notNull(),
    periodId: uuid("period_id").notNull(),
    format: text("format").notNull().default("csv"),
    rowCount: integer("row_count").notNull(),
    /** Sum across the exported statements — must equal what the UI showed. */
    totalIsk: bigint("total_isk", { mode: "bigint" }).notNull(),
    contentHash: text("content_hash").notNull(),
    /** R2 object key, null while the export is generated inline. */
    storageKey: text("storage_key"),
    idempotencyKey: text("idempotency_key").notNull(),
    requestedByUserId: uuid("requested_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex().on(t.orgId, t.idempotencyKey),
    index().on(t.orgId, t.periodId),
  ],
);

/**
 * billing.mutation_receipts — idempotency for money mutations.
 *
 * WHY NOT events.idempotency_keys, which already exists: it has no org_id, so
 * a purge or an audit cannot be tenant-scoped; its `scope` is the hardcoded
 * literal "ocpp" in both of its writers, so adopting it means editing the OCPP
 * ingest hot path; and its TTL is written on every insert and read by nobody
 * (neither reader compares expires_at to now()), so an expired row suppresses
 * a replay permanently. Financial receipts need a different retention story
 * from protocol dedupe, and sharing the table would inherit that bug.
 *
 * `expires_at` here is meant to be ENFORCED in the WHERE clause, not merely
 * written. `request_hash` catches the dangerous case the key alone cannot: the
 * same Idempotency-Key sent with a DIFFERENT body, which must be rejected as a
 * conflict rather than served the first response.
 */
export const mutationReceipts = billingSchema.table(
  "mutation_receipts",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    orgId: uuid("org_id").notNull(),
    /** Route-specific: "period.close" | "statement.deliver" | "statement.export" | "hold.resolve" | "rate.write" */
    scope: text("scope").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    requestHash: text("request_hash").notNull(),
    responseStatus: integer("response_status").notNull(),
    responseBody: jsonb("response_body"),
    actorUserId: uuid("actor_user_id"),
    expiresAt: timestamp("expires_at", { withTimezone: true, precision: 6, mode: "date" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex().on(t.orgId, t.scope, t.idempotencyKey),
    index().on(t.expiresAt),
  ],
);

/**
 * reports.driver_activity_month — "was this driver active in month M", settled.
 *
 * Core charges 50 kr per active driver per month, so this figure IS revenue.
 * It cannot be derived after the fact today: subscription.ts counts a driver
 * active on "charging or reporting activity", charging.sessions.user_id is
 * nullable, "reporting activity" has no persisted event of any kind, and
 * agreements.driver_group_memberships has added_at only — with a unique on
 * (group, user) that forbids the second row history would need, so removal is
 * a hard delete leaving nothing behind.
 *
 * This table is written once per month and never recomputed, which is the only
 * way the number stays defensible. `source` records WHY the driver counted, so
 * a disputed 50 kr has an answer.
 */
export const driverActivityMonth = reportsSchema.table(
  "driver_activity_month",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    orgId: uuid("org_id").notNull(),
    periodYear: integer("period_year").notNull(),
    periodMonth: integer("period_month").notNull(),
    driverUserId: uuid("driver_user_id").notNull(),
    /** charging_session | reporting_access | roster_membership */
    source: text("source").notNull(),
    sessionCount: integer("session_count").notNull().default(0),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true, precision: 6, mode: "date" }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true, precision: 6, mode: "date" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex().on(t.orgId, t.periodYear, t.periodMonth, t.driverUserId),
    index().on(t.orgId, t.periodYear, t.periodMonth),
  ],
);

/**
 * reports.connector_activity_month — "was this connector active in month M".
 *
 * 200 kr per active connector per month, capped at 450 kr per connector, so
 * this is the other half of the subscription revenue and it has the same
 * problem for a different reason: assets.connectors carries a MUTABLE
 * `status` plus status_updated_at and no history, and assets.charging_stations
 * has no status, active or removed column at all. A charger removed in August
 * leaves no evidence it was billable in July.
 *
 * `cap_applied_isk` is stored rather than recomputed because the cap depends
 * on the driver count for the same month, and recomputing later would use
 * whatever roster is current then.
 */
export const connectorActivityMonth = reportsSchema.table(
  "connector_activity_month",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    orgId: uuid("org_id").notNull(),
    periodYear: integer("period_year").notNull(),
    periodMonth: integer("period_month").notNull(),
    connectorId: uuid("connector_id").notNull(),
    chargingStationId: uuid("charging_station_id"),
    /** session_observed | status_available | manually_asserted */
    source: text("source").notNull(),
    sessionCount: integer("session_count").notNull().default(0),
    activeDays: integer("active_days"),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true, precision: 6, mode: "date" }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true, precision: 6, mode: "date" }).notNull(),
    /** Whole ISK actually charged for this connector-month, after the 450 cap. */
    capAppliedIsk: bigint("cap_applied_isk", { mode: "bigint" }),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex().on(t.orgId, t.periodYear, t.periodMonth, t.connectorId),
    index().on(t.orgId, t.periodYear, t.periodMonth),
  ],
);


/**
 * billing.period_transitions — the append-only lifecycle log.
 *
 * PREFLIGHT DELTA 9.8. `billing_periods` records a period's CURRENT coarse
 * state (open | closing | closed) and nothing records how it got there, so
 * "has the activity aggregation run for this month?" was a boolean a caller
 * had to hand in — and `false` was the only honest default, which means every
 * period holds.
 *
 * This table is the answer. Each row is one applied transition, with the actor
 * who caused it, so the fine-grained state
 * (packages/commercial/.../period-lifecycle.ts) is DERIVED from evidence
 * rather than asserted by a parameter.
 *
 * The Postgres enum was deliberately not widened: `ALTER TYPE ... ADD VALUE`
 * cannot run inside a transaction block and cannot be undone, so the fine
 * states live here as text and `coarseStateOf` keeps `billing_periods.state`
 * meaningful to every reader that already understands it.
 *
 * UNIQUE (org_id, period_year, period_month, event) is the idempotency
 * mechanism: no event occurs twice in one period's life, so a retried
 * month-end job collides instead of double-recording.
 */
export const periodTransitions = billingSchema.table(
  "period_transitions",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    orgId: uuid("org_id").notNull(),
    periodYear: integer("period_year").notNull(),
    periodMonth: integer("period_month").notNull(),
    /** PeriodLifecycleState. Text, not an enum — see the note above. */
    fromState: text("from_state").notNull(),
    toState: text("to_state").notNull(),
    /** PeriodEvent that caused it. */
    event: text("event").notNull(),
    /** Never null. A transition nobody caused is a transition nobody can answer for. */
    actorUserId: uuid("actor_user_id").notNull(),
    reason: text("reason"),
    occurredAt: timestamp("occurred_at", { withTimezone: true, precision: 6, mode: "date" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex().on(t.orgId, t.periodYear, t.periodMonth, t.event),
    index().on(t.orgId, t.periodYear, t.periodMonth, t.occurredAt),
  ],
);

/**
 * billing.connector_assertions — a human vouching for a connector.
 *
 * PREFLIGHT DELTA 9.7. A connector is counted as active on machine evidence:
 * a session on it, or a StatusNotification from it, inside the period. Some
 * real connectors produce NEITHER — permanently, not occasionally. Every
 * connector on a vendor-native (Zaptec-authentication) installation is in that
 * position by construction: the Zaptec importer writes `connector_id: null` on
 * every session it creates, and StatusNotification only ever reaches
 * `events.event_log` from our own OCPP gateway, which such a charger does not
 * talk to.
 *
 * Without this table those connectors produce no activity row, the period
 * holds, and a host is not billed for hardware that is installed and theirs.
 *
 * An assertion is a person claiming a connector was active WITH NO MACHINE
 * EVIDENCE, so it carries who, when and why, and it is surfaced on the
 * invoice's provenance block beside the derived counts — never silently mixed
 * into them.
 *
 * UNIQUE (org_id, period_year, period_month, connector_id) so a duplicate
 * assertion collides rather than double-counting a connector.
 */
export const connectorAssertions = billingSchema.table(
  "connector_assertions",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    orgId: uuid("org_id").notNull(),
    periodYear: integer("period_year").notNull(),
    periodMonth: integer("period_month").notNull(),
    connectorId: uuid("connector_id").notNull(),
    /** Never null. An unattributed assertion is an unauditable one. */
    assertedByUserId: uuid("asserted_by_user_id").notNull(),
    /** Why the operator believes it was installed. Required, free text. */
    reason: text("reason").notNull(),
    /** Optional pointer at out-of-band proof — a work order, a photo, a ticket. */
    evidenceNote: text("evidence_note"),
    assertedAt: timestamp("asserted_at", { withTimezone: true, precision: 6, mode: "date" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex().on(t.orgId, t.periodYear, t.periodMonth, t.connectorId),
    index().on(t.orgId, t.periodYear, t.periodMonth),
  ],
);

/**
 * billing.document_number_series — the counter behind an invoice number.
 *
 * ROUND 3 LEFT THIS AS THE LAST ENGINEERING BLOCKER. `SV-2026-000001` was
 * issued from a dry run and nothing persisted the sequence, so a second
 * operator, a retry, or a second process would allocate the same number.
 *
 * ── WHY A COUNTER ROW AND NOT A POSTGRES SEQUENCE ───────────────────────
 *
 * Icelandic law requires sales invoices "fyrirfram tölusett með áprentuð númer
 * í samfelldri töluröð" — pre-numbered, in an UNBROKEN sequence. That is two
 * requirements at once: **unique** and **gap-free**.
 *
 * A `SEQUENCE` gives unique and NOT gap-free: `nextval` is non-transactional
 * by design, so a rolled-back transaction burns the value permanently and the
 * sequence is full of holes. That is the correct trade for surrogate keys and
 * the wrong one for a legal document number.
 *
 * A counter row incremented inside the issuing transaction gives BOTH: the
 * increment rolls back with everything else, so a failed issue consumes
 * nothing. The cost is real and is stated rather than hidden — allocation
 * SERIALISES per (org, series, year), because concurrent issuers contend on
 * one row. At one invoice per org per month that contention is nil, and
 * correctness is not tradeable here.
 *
 * One row per (org, series, year). Per-org because each host's sequence is its
 * own; per-year because `SV-2026-000001` restarts at 1 each January, which is
 * standard Icelandic practice and keeps each year's series unbroken.
 */
export const documentNumberSeries = billingSchema.table(
  "document_number_series",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    orgId: uuid("org_id").notNull(),
    /** Human-facing prefix, e.g. "SV". */
    series: text("series").notNull(),
    periodYear: integer("period_year").notNull(),
    /** The next unissued ordinal. Incremented in the issuing transaction. */
    nextOrdinal: integer("next_ordinal").notNull().default(1),
    /** Zero-padding width for the numeric part. */
    padWidth: integer("pad_width").notNull().default(6),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().$defaultFn(() => new Date()).$onUpdateFn(() => new Date()),
  },
  (t) => [uniqueIndex().on(t.orgId, t.series, t.periodYear)],
);

/**
 * billing.document_numbers — every number ever spent, and what it was spent on.
 *
 * The counter alone cannot answer "is the sequence unbroken?" — only a record
 * of what each ordinal became can. This table is that record, and it is what
 * makes a VOID expressible: there is deliberately no release operation,
 * because a released number leaves a hole the documents around it have already
 * closed over. A number spent without producing a live document is recorded
 * `voided`, in place, and the sequence still accounts for every ordinal.
 *
 * Three uniques, each preventing a different failure:
 *
 *   (org, series, year, ordinal)          two documents cannot share a number
 *   (org, series, year, idempotency_key)  a RETRY gets the same number back
 *                                         rather than consuming another
 *   (statement_id, purpose)               a second issue for one statement is
 *                                         refused at write time, so a caller
 *                                         who retries under a DIFFERENT key
 *                                         collides here instead of quietly
 *                                         spending a second number
 *
 * `purpose` exists because the accountant's constraint is unanswered and a
 * credit note and a correction each need a number from a STATED series. It is
 * text rather than an enum so that answer can widen the vocabulary without an
 * ALTER TYPE, which cannot run in a transaction and cannot be undone.
 */
export const documentNumbers = billingSchema.table(
  "document_numbers",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    orgId: uuid("org_id").notNull(),
    series: text("series").notNull(),
    periodYear: integer("period_year").notNull(),
    ordinal: integer("ordinal").notNull(),
    /** The rendered number, e.g. "SV-2026-000001". Stored, not recomputed. */
    documentNumber: text("document_number").notNull(),
    /** invoice | credit_note | correction. See the note above on why text. */
    purpose: text("purpose").notNull(),
    /** issued | voided. Never deleted. */
    status: text("status").notNull().default("issued"),
    /** What the number was spent on. Null only on a number voided before use. */
    statementId: uuid("statement_id"),
    /** The caller's key. Never generated — a generated key makes every retry a
     *  fresh allocation, which is the defect the mechanism exists to prevent. */
    idempotencyKey: text("idempotency_key").notNull(),
    issuedByUserId: uuid("issued_by_user_id"),
    issuedAt: timestamp("issued_at", { withTimezone: true, precision: 6, mode: "date" }).notNull(),
    voidedAt: timestamp("voided_at", { withTimezone: true, precision: 6, mode: "date" }),
    voidReason: text("void_reason"),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex().on(t.orgId, t.series, t.periodYear, t.ordinal),
    uniqueIndex().on(t.orgId, t.series, t.periodYear, t.idempotencyKey),
    uniqueIndex().on(t.statementId, t.purpose),
    index().on(t.orgId, t.issuedAt),
  ],
);
