import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { logEnergyDrift, logStopTimeDrift } from "./enrichment-drift";

describe("enrichment-drift helpers", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  // ───────────────────────────────────────────────────────────────────────
  // logEnergyDrift
  // ───────────────────────────────────────────────────────────────────────
  describe("logEnergyDrift", () => {
    it("does not warn when both values are null", () => {
      logEnergyDrift({
        sessionId: "sess-1",
        chargerId: "zpr-001",
        ocppEnergyKwh: null,
        cdrEnergyKwh: null,
      });
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("does not warn when only OCPP is present (no comparison possible)", () => {
      logEnergyDrift({
        sessionId: "sess-2",
        chargerId: "zpr-001",
        ocppEnergyKwh: 12.345,
        cdrEnergyKwh: null,
      });
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("does not warn when only CDR is present", () => {
      logEnergyDrift({
        sessionId: "sess-3",
        chargerId: "zpr-001",
        ocppEnergyKwh: null,
        cdrEnergyKwh: 12.345,
      });
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("does not warn when both present and within default tolerance (0.05 kWh)", () => {
      logEnergyDrift({
        sessionId: "sess-4",
        chargerId: "zpr-001",
        ocppEnergyKwh: 10.000,
        cdrEnergyKwh: 10.04, // delta ≈ 0.04 — comfortably below default
      });
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("does not warn when both values are identical (delta = 0)", () => {
      logEnergyDrift({
        sessionId: "sess-5",
        chargerId: "zpr-001",
        ocppEnergyKwh: 10.000,
        cdrEnergyKwh: 10.000,
      });
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("warns when delta exceeds default tolerance with the expected message", () => {
      logEnergyDrift({
        sessionId: "sess-6",
        chargerId: "zpr-074002",
        ocppEnergyKwh: 10.0,
        cdrEnergyKwh: 10.2, // delta = 0.200 > 0.05
      });
      expect(warnSpy).toHaveBeenCalledTimes(1);
      const msg = warnSpy.mock.calls[0]![0] as string;
      expect(msg).toContain("[enrichment-drift]");
      expect(msg).toContain("session=sess-6");
      expect(msg).toContain("charger=zpr-074002");
      expect(msg).toContain("ocpp_energy=10");
      expect(msg).toContain("cdr_energy=10.2");
      expect(msg).toContain("delta=0.200kWh");
      expect(msg).toContain("CDR overwrote OCPP figure");
    });

    it("respects a custom tolerance override (stricter)", () => {
      logEnergyDrift({
        sessionId: "sess-7",
        chargerId: "zpr-001",
        ocppEnergyKwh: 10.0,
        cdrEnergyKwh: 10.02, // delta=0.02, below default (0.05) but above 0.01
        toleranceKwh: 0.01,
      });
      expect(warnSpy).toHaveBeenCalledTimes(1);
      const msg = warnSpy.mock.calls[0]![0] as string;
      expect(msg).toContain("delta=0.020kWh");
    });

    it("respects a custom tolerance override (looser)", () => {
      logEnergyDrift({
        sessionId: "sess-8",
        chargerId: "zpr-001",
        ocppEnergyKwh: 10.0,
        cdrEnergyKwh: 10.4, // delta=0.4, above default but below 0.5
        toleranceKwh: 0.5,
      });
      expect(warnSpy).not.toHaveBeenCalled();
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // logStopTimeDrift
  // ───────────────────────────────────────────────────────────────────────
  describe("logStopTimeDrift", () => {
    const baseDate = new Date("2026-05-31T10:00:00Z");

    it("does not warn when both timestamps are null", () => {
      logStopTimeDrift({
        sessionId: "sess-1",
        ocppStoppedAt: null,
        cdrStoppedAt: null,
      });
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("does not warn when only OCPP is present", () => {
      logStopTimeDrift({
        sessionId: "sess-2",
        ocppStoppedAt: baseDate,
        cdrStoppedAt: null,
      });
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("does not warn when only CDR is present", () => {
      logStopTimeDrift({
        sessionId: "sess-3",
        ocppStoppedAt: null,
        cdrStoppedAt: baseDate,
      });
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("does not warn when both present and within default tolerance (30s)", () => {
      logStopTimeDrift({
        sessionId: "sess-4",
        ocppStoppedAt: baseDate,
        cdrStoppedAt: new Date(baseDate.getTime() + 29_000), // +29s
      });
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("does not warn at exactly the tolerance boundary (delta == tolerance)", () => {
      logStopTimeDrift({
        sessionId: "sess-5",
        ocppStoppedAt: baseDate,
        cdrStoppedAt: new Date(baseDate.getTime() + 30_000), // +30s
      });
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("warns when stop-time drift exceeds default tolerance", () => {
      logStopTimeDrift({
        sessionId: "sess-6",
        ocppStoppedAt: baseDate,
        cdrStoppedAt: new Date(baseDate.getTime() + 90_000), // +90s
      });
      expect(warnSpy).toHaveBeenCalledTimes(1);
      const msg = warnSpy.mock.calls[0]![0] as string;
      expect(msg).toContain("[enrichment-drift]");
      expect(msg).toContain("session=sess-6");
      expect(msg).toContain("stop-time drift 90s");
    });

    it("warns symmetrically when CDR is earlier than OCPP (negative direction)", () => {
      logStopTimeDrift({
        sessionId: "sess-7",
        ocppStoppedAt: new Date(baseDate.getTime() + 90_000),
        cdrStoppedAt: baseDate,
      });
      expect(warnSpy).toHaveBeenCalledTimes(1);
      const msg = warnSpy.mock.calls[0]![0] as string;
      expect(msg).toContain("stop-time drift 90s");
    });

    it("respects a custom tolerance override (stricter)", () => {
      logStopTimeDrift({
        sessionId: "sess-8",
        ocppStoppedAt: baseDate,
        cdrStoppedAt: new Date(baseDate.getTime() + 15_000), // +15s
        toleranceSec: 10,
      });
      expect(warnSpy).toHaveBeenCalledTimes(1);
      const msg = warnSpy.mock.calls[0]![0] as string;
      expect(msg).toContain("stop-time drift 15s");
    });

    it("respects a custom tolerance override (looser)", () => {
      logStopTimeDrift({
        sessionId: "sess-9",
        ocppStoppedAt: baseDate,
        cdrStoppedAt: new Date(baseDate.getTime() + 120_000), // +120s
        toleranceSec: 300,
      });
      expect(warnSpy).not.toHaveBeenCalled();
    });
  });
});
