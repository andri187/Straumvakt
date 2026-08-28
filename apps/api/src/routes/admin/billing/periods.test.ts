// The billing API surface.
//
// These drive the REAL router with a fixture port — no database, no socket.
// The auth middleware is mocked because this file is testing the billing
// invariants, not the session layer, and `resolveOrgScope` is the one piece
// whose answer the tenancy assertions actually depend on.

import { beforeEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({
  /** null = platform-wide; an array = an org-limited caller. */
  orgIds: null as string[] | null,
  actor: "user-0000-0000-0000-000000000001" as string | null,
}));

vi.mock("../../../lib/auth-middleware", () => ({
  requireAdmin: async (c: { set: (k: string, v: unknown) => void }, next: () => Promise<void>) => {
    c.set("session", { userId: authState.actor });
    await next();
  },
}));

vi.mock("../../../lib/auth/require-permission", () => ({
  requirePermission: () => async (_c: unknown, next: () => Promise<void>) => {
    await next();
  },
}));

vi.mock("../../../lib/auth/org-scope", () => ({
  resolveOrgScope: async () =>
    authState.orgIds === null ? { all: true } : { all: false, orgIds: authState.orgIds },
}));

import { makeBillingPeriodsRouter } from "./periods";
import { makeFixtureOperationsPort } from "../../../lib/billing/fixture-operations-port";
import {
  FLAT_FEE_CAP_CODE,
  FLAT_FEE_CONNECTOR_CODE,
  FLAT_FEE_DRIVER_CODE,
  type RateRefInput,
} from "@straumvakt/commercial";

const ORG = "11111111-1111-1111-1111-111111111111";
const OTHER_ORG = "22222222-2222-2222-2222-222222222222";
const NOW = new Date("2026-04-05T09:00:00Z");
const KEY = "2026-03-run-1";

function rate(code: string, priceMinor: bigint): RateRefInput {
  return {
    id: `rate-${code}`,
    code,
    costFactorId: "cf",
    basis: "per_connector",
    priceMinor,
    vatRatePct: 24,
    currency: "ISK",
    supplierOrgId: null,
    effectiveFrom: new Date("2026-01-01T00:00:00Z"),
    effectiveUntil: null,
  };
}
const RATES = [
  rate(FLAT_FEE_CONNECTOR_CODE, 20_000n),
  rate(FLAT_FEE_DRIVER_CODE, 5_000n),
  rate(FLAT_FEE_CAP_CODE, 45_000n),
];

function harness(opts: { connectors?: number; drivers?: number } = {}) {
  const k = `${ORG}:2026:3`;
  const { port, state } = makeFixtureOperationsPort({
    connectorRows: { [k]: opts.connectors ?? 30 },
    driverRows: { [k]: opts.drivers ?? 2 },
    rateReferences: RATES,
    render: (p, n) => `INVOICE ${n} for ${p.orgId} ${p.year}-${p.month}`,
  });
  const app = makeBillingPeriodsRouter({ makePort: () => port, now: () => NOW });
  const call = (method: string, path: string, init: RequestInit = {}) =>
    app.request(`http://x/${path}`, { method, ...init });
  return { port, state, app, call };
}

/** Response bodies here are assertion fodder, not a typed contract. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const body = (r: Response): Promise<any> => r.json() as Promise<any>;

const post = (key: string | null = KEY, body?: unknown) => ({
  method: "POST",
  headers: {
    ...(key ? { "Idempotency-Key": key } : {}),
    ...(body ? { "content-type": "application/json" } : {}),
  },
  ...(body ? { body: JSON.stringify(body) } : {}),
});

/** Drive a period all the way to `priced`. */
async function driveToPriced(h: ReturnType<typeof harness>, org = ORG) {
  await h.app.request(`http://x/${org}/billing/periods/2026/3/open`, post(`${org}-open`) as RequestInit);
  await h.app.request(`http://x/${org}/billing/periods/2026/3/activity`, post(`${org}-act`) as RequestInit);
  return h.app.request(`http://x/${org}/billing/periods/2026/3/price`, post(`${org}-price`) as RequestInit);
}

beforeEach(() => {
  authState.orgIds = null;
  authState.actor = "user-0000-0000-0000-000000000001";
});

