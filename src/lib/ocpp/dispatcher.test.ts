/**
 * Dispatcher unit tests — exercise `dispatchTick` with a stub Prisma
 * client + TargetRegistry so retry / ack / failure / crash paths are
 * isolated from Postgres.
 *
 * The full claim-atomicity proof (FOR UPDATE SKIP LOCKED) needs a real
 * DB and lands with the 1.5 end-to-end test. Here we verify that the
 * dispatcher passes claimed rows to the right target and persists the
 * right terminal state for each possible result.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: () => ({}) as never }));

import {
  computeRetryBackoffMs,
  dispatchTick,
} from "./dispatcher";
import {
  TargetRegistry,
  type ClaimedCommand,
  type DispatchResult,
  type DispatchTarget,
} from "./dispatch-targets";

/** Swappable stub target — returns whatever result the test specifies. */
class ProgrammableTarget implements DispatchTarget {
  readonly name: string;
  constructor(
    name: string,
    private responder: (cmd: ClaimedCommand) => Promise<DispatchResult>,
  ) {
    this.name = name;
  }
  dispatch(cmd: ClaimedCommand): Promise<DispatchResult> {
    return this.responder(cmd);
  }
}

/** In-memory Prisma stub — just enough surface for the dispatcher. */
function makeDb(initial: ClaimedCommandState[]) {
  const state = new Map<string, ClaimedCommandState>();
  for (const c of initial) state.set(c.id, { ...c });

  const db = {
    async $queryRaw(_strings: TemplateStringsArray, ..._values: unknown[]) {
      const rows: Array<ReturnType<typeof toRow>> = [];
      for (const [, cmd] of state) {
        if (cmd.status === "pending" && cmd.notBefore <= new Date()) {
          cmd.attempts += 1;
          cmd.lastAttemptAt = new Date();
          cmd.notBefore = new Date(Date.now() + 30_000);
          rows.push(toRow(cmd));
        }
      }
      return rows;
    },
    async $transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
      return fn(txClient);
    },
  };

  const txClient = {
    outboundCommand: {
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<ClaimedCommandState> & { result?: unknown } }) => {
        const cmd = state.get(where.id);
        if (!cmd) throw new Error(`stub: missing id ${where.id}`);
        Object.assign(cmd, data);
        return cmd;
      }),
    },
  };

  function toRow(cmd: ClaimedCommandState) {
    return {
      id: cmd.id,
      orgId: cmd.orgId,
      identityId: cmd.identityId,
      controlDomain: cmd.controlDomain,
      routedTo: cmd.routedTo,
      payload: cmd.payload,
      attempts: cmd.attempts,
      correlationId: cmd.correlationId,
    };
  }

  return { db, state, txClient };
}

type ClaimedCommandState = {
  id: string;
  orgId: string;
  identityId: string;
  controlDomain: string;
  routedTo: string;
  payload: Record<string, unknown>;
  correlationId: string;
  status: "pending" | "acked" | "failed" | "cancelled";
  attempts: number;
  notBefore: Date;
  lastAttemptAt?: Date;
  result?: unknown;
};

function seed(overrides: Partial<ClaimedCommandState> = {}): ClaimedCommandState {
  return {
    id: "cmd-1",
    orgId: "11111111-1111-1111-1111-111111111111",
    identityId: "22222222-2222-2222-2222-222222222222",
    controlDomain: "remote_start",
    routedTo: "ocpp",
    payload: { connectorId: "33333333-3333-3333-3333-333333333333" },
    correlationId: "44444444-4444-4444-4444-444444444444",
    status: "pending",
    attempts: 0,
    notBefore: new Date(0),
    ...overrides,
  };
}

describe("computeRetryBackoffMs", () => {
  it("returns 0 for attempts < 1", () => {
    expect(computeRetryBackoffMs(0, 5000, 300_000)).toBe(0);
  });
  it("doubles per attempt until the cap", () => {
    expect(computeRetryBackoffMs(1, 5000, 300_000)).toBe(5_000);
    expect(computeRetryBackoffMs(2, 5000, 300_000)).toBe(10_000);
    expect(computeRetryBackoffMs(3, 5000, 300_000)).toBe(20_000);
    expect(computeRetryBackoffMs(4, 5000, 300_000)).toBe(40_000);
  });
  it("respects the cap", () => {
    expect(computeRetryBackoffMs(20, 5000, 300_000)).toBe(300_000);
  });
});

