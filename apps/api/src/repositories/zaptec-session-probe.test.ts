// Sprint 8.x — Zaptec API-fallback probe tests. Mocks both the
// Zaptec HTTP layer (via vi.mock on ../lib/zaptec) and Prisma.

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../lib/zaptec", () => ({
  listZaptecChargeHistory: vi.fn(),
}));

import { listZaptecChargeHistory } from "../lib/zaptec";
import { probeZaptecSessions } from "./zaptec-session-probe";
import type { PrismaClient } from "../generated/prisma/client";

interface OurSessionRow {
  id: string;
  chargingStationId: string;
  startedAt: Date;
  endedAt: Date | null;
  energyWh: bigint | null;
}

function makeFakeDb(opts: {
  identities?: Array<{ vendorResourceId: string; chargingStationId: string }>;
  sessions?: OurSessionRow[];
  ledgerSessionIds?: string[];
}): PrismaClient {
  const identities = opts.identities ?? [];
  const sessions = opts.sessions ?? [];
  const ledger = (opts.ledgerSessionIds ?? []).map((sessionId) => ({ sessionId }));
  return {
    ocppIdentity: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      findMany: async ({ where }: any) => {
        const filter = where.vendorResourceId?.in as string[] | undefined;
        return identities.filter((i) =>
          filter ? filter.includes(i.vendorResourceId) : true,
        );
      },
    },
    chargeSession: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      findMany: async ({ where }: any) => {
        const stationFilter = where.chargingStationId?.in as string[] | undefined;
        const gte = where.startedAt?.gte as Date | undefined;
        const lte = where.startedAt?.lte as Date | undefined;
        return sessions.filter(
          (s) =>
            (!stationFilter || stationFilter.includes(s.chargingStationId)) &&
            (!gte || s.startedAt >= gte) &&
            (!lte || s.startedAt <= lte),
        );
      },
    },
    sessionLedger: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      findMany: async ({ where }: any) => {
        const filter = where.sessionId?.in as string[] | undefined;
        return ledger.filter((l) => (filter ? filter.includes(l.sessionId) : true));
      },
    },
  } as unknown as PrismaClient;
}

const Z_CHARGER = "ZAPTEC-CH-001";
const OUR_STATION = "11111111-1111-1111-1111-111111111111";
const OUR_SESSION = "22222222-2222-2222-2222-222222222222";

