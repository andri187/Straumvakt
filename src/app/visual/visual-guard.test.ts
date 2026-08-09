import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(process.cwd(), "src/app/visual");
const page = fs.readFileSync(path.join(root, "page.tsx"), "utf8");
const client = fs.readFileSync(path.join(root, "visual-studio.tsx"), "utf8");
const data = fs.readFileSync(path.join(root, "visual-data.ts"), "utf8");
const middleware = fs.readFileSync(path.resolve(process.cwd(), "src/middleware.ts"), "utf8");
const wrangler = fs.readFileSync(path.resolve(process.cwd(), "wrangler.jsonc"), "utf8");

describe("visual-only route boundary", () => {
  it("uses the same explicit local environment gate", () => {
    expect(page).toContain('STRAUMVAKT_LOCAL_PRODUCT_PREVIEW !== "1"');
    expect(page).toContain("notFound()");
    expect(middleware).toContain('pathname === "/visual"');
  });

  it("does not enable the visual flag in deployment config", () => {
    expect(wrangler).not.toContain("STRAUMVAKT_LOCAL_PRODUCT_PREVIEW");
  });

  it("imports no API client", () => {
    expect(page + client + data).not.toMatch(/api-client|StraumvaktApi|apiFetch/);
  });

  it("makes no browser network request", () => {
    expect(client).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|WebSocket\s*\(/);
  });

  it("contains no API path literal", () => {
    expect(page + client + data).not.toContain("/api/");
  });

  it("uses no live-looking email address", () => {
    const emails = data.match(/[\w.+-]+@[\w.-]+/g) ?? [];
    expect(emails.length).toBeGreaterThanOrEqual(4);
    expect(emails.every((email) => email.endsWith(".test"))).toBe(true);
  });

  it("labels the route as a visual preview", () => {
    expect(client).toContain("Visual preview / demo data");
  });

  it("provides a keyboard skip link", () => {
    expect(client).toContain('href="#visual-content"');
    expect(client).toContain('id="visual-content"');
  });

  it("uses native navigation and table semantics", () => {
    expect(client).toContain("<nav");
    expect(client).toContain("<table>");
    expect(client).toContain("<caption>");
    expect(client).toContain('scope="col"');
  });

  it("includes reduced-motion and forced-color fallbacks", () => {
    const css = fs.readFileSync(path.join(root, "visual.css"), "utf8");
    expect(css).toContain("prefers-reduced-motion");
    expect(css).toContain("forced-colors:active");
  });
});
