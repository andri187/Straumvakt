/**
 * Projection-handler integration tests. We stub the Prisma transaction
 * client, fire each event-typed handler via the dispatcher that 1.1
 * already wired, and assert the right tx methods were called with the
 * right arguments.
 *
 * No real DB — this isolates projection semantics from Postgres I/O.
 *
 * Ported from src/lib/ocpp/projections.test.ts. Removed the
 * `vi.mock("@/lib/prisma", ...)` line — apps/api's Prisma factory is
 * not module-resolved here because ingestEventInTx takes the tx
 * directly, never reaching for a global Prisma client.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

import {
  ingestEventInTx,
  __resetProjectionsForTests,
} from "./events-repository";
import {
  registerAllProjections,
  __resetRegistrationForTests,
} from "./projections";
import type { IngestEvent } from "./event-envelope";

const ORG = "11111111-1111-1111-1111-111111111111";
const IDENTITY = "22222222-2222-2222-2222-222222222222";
const CONNECTOR = "33333333-3333-3333-3333-333333333333";
const CHARGER = "44444444-4444-4444-4444-444444444444";
const SITE = "55555555-5555-5555-5555-555555555555";
const SESSION = "66666666-6666-6666-6666-666666666666";
const EVSE = "77777777-7777-7777-7777-777777777777";

type MockTx = ReturnType<typeof makeTx>;

function makeTx() {
  return {
    idempotencyKey: {
      findUnique: vi.fn(async () => null),
      create: vi.fn(async () => ({ scope: "ocpp", key: "x" })),
    },
    eventLogEntry: {
      create: vi.fn(async () => ({ id: "log-1" })),
    },
    ocppIdentity: {
      update: vi.fn(async (args: unknown) => args),
    },
    connector: {
      findUnique: vi.fn(async () => ({
        orgId: ORG,
        evseId: EVSE,
        evse: {
          chargingStationId: CHARGER,
          chargingStation: {
            siteAsset: { siteId: SITE },
            ocppIdentities: [{ id: IDENTITY }],
          },
        },
      })),
      update: vi.fn(async (args: unknown) => args),
    },
    chargeSession: {
      create: vi.fn(async (args: unknown) => args),
      // session.stopped (Sprint 8.5) reads back fields it just
      // updated via `select:`. Return a fixture matching the
      // selected shape so the resolver-then-engine path in the
      // projection has real values to work with. The fixture leaves
      // siteId / chargingStationId UNSET so by default the existing
      // tests don't trigger ledger-write side effects (the
      // projection logs a warn and skips). The session_ledger test
      // below overrides per-call.
      update: vi.fn(async (_args: unknown): Promise<unknown> => ({
        id: SESSION,
        orgId: ORG,
        siteId: null,
        chargingStationId: null,
        ocppIdentityId: IDENTITY,
        idTag: null,
        startedAt: new Date("2026-05-04T08:00:00Z"),
        endedAt: new Date("2026-05-04T09:00:00Z"),
        energyWh: 10500n,
      })),
    },
    meterValue: {
      create: vi.fn(async (args: unknown) => args),
    },
    // Sprint 8.5 — tariff resolver + ledger writer plumbing. All
    // default to "missing" so existing non-stopped tests don't hit
    // them; session.stopped tests override per-case. The `unknown`
    // return type widens the mock so per-test overrides can return
    // richer shapes without TS variance complaints.
    site: {
      findUnique: vi.fn(async (_args: unknown): Promise<unknown> => null),
    },
    chargingStation: {
      findUnique: vi.fn(async (_args: unknown): Promise<unknown> => null),
    },
    installation: {
      findUnique: vi.fn(async (_args: unknown): Promise<unknown> => null),
    },
    tariffDefinition: {
      findUnique: vi.fn(async (_args: unknown): Promise<unknown> => null),
    },
    sessionLedger: {
      upsert: vi.fn(async (args: unknown) => args),
    },
    idToken: {
      findFirst: vi.fn(async (_args: unknown): Promise<unknown> => null),
    },
  };
}

function event(overrides: Partial<IngestEvent> = {}): IngestEvent {
  return {
    eventId: "e-1",
    orgId: ORG,
    aggregateType: "ocpp_identity",
    aggregateId: IDENTITY,
    eventType: "charger.booted",
    occurredAt: "2026-04-24T10:00:00.000Z",
    correlationId: "c-1",
    retentionClass: "operational",
    payload: {},
    ...overrides,
  };
}

async function run(tx: MockTx, e: IngestEvent) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ingestEventInTx(tx as any, ORG, e);
}

describe("projections — per-event handlers", () => {
  beforeEach(() => {
    __resetProjectionsForTests();
    __resetRegistrationForTests();
    registerAllProjections();
  });

  it("charger.booted sets status=online + last_seen_at", async () => {
    const tx = makeTx();
    await run(tx, event({ eventType: "charger.booted" }));
    expect(tx.ocppIdentity.update).toHaveBeenCalledOnce();
    const call = tx.ocppIdentity.update.mock.calls[0][0] as {
      where: { id: string };
      data: { status: string; lastSeenAt: Date };
    };
    expect(call.where.id).toBe(IDENTITY);
    expect(call.data.status).toBe("online");
    expect(call.data.lastSeenAt).toBeInstanceOf(Date);
  });

  it("charger.heartbeat updates last_seen_at, does NOT touch status", async () => {
    const tx = makeTx();
    await run(tx, event({ eventType: "charger.heartbeat" }));
    const call = tx.ocppIdentity.update.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(call.data.lastSeenAt).toBeInstanceOf(Date);
    expect(call.data.status).toBeUndefined();
  });

  it("connector.status_updated writes status + status_updated_at on connector", async () => {
    const tx = makeTx();
    await run(
      tx,
      event({
        eventType: "connector.status_updated",
        aggregateType: "connector",
        aggregateId: CONNECTOR,
        payload: { status: "Charging", errorCode: "NoError" },
      }),
    );
    expect(tx.connector.update).toHaveBeenCalledOnce();
    const call = tx.connector.update.mock.calls[0][0] as {
      where: { id: string };
      data: { status: string; statusUpdatedAt: Date };
    };
    expect(call.where.id).toBe(CONNECTOR);
    expect(call.data.status).toBe("Charging");
  });

  it("session.started resolves siteId/chargerId via Connector lookup and inserts session", async () => {
    const tx = makeTx();
    await run(
      tx,
      event({
        eventType: "session.started",
        aggregateType: "charge_session",
        aggregateId: SESSION,
        retentionClass: "financial",
        payload: { connectorId: CONNECTOR, idTag: "ABC", meterStartWh: 0 },
      }),
    );
    expect(tx.connector.findUnique).toHaveBeenCalledOnce();
    expect(tx.chargeSession.create).toHaveBeenCalledOnce();
    const call = tx.chargeSession.create.mock.calls[0][0] as {
      data: {
        id: string;
        siteId: string;
        chargingStationId: string;
        evseId: string;
        ocppIdentityId: string | null;
        connectorId: string;
        status: string;
      };
    };
    expect(call.data.id).toBe(SESSION);
    expect(call.data.siteId).toBe(SITE);
    expect(call.data.chargingStationId).toBe(CHARGER);
    expect(call.data.evseId).toBe(EVSE);
    expect(call.data.ocppIdentityId).toBe(IDENTITY);
    expect(call.data.connectorId).toBe(CONNECTOR);
    expect(call.data.status).toBe("in_progress");
  });

  it("session.meter_value_recorded inserts meter rows and updates running energy", async () => {
    const tx = makeTx();
    await run(
      tx,
      event({
        eventType: "session.meter_value_recorded",
        aggregateType: "charge_session",
        aggregateId: SESSION,
        retentionClass: "raw_protocol",
        payload: {
          connectorId: CONNECTOR,
          meterValues: [
            {
              timestamp: "2026-04-24T10:05:00.000Z",
              sampledValue: [
                { value: "1000", measurand: "Energy.Active.Import.Register" },
                { value: "7000", measurand: "Power.Active.Import" },
              ],
            },
            {
              timestamp: "2026-04-24T10:10:00.000Z",
              sampledValue: [
                { value: "2500", measurand: "Energy.Active.Import.Register" },
              ],
            },
          ],
        },
      }),
    );
    // 3 sampled values → 3 meterValue.create calls
    expect(tx.meterValue.create).toHaveBeenCalledTimes(3);
    // chargeSession.update bumps running energy to max (2500 Wh)
    expect(tx.chargeSession.update).toHaveBeenCalledOnce();
    const call = tx.chargeSession.update.mock.calls[0][0] as {
      data: { energyWh: bigint };
    };
    expect(call.data.energyWh).toBe(2500n);
  });

  it("session.stopped closes session with ended_at + stop_reason + final energy", async () => {
    const tx = makeTx();
    await run(
      tx,
      event({
        eventType: "session.stopped",
        aggregateType: "charge_session",
        aggregateId: SESSION,
        retentionClass: "financial",
        payload: { meterStopWh: 10500, stopReason: "Local" },
      }),
    );
    expect(tx.chargeSession.update).toHaveBeenCalledOnce();
    const call = tx.chargeSession.update.mock.calls[0][0] as {
      where: { id: string };
      data: { status: string; stopReason: string; energyWh: bigint };
    };
    expect(call.where.id).toBe(SESSION);
    expect(call.data.status).toBe("completed");
    expect(call.data.stopReason).toBe("Local");
    expect(call.data.energyWh).toBe(10500n);
  });

  // ─── Sprint 8.5 — session.stopped also writes reports.session_ledger ───
  it("session.stopped writes a ledger row when site+installation tariffs are configured", async () => {
    const tx = makeTx();
    // Stub chargeSession.update to return a row WITH siteId +
    // chargingStationId so the ledger path runs.
    tx.chargeSession.update = vi.fn(async () => ({
      id: SESSION,
      orgId: ORG,
      siteId: SITE,
      chargingStationId: CHARGER,
      ocppIdentityId: IDENTITY,
      idTag: "ABC123",
      startedAt: new Date("2026-05-04T08:00:00Z"),
      endedAt: new Date("2026-05-04T09:00:00Z"),
      energyWh: 30_000n, // 30 kWh
    }));
    // Tariff plumbing for the canonical Veitur AD1 + N1 case.
    tx.site.findUnique = vi.fn(async () => ({
      id: SITE,
      dsoTariffId: "tariff-veitur-ad1",
    }));
    tx.chargingStation.findUnique = vi.fn(async () => ({
      siteAssetId: CHARGER,
      installationId: "inst-1",
    }));
    tx.installation.findUnique = vi.fn(async () => ({
      id: "inst-1",
      retailerTariffId: "tariff-n1",
    }));
    tx.tariffDefinition.findUnique = vi.fn(async (args: unknown): Promise<unknown> => {
      const { where } = args as { where: { id: string } };
      if (where.id === "tariff-veitur-ad1") {
        return {
          id: "tariff-veitur-ad1",
          displayName: "Veitur AD1",
          computeRule: { kind: "flat", pricePerKwhMinor: 864 },
          vatRatePct: 24,
          currency: "ISK",
          status: "active",
        };
      }
      if (where.id === "tariff-n1") {
        return {
          id: "tariff-n1",
          displayName: "N1 N1_RAFMAGN-REPF-01",
          computeRule: { kind: "flat", pricePerKwhMinor: 883 },
          vatRatePct: 24,
          currency: "ISK",
          status: "active",
        };
      }
      return null;
    });

    await run(
      tx,
      event({
        eventType: "session.stopped",
        aggregateType: "charge_session",
        aggregateId: SESSION,
        retentionClass: "financial",
        payload: { meterStopWh: 30_000, stopReason: "Local" },
      }),
    );

    // Ledger row written with the canonical 30 kWh × (Veitur + N1)
    // computation: 64988 minor (= 649.88 kr.) inc-VAT.
    expect(tx.sessionLedger.upsert).toHaveBeenCalledOnce();
    const upsertCall = tx.sessionLedger.upsert.mock.calls[0][0] as {
      where: { sessionId: string };
      create: {
        sessionId: string;
        orgId: string;
        siteId: string;
        chargingStationId: string;
        driverIdTag: string | null;
        energyKwh: string;
        durationSec: number;
        costIskMinor: bigint;
      };
    };
    expect(upsertCall.where.sessionId).toBe(SESSION);
    expect(upsertCall.create.orgId).toBe(ORG);
    expect(upsertCall.create.siteId).toBe(SITE);
    expect(upsertCall.create.chargingStationId).toBe(CHARGER);
    expect(upsertCall.create.driverIdTag).toBe("ABC123");
    expect(upsertCall.create.energyKwh).toBe("30.000");
    expect(upsertCall.create.durationSec).toBe(3600);
    expect(upsertCall.create.costIskMinor).toBe(64988n);
  });

  it("session.stopped resolves driverUserId via idTag → IdToken when present", async () => {
    const tx = makeTx();
    const DRIVER_ID = "88888888-8888-8888-8888-888888888888";
    tx.chargeSession.update = vi.fn(async () => ({
      id: SESSION,
      orgId: ORG,
      siteId: SITE,
      chargingStationId: CHARGER,
      ocppIdentityId: IDENTITY,
      idTag: "RFID-DRIVER-001",
      startedAt: new Date("2026-05-04T08:00:00Z"),
      endedAt: new Date("2026-05-04T09:00:00Z"),
      energyWh: 30_000n,
    }));
    tx.site.findUnique = vi.fn(async () => ({
      id: SITE,
      dsoTariffId: "tariff-veitur-ad1",
    }));
    tx.chargingStation.findUnique = vi.fn(async () => ({
      siteAssetId: CHARGER,
      installationId: "inst-1",
    }));
    tx.installation.findUnique = vi.fn(async () => ({
      id: "inst-1",
      retailerTariffId: "tariff-n1",
    }));
    tx.tariffDefinition.findUnique = vi.fn(async (args: unknown): Promise<unknown> => {
      const { where } = args as { where: { id: string } };
      const base = {
        computeRule: { kind: "flat", pricePerKwhMinor: 864 },
        vatRatePct: 24,
        currency: "ISK",
        status: "active",
      };
      if (where.id === "tariff-veitur-ad1")
        return { ...base, id: where.id, displayName: "Veitur AD1" };
      if (where.id === "tariff-n1")
        return {
          ...base,
          id: where.id,
          displayName: "N1",
          computeRule: { kind: "flat", pricePerKwhMinor: 883 },
        };
      return null;
    });
    // IdToken hit: this idTag belongs to DRIVER_ID.
    tx.idToken.findFirst = vi.fn(async (): Promise<unknown> => ({ userId: DRIVER_ID }));

    await run(
      tx,
      event({
        eventType: "session.stopped",
        aggregateType: "charge_session",
        aggregateId: SESSION,
        retentionClass: "financial",
        payload: { meterStopWh: 30_000, stopReason: "Local" },
      }),
    );

    expect(tx.idToken.findFirst).toHaveBeenCalledOnce();
    const idTokenCall = tx.idToken.findFirst.mock.calls[0][0] as {
      where: { value: string; status: string };
    };
    expect(idTokenCall.where.value).toBe("RFID-DRIVER-001");
    expect(idTokenCall.where.status).toBe("active");

    const upsertCall = tx.sessionLedger.upsert.mock.calls[0][0] as {
      create: { driverUserId: string | null; driverIdTag: string | null };
    };
    expect(upsertCall.create.driverUserId).toBe(DRIVER_ID);
    expect(upsertCall.create.driverIdTag).toBe("RFID-DRIVER-001");
  });

  it("session.stopped without siteId logs warn + skips ledger write (no throw)", async () => {
    const tx = makeTx();
    // Default chargeSession.update from makeTx returns null siteId.
    await expect(
      run(
        tx,
        event({
          eventType: "session.stopped",
          aggregateType: "charge_session",
          aggregateId: SESSION,
          retentionClass: "financial",
          payload: { meterStopWh: 30_000, stopReason: "Local" },
        }),
      ),
    ).resolves.toBeDefined();
    expect(tx.sessionLedger.upsert).not.toHaveBeenCalled();
  });

  it("session.stopped throws when DSO tariff is unconfigured (drives queue retry)", async () => {
    const tx = makeTx();
    tx.chargeSession.update = vi.fn(async () => ({
      id: SESSION,
      orgId: ORG,
      siteId: SITE,
      chargingStationId: CHARGER,
      ocppIdentityId: IDENTITY,
      idTag: null,
      startedAt: new Date("2026-05-04T08:00:00Z"),
      endedAt: new Date("2026-05-04T09:00:00Z"),
      energyWh: 30_000n,
    }));
    // Site exists but has NO dsoTariffId → resolver throws.
    tx.site.findUnique = vi.fn(async () => ({
      id: SITE,
      dsoTariffId: null,
    }));
    await expect(
      run(
        tx,
        event({
          eventType: "session.stopped",
          aggregateType: "charge_session",
          aggregateId: SESSION,
          retentionClass: "financial",
          payload: { meterStopWh: 30_000, stopReason: "Local" },
        }),
      ),
    ).rejects.toMatchObject({ code: "dso_tariff_unconfigured" });
    // Ledger upsert MUST NOT have been called — the throw rolled
    // back the whole projection (including the chargeSession.update
    // in the same tx).
    expect(tx.sessionLedger.upsert).not.toHaveBeenCalled();
  });

  it("card.authorize_requested has no projection (logged only)", async () => {
    const tx = makeTx();
    await run(
      tx,
      event({
        eventType: "card.authorize_requested",
        payload: { idTag: "ABC" },
      }),
    );
    expect(tx.eventLogEntry.create).toHaveBeenCalledOnce();
    expect(tx.ocppIdentity.update).not.toHaveBeenCalled();
    expect(tx.connector.update).not.toHaveBeenCalled();
    expect(tx.chargeSession.create).not.toHaveBeenCalled();
  });

  it("ocpp.unknown_message has no projection (logged only)", async () => {
    const tx = makeTx();
    await run(
      tx,
      event({
        eventType: "ocpp.unknown_message",
        retentionClass: "raw_protocol",
        payload: { action: "GetConfiguration", raw: {} },
      }),
    );
    expect(tx.eventLogEntry.create).toHaveBeenCalledOnce();
    expect(tx.ocppIdentity.update).not.toHaveBeenCalled();
  });
});
