// identity — Drizzle table declarations.
//
// The 15 tables of the identity domain across three Postgres schemas:
// identity (8), tenancy (4), people (3). Additive — Prisma still owns these
// tables and still generates a client for them. Nothing here replaces
// anything yet.
//
// First drafted by scripts/drizzle-scaffold-from-prisma.mjs from
// prisma/schema/identity.prisma, then owned by hand. It is not regenerated
// and `npm run check` does not rewrite it; re-running the scaffolder over
// this file would discard the edits below. drizzle-kit introspection cannot
// help — it does not support Postgres schema names, and this database has
// twenty of them.
//
// A declaration like this is a CLAIM about the database. It typechecks
// whether or not it is true, so it is verified two ways instead:
//
//   test/parity/identity-schema.test.ts   every column, type and nullability
//                                         against information_schema
//   test/parity/identity-repositories     Prisma and Drizzle run the same
//                                         query and must agree
//
// Both need a live database and are skipped without PARITY_DATABASE_URL.
//
// NOT DECLARED HERE, deliberately:
//   • Foreign keys and relations. Drizzle needs them only for `db.query`
//     relational reads; every ported repository uses explicit joins, and a
//     wrong FK declaration would be a silent lie about cascade behaviour.
//
// WHERE VALUES COME FROM — this is not uniform and the trap is quiet:
//   • `id` is generated CLIENT-side. Prisma's `@default(uuid())` emits no
//     database default, so identity.users.id and tenancy.organizations.id
//     have none at all. Leave it to the database and half these tables
//     reject every insert on a NOT NULL. `$defaultFn(crypto.randomUUID)`.
//   • `created_at` is DATABASE-side. Prisma's `@default(now())` does emit
//     CURRENT_TIMESTAMP, so the database clock keeps it — the better one.
//   • `updated_at` is CLIENT-side on every write including the insert.
//     There is no default and no ON UPDATE trigger; Prisma's `@updatedAt`
//     was doing all of it.

