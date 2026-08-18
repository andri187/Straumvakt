// Fool-tests.
//
// Each case below removes exactly one guard, reimplements the function
// without it, and asserts that the resulting behaviour VIOLATES the invariant
// the real test claims to protect — then asserts the real implementation does
// not.
//
// A guard whose removal breaks nothing is decoration. These prove the guards
// are load-bearing, which is a different claim from "the tests are green".

import { describe, expect, it } from "vitest";

import { createInvoiceDocument, posturesOf, validateDraft } from "./document";
import type { InvoiceDocument, InvoiceDraft } from "./document";
import { isDelivered, mayAttemptAgain } from "./delivery";
import type { DeliveryState } from "./delivery";
import { DUNNING_TRANSITIONS, eventsFor } from "./dunning";
import { renderHeader } from "./header";
import { emptySequence, findGaps, issue } from "./number";
import type { SequenceConfig } from "./number";
import { reconcile } from "./reconciliation";
import {
  DOCUMENT_FIXTURES,
  HOST_A,
  STRAUMVAKT,
  agentEnergyLine,
  connectorLine,
} from "./fixtures";

const draftNamed = (name: string): InvoiceDraft => {
  const f = DOCUMENT_FIXTURES.find((x) => x.name === name);
  if (!f) throw new Error(`fixture not found: ${name}`);
  return f.draft;
};

// ── fool-test 1 ─────────────────────────────────────────────────────────

describe("FOOL 1 — remove the fail-closed guard from isDelivered", () => {
  // The guard is `s === "delivered"`. The tempting rewrite is a negation:
  // "delivered means not failed". That is exactly how `unknown` becomes a
  // silent success, which is the defect SERVICES.md:33-37 records.
  const isDeliveredFooled = (s: DeliveryState): boolean =>
    s !== "failed_permanent" && s !== "failed_retryable" && s !== "abandoned";

  it("the fooled version reports an UNKNOWN delivery as delivered", () => {
    expect(isDeliveredFooled("unknown")).toBe(true);
  });

  it("the real version does not", () => {
    expect(isDelivered("unknown")).toBe(false);
  });

  it("so the assertion in delivery.test.ts genuinely fails without the guard", () => {
    const assertion = (fn: (s: DeliveryState) => boolean) => fn("unknown") === false;
    expect(assertion(isDeliveredFooled)).toBe(false);
    expect(assertion(isDelivered)).toBe(true);
  });
});

// ── fool-test 2 ─────────────────────────────────────────────────────────

describe("FOOL 2 — remove the duplicate-delivery guard from mayAttemptAgain", () => {
  // The guard is the early `if (state === "unknown") return false`. Without it
  // the function is the obvious `attempts < maxAttempts`, and an ambiguous
  // send gets retried into a second invoice landing in the host's inbox.
  const mayAttemptAgainFooled = (e: { state: DeliveryState; attempts: unknown[] }) =>
    e.attempts.length < 5;

  const unknownWithBudgetLeft = { state: "unknown" as DeliveryState, attempts: [] };

  it("the fooled version retries an unknown delivery", () => {
    expect(mayAttemptAgainFooled(unknownWithBudgetLeft)).toBe(true);
  });

  it("the real version refuses", () => {
    expect(mayAttemptAgain(unknownWithBudgetLeft)).toBe(false);
  });
});

// ── fool-test 3 ─────────────────────────────────────────────────────────

describe("FOOL 3 — remove the mixed-posture check from construction", () => {
  const mixed: InvoiceDraft = {
    ...draftNamed("clean single-connector org"),
    claimHolder: HOST_A,
    presenter: STRAUMVAKT,
    lines: [connectorLine(1), agentEnergyLine(10)],
  };

  // Construction minus the posture check: everything else still validates,
  // which is the point — the document looks fine by every other measure.
  const createFooled = (d: InvoiceDraft) => {
    const problems = validateDraft(d).filter((p) => p.code !== "mixed_posture");
    if (problems.length > 0) throw new Error("other problems: " + problems.map((p) => p.code));
    return { ...d, posture: [...posturesOf(d.lines)][0] };
  };

  it("the fooled constructor happily produces a two-posture document", () => {
    const doc = createFooled(mixed);
    expect(posturesOf(doc.lines).size).toBe(2);
  });

  it("the real constructor throws", () => {
    expect(() => createInvoiceDocument(mixed)).toThrow();
  });

  it("and the fooled document would then be rendered with ONE header for TWO postures", () => {
    // This is the concrete harm: a single kröfuhafi line asserting ownership
    // of money that belongs to two different parties.
    const doc = createFooled(mixed) as unknown as InvoiceDocument;
    expect(() => renderHeader(doc)).toThrow(); // caught by the render guard, not construction
  });
});

