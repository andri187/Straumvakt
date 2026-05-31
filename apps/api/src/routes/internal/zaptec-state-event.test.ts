// Sprint 9 / ENRICH-1 — AMQP enrichment writer test.
//
// The 723 (CompletedSession) handler in zaptec-state-event.ts is the
// AMQP feed's terminal write into charging.sessions. ENRICH-1 added
// two new columns it must populate (amqpEnergyKwh, ocmfBlobRef) and
// pinned the contract that this path NEVER touches verified_source or
// the canonical energy_wh / ended_at — CDR > AMQP in priority and
// must remain the only source that can flip provenance.
//
// We mock makePrisma at module-load time (same pattern ocpp-events.test
// uses) and assert the shape of the chargeSession.update call after a
// well-formed StateId 723 frame.

import { describe, it, expect, vi, beforeEach } from "vitest";

interface FakePrisma {
  ocppIdentity: {
    findFirst: ReturnType<typeof vi.fn>;
  };
  chargeSession: {
    findFirst: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
}

const fakePrisma: FakePrisma = {
  ocppIdentity: {
    findFirst: vi.fn(),
  },
  chargeSession: {
    findFirst: vi.fn(),
    update: vi.fn(),
  },
};

vi.mock("../../lib/prisma", () => ({
  makePrisma: () => fakePrisma,
}));

import { internalZaptecStateEvent } from "./zaptec-state-event";

const SECRET = "test-secret-0123456789abcdef";
const ORG = "11111111-1111-1111-1111-111111111111";
const IDENTITY = "22222222-2222-2222-2222-222222222222";
const STATION = "33333333-3333-3333-3333-333333333333";
const SESSION = "44444444-4444-4444-4444-444444444444";
// Zod 4 z.string().uuid() validates the RFC 4122 version + variant
// nibbles; a chain of all-a's fails. Use a v4 layout for the synthetic
// Zaptec id.
const ZAPTEC_UUID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

// Minimal OCMF blob — same shape as the projections-test fixture but
// inline so this test file is self-contained.
const SAMPLE_OCMF =
  "OCMF|" +
  JSON.stringify({
    FV: "1.0",
    GI: "ZAPTEC PRO",
    GS: "ZPR042316",
    GV: "3.3.5.1",
    PG: "T1",
    RD: [
      {
        TM: "2026-05-09T10:00:00,000+00:00 R",
        TX: "B",
        RV: "100.0000",
        RI: "1-0:1.8.0",
        RU: "kWh",
        RT: "AC",
        ST: "G",
      },
      {
        TM: "2026-05-09T10:30:00,000+00:00 R",
        TX: "E",
        RV: "105.5000",
        RI: "1-0:1.8.0",
        RU: "kWh",
        RT: "AC",
        ST: "G",
      },
    ],
  }) +
  "|signature-here";

const env = { OCPP_INGEST_SECRET: SECRET } as never;

function buildRequest(body: unknown) {
  return new Request("https://main.internal/", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-straumvakt-ingest": SECRET,
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/internal/zaptec-state-event — ENRICH-1 (StateId 723)", () => {
  beforeEach(() => {
    fakePrisma.ocppIdentity.findFirst.mockReset();
    fakePrisma.chargeSession.findFirst.mockReset();
    fakePrisma.chargeSession.update.mockReset();

    // Default: identity resolves, in-progress session exists without
    // OCMF yet. Per-test overrides change these.
    fakePrisma.ocppIdentity.findFirst.mockResolvedValue({
      id: IDENTITY,
      orgId: ORG,
      chargingStationId: STATION,
    });
    fakePrisma.chargeSession.findFirst.mockResolvedValue({
      id: SESSION,
      completedSessionSeenAt: null,
      energyWh: null,
      endedAt: null,
    });
    fakePrisma.chargeSession.update.mockResolvedValue({ id: SESSION });
  });

  it("populates amqpEnergyKwh + ocmfBlobRef on the matching session", async () => {
    const blob = {
      StartDateTime: "2026-05-09T10:00:00Z",
      EndDateTime: "2026-05-09T10:30:00Z",
      Energy: 5.5,
      SignedSession: SAMPLE_OCMF,
    };

    const req = buildRequest({
      chargerId: ZAPTEC_UUID,
      stateId: 723,
      value: JSON.stringify(blob),
      timestamp: "2026-05-09T10:30:00.000Z",
    });
    const res = await internalZaptecStateEvent.request(
      req,
      undefined,
      env,
    );
    expect(res.status).toBe(200);

    expect(fakePrisma.chargeSession.update).toHaveBeenCalledOnce();
    const call = fakePrisma.chargeSession.update.mock.calls[0][0] as {
      where: { id: string };
      data: Record<string, unknown>;
    };
    expect(call.where.id).toBe(SESSION);
    // ENRICH-1 — per-source mirror.
    expect(call.data.amqpEnergyKwh).toBe("5.5000");
    expect(call.data.ocmfBlobRef).toBe(SAMPLE_OCMF);
    // OCMF blob also lands on the legacy column (unchanged behaviour).
    expect(call.data.ocmfSignedSession).toBe(SAMPLE_OCMF);
  });

  it("does NOT set verifiedSource — CDR > AMQP priority is enforced", async () => {
    const blob = {
      StartDateTime: "2026-05-09T10:00:00Z",
      EndDateTime: "2026-05-09T10:30:00Z",
      Energy: 5.5,
      SignedSession: SAMPLE_OCMF,
    };

    const req = buildRequest({
      chargerId: ZAPTEC_UUID,
      stateId: 723,
      value: JSON.stringify(blob),
      timestamp: "2026-05-09T10:30:00.000Z",
    });
    await internalZaptecStateEvent.request(req, undefined, env);

    const call = fakePrisma.chargeSession.update.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    // The AMQP path enriches but never claims provenance — CDR is the
    // authoritative source. Asserting absence pins the contract so a
    // future refactor can't silently flip it.
    expect(call.data.verifiedSource).toBeUndefined();
    expect(call.data.enrichmentStatus).toBeUndefined();
  });

  it("omits amqpEnergyKwh when the blob has no Energy field", async () => {
    const blob = {
      StartDateTime: "2026-05-09T10:00:00Z",
      EndDateTime: "2026-05-09T10:30:00Z",
      SignedSession: SAMPLE_OCMF,
      // Energy intentionally absent.
    };

    const req = buildRequest({
      chargerId: ZAPTEC_UUID,
      stateId: 723,
      value: JSON.stringify(blob),
      timestamp: "2026-05-09T10:30:00.000Z",
    });
    await internalZaptecStateEvent.request(req, undefined, env);

    const call = fakePrisma.chargeSession.update.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    // No Energy in blob → mirror column stays null (spread-omit).
    expect(call.data.amqpEnergyKwh).toBeUndefined();
    // OCMF blob still landed.
    expect(call.data.ocmfBlobRef).toBe(SAMPLE_OCMF);
  });

  it("omits ocmfBlobRef when the blob has no SignedSession", async () => {
    const blob = {
      StartDateTime: "2026-05-09T10:00:00Z",
      EndDateTime: "2026-05-09T10:30:00Z",
      Energy: 5.5,
      // SignedSession intentionally absent.
    };

    const req = buildRequest({
      chargerId: ZAPTEC_UUID,
      stateId: 723,
      value: JSON.stringify(blob),
      timestamp: "2026-05-09T10:30:00.000Z",
    });
    await internalZaptecStateEvent.request(req, undefined, env);

    const call = fakePrisma.chargeSession.update.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(call.data.amqpEnergyKwh).toBe("5.5000");
    expect(call.data.ocmfBlobRef).toBeUndefined();
  });
});
