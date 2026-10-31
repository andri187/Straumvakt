// Selected OEM installation → the existing installation save contract.
//
// A vendor read (the server-side reader in ./vendor-read.mjs, called by ./vendor-onboarding.ts with the operator's own
// short-lived connection) produces an allowlisted, versioned PACKAGE for one vendor installation. This module treats that
// package as untrusted input all the same: it is validated here, reduced to the allowlisted shape (unknown keys are
// dropped, never stored), and mapped to a SaveInstallationInput that goes through the one existing save service. There is
// no second installation writer, and a package that arrives from a browser is never accepted.
//
// What the package may and may not carry is a contract, not a convenience:
//   - physical structure and names, vendor references kept apart from Straumvakt ids, rated/operational ceilings as the
//     vendor reported them, and the NAMES of the vendor fields that were present;
//   - never a password, PIN, token, customer contact data, tariff, driver list or raw response.
// Unknown stays unknown (null). A vendor "rated current" is not a physical breaker rating, so it is only mapped onto
// circuits when the operator explicitly accepts that; the vendor value is retained in the snapshot either way.
//
// Everything here is database-free. Value imports from ./model are avoided on purpose (model.ts imports this module's
// schema); the limits below are checked against model.ts by a test.

import { z } from "zod";
import { CHARGE_POINT_ID } from "./address";
import type { SaveInstallationInput } from "./model";

export const IMPORT_SCHEMA_VERSION = 1;
export const PACKAGE_KIND = "straumvakt-vendor-site";
/** Same values as MAX_CIRCUITS / MAX_CHARGERS / MAX_TREE_DEPTH / NEW_ID_PREFIX in ./model (asserted in the tests). */
export const LIMITS = { circuits: 200, equipment: 500, depth: 8, newIdPrefix: "new-" } as const;

/**
 * The vendor is an open slug (the hardware catalogue's own `slug`), not a closed list: nothing in this module knows a
 * particular vendor, so adding one needs an adapter at the edge (the read tool), not a change here.
 */
export type ImportVendor = string;
const VENDOR_SLUG = /^[a-z][a-z0-9-]{1,31}$/;
/** A display name derived from the slug ("easee" → "Easee"); never used as an identity. */
export const vendorLabel = (slug: string) => slug.charAt(0).toUpperCase() + slug.slice(1);

const opt = (max: number) =>
  z
    .string()
    .max(max)
    .nullish()
    .transform((v) => {
      const t = typeof v === "string" ? v.trim() : "";
      return t.length > 0 ? t : null;
    });

/** A vendor's own identifier. Opaque; never interpreted as an OCPP identity or a serial number. */
const ref = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[0-9A-Za-z_.:-]+$/, "Not a vendor reference");
const optRef = ref.nullish().transform((v) => v ?? null);

const amps = z
  .number()
  .int()
  .min(0)
  .max(5000)
  .nullish()
  .transform((v) => v ?? null);
const flag = z
  .boolean()
  .nullish()
  .transform((v) => v ?? null);
/** Per-phase values in L1, L2, L3 order; an entry the vendor did not report is null. */
const perPhase = z
  .array(amps)
  .length(3)
  .nullish()
  .transform((v) => v ?? null);

const FIELD_NAME = /^[A-Za-z][A-Za-z0-9_.]{0,59}$/;

const circuitPackage = z.object({
  ref,
  parentRef: optRef,
  name: opt(120),
  /** As the vendor reported it. Not a confirmed physical protective-device rating. */
  ratedCurrentAmps: amps,
  use3Phase: flag,
  limits: z
    .object({ maxCircuitCurrent: perPhase, offlineMaxCircuitCurrent: perPhase, dynamicCircuitCurrent: perPhase })
    .nullish()
    .transform((v) => v ?? { maxCircuitCurrent: null, offlineMaxCircuitCurrent: null, dynamicCircuitCurrent: null }),
  chargerRefs: z.array(ref).max(100).default([]),
});