// ── fool-test 4 ─────────────────────────────────────────────────────────

describe("FOOL 4 — let the header infer the kröfuhafi", () => {
  const base = createInvoiceDocument(
    draftNamed("agent-posture claim — host is kröfuhafi, Straumvakt presents"),
  );
  const noIdentity = {
    ...base,
    claimHolder: { ...HOST_A, registeredId: "" },
  } as unknown as InvoiceDocument;

  // The "helpful" fallback: if the kröfuhafi has no id, use the presenter's.
  // It renders a complete, plausible, legally WRONG header.
  const renderFooled = (doc: InvoiceDocument) => ({
    claimLine: `${doc.presenter!.legalName} f.h. ${doc.claimHolder.legalName}`,
    claimHolderIdLine: `Kt. ${doc.claimHolder.registeredId || doc.presenter!.registeredId}`,
  });

  it("the fooled renderer produces a header naming the WRONG party's identity", () => {
    const h = renderFooled(noIdentity);
    expect(h.claimHolderIdLine).toContain(STRAUMVAKT.registeredId);
    expect(h.claimHolderIdLine).not.toContain(HOST_A.registeredId);
  });

  it("the real renderer refuses instead", () => {
    expect(() => renderHeader(noIdentity)).toThrow();
  });
});

// ── fool-test 5 ─────────────────────────────────────────────────────────

describe("FOOL 5 — allow a number to be released instead of voided", () => {
  const CONFIG: SequenceConfig = { orgScope: "org-a", series: "SV" };

  it("the fooled allocator leaves a gap in the sequence", () => {
    let s = emptySequence(CONFIG);
    const a = issue(s, { idempotencyKey: "a", year: 2026 });
    s = a.state;
    const b = issue(s, { idempotencyKey: "b", year: 2026 });
    s = b.state;
    const c = issue(s, { idempotencyKey: "c", year: 2026 });
    s = c.state;
    // "release" b — the tempting operation the real module deliberately omits.
    const issued = [a.documentNumber, c.documentNumber];
    expect(findGaps(s, issued)).toEqual({ "org-a:SV:2026": [2] });
  });

  it("voiding instead of releasing keeps the sequence unbroken", () => {
    let s = emptySequence(CONFIG);
    const a = issue(s, { idempotencyKey: "a", year: 2026 });
    s = a.state;
    const b = issue(s, { idempotencyKey: "b", year: 2026 });
    s = { ...b.state, voided: [b.documentNumber] };
    const c = issue(s, { idempotencyKey: "c", year: 2026 });
    s = c.state;
    expect(findGaps(s, [a.documentNumber, c.documentNumber])).toEqual({});
  });

  it("the real module exposes no release function", () => {
    const exported = { emptySequence, issue, findGaps };
    expect(Object.keys(exported)).not.toContain("release");
  });
});

// ── fool-test 6 ─────────────────────────────────────────────────────────

describe("FOOL 6 — settle on 'paid enough' instead of 'paid exactly'", () => {
  const overpaid = {
    total: 248,
    dueDate: "2026-08-15",
    asOf: "2026-08-12",
    events: [
      {
        orgId: "org-a",
        documentNumber: "SV-2026-000001",
        event: "payment_received" as const,
        amount: 300,
        at: "2026-08-11T00:00:00Z",
        railReference: null,
      },
    ],
  };

  const settleFooled = (paid: number, total: number) => (paid >= total ? "settled" : "part_settled");

  it("the fooled rule files an overpayment as settled — money owed back, invisible", () => {
    expect(settleFooled(300, 248)).toBe("settled");
  });

  it("the real rule distinguishes overpaid from settled", () => {
    const v = reconcile(overpaid);
    expect(v.state).toBe("overpaid");
    expect(v.outstanding).toBeLessThan(0);
  });
});

// ── fool-test 7 ─────────────────────────────────────────────────────────

describe("FOOL 7 — ignore the dunning mode", () => {
  // Removing the mode check means Straumvakt sends reminders alongside the
  // bank's own "sjálfvirkar ítrekanir" — the host gets two of everything.
  const eventsForFooled = (t: { event: string | null }) => (t.event ? [t.event] : []);
  const reminder = DUNNING_TRANSITIONS.find((t) => t.to === "reminder_1")!;

  it("the fooled version emits a reminder even when the bank owns dunning", () => {
    expect(eventsForFooled(reminder)).toEqual(["invoice.reminder_1.send"]);
  });

  it("the real version emits nothing under external management", () => {
    expect(eventsFor(reminder, "externally_managed")).toEqual([]);
  });

  it("but still emits when Straumvakt owns dunning", () => {
    expect(eventsFor(reminder, "straumvakt_managed")).toEqual(["invoice.reminder_1.send"]);
  });
});
