// Sprint 8.13.2 — per-charger /state is the source of truth for
// IsOnline; bulk /api/chargers IsOnline was caught lying (K3 /
// ZPR042320). These tests pin the new contract:
//
//   1. /state succeeds + IsOnline="true"   → status mapped, lastSeenAt = now
//   2. /state succeeds + IsOnline="false"  → status = "offline", lastSeenAt untouched
//   3. /state fails                        → no DB write at all
//   4. /state succeeds, no StateId -2      → no DB write (ambiguous)
//   5. /state succeeds, garbage value      → no DB write (ambiguous)

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../lib/zaptec", () => ({
  listChargers: vi.fn(),
  getChargerState: vi.fn(),
}));

import {
  listChargers,
  getChargerState,
  type ZaptecChargerLite,
  type ZaptecStateEntry,
} from "../lib/zaptec";
import { syncZaptecChargerStatus } from "./zaptec-charger-status-sync";
import type { PrismaClient } from "../generated/prisma/client";

const ZAPTEC_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const IDENTITY_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

interface CapturedUpdate {
  where: { id: string };
  data: { status?: string; lastSeenAt?: Date };
}

function makeFakeDb(captured: CapturedUpdate[]): PrismaClient {
  const db = {
    ocppIdentity: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      findFirst: async () => ({ id: IDENTITY_ID }) as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      findUnique: async () => ({ chargingStationId: null }) as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      update: async (args: any) => {
        captured.push({ where: args.where, data: args.data });
        return {} as any;
      },
    },
    siteAsset: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      findUnique: async () => null as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      update: async () => ({}) as any,
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  return db;
}

function makeCharger(overrides: Partial<ZaptecChargerLite>): ZaptecChargerLite {
  return {
    Id: ZAPTEC_ID,
    DeviceId: "ZPR042320",
    Name: "K3",
    OperatingMode: 1,
    IsOnline: true,
    ...overrides,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function stateOk(observations: ZaptecStateEntry[]) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { ok: true, value: observations } as any;
}
function stateFail() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { ok: false, error: { kind: "unreachable" } } as any;
}

describe("syncZaptecChargerStatus — /state-as-truth contract", () => {
  beforeEach(() => {
    vi.mocked(listChargers).mockReset();
    vi.mocked(getChargerState).mockReset();
  });

  it("/state succeeds + IsOnline=true → maps status from OperatingMode + stamps lastSeenAt", async () => {
    vi.mocked(listChargers).mockResolvedValueOnce(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { ok: true, value: [makeCharger({ OperatingMode: 3 })] } as any,
    );
    vi.mocked(getChargerState).mockResolvedValueOnce(
      stateOk([{ StateId: -2, ValueAsString: "true" }]),
    );

    const captured: CapturedUpdate[] = [];
    const db = makeFakeDb(captured);
    const report = await syncZaptecChargerStatus(db, { accessToken: "x" });

    expect(report.updated).toHaveLength(1);
    expect(captured).toHaveLength(1);
    expect(captured[0].data.status).toBe("charging");
    expect(captured[0].data.lastSeenAt).toBeInstanceOf(Date);
  });

  it("/state succeeds + IsOnline=false → status='offline' + lastSeenAt UNTOUCHED", async () => {
    vi.mocked(listChargers).mockResolvedValueOnce(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { ok: true, value: [makeCharger({ OperatingMode: 3 })] } as any,
    );
    vi.mocked(getChargerState).mockResolvedValueOnce(
      stateOk([{ StateId: -2, ValueAsString: "false" }]),
    );

    const captured: CapturedUpdate[] = [];
    const db = makeFakeDb(captured);
    await syncZaptecChargerStatus(db, { accessToken: "x" });

    expect(captured).toHaveLength(1);
    expect(captured[0].data.status).toBe("offline");
    expect(captured[0].data.lastSeenAt).toBeUndefined();
  });

  it("/state fails → no DB write at all (the K3 case)", async () => {
    // The bulk listing claims online; /state can't reach the charger.
    // Right semantic: don't write. lastSeenAt naturally ages out past
    // the 12-min site-tree window and the UI flips offline.
    vi.mocked(listChargers).mockResolvedValueOnce(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { ok: true, value: [makeCharger({ IsOnline: true, OperatingMode: 1 })] } as any,
    );
    vi.mocked(getChargerState).mockResolvedValueOnce(stateFail());

    const captured: CapturedUpdate[] = [];
    const db = makeFakeDb(captured);
    const report = await syncZaptecChargerStatus(db, { accessToken: "x" });

    expect(captured).toHaveLength(0);
    expect(report.skipped).toContainEqual({
      zaptecChargerId: ZAPTEC_ID,
      reason: "state_unreachable",
    });
  });

  it("/state succeeds but no StateId -2 entry → no DB write", async () => {
    vi.mocked(listChargers).mockResolvedValueOnce(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { ok: true, value: [makeCharger({})] } as any,
    );
    vi.mocked(getChargerState).mockResolvedValueOnce(
      stateOk([{ StateId: 710, ValueAsString: "1" }]),
    );

    const captured: CapturedUpdate[] = [];
    const db = makeFakeDb(captured);
    await syncZaptecChargerStatus(db, { accessToken: "x" });

    expect(captured).toHaveLength(0);
  });

  it("/state succeeds but ValueAsString is not parseable as boolean → no DB write", async () => {
    vi.mocked(listChargers).mockResolvedValueOnce(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { ok: true, value: [makeCharger({})] } as any,
    );
    vi.mocked(getChargerState).mockResolvedValueOnce(
      stateOk([{ StateId: -2, ValueAsString: "maybe" }]),
    );

    const captured: CapturedUpdate[] = [];
    const db = makeFakeDb(captured);
    await syncZaptecChargerStatus(db, { accessToken: "x" });

    expect(captured).toHaveLength(0);
  });

  it("ignores bulk's stale IsOnline=true when /state says false (the lying-bulk case)", async () => {
    // K3 / ZPR042320 — bulk listing said IsOnline=true but the
    // charger was actually offline. /state must override.
    vi.mocked(listChargers).mockResolvedValueOnce(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { ok: true, value: [makeCharger({ IsOnline: true, OperatingMode: 1 })] } as any,
    );
    vi.mocked(getChargerState).mockResolvedValueOnce(
      stateOk([{ StateId: -2, ValueAsString: "false" }]),
    );

    const captured: CapturedUpdate[] = [];
    const db = makeFakeDb(captured);
    await syncZaptecChargerStatus(db, { accessToken: "x" });

    expect(captured).toHaveLength(1);
    expect(captured[0].data.status).toBe("offline");
    expect(captured[0].data.lastSeenAt).toBeUndefined();
  });
});
