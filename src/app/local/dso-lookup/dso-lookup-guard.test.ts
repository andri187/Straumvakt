// Containment guards for the local DSO lookup route.
//
// Same idiom as src/app/local/product-preview/preview-guard.test.ts: read the
// source as text and assert the invariants that no unit test of behaviour can
// reach — that the route is gated, that the demo credential cannot become a
// real one, and that the screen does not overstate what is integrated.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const read = (relative: string) => readFileSync(join(here, relative), "utf8");

const page = read("page.tsx");
const client = read("dso-lookup-client.tsx");
/**
 * JSX wraps prose across lines, so a phrase that reads as one sentence in the
 * rendered UI is split by a newline and indentation in the source. Copy text
 * is asserted against this collapsed form; code patterns are asserted against
 * the raw source.
 */
const clientProse = client.replace(/\s+/g, " ");
const map = read("dso-map.tsx");
const credential = read("demo-credential.ts");
const fixtures = read("address-fixtures.ts");
const areas = read("dso-service-areas.ts");
const middleware = read("../../../middleware.ts");
const wrangler = read("../../../../wrangler.jsonc");

describe("the route is gated", () => {
  it("returns not found without the exact environment flag", () => {
    expect(page).toContain('STRAUMVAKT_LOCAL_PRODUCT_PREVIEW !== "1"');
    expect(page).toContain("notFound()");
  });

  it("is dynamic, so the guard cannot be frozen into a static page", () => {
    expect(page).toContain('export const dynamic = "force-dynamic"');
  });

  it("checks the flag BEFORE rendering anything", () => {
    expect(page.indexOf("notFound()")).toBeLessThan(page.indexOf("<DsoLookup"));
  });

  it("is allowlisted in middleware under the same flag", () => {
    // Without this the route is unreachable: an unauthenticated request to a
    // non-allowlisted path is redirected before the page's own guard runs.
    expect(middleware).toContain('pathname === "/local/dso-lookup"');
    expect(middleware).toContain('STRAUMVAKT_LOCAL_PRODUCT_PREVIEW === "1"');
  });

  it("reuses the existing flag rather than inventing a second one", () => {
    const flags = [...page.matchAll(/STRAUMVAKT_[A-Z_]+/g)].map((m) => m[0]);
    expect(new Set(flags)).toEqual(new Set(["STRAUMVAKT_LOCAL_PRODUCT_PREVIEW"]));
  });

  it("keeps the preview flag out of Wrangler config", () => {
    expect(wrangler).not.toContain("STRAUMVAKT_LOCAL_PRODUCT_PREVIEW");
  });
});

describe("the demo credential cannot become a real one", () => {
  it("lives in exactly one file", () => {
    // The literals must not spread. Everything else imports them.
    for (const [name, source] of [["client", client], ["map", map], ["page", page]] as const) {
      expect(`${name}:${/DEMO_PASSWORD\s*=/.test(source)}`).toBe(`${name}:false`);
    }
    expect(credential).toContain('export const DEMO_PASSWORD = "map"');
  });

  it("never mints a session, cookie or token", () => {
    for (const source of [credential, client]) {
      expect(source).not.toMatch(/document\.cookie|localStorage|sessionStorage/);
      expect(source).not.toMatch(/createAdminSession|verifyAdminSession|adminSessionConfig/);
      expect(source).not.toMatch(/\bjwt\b|signJwt|setCookie/i);
    }
  });

  it("says in the source that it is not authentication", () => {
    expect(credential).toMatch(/NOT authentication/i);
  });

  it("is never imported by the middleware or any server route", () => {
    expect(middleware).not.toContain("demo-credential");
    expect(middleware).not.toContain("checkDemoCredential");
  });
});