describe("the happy path, end to end through the API", () => {
  it("open -> activity -> price -> issue -> close", async () => {
    const h = harness();

    const opened = await h.app.request(`http://x/${ORG}/billing/periods/2026/3/open`, post("k1") as RequestInit);
    expect(opened.status).toBe(200);
    expect((await body(opened)).outcome.to).toBe("open");

    const act = await h.app.request(`http://x/${ORG}/billing/periods/2026/3/activity`, post("k2") as RequestInit);
    expect(act.status).toBe(200);
    const actBody = await body(act);
    expect(actBody.counts).toEqual({ connectorRows: 30, driverRows: 2 });
    expect(actBody.sealed.to).toBe("activity_sealed");

    const priced = await h.app.request(`http://x/${ORG}/billing/periods/2026/3/price`, post("k3") as RequestInit);
    expect(priced.status).toBe(200);
    const p = await body(priced);
    // 30 × 200 + 2 × 50 = 6,100 kr — the same arithmetic the dry run prints.
    expect(p.totalIsk).toBe("6100");
    expect(p.capApplied).toBe(false);

    const issued = await h.app.request(`http://x/${ORG}/billing/periods/2026/3/issue`, post("k4") as RequestInit);
    expect(issued.status).toBe(200);
    const i = await body(issued);
    expect(i.documentNumber).toBe("SV-2026-000001");
    // Issuing is not delivering.
    expect(i.deliveryState).toBe("pending");

    const closed = await h.app.request(`http://x/${ORG}/billing/periods/2026/3/close`, post("k5") as RequestInit);
    expect(closed.status).toBe(200);
    expect((await body(closed)).outcome.to).toBe("closed");
  });

  it("reads the period state and the rendered document", async () => {
    const h = harness();
    await driveToPriced(h);
    await h.app.request(`http://x/${ORG}/billing/periods/2026/3/issue`, post("i") as RequestInit);

    const st = await h.app.request(`http://x/${ORG}/billing/periods/2026/3`);
    expect((await body(st)).state).toBe("invoiced");

    const doc = await h.app.request(`http://x/${ORG}/billing/periods/2026/3/document`);
    expect(doc.status).toBe(200);
    expect((await body(doc)).document.rendered).toContain("SV-2026-000001");

    const list = await h.app.request(`http://x/${ORG}/billing/statements`);
    expect((await body(list)).statements).toHaveLength(1);
  });
});

describe("idempotency", () => {
  it("the same key returns the same result WITHOUT repeating the effect", async () => {
    const h = harness();
    const first = await h.app.request(`http://x/${ORG}/billing/periods/2026/3/open`, post("same") as RequestInit);
    const effectsAfterFirst = [...h.state.effects];

    const second = await h.app.request(`http://x/${ORG}/billing/periods/2026/3/open`, post("same") as RequestInit);
    expect(second.status).toBe(200);
    const replayBody = await body(second);
    expect(replayBody.replayed).toBe(true);
    // The proof that matters: no new effect ran.
    expect(h.state.effects).toEqual(effectsAfterFirst);
    expect(first.status).toBe(200);
  });

  it("a DIFFERENT key on the same logical operation is REJECTED, not duplicated", async () => {
    // Two keys for one month's invoice is not two invoices; it is one invoice
    // and one caller bug. The pure state machine catches it as a no-op and the
    // route reports it rather than consuming a second document number.
    const h = harness();
    await driveToPriced(h);
    const a = await h.app.request(`http://x/${ORG}/billing/periods/2026/3/issue`, post("issue-a") as RequestInit);
    expect(a.status).toBe(200);
    const numbersAfterFirst = h.state.effects.filter((e) => e.startsWith("issue:")).length;

    const b = await h.app.request(`http://x/${ORG}/billing/periods/2026/3/issue`, post("issue-b") as RequestInit);
    // Either refused, or the same document — never a second number.
    const issuedEffects = h.state.effects.filter((e) => e.startsWith("issue:")).length;
    expect(issuedEffects).toBe(numbersAfterFirst);
    if (b.status === 200) {
      expect((await body(b)).documentNumber).toBe("SV-2026-000001");
    } else {
      expect(b.status).toBe(409);
    }
  });

  it("the same key with a DIFFERENT body is a 409, not a replay", async () => {
    const h = harness();
    await h.app.request(`http://x/${ORG}/billing/periods/2026/3/open`, post("o") as RequestInit);
    const first = await h.app.request(
      `http://x/${ORG}/billing/periods/2026/3/assertions`,
      post("assert-1", { connectorId: "c-1", reason: "installed, vendor-native" }) as RequestInit,
    );
    expect(first.status).toBe(200);

    const second = await h.app.request(
      `http://x/${ORG}/billing/periods/2026/3/assertions`,
      post("assert-1", { connectorId: "c-2", reason: "different connector" }) as RequestInit,
    );
    expect(second.status).toBe(409);
    expect((await body(second)).error).toBe("idempotency_key_reused_with_different_request");
    expect(h.state.assertions).toHaveLength(1);
  });

  it("a MISSING idempotency key refuses on every mutating endpoint", async () => {
    // Never a generated one. `?? crypto.randomUUID()` makes every retry a
    // fresh operation, which is an idempotency mechanism that guarantees the
    // thing it was added to prevent.
    const h = harness();
    for (const path of ["open", "activity", "price", "issue", "close"]) {
      const res = await h.app.request(
        `http://x/${ORG}/billing/periods/2026/3/${path}`,
        post(null) as RequestInit,
      );
      expect(res.status, path).toBe(400);
      expect((await body(res)).error, path).toBe("idempotency_key_required");
    }
    expect(h.state.effects).toEqual([]);
  });
});

