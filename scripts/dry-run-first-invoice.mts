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
import { makeBillingPeriodsRouter } from "../apps/api/src/routes/admin/billing/periods.ts";
import { makeFixtureOperationsPort } from "../apps/api/src/lib/billing/fixture-operations-port.ts";
import {
  connectorSharesForPeriod,
  type ConnectorPlacementShare,
  type PlacementRow,
} from "../apps/api/src/lib/billing/placement-evidence.ts";
import type { VendorConfigObservation } from "../apps/api/src/lib/vendor-config/sink-port.ts";

// ── Fixture: the org, its asset chain, its agreement ────────────────────

const ORG_ID = "11111111-1111-1111-1111-111111111111";
/** The second host in the mid-month-move case. Synthetic. */
const ORG_B_ID = "22222222-2222-2222-2222-222222222222";
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
    // Connector 29 is vendor-native: the Zaptec importer writes connector_id
    // null on its sessions and it never speaks OCPP to our gateway, so it
    // produces NO machine evidence at all. An operator vouched for it, and
    // the provenance block below says so on the invoice.
    statuses: Array.from({ length: CONNECTOR_COUNT - 1 }, (_, i) => ({
      orgId: ORG_ID,
      connectorId: connectorId(i),
      chargingStationId: `stn-${String(i).padStart(4, "0")}`,
      observedAt: utc(2 + (i % 20)),
    })),
    assertions: [
      {
        orgId: ORG_ID,
        connectorId: connectorId(CONNECTOR_COUNT - 1),
        chargingStationId: null,
        assertedAt: utc(16),
      },
    ],
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
        `${connectors.rows.filter((r) => r.source === "status_available").length} status_available, ` +
        `${connectors.rows.filter((r) => r.source === "manually_asserted").length} manually_asserted)`,
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


// ── Driving the API surface, not just the library ───────────────────────
//
// A2c proved the LIBRARY path. These two drive the HANDLERS an operator will
// actually call — the same router `index.ts` mounts, with a fixture port and
// no database. A library that works behind a route that does not is not a
// working invoice, and the route is where the idempotency and lifecycle
// guards actually live.

const API_ORG = ORG_ID;

function apiHarness(connectorRows: number, driverRows: number) {
  const k = `${API_ORG}:2026:3`;
  const { port, state } = makeFixtureOperationsPort({
    connectorRows: { [k]: connectorRows },
    driverRows: { [k]: driverRows },
    rateReferences: RATES,
    render: (p, n) => `INVOICE ${n} — ${p.orgId} ${p.year}-${p.month}`,
  });
  const app = makeBillingPeriodsRouter({
    // A stub session gate. The dry run has no auth stack and needs none — it
    // is proving the BILLING invariants, and the session layer has its own
    // tests. The real gate is the default when nothing is injected.
    requireAuth: async (c, next) => {
      c.set("session", { userId: "user-dry-run-0000-0000-000000001" });
      await next();
    },
    // Platform-wide scope: the dry run is not testing tenancy, which has its
    // own cross-tenant cases in periods.test.ts.
    resolveAccess: async () => ({ restrictToOrgIds: null }),
    // The permission gate resolves effective permissions from the database.
    // What it gates is asserted in periods.test.ts; here it is a pass-through.
    requirePerm: () => async (_c, next) => { await next(); },
    makePort: () => port,
    // April, so March may be opened. The handler reads no clock of its own.
    now: () => new Date("2026-04-05T09:00:00Z"),
  });
  const hit = (verb: string, key: string) =>
    app.request(`http://dry/${API_ORG}/billing/periods/2026/3/${verb}`, {
      method: "POST",
      headers: { "Idempotency-Key": key },
    });
  return { app, state, hit };
}

/** The whole lifecycle, through the handlers. */
async function runApiLifecycle(): Promise<CaseResult> {
  const h = apiHarness(30, 2);
  const steps: string[] = [];
  const plan: Array<[string, string]> = [
    ["open", "dry-open"],
    ["activity", "dry-activity"],
    ["price", "dry-price"],
    ["issue", "dry-issue"],
    ["close", "dry-close"],
  ];
  for (const [verb, key] of plan) {
    const res = await h.hit(verb, key);
    steps.push(`${verb.padEnd(9)} ${res.status}`);
    if (res.status !== 200) {
      return {
        producedInvoice: false,
        behavedAsExpected: false,
        output: `${verb} returned ${res.status}\n    ` + steps.join("\n    "),
      };
    }
  }
  const issued = h.state.effects.filter((e) => e.startsWith("issue:"));
  const ok = issued.length === 1;
  return {
    producedInvoice: ok,
    behavedAsExpected: ok,
    output:
      steps.join("\n    ") +
      `\n    document  ${issued[0]?.split(":").pop() ?? "none"}` +
      `\n    effects   ${h.state.effects.length}, one per step, no repeats`,
  };
}