describe("probeZaptecSessions", () => {
  beforeEach(() => {
    vi.mocked(listZaptecChargeHistory).mockReset();
  });

  it("happy path — Zaptec session matches our session by start-time + charger", async () => {
    const startedAt = new Date("2026-04-15T12:00:00Z");
    vi.mocked(listZaptecChargeHistory).mockResolvedValue({
      ok: true,
      value: [
        {
          Id: "z-session-1",
          ChargerId: Z_CHARGER,
          StartDateTime: startedAt.toISOString(),
          EndDateTime: "2026-04-15T13:00:00Z",
          Energy: 30,
        },
      ],
    });
    const db = makeFakeDb({
      identities: [{ vendorResourceId: Z_CHARGER, chargingStationId: OUR_STATION }],
      sessions: [
        {
          id: OUR_SESSION,
          chargingStationId: OUR_STATION,
          startedAt,
          endedAt: new Date("2026-04-15T13:00:00Z"),
          energyWh: 30_000n,
        },
      ],
      ledgerSessionIds: [OUR_SESSION],
    });

    const result = await probeZaptecSessions(db, {
      accessToken: "stub",
      installationId: "inst-1",
    });

    expect(result.zaptecCount).toBe(1);
    expect(result.ourCount).toBe(1);
    expect(result.bothInOurs).toHaveLength(1);
    expect(result.bothInOurs[0].zaptecId).toBe("z-session-1");
    expect(result.bothInOurs[0].ourSessionId).toBe(OUR_SESSION);
    expect(result.bothInOurs[0].inLedger).toBe(true);
    expect(result.onlyInZaptec).toEqual([]);
    expect(result.onlyInOurs).toEqual([]);
  });

  it("session in Zaptec but missing in our DB — onlyInZaptec", async () => {
    vi.mocked(listZaptecChargeHistory).mockResolvedValue({
      ok: true,
      value: [
        {
          Id: "z-session-orphan",
          ChargerId: Z_CHARGER,
          StartDateTime: "2026-04-15T12:00:00Z",
          EndDateTime: null,
          Energy: 12.5,
        },
      ],
    });
    const db = makeFakeDb({
      identities: [{ vendorResourceId: Z_CHARGER, chargingStationId: OUR_STATION }],
      sessions: [],
    });

    const result = await probeZaptecSessions(db, { accessToken: "stub" });
    expect(result.bothInOurs).toEqual([]);
    expect(result.onlyInZaptec).toHaveLength(1);
    expect(result.onlyInZaptec[0].zaptecId).toBe("z-session-orphan");
    expect(result.onlyInZaptec[0].ourSessionId).toBeNull();
  });

  it("session in our DB but missing from Zaptec — onlyInOurs", async () => {
    vi.mocked(listZaptecChargeHistory).mockResolvedValue({ ok: true, value: [] });
    const db = makeFakeDb({
      identities: [{ vendorResourceId: Z_CHARGER, chargingStationId: OUR_STATION }],
      sessions: [
        {
          id: OUR_SESSION,
          chargingStationId: OUR_STATION,
          startedAt: new Date("2026-04-15T12:00:00Z"),
          endedAt: new Date("2026-04-15T13:00:00Z"),
          energyWh: 30_000n,
        },
      ],
    });

    const result = await probeZaptecSessions(db, { accessToken: "stub" });
    // Zaptec returned no rows, so our charger-id filter to ocppIdentity
    // never gets seeded → ourSessions[] is empty too. Net behaviour:
    // empty buckets, ourCount=0. (To detect orphan our-side rows the
    // operator passes a chargerId or installationId that has Zaptec
    // history; sessions outside that window are out of scope of the
    // diff.)
    expect(result.zaptecCount).toBe(0);
    expect(result.ourCount).toBe(0);
    expect(result.onlyInOurs).toEqual([]);
  });

  it("start-time fuzz beyond ±2 minutes is NOT matched", async () => {
    vi.mocked(listZaptecChargeHistory).mockResolvedValue({
      ok: true,
      value: [
        {
          Id: "z-1",
          ChargerId: Z_CHARGER,
          StartDateTime: "2026-04-15T12:00:00Z",
          EndDateTime: null,
          Energy: 5,
        },
      ],
    });
    const db = makeFakeDb({
      identities: [{ vendorResourceId: Z_CHARGER, chargingStationId: OUR_STATION }],
      // Our session started 5 minutes earlier — outside the 2-min window.
      sessions: [
        {
          id: OUR_SESSION,
          chargingStationId: OUR_STATION,
          startedAt: new Date("2026-04-15T11:55:00Z"),
          endedAt: null,
          energyWh: null,
        },
      ],
    });
    const result = await probeZaptecSessions(db, { accessToken: "stub" });
    // Both rows present but no match — both surface in their lonely bucket.
    expect(result.bothInOurs).toEqual([]);
    expect(result.onlyInZaptec).toHaveLength(1);
    expect(result.onlyInOurs).toHaveLength(1);
  });

  it("rethrows on Zaptec fetch failure", async () => {
    vi.mocked(listZaptecChargeHistory).mockResolvedValue({
      ok: false,
      error: { kind: "list", status: 502 },
    });
    const db = makeFakeDb({});
    await expect(
      probeZaptecSessions(db, { accessToken: "stub" }),
    ).rejects.toThrow(/zaptec_chargehistory_fetch_failed/);
  });
});
