// The operator-facing billing surface.
//
// Mounted at `/api/admin/orgs/:orgId/billing`, so `orgIdParam: "orgId"` is a
// real path parameter on every gate — no allowlist entry needed, which is the
// point. `check:orgid-param` exists because `requirePermission` without
// `orgIdParam` resolves orgId to null and SKIPS the membership lookup, making
// the gate simultaneously unreachable for org members and tenant-wide for
// platform grants. These routes never do that.
//
// ── EVERY HANDLER GOES THROUGH THE PORT ─────────────────────────────────
//
// No Drizzle, no Prisma, no SQL in this file. `BillingOperationsPort` is the
// only way out. The tests drive a fixture adapter; the Drizzle adapter is
// written and never executed, because neither 0002 nor 0003 has been applied.
//
// ── EVERY MUTATION CARRIES AN IDEMPOTENCY KEY ───────────────────────────
//
// From the `Idempotency-Key` header, checked against `billing.mutation_receipts`
// which 0002 created with `(org_id, scope, idempotency_key)` unique. A missing
// key is a 400 refusal, never a generated one — a generated key makes every
// retry a fresh operation, which is an idempotency mechanism that guarantees
// the thing it was added to prevent.
//
// A key reused with a DIFFERENT request body is a 409, not a replay: two
// different requests under one key is a caller bug, and answering the second
// with the first one's result would hide it.

import { Hono, type Context, type MiddlewareHandler } from "hono";
import { requireAdmin, type AuthVars } from "../../../lib/auth-middleware";
import { requirePermission as realRequirePermission } from "../../../lib/auth/require-permission";

import { resolveOrgScope } from "../../../lib/auth/org-scope";
import {
  BillingRequestError,
  assertOrgInScope,
  requestHashOf,
  requireIdempotencyKeyHeader,
  type BillingAccess,
  type BillingOperationsPort,
} from "../../../lib/billing/operations-port";
import type { BillingPeriodRef } from "@straumvakt/commercial";
import { makeDrizzleOperationsPort } from "../../../lib/billing/drizzle-operations-port";
import type { Env } from "../../../bindings";

type BillingCtx = Context<{ Bindings: Env; Variables: AuthVars }>;

/**
 * The port factory is injected rather than imported.
 *
 * That is what lets the route tests run with a fixture adapter and no
 * database, and it is the same shape the dry run uses. `index.ts` supplies the
 * Drizzle-backed one when the app is assembled.
 */
export interface BillingRouterDeps {
  makePort: (c: BillingCtx, access: BillingAccess) => BillingOperationsPort;
  /** Injected so tests are deterministic and the handler reads no clock. */
  now: () => Date;
  /**
   * The session gate. Defaults to the real one.
   *
   * Injectable for the same reason the port is: the first-invoice dry run
   * drives these handlers with no database AND no session infrastructure, and
   * a route that can only be exercised behind a live auth stack is a route
   * nobody exercises. Production passes nothing and gets `requireAdmin`.
   */
  requireAuth?: MiddlewareHandler;
  /**
   * How the caller's tenant scope is resolved. Defaults to the real one.
   *
   * Same reason as `requireAuth`: `resolveOrgScope` opens a Drizzle client,
   * and the dry run has no database. The DECISION it feeds — which orgs this
   * caller may touch — is what the tenancy assertions actually depend on, and
   * that stays identical either way.
   */
  resolveAccess?: (c: BillingCtx) => Promise<BillingAccess>;
  /**
   * The permission gate factory. Defaults to the real one.
   *
   * Third and last injection point, and for the same reason as the other two:
   * `requirePermission` opens a Drizzle client to resolve effective
   * permissions. What it GATES is unchanged — every route still names
   * `billing.read` or `billing.write` with a real `orgIdParam`, which is what
   * check:orgid-param verifies by reading this source.
   */
  requirePerm?: typeof realRequirePermission;
}

async function defaultAccessFor(c: BillingCtx): Promise<BillingAccess> {
  const scope = await resolveOrgScope(c.env, c.get("session"));
  return { restrictToOrgIds: scope.all ? null : scope.orgIds };
}

function periodFrom(c: BillingCtx): BillingPeriodRef {
  const orgId = c.req.param("orgId");
  const year = Number(c.req.param("year"));
  const month = Number(c.req.param("month"));
  if (!orgId || !Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new BillingRequestError("not_found", 400, "period must be /:year/:month with month 1-12");
  }
  return { orgId, year, month };
}

