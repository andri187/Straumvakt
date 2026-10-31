// Types, input contract and pure helpers for installation management (S1).
//
// Everything here is database-free. The save contract is deliberately a
// whole-state submission: the page edits one document (installation, electrician,
// electrical tree, chargers) and sends it with the revision it started from.
// The server diffs it against what is stored and applies the difference in one
// transaction, so unsaved rows added, edited or removed in the browser need no
// per-row endpoints and a half-saved tree cannot exist.

import { z } from "zod";
import { CHARGE_POINT_ID } from "./address";
import { VendorImportInput } from "./vendor-import";

export const MAX_TREE_DEPTH = 8; // implementation bound, not an electrical or OCPP limit
export const MAX_CIRCUITS = 200;
export const MAX_CHARGERS = 500;
export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 128;

export const NEW_ID_PREFIX = "new-";

/** Null is "unknown". It is never coerced to 0 and never to a default. */
export type Amps = number | null;
export type Phases = 1 | 2 | 3 | null;
/** Supply system. Null = not specified. Never inferred from voltage or phase count. */
export type Grid = "TN" | "IT" | null;

export type Electrician = {
  name: string | null;
  email: string | null;
  phone: string | null;
};

export type PasswordMode = "unset" | "none" | "password";

export type CircuitState = {
  id: string;
  parentId: string | null; // null = directly under the main protective device
  displayName: string;
  ratingAmps: Amps;
  phaseCount: Phases;
  sortOrder: number;
};

export type ChargerState = {
  /** assets.devices.id — the permanent Straumvakt equipment id. */
  id: string;
  placementId: string;
  circuitId: string;
  label: string;
  /** The charger's own OCPP id, exactly as it sends it. Stored with the CPO organisation (see identityRow); never derived from the serial. */
  chargePointId: string;
  vendor: string | null;
  model: string | null;
  serialNumber: string | null;
};

export type InstallationState = {
  id: string;
  orgId: string;
  siteId: string;
  key: string;
  displayName: string;
  revision: number;
  mainDeviceType: string | null;
  mainRatingAmps: Amps;
  mainPhaseCount: Phases;
  mainGridType: Grid;
  electrician: Electrician;
  electricianChangedRevision: number;
  responsibleConfirmedRevision: number | null;
  passwordMode: PasswordMode;
  passwordSetAt: string | null;
};

export type Snapshot = {
  installation: InstallationState;
  circuits: CircuitState[];
  chargers: ChargerState[];
  /**
   * Stored circuit id → the vendor's own circuit reference, present only for circuits that came from a vendor import. Lets a
   * retry of an import attach a charger to the right circuit. Not part of any API view; a reference, never an identity.
   */
  vendorCircuitRefs?: Record<string, string>;
};

// ── Input contract ─────────────────────────────────────────────────────────

const text = (max: number) =>
  z
    .string()
    .max(max)
    .nullish()
    .transform((v) => {
      const t = typeof v === "string" ? v.trim() : "";
      return t.length > 0 ? t : null;
    });

const amps = z
  .number()
  .int()
  .min(0)
  .max(5000)
  .nullable()
  .optional()
  .transform((v) => (v === undefined ? null : v));

const phases = z
  .union([z.literal(1), z.literal(2), z.literal(3)])
  .nullable()
  .optional()
  .transform((v) => (v === undefined ? null : v));

// Deliberately modest: shape check, not proof that the mailbox or number exists.
const email = text(254).refine(
  (v) => v === null || /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/.test(v),
  "Not a valid email address",
);
const phone = text(32).refine(
  (v) => v === null || (/^\+?[0-9 ()-]{5,32}$/.test(v) && (v.match(/[0-9]/g) ?? []).length >= 5),
  "Not a valid phone number",
);

export { CHARGE_POINT_ID };