import { customType, date, index, integer, jsonb, numeric, pgSchema, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

// citext has no first-class Drizzle type. It behaves as text in TypeScript;
// the case-insensitive comparison is the database's job either way.
const citext = customType<{ data: string }>({ dataType: () => "citext" });

export const identitySchema = pgSchema("identity");
export const peopleSchema = pgSchema("people");
export const tenancySchema = pgSchema("tenancy");

export const userStatusEnum = identitySchema.enum("UserStatus", ["active", "suspended", "deleted"]);
export const userAudienceEnum = identitySchema.enum("UserAudience", ["operator", "driver", "service"]);
export const vendorRefStatusEnum = identitySchema.enum("VendorRefStatus", ["active", "inactive_at_vendor", "removed_at_vendor"]);
export const idTokenKindEnum = identitySchema.enum("IdTokenKind", ["rfid", "app_jwt", "magic_link", "zaptec_proxy", "ocpi_token", "manual", "evccid", "virtual_rfid"]);
export const idTokenStatusEnum = identitySchema.enum("IdTokenStatus", ["active", "suspended", "revoked", "expired"]);
export const userTokenKindEnum = identitySchema.enum("UserTokenKind", ["invite", "magic_link", "password_reset", "driver"]);
export const driverInviteSecurityEnum = identitySchema.enum("DriverInviteSecurity", ["none", "password_key", "allow_term"]);
export const orgStatusEnum = tenancySchema.enum("OrgStatus", ["active", "suspended", "archived"]);
export const organizationKindEnum = tenancySchema.enum("OrganizationKind", ["multi_dwelling", "company"]);
export const hostApplicationStatusEnum = tenancySchema.enum("HostApplicationStatus", ["new", "in_review", "offered", "won", "lost"]);
export const membershipRoleEnum = tenancySchema.enum("MembershipRole", ["owner", "admin", "operator", "helper", "contractor", "driver", "viewer", "manager", "technician", "finance", "support", "host_admin"]);
export const membershipStatusEnum = tenancySchema.enum("MembershipStatus", ["invited", "active", "suspended", "revoked"]);
export const orgEmailDomainPolicyEnum = tenancySchema.enum("OrgEmailDomainPolicy", ["auto_join", "request_approval", "disabled"]);
export const memberKindEnum = peopleSchema.enum("MemberKind", ["primary", "family_user"]);
export const organizationRoleEnum = tenancySchema.enum("OrganizationRole", ["cpo", "emsp", "hub", "nsp", "site_host", "service_contractor", "installer", "vendor", "regulator", "dso", "tso", "retailer", "payment_processor"]);
export const platformRoleEnum = identitySchema.enum("PlatformRole", ["super_user", "platform_admin", "support_agent", "sales_cs", "finance_internal", "auditor"]);
export const platformGrantStatusEnum = identitySchema.enum("PlatformGrantStatus", ["active", "suspended", "revoked"]);

/** Prisma model `User` — identity.users */
export const users = identitySchema.table(
  "users",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    email: citext("email").notNull(),
    displayName: text("display_name"),
    status: userStatusEnum("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().$defaultFn(() => new Date()).$onUpdateFn(() => new Date()),
    deletedAt: timestamp("deleted_at", { withTimezone: true, precision: 6, mode: "date" }),
    kennitala: text("kennitala"),
    phone: text("phone"),
    locale: text("locale").notNull().default("is"),
    timezone: text("timezone").notNull().default("Atlantic/Reykjavik"),
    notes: text("notes"),
    firstName: text("first_name"),
    middleName: text("middle_name"),
    lastName: text("last_name"),
    dateOfBirth: date("date_of_birth", { mode: "date" }),
    photoUrl: text("photo_url"),
    address: jsonb("address").notNull().default({}),
    audience: userAudienceEnum("audience").notNull().default("operator"),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true, precision: 6, mode: "date" }),
    phoneVerifiedAt: timestamp("phone_verified_at", { withTimezone: true, precision: 6, mode: "date" }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true, precision: 6, mode: "date" }),
    consentTosAt: timestamp("consent_tos_at", { withTimezone: true, precision: 6, mode: "date" }),
    consentPrivacyAt: timestamp("consent_privacy_at", { withTimezone: true, precision: 6, mode: "date" }),
    consentMarketingAt: timestamp("consent_marketing_at", { withTimezone: true, precision: 6, mode: "date" }),
    metadata: jsonb("metadata").notNull().default({}),
  },
);

/** Prisma model `UserVendorRef` — identity.user_vendor_refs */
export const userVendorRefs = identitySchema.table(
  "user_vendor_refs",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    userId: uuid("user_id").notNull(),
    vendorSlug: text("vendor_slug").notNull(),
    vendorUserId: text("vendor_user_id").notNull(),
    vendorEmail: text("vendor_email"),
    vendorRoleHint: text("vendor_role_hint"),
    scopeInstallationId: uuid("scope_installation_id"),
    status: vendorRefStatusEnum("status").notNull().default("active"),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().defaultNow(),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().$defaultFn(() => new Date()).$onUpdateFn(() => new Date()),
  },
  (t) => [
    uniqueIndex().on(t.vendorSlug, t.vendorUserId),
    index().on(t.userId),
    index().on(t.scopeInstallationId),
  ],
);

/** Prisma model `IdToken` — identity.id_tokens */
export const idTokens = identitySchema.table(
  "id_tokens",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    userId: uuid("user_id").notNull(),
    kind: idTokenKindEnum("kind").notNull(),
    value: text("value").notNull(),
    vendorIssuedBy: text("vendor_issued_by"),
    vendorTokenId: text("vendor_token_id"),
    label: text("label"),
    status: idTokenStatusEnum("status").notNull().default("active"),
    expiresAt: timestamp("expires_at", { withTimezone: true, precision: 6, mode: "date" }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true, precision: 6, mode: "date" }),
    scopeInstallationId: uuid("scope_installation_id"),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().$defaultFn(() => new Date()).$onUpdateFn(() => new Date()),
  },
  (t) => [
    index().on(t.userId),
    index().on(t.status, t.value),
    index().on(t.scopeInstallationId),
    index().on(t.vendorIssuedBy, t.vendorTokenId),
  ],
);

