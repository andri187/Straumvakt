// DSO resolution — the contract.
//
// The headline test in this file is "postal code is not the authority".
// Everything else supports it.

import { describe, expect, it } from "vitest";
import {
  BOUNDARY_MARGIN_M,
  haversineDistanceM,
  MAX_ATTRIBUTION_DISTANCE_M,
  needsManualConfirmation,
  resolveDso,
  formatKm,
} from "./dso-resolve";
import { DEMO_ADDRESSES } from "./address-fixtures";
import { ALL_DSO_SAMPLES, classifyAreaType, DSO_AREA_SAMPLES } from "./dso-service-areas";

const byId = (hnitnum: string) => {
  const record = DEMO_ADDRESSES.find((a) => a.hnitnum === hnitnum);
  if (!record) throw new Error(`fixture_missing:${hnitnum}`);
  return record;
};
const resolveFixture = (hnitnum: string) => {
  const r = byId(hnitnum);
  return resolveDso({ lat: r.lat, lng: r.lng });
};

describe("postal code is NOT the authority — the whole point", () => {
  const east = byId("demo-0005"); // Garðatorg 7, 210 Garðabær
  const west = byId("demo-0006"); // Hraunsholtsbraut 14, 210 Garðabær

  it("gives two addresses with the SAME postal code DIFFERENT operators", () => {
    expect(east.postnr).toBe("210");
    expect(west.postnr).toBe(east.postnr);
    expect(resolveDso({ lat: east.lat, lng: east.lng }).dso).toBe("Veitur");
    expect(resolveDso({ lat: west.lat, lng: west.lng }).dso).toBe("HS Veitur");
  });

  it("keeps those two addresses genuinely close together", () => {
    // If they drifted apart this test would stop demonstrating anything.
    const metres = haversineDistanceM(
      { lat: east.lat, lng: east.lng },
      { lat: west.lat, lng: west.lng },
    );
    expect(metres).toBeLessThan(1_000);
    expect(metres).toBeGreaterThan(100);
  });

  it("cannot consult a postal code even if it wanted to", () => {
    // Structural guarantee: the resolver takes a coordinate. There is no
    // postal code in its input, so no future edit can quietly start keying
    // on one without changing the signature.
    const result = resolveDso({ lat: east.lat, lng: east.lng });
    expect(Object.keys(result)).not.toContain("postnr");
    expect(resolveDso.length).toBeLessThanOrEqual(2);
  });

  it("flags both sides of the split as needing a human", () => {
    for (const record of [east, west]) {
      const r = resolveDso({ lat: record.lat, lng: record.lng });
      expect(r.confidence).toBe("near-boundary");
      expect(needsManualConfirmation(r)).toBe(true);
    }
  });
});

describe("clean urban resolutions", () => {
  it.each([
    ["demo-0001", "Veitur", "Stór-Reykjavíkursvæði"],
    ["demo-0002", "Veitur", "Stór-Reykjavíkursvæði"],
    ["demo-0007", "HS Veitur", "Reykjanes"],
    ["demo-0008", "HS Veitur", "Reykjanes"],
    ["demo-0012", "HS Veitur", "Selfoss"],
    ["demo-0018", "HS Veitur", "Vestmannaeyjar"],
    ["demo-0023", "Orkubú Vestfjarða", "Ísafjörður"],
    ["demo-0027", "Norðurorka", "Akureyri"],
    ["demo-0033", "RARIK", "Egilsstaður"],
  ])("%s resolves to %s / %s", (id, dso, area) => {
    const r = resolveFixture(id);
    expect(r.dso).toBe(dso);
    expect(r.serviceArea).toBe(area);
    expect(r.source).toBe("polygon-derived-fixture");
  });

  it("resolves Reykjavík with high confidence", () => {
    const r = resolveFixture("demo-0001");
    expect(r.confidence).toBe("exact");
    expect(needsManualConfirmation(r)).toBe(false);
  });
});

describe("the sampled data contradicts the obvious guesses", () => {
  it("puts Hveragerði with RARIK, not HS Veitur", () => {
    // It sits between two HS Veitur areas, which is exactly why guessing
    // from geography or postcode fails here.
    expect(resolveFixture("demo-0013").dso).toBe("RARIK");
  });

  it("puts Dalvík and Húsavík with RARIK, not Norðurorka", () => {
    expect(resolveFixture("demo-0028").dso).toBe("RARIK");
    expect(resolveFixture("demo-0029").dso).toBe("RARIK");
  });

  it("keeps Norðurorka's area to Akureyri itself", () => {
    const areas = DSO_AREA_SAMPLES.filter((s) => s.dso === "Norðurorka");
    expect(areas).toHaveLength(1);
    expect(areas[0]!.serviceArea).toBe("Akureyri");
  });

  it("puts Akranes with Veitur but in its OWN tariff area", () => {
    const r = resolveFixture("demo-0020");
    expect(r.dso).toBe("Veitur");
    expect(r.serviceArea).toBe("Akranes");
    expect(r.serviceArea).not.toBe("Stór-Reykjavíkursvæði");
    expect(r.areaId).toBe(9);
  });
});

