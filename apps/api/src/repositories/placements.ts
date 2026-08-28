// The Drizzle-backed `PlacementsPort` — ADR 0054 items 10 and 13.
//
// ── WRITTEN, AND NEVER EXECUTED ─────────────────────────────────────────
//
// `assets.placements` is created by migration 0005, which has not been applied
// to any database. Every statement below is typed against the real table and
// has never run. The decisions are proven against `makeFixturePlacements`,
// which runs the same `checkAttach`, the same `classifyAttachConflict` and the
// same period builders in the same order.
//
// The one thing this file must therefore get right is the SHAPE.

import { and, eq, inArray, sql } from "drizzle-orm";
import { placements } from "@straumvakt/shared/db/assets";
import { mutationReceipts } from "@straumvakt/shared/db/commercial";
import { toRangeLiteral, type Tstzrange } from "@straumvakt/shared/domain/effective-dating";
import type { Db } from "../lib/drizzle";
import {
  attachPeriod,
  checkAttach,
  classifyAttachConflict,
  detachPeriod,
  isOverlapError,
  type AttachInput,
  type AttachOutcome,
  type DetachInput,
  type DetachOutcome,
  type PlacementAccess,
  type PlacementRecord,
  type PlacementsPort,
} from "./placements-port";

const RECEIPT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Drizzle's customType does no parsing, so the range is read here — once. */
function toRecord(r: typeof placements.$inferSelect): PlacementRecord {
  return {
    id: r.id,
    publicId: r.publicId,
    deviceId: r.deviceId,
    orgId: r.orgId,
    installationId: r.installationId,
    siteId: r.siteId,
    circuitId: r.circuitId,
    period: parseRange(r.period),
    detachReason: r.detachReason,
  };
}

/**
 * `["2026-01-15 00:00:00+00",)` -> `{ from, until }`.
 *
 * Postgres writes a SPACE separator and a TWO-DIGIT offset, and JavaScript's
 * `Date` rejects the latter — `new Date("2026-01-15T00:00:00+00")` is
 * `Invalid Date`, because ECMA-262 wants four digits or a `Z`. A parser
 * written against ISO-8601 fixtures passes every test and reads nothing at all
 * from the database; this one is written against what Postgres actually emits.
 * Same function as `membershipCoversInstant`'s parser, and the duplication is
 * deliberate — these two files have no other reason to depend on each other.
 */
function parseRange(raw: string): Tstzrange {
  const m = /^\[([^,]*),([^)\]]*)[)\]]$/.exec(raw.trim());
  if (!m) throw new Error(`unparseable_tstzrange:${raw}`);
  const lower = pgTimestamp(m[1]!);
  if (!lower) throw new Error(`placement_period_has_no_start:${raw}`);
  return { from: lower, until: pgTimestamp(m[2]!) };
}

