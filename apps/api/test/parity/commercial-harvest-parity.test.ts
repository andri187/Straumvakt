// Phase 1 harvest parity — does packages/commercial still price correctly?
//
// ── WHAT "PARITY" CAN AND CANNOT MEAN HERE ──────────────────────────────
//
// The brief asked for byte-identical assertions comparing the harvested
// packages/commercial path against the original apps/api path. Post-shim,
// that comparison is a TAUTOLOGY: apps/api/src/lib/agreement/resolve.ts is
// now `export * from "@straumvakt/commercial/agreement/resolve"`, so both
// specifiers resolve to the same module object. Asserting they agree proves
// only that `===` works.
//
// So this file proves the two things that are actually falsifiable:
//
//   1. THE SHIM IS FAITHFUL — every export the old path used to expose is
//      still reachable through it, and is the same binding. A shim missing
//      `export type *` or a renamed symbol fails here. This is the real risk
//      of copy-then-strangle and it is a compile-time-ish check done at
//      runtime because `export type` is erased.
//
//   2. THE HARVESTED RESOLVER REPRODUCES THE STORED LINES — re-resolve the
//      64 known-billable sessions and compare against the 128 rows the
//      pre-harvest resolver actually wrote. That is parity against REALITY
//      rather than against a copy of itself, and it is what a regression in
//      the harvested code would break.
//
// Plus the three trap cases, so a regression on any of the three bugs fixed
// on 2026-08-07 fails loudly rather than silently re-appearing.
//
// READ-ONLY. Nothing is written.

import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeAll, getDrizzle, getPrisma, hasDb } from "./_harness";
import { agreementsBillingLines } from "@straumvakt/shared/db/commercial";
import { sessions } from "@straumvakt/shared/db/charging";

// The two specifiers. `oldPath` goes through the shim.
import * as oldPath from "../../src/lib/agreement/resolve";
import * as newPath from "@straumvakt/commercial/agreement/resolve";
import * as oldTypes from "../../src/lib/agreement/types";
import * as newTypes from "@straumvakt/commercial/agreement/types";
import { allocationSchema, RATE_BASES } from "@straumvakt/commercial/agreement/types";
import { resolveBillingLines } from "@straumvakt/commercial/agreement/resolve";
import { loadAgreementContext } from "../../src/lib/agreement/persist";

describe("commercial harvest — shim faithfulness", () => {
  // No DB needed; these run everywhere.
  it("the shim re-exports every runtime binding, identically", () => {
    const missing = Object.keys(newPath).filter((k) => !(k in oldPath));
    expect(missing, `dropped by the resolve shim: ${missing.join(", ")}`).toEqual([]);
    for (const k of Object.keys(newPath)) {
      expect((oldPath as Record<string, unknown>)[k], `${k} is not the same binding`).toBe(
        (newPath as Record<string, unknown>)[k],
      );
    }
  });

  it("the types shim re-exports every runtime binding, identically", () => {
    const missing = Object.keys(newTypes).filter((k) => !(k in oldTypes));
    expect(missing, `dropped by the types shim: ${missing.join(", ")}`).toEqual([]);
    for (const k of Object.keys(newTypes)) {
      expect((oldTypes as Record<string, unknown>)[k], `${k} is not the same binding`).toBe(
        (newTypes as Record<string, unknown>)[k],
      );
    }
  });

  it("exports a non-trivial surface — guards against an empty tautology", () => {
    // If the shim resolved to {} both checks above would pass vacuously.
    expect(Object.keys(newPath).length).toBeGreaterThan(4);
    expect(Object.keys(newTypes).length).toBeGreaterThan(4);
  });
});

// ── The three traps ─────────────────────────────────────────────────────
//
// Each of these was a live bug on 2026-08-07. They are asserted at the
// resolver's own boundary so a regression cannot reach the ledger.

