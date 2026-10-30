// Types, input contract and pure helpers for installation management (S1).
//
// Everything here is database-free. The save contract is deliberately a
// whole-state submission: the page edits one document (installation, electrician,
// electrical tree, chargers) and sends it with the revision it started from.
// The server diffs it against what is stored and applies the difference in one
// transaction, so unsaved rows added, edited or removed in the browser need no
// per-row endpoints and a half-saved tree cannot exist.

import { z } from "zod";

export const MAX_TREE_DEPTH = 8; // implementation bound, not an electrical or OCPP limit
export const MAX_CIRCUITS = 200;
export const MAX_CHARGERS = 500;
export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 128;

export const NEW_ID_PREFIX = "new-";

/** Null is "unknown". It is never coerced to 0 and never to a default. */
export type Amps = number | null;
export type Phases = 1 | 2 | 3 | null;

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
  /** Only the charge-point part; the installation key prefix is added for the stored OCPP identity. */
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

/** OCPP charge-point id: a single URL path segment, conservative on purpose. */
export const CHARGE_POINT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,47}$/;

const circuitInput = z.object({
  id: z.string().min(1).max(64),
  parentId: z.string().min(1).max(64).nullable().optional().transform((v) => v ?? null),
  displayName: z.string().trim().min(1, "Name is required").max(120),
  ratingAmps: amps,
  phaseCount: phases,
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
  }),
  electrician: z.object({ name: text(120), email, phone }),
  password: PasswordInput.default({ action: "keep" }),
  circuits: z.array(circuitInput).max(MAX_CIRCUITS),
  chargers: z.array(chargerInput).max(MAX_CHARGERS),
});
export type SaveInstallationInput = z.infer<typeof SaveInstallationInput>;

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

export const CONNECTION_DOMAIN = "straumvakt.org";

/**
 * The address a charger will use once the gateway supports it. The password is
 * never part of it. `chargePointId` stays a placeholder until chosen.
 */
export function connectionAddress(routingId: string | null, installationKey: string, chargePointId = "{charge-point-id}"): string {
  return `wss://${routingId ?? "{cpo-id}"}.${CONNECTION_DOMAIN}/${installationKey}/${chargePointId}`;
}

/** The identity string stored in assets.device_identities: the path the gateway will resolve. */
export function storedIdentity(installationKey: string, chargePointId: string): string {
  return `${installationKey}/${chargePointId}`;
}