function pgTimestamp(raw: string): Date | null {
  const s = raw.replace(/^"|"$/g, "").trim();
  if (s === "") return null;
  const iso = s
    .replace(" ", "T")
    .replace(/([+-])(\d{2})$/, "$1$2:00")
    .replace(/([+-])(\d{2})(\d{2})$/, "$1$2:$3");
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

const range = (r: Tstzrange) => sql`${toRangeLiteral(r)}::tstzrange`;

export function makeDrizzlePlacements(
  db: Db,
  access: PlacementAccess = { restrictToOrgIds: null },
): PlacementsPort {
  const orgFilter = (col: typeof placements.orgId) =>
    access.restrictToOrgIds === null ? undefined : inArray(col, access.restrictToOrgIds);

  async function rowsFor(deviceId: string): Promise<PlacementRecord[]> {
    const rows = await db
      .select()
      .from(placements)
      .where(and(eq(placements.deviceId, deviceId), orgFilter(placements.orgId)));
    return rows.map(toRecord).sort((a, b) => a.period.from.getTime() - b.period.from.getTime());
  }

  /** Look up a receipt, or record one. Round 1's mechanism, unchanged. */
  async function replayed(orgId: string, scope: string, key: string): Promise<unknown | null> {
    const [row] = await db
      .select({ body: mutationReceipts.responseBody })
      .from(mutationReceipts)
      .where(
        and(
          eq(mutationReceipts.orgId, orgId),
          eq(mutationReceipts.scope, scope),
          eq(mutationReceipts.idempotencyKey, key),
        ),
      )
      .limit(1);
    return row?.body ?? null;
  }

  async function recordReceipt(orgId: string, scope: string, key: string, body: unknown, actorUserId: string | null) {
    await db
      .insert(mutationReceipts)
      .values({
        orgId,
        scope,
        idempotencyKey: key,
        // The request hash is the key's twin: a key reused with different
        // inputs is a caller bug, and the receipt is where that is caught.
        requestHash: JSON.stringify(body ?? null).slice(0, 200),
        responseStatus: 200,
        responseBody: body as object,
        actorUserId,
        expiresAt: new Date(Date.now() + RECEIPT_TTL_MS),
      })
      // The unique index (org_id, scope, idempotency_key) is the mechanism. A
      // concurrent retry collides here rather than double-executing.
      .onConflictDoNothing();
  }

  return {
    async attachDevice(input: AttachInput): Promise<AttachOutcome> {
      const check = checkAttach(input, access);
      if (!check.ok) return { kind: "refused", reason: check.reason };

      const prior = await replayed(input.orgId, "placement.attach", input.idempotencyKey);
      if (prior) return { kind: "replayed", placement: prior as PlacementRecord };

      const existing = await rowsFor(input.deviceId);
      const open = existing.find((r) => r.period.until === null);
      if (open && open.installationId === input.installationId && open.orgId === input.orgId) {
        return { kind: "already_placed", placement: open };
      }

      const period = attachPeriod(input.at);
      const conflict = classifyAttachConflict(existing, {
        deviceId: input.deviceId,
        installationId: input.installationId,
        period,
      });
      if (conflict.kind === "conflict") {
        return { kind: "refused", reason: conflict.reason, conflictsWith: conflict.conflictsWith };
      }

      try {
        const [row] = await db
          .insert(placements)
          .values({
            deviceId: input.deviceId,
            orgId: input.orgId,
            installationId: input.installationId,
            siteId: input.siteId ?? null,
            circuitId: input.circuitId ?? null,
            period: toRangeLiteral(period),
            attachedByUserId: input.actorUserId,
          })
          .returning();
        const placement = toRecord(row!);
        await recordReceipt(input.orgId, "placement.attach", input.idempotencyKey, placement, input.actorUserId);
        return { kind: "attached", placement };
      } catch (err) {
        // THE PRE-CHECK LOSES EVERY RACE, AND THE CONSTRAINT DOES NOT. A
        // concurrent attach can land between the SELECT above and this INSERT;
        // the exclusion constraint refuses it, and it is refused here under
        // the SAME NAME the pre-check would have used. Both SQLSTATEs are
        // handled — see `isOverlapError` — so switching constraint forms is a
        // migration, not a code change.
        if (isOverlapError(err)) {
          return { kind: "refused", reason: "device_already_placed_elsewhere" };
        }
        throw err;
      }
    },

    async detachDevice(input: DetachInput): Promise<DetachOutcome> {
      if (typeof input.idempotencyKey !== "string" || input.idempotencyKey.trim() === "") {
        return { kind: "refused", reason: "idempotency_key_required" };
      }
      if (access.restrictToOrgIds !== null && !access.restrictToOrgIds.includes(input.orgId)) {
        return { kind: "refused", reason: "org_not_in_scope" };
      }

      const prior = await replayed(input.orgId, "placement.detach", input.idempotencyKey);
      if (prior) return { kind: "replayed", placement: prior as PlacementRecord };

      const open = (await rowsFor(input.deviceId)).find((r) => r.period.until === null);
      if (!open || open.orgId !== input.orgId) return { kind: "not_placed" };
      if (input.at.getTime() <= open.period.from.getTime()) {
        return { kind: "refused", reason: "detach_at_or_before_attach", placement: open };
      }

      // ITEM 13 — CLOSE, never DELETE. OCPI requires `status: REMOVED` rather
      // than removal, and a deleted row takes the session history's context
      // with it. This is an UPDATE of the period's upper bound and nothing
      // else; the row, its public id and its org all stay.
      //
      // Bounded to rows still OPEN (`upper_inf`), so a concurrent second
      // detach cannot move an end date that is already set.
      const closedPeriod = detachPeriod(open.period.from, input.at);
      const [row] = await db
        .update(placements)
        .set({
          period: toRangeLiteral(closedPeriod),
          detachedByUserId: input.actorUserId,
          detachReason: input.reason,
        })
        .where(
          and(
            eq(placements.id, open.id),
            sql`upper_inf(${placements.period})`,
            orgFilter(placements.orgId),
          ),
        )
        .returning();
      if (!row) return { kind: "not_placed" };
      const placement = toRecord(row);
      await recordReceipt(input.orgId, "placement.detach", input.idempotencyKey, placement, input.actorUserId);
      return { kind: "detached", placement };
    },

    async moveDevice(input) {
      if (typeof input.idempotencyKey !== "string" || input.idempotencyKey.trim() === "") {
        return { kind: "refused", reason: "idempotency_key_required" };
      }
      for (const org of [input.fromOrgId, input.toOrgId]) {
        if (access.restrictToOrgIds !== null && !access.restrictToOrgIds.includes(org)) {
          return { kind: "refused", reason: "org_not_in_scope" };
        }
      }
      const prior = await replayed(input.fromOrgId, "placement.move", input.idempotencyKey);
      if (prior) {
        const p = prior as { closed: PlacementRecord; opened: PlacementRecord };
        return { kind: "replayed", closed: p.closed, opened: p.opened };
      }

      // ── ONE TRANSACTION ───────────────────────────────────────────────
      //
      // The close and the open must not be two round trips a caller could be
      // interrupted between. The state in between — a device placed nowhere —
      // is one a billing run can observe, and it under-bills the new host for
      // the gap. Inside a transaction it never exists.
      //
      // The two intervals TOUCH: `[x, at)` and `[at, )`. That is why the
      // interval is half-open; under a closed upper bound the constraint would
      // refuse every move.
      try {
        return await db.transaction(async (tx) => {
          const [openRow] = await tx
            .select()
            .from(placements)
            .where(
              and(
                eq(placements.deviceId, input.deviceId),
                sql`upper_inf(${placements.period})`,
                orgFilter(placements.orgId),
              ),
            )
            // FOR UPDATE: two concurrent moves of one device must serialise
            // here rather than both closing the same placement.
            .for("update")
            .limit(1);
          if (!openRow) return { kind: "refused" as const, reason: "device_not_placed" };
          const open = toRecord(openRow);
          if (open.orgId !== input.fromOrgId) {
            return { kind: "refused" as const, reason: "device_placed_under_another_org" };
          }
          if (input.at.getTime() <= open.period.from.getTime()) {
            return { kind: "refused" as const, reason: "move_at_or_before_attach", conflictsWith: open };
          }

          const [closedRow] = await tx
            .update(placements)
            .set({
              period: toRangeLiteral(detachPeriod(open.period.from, input.at)),
              detachedByUserId: input.actorUserId,
              detachReason: input.reason,
            })
            .where(eq(placements.id, open.id))
            .returning();

          const [openedRow] = await tx
            .insert(placements)
            .values({
              deviceId: input.deviceId,
              orgId: input.toOrgId,
              installationId: input.toInstallationId,
              siteId: input.toSiteId ?? null,
              circuitId: input.toCircuitId ?? null,
              period: toRangeLiteral(attachPeriod(input.at)),
              attachedByUserId: input.actorUserId,
            })
            .returning();

          const result = { closed: toRecord(closedRow!), opened: toRecord(openedRow!) };
          await recordReceipt(input.fromOrgId, "placement.move", input.idempotencyKey, result, input.actorUserId);
          return { kind: "moved" as const, ...result };
        });
      } catch (err) {
        // A move that would overlap — the skipped-detach case reached from the
        // other side — is refused rather than surfaced as a 500. The
        // transaction has already rolled back, so the old placement is still
        // OPEN: a partial move is the one outcome worse than a refused one.
        if (isOverlapError(err)) {
          return { kind: "refused", reason: "period_overlaps_existing_placement" };
        }
        throw err;
      }
    },

    async historyFor(deviceId) {
      // Open AND closed, oldest first. Item 13: the history is the point.
      return rowsFor(deviceId);
    },
  };
}
