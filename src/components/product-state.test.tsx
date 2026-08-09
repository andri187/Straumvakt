import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  ContractGate,
  MetricValue,
  ProductEmpty,
  ProductError,
  ProductLoading,
  StatusBadge,
} from "./product-state";

describe("product UI state components", () => {
  it("announces errors assertively", () => {
    const html = renderToStaticMarkup(<ProductError message="Network unavailable" />);
    expect(html).toContain('role="alert"');
    expect(html).toContain('aria-live="assertive"');
  });

  it("does not render a retry action without a handler", () => {
    const html = renderToStaticMarkup(<ProductError message="No route" />);
    expect(html).not.toContain("Try again");
  });

  it("renders a retry action when supplied", () => {
    const html = renderToStaticMarkup(
      <ProductError message="No route" onRetry={() => undefined} />,
    );
    expect(html).toContain("Try again");
  });

  it("uses status semantics for empty results", () => {
    const html = renderToStaticMarkup(
      <ProductEmpty title="No chargers" detail="Nothing is registered." />,
    );
    expect(html).toContain('role="status"');
    expect(html).toContain("No chargers");
  });

  it("marks loading state busy", () => {
    const html = renderToStaticMarkup(<ProductLoading label="Loading chargers" />);
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("Loading chargers");
  });

  it("keeps blocked action disabled", () => {
    const html = renderToStaticMarkup(
      <ContractGate
        id="visibility"
        eyebrow="Driver visibility"
        title="Contract missing"
        detail="A persisted visibility contract is required."
        action="Configure visibility"
      />,
    );
    expect(html).toContain("disabled");
    expect(html).toContain('aria-describedby="visibility-description"');
  });

  it("marks unsafe contract gates separately", () => {
    const html = renderToStaticMarkup(
      <ContractGate
        id="invite"
        eyebrow="Invitations"
        title="Unsafe"
        detail="Identity binding is required."
        action="Send invitation"
        tone="unsafe"
      />,
    );
    expect(html).toContain("org-blocked-panel unsafe");
  });

  it("gives status badges an accessible label", () => {
    const html = renderToStaticMarkup(<StatusBadge label="Online" tone="ok" />);
    expect(html).toContain('aria-label="Status: Online"');
    expect(html).toContain('aria-hidden="true"');
  });

  it("marks metric placeholders busy", () => {
    const html = renderToStaticMarkup(
      <MetricValue label="Chargers" value={0} loading />,
    );
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('aria-label="Chargers loading"');
  });

  it("renders zero as a real metric value", () => {
    const html = renderToStaticMarkup(<MetricValue label="Chargers" value={0} />);
    expect(html).toContain(">0<");
    expect(html).not.toContain("loading");
  });
});

