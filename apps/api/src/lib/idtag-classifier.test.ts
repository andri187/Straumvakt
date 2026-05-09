import { describe, it, expect } from "vitest";
import { classifyIdTagFormat, idTagKindLabel } from "./idtag-classifier";

describe("idTag format classifier", () => {
  describe("ISO 14443 4-byte UIDs (8 hex)", () => {
    it("classifies a clean 8-hex MIFARE Classic UID as iso14443_4byte / high", () => {
      const r = classifyIdTagFormat("DEADBEEF");
      expect(r.detectedKind).toBe("iso14443_4byte");
      expect(r.confidence).toBe("high");
    });

    it("normalises case", () => {
      expect(classifyIdTagFormat("deadbeef").detectedKind).toBe("iso14443_4byte");
      expect(classifyIdTagFormat("DeAdBeEf").detectedKind).toBe("iso14443_4byte");
    });

    it("ignores separators", () => {
      expect(classifyIdTagFormat("DE:AD:BE:EF").detectedKind).toBe("iso14443_4byte");
      expect(classifyIdTagFormat("DE-AD-BE-EF").detectedKind).toBe("iso14443_4byte");
      expect(classifyIdTagFormat("DEAD BEEF").detectedKind).toBe("iso14443_4byte");
    });
  });

  describe("ISO 14443 7-byte UIDs (14 hex)", () => {
    it("classifies the Zaptec Default ID tag shape as iso14443_7byte", () => {
      // EE43C609263CC7 is the Dalvegur 10 Default ID tag we've been working with
      const r = classifyIdTagFormat("EE43C609263CC7");
      expect(r.detectedKind).toBe("iso14443_7byte");
      expect(r.confidence).toBe("high");
    });

    it("classifies any 14-hex string as 7-byte UID", () => {
      expect(classifyIdTagFormat("0123456789ABCD").detectedKind).toBe("iso14443_7byte");
    });
  });

  describe("EVCCID (vehicle MAC, 12 hex)", () => {
    it("classifies a Tesla MAC as evccid_mac with high confidence + vendor", () => {
      const r = classifyIdTagFormat("4CFCAA112233");
      expect(r.detectedKind).toBe("evccid_mac");
      expect(r.confidence).toBe("high");
      expect(r.meta?.vendor).toBe("Tesla");
      expect(r.meta?.oui).toBe("4CFCAA");
    });

    it("classifies an unknown-OUI 12-hex string as evccid_mac with low confidence", () => {
      const r = classifyIdTagFormat("FFEEDD112233");
      expect(r.detectedKind).toBe("evccid_mac");
      expect(r.confidence).toBe("low");
      expect(r.meta?.vendor).toBeNull();
      expect(r.meta?.oui).toBe("FFEEDD");
    });

    it("accepts colon-separated MACs", () => {
      const r = classifyIdTagFormat("4C:FC:AA:11:22:33");
      expect(r.detectedKind).toBe("evccid_mac");
      expect(r.meta?.vendor).toBe("Tesla");
    });
  });

  describe("EMAID (ISO 15118 PnC contract)", () => {
    it("classifies a well-formed EMAID as emaid / high", () => {
      // DE 8AB 123456789 W (country / provider / instance / check)
      const r = classifyIdTagFormat("DE8AB123456789W");
      expect(r.detectedKind).toBe("emaid");
      expect(r.confidence).toBe("high");
      expect(r.meta?.country).toBe("DE");
      expect(r.meta?.provider).toBe("8AB");
      expect(r.meta?.instance).toBe("123456789");
      expect(r.meta?.check).toBe("W");
    });

    it("normalises Hubject-style separators", () => {
      const r = classifyIdTagFormat("DE-8AB-123456789-W");
      expect(r.detectedKind).toBe("emaid");
      expect(r.meta?.country).toBe("DE");
    });

    it("rejects strings that look EMAID-shaped but aren't 15 chars", () => {
      expect(classifyIdTagFormat("DE8AB12345678W").detectedKind).not.toBe("emaid"); // 14 chars
      expect(classifyIdTagFormat("DE8AB1234567890XY").detectedKind).not.toBe("emaid"); // 17 chars
    });
  });

  describe("key codes", () => {
    it("classifies 4-8 digit numeric codes as key_code", () => {
      expect(classifyIdTagFormat("1234").detectedKind).toBe("key_code");
      expect(classifyIdTagFormat("12345678").detectedKind).toBe("key_code");
    });

    it("rejects too-short numerics as unknown", () => {
      expect(classifyIdTagFormat("123").detectedKind).toBe("unknown");
    });

    it("rejects too-long numerics as unknown", () => {
      expect(classifyIdTagFormat("123456789").detectedKind).toBe("unknown");
    });
  });

  describe("edge cases", () => {
    it("returns unknown for null/undefined/empty", () => {
      expect(classifyIdTagFormat(null).detectedKind).toBe("unknown");
      expect(classifyIdTagFormat(undefined).detectedKind).toBe("unknown");
      expect(classifyIdTagFormat("").detectedKind).toBe("unknown");
      expect(classifyIdTagFormat("   ").detectedKind).toBe("unknown");
    });

    it("returns unknown for arbitrary strings", () => {
      expect(classifyIdTagFormat("not-a-tag").detectedKind).toBe("unknown");
      expect(classifyIdTagFormat("ABC").detectedKind).toBe("unknown");
    });

    it("returns unknown for hex-shaped strings of wrong length", () => {
      expect(classifyIdTagFormat("ABC").detectedKind).toBe("unknown"); // 3 hex
      expect(classifyIdTagFormat("0123456789").detectedKind).toBe("unknown"); // 10 chars — also looks like a key_code but length is too long
    });
  });

  describe("idTagKindLabel — human readable badges", () => {
    it("maps each kind to its label", () => {
      expect(idTagKindLabel("iso14443_4byte")).toBe("RFID (4-byte UID)");
      expect(idTagKindLabel("iso14443_7byte")).toBe("RFID (7-byte UID)");
      expect(idTagKindLabel("evccid_mac")).toBe("Vehicle MAC (EVCCID)");
      expect(idTagKindLabel("emaid")).toBe("EMAID (PnC contract)");
      expect(idTagKindLabel("key_code")).toBe("Numeric code");
      expect(idTagKindLabel("unknown")).toBe("Unknown format");
    });
  });
});