describe("dispatchTick — per-result behavior", () => {
  it("ack: command transitions to 'acked' with the result payload", async () => {
    const { db, state } = makeDb([seed()]);
    const registry = new TargetRegistry();
    registry.register(
      new ProgrammableTarget("ocpp", async () => ({
        kind: "ack",
        result: { status: "Accepted" },
      })),
    );
    // biome-ignore lint/suspicious/noExplicitAny: test stub
    const summary = await dispatchTick(db as any, { registry });
    expect(summary.claimed).toBe(1);
    expect(summary.acked).toBe(1);
    const cmd = state.get("cmd-1")!;
    expect(cmd.status).toBe("acked");
    expect(cmd.result).toEqual({ status: "Accepted" });
  });

  it("permanent failure: command transitions to 'failed'", async () => {
    const { db, state } = makeDb([seed()]);
    const registry = new TargetRegistry();
    registry.register(
      new ProgrammableTarget("ocpp", async () => ({
        kind: "permanent",
        error: "charger rejected",
      })),
    );
    // biome-ignore lint/suspicious/noExplicitAny: test stub
    const summary = await dispatchTick(db as any, { registry });
    expect(summary.failed).toBe(1);
    expect(state.get("cmd-1")!.status).toBe("failed");
  });

  it("retriable: command stays pending with notBefore pushed out by backoff", async () => {
    const { db, state } = makeDb([seed()]);
    const registry = new TargetRegistry();
    registry.register(
      new ProgrammableTarget("ocpp", async () => ({
        kind: "retriable",
        error: "temporary timeout",
      })),
    );
    const before = Date.now();
    // biome-ignore lint/suspicious/noExplicitAny: test stub
    const summary = await dispatchTick(db as any, {
      registry,
      baseBackoffMs: 5000,
      capBackoffMs: 300_000,
      maxAttempts: 10,
    });
    expect(summary.retried).toBe(1);
    const cmd = state.get("cmd-1")!;
    expect(cmd.status).toBe("pending");
    // attempts=1 after claim, backoff base*2^0 = 5s
    expect(cmd.notBefore.getTime()).toBeGreaterThanOrEqual(before + 5_000 - 100);
  });

  it("thrown dispatch error is treated as retriable", async () => {
    const { db, state } = makeDb([seed()]);
    const registry = new TargetRegistry();
    registry.register(
      new ProgrammableTarget("ocpp", async () => {
        throw new Error("network blew up");
      }),
    );
    // biome-ignore lint/suspicious/noExplicitAny: test stub
    await dispatchTick(db as any, { registry });
    expect(state.get("cmd-1")!.status).toBe("pending");
    expect(state.get("cmd-1")!.attempts).toBe(1);
  });

  it("max attempts exceeded: retriable result flips to 'failed'", async () => {
    const { db, state } = makeDb([seed({ attempts: 10 })]);
    const registry = new TargetRegistry();
    registry.register(
      new ProgrammableTarget("ocpp", async () => ({
        kind: "retriable",
        error: "still failing",
      })),
    );
    // biome-ignore lint/suspicious/noExplicitAny: test stub
    await dispatchTick(db as any, { registry, maxAttempts: 10 });
    expect(state.get("cmd-1")!.status).toBe("failed");
  });

  it("unregistered target: command moves to 'failed' with a clear error", async () => {
    const { db, state } = makeDb([seed({ routedTo: "vendor:unknown" })]);
    const registry = new TargetRegistry(); // empty
    // biome-ignore lint/suspicious/noExplicitAny: test stub
    const summary = await dispatchTick(db as any, { registry });
    expect(summary.skipped).toBe(1);
    expect(summary.failed).toBe(1);
    const cmd = state.get("cmd-1")!;
    expect(cmd.status).toBe("failed");
    expect((cmd.result as { error: string }).error).toContain("vendor:unknown");
  });

  it("crash-resilience: attempts + lastAttemptAt + notBefore set before dispatch starts", async () => {
    const { db, state } = makeDb([seed()]);
    const registry = new TargetRegistry();
    registry.register(
      new ProgrammableTarget("ocpp", async () => {
        // Observe: by the time the target runs, the claim has already
        // bumped attempts and set a retry floor. If the target throws
        // (crash) the row is safe to reclaim.
        const snapshot = state.get("cmd-1")!;
        expect(snapshot.attempts).toBe(1);
        expect(snapshot.lastAttemptAt).toBeInstanceOf(Date);
        expect(snapshot.notBefore.getTime()).toBeGreaterThan(Date.now());
        throw new Error("simulated crash");
      }),
    );
    // biome-ignore lint/suspicious/noExplicitAny: test stub
    await dispatchTick(db as any, { registry });
    // Even though target threw, command is still pending (not lost).
    expect(state.get("cmd-1")!.status).toBe("pending");
  });

  it("pending rows with notBefore in the future are not claimed", async () => {
    const future = new Date(Date.now() + 60_000);
    const { db, state } = makeDb([seed({ notBefore: future })]);
    const registry = new TargetRegistry();
    registry.register(new ProgrammableTarget("ocpp", async () => ({ kind: "ack", result: {} })));
    // biome-ignore lint/suspicious/noExplicitAny: test stub
    const summary = await dispatchTick(db as any, { registry });
    expect(summary.claimed).toBe(0);
    expect(state.get("cmd-1")!.status).toBe("pending");
    expect(state.get("cmd-1")!.attempts).toBe(0);
  });
});