describe("the screen is network-silent apart from map imagery", () => {
  it("does not call fetch, XHR or a WebSocket", () => {
    for (const source of [client, map]) {
      expect(source).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|new WebSocket\s*\(/);
    }
  });

  it("does not import either API client", () => {
    for (const source of [client, map, page]) {
      expect(source).not.toMatch(/api-client|apiFetch|StraumvaktApi/);
    }
  });

  it("does not reach a Straumvakt API route", () => {
    for (const source of [client, map]) {
      expect(source).not.toMatch(/["'`]\/api\//);
    }
  });

  it("reaches only the two documented public map hosts", () => {
    const wms = read("wms.ts");
    const hosts = [...wms.matchAll(/https:\/\/([a-z0-9.-]+)/g)].map((m) => m[1]);
    expect(new Set(hosts)).toEqual(new Set(["ogc.gis.is", "tile.openstreetmap.org"]));
  });
});

describe("the screen does not overstate what is integrated", () => {
  it("labels itself a local preview", () => {
    expect(clientProse).toMatch(/Local preview/);
  });

  it("says the address records are demo data, not Staðfangaskrá", () => {
    expect(clientProse).toMatch(/Demo address records/);
    expect(clientProse).toMatch(/has not been imported/);
  });

  it("never claims a live HMS or Staðfangaskrá integration", () => {
    for (const source of [client, map, page]) {
      expect(source).not.toMatch(/HMS API|Staðfangaskrá API|live address lookup/i);
    }
  });

  it("states in the fixture file which parts are real and which are not", () => {
    expect(fixtures).toMatch(/ILLUSTRATIVE/);
    expect(fixtures).toMatch(/NOT real Staðfangaskrá records/);
  });

  it("records the provenance and date of the DSO samples", () => {
    expect(areas).toContain("ogc.gis.is/geoserver/orkustofnun/ows");
    expect(areas).toContain("2026-08-10");
    expect(areas).toMatch(/RECORDED RESPONSE/);
  });

  it("shows the sample harvest date in the UI", () => {
    expect(client).toContain("DSO_SAMPLE_HARVEST_DATE");
  });

  it("tells the user an admin must confirm before billing", () => {
    expect(clientProse).toMatch(/admin must confirm before billing/i);
    expect(client).toMatch(/requires-admin-confirmation|billingApplicability/);
  });

  it("says billing reads a versioned rate record rather than the map", () => {
    expect(clientProse).toMatch(/versioned DSO rate/i);
  });

  it("marks the override field as disabled in this demo", () => {
    expect(client).toMatch(/disabled/);
    expect(client).toMatch(/Override reason/i);
  });

  it("warns that Orkuspársvæði is not a DSO authority", () => {
    expect(clientProse).toMatch(/does not define distribution operators/i);
  });
});

describe("no real people or customers ship in the bundle", () => {
  it("contains no email addresses at all", () => {
    for (const source of [client, fixtures, areas, map]) {
      const emails = [...source.matchAll(/[\w.-]+@[\w.-]+\.\w+/g)].map((m) => m[0]);
      expect(emails).toEqual([]);
    }
  });

  it("uses only demo- prefixed address identifiers", () => {
    const ids = [...fixtures.matchAll(/hnitnum: "([^"]+)"/g)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThanOrEqual(30);
    expect(ids.every((id) => id!.startsWith("demo-"))).toBe(true);
  });

  it("names no organisation or person", () => {
    // The only proper nouns here should be places and distribution operators.
    expect(fixtures).not.toMatch(/kennitala|\bssn\b|personal/i);
  });
});

describe("the postal-code rule is enforced in the source, not only in tests", () => {
  it("keeps the resolver's input free of postal code", () => {
    const resolve = read("dso-resolve.ts");
    const signature = resolve.slice(resolve.indexOf("export function resolveDso"));
    expect(signature.slice(0, 200)).not.toMatch(/postnr|postalCode|postcode/);
  });

  it("says so in the module documentation", () => {
    expect(read("dso-resolve.ts")).toMatch(/Postal code is NOT the deciding authority/i);
  });

  it("labels the postal code as supportive in the UI", () => {
    expect(clientProse).toMatch(/never decides the operator/i);
  });
});
