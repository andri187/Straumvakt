// catalog — vendor-neutral reference data about hardware that exists.
//
// Postgres schema: hardware (tables: vendors, models)
//
// EVERYTHING MAY IMPORT CATALOG. CATALOG IMPORTS NOTHING.
//
// Split out of vendor.ts on 2026-08-07, following the Driivz/AMPECO
// benchmark. "Nothing may import vendor" was false in the data model before a
// line of code ran: assets.prisma:193-194 and :379 point Installation.model
// and ChargingStation.hardwareModel at HardwareModel. Assets — the layer the
// rule exists to protect — already depended on the domain it may not touch.
//
// The two things were never the same. A catalogue row says "a Zaptec Pro
// exists and has these capabilities", which is reference data every layer may
// legitimately name. An adapter row says "here are credentials for Zaptec's
// API", which is the fast-changing external dependency the rule is about.
// Both comparators separate them: Driivz spends roughly 20 of 54 tags on the
// catalogue, AMPECO has Configuration Templates as a top-level group, and
// NEITHER exposes vendor identity in its public surface at all.
//
// Splitting the catalogue out clears the model-level violation. It does not
// clear the 22 code-level ones in the dependency-cruiser baseline — those are
// genuinely adapter, and they are the measurement of distance from the rule
// rather than an argument against it.

import { index, jsonb, pgSchema, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { assetClassEnum } from "./protocol";

export const hardwareSchema = pgSchema("hardware");

export const hardwareVendorKindEnum = hardwareSchema.enum("HardwareVendorKind", ["charger_ac", "charger_dc", "meter", "modem", "controller", "multi"]);
export const vendorApiKindEnum = hardwareSchema.enum("VendorApiKind", ["oauth", "basic_auth", "none"]);
export const vendorCredentialScopeEnum = hardwareSchema.enum("VendorCredentialScope", ["installation", "identity", "none"]);

/** Prisma model `HardwareVendor` — hardware.vendors */
export const vendors = hardwareSchema.table(
  "vendors",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    slug: text("slug").notNull(),
    displayName: text("display_name").notNull(),
    kind: hardwareVendorKindEnum("kind").notNull(),
    website: text("website"),
    apiKind: vendorApiKindEnum("api_kind").notNull().default("none"),
    supportContact: jsonb("support_contact").notNull().default({}),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().$defaultFn(() => new Date()).$onUpdateFn(() => new Date()),
  },
);

/** Prisma model `HardwareModel` — hardware.models */
export const models = hardwareSchema.table(
  "models",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    vendorId: uuid("vendor_id").notNull(),
    slug: text("slug").notNull(),
    displayName: text("display_name").notNull(),
    kind: hardwareVendorKindEnum("kind").notNull(),
    // HAND-EDIT, not from the scaffolder — and it has now been lost once.
    // This column exists in the database and Prisma's HardwareModel does not
    // declare it, so Prisma has never been able to read or write it. Nullable,
    // so nothing breaks; it is simply invisible to the ORM.
    //
    // It was re-scaffolded away when models moved from vendor.ts to catalog.ts
    // on 2026-08-07. domain-schemas.test.ts caught it immediately, which is the
    // only reason a hand-owned generated file is survivable.
    //
    // The enum lives in the ocpp schema, not hardware: one Postgres type used
    // from two schemas, imported rather than redeclared.
    assetClass: assetClassEnum("asset_class"),
    credentialScope: vendorCredentialScopeEnum("credential_scope").notNull().default("none"),
    profile: jsonb("profile").notNull().default({}),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, precision: 6, mode: "date" }).notNull().$defaultFn(() => new Date()).$onUpdateFn(() => new Date()),
  },
  (t) => [
    uniqueIndex().on(t.vendorId, t.slug),
    index().on(t.kind, t.status),
  ],
);

