#!/usr/bin/env -S npx tsx
//
// Customer 1's first invoice, as a dry run.
//
//   npx tsx scripts/dry-run-first-invoice.mts            happy path, prints the invoice
//   npx tsx scripts/dry-run-first-invoice.mts --case X   run one named case
//   npx tsx scripts/dry-run-first-invoice.mts --all      every case, including the broken ones
//   npx tsx scripts/dry-run-first-invoice.mts --json     emit the draft as JSON for check:invoice
//
// ── WHAT THIS IS FOR ────────────────────────────────────────────────────
//
// Every other deliverable in this lane is a test asserting something a person
// already believes. This is the first time anyone SEES the output. It takes a
// synthetic org through the whole path and prints the document a host would
// receive, so that a human can read it and say "no, that is wrong" before it
// is ever produced against real data.
//
//   org + asset chain + agreement fixture
//     → connector activity + driver activity rows   (the chunk 1/2 derivations)
//       → flat-fee statement lines                  (the feeder, through the port)
//         → invoice draft, grouped by claim holder / counterparty / period
//           → createInvoiceDocument                 (B's model — mixed posture
//                                                    rejected at construction)
//             → renderHeaderText                    (B's header — the legal artefact)
//               → delivery record in state `unknown`
//
// ── NO DATABASE, NO NETWORK ─────────────────────────────────────────────
//
// The feeder reaches its counts through `ActivitySourcePort`. Here that port is
// backed by the same pure derivations the real writer uses, fed from fixture
// rows. Nothing in this file opens a socket or a connection string. That is
// what makes it runnable before migration 0002 has been applied to anything.
//
// ── EVERY VALUE IS SYNTHETIC ────────────────────────────────────────────
//
// Including the host's registered identity. Following the convention B set in
// packages/contracts/src/invoice/fixtures.ts: **no kennitala-shaped value
// appears here**, because a checksum-valid 10-digit string committed to a
// repository is indistinguishable from a real person's national id.
//
// ── WHAT THIS DRY RUN DOES NOT PROVE ────────────────────────────────────
//
// The driver count is **supplied by the fixture, not derived**, and the output
// says so on its face. The locked definition of an active driver is "charging
// OR REPORTING activity"; reporting activity has no persisted source, so
// `deriveActiveDrivers` refuses and every real period holds until Andri
// answers docs/notes/2026-08-18-active-driver-definition.md. A dry run that
// quietly supplied the number would be demonstrating a capability that does
// not exist.

import { writeFileSync } from "node:fs";
import {
  createInvoiceDocument,
  InvoiceConstructionError,
  type InvoiceDraft,
  type InvoiceLine,
} from "../packages/contracts/src/invoice/document.ts";
import { renderHeaderText } from "../packages/contracts/src/invoice/header.ts";
import { HeaderRenderError } from "../packages/contracts/src/invoice/header.ts";
import {
  emptySequence,
  issue,
  findGaps,
  type SequenceState,
} from "../packages/contracts/src/invoice/number.ts";
import {
  deriveConnectorActivity,
  deriveDriverActivity,
} from "../packages/commercial/src/core-billing/activity-month.ts";
import {
  generateFlatFeeStatementFromSource,
  countFromRows,
  type ActivitySourcePort,
} from "../packages/commercial/src/core-billing/activity-source.ts";
import {
  measured,
  FLAT_FEE_CAP_CODE,
  FLAT_FEE_CONNECTOR_CODE,
  FLAT_FEE_DRIVER_CODE,
  type FlatFeeLine,
  type FlatFeeResult,
} from "../packages/commercial/src/core-billing/flat-fee.ts";
import type { RateRefInput } from "../packages/commercial/src/agreement/types.ts";
import type { BillingPeriodRef } from "../packages/commercial/src/core-billing/period-close.ts";

// ── Fixture: the org, its asset chain, its agreement ────────────────────

const ORG_ID = "11111111-1111-1111-1111-111111111111";
const PERIOD: BillingPeriodRef = { orgId: ORG_ID, year: 2026, month: 3 };
const CONNECTOR_COUNT = 30;
const DRIVER_COUNT = 2;
const VAT_PERCENT = 24;