/** Out-of-order refusals, and a retry that does not repeat an effect. */
async function runApiLifecycleRefusals(): Promise<CaseResult> {
  const h = apiHarness(30, 2);
  const notes: string[] = [];

  const early = await h.hit("price", "k-early");
  notes.push(`price before open        ${early.status}  (expect 409)`);

  await h.hit("open", "k-open");
  const before = h.state.effects.length;
  await h.hit("open", "k-open");
  const replayed = h.state.effects.length === before;
  notes.push(`open replayed, same key  ${replayed ? "no new effect" : "REPEATED"}`);

  const noKey = await h.app.request(
    `http://dry/${API_ORG}/billing/periods/2026/3/activity`,
    { method: "POST" },
  );
  notes.push(`activity with no key     ${noKey.status}  (expect 400)`);

  const ok = early.status === 409 && replayed && noKey.status === 400;
  return { producedInvoice: false, behavedAsExpected: ok, output: notes.join("\n    ") };
}


// ── The mid-month move — ADR 0054 item 7 ────────────────────────────────
//
// One device, two hosts, one month. This is the case that a current-row read
// gets wrong, and the case that makes the proration fork a real question
// rather than a hypothetical.
//
// It runs the SAME feeder and the SAME numbering sequence as the happy path,
// twice — once per host — because that is what `connector_activity_month`'s
// (org, year, month, connector) key already produces. Nothing about the
// existing cases changes; this one is added beside them.

const HOST_B = {
  legalName: "Hýsill B ehf.",
  registeredId: "SYNTHETIC-HOST-ID-B",
  vatNumber: "SYNTHETIC-VSK-3",
  addressLines: ["Smiðjuvegur 4", "200 Kópavogur"] as const,
  countryCode: "IS",
  ref: { kind: "org", orgId: ORG_B_ID } as const,
};

/** March 2026, half-open. */
const MARCH_WINDOW = {
  start: new Date("2026-03-01T00:00:00Z"),
  end: new Date("2026-04-01T00:00:00Z"),
};
const MOVE_DAY = new Date("2026-03-12T00:00:00Z");

/** One device, one connector, moved on the 12th. */
function movePlacements(): PlacementRow[] {
  return [
    {
      id: "placement-host-a",
      publicId: "evse-uid-host-a",
      deviceId: "device-moved-1",
      orgId: ORG_ID,
      installationId: "inst-a",
      period: { from: new Date("2026-01-15T00:00:00Z"), until: MOVE_DAY },
      connectorIds: ["conn-moved-0001"],
    },
    {
      id: "placement-host-b",
      publicId: "evse-uid-host-b",
      deviceId: "device-moved-1",
      orgId: ORG_B_ID,
      installationId: "inst-b",
      period: { from: MOVE_DAY, until: null },
      connectorIds: ["conn-moved-0001"],
    },
  ];
}

/** The device is vendor-ACTIVE, observed before the period. Half (b). */
function moveVendorConfig(): Map<string, VendorConfigObservation[]> {
  return new Map([
    [
      "device-moved-1",
      [
        {
          deviceId: "device-moved-1",
          observedAt: new Date("2026-02-01T00:00:00Z"),
          chargerActive: true,
          authenticationType: 2,
          isAuthorizationRequired: false,
          ocppDefaultIdTag: "SYNTHETIC-DEFAULT-TOKEN",
        },
      ],
    ],
  ]);
}