const equipmentPackage = z.object({
  ref,
  name: opt(120),
  circuitRef: optRef,
  /** Vendor product code, kept as reported; not translated to a model name. */
  productCode: opt(40),
  /** The vendor's master/primary reference for this charger, as reported. For Easee it is a back-plate id and is not asserted to equal any charger reference. */
  masterRef: optRef,
  /**
   * The physical serial number, only when the vendor reported it in an explicit serial/device-id field. It is neither the
   * vendor reference above nor an OCPP identity, and it is never derived from either.
   */
  serialNumber: z
    .string()
    .trim()
    .max(80)
    .regex(/^[0-9A-Za-z._-]{3,80}$/, "Not a serial number")
    .nullish()
    .transform((v) => v ?? null),
});

export const VendorPackage = z
  .object({
    kind: z.literal(PACKAGE_KIND),
    version: z.literal(IMPORT_SCHEMA_VERSION),
    vendor: z.string().regex(VENDOR_SLUG, "Not a vendor slug"),
    capturedAt: z.string().datetime({ offset: true }),
    site: z.object({
      ref,
      name: opt(200),
      siteKey: opt(100),
      siteType: opt(40),
      siteCategory: opt(40),
      accessMode: opt(40),
      /** Physical address as the vendor holds it; used to suggest a Straumvakt site, never to pick one. */
      address: z
        .object({ line: opt(200), city: opt(100), postalCode: opt(20), country: opt(60) })
        .nullish()
        .transform((v) => v ?? null),
      ratedCurrentAmps: amps,
      maxAllocatedCurrentAmps: amps,
      useDynamicMaster: flag,
      /** As the vendor labels the supply (e.g. "TN_3_Phase"); mapped onto the installation only with the operator's acceptance. */
      networkType: z
        .string()
        .regex(/^(TN|IT)_[13]_Phase$/)
        .nullish()
        .transform((v) => v ?? null),
    }),
    circuits: z.array(circuitPackage).max(LIMITS.circuits),
    equipment: z.array(equipmentPackage).max(LIMITS.equipment),
    /** Meters/controllers the vendor listed on the site. References only: what they measure is NOT captured. */
    equalizers: z.array(z.object({ ref, name: opt(120) })).max(50).default([]),
    /** Names (never values) of the vendor fields the read actually saw, so missing data is visible as missing. */
    fieldsObserved: z.array(z.string().regex(FIELD_NAME)).max(120).default([]),
    /** Areas this read did not capture, stated so absence is not mistaken for emptiness. */
    notCaptured: z.array(z.string().max(80)).max(30).default([]),
  })
  .superRefine((p, ctx) => {
    const dup = (items: { ref: string }[], path: string) => {
      const seen = new Set<string>();
      items.forEach((item, i) => {
        if (seen.has(item.ref)) ctx.addIssue({ code: "custom", path: [path, i, "ref"], message: "Duplicate reference" });
        seen.add(item.ref);
      });
    };
    dup(p.circuits, "circuits");
    dup(p.equipment, "equipment");
  });
export type VendorPackage = z.output<typeof VendorPackage>;

/**
 * What a save carries when it creates an installation from a vendor read. `package` is the validated package;
 * `acceptedElectrical` records the operator's explicit acceptance of the vendor's ratings; `attached` lists the equipment
 * references that this save turned into chargers (everything else is kept as equipment awaiting an OCPP identity).
 */
export const VendorImportInput = z.object({
  package: VendorPackage,
  acceptedElectrical: z.boolean().default(false),
  attached: z.array(ref).max(LIMITS.equipment).default([]),
});
export type VendorImportInput = z.output<typeof VendorImportInput>;

export function parseVendorPackage(raw: unknown): { ok: true; package: VendorPackage } | { ok: false; problems: { path: string; message: string }[] } {
  const r = VendorPackage.safeParse(raw);
  if (r.success) return { ok: true, package: r.data };
  return { ok: false, problems: r.error.issues.slice(0, 20).map((i) => ({ path: i.path.join("."), message: i.message })) };
}

/** The durable identity of an import: CPO (from the save) + vendor + the vendor's own installation reference. */
export function importKey(vi: Pick<VendorImportInput, "package">): { vendor: ImportVendor; externalRef: string } {
  return { vendor: vi.package.vendor, externalRef: vi.package.site.ref };
}