describe("pricing refuses rather than producing a partial invoice", () => {
  it("holds with a NAMED reason when a count is unavailable", async () => {
    const h = harness({ connectors: 0 });
    await h.app.request(`http://x/${ORG}/billing/periods/2026/3/open`, post("o") as RequestInit);
    await h.app.request(`http://x/${ORG}/billing/periods/2026/3/activity`, post("a") as RequestInit);

    const res = await h.app.request(`http://x/${ORG}/billing/periods/2026/3/price`, post("p") as RequestInit);
    expect(res.status).toBe(409);
    const held = await body(res);
    expect(held.error).toBe("count_unavailable");
    expect(held.holds.map((x: { reason: string }) => x.reason)).toContain(
      "connector_count_unavailable",
    );
  });

  it("a held period cannot then be issued", async () => {
    const h = harness({ connectors: 0 });
    await h.app.request(`http://x/${ORG}/billing/periods/2026/3/open`, post("o") as RequestInit);
    await h.app.request(`http://x/${ORG}/billing/periods/2026/3/activity`, post("a") as RequestInit);
    await h.app.request(`http://x/${ORG}/billing/periods/2026/3/price`, post("p") as RequestInit);

    const res = await h.app.request(`http://x/${ORG}/billing/periods/2026/3/issue`, post("i") as RequestInit);
    expect(res.status).toBe(409);
    expect((await body(res)).error).toBe("period_not_priced");
  });

  it("never allocates a document number for a held period", async () => {
    const h = harness({ connectors: 0 });
    await driveToPriced(h);
    await h.app.request(`http://x/${ORG}/billing/periods/2026/3/issue`, post("i") as RequestInit);
    expect(h.state.effects.filter((e) => e.startsWith("issue:"))).toEqual([]);
  });
});

describe("the lifecycle is enforced at the route", () => {
  it("activity into a period that is not open is refused", async () => {
    const h = harness();
    await driveToPriced(h);
    const res = await h.app.request(
      `http://x/${ORG}/billing/periods/2026/3/activity`,
      post("late") as RequestInit,
    );
    expect(res.status).toBe(409);
    expect((await body(res)).error).toBe("period_not_open");
  });

  it("a closed period rejects activity, pricing and issue", async () => {
    const h = harness();
    await driveToPriced(h);
    await h.app.request(`http://x/${ORG}/billing/periods/2026/3/issue`, post("i") as RequestInit);
    await h.app.request(`http://x/${ORG}/billing/periods/2026/3/close`, post("c") as RequestInit);

    for (const path of ["activity", "price", "issue"]) {
      const res = await h.app.request(
        `http://x/${ORG}/billing/periods/2026/3/${path}`,
        post(`after-close-${path}`) as RequestInit,
      );
      expect(res.status, path).toBe(409);
      expect((await body(res)).error, path).toBe("period_closed");
    }
  });

  it("refuses a month that has not ended", async () => {
    const { port, state } = makeFixtureOperationsPort({
      rateReferences: RATES,
      render: () => "x",
    });
    const app = makeBillingPeriodsRouter({
      makePort: () => port,
      // "Now" is inside March, so March may not be opened yet.
      now: () => new Date("2026-03-15T00:00:00Z"),
    });
    const res = await app.request(`http://x/${ORG}/billing/periods/2026/3/open`, post("early") as RequestInit);
    expect(res.status).toBe(409);
    expect((await body(res)).error).toBe("period_not_open");
    expect(state.effects).toEqual([]);
  });

  it("rejects a malformed period", async () => {
    const h = harness();
    const res = await h.app.request(`http://x/${ORG}/billing/periods/2026/13/open`, post("bad") as RequestInit);
    expect(res.status).toBe(400);
  });
});

