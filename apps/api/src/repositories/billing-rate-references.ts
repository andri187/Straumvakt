// Repository for agreements.rate_references.
//
// RateReference is time-versioned: same `code` can have multiple rows with
// non-overlapping effective_from / effective_until windows. The resolver
// picks the row where effective_from <= session_time < effective_until.
//
// Rule 5 (ADR 0019): price_minor, effective_from, effective_until on a
// currently-active row are IMMUTABLE — changing them would silently corrupt
// session-stop resolution for sessions already in flight or in the audit
// trail. The repository enforces this by returning an explicit
// "active_row_immutable" error; routes map it to HTTP 400.
//
// Phase 4 will add pattern_json (ToD restrictions, OCPI 2.2.1 shape).
// The column is in the schema; this repo ignores it until the UI lands.

import type { PrismaClient } from "../generated/prisma/client";
import type { RateBasis } from "../generated/prisma/enums";
import type {
  CreateRateReferenceInput,
  PatchRateReferenceInput,
} from "../lib/billing/rate-reference-zod";

// ─────────────────────────────────────────────────────────────────────────────
// UI shapes
// ─────────────────────────────────────────────────────────────────────────────

export interface RateReferenceRow {
  id: string;
  code: string;
  costFactorId: string;
  costFactorCode: string;
  costFactorDisplayNameEn: string;
  supplierOrgId: string | null;
  supplierOrgDisplayName: string | null;
  basis: RateBasis;
  priceMinor: string;   // BigInt → string for JSON transport
  currency: string;
  vatRatePct: string;   // Decimal → string
  effectiveFrom: string;  // ISO-8601
  effectiveUntil: string | null;
  notes: string | null;
  createdAt: string;
  /** Computed: "current" | "staged" | "expired" */
  status: "current" | "staged" | "expired";
}

export interface RateReferenceCodeGroup {
  code: string;
  costFactorCode: string;
  costFactorDisplayNameEn: string;
  current: RateReferenceRow | null;
  staged: RateReferenceRow[];
  expired: RateReferenceRow[];
}

