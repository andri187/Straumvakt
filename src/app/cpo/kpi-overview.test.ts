import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { sharedLoginActor, type Actor } from "@/lib/installations/actor";
import { canViewPlatformKpis, KPIS, KpiOverview } from "./kpi-overview";
import CpoOverviewPage from "./page";
import { currentActor } from "@/lib/installations/session";

vi.mock("@/lib/installations/session", () => ({ currentActor: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => { throw new Error(`redirect:${path}`); },
  notFound: () => { throw new Error("not-found"); },
}));

const html = () => renderToStaticMarkup(createElement(KpiOverview));

describe("KPI overview access", () => {
  it("redirects anonymous page requests before returning KPI content", async () => {
    vi.mocked(currentActor).mockResolvedValue(null);
    await expect(CpoOverviewPage()).rejects.toThrow("redirect:/signin");
  });

  it("denies other actors at the page boundary", async () => {
    vi.mocked(currentActor).mockResolvedValue({ kind: "cpo_user", platformOperator: true } as unknown as Actor);
    await expect(CpoOverviewPage()).rejects.toThrow("not-found");
  });

  it("renders the overview for the verified shared actor", async () => {
    vi.mocked(currentActor).mockResolvedValue(sharedLoginActor("Straumvakt"));
    const out = renderToStaticMarkup(await CpoOverviewPage());
    expect(out).toContain("Command correctness");
    expect(out).toContain("Not measured");
  });
  it("allows only the verified shared test login", () => {
    expect(canViewPlatformKpis(sharedLoginActor("Straumvakt"))).toBe(true);
    expect(canViewPlatformKpis(null)).toBe(false);
  });

  it("denies any other or malformed actor by default", () => {
    const other = { kind: "cpo_user", label: "x", platformOperator: false } as unknown as Actor;
    const flagOnly = { kind: "cpo_user", label: "x", platformOperator: true } as unknown as Actor;
    const kindOnly = { kind: "shared_login", label: "x", platformOperator: false } as unknown as Actor;
    expect(canViewPlatformKpis(other)).toBe(false);
    expect(canViewPlatformKpis(flagOnly)).toBe(false);
    expect(canViewPlatformKpis(kindOnly)).toBe(false);
  });
});

describe("KPI overview content", () => {
  it("shows the six agreed groups in order", () => {
    expect(KPIS.map((k) => k.name)).toEqual([
      "Command correctness",
      "Session and financial recovery",
      "UI database amplification",
      "Live-data freshness",
      "Processing efficiency",
      "Total recurring OPEX per billable connector",
    ]);
    const out = html();
    for (const k of KPIS) expect(out).toContain(k.name);
  });

  it("marks every live value Not measured, with no invented figure or success state", () => {
    const out = html();
    expect(out.match(/Not measured/g)?.length).toBeGreaterThanOrEqual(KPIS.length);
    expect(out).not.toMatch(/\b(OK|Healthy|Passing|Green)\b/);
    expect(out).not.toMatch(/Observed:\s*0/);
    for (const k of KPIS) expect(k.source).toMatch(/^Unavailable/);
  });

  it("keeps targets labelled as proposals or goals, never as observations", () => {
    for (const k of KPIS) expect(k.target).toMatch(/proposed|goal/);
  });

  it("labels local test evidence with scope and date, and does not claim live data", () => {
    const out = html();
    expect(out).toContain("Local test · 2026-10-31 20:12 UTC");
    expect(out).toContain("1 wire send");
    expect(out).toContain("not 100 chargers");
    expect(out).toContain("Not billable cloud operations");
    expect(out).toContain("Local test results are not live measurements");
  });

  it("does not claim the OPEX goal is met", () => {
    const opex = KPIS.find((k) => k.key === "opex")!;
    expect(opex.evidence).toBeUndefined();
    expect(opex.target).toMatch(/goal, not a measured value/);
  });

  it("is server-rendered with native details and no controls or client data hooks", () => {
    const out = html();
    expect(out).toContain("<details");
    expect(out).toContain("<summary");
    expect(out).not.toContain("<button");
    expect(out).not.toMatch(/<script|fetch\(|href=/);
  });
});