const circuitInput = z.object({
  id: z.string().min(1).max(64),
  parentId: z.string().min(1).max(64).nullable().optional().transform((v) => v ?? null),
  displayName: z.string().trim().min(1, "Name is required").max(120),
  ratingAmps: amps,
  phaseCount: phases,
  /** The vendor's own circuit reference when the circuit comes from a vendor import. Create only; never an identity. */
  vendorRef: z.string().trim().max(100).nullish().transform((v) => (v ? v : null)),
});

const chargerInput = z.object({
  id: z.string().min(1).max(64),
  circuitId: z.string().min(1).max(64),
  label: z.string().trim().min(1, "Name is required").max(120),
  chargePointId: z.string().trim().regex(CHARGE_POINT_ID, "Use letters, digits, '.', '_' or '-' (max 48)"),
  vendor: text(80),
  model: text(80),
  serialNumber: text(80),
});

export const PasswordInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("keep") }),
  z.object({ action: z.literal("none") }),
  z.object({ action: z.literal("generate") }),
  z.object({
    action: z.literal("set"),
    value: z.string().min(MIN_PASSWORD_LENGTH).max(MAX_PASSWORD_LENGTH),
  }),
]);
export type PasswordInput = z.infer<typeof PasswordInput>;

export const SaveInstallationInput = z.object({
  /** Absent = create. */
  installationId: z.string().uuid().optional(),
  /** Required on create; on update it is checked against the stored record, never trusted. */
  orgId: z.string().uuid().optional(),
  siteId: z.string().uuid().optional(),
  /**
   * Create only: the unfinished-form draft this installation is created from. It is closed in the same
   * transaction, and a draft that was discarded or already used refuses the create. Absent = no draft.
   */
  draftId: z.string().uuid().optional(),
  /** Required on update. */
  expectedRevision: z.number().int().min(1).optional(),
  /** One per user action; a replay of the same key is answered, not re-applied. */
  idempotencyKey: z.string().uuid(),
  /** When the physical change happened, if the operator says. Recorded, never used to rewrite history. */
  effectiveAt: z.string().datetime({ offset: true }).optional(),
  installation: z.object({
    displayName: z.string().trim().min(1, "Name is required").max(120),
    mainDeviceType: text(60),
    mainRatingAmps: amps,
    mainPhaseCount: phases,
    mainGridType: z.enum(["TN", "IT"]).nullable().optional().transform((v) => v ?? null),
  }),
  electrician: z.object({ name: text(120), email, phone }),
  password: PasswordInput.default({ action: "keep" }),
  circuits: z.array(circuitInput).max(MAX_CIRCUITS),
  chargers: z.array(chargerInput).max(MAX_CHARGERS),
  /**
   * Create only: this installation comes from a selected vendor installation. The durable identity is the CPO + vendor +
   * the vendor's installation reference; a second create for the same one returns the first instead of making another.
   */
  vendorImport: VendorImportInput.optional(),
});
export type SaveInstallationInput = z.infer<typeof SaveInstallationInput>;

// ── Draft document ─────────────────────────────────────────────────────────

const typed = (max: number) => z.string().max(max).default("");

/**
 * What an unfinished form keeps: the fields exactly as typed, so values may be
 * empty, unparsed or invalid; required-field validation belongs to creation. The
 * shape is STRICT and has no password field, so a payload carrying one is refused
 * rather than stored. Only the fact that a password had been typed is kept (pwPending), so a resumed form
 * can ask for it again; the value itself is never stored here.
 */
export const DraftPayload = z
  .object({
    name: typed(120),
    siteId: typed(64),
    mainType: typed(60),
    mainAmps: typed(8),
    mainPhases: z.enum(["", "1", "2", "3"]).default(""),
    mainGrid: z.enum(["", "TN", "IT"]).default(""),
    eName: typed(120),
    eEmail: typed(254),
    ePhone: typed(32),
    effectiveAt: typed(40),
    pwPending: z.boolean().default(false),
    circuits: z
      .array(
        z
          .object({
            id: z.string().min(1).max(64),
            parentId: z.string().min(1).max(64).nullable().default(null),
            displayName: typed(120),
            ratingAmps: typed(8),
            phaseCount: z.enum(["", "1", "2", "3"]).default(""),
          })
          .strict(),
      )
      .max(MAX_CIRCUITS)
      .default([]),
    chargers: z
      .array(
        z
          .object({
            id: z.string().min(1).max(64),
            circuitId: z.string().min(1).max(64),
            label: typed(120),
            chargePointId: typed(48),
            vendor: typed(80),
            model: typed(80),
            serialNumber: typed(80),
          })
          .strict(),
      )
      .max(MAX_CHARGERS)
      .default([]),
  })
  .strict();