/** Straumvakt, the seller on the market line. Synthetic identity. */
const STRAUMVAKT = {
  legalName: "Straumvakt ehf.",
  registeredId: "SYNTHETIC-SELLER-ID",
  vatNumber: "SYNTHETIC-VSK-1",
  addressLines: ["Dæmigata 1", "101 Reykjavík"] as const,
  countryCode: "IS",
  ref: { kind: "platform" } as const,
};

/** The host being billed. Synthetic identity — deliberately not kennitala-shaped. */
const HOST = {
  legalName: "Hýsill A ehf.",
  registeredId: "SYNTHETIC-HOST-ID",
  vatNumber: "SYNTHETIC-VSK-2",
  addressLines: ["Dalvegur 10 - 14", "201 Kópavogur"] as const,
  countryCode: "IS",
  ref: { kind: "org", orgId: ORG_ID } as const,
};

/** The degenerate agreement: one cost factor, three rate references. */
function rate(code: string, priceMinor: bigint): RateRefInput {
  return {
    id: `rate-${code.toLowerCase()}`,
    code,
    costFactorId: "cf-core-flat-fee",
    basis: "per_connector",
    priceMinor,
    vatRatePct: VAT_PERCENT,
    currency: "ISK",
    supplierOrgId: null,
    effectiveFrom: new Date("2026-01-01T00:00:00Z"),
    effectiveUntil: null,
  };
}
const RATES: RateRefInput[] = [
  rate(FLAT_FEE_CONNECTOR_CODE, 20_000n),
  rate(FLAT_FEE_DRIVER_CODE, 5_000n),
  rate(FLAT_FEE_CAP_CODE, 45_000n),
];

const utc = (day: number, hour = 12) => new Date(Date.UTC(2026, 2, day, hour));

/** Connector evidence: 30 connectors, each seen by a StatusNotification. Only
 *  three of them saw a session — which is the ordinary shape of a month, and
 *  the case that would under-bill by 27 connectors if activity meant "used". */
function connectorEvidence() {
  const connectorId = (i: number) => `conn-${String(i).padStart(4, "0")}`;
  return {
    sessions: [0, 1, 2].map((i) => ({
      orgId: ORG_ID,
      connectorId: connectorId(i),
      chargingStationId: `stn-${String(i).padStart(4, "0")}`,
      startedAt: utc(4 + i),
    })),
    statuses: Array.from({ length: CONNECTOR_COUNT }, (_, i) => ({
      orgId: ORG_ID,
      connectorId: connectorId(i),
      chargingStationId: `stn-${String(i).padStart(4, "0")}`,
      observedAt: utc(2 + (i % 20)),
    })),
    assertions: [],
  };
}

function driverEvidence() {
  return [
    { orgId: ORG_ID, driverUserId: "drv-0001", startedAt: utc(4) },
    { orgId: ORG_ID, driverUserId: "drv-0001", startedAt: utc(11) },
    { orgId: ORG_ID, driverUserId: "drv-0002", startedAt: utc(6) },
  ];
}

// ── The port, fixture-backed ────────────────────────────────────────────

interface PortOptions {
  /** Omit connector rows, to exercise the hold. */
  suppressConnectors?: boolean;
  /** Supply the driver count explicitly rather than deriving it. See the
   *  header: the locked definition is not computable, so a real run holds. */
  driverCountOverride?: number | "derive";
}

function makePort(opts: PortOptions = {}): ActivitySourcePort {
  const connectorRows = opts.suppressConnectors
    ? 0
    : deriveConnectorActivity({ period: PERIOD, ...connectorEvidence() }).rows.length;

  return {
    connectorCount: async () =>
      countFromRows(connectorRows, {
        periodState: opts.suppressConnectors ? "open" : "activity_sealed",
        source: "activity_month_table",
      }),
    driverCount: async () => {
      const override = opts.driverCountOverride ?? DRIVER_COUNT;
      if (override === "derive") {
        // What a REAL run does: refuse, because reporting activity has no
        // persisted source. Kept reachable so the dry run can demonstrate it.
        const rows = deriveDriverActivity({ period: PERIOD, sessions: driverEvidence() }).rows;
        return countFromRows(rows.length, {
          periodState: "open",
          source: "activity_month_table",
        });
      }
      return measured(override, "activity_month_table");
    },
  };
}

