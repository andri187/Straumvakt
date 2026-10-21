import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const client = readFileSync(join(here, "preview-client.tsx"), "utf8");
const page = readFileSync(join(here, "page.tsx"), "utf8");
const middleware = readFileSync(join(here, "../../../middleware.ts"), "utf8");

describe("local preview containment", () => {
  it("does not import either API client", () => {
    expect(client).not.toMatch(/api-client|apiFetch|StraumvaktApi/);
  });
  it("does not call fetch", () => {
    expect(client).not.toMatch(/\bfetch\s*\(/);
  });
  it("uses reserved test email domains", () => {
    const emails = [...client.matchAll(/[\w.-]+@[\w.-]+/g)].map((match) => match[0]);
    expect(emails.length).toBeGreaterThan(0);
    expect(emails.every((email) => email.endsWith(".test"))).toBe(true);
  });
  it("labels itself as a local preview", () => {
    expect(client).toContain("Local preview");
  });
  it("returns not found without the exact environment flag", () => {
    expect(page).toContain('STRAUMVAKT_LOCAL_PRODUCT_PREVIEW !== "1"');
    expect(page).toContain("notFound()");
  });
  it("middleware exception uses the same exact environment flag", () => {
    expect(middleware).toContain('STRAUMVAKT_LOCAL_PRODUCT_PREVIEW === "1"');
    expect(middleware).toContain('pathname === "/local/product-preview"');
  });
  it("the preview flag is absent from Wrangler config", () => {
    const wrangler = readFileSync(join(here, "../../../../wrangler.jsonc"), "utf8");
    expect(wrangler).not.toContain("STRAUMVAKT_LOCAL_PRODUCT_PREVIEW");
  });
});
