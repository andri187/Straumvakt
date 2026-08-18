import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { createInvoiceDocument } from "./document";
import type { InvoiceDocument, InvoiceDraft } from "./document";
import { HeaderRenderError, onBehalfOf, renderHeader, renderHeaderText } from "./header";
import {
  DOCUMENT_FIXTURES,
  HOST_A,
  HOST_B_NO_VAT,
  STRAUMVAKT,
  agentEnergyLine,
  connectorLine,
} from "./fixtures";

const HERE = dirname(fileURLToPath(import.meta.url));
const golden = (name: string) => readFileSync(join(HERE, "__golden__", name), "utf8");

function draftNamed(name: string): InvoiceDraft {
  const f = DOCUMENT_FIXTURES.find((x) => x.name === name);
  if (!f) throw new Error(`fixture not found: ${name}`);
  return f.draft;
}

const PRINCIPAL = createInvoiceDocument(draftNamed("clean single-connector org"));
const AGENT = createInvoiceDocument(
  draftNamed("agent-posture claim — host is kröfuhafi, Straumvakt presents"),
);

describe("principal posture", () => {
  it("renders Straumvakt's own name as the claim line", () => {
    expect(renderHeader(PRINCIPAL).claimLine).toBe("Straumvakt");
  });

  it("adds no presenter note", () => {
    expect(renderHeader(PRINCIPAL).presenterNote).toBeNull();
  });

  it("states Straumvakt's own VAT number", () => {
    expect(renderHeader(PRINCIPAL).vatLine).toContain(STRAUMVAKT.vatNumber!);
  });
});

describe("agent posture", () => {
  it("renders the exact 'f.h.' construction", () => {
    expect(renderHeader(AGENT).claimLine).toBe("Straumvakt f.h. Hýsill A ehf.");
  });

  it("onBehalfOf is the single place that string is built", () => {
    expect(onBehalfOf("Straumvakt", "Hýsill A ehf.")).toBe("Straumvakt f.h. Hýsill A ehf.");
  });

  it("names the kröfuhafi's identity, not the presenter's", () => {
    const h = renderHeader(AGENT);
    expect(h.claimHolderIdLine).toContain(HOST_A.registeredId);
    expect(h.claimHolderIdLine).not.toContain(STRAUMVAKT.registeredId);
  });

  it("states the KRÖFUHAFI's VAT number, because the sale is theirs", () => {
    expect(renderHeader(AGENT).vatLine).toContain(HOST_A.vatNumber!);
    expect(renderHeader(AGENT).vatLine).not.toContain(STRAUMVAKT.vatNumber!);
  });

  it("carries an explicit presenter note", () => {
    expect(renderHeader(AGENT).presenterNote).toContain("fyrir hönd kröfuhafa");
  });
});

describe("a document mixing postures cannot be rendered at all", () => {
  // Construction already refuses this (document.test.ts). The object below is
  // hand-assembled to prove the RENDER guard holds independently — a document
  // can arrive from a database row, a queue message or an older code path, and
  // "construction would have caught it" is not a defence at that point.
  const mixed = {
    ...PRINCIPAL,
    claimHolder: HOST_A,
    presenter: STRAUMVAKT,
    lines: [connectorLine(1), agentEnergyLine(10)],
  } as unknown as InvoiceDocument;

  it("throws on renderHeader", () => {
    expect(() => renderHeader(mixed)).toThrow(HeaderRenderError);
  });

  it("throws on renderHeaderText too", () => {
    expect(() => renderHeaderText(mixed)).toThrow(HeaderRenderError);
  });

  it("names mixed_posture", () => {
    try {
      renderHeader(mixed);
      expect.unreachable("render should have thrown");
    } catch (e) {
      expect((e as HeaderRenderError).code).toBe("mixed_posture");
    }
  });

  it("does not trust the cached posture field", () => {
    // Lines say agent, the cached field says principal. The lines win, and the
    // disagreement is itself a refusal.
    const lying = {
      ...PRINCIPAL,
      posture: "principal",
      claimHolder: HOST_A,
      presenter: STRAUMVAKT,
      lines: [agentEnergyLine(10)],
    } as unknown as InvoiceDocument;
    expect(() => renderHeader(lying)).toThrow(HeaderRenderError);
    try {
      renderHeader(lying);
    } catch (e) {
      expect((e as HeaderRenderError).code).toBe("posture_mismatch");
    }
  });
});

describe("the kröfuhafi field is never inferred", () => {
  it("refuses when the kröfuhafi has no registered identity", () => {
    const doc = {
      ...AGENT,
      claimHolder: { ...HOST_A, registeredId: "" },
    } as unknown as InvoiceDocument;
    expect(() => renderHeader(doc)).toThrow(HeaderRenderError);
    try {
      renderHeader(doc);
    } catch (e) {
      expect((e as HeaderRenderError).code).toBe("claimHolder_registered_id_missing");
    }
  });

  it("refuses when the kröfuhafi has no legal name — no blank, no fallback", () => {
    const doc = {
      ...PRINCIPAL,
      claimHolder: { ...STRAUMVAKT, legalName: "  " },
    } as unknown as InvoiceDocument;
    expect(() => renderHeader(doc)).toThrow(HeaderRenderError);
  });

  it("never substitutes the presenter for the kröfuhafi", () => {
    const doc = {
      ...AGENT,
      claimHolder: { ...HOST_A, registeredId: "" },
    } as unknown as InvoiceDocument;
    // If the code fell back to the presenter, this would render rather than throw.
    expect(() => renderHeader(doc)).toThrow(HeaderRenderError);
  });

  it("refuses an agent document whose presenter is the kröfuhafi", () => {
    const doc = { ...AGENT, presenter: HOST_A } as unknown as InvoiceDocument;
    expect(() => renderHeader(doc)).toThrow(HeaderRenderError);
  });
});

describe("VAT presentation per posture", () => {
  it("a non-VAT-registered kröfuhafi is stated, not shown as zero", () => {
    const doc = createInvoiceDocument(
      draftNamed("agent posture for a non-VAT-registered kröfuhafi, stated correctly"),
    );
    const h = renderHeader(doc);
    expect(h.vatLine).toBe("Kröfuhafi er ekki á virðisaukaskattsskrá.");
    expect(h.vatLine).not.toContain("0%");
    expect(doc.claimHolder.registeredId).toBe(HOST_B_NO_VAT.registeredId);
  });
});

describe("golden files", () => {
  it("principal header is unchanged", () => {
    expect(renderHeaderText(PRINCIPAL)).toBe(golden("header-principal.txt"));
  });

  it("agent header is unchanged", () => {
    expect(renderHeaderText(AGENT)).toBe(golden("header-agent.txt"));
  });

  it("the two goldens differ — a renderer that ignored posture would make them equal", () => {
    expect(golden("header-principal.txt")).not.toBe(golden("header-agent.txt"));
  });

  it("the agent golden contains the f.h. construction and the principal one does not", () => {
    expect(golden("header-agent.txt")).toContain(" f.h. ");
    expect(golden("header-principal.txt")).not.toContain(" f.h. ");
  });
});