describe("tenancy — every read and every write", () => {
  beforeEach(() => {
    // A caller who may see OTHER_ORG only.
    authState.orgIds = [OTHER_ORG];
  });

  it("refuses every mutating endpoint for an org out of scope", async () => {
    const h = harness();
    for (const path of ["open", "activity", "price", "issue", "close"]) {
      const res = await h.app.request(
        `http://x/${ORG}/billing/periods/2026/3/${path}`,
        post(`x-${path}`) as RequestInit,
      );
      expect(res.status, path).toBe(404);
      expect((await body(res)).error, path).toBe("org_not_in_scope");
    }
    const assertRes = await h.app.request(
      `http://x/${ORG}/billing/periods/2026/3/assertions`,
      post("x-assert", { connectorId: "c", reason: "r" }) as RequestInit,
    );
    expect(assertRes.status).toBe(404);
    expect(h.state.effects).toEqual([]);
  });

  it("refuses every read for an org out of scope", async () => {
    const h = harness();
    for (const path of [`${ORG}/billing/periods/2026/3`, `${ORG}/billing/statements`, `${ORG}/billing/periods/2026/3/document`]) {
      const res = await h.app.request(`http://x/${path}`);
      expect(res.status, path).toBe(404);
      expect((await body(res)).error, path).toBe("org_not_in_scope");
    }
  });

  it("404 rather than 403 — a 403 confirms the org exists", async () => {
    const h = harness();
    const res = await h.app.request(`http://x/${ORG}/billing/periods/2026/3`);
    expect(res.status).toBe(404);
    expect(res.status).not.toBe(403);
  });

  it("allows the org the caller may see", async () => {
    authState.orgIds = [ORG];
    const h = harness();
    const res = await h.app.request(`http://x/${ORG}/billing/periods/2026/3/open`, post("ok") as RequestInit);
    expect(res.status).toBe(200);
  });
});

describe("assertions through the API — delta 9.7", () => {
  it("records who, when and why", async () => {
    const h = harness();
    await h.app.request(`http://x/${ORG}/billing/periods/2026/3/open`, post("o") as RequestInit);
    const res = await h.app.request(
      `http://x/${ORG}/billing/periods/2026/3/assertions`,
      post("a1", {
        connectorId: "conn-zaptec-1",
        reason: "vendor-native charger, no OCPP status reaches us",
      }) as RequestInit,
    );
    expect(res.status).toBe(200);
    expect(h.state.assertions[0]).toMatchObject({
      connectorId: "conn-zaptec-1",
      actor: "user-0000-0000-0000-000000000001",
    });
    expect(h.state.assertions[0]!.reason).toContain("vendor-native");
  });

  it("refuses an assertion with no reason — an unexplained one is unauditable", async () => {
    const h = harness();
    const res = await h.app.request(
      `http://x/${ORG}/billing/periods/2026/3/assertions`,
      post("a2", { connectorId: "c-1" }) as RequestInit,
    );
    expect(res.status).toBe(400);
    expect(h.state.assertions).toEqual([]);
  });

  it("refuses an assertion against a closed period", async () => {
    const h = harness();
    await driveToPriced(h);
    await h.app.request(`http://x/${ORG}/billing/periods/2026/3/close`, post("c") as RequestInit);
    const res = await h.app.request(
      `http://x/${ORG}/billing/periods/2026/3/assertions`,
      post("a3", { connectorId: "c-1", reason: "late" }) as RequestInit,
    );
    expect(res.status).toBe(409);
    expect((await body(res)).error).toBe("period_closed");
  });
});