export type EquipmentAttachment = "attached" | "needs_ocpp_identity";

/**
 * The snapshot kept with the installation (`properties.installations.metadata.vendorImport`). It is rebuilt from the
 * validated package, so nothing the caller sent outside the allowlist can reach storage.
 */
export function importMetadata(vi: VendorImportInput, importedAt: Date) {
  const p = vi.package;
  const attached = new Set(vi.attached);
  return {
    vendorImport: {
      schemaVersion: IMPORT_SCHEMA_VERSION,
      vendor: p.vendor,
      externalRef: p.site.ref,
      capturedAt: p.capturedAt,
      importedAt: importedAt.toISOString(),
      source: "read by the server from the vendor API with the signed-in operator's own short-lived vendor connection; vendor data is as the vendor reported it and is not independently verified",
      electricalValuesAccepted: vi.acceptedElectrical,
      site: p.site,
      circuits: p.circuits,
      equipment: p.equipment.map((e) => ({ ...e, attachment: (attached.has(e.ref) ? "attached" : "needs_ocpp_identity") as EquipmentAttachment })),
      equalizers: p.equalizers,
      fieldsObserved: p.fieldsObserved,
      notCaptured: p.notCaptured,
    },
  };
}

// ── Mapping ────────────────────────────────────────────────────────────────

export type MapOptions = {
  siteId: string;
  idempotencyKey: string;
  /** The operator accepts the vendor's rated current / three-phase flag as the circuit's rating and phase count. */
  acceptVendorElectrical?: boolean;
  /** Equipment reference → the charger's own OCPP identity, typed by the operator. Never derived from the vendor reference. */
  ocppIds?: Record<string, string>;
};

export type PendingEquipment = {
  ref: string;
  name: string | null;
  circuitRef: string | null;
  reason: "needs_ocpp_identity" | "invalid_ocpp_identity" | "no_circuit";
  /** The serial the vendor reported, if any. Offered so the operator can choose to use it as the OCPP id; never applied for them. */
  serialNumber?: string | null;
};

/**
 * An equipment item that was given an OCPP identity by this mapping. `source` is always the operator's explicit choice: the
 * mapper never invents an identity, never copies the vendor reference or the serial into one, and a vendor-configured
 * identity is only ever adopted when the operator confirms it by entering it.
 */
export type ResolvedCharger = {
  ref: string;
  chargePointId: string;
  circuitRef: string | null;
  serialNumber: string | null;
  name: string | null;
  source: "operator";
};

export type MapResult = {
  input: z.input<typeof SaveInstallationInput>;
  pendingEquipment: PendingEquipment[];
  /** Every item that has a valid identity and a circuit, in package order (whether or not this save is the one that creates it). */
  resolved: ResolvedCharger[];
  warnings: string[];
};

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s);

/**
 * Maps a validated package onto the existing save contract. The vendor's Site becomes a Straumvakt INSTALLATION; the
 * Straumvakt Site is the one the operator chose (`siteId`), never matched by name. Chargers are created only when the
 * operator supplied a valid OCPP identity for them; the rest are reported, and kept in the snapshot as equipment awaiting
 * attachment, not dropped and not given an invented identity.
 */