async function runMidMonthMove(_seq: SequenceState): Promise<CaseResult> {
  // ONE SEQUENCE PER HOST, and that is the design rather than a convenience.
  // `document_number_series` is keyed (org, series, year) — migration 0004 —
  // because each host's numbering is its own unbroken run under Icelandic
  // law. Two hosts legitimately both hold SV-2026-000001; sharing one
  // sequence would put a hole in each of them.
  //
  // The parameter is ignored on purpose: the happy path's sequence belongs to
  // Hýsill A, and threading it here would spend ordinals out of that run.
  const seqByOrg = new Map<string, SequenceState>([
    [ORG_ID, emptySequence({ orgScope: ORG_ID, series: "SV" })],
    [ORG_B_ID, emptySequence({ orgScope: ORG_B_ID, series: "SV" })],
  ]);

  const placements = movePlacements();
  const vendorConfig = moveVendorConfig();

  const whole = connectorSharesForPeriod(placements, MARCH_WINDOW, vendorConfig, "whole_month_per_host");
  const prorated = connectorSharesForPeriod(placements, MARCH_WINDOW, vendorConfig, "prorate_by_overlap_days");
  if (whole.kind !== "counted" || prorated.kind !== "counted") {
    return {
      producedInvoice: false,
      behavedAsExpected: false,
      output: `expected counted shares, got ${whole.kind} / ${prorated.kind}`,
    };
  }

  const out: string[] = [];
  const hosts = [
    { share: whole.shares.find((s) => s.orgId === ORG_ID)!, org: ORG_ID, party: HOST, label: "Hýsill A" },
    { share: whole.shares.find((s) => s.orgId === ORG_B_ID)!, org: ORG_B_ID, party: HOST_B, label: "Hýsill B" },
  ];

  for (const h of hosts) {
    // The same feeder, one connector, per host. The count is 1 because this
    // host held ONE connector during the period — which is what the overlap
    // join produced, not what a current-row read would have.
    const result = await generateFlatFeeStatementFromSource(
      {
        connectorCount: async () => measured(1, "connector_lifecycle"),
        driverCount: async () => measured(0, "activity_month_table"),
      },
      { period: { orgId: h.org, year: 2026, month: 3 }, rateReferences: RATES },
    );
    if (result.kind !== "settled") {
      return {
        producedInvoice: false,
        behavedAsExpected: false,
        output: `${h.label} held: ${JSON.stringify(result.holds)}`,
      };
    }
    // `issue` is PURE and returns the next state. Discarding it is the defect
    // its own contract warns about, and it is SILENT here: two hosts on
    // separate series both legitimately hold 000001, so a dropped state looks
    // identical to correct output. The first draft of this case had that bug.
    const alloc = issue(seqByOrg.get(h.org)!, { idempotencyKey: `${h.org}:2026-03:invoice`, year: 2026 });
    seqByOrg.set(h.org, alloc.state);
    const draft = buildDraft(result, alloc.documentNumber, {
      orgId: h.org,
      recipient: { ...h.party, addressLines: [...h.party.addressLines] },
    });
    out.push(
      renderInvoice(draft, [
        `${h.label} held the device for ${h.share.overlapDays} of ${h.share.periodDays} days ` +
          `(placement ${h.share.placementId}, OCPI EVSE.uid is the placement's public id)`,
        `connector count 1 — DERIVED from a PLACEMENT overlapping the period, ` +
          `not from a current-row read. Decision 5.`,
        `vendor-active — Charger.Active true, observed 2026-02-01, before the period end`,
        `document number ${alloc.documentNumber} — allocated${alloc.reused ? " (reused)" : ""}, gap-free sequence`,
        `policy whole_month_per_host — the DEFAULT, and what this system does today`,
      ]),
    );
  }

  // THE STATE-THREADING PROOF. Both invoices above are SV-2026-000001 and
  // that is CORRECT — the series is per-org, so two hosts legitimately hold
  // the same number. It is also exactly what a DROPPED sequence state looks
  // like, and the first draft of this case had that bug: `issue` is pure and
  // returns the next state, and discarding it is the defect its own contract
  // warns about. The two are distinguished here rather than left to the
  // reader — a second document for Hýsill A must be 000002.
  const secondForA = issue(seqByOrg.get(ORG_ID)!, {
    idempotencyKey: `${ORG_ID}:2026-03:credit-note`,
    year: 2026,
  });
  const threaded = secondForA.documentNumber === "SV-2026-000002";
  out.push(
    [
      "  SEQUENCE",
      `    Hýsill A next document  ${secondForA.documentNumber}${threaded ? "" : "   <- STATE WAS DROPPED"}`,
      "    Both invoices are 000001 because the series is per-org — migration",
      "    0004 keys document_number_series (org, series, year). This second",
      "    allocation is what proves that is the design and not a discarded",
      "    return value.",
      "",
      prorationNote(prorated.shares),
    ].join("\n"),
  );

  return { producedInvoice: true, behavedAsExpected: threaded, output: out.join("\n\n") };
}