export interface RateReferenceCatalogueSummary {
  totalCodes: number;
  currentCount: number;
  stagedCount: number;
  expiredCount: number;
  groups: RateReferenceCodeGroup[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function rowStatus(
  effectiveFrom: Date,
  effectiveUntil: Date | null,
  now: Date,
): "current" | "staged" | "expired" {
  if (effectiveFrom > now) return "staged";
  if (effectiveUntil !== null && effectiveUntil <= now) return "expired";
  return "current";
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toRow(r: any, now: Date): RateReferenceRow {
  return {
    id: r.id,
    code: r.code,
    costFactorId: r.costFactorId,
    costFactorCode: r.costFactor?.code ?? "",
    costFactorDisplayNameEn: r.costFactor?.displayNameEn ?? "",
    supplierOrgId: r.supplierOrgId ?? null,
    supplierOrgDisplayName: r.supplierOrg?.displayName ?? null,
    basis: r.basis,
    priceMinor: r.priceMinor.toString(),
    currency: r.currency,
    vatRatePct: r.vatRatePct.toString(),
    effectiveFrom: r.effectiveFrom.toISOString(),
    effectiveUntil: r.effectiveUntil?.toISOString() ?? null,
    notes: r.notes ?? null,
    createdAt: r.createdAt.toISOString(),
    status: rowStatus(r.effectiveFrom, r.effectiveUntil, now),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// List — grouped by code
// ─────────────────────────────────────────────────────────────────────────────

export async function listRateReferences(
  db: PrismaClient,
): Promise<RateReferenceCatalogueSummary> {
  const now = new Date();

  const rows = await db.rateReference.findMany({
    include: {
      costFactor: { select: { code: true, displayNameEn: true } },
      supplierOrg: { select: { displayName: true } },
    },
    orderBy: [{ code: "asc" }, { effectiveFrom: "desc" }],
  });

  if (rows.length === 0) {
    return {
      totalCodes: 0,
      currentCount: 0,
      stagedCount: 0,
      expiredCount: 0,
      groups: [],
    };
  }

  // Group by code
  const codeOrder: string[] = [];
  const groupMap = new Map<
    string,
    { current: RateReferenceRow | null; staged: RateReferenceRow[]; expired: RateReferenceRow[] }
  >();

  for (const r of rows) {
    const row = toRow(r, now);
    if (!groupMap.has(r.code)) {
      codeOrder.push(r.code);
      groupMap.set(r.code, { current: null, staged: [], expired: [] });
    }
    const g = groupMap.get(r.code)!;
    if (row.status === "current") {
      // There should be at most one current row per code (enforced at write).
      g.current = row;
    } else if (row.status === "staged") {
      g.staged.push(row);
    } else {
      g.expired.push(row);
    }
  }

  // Build output groups preserving code sort order
  const groups: RateReferenceCodeGroup[] = codeOrder.map((code) => {
    const g = groupMap.get(code)!;
    const representative = rows.find((r) => r.code === code);
    return {
      code,
      costFactorCode: representative?.costFactor?.code ?? "",
      costFactorDisplayNameEn: representative?.costFactor?.displayNameEn ?? "",
      current: g.current,
      staged: g.staged,
      expired: g.expired,
    };
  });

  const allRows = groups.flatMap((g) => [
    ...(g.current ? [g.current] : []),
    ...g.staged,
    ...g.expired,
  ]);

  return {
    totalCodes: groups.length,
    currentCount: allRows.filter((r) => r.status === "current").length,
    stagedCount: allRows.filter((r) => r.status === "staged").length,
    expiredCount: allRows.filter((r) => r.status === "expired").length,
    groups,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Get single row
// ─────────────────────────────────────────────────────────────────────────────

export async function getRateReference(
  db: PrismaClient,
  id: string,
): Promise<RateReferenceRow | null> {
  const r = await db.rateReference.findUnique({
    where: { id },
    include: {
      costFactor: { select: { code: true, displayNameEn: true } },
      supplierOrg: { select: { displayName: true } },
    },
  });
  if (!r) return null;
  return toRow(r, new Date());
}

// ─────────────────────────────────────────────────────────────────────────────
// Create — stage a new version
//
// If an existing row for the same code is currently active (status="current")
// and the new version's effectiveFrom is in the future, we auto-close the
// previous row's effectiveUntil to new effectiveFrom in the same transaction.
// This maintains the invariant that at most one row per code is current at
// any given time.
// ─────────────────────────────────────────────────────────────────────────────

export async function createRateReference(
  db: PrismaClient,
  input: CreateRateReferenceInput,
): Promise<RateReferenceRow> {
  const effectiveFrom = new Date(input.effectiveFrom);
  const effectiveUntil = input.effectiveUntil
    ? new Date(input.effectiveUntil)
    : null;

  if (effectiveUntil !== null && effectiveUntil <= effectiveFrom) {
    throw Object.assign(new Error("effectiveUntil must be after effectiveFrom"), {
      code: "validation_error",
    });
  }

  const priceMinor = BigInt(input.priceMinorStr);
  const now = new Date();

  const created = await db.$transaction(async (tx) => {
    // Find the currently-active row for this code (if any) to auto-close.
    const activeRow = await tx.rateReference.findFirst({
      where: {
        code: input.code,
        effectiveFrom: { lte: now },
        OR: [
          { effectiveUntil: null },
          { effectiveUntil: { gt: now } },
        ],
      },
    });

    if (activeRow) {
      // Auto-close the current row's effectiveUntil to the new version's
      // effectiveFrom, so there is no overlap. This only applies when the new
      // version starts in the future (staged). If effectiveFrom is in the past,
      // there would be an overlap — reject.
      if (effectiveFrom <= now) {
        throw Object.assign(
          new Error(
            "A currently-active row exists for this code. New version must have a future effectiveFrom so the current row can be auto-closed.",
          ),
          { code: "active_row_would_overlap" },
        );
      }
      // Set current row's effectiveUntil = new row's effectiveFrom.
      if (activeRow.effectiveUntil === null || activeRow.effectiveUntil > effectiveFrom) {
        await tx.rateReference.update({
          where: { id: activeRow.id },
          data: { effectiveUntil: effectiveFrom },
        });
      }
    }

    return tx.rateReference.create({
      data: {
        code: input.code,
        costFactorId: input.costFactorId,
        supplierOrgId: input.supplierOrgId ?? null,
        basis: input.basis as RateBasis,
        priceMinor,
        currency: input.currency,
        vatRatePct: input.vatRatePct,
        effectiveFrom,
        effectiveUntil,
        notes: input.notes ?? null,
      },
      include: {
        costFactor: { select: { code: true, displayNameEn: true } },
        supplierOrg: { select: { displayName: true } },
      },
    });
  });

  return toRow(created, now);
}

// ─────────────────────────────────────────────────────────────────────────────
// Patch — edit display/notes only; effectiveUntil allowed only on staged rows
//
// Rule 5 enforcement: price_minor, effective_from, basis, costFactorId,
// currency, vatRatePct are NOT patchable. The route rejects attempts.
//
// Returns "active_row_immutable" error if caller tries to patch a currently-
// active row's effectiveUntil (resolution field).
// ─────────────────────────────────────────────────────────────────────────────

export type PatchError =
  | { errorCode: "not_found" }
  | { errorCode: "active_row_immutable"; suggestion: "stage_new_version" }
  | { errorCode: "validation_error"; message: string };

export async function patchRateReference(
  db: PrismaClient,
  id: string,
  input: PatchRateReferenceInput,
): Promise<RateReferenceRow | PatchError> {
  const existing = await db.rateReference.findUnique({ where: { id } });
  if (!existing) return { errorCode: "not_found" };

  const now = new Date();
  const status = rowStatus(existing.effectiveFrom, existing.effectiveUntil, now);

  // effectiveUntil is a resolution field — cannot change on an active row.
  if (input.effectiveUntil !== undefined && status === "current") {
    return { errorCode: "active_row_immutable", suggestion: "stage_new_version" as const };
  }

  // Validate the new effectiveUntil if provided
  if (input.effectiveUntil !== undefined && input.effectiveUntil !== null) {
    const newUntil = new Date(input.effectiveUntil);
    if (newUntil <= existing.effectiveFrom) {
      return { errorCode: "validation_error", message: "effectiveUntil must be after effectiveFrom" };
    }
  }

  const updated = await db.rateReference.update({
    where: { id },
    data: {
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      ...(input.supplierOrgId !== undefined ? { supplierOrgId: input.supplierOrgId } : {}),
      ...(input.effectiveUntil !== undefined
        ? { effectiveUntil: input.effectiveUntil ? new Date(input.effectiveUntil) : null }
        : {}),
    },
    include: {
      costFactor: { select: { code: true, displayNameEn: true } },
      supplierOrg: { select: { displayName: true } },
    },
  });

  return toRow(updated, now);
}

// ─────────────────────────────────────────────────────────────────────────────
// Retire — set effectiveUntil = now() on a currently-active row.
//
// WARNING: This creates a gap — the next session for this code's factor has
// no rate to resolve. The caller's response includes a warning about this.
// ─────────────────────────────────────────────────────────────────────────────

export type RetireError =
  | { errorCode: "not_found" }
  | { errorCode: "not_active"; rowStatus: "staged" | "expired" };

export async function retireRateReference(
  db: PrismaClient,
  id: string,
): Promise<RateReferenceRow | RetireError> {
  const existing = await db.rateReference.findUnique({ where: { id } });
  if (!existing) return { errorCode: "not_found" };

  const now = new Date();
  const status = rowStatus(existing.effectiveFrom, existing.effectiveUntil, now);

  if (status !== "current") {
    return { errorCode: "not_active", rowStatus: status };
  }

  const updated = await db.rateReference.update({
    where: { id },
    data: { effectiveUntil: now },
    include: {
      costFactor: { select: { code: true, displayNameEn: true } },
      supplierOrg: { select: { displayName: true } },
    },
  });

  return toRow(updated, now);
}