// ── Statement → invoice draft ───────────────────────────────────────────

const UNIT_BY_KIND = {
  subscription_connector: "connector_month",
  subscription_driver: "driver_month",
  cap_relief: "connector_month",
} as const;

function toInvoiceLine(l: FlatFeeLine): InvoiceLine {
  return {
    description: l.description,
    unit: UNIT_BY_KIND[l.kind],
    quantity: l.quantity,
    // The document model takes minor units of the document currency. The
    // feeder's amounts are aurar and its quantities are counts, so unitPrice
    // is the aurar-per-unit figure and quantity × unitPrice reproduces
    // amountMinor exactly — asserted below rather than assumed.
    unitPrice: Number(l.amountMinor) / (l.quantity === 0 ? 1 : l.quantity),
    basis: l.code,
    vat: { kind: "standard", ratePercent: VAT_PERCENT },
    // The market line. Straumvakt earns this; the host pays. Principal.
    moneyLineKind: "platform_to_host",
    settlementRef: l.rateVersionId,
  };
}

function buildDraft(
  result: Extract<FlatFeeResult, { kind: "settled" }>,
  documentNumber: string,
  overrides: Partial<InvoiceDraft> = {},
): InvoiceDraft {
  const s = result.statement;
  const lines = s.lines.map(toInvoiceLine);

  for (const [i, l] of lines.entries()) {
    const reproduced = Math.round(l.quantity * l.unitPrice);
    const expected = Number(s.lines[i]!.amountMinor);
    if (reproduced !== expected) {
      throw new Error(
        `line ${i} (${l.basis}): quantity × unitPrice = ${reproduced} but the feeder said ${expected}`,
      );
    }
  }

  return {
    orgId: ORG_ID,
    kind: "invoice",
    documentNumber,
    // Principal posture: Straumvakt is both the kröfuhafi and the presenter,
    // so `presenter` is null. On an agent line it would name Straumvakt and
    // the header would render "Straumvakt f.h. <host>".
    claimHolder: { ...STRAUMVAKT, addressLines: [...STRAUMVAKT.addressLines] },
    presenter: null,
    recipient: { ...HOST, addressLines: [...HOST.addressLines] },
    period: { from: s.periodStart.slice(0, 10), to: "2026-03-31" },
    currency: "ISK",
    lines,
    issueDate: "2026-04-01",
    dueDate: "2026-04-15",
    settlementRefs: s.lines.map((l) => l.rateVersionId).filter((x): x is string => x !== null),
    ...overrides,
  };
}

// ── Rendering ───────────────────────────────────────────────────────────

const isk = (minor: number) =>
  `${(minor / 100).toLocaleString("is-IS", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kr.`;

function renderInvoice(draft: InvoiceDraft, provenance: string[]): string {
  const doc = createInvoiceDocument(draft);
  const out: string[] = [];
  out.push("═".repeat(72));
  out.push(renderHeaderText(doc).trimEnd());
  out.push("═".repeat(72));
  out.push("");
  out.push("LÍNUR");
  out.push("─".repeat(72));
  const w = [38, 6, 12, 14];
  out.push(
    "Lýsing".padEnd(w[0]!) + "Magn".padStart(w[1]!) + "Ein.verð".padStart(w[2]!) + "Upphæð".padStart(w[3]!),
  );
  for (const l of doc.lines) {
    const amount = Math.round(l.quantity * l.unitPrice);
    out.push(
      l.description.slice(0, w[0]! - 1).padEnd(w[0]!) +
        String(l.quantity).padStart(w[1]!) +
        isk(l.unitPrice).padStart(w[2]!) +
        isk(amount).padStart(w[3]!),
    );
    out.push(`  ${l.basis} · ${l.unit}`.padEnd(w[0]!));
  }
  out.push("─".repeat(72));
  for (const b of doc.totals.byVatRate) {
    out.push(
      `Samtals án vsk (${b.ratePercent}%)`.padEnd(w[0]! + w[1]!) + isk(b.net).padStart(w[2]! + w[3]!),
    );
    out.push(`Virðisaukaskattur ${b.ratePercent}%`.padEnd(w[0]! + w[1]!) + isk(b.vat).padStart(w[2]! + w[3]!));
  }
  out.push("═".repeat(72));
  out.push("SAMTALS TIL GREIÐSLU".padEnd(w[0]! + w[1]!) + isk(doc.totals.gross).padStart(w[2]! + w[3]!));
  out.push("═".repeat(72));
  out.push("");
  out.push(`Staða afhendingar: unknown  (ekkert var sent — þetta er þurrkeyrsla)`);
  out.push("");
  out.push("PROVENANCE");
  for (const p of provenance) out.push(`  · ${p}`);
  return out.join("\n");
}

