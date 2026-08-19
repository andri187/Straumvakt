import { describe, expect, it } from "vitest";

import { createInvoiceDocument } from "./document";
import type { InvoiceDocument, InvoiceDraft } from "./document";
import { deliverInvoicePdf, newDeliveryEntry } from "./deliver-pdf";
import type { PdfDeliveryPort, SendOutcome } from "./deliver-pdf";
import { isDelivered } from "./delivery";
import { DOCUMENT_FIXTURES, HOST_A, STRAUMVAKT, agentEnergyLine, connectorLine } from "./fixtures";

const NOW = "2026-08-01T00:00:00Z";

function draftNamed(name: string): InvoiceDraft {
  const f = DOCUMENT_FIXTURES.find((x) => x.name === name);
  if (!f) throw new Error(`fixture not found: ${name}`);
  return f.draft;
}
const DOC = createInvoiceDocument(draftNamed("clean single-connector org"));

const portReturning = (outcome: SendOutcome): PdfDeliveryPort => ({
  async send() {
    return outcome;
  },
});
const portThrowing = (msg: string): PdfDeliveryPort => ({
  async send() {
    throw new Error(msg);
  },
});

const fresh = () => newDeliveryEntry("org-a", "SV-2026-000001", "email_pdf");

describe("the three outcomes", () => {
  it("confirmed moves to delivered and stamps deliveredAt once", async () => {
    const r = await deliverInvoicePdf(DOC, fresh(), portReturning({ kind: "confirmed", providerRef: "p1" }), NOW);
    expect(r.entry.state).toBe("delivered");
    expect(isDelivered(r.entry.state)).toBe(true);
    expect(r.entry.deliveredAt).toBe(NOW);
    expect(r.attempted).toBe(true);
  });

  it("rejected moves to failed_permanent", async () => {
    const r = await deliverInvoicePdf(DOC, fresh(), portReturning({ kind: "rejected", reason: "bad address" }), NOW);
    expect(r.entry.state).toBe("failed_permanent");
    expect(isDelivered(r.entry.state)).toBe(false);
  });

  it("unknown moves to unknown — not delivered, not failed", async () => {
    const r = await deliverInvoicePdf(DOC, fresh(), portReturning({ kind: "unknown", reason: "timeout" }), NOW);
    expect(r.entry.state).toBe("unknown");
    expect(isDelivered(r.entry.state)).toBe(false);
    expect(r.entry.deliveredAt).toBeNull();
  });

  it("a THROWN provider is unknown, never rejected", async () => {
    // The request may have been written before the connection died.
    const r = await deliverInvoicePdf(DOC, fresh(), portThrowing("socket hang up"), NOW);
    expect(r.entry.state).toBe("unknown");
  });
});

describe("fail-closed", () => {
  it("an unknown entry is never auto-retried", async () => {
    const first = await deliverInvoicePdf(DOC, fresh(), portReturning({ kind: "unknown", reason: "timeout" }), NOW);
    let sends = 0;
    const counting: PdfDeliveryPort = {
      async send() {
        sends++;
        return { kind: "confirmed" };
      },
    };
    const second = await deliverInvoicePdf(DOC, first.entry, counting, NOW);
    expect(sends).toBe(0);
    expect(second.attempted).toBe(false);
    expect(second.skipped).toBe("unknown-requires-operator");
    expect(second.entry.state).toBe("unknown");
  });

  it("a delivered entry is never sent again", async () => {
    const first = await deliverInvoicePdf(DOC, fresh(), portReturning({ kind: "confirmed" }), NOW);
    let sends = 0;
    const counting: PdfDeliveryPort = {
      async send() {
        sends++;
        return { kind: "confirmed" };
      },
    };
    const second = await deliverInvoicePdf(DOC, first.entry, counting, NOW);
    expect(sends).toBe(0);
    expect(second.skipped).toBe("already-delivered");
  });

  it("a terminal failure is not retried", async () => {
    const first = await deliverInvoicePdf(DOC, fresh(), portReturning({ kind: "rejected", reason: "x" }), NOW);
    const second = await deliverInvoicePdf(DOC, first.entry, portReturning({ kind: "confirmed" }), NOW);
    expect(second.attempted).toBe(false);
    expect(second.skipped).toBe("terminal");
  });

  it("deliveredAt is set once and never overwritten", async () => {
    const first = await deliverInvoicePdf(DOC, fresh(), portReturning({ kind: "confirmed" }), NOW);
    const later = await deliverInvoicePdf(DOC, first.entry, portReturning({ kind: "confirmed" }), "2026-09-09T00:00:00Z");
    expect(later.entry.deliveredAt).toBe(NOW);
  });
});

describe("render refusal is not a delivery failure", () => {
  const mixed = {
    ...DOC,
    claimHolder: HOST_A,
    presenter: STRAUMVAKT,
    lines: [connectorLine(1), agentEnergyLine(10)],
  } as unknown as InvoiceDocument;

  it("no send is attempted", async () => {
    let sends = 0;
    const counting: PdfDeliveryPort = {
      async send() {
        sends++;
        return { kind: "confirmed" };
      },
    };
    const r = await deliverInvoicePdf(mixed, fresh(), counting, NOW);
    expect(sends).toBe(0);
    expect(r.attempted).toBe(false);
  });

  it("the log is NOT moved to a failure state", async () => {
    const r = await deliverInvoicePdf(mixed, fresh(), portReturning({ kind: "confirmed" }), NOW);
    expect(r.entry.state).toBe("pending");
    expect(r.entry.attempts).toEqual([]);
    expect(r.skipped).toBe("render-refused");
    expect(r.renderErrorCode).toBe("mixed_posture");
    expect(r.renderError).toContain("mixes agent and principal");
  });
});

describe("the attempt trail", () => {
  it("records attempting then the outcome", async () => {
    const r = await deliverInvoicePdf(DOC, fresh(), portReturning({ kind: "confirmed" }), NOW);
    expect(r.entry.attempts.map((a) => a.state)).toEqual(["attempting", "delivered"]);
  });

  it("numbers attempts from one", async () => {
    const r = await deliverInvoicePdf(DOC, fresh(), portReturning({ kind: "unknown", reason: "t" }), NOW);
    expect(r.entry.attempts[0].attempt).toBe(1);
    expect(r.entry.attempts[1].attempt).toBe(2);
  });
});

// ── fool-test ───────────────────────────────────────────────────────────

describe("FOOL 8 — treat a thrown provider as a permanent failure", () => {
  // The tempting catch: an exception means it failed. It does not — the
  // request may have been written before the socket died, and marking it
  // failed invites a retry that delivers the invoice twice.
  const failedOnThrow = async (port: PdfDeliveryPort) => {
    try {
      await port.send(new Uint8Array(), fresh());
      return "delivered";
    } catch {
      return "failed_permanent";
    }
  };

  it("the fooled handler marks an ambiguous send as permanently failed", async () => {
    expect(await failedOnThrow(portThrowing("socket hang up"))).toBe("failed_permanent");
  });

  it("the real handler marks it unknown, which blocks the retry", async () => {
    const r = await deliverInvoicePdf(DOC, fresh(), portThrowing("socket hang up"), NOW);
    expect(r.entry.state).toBe("unknown");
    const retry = await deliverInvoicePdf(DOC, r.entry, portReturning({ kind: "confirmed" }), NOW);
    expect(retry.attempted).toBe(false);
  });
});