/**
 * The proration arithmetic, printed beside the invoices — and the structural
 * finding that came out of trying to produce it.
 *
 * THE FEEDER CANNOT EXPRESS PRORATION TODAY, and this is not a gap in the
 * switch. `measured()` in packages/commercial/src/core-billing/flat-fee.ts
 * throws unless the count is a non-negative INTEGER, deliberately, so a
 * prorated share cannot be passed as a smaller count — `11/31 of a connector`
 * is not a connector count and pretending it is would put a rounding decision
 * in the layer that counts rather than the layer that prices.
 *
 * What would have to change, stated so the decision is costed rather than
 * assumed: a per-line SHARE (numerator, denominator) carried into the engine
 * and applied to `amountMinor` after the rate is applied, with the existing
 * `roundAurarToIsk` doing the rounding. That keeps FOCUS rule 3 — one money
 * engine — and it is one contract change, not a second engine.
 *
 * Until then this prints what proration WOULD produce, computed the same way
 * the engine would have to, so the numbers are reviewable now.
 */
function prorationNote(shares: ConnectorPlacementShare[]): string {
  const CONNECTOR_AURAR = 20_000n;
  const lines: string[] = [];

  // CUMULATIVE ALLOCATION, not per-share division.
  //
  // The obvious implementation — divide each share independently and add them
  // up — was the first one written here, and it produced 199,99 kr. for a
  // 200,00 kr. connector-month: 11/31 truncates to 70,96 and 20/31 to 129,03,
  // and the missing eyrir goes nowhere. Silent, once per moved device, and it
  // gets worse the more hosts a device passes through.
  //
  // Allocating cumulatively makes the shares sum to the total by construction:
  // each host gets (running total so far) minus (what has already been given
  // out), so the final share absorbs the remainder rather than dropping it.
  // This is the same discipline `roundAurarToIsk` applies one layer up, and
  // it is why proration must live inside the money engine rather than beside
  // it — a caller doing its own division will make exactly this mistake.
  const denominator = BigInt(shares[0]?.shareDenominator ?? 1);
  let cumulativeNumerator = 0n;
  let alreadyAllocated = 0n;
  let total = 0n;

  for (const s of shares) {
    cumulativeNumerator += BigInt(s.shareNumerator);
    const cumulativeAurar = (CONNECTOR_AURAR * cumulativeNumerator) / denominator;
    const aurar = cumulativeAurar - alreadyAllocated;
    alreadyAllocated = cumulativeAurar;
    total += aurar;
    lines.push(
      `    ${s.orgId === ORG_ID ? "Hýsill A" : "Hýsill B"}  ` +
        `${String(s.shareNumerator).padStart(2)}/${s.shareDenominator} × 200,00 kr.  =  ${isk(Number(aurar))}`,
    );
  }

  const exact = total === CONNECTOR_AURAR;
  return [
    "  UNDER prorate_by_overlap_days — NOT the default, printed for the decision",
    ...lines,
    `    total for one connector-month                       ${isk(Number(total))}` +
      (exact ? "" : "   <- DOES NOT SUM"),
    "",
    "  The shares are allocated CUMULATIVELY so they sum to the total exactly.",
    "  Dividing each share independently loses an eyrir per move — the first",
    "  draft of this note printed 199,99 kr. — which is silent, recurring, and",
    "  the reason proration belongs inside the money engine rather than beside",
    "  it.",
    "",
    "  Under whole_month_per_host, the same month bills 200,00 kr. TWICE —",
    "  400,00 kr. for one physical connector. That is the arithmetic ADR 0054",
    "  calls a defect in its double-invoice example; the only difference here",
    "  is that both hosts consented to it.",
    "",
    "  THE FEEDER CANNOT EXPRESS PRORATION TODAY. `measured()` requires an",
    "  integer count, so a share cannot be passed as a smaller count. Applying",
    "  it needs a per-line (numerator, denominator) carried into the money",
    "  engine and applied after the rate — one contract change, not a second",
    "  engine. Costed here so the fork is decided with that in view.",
  ].join("\n");
}
const CASES: Array<{ name: string; run: (seq: SequenceState) => Promise<CaseResult> | CaseResult }> = [
  { name: "happy-path", run: runHappyPath },
  { name: "holds-without-connector-rows", run: () => runHoldsWithoutConnectorRows() },
  { name: "holds-on-real-driver-definition", run: () => runHoldsOnRealDriverDefinition() },
  { name: "refuses-host-without-kennitala", run: runNoKennitala },
  { name: "refuses-mixed-posture", run: runMixedPosture },
  { name: "numbering-gap-free-and-crash-safe", run: () => runNumbering() },
  { name: "api-lifecycle", run: () => runApiLifecycle() },
  { name: "api-lifecycle-refusals", run: () => runApiLifecycleRefusals() },
  { name: "mid-month-move", run: runMidMonthMove },
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
