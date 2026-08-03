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
    // ADR 0039 D1 — `raw_protocol` envelopes write their log row to
    // events.protocol_log instead. Same transaction, same position in
    // ingestEventInTx, so projections are unaffected; the mock exists
    // so the raw-frame tests below exercise the real routing rather
    // than a missing-model TypeError.
    protocolLogEntry: {
      create: vi.fn(async () => ({ id: "protolog-1" })),
    },
    ocppIdentity: {
      // BootNotification handler reads `chargingStationId` off the
      // returned row; default to a populated shape so the station-
      // mirror branch fires. Per-test overrides can return args
      // verbatim if a test wants to inspect the call shape only.
      update: vi.fn(async (_args: unknown) => ({ chargingStationId: CHARGER })),
      // Used by resolveConnectorByOcppIndex (2026-05-11 raw-handler
      // fix). Default returns the canonical single-EVSE single-
      // connector shape; per-test overrides can return null for the
      // not-found path.
      findUnique: vi.fn(async (_args: unknown): Promise<unknown> => ({
        orgId: ORG,
        chargingStation: {
          siteAssetId: CHARGER,
          siteAsset: { siteId: SITE },
          evses: [{ id: EVSE, connectors: [{ id: CONNECTOR }] }],
        },
      })),
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
      // ADR 0036 Step C — onOcppRawMeterValues uses findFirst to
      // resolve the in-progress session for an identity. Default
      // returns null (no active session); the OCMF-projection test
      // overrides per-call.
      findFirst: vi.fn(async (_args: unknown): Promise<unknown> => null),
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
      update: vi.fn(async (args: unknown) => args),
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
    // ADR 0039 D1 — raw_protocol, so the log row goes to protocol_log
    // and event_log is not touched at all.
    expect(tx.protocolLogEntry.create).toHaveBeenCalledOnce();
    expect(tx.eventLogEntry.create).not.toHaveBeenCalled();
    expect(tx.ocppIdentity.update).not.toHaveBeenCalled();
  });

  // ── ADR 0036 Step C — ocpp.raw.MeterValues OCMF projection ─────────
  describe("ocpp.raw.MeterValues — OCMF projection (Autocharge Step C)", () => {
    const sampleOcmf =
      "OCMF|" +
      JSON.stringify({
        FV: "1.0",
        GI: "ZAPTEC PRO",
        GS: "ZPR042316",
        GV: "3.2.2.0",
        PG: "T1",
        RD: [
          { TM: "2026-05-09T10:00:00,000+00:00 R", TX: "B", RV: "100.0000", RI: "1-0:1.8.0", RU: "kWh", RT: "AC", ST: "G" },
          { TM: "2026-05-09T10:30:00,000+00:00 R", TX: "E", RV: "105.5000", RI: "1-0:1.8.0", RU: "kWh", RT: "AC", ST: "G" },
        ],
      }) + "|signature-here";

    function meterValuesEvent(payload: Record<string, unknown>): IngestEvent {
      return event({
        eventType: "ocpp.raw.MeterValues",
        retentionClass: "raw_protocol",
        payload,
      });
    }

    function ocmfFrame(ocmf: string) {
      return {
        action: "MeterValues",
        request: {
          transactionId: 12345,
          connectorId: 1,
          meterValue: [
            {
              timestamp: "2026-05-09T10:30:00.000Z",
              sampledValue: [
                { value: ocmf, format: "SignedData", measurand: "Energy.Active.Import.Register" },
                { value: "5500", format: "Raw", measurand: "Energy.Active.Import.Register", unit: "Wh" },
              ],
            },
          ],
        },
      };
    }

    it("projects OCMF gateway block onto in-progress session", async () => {
      const tx = makeTx();
      tx.chargeSession.findFirst = vi.fn(async () => ({
        id: SESSION,
        ocmfSignedSession: null,
      })) as never;
      tx.chargeSession.update = vi.fn(async (args: unknown) => args) as never;

      await run(tx, meterValuesEvent(ocmfFrame(sampleOcmf)));

      expect(tx.chargeSession.update).toHaveBeenCalledOnce();
      const call = tx.chargeSession.update.mock.calls[0][0] as {
        where: { id: string };
        data: Record<string, unknown>;
      };
      expect(call.where.id).toBe(SESSION);
      expect(call.data.ocmfSignedSession).toBe(sampleOcmf);
      expect(call.data.ocmfFormatVersion).toBe("1.0");
      expect(call.data.ocmfGatewayId).toBe("ZAPTEC PRO");
      expect(call.data.ocmfGatewaySerial).toBe("ZPR042316");
      expect(call.data.ocmfGatewayVersion).toBe("3.2.2.0");
      expect(call.data.ocmfFirstReadingKwh).toBe("100.0000");
      expect(call.data.ocmfLastReadingKwh).toBe("105.5000");
      expect(call.data.ocmfSignedSessionKwh).toBe("5.5000");
    });

    it("skips when no in-progress session exists for identity", async () => {
      const tx = makeTx();
      // findFirst defaults to null
      await run(tx, meterValuesEvent(ocmfFrame(sampleOcmf)));
      expect(tx.chargeSession.update).not.toHaveBeenCalled();
    });

    it("idempotent: skips if ocmfSignedSession already populated", async () => {
      const tx = makeTx();
      tx.chargeSession.findFirst = vi.fn(async () => ({
        id: SESSION,
        ocmfSignedSession: "OCMF|already-here|sig",
      })) as never;
      tx.chargeSession.update = vi.fn(async (args: unknown) => args) as never;

      await run(tx, meterValuesEvent(ocmfFrame(sampleOcmf)));
      expect(tx.chargeSession.update).not.toHaveBeenCalled();
    });

    it("captures ev_plc_mac + vendor when OCMF identity is EVCCID", async () => {
      // OCMF blob with identity block carrying EVCCID = Tesla MAC
      const ocmfWithEvccid =
        "OCMF|" +
        JSON.stringify({
          FV: "1.0",
          GI: "ZAPTEC PRO",
          GS: "ZPR042316",
          GV: "3.3.5.1",
          IS: true,
          IL: "VERIFIED",
          IT: "EVCCID",
          ID: "4C:FC:AA:11:22:33", // Tesla OUI
          IF: ["RFID_PLAIN"],
          PG: "T1",
          RD: [
            { TM: "2026-05-09T10:00:00,000+00:00 R", TX: "B", RV: "100.0000", RI: "1-0:1.8.0", RU: "kWh", RT: "AC", ST: "G" },
            { TM: "2026-05-09T10:30:00,000+00:00 R", TX: "E", RV: "105.5000", RI: "1-0:1.8.0", RU: "kWh", RT: "AC", ST: "G" },
          ],
        }) + "|signature";

      const tx = makeTx();
      tx.chargeSession.findFirst = vi.fn(async () => ({
        id: SESSION,
        ocmfSignedSession: null,
      })) as never;
      tx.chargeSession.update = vi.fn(async (args: unknown) => args) as never;

      await run(tx, meterValuesEvent(ocmfFrame(ocmfWithEvccid)));

      expect(tx.chargeSession.update).toHaveBeenCalledOnce();
      const call = tx.chargeSession.update.mock.calls[0][0] as {
        data: Record<string, unknown>;
      };
      expect(call.data.authIdType).toBe("EVCCID");
      expect(call.data.authIdValue).toBe("4C:FC:AA:11:22:33");
      expect(call.data.evPlcMac).toBe("4c:fc:aa:11:22:33");
      expect(call.data.evPlcMacOuiVendor).toBe("Tesla");
    });

    it("skips when MeterValues frame has no SignedData entry", async () => {
      const tx = makeTx();
      tx.chargeSession.findFirst = vi.fn(async () => ({
        id: SESSION,
        ocmfSignedSession: null,
      })) as never;

      const frameWithoutOcmf = {
        action: "MeterValues",
        request: {
          transactionId: 12345,
          meterValue: [
            {
              timestamp: "2026-05-09T10:30:00.000Z",
              sampledValue: [
                { value: "5500", format: "Raw", measurand: "Energy.Active.Import.Register", unit: "Wh" },
              ],
            },
          ],
        },
      };

      await run(tx, meterValuesEvent(frameWithoutOcmf));
      expect(tx.chargeSession.findFirst).not.toHaveBeenCalled();
      expect(tx.chargeSession.update).not.toHaveBeenCalled();
    });
  });

  // ─── 2026-05-11 — raw-frame handlers (projection-gap fix) ─────────
  describe("ocpp.raw.* raw-frame handlers", () => {
    function rawEvent(action: string, request: unknown): IngestEvent {
      return event({
        eventType: `ocpp.raw.${action}`,
        retentionClass: "raw_protocol",
        payload: { action, request },
      });
    }

    it("ocpp.raw.BootNotification sets identity online + mirrors station fields", async () => {
      const tx = makeTx();
      await run(
        tx,
        rawEvent("BootNotification", {
          chargePointVendor: "Zaptec",
          chargePointModel: "Pro",
          chargePointSerialNumber: "ZPR-001",
          firmwareVersion: "3.3.5.1",
        }),
      );
      expect(tx.ocppIdentity.update).toHaveBeenCalledOnce();
      const idCall = tx.ocppIdentity.update.mock.calls[0][0] as {
        where: { id: string };
        data: { status: string; lastSeenAt: Date };
      };
      expect(idCall.where.id).toBe(IDENTITY);
      expect(idCall.data.status).toBe("online");
      expect(tx.chargingStation.update).toHaveBeenCalledOnce();
    });

    it("ocpp.raw.StatusNotification with connectorId=0 updates ocpp_identities.status", async () => {
      const tx = makeTx();
      await run(
        tx,
        rawEvent("StatusNotification", {
          connectorId: 0,
          status: "Available",
          errorCode: "NoError",
        }),
      );
      expect(tx.ocppIdentity.update).toHaveBeenCalledOnce();
      const call = tx.ocppIdentity.update.mock.calls[0][0] as {
        data: { status: string };
      };
      expect(call.data.status).toBe("Available");
      expect(tx.connector.update).not.toHaveBeenCalled();
    });

    it("ocpp.raw.StatusNotification with connectorId=1 resolves connector + writes status", async () => {
      const tx = makeTx();
      await run(
        tx,
        rawEvent("StatusNotification", {
          connectorId: 1,
          status: "Charging",
          errorCode: "NoError",
        }),
      );
      expect(tx.ocppIdentity.findUnique).toHaveBeenCalledOnce();
      expect(tx.connector.update).toHaveBeenCalledOnce();
      const call = tx.connector.update.mock.calls[0][0] as {
        where: { id: string };
        data: { status: string; statusUpdatedAt: Date; errorCode: string | null };
      };
      expect(call.where.id).toBe(CONNECTOR);
      expect(call.data.status).toBe("Charging");
      expect(call.data.errorCode).toBeNull(); // NoError normalised
      expect(tx.ocppIdentity.update).not.toHaveBeenCalled();
    });

    it("ocpp.raw.StatusNotification skips when connector lookup misses", async () => {
      const tx = makeTx();
      tx.ocppIdentity.findUnique = vi.fn(async () => ({
        orgId: ORG,
        chargingStation: {
          siteAssetId: CHARGER,
          siteAsset: { siteId: SITE },
          evses: [{ id: EVSE, connectors: [] }], // no matching connectorIndex
        },
      })) as never;
      await run(
        tx,
        rawEvent("StatusNotification", {
          connectorId: 99,
          status: "Charging",
          errorCode: "NoError",
        }),
      );
      expect(tx.connector.update).not.toHaveBeenCalled();
    });

    it("ocpp.raw.StartTransaction creates ChargeSession via identity lookup", async () => {
      const tx = makeTx();
      await run(
        tx,
        rawEvent("StartTransaction", {
          connectorId: 1,
          idTag: "TAG-123",
          meterStart: 0,
          timestamp: "2026-05-11T07:30:00.000Z",
        }),
      );
      expect(tx.chargeSession.create).toHaveBeenCalledOnce();
      const call = tx.chargeSession.create.mock.calls[0][0] as {
        data: {
          siteId: string;
          chargingStationId: string;
          evseId: string;
          connectorId: string;
          ocppIdentityId: string;
          idTag: string;
          status: string;
          energyWh: bigint | null;
        };
      };
      expect(call.data.siteId).toBe(SITE);
      expect(call.data.chargingStationId).toBe(CHARGER);
      expect(call.data.evseId).toBe(EVSE);
      expect(call.data.connectorId).toBe(CONNECTOR);
      expect(call.data.ocppIdentityId).toBe(IDENTITY);
      expect(call.data.idTag).toBe("TAG-123");
      expect(call.data.status).toBe("in_progress");
      expect(call.data.energyWh).toBe(0n);
    });

    it("ocpp.raw.StopTransaction finds in-progress session + closes it", async () => {
      const tx = makeTx();
      tx.chargeSession.findFirst = vi.fn(async () => ({
        id: SESSION,
        orgId: ORG,
        siteId: null, // forces ledger skip; isolates the close-session assertion
        chargingStationId: null,
        idTag: null,
        startedAt: new Date("2026-05-11T07:30:00Z"),
        energyWh: 0n,
      })) as never;
      await run(
        tx,
        rawEvent("StopTransaction", {
          transactionId: 12345,
          meterStop: 15000,
          reason: "Local",
          timestamp: "2026-05-11T08:00:00.000Z",
        }),
      );
      expect(tx.chargeSession.findFirst).toHaveBeenCalledOnce();
      expect(tx.chargeSession.update).toHaveBeenCalledOnce();
      const call = tx.chargeSession.update.mock.calls[0][0] as {
        where: { id: string };
        data: { status: string; stopReason: string; energyWh: bigint };
      };
      expect(call.where.id).toBe(SESSION);
      expect(call.data.status).toBe("completed");
      expect(call.data.stopReason).toBe("Local");
      expect(call.data.energyWh).toBe(15000n);
    });

    // ─── Sprint 9 / ENRICH-1 — per-source mirror columns ───────────
    it("ocpp.raw.StopTransaction also writes ocppEnergyKwh + ocppStoppedAt mirror columns", async () => {
      const tx = makeTx();
      tx.chargeSession.findFirst = vi.fn(async () => ({
        id: SESSION,
        orgId: ORG,
        siteId: null, // forces ledger skip; isolates the chargeSession.update payload
        chargingStationId: null,
        idTag: null,
        startedAt: new Date("2026-05-11T07:30:00Z"),
        energyWh: 0n,
      })) as never;
      await run(
        tx,
        rawEvent("StopTransaction", {
          transactionId: 12345,
          meterStop: 15000,
          reason: "Local",
          timestamp: "2026-05-11T08:00:00.000Z",
        }),
      );
      expect(tx.chargeSession.update).toHaveBeenCalledOnce();
      const call = tx.chargeSession.update.mock.calls[0][0] as {
        data: {
          energyWh: bigint;
          ocppEnergyKwh?: string;
          ocppStoppedAt?: Date;
        };
      };
      // Canonical column unchanged.
      expect(call.data.energyWh).toBe(15000n);
      // ENRICH-1 mirrors: 15000 Wh → 15.0000 kWh.
      expect(call.data.ocppEnergyKwh).toBe("15.0000");
      expect(call.data.ocppStoppedAt).toBeInstanceOf(Date);
      expect(call.data.ocppStoppedAt?.toISOString()).toBe(
        "2026-05-11T08:00:00.000Z",
      );
    });

    it("ocpp.raw.StopTransaction ledger upsert sets verifiedSource=ocpp + enrichmentStatus=pending", async () => {
      const tx = makeTx();
      tx.chargeSession.findFirst = vi.fn(async () => ({
        id: SESSION,
        orgId: ORG,
        siteId: SITE,
        chargingStationId: CHARGER,
        idTag: null,
        startedAt: new Date("2026-05-11T07:30:00Z"),
        energyWh: 0n,
      })) as never;
      tx.chargeSession.update = vi.fn(async () => ({
        id: SESSION,
        orgId: ORG,
        siteId: SITE,
        chargingStationId: CHARGER,
        idTag: null,
        startedAt: new Date("2026-05-11T07:30:00Z"),
        endedAt: new Date("2026-05-11T08:00:00Z"),
        energyWh: 15000n,
      })) as never;
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
      tx.tariffDefinition.findUnique = vi.fn(
        async (args: unknown): Promise<unknown> => {
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
        },
      );

      await run(
        tx,
        rawEvent("StopTransaction", {
          transactionId: 12345,
          meterStop: 15000,
          reason: "Local",
          timestamp: "2026-05-11T08:00:00.000Z",
        }),
      );

      expect(tx.sessionLedger.upsert).toHaveBeenCalledOnce();
      const upsertCall = tx.sessionLedger.upsert.mock.calls[0][0] as {
        create: { verifiedSource: string; enrichmentStatus: string };
      };
      expect(upsertCall.create.verifiedSource).toBe("ocpp");
      expect(upsertCall.create.enrichmentStatus).toBe("pending");
    });
  });
});