function actorOf(c: BillingCtx): string {
  const session = c.get("session") as { sub?: string; userId?: string } | undefined;
  const actor = session?.userId ?? session?.sub;
  if (!actor) {
    // Every transition is recorded with an actor, NOT NULL. A transition
    // nobody caused is a transition nobody can answer for.
    throw new BillingRequestError("not_found", 401, "no actor on session");
  }
  return actor;
}

/**
 * Run a mutating handler under receipt protection.
 *
 * The shape matters: the receipt is looked up BEFORE the effect and recorded
 * AFTER it, so a replay returns the stored answer without re-executing, and a
 * key reused with a different body is refused before anything happens.
 */
async function withReceipt<T>(
  c: BillingCtx,
  port: BillingOperationsPort,
  scope: string,
  orgId: string,
  body: unknown,
  run: () => Promise<{ status: number; payload: T }>,
): Promise<Response> {
  const key = requireIdempotencyKeyHeader(c.req.header("Idempotency-Key"));
  const hash = requestHashOf(body);

  const found = await port.lookupReceipt(orgId, scope, key, hash);
  if (found.kind === "key_reused_with_different_request") {
    throw new BillingRequestError("idempotency_key_reused_with_different_request", 409);
  }
  if (found.kind === "replay") {
    // Same key, same request: the stored answer, and the effect is NOT
    // repeated. `replayed` is on the wire so a caller can tell.
    return c.json({ ...(found.receipt.responseBody as object), replayed: true }, 200);
  }

  const { status, payload } = await run();
  await port.recordReceipt({
    orgId,
    scope,
    idempotencyKey: key,
    requestHash: hash,
    responseStatus: status,
    responseBody: payload,
  });
  return c.json(payload as object, status as 200);
}