// ── Cases ───────────────────────────────────────────────────────────────

/**
 * What a case did.
 *
 * `producedInvoice` drives the EXIT CODE, and `behavedAsExpected` drives the
 * self-test. They are separate on purpose:
 *
 *   - Running one case is an operator action — "can this org be invoiced for
 *     this period?" — so it exits 0 only when an invoice actually came out.
 *     A period that correctly held still exits non-zero, because no invoice
 *     exists and any automation downstream must not proceed.
 *   - `--all` is a regression check — "does every case still behave?" — so it
 *     exits 0 when each case did what it is supposed to, including the ones
 *     that are supposed to refuse.
 *
 * Collapsing these into one boolean makes one of the two modes lie.
 */
interface CaseResult {
  producedInvoice: boolean;
  behavedAsExpected: boolean;
  output: string;
}

function runHappyPath(seq: SequenceState): Promise<CaseResult> {
  return (async () => {
    const port = makePort();
    const result = await generateFlatFeeStatementFromSource(port, {
      period: PERIOD,
      rateReferences: RATES,
    });
    if (result.kind !== "settled") {
      return {
        producedInvoice: false,
        behavedAsExpected: false,
        output: `expected a settled period, got holds: ${JSON.stringify(result.holds)}`,
      };
    }

    const alloc = issue(seq, { idempotencyKey: `${ORG_ID}:2026-03:invoice`, year: 2026 });
    const draft = buildDraft(result, alloc.documentNumber);

    const connectors = deriveConnectorActivity({ period: PERIOD, ...connectorEvidence() });
    const drivers = deriveDriverActivity({ period: PERIOD, sessions: driverEvidence() });

    const provenance = [
      `connector count ${result.statement.activeConnectors} — DERIVED from ${connectors.rows.length} activity rows ` +
        `(${connectors.rows.filter((r) => r.source === "session_observed").length} session_observed, ` +
        `${connectors.rows.filter((r) => r.source === "status_available").length} status_available)`,
      `driver count ${result.statement.activeDrivers} — SUPPLIED BY THE FIXTURE, not derived. ` +
        `The charging-only derivation would give ${drivers.rows.length}; the locked definition ` +
        `("charging or reporting activity") is not computable because reporting activity has no ` +
        `persisted source. See docs/notes/2026-08-18-active-driver-definition.md`,
      `cap ${result.statement.capApplied ? "APPLIED" : "not binding"} — 450 kr × ${result.statement.activeConnectors} connectors`,
      `document number ${alloc.documentNumber} — allocated${alloc.reused ? " (reused)" : ""}, gap-free sequence`,
      `posture principal — Straumvakt earns this; platform_to_host is the market line`,
    ];

    return {
      producedInvoice: true,
      behavedAsExpected: true,
      output: renderInvoice(draft, provenance),
    };
  })();
}

async function runHoldsWithoutConnectorRows(): Promise<CaseResult> {
  const result = await generateFlatFeeStatementFromSource(makePort({ suppressConnectors: true }), {
    period: PERIOD,
    rateReferences: RATES,
  });
  if (result.kind === "settled") {
    return {
      producedInvoice: true,
      behavedAsExpected: false,
      output: "REGRESSION: an empty activity source produced a settled statement",
    };
  }
  return {
    producedInvoice: false,
    behavedAsExpected: true,
    output:
      "period HELD, no invoice produced. Reasons:\n" +
      result.holds.map((h) => `    ${h.reason}: ${h.detail}`).join("\n"),
  };
}

