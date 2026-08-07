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

import { bigint, boolean, date, index, integer, jsonb, numeric, pgSchema, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

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
export const rateBasisEnum = agreementsSchema.enum("RateBasis", ["per_kwh", "per_minute", "per_day", "per_session"]);
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
    createdAt: timestamp("created_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().$defaultFn(() => new Date()).$onUpdateFn(() => new Date()),
  },
  (t) => [
    uniqueIndex().on(t.agreementId, t.costFactorId),
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
  },
  (t) => [
    uniqueIndex().on(t.driverGroupId, t.userId),
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

