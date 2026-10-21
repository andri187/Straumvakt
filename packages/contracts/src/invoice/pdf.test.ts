import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { createInvoiceDocument } from "./document";
import type { InvoiceDocument, InvoiceDraft } from "./document";
import { PdfRenderError, invoiceTextLines, pdfEncodingProblems, renderInvoicePdf } from "./pdf";
import { HeaderRenderError } from "./header";
import { DOCUMENT_FIXTURES, HOST_A, STRAUMVAKT, agentEnergyLine, connectorLine } from "./fixtures";

const HERE = dirname(fileURLToPath(import.meta.url));
// Golden files are checked out with the platform's newline convention under
// core.autocrlf; the renderer always emits LF. Same reasoning as CR-1.
const golden = (name: string) =>
  readFileSync(join(HERE, "__golden__", name), "utf8").replace(/\r\n/g, "\n");

function draftNamed(name: string): InvoiceDraft {
  const f = DOCUMENT_FIXTURES.find((x) => x.name === name);
  if (!f) throw new Error(`fixture not found: ${name}`);
  return f.draft;
}

const PRINCIPAL = createInvoiceDocument(draftNamed("clean single-connector org"));
const MULTI = createInvoiceDocument(draftNamed("multi-site org — several connector lines on one document"));
const AGENT = createInvoiceDocument(
  draftNamed("agent-posture claim — host is kröfuhafi, Straumvakt presents"),
);

describe("the principal posture renders", () => {
  it("produces a PDF", () => {
    const bytes = renderInvoicePdf(PRINCIPAL);
    expect(bytes.length).toBeGreaterThan(400);
  });

  it("starts with the PDF header and ends with EOF", () => {
    const s = Buffer.from(renderInvoicePdf(PRINCIPAL)).toString("latin1");
    expect(s.startsWith("%PDF-1.4")).toBe(true);
    expect(s.trimEnd().endsWith("%%EOF")).toBe(true);
  });

  it("declares WinAnsiEncoding so Icelandic characters survive", () => {
    const s = Buffer.from(renderInvoicePdf(PRINCIPAL)).toString("latin1");
    expect(s).toContain("/WinAnsiEncoding");
  });

  it("carries a well-formed xref whose startxref points inside the file", () => {
    const s = Buffer.from(renderInvoicePdf(PRINCIPAL)).toString("latin1");
    const m = /startxref\n(\d+)\n/.exec(s);
    expect(m).toBeTruthy();
    const off = Number(m![1]);
    expect(off).toBeGreaterThan(0);
    expect(off).toBeLessThan(s.length);
    expect(s.slice(off, off + 4)).toBe("xref");
  });

  it("names the claim holder and the payer", () => {
    const s = Buffer.from(renderInvoicePdf(PRINCIPAL)).toString("latin1");
    expect(s).toContain("Straumvakt");
    expect(s).toContain(pdfSafe(PRINCIPAL.recipient.legalName));
  });
});

function pdfSafe(s: string): string {
  return s.replace(/[()\\]/g, (c) => "\\" + c);
}

describe("determinism", () => {
  it("two renders are byte-identical", () => {
    expect(Buffer.from(renderInvoicePdf(PRINCIPAL))).toEqual(
      Buffer.from(renderInvoicePdf(PRINCIPAL)),
    );
  });

  it("carries no creation date or producer string", () => {
    const s = Buffer.from(renderInvoicePdf(PRINCIPAL)).toString("latin1");
    expect(s).not.toContain("CreationDate");
    expect(s).not.toContain("Producer");
    expect(s).not.toContain("ModDate");
  });

  it("a different document produces different bytes", () => {
    expect(Buffer.from(renderInvoicePdf(PRINCIPAL))).not.toEqual(
      Buffer.from(renderInvoicePdf(MULTI)),
    );
  });
});

describe("a mixed-posture document cannot be rendered to PDF", () => {
  // Construction already refuses this; the PDF path inherits the header guard,
  // which is the point — one refusal, enforced everywhere it matters.
  const mixed = {
    ...PRINCIPAL,
    claimHolder: HOST_A,
    presenter: STRAUMVAKT,
    lines: [connectorLine(1), agentEnergyLine(10)],
  } as unknown as InvoiceDocument;

  it("renderInvoicePdf throws", () => {
    expect(() => renderInvoicePdf(mixed)).toThrow(HeaderRenderError);
  });

  it("invoiceTextLines throws too — no partial content escapes", () => {
    expect(() => invoiceTextLines(mixed)).toThrow(HeaderRenderError);
  });

  it("names mixed_posture", () => {
    try {
      renderInvoicePdf(mixed);
      expect.unreachable("should have thrown");
    } catch (e) {
      expect((e as HeaderRenderError).code).toBe("mixed_posture");
    }
  });
});

