import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(process.cwd(), "src/app/app");
const data = fs.readFileSync(path.join(root, "core-product-data.ts"), "utf8");
const backendContract = fs.readFileSync(path.join(root, "core-backend-contract-data.ts"), "utf8");
const integration = fs.readFileSync(path.join(root, "core-integration-quality-data.ts"), "utf8");
const shell = fs.readFileSync(path.join(root, "post-login-shell.tsx"), "utf8");
const css = fs.readFileSync(path.join(root, "post-login.css"), "utf8");
const runtime = `${data}\n${backendContract}\n${integration}\n${shell}`;

describe("Core product visual guard", () => {
  it("contains no request client", () => {
    expect(runtime).not.toMatch(/\bfetch\s*\(/);
    expect(runtime).not.toContain("apiFetch");
    expect(runtime).not.toContain("/api/");
  });
  it("contains no persistence form", () => {
    expect(runtime).not.toContain("onSubmit");
    expect(runtime).not.toContain('method="POST"');
  });
  it("states the Iceland-only market and timezone", () => {
    expect(data).toContain("Iceland only / UTC+0");
    expect(shell).toContain("Iceland / ISK / UTC+0");
  });
  it("shows all locked Core pricing terms", () => {
    expect(data).toContain("CORE_CONNECTOR_RATE_ISK = 200");
    expect(data).toContain("CORE_ACTIVE_DRIVER_RATE_ISK = 50");
    expect(data).toContain("CORE_CAP_PER_CONNECTOR_ISK = 450");
  });
  it("shows DSO, retailer, CPO, plug-time and grace controls", () => {
    expect(data).toContain("DSO / network");
    expect(data).toContain("Electricity retailer");
    expect(data).toContain("CPO add-on");
    expect(data).toContain("Plug-time fee");
    expect(data).toContain("gracePeriod");
  });
  it("shows rate version and effective dates", () => {
    expect(data).toContain("rateVersion");
    expect(data).toContain("effectiveFrom");
    expect(data).toContain("Effective rate version");
  });
  it("shows CDR-backed billing material and corrections", () => {
    expect(data).toContain("CDR-backed");
    expect(data).toContain("Correction ADJ-04");
    expect(data).toContain("adjustmentIsk");
  });
  it("holds only anomalous sessions after the meter-delta fix", () => {
    expect(backendContract).toContain("meterStop");
    expect(backendContract).toContain("Verified meter delta");
    expect(backendContract).toContain("billing engine uses meter stop minus meter start");
    expect(backendContract).toContain("hold only this session");
  });
  it("distinguishes CDR shape from price authority", () => {
    expect(backendContract).toContain("CDR-shaped");
    expect(backendContract).toContain("Shape is not authority");
    expect(backendContract).toContain("Pending source check");
  });
  it("shows the heartbeat fast path while verification remains incomplete", () => {
    expect(backendContract).toContain("heartbeat fast path exists in source");
    expect(backendContract).toContain("gateway-suite/toolchain completion");
    expect(backendContract).toContain("Deployment\", \"Unverified");
  });
  it("states that the connector frame cap is missing", () => {
    expect(backendContract).toContain("No per-connector frame cap");
    expect(backendContract).not.toContain("Frame cap enabled");
  });
  it("keeps manual driver authority blocked", () => {
    expect(backendContract).toContain("Manual driver management authority is not proven");
    expect(backendContract).toMatch(/action: "Add driver manually"[\s\S]*notice:/);
  });
  it("credits the fixed meter engine without clearing per-session holds", () => {
    expect(integration).toContain("Engine\", \"Delta fixed");
    expect(integration).toContain("per-session evidence hold");
    expect(integration).not.toContain("billing engine still uses meter stop as energy");
  });
  it("credits the fast path without claiming deployed queue proof", () => {
    expect(integration).toContain("Fast path\", \"Exists");
    expect(integration).toContain("Deployment\", \"Unverified");
    expect(integration).toContain("queue deployment state remains unknown");
  });
  it("states that the offline sweep is missing", () => {
    expect(integration).toContain("offline reconciliation sweep is not built");
    expect(integration).not.toContain("Offline sweep active");
  });
  it("holds mismatch and unlabelled CDR authority", () => {
    expect(integration).toContain("CDR mismatch review");
    expect(integration).toContain("Price source is not labelled");
    expect(integration).toContain("not labelled CDR-ready");
  });
  it("shows delivery while refusing bank claims", () => {
    expect(data).toContain("Billing delivery log");
    expect(data).toContain("No bank integration");
    expect(data).not.toMatch(/bank connected|bank export ready|payment sent/i);
  });
  it("keeps invite-by-link gated", () => {
    expect(data).toContain("Invite link");
    expect(data).toContain("identity-bound backend path");
    expect(data).not.toContain("Invite sent successfully");
  });
  it("keeps period close and export disabled", () => {
    expect(data).toMatch(/action: "Lock billing period", actionDisabled: true/);
    expect(data).toMatch(/action: "Export report", actionDisabled: true/);
    expect(data).toMatch(/action: "Download statement", actionDisabled: true/);
  });
  it("keeps Premium capabilities outside actions", () => {
    const actions = [...data.matchAll(/action: "([^"]+)"/g)].map((match) => match[1]).join(" ");
    expect(actions).not.toMatch(/custom integration|contractor|service|live telemetry|payroll/i);
  });
  it("does not represent a raw telemetry livestream", () => {
    expect(data).toContain("No live-stream claim");
    expect(data).toContain("No raw telemetry livestream");
  });
  it("marks money-like output at the render boundary", () => {
    expect(shell).toContain("Demo / read only");
    expect(shell).toContain("isMoney(cell)");
  });
  it("provides a semantic Core contract section", () => {
    expect(shell).toContain('aria-labelledby="core-contract-title"');
    expect(shell).toContain('id="core-contract-title"');
  });
  it("keeps Core panels responsive", () => {
    expect(css).toContain(".pl-core-contract>div{display:grid");
    expect(css).toContain(".pl-metrics,.pl-core-contract>div{grid-template-columns:1fr 1fr}");
    expect(css).toContain(".pl-metrics,.pl-core-contract>div{grid-template-columns:1fr}");
  });
  it("supports reduced motion and forced colors", () => {
    expect(css).toContain("prefers-reduced-motion:reduce");
    expect(css).toContain("forced-colors:active");
  });
  it("restores visible focus after the filter removes its native outline", () => {
    expect(css).toContain(".pl-root input:focus-visible");
    expect(css).toContain("outline:2px solid var(--pl-accent)");
    expect(css).toContain(".pl-search:focus-within");
    expect(css).toContain(".pl-table-scroll:focus-visible");
  });
});