describe("coverage gaps produce manual review, not a wrong answer", () => {
  it("returns no operator for the Patreksfjörður outskirts address", () => {
    const r = resolveFixture("demo-0026");
    expect(r.dso).toBeNull();
    expect(r.confidence).toBe("manual-review");
    expect(r.source).toBe("unresolved");
    expect(r.explanation).toMatch(/no polygon/i);
  });

  it("still resolves the Patreksfjörður town address 400 m away", () => {
    // The pair is the evidence that the gap is a property of the polygons
    // and not of the query.
    const r = resolveFixture("demo-0025");
    expect(r.dso).toBe("Orkubú Vestfjarða");
  });

  it("returns no operator for the undeveloped capital-region address", () => {
    const r = resolveFixture("demo-0040");
    expect(r.dso).toBeNull();
    expect(r.confidence).toBe("manual-review");
  });

  it("returns manual review far out at sea", () => {
    const r = resolveDso({ lat: 60.0, lng: -30.0 });
    expect(r.confidence).toBe("manual-review");
    expect(r.dso).toBeNull();
    expect(r.explanation).toMatch(/too far/i);
  });

  it("returns manual review when there is no data at all", () => {
    const r = resolveDso({ lat: 64.1, lng: -21.9 }, []);
    expect(r.confidence).toBe("manual-review");
    expect(r.explanation).toMatch(/no service-area data/i);
  });
});

describe("nothing may bill without a human", () => {
  it("marks EVERY fixture address as requiring admin confirmation", () => {
    for (const record of DEMO_ADDRESSES) {
      const r = resolveDso({ lat: record.lat, lng: record.lng });
      expect(r.billingApplicability).toBe("requires-admin-confirmation");
    }
  });

  it("marks even an exact match as requiring confirmation", () => {
    const r = resolveFixture("demo-0001");
    expect(r.confidence).toBe("exact");
    expect(r.billingApplicability).toBe("requires-admin-confirmation");
  });

  it("treats anything other than exact as needing a human", () => {
    for (const record of DEMO_ADDRESSES) {
      const r = resolveDso({ lat: record.lat, lng: record.lng });
      if (r.confidence !== "exact") expect(needsManualConfirmation(r)).toBe(true);
    }
  });
});

describe("tariff class", () => {
  it("reports rural for the dreifbýli fixtures", () => {
    expect(resolveFixture("demo-0038").areaClass).toBe("rural");
    expect(resolveFixture("demo-0039").areaClass).toBe("rural");
  });

  it("reports urban for a town centre", () => {
    expect(resolveFixture("demo-0001").areaClass).toBe("urban");
  });

  it("normalises BOTH upstream spellings of Þéttbýli", () => {
    // The source data really does spell it two ways; RARIK rows drop the
    // accent on the í. Normalising is not cosmetic — the tariff class is
    // what makes rural and urban price differently.
    expect(classifyAreaType("Þéttbýli")).toBe("urban");
    expect(classifyAreaType("Þéttbyli")).toBe("urban");
    expect(classifyAreaType("Dreifbýli")).toBe("rural");
    expect(classifyAreaType(null)).toBeNull();
    expect(classifyAreaType("Eitthvað annað")).toBeNull();
  });

  it("keeps upstream typos verbatim rather than silently correcting them", () => {
    const raw = DSO_AREA_SAMPLES.map((s) => s.rawAreaType);
    expect(raw).toContain("Þéttbyli");
    const areas = DSO_AREA_SAMPLES.map((s) => s.serviceArea);
    expect(areas).toContain("Hvólsvöllur");
    expect(areas).toContain("Neskaupsstaður");
  });
});

describe("distance helpers", () => {
  it("measures a known short hop sensibly", () => {
    const metres = haversineDistanceM({ lat: 64.1466, lng: -21.9367 }, { lat: 64.1566, lng: -21.9367 });
    expect(metres).toBeGreaterThan(1_090);
    expect(metres).toBeLessThan(1_130);
  });

  it("is zero for the same point and symmetric", () => {
    const a = { lat: 64.1, lng: -21.9 };
    const b = { lat: 65.7, lng: -18.1 };
    expect(haversineDistanceM(a, a)).toBe(0);
    expect(haversineDistanceM(a, b)).toBeCloseTo(haversineDistanceM(b, a), 6);
  });

  it("formats metres below a kilometre and kilometres above", () => {
    expect(formatKm(430)).toBe("430 m");
    expect(formatKm(1_500)).toBe("1.5 km");
    expect(formatKm(42_000)).toBe("42 km");
  });
});

describe("thresholds are coherent", () => {
  it("keeps the boundary margin well inside the attribution radius", () => {
    expect(BOUNDARY_MARGIN_M).toBeLessThan(MAX_ATTRIBUTION_DISTANCE_M);
  });

  it("covers all five operators in the sample set", () => {
    const operators = new Set(DSO_AREA_SAMPLES.map((s) => s.dso));
    expect(operators).toEqual(
      new Set(["Veitur", "HS Veitur", "RARIK", "Norðurorka", "Orkubú Vestfjarða"]),
    );
  });

  it("records coverage gaps alongside hits", () => {
    expect(ALL_DSO_SAMPLES.some((s) => s.dso === null)).toBe(true);
    expect(ALL_DSO_SAMPLES.length).toBeGreaterThan(DSO_AREA_SAMPLES.length);
  });
});
