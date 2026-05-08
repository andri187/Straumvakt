import { describe, it, expect } from "vitest";
import { formatMac, lookupOuiVendor, redactMac } from "./lookup";

describe("OUI vendor lookup", () => {
  it("resolves a known Tesla MAC to vendor=Tesla", () => {
    const result = lookupOuiVendor("4C:FC:AA:11:22:33");
    expect(result.vendor).toBe("Tesla");
    expect(result.vendorRaw).toBe("Tesla, Inc.");
    expect(result.category).toBe("automotive");
    expect(result.oui).toBe("4CFCAA");
  });

  it("accepts dash-separated MACs", () => {
    expect(lookupOuiVendor("4C-FC-AA-11-22-33").vendor).toBe("Tesla");
  });

  it("accepts dotted MACs", () => {
    expect(lookupOuiVendor("4CFC.AA11.2233").vendor).toBe("Tesla");
  });

  it("accepts raw 12-hex MACs without separators", () => {
    expect(lookupOuiVendor("4CFCAA112233").vendor).toBe("Tesla");
  });

  it("normalizes case", () => {
    expect(lookupOuiVendor("4c:fc:aa:11:22:33").vendor).toBe("Tesla");
  });

  it("returns oui populated but vendor null for unknown OUI prefix", () => {
    const result = lookupOuiVendor("FF:EE:DD:11:22:33");
    expect(result.oui).toBe("FFEEDD");
    expect(result.vendor).toBeNull();
    expect(result.vendorRaw).toBeNull();
    expect(result.category).toBeNull();
  });

  it("returns all-null for invalid MACs", () => {
    expect(lookupOuiVendor("not-a-mac")).toEqual({
      oui: null,
      vendor: null,
      vendorRaw: null,
      category: null,
    });
    expect(lookupOuiVendor("12:34:56")).toEqual({
      oui: null,
      vendor: null,
      vendorRaw: null,
      category: null,
    });
  });

  it("handles null/undefined input", () => {
    expect(lookupOuiVendor(null)).toEqual({
      oui: null,
      vendor: null,
      vendorRaw: null,
      category: null,
    });
    expect(lookupOuiVendor(undefined)).toEqual({
      oui: null,
      vendor: null,
      vendorRaw: null,
      category: null,
    });
  });

  it("matches multiple Tesla OUIs", () => {
    expect(lookupOuiVendor("98:ED:5C:11:22:33").vendor).toBe("Tesla");
    expect(lookupOuiVendor("8C:84:5D:11:22:33").vendor).toBe("Tesla");
    expect(lookupOuiVendor("DC:44:76:11:22:33").vendor).toBe("Tesla");
  });

  it("maps VW Group brands to their normalized names", () => {
    expect(lookupOuiVendor("00:1A:1F:11:22:33").vendor).toBe("Volkswagen");
    expect(lookupOuiVendor("00:27:0B:11:22:33").vendor).toBe("Audi");
    expect(lookupOuiVendor("00:1E:8C:11:22:33").vendor).toBe("Porsche");
  });

  it("identifies PLC chipset vendors", () => {
    const result = lookupOuiVendor("00:17:F9:11:22:33");
    expect(result.vendor).toBe("Qualcomm Atheros");
    expect(result.category).toBe("plc_chipset");
  });

  it("identifies EV charger vendors", () => {
    expect(lookupOuiVendor("00:C0:7E:11:22:33").vendor).toBe("Zaptec");
    expect(lookupOuiVendor("00:C0:7E:11:22:33").category).toBe("ev_charger");
  });
});

describe("MAC formatting", () => {
  it("formats to colon-separated lowercase", () => {
    expect(formatMac("4CFCAA112233")).toBe("4c:fc:aa:11:22:33");
    expect(formatMac("4C-FC-AA-11-22-33")).toBe("4c:fc:aa:11:22:33");
    expect(formatMac("4c:fc:aa:11:22:33")).toBe("4c:fc:aa:11:22:33");
  });

  it("returns null for invalid input", () => {
    expect(formatMac("not-a-mac")).toBeNull();
    expect(formatMac(null)).toBeNull();
    expect(formatMac(undefined)).toBeNull();
  });
});

describe("MAC redaction (privacy)", () => {
  it("redacts the OUI portion (first 3 octets), preserves NIC tail", () => {
    expect(redactMac("4C:FC:AA:11:22:33")).toBe("xx:xx:xx:11:22:33");
    expect(redactMac("4cfcaa112233")).toBe("xx:xx:xx:11:22:33");
  });

  it("returns null for invalid MACs", () => {
    expect(redactMac("not-a-mac")).toBeNull();
    expect(redactMac(null)).toBeNull();
  });
});