describe("it inherits every header refusal", () => {
  it("refuses when the claim holder has no registered identity", () => {
    const doc = {
      ...PRINCIPAL,
      claimHolder: { ...STRAUMVAKT, registeredId: "" },
    } as unknown as InvoiceDocument;
    expect(() => renderInvoicePdf(doc)).toThrow(HeaderRenderError);
  });

  it("refuses a principal document naming a different presenter", () => {
    const doc = { ...PRINCIPAL, presenter: HOST_A } as unknown as InvoiceDocument;
    expect(() => renderInvoicePdf(doc)).toThrow(HeaderRenderError);
  });
});

describe("the agent posture renders with the f.h. construction", () => {
  it("carries the on-behalf-of line", () => {
    expect(invoiceTextLines(AGENT).join("\n")).toContain(" f.h. ");
  });

  it("names the host's identity, not the presenter's", () => {
    const text = invoiceTextLines(AGENT).join("\n");
    expect(text).toContain(HOST_A.registeredId);
    expect(text).not.toContain(STRAUMVAKT.registeredId);
  });
});

describe("encoding", () => {
  it("reports nothing for Latin-1 content", () => {
    expect(pdfEncodingProblems(PRINCIPAL)).toEqual([]);
  });

  it("reports a character outside Latin-1 rather than dropping it silently", () => {
    const doc = {
      ...PRINCIPAL,
      recipient: { ...PRINCIPAL.recipient, legalName: "Hýsill 東京 ehf." },
    } as unknown as InvoiceDocument;
    const problems = pdfEncodingProblems(doc);
    expect(problems.length).toBe(1);
    expect(problems[0]).toContain("recipient.legalName");
  });

  it("Icelandic characters are inside Latin-1 and produce no problem", () => {
    const doc = {
      ...PRINCIPAL,
      recipient: { ...PRINCIPAL.recipient, legalName: "Þórð Ægir Ósk ehf." },
    } as unknown as InvoiceDocument;
    expect(pdfEncodingProblems(doc)).toEqual([]);
  });
});

describe("totals", () => {
  it("prints net, VAT and gross", () => {
    const text = invoiceTextLines(PRINCIPAL).join("\n");
    expect(text).toContain("Samtals án VSK");
    expect(text).toContain("VSK samtals");
    expect(text).toContain("SAMTALS");
  });

  it("groups thousands the Icelandic way", () => {
    const text = invoiceTextLines(MULTI).join("\n");
    // 11 connectors * 200 + 12 drivers * 50 = 2200 + 600 = 2800 net
    expect(text).toContain("2.800");
  });
});

describe("golden file", () => {
  it("the principal text layout is unchanged", () => {
    expect(invoiceTextLines(PRINCIPAL).join("\n") + "\n").toBe(golden("pdf-principal.txt"));
  });
});

// ── fool-test ───────────────────────────────────────────────────────────

describe("FOOL 7 — render the PDF without going through the header guard", () => {
  // The tempting shortcut: build the text straight from the document fields.
  // It renders a mixed-posture invoice happily, with one claim-holder line
  // asserting ownership of money belonging to two different parties.
  const mixed = {
    ...PRINCIPAL,
    claimHolder: HOST_A,
    presenter: STRAUMVAKT,
    lines: [connectorLine(1), agentEnergyLine(10)],
  } as unknown as InvoiceDocument;

  const textFooled = (doc: InvoiceDocument) => [
    `Reikningur nr. ${doc.documentNumber}`,
    doc.claimHolder.legalName,
    ...doc.lines.map((l) => l.description),
  ];

  it("the fooled renderer produces content for a document that must not render", () => {
    expect(textFooled(mixed).length).toBeGreaterThan(2);
    expect(textFooled(mixed)[1]).toBe(HOST_A.legalName);
  });

  it("the real renderer refuses", () => {
    expect(() => invoiceTextLines(mixed)).toThrow(HeaderRenderError);
  });

  it("PdfRenderError exists for PDF-specific refusals and is distinct from the header one", () => {
    expect(new PdfRenderError("x", "y").name).toBe("PdfRenderError");
  });
});
