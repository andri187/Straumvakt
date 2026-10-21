// Address search — the contract.

import { describe, expect, it } from "vitest";
import {
  DEFAULT_SEARCH_LIMIT,
  foldIcelandic,
  scoreRecord,
  searchAddresses,
  searchKey,
} from "./address-search";
import { DEMO_ADDRESSES, formatAddress, type HmsAddressRecord } from "./address-fixtures";

const ids = (query: string) => searchAddresses(query).map((h) => h.record.hnitnum);

describe("Icelandic folding", () => {
  it("folds accented vowels to their bare forms", () => {
    expect(foldIcelandic("Garðatorg")).toBe("gardatorg");
    expect(foldIcelandic("Glerárgata")).toBe("glerargata");
    expect(foldIcelandic("Ísafjörður")).toBe("isafjordur");
  });

  it("TRANSLITERATES þ and æ rather than stripping them", () => {
    // NFD normalisation would leave these unchanged and the search would
    // silently fail for anyone typing on an English keyboard.
    expect(foldIcelandic("Þverholt")).toBe("thverholt");
    expect(foldIcelandic("Ægisgata")).toBe("aegisgata");
    expect(foldIcelandic("Þórshöfn")).toBe("thorshofn");
  });

  it("builds a comparable key from messy input", () => {
    expect(searchKey("  Garðatorg   7 , 210 ")).toBe("gardatorg 7 210");
    expect(searchKey("!!!")).toBe("");
  });
});

describe("finding addresses", () => {
  it("finds an address typed with correct Icelandic spelling", () => {
    expect(ids("Garðatorg")).toContain("demo-0005");
  });

  it("finds the same address typed in plain ASCII", () => {
    expect(ids("gardatorg")).toContain("demo-0005");
  });

  it("finds a Þ street typed as 'th'", () => {
    expect(ids("thverholt")).toContain("demo-0004");
  });

  it("matches on municipality", () => {
    expect(ids("akureyri")).toContain("demo-0027");
  });

  it("matches on postal code", () => {
    const hits = ids("210");
    expect(hits).toContain("demo-0005");
    expect(hits).toContain("demo-0006");
  });

  it("narrows with a house number", () => {
    const hits = searchAddresses("garðatorg 7");
    expect(hits[0]!.record.hnitnum).toBe("demo-0005");
  });

  it("requires EVERY term to match", () => {
    // "garðatorg akureyri" is a contradiction and must return nothing,
    // rather than everything that matched either half.
    expect(searchAddresses("garðatorg akureyri")).toEqual([]);
  });

  it("returns nothing for a query that matches nothing", () => {
    expect(searchAddresses("zzzzzz")).toEqual([]);
  });

  it("ignores a query that is too short to rank", () => {
    expect(searchAddresses("")).toEqual([]);
    expect(searchAddresses("a")).toEqual([]);
    expect(searchAddresses("   ")).toEqual([]);
  });

  it("caps the result count", () => {
    const many = searchAddresses("a", DEMO_ADDRESSES, 3);
    expect(many.length).toBeLessThanOrEqual(3);
    expect(searchAddresses("gata").length).toBeLessThanOrEqual(DEFAULT_SEARCH_LIMIT);
  });
});

describe("ranking", () => {
  it("prefers an exact street name over a partial one", () => {
    const exact = scoreRecord(byId("demo-0005"), "Garðatorg");
    const partial = scoreRecord(byId("demo-0005"), "Garða");
    expect(exact).toBeGreaterThan(partial);
  });

  it("scores a non-match at zero", () => {
    expect(scoreRecord(byId("demo-0005"), "Akureyri")).toBe(0);
  });

  it("is stable — the same query gives the same order twice", () => {
    expect(ids("a")).toEqual(ids("a"));
  });

  it("orders by score descending", () => {
    const hits = searchAddresses("gata");
    for (let i = 1; i < hits.length; i++) {
      expect(hits[i - 1]!.score).toBeGreaterThanOrEqual(hits[i]!.score);
    }
  });
});

describe("the demo address set", () => {
  it("has unique identifiers", () => {
    const seen = new Set(DEMO_ADDRESSES.map((a) => a.hnitnum));
    expect(seen.size).toBe(DEMO_ADDRESSES.length);
  });

  it("reaches the 30-case coverage target", () => {
    expect(DEMO_ADDRESSES.length).toBeGreaterThanOrEqual(30);
  });

  it("keeps every coordinate inside Iceland", () => {
    for (const a of DEMO_ADDRESSES) {
      expect(a.lat).toBeGreaterThan(63.0);
      expect(a.lat).toBeLessThan(67.0);
      expect(a.lng).toBeGreaterThan(-25.0);
      expect(a.lng).toBeLessThan(-13.0);
    }
  });

  it("uses three-digit Icelandic postal codes", () => {
    for (const a of DEMO_ADDRESSES) expect(a.postnr).toMatch(/^\d{3}$/);
  });

  it("formats a display address the Icelandic way", () => {
    expect(formatAddress(byId("demo-0001"))).toBe("Laugavegur 26, 101 Reykjavík");
  });

  it("marks every identifier as a demo id", () => {
    // Nothing here may be mistaken for a real Staðfangaskrá hnitnum.
    for (const a of DEMO_ADDRESSES) expect(a.hnitnum).toMatch(/^demo-\d{4}$/);
  });
});

function byId(hnitnum: string): HmsAddressRecord {
  const record = DEMO_ADDRESSES.find((a) => a.hnitnum === hnitnum);
  if (!record) throw new Error(`fixture_missing:${hnitnum}`);
  return record;
}
