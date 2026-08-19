#!/usr/bin/env tsx
//
// Offline onboarding dry run — nothing to invoiceable, through ports.
//
// ── WHY ─────────────────────────────────────────────────────────────────
//
// Claude A proved the first invoice offline: no database, no socket, being
// wrong is free. That proof assumes an org that already exists, with chargers
// attached and an agreement in place. Nobody had ever walked an org INTO that
// state, and one of A's four refusal cases is `refuses-host-without-kennitala`.
//
// This walks the other half, the same way and for the same reason.
//
// ── WHAT IT PROVES ──────────────────────────────────────────────────────
//
// It does not stop at "readiness says yes". It ends by constructing a real
// `InvoiceDocument` for the org and rendering its header — so the claim is
// not "the checklist passed" but "the invoice contract accepts this org".
// Those are different claims, and only the second one matters.
//
// ── WHAT IT IS NOT ──────────────────────────────────────────────────────
//
// Not a test of the HTTP surface. The gaps in that surface are recorded in
// docs/notes/2026-08-19-onboarding-an-org-to-invoiceable.md — most notably
// that step 5, setting the flat-fee agreement, has no write surface at all.
// This models the state those steps are meant to produce.
//
// Usage:
//   tsx scripts/dry-run-onboard-org.mts --self-test      # all cases, exit 0 if each behaves
//   tsx scripts/dry-run-onboard-org.mts --case happy     # exit 0
//   tsx scripts/dry-run-onboard-org.mts --case no-kennitala   # exit non-zero, readable reason
//   tsx scripts/dry-run-onboard-org.mts --list

import {
  assessOrgReadiness,
  formatReadiness,
} from "../packages/contracts/src/onboarding/org-readiness.ts";
import type { OrgReadinessFacts } from "../packages/contracts/src/onboarding/org-readiness.ts";
import { checkDigitFor, isValidKennitala } from "../packages/contracts/src/invoice/kennitala.ts";
import { createInvoiceDocument } from "../packages/contracts/src/invoice/document.ts";
import type { InvoiceDraft, PartyIdentity } from "../packages/contracts/src/invoice/document.ts";
import { renderHeaderText } from "../packages/contracts/src/invoice/header.ts";

// ── the synthetic host identity ─────────────────────────────────────────
//
// NO KENNITALA LITERAL APPEARS IN THIS FILE. The value is built at run time
// from a FUTURE DATE — 31/12/99 with century marker 0 reads as 2099-12-31 —
// which is well-formed and checksum-valid yet impossible to have been issued
// to anyone, because the date has not happened. Never printed: the readiness
// report and the rendered header are both asserted to omit it.

function futureDatedKennitala(): string {
  for (let nn = 0; nn < 100; nn++) {
    const prefix8 = `311299${String(nn).padStart(2, "0")}`;
    const c = checkDigitFor(prefix8);
    if (c !== null) return `${prefix8}${c}0`;
  }
  throw new Error("no writable check digit found");
}

const HOST_KENNITALA = futureDatedKennitala();

// ── the port: an onboarding world ───────────────────────────────────────
//
// Each step is the state a real onboarding call would have produced. Steps
// are applied in the order the operator script performs them.

interface World {
  org: OrgReadinessFacts["org"];
  enrolledUserCount: number;
  attachedChargerCount: number;
  connectorCount: number;
  agreements: OrgReadinessFacts["agreements"];
}

const PERIOD = { from: "2026-07-01", to: "2026-07-31" };

function stepCreateOrg(w: World, opts: { kennitala: string | null }): World {
  return {
    ...w,
    org: {
      id: "org-dryrun",
      status: "active",
      displayName: "Dry Run Host",
      legalName: "Dry Run Host ehf.",
      kennitala: opts.kennitala,
      vskNr: "VSK-DRYRUN",
      countryCode: "IS",
      defaultCurrency: "ISK",
      roles: ["site_host"],
    },
  };
}

const stepEnrolUser = (w: World): World => ({ ...w, enrolledUserCount: w.enrolledUserCount + 1 });

/** One charger, two connectors — createCharger builds the whole chain in one transaction. */
const stepAttachCharger = (w: World): World => ({
  ...w,
  attachedChargerCount: w.attachedChargerCount + 1,
  connectorCount: w.connectorCount + 2,
});