/** Prisma model `VendorUserGroup` — identity.vendor_user_groups */
export const vendorUserGroups = identitySchema.table(
  "vendor_user_groups",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    vendorSlug: text("vendor_slug").notNull(),
    vendorGroupId: text("vendor_group_id").notNull(),
    installationId: uuid("installation_id").notNull(),
    name: text("name").notNull(),
    metadata: jsonb("metadata").notNull().default({}),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().$defaultFn(() => new Date()).$onUpdateFn(() => new Date()),
  },
  (t) => [
    uniqueIndex().on(t.vendorSlug, t.vendorGroupId),
    index().on(t.installationId),
  ],
);

/** Prisma model `VendorUserGroupMembership` — identity.vendor_user_group_memberships */
export const vendorUserGroupMemberships = identitySchema.table(
  "vendor_user_group_memberships",
  {
    groupId: uuid("group_id").notNull(),
    userId: uuid("user_id").notNull(),
    role: text("role").notNull(),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.groupId, t.userId] }),
    index().on(t.userId),
  ],
);

/** Prisma model `Vehicle` — people.vehicles */
export const vehicles = peopleSchema.table(
  "vehicles",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    userId: uuid("user_id").notNull(),
    make: text("make"),
    model: text("model"),
    year: integer("year"),
    licensePlate: text("license_plate"),
    vin: text("vin"),
    batteryCapacityKwh: numeric("battery_capacity_kwh", { precision: 6, scale: 2 }),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().$defaultFn(() => new Date()).$onUpdateFn(() => new Date()),
  },
  (t) => [
    index().on(t.userId),
  ],
);

/** Prisma model `UserCredential` — identity.user_credentials */
export const userCredentials = identitySchema.table(
  "user_credentials",
  {
    userId: uuid("user_id").primaryKey(),
    passwordHash: text("password_hash"),
    totpSecret: text("totp_secret"),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().defaultNow(),
  },
);

/** Prisma model `UserToken` — identity.user_tokens */
export const userTokens = identitySchema.table(
  "user_tokens",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    userId: uuid("user_id").notNull(),
    kind: userTokenKindEnum("kind").notNull(),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, precision: 6, mode: "date" }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true, precision: 6, mode: "date" }),
    createdById: uuid("created_by_id"),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().defaultNow(),
    driverGroupId: uuid("driver_group_id"),
    billObjectId: uuid("bill_object_id"),
    security: driverInviteSecurityEnum("security").notNull().default("none"),
    passwordKeyHash: text("password_key_hash"),
    maxRedemptions: integer("max_redemptions"),
  },
  (t) => [
    index().on(t.userId, t.kind, t.expiresAt),
  ],
);

/** Prisma model `Organization` — tenancy.organizations */
export const organizations = tenancySchema.table(
  "organizations",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    displayName: text("display_name").notNull(),
    countryCode: text("country_code").notNull(),
    status: orgStatusEnum("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().$defaultFn(() => new Date()).$onUpdateFn(() => new Date()),
    legalName: text("legal_name"),
    legalForm: text("legal_form"),
    legalFormCode: text("legal_form_code"),
    kennitala: text("kennitala"),
    vskNr: text("vsk_nr"),
    leiCode: text("lei_code"),
    defaultCurrency: text("default_currency").notNull().default("ISK"),
    postalAddress: jsonb("postal_address"),
    legalAddress: jsonb("legal_address"),
    municipalityCode: text("municipality_code"),
    municipalityName: text("municipality_name"),
    branding: jsonb("branding").notNull().default({}),
    regulatorLicenceNo: text("regulator_licence_no"),
    // NULLABLE, and Prisma disagrees. Prisma types this `OrganizationRole[]`
    // — a list field is never null in its client — but the column has
    // permitted NULL since the 2026-05-01 org_profile_iceland_reshape
    // migration dropped `roles` and re-added it as `roles_new` without the
    // NOT NULL it previously carried (migration.sql:89). The two `uuid[]`
    // columns on tenancy.memberships kept theirs, so this is a one-off slip
    // rather than how Prisma emits array columns.
    //
    // Harmless today: 0 of 19 organisations on staging have NULL here, and
    // ARRAY[]::"OrganizationRole"[] is still the default. But nothing stops
    // one, and if a row ever gets NULL, Prisma's type is a lie at that row.
    //
    // Declared to match the DATABASE, not Prisma, because that is what the
    // query will actually get back. Restoring the constraint is a migration
    // against staging, which needs an operator decision — see
    // docs/notes/2026-08-06-modular-split-and-drizzle.md.
    roles: organizationRoleEnum("roles").array().default([]),
    notes: text("notes"),
    kind: organizationKindEnum("kind"),
    contacts: jsonb("contacts").notNull().default([]),
    mainContactUserId: uuid("main_contact_user_id"),
  },
);