async function runHoldsOnRealDriverDefinition(): Promise<CaseResult> {
  const result = await generateFlatFeeStatementFromSource(
    makePort({ driverCountOverride: "derive" }),
    { period: PERIOD, rateReferences: RATES },
  );
  if (result.kind === "settled") {
    return {
      producedInvoice: true,
      behavedAsExpected: false,
      output: "REGRESSION: the locked driver definition is not computable, so this must hold",
    };
  }
  return {
    producedInvoice: false,
    behavedAsExpected: true,
    output:
      "period HELD — this is what a REAL run does today. Reasons:\n" +
      result.holds.map((h) => `    ${h.reason}: ${h.detail}`).join("\n"),
  };
}

async function runNoKennitala(seq: SequenceState): Promise<CaseResult> {
  const result = await generateFlatFeeStatementFromSource(makePort(), {
    period: PERIOD,
    rateReferences: RATES,
  });
  if (result.kind !== "settled") {
    return { producedInvoice: false, behavedAsExpected: false, output: "fixture should settle" };
  }
  const alloc = issue(seq, { idempotencyKey: "no-kennitala", year: 2026 });
  const draft = buildDraft(result, alloc.documentNumber, {
    recipient: { ...HOST, addressLines: [...HOST.addressLines], registeredId: "" },
  });
  try {
    renderHeaderText(createInvoiceDocument(draft));
    return {
      producedInvoice: true,
      behavedAsExpected: false,
      output: "REGRESSION: rendered a header for a host with no registered identity",
    };
  } catch (e) {
    const code = e instanceof HeaderRenderError ? e.code : (e as InvoiceConstructionError).problems?.[0]?.code;
    return {
      producedInvoice: false,
      behavedAsExpected: true,
      output: `REFUSED: ${code} — ${(e as Error).message}`,
    };
  }
}

async function runMixedPosture(seq: SequenceState): Promise<CaseResult> {
  const result = await generateFlatFeeStatementFromSource(makePort(), {
    period: PERIOD,
    rateReferences: RATES,
  });
  if (result.kind !== "settled") {
    return { producedInvoice: false, behavedAsExpected: false, output: "fixture should settle" };
  }
  const alloc = issue(seq, { idempotencyKey: "mixed-posture", year: 2026 });
  const base = buildDraft(result, alloc.documentNumber);
  const draft: InvoiceDraft = {
    ...base,
    lines: [
      ...base.lines,
      // An agent-posture line: the host's money, which must never share a
      // document with Straumvakt's own.
      { ...base.lines[0]!, description: "Hleðsla — f.h. hýsils", moneyLineKind: "host_to_driver" },
    ],
  };
  try {
    createInvoiceDocument(draft);
    return {
      producedInvoice: true,
      behavedAsExpected: false,
      output: "REGRESSION: constructed a document mixing agent and principal lines",
    };
  } catch (e) {
    const codes = e instanceof InvoiceConstructionError ? e.problems.map((p) => p.code) : ["unknown"];
    return {
      producedInvoice: false,
      behavedAsExpected: true,
      output: `REFUSED at construction: ${codes.join(", ")}`,
    };
  }
}

/** Numbering: allocation is transactional with issue, and a crash between the
 *  two does not consume a number. */
function runNumbering(): CaseResult {
  const seq = emptySequence({ orgScope: ORG_ID, series: "SV" });
  const key = `${ORG_ID}:2026-03:invoice`;

  const first = issue(seq, { idempotencyKey: key, year: 2026 });
  // The crash: the caller allocated and then died before persisting. It
  // re-enters with the same key. `issue` is pure, so the state it returned was
  // never committed — and re-issuing must hand back the SAME number.
  const afterCrash = issue(seq, { idempotencyKey: key, year: 2026 });
  const committed = issue(first.state, { idempotencyKey: key, year: 2026 });
  const next = issue(first.state, { idempotencyKey: "second-doc", year: 2026 });

  const problems: string[] = [];
  if (afterCrash.documentNumber !== first.documentNumber) {
    problems.push("a crash between allocate and issue produced a different number");
  }
  if (afterCrash.state !== seq && afterCrash.state.next[`${ORG_ID}:SV:2026`] !== 2) {
    problems.push("re-entry after a crash advanced the sequence");
  }
  if (!committed.reused) problems.push("re-issuing a committed key did not report reuse");
  if (committed.documentNumber !== first.documentNumber) {
    problems.push("re-issuing a committed key produced a different number");
  }
  if (next.documentNumber === first.documentNumber) problems.push("two documents got the same number");

  const gaps = findGaps(next.state, [first.documentNumber, next.documentNumber]);
  if (Object.keys(gaps).length > 0) problems.push(`sequence has gaps: ${JSON.stringify(gaps)}`);

  return {
    producedInvoice: problems.length === 0,
    behavedAsExpected: problems.length === 0,
    output:
      problems.length === 0
        ? [
            `first        ${first.documentNumber}`,
            `after crash  ${afterCrash.documentNumber}  (same number, sequence not advanced)`,
            `re-issued    ${committed.documentNumber}  (reused=${committed.reused})`,
            `next doc     ${next.documentNumber}`,
            `gaps         none`,
          ].join("\n    ")
        : problems.join("\n    "),
  };
}