export type DraftPayload = z.infer<typeof DraftPayload>;

export type FieldProblem = { path: string; message: string };

// ── Pure helpers ───────────────────────────────────────────────────────────

/**
 * Effective charging allowance. A missing rating anywhere on the path to the
 * main device means zero: unknown capacity never permits current. This is the
 * number the form shows; it is NOT confirmation that a charger was limited.
 */
export function effectiveAllowanceAmps(chain: readonly Amps[]): { amps: number; basis: "entered" | "unknown" } {
  let min = Number.POSITIVE_INFINITY;
  for (const rating of chain) {
    if (rating === null) return { amps: 0, basis: "unknown" };
    min = Math.min(min, rating);
  }
  return { amps: Number.isFinite(min) ? min : 0, basis: Number.isFinite(min) ? "entered" : "unknown" };
}

export type ResponsibleStatus = "not_provided" | "not_confirmed" | "confirmed";

/** Confirmation is tied to a revision: any later edit leaves it unconfirmed. */
export function responsibleStatus(i: Pick<InstallationState, "electrician" | "revision" | "responsibleConfirmedRevision">): ResponsibleStatus {
  const e = i.electrician;
  if (!e.name && !e.email && !e.phone) return "not_provided";
  return i.responsibleConfirmedRevision !== null && i.responsibleConfirmedRevision === i.revision ? "confirmed" : "not_confirmed";
}

const RESERVED_LABELS = new Set([
  "www", "api", "admin", "app", "apps", "ocpp", "ws", "wss", "gateway", "staging", "test", "dev", "mail",
  "smtp", "ftp", "cdn", "static", "assets", "console", "login", "signin", "auth", "docs", "status",
  "straumvakt", "cpo", "dso", "plan", "driver", "billing", "support", "help", "blog", "root", "internal",
]);

export function isReservedRoutingLabel(label: string): boolean {
  return RESERVED_LABELS.has(label);
}

/** Lowercase DNS label from an organisation name: a-z, 0-9 and inner hyphens, at most 32. */
export function routingLabelFromName(name: string): string {
  const base = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/ð/g, "d")
    .replace(/þ/g, "th")
    .replace(/æ/g, "ae")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24)
    .replace(/-+$/g, "");
  return base.length >= 2 ? base : "cpo";
}

const KEY_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

/** 12 characters from an unambiguous alphabet (~59 bits). Unique index is the final arbiter. */
export function newInstallationKey(random: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  const bytes = random(12);
  let out = "";
  for (const b of bytes) out += KEY_ALPHABET[b % KEY_ALPHABET.length];
  return out;
}

// The address helpers live in ./address so a client component can use them
// without importing this module's validation dependencies.
export { CONNECTION_DOMAIN, chargerAddress, cpoAddress } from "./address";

/**
 * The identity row written for a charger: the CPO organisation and the charge point id as columns (what admission
 * resolves by), plus the same pair as one string for readers of `identity_string`. The string is
 * `{cpo-org-id}/{charge-point-id}`. Rows written before the CPO-only URL hold `{installation-key}/{charge-point-id}`
 * and are left as written; nothing parses either form back into a charge point id.
 */
export function identityRow(cpoOrgId: string, chargePointId: string): { cpoOrgId: string; chargePointId: string; identityString: string } {
  return { cpoOrgId, chargePointId, identityString: `${cpoOrgId}/${chargePointId}` };
}