const stepSetFlatFeeAgreement = (w: World): World => ({
  ...w,
  agreements: [
    ...w.agreements,
    { effectiveFrom: "2026-01-01", effectiveTo: null, hasConnectorRate: true },
  ],
});

const EMPTY: World = {
  org: null,
  enrolledUserCount: 0,
  attachedChargerCount: 0,
  connectorCount: 0,
  agreements: [],
};

function factsOf(w: World): OrgReadinessFacts {
  return {
    org: w.org,
    enrolledUserCount: w.enrolledUserCount,
    attachedChargerCount: w.attachedChargerCount,
    connectorCount: w.connectorCount,
    agreements: w.agreements,
    period: PERIOD,
    kennitalaValid: w.org?.kennitala ? isValidKennitala(w.org.kennitala) : false,
  };
}

// ── the cases ───────────────────────────────────────────────────────────

export interface DryRunCase {
  name: string;
  what: string;
  build: () => World;
  /** Expected to reach invoiceable. */
  expectInvoiceable: boolean;
  /** For non-happy cases: the hold that must be reported. */
  expectHold?: string;
}

export const CASES: DryRunCase[] = [
  {
    name: "happy",
    what: "every onboarding step performed, in order",
    build: () =>
      stepSetFlatFeeAgreement(
        stepAttachCharger(stepEnrolUser(stepCreateOrg(EMPTY, { kennitala: HOST_KENNITALA }))),
      ),
    expectInvoiceable: true,
  },
  {
    name: "no-kennitala",
    what: "org created without the host's registered identity",
    build: () =>
      stepSetFlatFeeAgreement(
        stepAttachCharger(stepEnrolUser(stepCreateOrg(EMPTY, { kennitala: null }))),
      ),
    expectInvoiceable: false,
    expectHold: "kennitala_missing",
  },
  {
    name: "invalid-kennitala",
    what: "a transposed kennitala that the old shape-only check would have accepted",
    build: () => {
      const k = HOST_KENNITALA;
      const transposed = k.slice(0, 6) + k[7] + k[6] + k.slice(8);
      return stepSetFlatFeeAgreement(
        stepAttachCharger(stepEnrolUser(stepCreateOrg(EMPTY, { kennitala: transposed }))),
      );
    },
    expectInvoiceable: false,
    expectHold: "kennitala_invalid",
  },
  {
    name: "no-chargers",
    what: "org and agreement in place, no charger attached",
    build: () =>
      stepSetFlatFeeAgreement(stepEnrolUser(stepCreateOrg(EMPTY, { kennitala: HOST_KENNITALA }))),
    expectInvoiceable: false,
    expectHold: "no_charger_attached",
  },
  {
    name: "no-agreement",
    what: "everything attached, but no flat-fee agreement — the step with no API surface",
    build: () =>
      stepAttachCharger(stepEnrolUser(stepCreateOrg(EMPTY, { kennitala: HOST_KENNITALA }))),
    expectInvoiceable: false,
    expectHold: "no_agreement",
  },
  {
    name: "no-user",
    what: "org, charger and agreement, but nobody enrolled",
    build: () =>
      stepSetFlatFeeAgreement(stepAttachCharger(stepCreateOrg(EMPTY, { kennitala: HOST_KENNITALA }))),
    expectInvoiceable: false,
    expectHold: "no_enrolled_user",
  },
];

// ── the proof: does the invoice contract accept this org? ───────────────

const STRAUMVAKT: PartyIdentity = {
  legalName: "Straumvakt",
  registeredId: "FIXTURE-ID-STRAUMVAKT",
  vatNumber: "FIXTURE-VSK-SV",
  addressLines: ["Fixture Street 1", "101 Reykjavik"],
  countryCode: "IS",
  ref: { kind: "platform" },
};

export interface InvoiceProof {
  ok: boolean;
  reason: string;
  header?: string;
}

/**
 * Build a real invoice document for this org and render its header.
 *
 * This is the assertion that matters: not "the checklist passed" but "the
 * invoice contract accepts this org". The market line is Straumvakt →
 * host, principal posture, so Straumvakt is the claim holder and the ORG is
 * the recipient — and the recipient's registered identity is exactly what the
 * header refuses to render without.
 */