/** Prisma model `HostApplication` — tenancy.host_applications */
export const hostApplications = tenancySchema.table(
  "host_applications",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    companyName: text("company_name").notNull(),
    contactName: text("contact_name").notNull(),
    contactEmail: text("contact_email").notNull(),
    contactPhone: text("contact_phone"),
    kennitala: text("kennitala"),
    siteType: organizationKindEnum("site_type").notNull(),
    sites: jsonb("sites").notNull().default([]),
    description: text("description"),
    status: hostApplicationStatusEnum("status").notNull().default("new"),
    convertedOrgId: uuid("converted_org_id"),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().$defaultFn(() => new Date()).$onUpdateFn(() => new Date()),
  },
  (t) => [
    index().on(t.status),
  ],
);

/** Prisma model `Membership` — tenancy.memberships */
export const memberships = tenancySchema.table(
  "memberships",
  {
    orgId: uuid("org_id").notNull(),
    userId: uuid("user_id").notNull(),
    role: membershipRoleEnum("role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().defaultNow(),
    status: membershipStatusEnum("status").notNull().default("active"),
    invitedById: uuid("invited_by_id"),
    invitedAt: timestamp("invited_at", { withTimezone: true, precision: 6, mode: "date" }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true, precision: 6, mode: "date" }),
    suspendedAt: timestamp("suspended_at", { withTimezone: true, precision: 6, mode: "date" }),
    revokedAt: timestamp("revoked_at", { withTimezone: true, precision: 6, mode: "date" }),
    scopeSiteIds: uuid("scope_site_ids").array().notNull().default([]),
    scopePropertyIds: uuid("scope_property_ids").array().notNull().default([]),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.userId] }),
    index().on(t.orgId, t.status),
  ],
);

/** Prisma model `OrgEmailDomain` — tenancy.org_email_domains */
export const orgEmailDomains = tenancySchema.table(
  "org_email_domains",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    orgId: uuid("org_id").notNull(),
    domain: text("domain").notNull(),
    policy: orgEmailDomainPolicyEnum("policy").notNull().default("request_approval"),
    defaultDriverGroupId: uuid("default_driver_group_id"),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().$defaultFn(() => new Date()).$onUpdateFn(() => new Date()),
  },
  (t) => [
    uniqueIndex().on(t.domain),
    index().on(t.orgId),
  ],
);

/** Prisma model `FamilyGroup` — people.family_groups */
export const familyGroups = peopleSchema.table(
  "family_groups",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    orgId: uuid("org_id").notNull(),
    displayName: text("display_name").notNull(),
    primaryUserId: uuid("primary_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    index().on(t.orgId),
  ],
);

/** Prisma model `FamilyMembership` — people.family_memberships */
export const familyMemberships = peopleSchema.table(
  "family_memberships",
  {
    familyGroupId: uuid("family_group_id").notNull(),
    userId: uuid("user_id").notNull(),
    memberKind: memberKindEnum("member_kind").notNull(),
    joinedAt: timestamp("joined_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.familyGroupId, t.userId] }),
  ],
);

/** Prisma model `PlatformGrant` — identity.platform_grants */
export const platformGrants = identitySchema.table(
  "platform_grants",
  {
    userId: uuid("user_id").primaryKey(),
    role: platformRoleEnum("role").notNull(),
    status: platformGrantStatusEnum("status").notNull().default("active"),
    grantedById: uuid("granted_by_id"),
    grantedAt: timestamp("granted_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true, precision: 6, mode: "date" }),
    revokedAt: timestamp("revoked_at", { withTimezone: true, precision: 6, mode: "date" }),
    revokedById: uuid("revoked_by_id"),
    scope: jsonb("scope"),
  },
);

