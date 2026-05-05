// Sprint 8.13.1 — guard against the regression where the */5 status
// cron stamped lastSeenAt=now even for offline chargers, painting them
// as "online" in the site tree for 12 min after Zaptec already
// reported them down (caught at Klettas 3 / ZPR103043).

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../lib/zaptec", () => ({
  listChargers: vi.fn(),
}));

import { listChargers, type ZaptecChargerLite } from "../lib/zaptec";
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
    DeviceId: "ZPR103043",
    Name: "K1",
    OperatingMode: 1,
    IsOnline: true,
    ...overrides,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("syncZaptecChargerStatus — lastSeenAt invariant", () => {
  beforeEach(() => {
    vi.mocked(listChargers).mockReset();
  });

  it("stamps lastSeenAt=now when Zaptec reports IsOnline=true", async () => {
    vi.mocked(listChargers).mockResolvedValueOnce({
      ok: true,
      value: [makeCharger({ IsOnline: true, OperatingMode: 3 })],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const captured: CapturedUpdate[] = [];
    const db = makeFakeDb(captured);

    const report = await syncZaptecChargerStatus(db, { accessToken: "x" });

    expect(report.updated).toHaveLength(1);
    expect(captured).toHaveLength(1);
    expect(captured[0].data.status).toBe("charging");
    expect(captured[0].data.lastSeenAt).toBeInstanceOf(Date);
  });

  it("does NOT stamp lastSeenAt when Zaptec reports IsOnline=false (the bug)", async () => {
    vi.mocked(listChargers).mockResolvedValueOnce({
      ok: true,
      value: [makeCharger({ IsOnline: false, OperatingMode: 3 })],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const captured: CapturedUpdate[] = [];
    const db = makeFakeDb(captured);

    await syncZaptecChargerStatus(db, { accessToken: "x" });

    expect(captured).toHaveLength(1);
    expect(captured[0].data.status).toBe("offline");
    expect(captured[0].data.lastSeenAt).toBeUndefined();
  });

  it("treats IsOnline=undefined as not-online — no lastSeenAt stamp", async () => {
    // Defensive: if Zaptec ever returns IsOnline absent from the
    // payload, we should not assume the charger is reachable.
    vi.mocked(listChargers).mockResolvedValueOnce({
      ok: true,
      value: [makeCharger({ IsOnline: undefined, OperatingMode: 1 })],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const captured: CapturedUpdate[] = [];
    const db = makeFakeDb(captured);

    await syncZaptecChargerStatus(db, { accessToken: "x" });

    expect(captured).toHaveLength(1);
    expect(captured[0].data.lastSeenAt).toBeUndefined();
  });
});