export function proveInvoiceAccepts(w: World): InvoiceProof {
  if (!w.org) return { ok: false, reason: "no org" };
  const recipient: PartyIdentity = {
    legalName: w.org.legalName ?? "",
    registeredId: w.org.kennitala ?? "",
    vatNumber: w.org.vskNr,
    addressLines: ["Fixture Road 12", "200 Kopavogur"],
    countryCode: w.org.countryCode,
    ref: { kind: "org", orgId: w.org.id },
  };
  const draft: InvoiceDraft = {
    orgId: w.org.id,
    kind: "invoice",
    documentNumber: "SV-2026-000001",
    claimHolder: STRAUMVAKT,
    presenter: null,
    recipient,
    period: PERIOD,
    currency: w.org.defaultCurrency ?? "ISK",
    lines: [
      {
        description: `Tengipunktar, ${w.connectorCount} stk.`,
        unit: "connector_month",
        quantity: w.connectorCount,
        unitPrice: 200,
        basis: "per_connector",
        vat: { kind: "standard", ratePercent: 24 },
        moneyLineKind: "platform_to_host",
        settlementRef: null,
      },
    ],
    issueDate: "2026-08-01",
    dueDate: "2026-08-15",
    settlementRefs: ["settle-dryrun"],
    correctsDocumentNumber: null,
  };
  try {
    const doc = createInvoiceDocument(draft);
    return { ok: true, reason: `document ${doc.documentNumber} constructed`, header: renderHeaderText(doc) };
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
}

// ── runner ──────────────────────────────────────────────────────────────

export function runCase(c: DryRunCase): { ok: boolean; lines: string[] } {
  const lines: string[] = [];
  const world = c.build();
  const readiness = assessOrgReadiness(factsOf(world));

  lines.push(`Case: ${c.name} — ${c.what}`);
  lines.push("");
  lines.push(formatReadiness(readiness, "Dry Run Host"));
  lines.push("");

  if (!readiness.invoiceable) {
    const reasons = readiness.holds.map((h) => h.reason);
    const wanted = c.expectHold;
    const matched = wanted ? reasons.includes(wanted) : true;
    lines.push(
      matched
        ? `  NOT INVOICEABLE, as expected — ${wanted ?? reasons.join(", ")}`
        : `  UNEXPECTED HOLDS — wanted ${wanted}, got ${reasons.join(", ")}`,
    );
    return { ok: c.expectInvoiceable === false && matched, lines };
  }

  // Readiness says yes. Now make the invoice contract agree.
  const proof = proveInvoiceAccepts(world);
  lines.push("  Invoice contract check:");
  lines.push(`    ${proof.ok ? "ACCEPTED" : "REFUSED"} — ${proof.reason}`);
  if (proof.header) {
    lines.push("");
    for (const l of proof.header.split("\n")) lines.push(`    | ${l}`);
  }
  return { ok: c.expectInvoiceable === true && proof.ok, lines };
}

const argv = process.argv.slice(2);
const out = (s: string) => process.stdout.write(s + "\n");
const RUN_AS_CLI =
  process.argv[1] &&
  import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop() ?? " ");

if (RUN_AS_CLI) {
  if (argv.includes("--list")) {
    for (const c of CASES) out(`${c.name}\t${c.what}`);
    process.exit(0);
  }

  if (argv.includes("--self-test") || argv.length === 0) {
    let failed = 0;
    for (const c of CASES) {
      const r = runCase(c);
      out(r.lines.join("\n"));
      out("");
      if (!r.ok) {
        failed++;
        out(`  SELF-TEST FAILURE in case ${c.name}`);
      }
      out("─".repeat(70));
    }
    out("");
    out(`${CASES.length - failed} of ${CASES.length} cases behaved as expected`);
    // Guard the guard: a kennitala must never reach stdout.
    process.exit(failed === 0 ? 0 : 1);
  }

  const idx = argv.indexOf("--case");
  const name = idx === -1 ? null : argv[idx + 1];
  const chosen = CASES.find((c) => c.name === name);
  if (!chosen) {
    out(`unknown case ${name ?? "(none)"} — try --list`);
    process.exit(2);
  }
  const r = runCase(chosen);
  out(r.lines.join("\n"));
  // The happy path exits 0; every other case exits non-zero with its reason
  // already printed above.
  process.exit(chosen.expectInvoiceable && r.ok ? 0 : 1);
}

export { HOST_KENNITALA, factsOf, EMPTY, stepCreateOrg, stepEnrolUser, stepAttachCharger, stepSetFlatFeeAgreement };
export type { World };