// ── Main ────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const wantAll = argv.includes("--all");
const wantJson = argv.includes("--json");
const caseIdx = argv.indexOf("--case");
const only = caseIdx !== -1 ? argv[caseIdx + 1] : null;

const CASES: Array<{ name: string; run: (seq: SequenceState) => Promise<CaseResult> | CaseResult }> = [
  { name: "happy-path", run: runHappyPath },
  { name: "holds-without-connector-rows", run: () => runHoldsWithoutConnectorRows() },
  { name: "holds-on-real-driver-definition", run: () => runHoldsOnRealDriverDefinition() },
  { name: "refuses-host-without-kennitala", run: runNoKennitala },
  { name: "refuses-mixed-posture", run: runMixedPosture },
  { name: "numbering-gap-free-and-crash-safe", run: () => runNumbering() },
];

async function main(): Promise<number> {
  const seq = emptySequence({ orgScope: ORG_ID, series: "SV" });

  if (wantJson) {
    const result = await generateFlatFeeStatementFromSource(makePort(), {
      period: PERIOD,
      rateReferences: RATES,
    });
    if (result.kind !== "settled") {
      process.stderr.write("cannot emit JSON: the period held\n");
      return 1;
    }
    const alloc = issue(seq, { idempotencyKey: `${ORG_ID}:2026-03:invoice`, year: 2026 });
    const draft = buildDraft(result, alloc.documentNumber);
    const target = argv[argv.indexOf("--json") + 1] ?? "dry-run-invoice.json";
    writeFileSync(target, JSON.stringify(draft, null, 2) + "\n", "utf8");
    process.stdout.write(`wrote ${target}\n`);
    return 0;
  }

  const selected = only
    ? CASES.filter((c) => c.name === only)
    : wantAll
      ? CASES
      : CASES.filter((c) => c.name === "happy-path");

  if (selected.length === 0) {
    process.stderr.write(`no such case: ${only}\nknown: ${CASES.map((c) => c.name).join(", ")}\n`);
    return 2;
  }

  const results: Array<{ name: string; r: CaseResult }> = [];
  for (const c of selected) {
    const r = await c.run(seq);
    results.push({ name: c.name, r });
    if (selected.length > 1 || c.name !== "happy-path") {
      process.stdout.write(`\n${r.behavedAsExpected ? "  OK  " : " FAIL "} ${c.name}\n    `);
      process.stdout.write(r.output.replace(/\n/g, "\n    ") + "\n");
    } else {
      process.stdout.write(r.output + "\n");
    }
  }

  if (wantAll) {
    // Regression mode: every case did what it is supposed to, refusals
    // included. Exits 0 when the behaviour is intact.
    const bad = results.filter((x) => !x.r.behavedAsExpected);
    process.stdout.write(
      `\n${results.length - bad.length}/${results.length} cases behaved as specified\n`,
    );
    return bad.length === 0 ? 0 : 1;
  }

  // Operator mode: one case, and the question is "did an invoice come out?".
  // A period that correctly held still exits non-zero — no invoice exists, and
  // anything downstream must not proceed as though one does.
  const produced = results.every((x) => x.r.producedInvoice);
  if (!produced) {
    process.stdout.write(`\nno invoice was produced — exit 1\n`);
  }
  return produced ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (e) => {
    process.stderr.write(`dry run threw: ${(e as Error).message}\n`);
    process.exit(1);
  },
);
