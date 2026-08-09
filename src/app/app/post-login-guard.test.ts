import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const appRoot = path.resolve(process.cwd(), "src/app/app");
const loginRoot = path.resolve(process.cwd(), "src/app/login-demo");
const page = fs.readFileSync(path.join(appRoot, "[persona]", "[[...screen]]", "page.tsx"), "utf8");
const indexPage = fs.readFileSync(path.join(appRoot, "page.tsx"), "utf8");
const shell = fs.readFileSync(path.join(appRoot, "post-login-shell.tsx"), "utf8");
const data = fs.readFileSync(path.join(appRoot, "post-login-data.ts"), "utf8");
const css = fs.readFileSync(path.join(appRoot, "post-login.css"), "utf8");
const login = fs.readFileSync(path.join(loginRoot, "page.tsx"), "utf8");
const middleware = fs.readFileSync(path.resolve(process.cwd(), "src/middleware.ts"), "utf8");
const wrangler = fs.readFileSync(path.resolve(process.cwd(), "wrangler.jsonc"), "utf8");
const runtimeSource = [page, indexPage, shell, data, login].join("\n");

describe("local post-login route boundary", () => {
  it("guards every server entry with the local preview flag", () => {
    expect(page).toContain('STRAUMVAKT_LOCAL_PRODUCT_PREVIEW !== "1"');
    expect(indexPage).toContain('STRAUMVAKT_LOCAL_PRODUCT_PREVIEW !== "1"');
    expect(login).toContain('STRAUMVAKT_LOCAL_PRODUCT_PREVIEW !== "1"');
  });

  it("allows the local routes in middleware only under the same flag", () => {
    expect(middleware).toContain('pathname === "/login-demo"');
    expect(middleware).toContain('pathname.startsWith("/app/")');
    expect(middleware).toContain('STRAUMVAKT_LOCAL_PRODUCT_PREVIEW === "1"');
  });

  it("does not ship the local flag in Worker configuration", () => {
    expect(wrangler).not.toContain("STRAUMVAKT_LOCAL_PRODUCT_PREVIEW");
  });

  it("contains no network client or API path", () => {
    expect(runtimeSource).not.toMatch(/\bfetch\s*\(/);
    expect(runtimeSource).not.toContain("apiFetch");
    expect(runtimeSource).not.toContain("/api/");
  });

  it("labels the entry as local and does not claim production login", () => {
    expect(login).toContain("Local visual demo");
    expect(login).toContain("No authentication occurs");
    expect(login.toLowerCase()).not.toContain("production login");
  });

  it("uses no password form or submission handler", () => {
    expect(login).not.toContain('type="password"');
    expect(login).not.toContain("onSubmit");
    expect(login).toContain("No password is accepted or transmitted");
  });

  it("disables application actions and explains the boundary", () => {
    expect(shell).toMatch(/<button type="button" disabled aria-describedby="demo-action-boundary">/);
    expect(shell).toContain("Data-changing actions are unavailable");
    expect(shell).not.toContain("onSubmit");
  });

  it("does not render a charger visibility control", () => {
    expect(runtimeSource.toLowerCase()).not.toContain("charger visibility");
    expect(runtimeSource).not.toContain("Configure visibility");
  });

  it("marks money-like output as demo or read only", () => {
    expect(shell).toContain("Demo / read only");
    expect(shell).toContain("isMoney(cell)");
    expect(shell).toContain("Local demo data only");
  });

  it("has no zero-power literal or backend field name", () => {
    expect(runtimeSource).not.toMatch(/0(?:\.0)?\s*kW/i);
    expect(runtimeSource).not.toContain("powerKw");
  });

  it("provides semantic navigation and table structure", () => {
    expect(shell).toContain('aria-label="Workspace pages"');
    expect(shell).toContain('aria-current={current ? "page" : undefined}');
    expect(shell).toContain('scope="col"');
    expect(shell).toContain("<caption>");
    expect(shell).toContain('aria-live="polite"');
  });

  it("provides keyboard and mobile navigation controls", () => {
    expect(shell).toContain('href="#post-login-content"');
    expect(shell).toContain('aria-label="Open navigation"');
    expect(shell).toContain('aria-label="Close navigation"');
    expect(shell).toContain('aria-label="Close navigation overlay"');
  });

  it("contains responsive and accessibility fallbacks", () => {
    expect(css).toContain("@media(max-width:860px)");
    expect(css).toContain("@media(max-width:430px)");
    expect(css).toContain("@media(prefers-reduced-motion:reduce)");
    expect(css).toContain("@media(forced-colors:active)");
    expect(css).toContain("overflow:auto");
  });
});