export function mapPackageToSave(pkg: VendorPackage, opts: MapOptions): MapResult {
  const warnings: string[] = [];
  const accept = opts.acceptVendorElectrical === true;
  const idByRef = new Map<string, string>(pkg.circuits.map((c, i) => [c.ref, `${LIMITS.newIdPrefix}vi-${i}`]));
  const parentOf = new Map<string, string | null>(pkg.circuits.map((c) => [c.ref, c.parentRef]));

  /** A parent that is missing, self-referencing, looping or nested too deep is dropped (the circuit goes under the main device) and reported. */
  const safeParentId = (circuitRef: string): string | null => {
    const parent = parentOf.get(circuitRef) ?? null;
    if (parent === null) return null;
    if (!idByRef.has(parent) || parent === circuitRef) {
      warnings.push(`Circuit ${circuitRef}: parent ${parent} is not in this site; placed directly under the main device.`);
      return null;
    }
    const seen = new Set<string>([circuitRef]);
    let depth = 1;
    let cur: string | null = parent;
    while (cur !== null) {
      if (seen.has(cur)) {
        warnings.push(`Circuit ${circuitRef}: the vendor's parent links form a loop; placed directly under the main device.`);
        return null;
      }
      seen.add(cur);
      depth += 1;
      cur = parentOf.get(cur) ?? null;
    }
    if (depth > LIMITS.depth) {
      warnings.push(`Circuit ${circuitRef}: nested deeper than ${LIMITS.depth} levels; placed directly under the main device.`);
      return null;
    }
    return idByRef.get(parent) ?? null;
  };

  const circuits = pkg.circuits.map((c) => ({
    id: idByRef.get(c.ref)!,
    parentId: safeParentId(c.ref),
    displayName: clip(c.name ?? `${vendorLabel(pkg.vendor)} circuit ${c.ref}`, 120),
    ratingAmps: accept ? c.ratedCurrentAmps : null,
    phaseCount: accept && c.use3Phase === true ? (3 as const) : null,
    vendorRef: c.ref,
  }));

  const chargers: z.input<typeof SaveInstallationInput>["chargers"] = [];
  const attached: string[] = [];
  const pendingEquipment: PendingEquipment[] = [];
  const resolved: ResolvedCharger[] = [];
  pkg.equipment.forEach((e, i) => {
    const typed = opts.ocppIds?.[e.ref]?.trim() ?? "";
    const circuitId = e.circuitRef !== null ? idByRef.get(e.circuitRef) : undefined;
    const base = { ref: e.ref, name: e.name, circuitRef: e.circuitRef, serialNumber: e.serialNumber };
    // Two items sharing one OCPP id are not decided here: the save refuses the whole request before writing anything.
    if (typed === "") {
      pendingEquipment.push({ ...base, reason: "needs_ocpp_identity" });
      return;
    }
    if (!CHARGE_POINT_ID.test(typed)) {
      pendingEquipment.push({ ...base, reason: "invalid_ocpp_identity" });
      return;
    }
    if (!circuitId) {
      pendingEquipment.push({ ...base, reason: "no_circuit" });
      return;
    }
    chargers.push({
      id: `${LIMITS.newIdPrefix}ve-${i}`,
      circuitId,
      label: clip(e.name ?? e.ref, 120),
      chargePointId: typed,
      vendor: vendorLabel(pkg.vendor),
      // A vendor product code is not a model name, and a vendor API id is not a serial number: neither is guessed. The
      // serial is stored only when the vendor reported it in an explicit serial/device-id field.
      model: null,
      serialNumber: e.serialNumber,
    });
    resolved.push({ ref: e.ref, chargePointId: typed, circuitRef: e.circuitRef, serialNumber: e.serialNumber, name: e.name, source: "operator" });
    attached.push(e.ref);
  });

  const input: z.input<typeof SaveInstallationInput> = {
    siteId: opts.siteId,
    idempotencyKey: opts.idempotencyKey,
    installation: {
      displayName: clip(pkg.site.name ?? pkg.site.siteKey ?? `${vendorLabel(pkg.vendor)} site ${pkg.site.ref}`, 120),
      // The vendor's site-level current is retained in the snapshot. It is not taken as the main protective device.
      mainDeviceType: null,
      mainRatingAmps: null,
      // The supply system and phase count the vendor reports for the installation. Mapped only on the operator's acceptance,
      // and never inferred from voltage or from anything but the vendor's own network type.
      mainPhaseCount: accept && pkg.site.networkType ? (pkg.site.networkType.includes("_3_") ? (3 as const) : (1 as const)) : null,
      mainGridType: accept && pkg.site.networkType ? (pkg.site.networkType.startsWith("TN") ? ("TN" as const) : ("IT" as const)) : null,
    },
    electrician: {},
    circuits,
    chargers,
    vendorImport: { package: pkg, acceptedElectrical: accept, attached },
  };
  return { input, pendingEquipment, resolved, warnings };
}