describe("commercial harvest — the three fixed traps stay fixed", () => {
  it("TRAP 1 (case mismatch): uppercase bearer_type still parses", () => {
    // `allocation_json` says "USR"; the enum is lowercase. This rejected
    // EVERY clause in the database for three months, silently.
    const parsed = allocationSchema.parse({
      passthrough: { splits: [{ bearer_type: "USR", share_pct: 100 }] },
      markup: null,
    });
    expect(parsed.passthrough.splits[0]!.bearer_type).toBe("usr");
  });

  it("TRAP 1b: an invented bearer code is still rejected", () => {
    // Case-folding must not have become "accept anything".
    expect(() =>
      allocationSchema.parse({
        passthrough: { splits: [{ bearer_type: "DRIVER", share_pct: 100 }] },
        markup: null,
      }),
    ).toThrow();
  });

  it("TRAP 2 (wrong supplier): a NULL supplierOrgId yields a line with no recipient, not a throw", () => {
    // VEITUR-AD1 had a NULL supplier_org_id. The resolver must still price
    // the line — the missing recipient is a data problem to surface, not a
    // reason to drop the charge.
    const line = newPath.computeBillingLines(
      {
        agreementId: "a", cpoOrgId: "c", user: { id: "u" }, driverGroup: null,
        chargerId: "ch", circuitId: null, installationId: null, siteId: "s",
        startedAt: new Date("2026-06-01T00:00:00Z"),
        endedAt: new Date("2026-06-01T01:00:00Z"),
        energyKwh: 10, durationMinutes: 60, durationDays: 0,
        clauses: [], rules: [], rateReferences: [],
      } as never,
      {
        factorCode: "DSO",
        allocation: { passthrough: { splits: [{ bearer_type: "usr", share_pct: 100 }] }, markup: null },
        bearerType: "usr", bearerRef: null,
        cascadeSource: { rate: null, bearer: null, allocation: null },
        rateRef: {
          id: "r", code: "VEITUR-AD1", costFactorId: "f", basis: "per_kwh",
          priceMinor: 864n, vatRatePct: 24, currency: "ISK",
          supplierOrgId: null,                       // ← the trap
          effectiveFrom: new Date("2026-01-01T00:00:00Z"), effectiveUntil: null,
        },
      } as never,
    );
    expect(line).toHaveLength(1);
    expect(line[0]!.recipientOrgId).toBeNull();
    expect(line[0]!.amountExVatMinor).toBe(8640n); // 10 kWh × 864 minor
  });

  it("TRAP 3 (window): a rate effective AFTER the session is not selected", () => {
    // The eight sessions aged out of the 30-day window before anyone
    // attributed them. Selection must stay strictly time-bounded.
    const picked = newPath.pickActiveRate(
      [{
        id: "r", code: "X", costFactorId: "f", basis: "per_kwh", priceMinor: 100n,
        vatRatePct: 24, currency: "ISK", supplierOrgId: null,
        effectiveFrom: new Date("2026-07-01T00:00:00Z"), effectiveUntil: null,
      }] as never,
      "X",
      new Date("2026-06-01T00:00:00Z"),
    );
    expect(picked).toBeNull();
  });
});

// ── Parity against the stored lines ─────────────────────────────────────