export function makeBillingPeriodsRouter(deps: BillingRouterDeps) {
  // NAMED FOR THE SURFACE DOC, deliberately. scripts/gen-api-endpoints.mjs
  // resolves a mount by matching `<mountedIdentifier>.post("path")` textually
  // in the module it was imported from. A router built inside a factory and
  // assigned to a differently-named local is invisible to it — and an endpoint
  // the surface doc cannot see is one that can change without a diff, which is
  // the entire reason that gate exists. So the local carries the same name as
  // the exported instance at the bottom of this file.
  const accessFor = deps.resolveAccess ?? defaultAccessFor;
  // SHADOWS THE IMPORT ON PURPOSE, and the name is load-bearing twice over:
  // scripts/check-orgid-param.mjs finds every per-tenant gate by matching
  // `requirePermission("verb", { orgIdParam: ... })` textually. Calling the
  // injected factory `perm` would make all nine gates in this file INVISIBLE
  // to that checker — no false pass, but no coverage either, which is worse
  // than an allowlist entry because nothing records the gap.
  const requirePermission = deps.requirePerm ?? realRequirePermission;
  const adminBillingPeriods = new Hono<{ Bindings: Env; Variables: AuthVars }>();
  adminBillingPeriods.use("*", deps.requireAuth ?? requireAdmin);

  // Every refusal leaves as a named code, never a bare status.
  adminBillingPeriods.onError((err, c) => {
    if (err instanceof BillingRequestError) {
      return c.json({ error: err.refusal, message: err.message }, err.status as 400);
    }
    throw err;
  });

  // ── open a period ───────────────────────────────────────────────────
  adminBillingPeriods.post(
    "/:orgId/billing/periods/:year/:month/open",
    requirePermission("billing.write", { orgIdParam: "orgId" }),
    async (c) => {
      const access = await accessFor(c);
      const period = periodFrom(c);
      assertOrgInScope(period.orgId, access);
      const port = deps.makePort(c, access);

      return withReceipt(c, port, "period.open", period.orgId, { period }, async () => {
        const out = await port.applyPeriodEvent({
          period,
          event: "open_period",
          actorUserId: actorOf(c),
          asOf: deps.now(),
        });
        if (out.kind === "refused") {
          // "the month has not ended" and "this period is closed" are
          // different facts and reach the operator as different codes.
          throw new BillingRequestError(
            out.reason === "period_closed" ? "period_closed" : "period_not_open",
            409,
            out.reason,
          );
        }
        return { status: 200, payload: { period, outcome: out } };
      });
    },
  );

  // ── record activity ─────────────────────────────────────────────────
  adminBillingPeriods.post(
    "/:orgId/billing/periods/:year/:month/activity",
    requirePermission("billing.write", { orgIdParam: "orgId" }),
    async (c) => {
      const access = await accessFor(c);
      const period = periodFrom(c);
      assertOrgInScope(period.orgId, access);
      const port = deps.makePort(c, access);

      return withReceipt(c, port, "period.activity", period.orgId, { period }, async () => {
        const state = await port.periodState(period);
        if (state === "closed") throw new BillingRequestError("period_closed", 409);
        if (state !== "open") {
          // Writing activity into a sealed period would change a count that
          // has already been used to price.
          throw new BillingRequestError("period_not_open", 409, `period is ${state}`);
        }
        const counts = await port.recordActivity(period);
        const sealed = await port.applyPeriodEvent({
          period,
          event: "seal_activity",
          actorUserId: actorOf(c),
          asOf: deps.now(),
        });
        return { status: 200, payload: { period, counts, sealed } };
      });
    },
  );

  // ── assert a connector ──────────────────────────────────────────────
  adminBillingPeriods.post(
    "/:orgId/billing/periods/:year/:month/assertions",
    requirePermission("billing.write", { orgIdParam: "orgId" }),
    async (c) => {
      const access = await accessFor(c);
      const period = periodFrom(c);
      assertOrgInScope(period.orgId, access);
      const port = deps.makePort(c, access);
      const body = (await c.req.json().catch(() => ({}))) as {
        connectorId?: string;
        reason?: string;
        evidenceNote?: string;
      };

      if (!body.connectorId?.trim() || !body.reason?.trim()) {
        // An unattributed or unexplained assertion is an unauditable one.
        throw new BillingRequestError("not_found", 400, "connectorId and reason are required");
      }

      return withReceipt(c, port, "period.assert", period.orgId, body, async () => {
        const state = await port.periodState(period);
        if (state === "closed") throw new BillingRequestError("period_closed", 409);
        const out = await port.assertConnector({
          period,
          connectorId: body.connectorId!,
          actorUserId: actorOf(c),
          reason: body.reason!,
          evidenceNote: body.evidenceNote ?? null,
          assertedAt: deps.now(),
        });
        if (out.kind === "refused") {
          throw new BillingRequestError("org_not_in_scope", 409, out.reason);
        }
        return { status: 200, payload: { period, connectorId: body.connectorId, asserted: true } };
      });
    },
  );

  // ── price the period ────────────────────────────────────────────────
  adminBillingPeriods.post(
    "/:orgId/billing/periods/:year/:month/price",
    requirePermission("billing.write", { orgIdParam: "orgId" }),
    async (c) => {
      const access = await accessFor(c);
      const period = periodFrom(c);
      assertOrgInScope(period.orgId, access);
      const port = deps.makePort(c, access);

      return withReceipt<Record<string, unknown>>(c, port, "period.price", period.orgId, { period }, async () => {
        const state = await port.periodState(period);
        if (state === "closed") throw new BillingRequestError("period_closed", 409);

        const result = await port.price(period);
        if (result.kind === "held") {
          // NEVER a partial invoice. The holds are the answer, each with its
          // named reason, and the period stays where it is so a later run can
          // succeed once the reason is resolved.
          return {
            status: 409,
            payload: {
              error: "count_unavailable",
              period,
              holds: result.holds,
              excludedSessionIds: result.excludedSessionIds,
            },
          };
        }

        await port.applyPeriodEvent({
          period,
          event: "record_pricing_settled",
          actorUserId: actorOf(c),
          asOf: deps.now(),
        });
        return {
          status: 200,
          payload: {
            period,
            totalIsk: result.statement.totalIsk.toString(),
            currency: result.statement.currency,
            activeConnectors: result.statement.activeConnectors,
            activeDrivers: result.statement.activeDrivers,
            capApplied: result.statement.capApplied,
            lines: result.statement.lines.length,
          },
        };
      });
    },
  );

  // ── issue the invoice ───────────────────────────────────────────────
  adminBillingPeriods.post(
    "/:orgId/billing/periods/:year/:month/issue",
    requirePermission("billing.write", { orgIdParam: "orgId" }),
    async (c) => {
      const access = await accessFor(c);
      const period = periodFrom(c);
      assertOrgInScope(period.orgId, access);
      const port = deps.makePort(c, access);
      const key = requireIdempotencyKeyHeader(c.req.header("Idempotency-Key"));

      return withReceipt(c, port, "period.issue", period.orgId, { period }, async () => {
        const state = await port.periodState(period);
        if (state === "closed") throw new BillingRequestError("period_closed", 409);
        if (state !== "priced") {
          throw new BillingRequestError("period_not_priced", 409, `period is ${state}`);
        }
        // The allocation is transactional with the issue INSIDE the port —
        // a number allocated without a document is a hole in a sequence that
        // Icelandic law requires to be unbroken, and there is no release.
        const out = await port.issueDocument({ period, idempotencyKey: key, actorUserId: actorOf(c) });
        if (out.kind === "refused") {
          throw new BillingRequestError("period_not_priced", 409, out.reason);
        }
        await port.applyPeriodEvent({
          period,
          event: "issue_invoice",
          actorUserId: actorOf(c),
          asOf: deps.now(),
        });
        return {
          status: 200,
          payload: {
            period,
            documentNumber: out.document.documentNumber,
            deliveryState: out.document.deliveryState,
          },
        };
      });
    },
  );

  // ── close the period ────────────────────────────────────────────────
  adminBillingPeriods.post(
    "/:orgId/billing/periods/:year/:month/close",
    requirePermission("billing.write", { orgIdParam: "orgId" }),
    async (c) => {
      const access = await accessFor(c);
      const period = periodFrom(c);
      assertOrgInScope(period.orgId, access);
      const port = deps.makePort(c, access);

      return withReceipt(c, port, "period.close", period.orgId, { period }, async () => {
        const out = await port.applyPeriodEvent({
          period,
          event: "close_period",
          actorUserId: actorOf(c),
          asOf: deps.now(),
        });
        if (out.kind === "refused") {
          throw new BillingRequestError("period_closed", 409, out.reason);
        }
        return { status: 200, payload: { period, outcome: out } };
      });
    },
  );

  // ── reads ───────────────────────────────────────────────────────────

  adminBillingPeriods.get(
    "/:orgId/billing/periods/:year/:month",
    requirePermission("billing.read", { orgIdParam: "orgId" }),
    async (c) => {
      const access = await accessFor(c);
      const period = periodFrom(c);
      assertOrgInScope(period.orgId, access);
      const port = deps.makePort(c, access);
      return c.json({ period, state: await port.periodState(period) });
    },
  );

  adminBillingPeriods.get(
    "/:orgId/billing/statements",
    requirePermission("billing.read", { orgIdParam: "orgId" }),
    async (c) => {
      const access = await accessFor(c);
      const orgId = c.req.param("orgId")!;
      assertOrgInScope(orgId, access);
      const port = deps.makePort(c, access);
      return c.json({ orgId, statements: await port.listStatements(orgId) });
    },
  );

  adminBillingPeriods.get(
    "/:orgId/billing/periods/:year/:month/document",
    requirePermission("billing.read", { orgIdParam: "orgId" }),
    async (c) => {
      const access = await accessFor(c);
      const period = periodFrom(c);
      assertOrgInScope(period.orgId, access);
      const port = deps.makePort(c, access);
      const doc = await port.fetchDocument(period);
      if (!doc) throw new BillingRequestError("not_found", 404);
      return c.json({ period, document: doc });
    },
  );

  return adminBillingPeriods;
}

/**
 * The wired router the app mounts.
 *
 * A module-level instance, exported as a bare identifier, because that is the
 * shape every other route module uses and the shape
 * `scripts/gen-api-endpoints.mjs` can resolve — it maps `app.route(prefix,
 * name)` to `name`'s import, and a call expression at the mount site is
 * invisible to it. An endpoint the surface doc cannot see is an endpoint that
 * can change without a diff, which is the whole reason that gate exists.
 *
 * The factory above stays exported so the tests can inject a fixture port.
 */
export const adminBillingPeriods = makeBillingPeriodsRouter({
  makePort: (c, access) => makeDrizzleOperationsPort(c.env, access),
  now: () => new Date(),
});
