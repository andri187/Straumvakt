// ADR 0026 §6 — host application (RFQ) repository, against the real database.
//
// ── WHY THIS MOVED HERE 2026-08-07 ──────────────────────────────────────
//
// Lived at src/repositories/host-applications.test.ts behind a hand-rolled
// fake PrismaClient. Fourth instance of the same breakage: the repository
// ported to Drizzle and the fake stopped intercepting. Same resolution as
// admin-bootstrap and the driver-group-memberships route — real Postgres,
// every case inside a transaction that is rolled back.
//
// What this buys beyond the fake: `sites` is a JSONB column, and the round
// trip through Postgres is the only thing that proves an array of objects
// survives it unchanged. The fake handed back the same JS reference it was
// given, so the assertion was on identity, not on serialisation.
//
// sendEmail is mocked — the repository fails open when RESEND_API_KEY is
// absent, and both the sent and not-sent branches are asserted without
// touching the network.
//
// EVERY CASE ROLLS BACK.

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { closeAll, getDrizzle, hasDb } from "./_harness";
import { hostApplications } from "@straumvakt/shared/db/identity";
import type { HostApplicationSite } from "@straumvakt/shared/domain/host-applications";

const ROLLBACK = Symbol("rollback");

let emailResult: { ok: boolean; reason?: string } = { ok: true };
const sendEmailSpy = vi.fn(async () => emailResult);

vi.mock("../../src/lib/email", () => ({
  sendEmail: (...args: unknown[]) => sendEmailSpy(...(args as [])),
}));

const {
  createHostApplication,
  listHostApplications,
  getHostApplication,
  updateHostApplicationStatus,
} = await import("../../src/repositories/host-applications");

async function inRollback<T>(fn: (tx: never) => Promise<T>): Promise<T> {
  let captured: T;
  try {
    await getDrizzle().transaction(async (tx) => {
      captured = await fn(tx as never);
      throw ROLLBACK;
    });
  } catch (err) {
    if (err !== ROLLBACK) throw err;
  }
  return captured!;
}

const SITES: HostApplicationSite[] = [
  { address: "Dalvegur 10", estimatedChargers: 4, estimatedDrivers: 20 },
  { address: "Borgartún 1", estimatedChargers: 2, estimatedDrivers: 8 },
];

const input = (over: Partial<Parameters<typeof createHostApplication>[2]> = {}) => ({
  companyName: "Parity Host ehf.",
  contactName: "Test Contact",
  contactEmail: "parity-host@straumvakt.invalid",
  siteType: "company" as const,
  sites: SITES,
  ...over,
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ENV = { RESEND_API_KEY: "test" } as any;

describe.skipIf(!hasDb)("host applications (real DB, rolled back)", () => {
  afterAll(closeAll);

  beforeEach(() => {
    sendEmailSpy.mockClear();
    emailResult = { ok: true };
  });

  it("persists a row and returns a summary defaulting to status=new", async () => {
    const { result, stored } = await inRollback(async (tx) => {
      const result = await createHostApplication(tx, ENV, input());
      const stored = await (tx as never as ReturnType<typeof getDrizzle>)
        .select()
        .from(hostApplications)
        .where(eq(hostApplications.id, result.application.id));
      return { result, stored };
    });

    expect(result.application.status).toBe("new");
    expect(result.application.companyName).toBe("Parity Host ehf.");
    expect(result.email.sent).toBe(true);
    expect(stored).toHaveLength(1);
  });

  it("round-trips the sites JSONB array unchanged", async () => {
    // The fake returned the same object it was handed, so this was previously
    // an identity check. Through Postgres it is a real serialisation test.
    const { summary } = await inRollback(async (tx) => {
      const r = await createHostApplication(tx, ENV, input());
      const summary = await getHostApplication(tx, r.application.id);
      return { summary };
    });
    expect(summary!.sites).toEqual(SITES);
    expect(summary!.sites[0]!.estimatedChargers).toBe(4);
  });

  it("fails open on email when the send fails (row still persists)", async () => {
    emailResult = { ok: false, reason: "no_api_key" };
    const { result, found } = await inRollback(async (tx) => {
      const result = await createHostApplication(tx, ENV, input());
      const found = await getHostApplication(tx, result.application.id);
      return { result, found };
    });
    expect(result.email.sent).toBe(false);
    expect(result.email.reason).toBe("no_api_key");
    expect(found).not.toBeNull();
  });

  it("returns all by default and filters by status", async () => {
    const { all, onlyNew, onlyWon } = await inRollback(async (tx) => {
      const a = await createHostApplication(tx, ENV, input({ companyName: "A ehf." }));
      await createHostApplication(tx, ENV, input({ companyName: "B ehf." }));
      await updateHostApplicationStatus(tx, a.application.id, "won");
      return {
        all: await listHostApplications(tx),
        onlyNew: await listHostApplications(tx, { status: "new" }),
        onlyWon: await listHostApplications(tx, { status: "won" }),
      };
    });

    // The branch may hold pre-existing rows, so assert on the delta rather
    // than absolute counts.
    expect(all.length).toBeGreaterThanOrEqual(2);
    expect(onlyNew.every((r) => r.status === "new")).toBe(true);
    expect(onlyWon.some((r) => r.companyName === "A ehf.")).toBe(true);
    expect(onlyNew.some((r) => r.companyName === "B ehf.")).toBe(true);
  });

  it("orders newest first", async () => {
    // createdAt is `defaultNow()`, and Postgres `now()` is the TRANSACTION
    // start time — every row created inside one transaction shares a
    // timestamp, so two createHostApplication calls here are indistinguishable
    // to an ORDER BY. Insert directly with explicit, distinct timestamps
    // instead; that is the only way to observe the ordering under rollback.
    const { rows } = await inRollback(async (tx) => {
      const d = tx as never as ReturnType<typeof getDrizzle>;
      await d.insert(hostApplications).values([
        {
          companyName: "Older",
          contactName: "x",
          contactEmail: "older@straumvakt.invalid",
          siteType: "company",
          sites: SITES,
          createdAt: new Date("2020-01-01T00:00:00Z"),
        },
        {
          companyName: "Newer",
          contactName: "x",
          contactEmail: "newer@straumvakt.invalid",
          siteType: "company",
          sites: SITES,
          createdAt: new Date("2020-06-01T00:00:00Z"),
        },
      ]);
      return { rows: await listHostApplications(tx) };
    });
    const older = rows.findIndex((r) => r.companyName === "Older");
    const newer = rows.findIndex((r) => r.companyName === "Newer");
    expect(newer).toBeGreaterThanOrEqual(0);
    expect(newer).toBeLessThan(older);
  });

  it("returns null for an unknown id", async () => {
    const found = await inRollback(async (tx) =>
      getHostApplication(tx, "00000000-0000-4000-8000-0000000000ff"),
    );
    expect(found).toBeNull();
  });

  it("updates an existing application's status", async () => {
    const { updated } = await inRollback(async (tx) => {
      const r = await createHostApplication(tx, ENV, input());
      const updated = await updateHostApplicationStatus(tx, r.application.id, "in_review");
      return { updated };
    });
    expect(updated!.status).toBe("in_review");
  });

  it("returns null when updating an unknown id", async () => {
    // Prisma threw P2025 here and the repository read first to avoid it.
    // Drizzle's RETURNING makes the empty result the not-found signal.
    const updated = await inRollback(async (tx) =>
      updateHostApplicationStatus(tx, "00000000-0000-4000-8000-0000000000ff", "won"),
    );
    expect(updated).toBeNull();
  });
});