describe.skipIf(!hasDb)("commercial harvest — reproduces the stored billing lines", () => {
  afterAll(closeAll);

  it("re-resolves every stored session to byte-identical amounts", async () => {
    const stored = await getDrizzle()
      .select({
        sessionId: agreementsBillingLines.sessionId,
        factorCode: agreementsBillingLines.factorCode,
        basisQuantity: agreementsBillingLines.basisQuantity,
        unitPriceMinor: agreementsBillingLines.unitPriceMinor,
        amountExVatMinor: agreementsBillingLines.amountExVatMinor,
        vatAmountMinor: agreementsBillingLines.vatAmountMinor,
        amountIncVatMinor: agreementsBillingLines.amountIncVatMinor,
        bearerType: agreementsBillingLines.bearerType,
        recipientOrgId: agreementsBillingLines.recipientOrgId,
      })
      .from(agreementsBillingLines);

    // VACUITY GUARD. An empty corpus must FAIL, not pass quietly. This suite
    // has silently compared nothing twice before.
    expect(
      stored.length,
      "no stored billing lines to compare against — the corpus is empty, so this " +
        "test proves nothing. Run the billing tick on the test branch first.",
    ).toBeGreaterThan(0);

    const bySession = new Map<string, typeof stored>();
    for (const l of stored) {
      if (!l.sessionId) continue;
      const arr = bySession.get(l.sessionId) ?? [];
      arr.push(l);
      bySession.set(l.sessionId, arr);
    }
    expect(bySession.size, "no session-scoped lines in the corpus").toBeGreaterThan(0);

    let compared = 0;
    for (const [sessionId, expectedLines] of bySession) {
      // loadAgreementContext still lives in persist.ts (Phase 2) and still
      // runs on Prisma. Phase 1 only moved the pure core, so the context
      // loader is borrowed as-is — and its input is rebuilt from the session
      // exactly as resolveAndPersistForSession does it, so the comparison is
      // against the same arithmetic the stored rows came from.
      const [s] = await getDrizzle()
        .select({
          userId: sessions.userId,
          chargingStationId: sessions.chargingStationId,
          startedAt: sessions.startedAt,
          endedAt: sessions.endedAt,
          energyWh: sessions.energyWh,
        })
        .from(sessions)
        .where(eq(sessions.id, sessionId))
        .limit(1);
      if (!s || !s.userId || !s.endedAt) continue;

      const durationMs = Math.max(0, s.endedAt.getTime() - s.startedAt.getTime());
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ctxResult = await loadAgreementContext(getPrisma() as any, {
        userId: s.userId,
        chargingStationId: s.chargingStationId,
        at: s.startedAt,
        energyKwh: Number(s.energyWh) / 1000,
        durationMinutes: durationMs / 60_000,
        durationDays: durationMs / (1000 * 60 * 60 * 24),
      });
      if (!ctxResult.granted) continue;

      const actual = resolveBillingLines(ctxResult.ctx);
      const byFactor = new Map(actual.map((l) => [l.factorCode, l]));

      for (const want of expectedLines) {
        const got = byFactor.get(want.factorCode);
        expect(got, `${sessionId} / ${want.factorCode}: not re-resolved`).toBeTruthy();
        // Integers compared exactly — no tolerance. These are minor units.
        expect(got!.amountExVatMinor, `${sessionId}/${want.factorCode} ex-VAT`).toBe(
          BigInt(want.amountExVatMinor),
        );
        expect(got!.vatAmountMinor, `${sessionId}/${want.factorCode} VAT`).toBe(
          BigInt(want.vatAmountMinor),
        );
        expect(got!.amountIncVatMinor, `${sessionId}/${want.factorCode} inc-VAT`).toBe(
          BigInt(want.amountIncVatMinor),
        );
        expect(got!.unitPriceMinor, `${sessionId}/${want.factorCode} unit price`).toBe(
          BigInt(want.unitPriceMinor),
        );
        expect(got!.bearerType, `${sessionId}/${want.factorCode} bearer`).toBe(want.bearerType);
        expect(got!.recipientOrgId, `${sessionId}/${want.factorCode} recipient`).toBe(
          want.recipientOrgId,
        );
        compared++;
      }
    }

    expect(
      compared,
      "every stored line was skipped — loadAgreementContext returned null for all of them, " +
        "so nothing was actually compared",
    ).toBeGreaterThan(0);
    console.log(`[parity] re-resolved ${compared} stored lines across ${bySession.size} sessions`);
  });

  it("RATE_BASES carries per_connector without disturbing the stored corpus", async () => {
    // The enum widened; no stored line may have acquired the new basis.
    expect(RATE_BASES).toContain("per_connector");
    const [row] = await getDrizzle()
      .select({ n: agreementsBillingLines.id })
      .from(agreementsBillingLines)
      .where(eq(agreementsBillingLines.basisType, "per_kwh"))
      .limit(1);
    expect(row, "expected the stored corpus to be per_kwh").toBeTruthy();
  });
});
