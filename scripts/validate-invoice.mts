#!/usr/bin/env tsx
//
// Offline invoice-document validator.
//
// Takes an invoice document (or a directory of them) and prints every reason
// it is not issuable. No network, no database, no credentials — it is pure
// evaluation of the rules in packages/contracts/src/invoice/document.ts, which
// is what makes it safe to wire into `npm run check` and to run on any branch.
//
// WHY A CLI AND NOT ONLY A UNIT TEST: the first invoice will be produced by a
// generator nobody has written yet, reviewed by a human who is not going to
// read document.ts. "Here is the JSON, tell me why it will not issue" is the
// question that will actually be asked, so it gets an answer that exits
// non-zero.
//
// Usage:
//   tsx scripts/validate-invoice.mts --self-test
//   tsx scripts/validate-invoice.mts path/to/document.json [more.json ...]
//   tsx scripts/validate-invoice.mts --dir path/to/documents
//
// Exit codes: 0 = everything issuable / self-test green. 1 = at least one
// document is not issuable, or a self-test expectation was violated. 2 = usage
// or I/O error.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { validateDraft, createInvoiceDocument } from "../packages/contracts/src/invoice/document.ts";
import type { InvoiceDraft } from "../packages/contracts/src/invoice/document.ts";
import { renderHeaderText } from "../packages/contracts/src/invoice/header.ts";
import {
  DOCUMENT_FIXTURES,
  FIXTURE_COUNT,
} from "../packages/contracts/src/invoice/fixtures.ts";

const argv = process.argv.slice(2);
const out = (s: string) => process.stdout.write(s + "\n");

function usage(code: number): never {
  out(
    [
      "validate-invoice — offline invoice issuability validator",
      "",
      "  --self-test          run the built-in fixture corpus",
      "  --dir <path>         validate every .json in a directory",
      "  <file.json> [...]    validate the named documents",
      "  --render             also print the rendered header for issuable documents",
      "",
      "exit 0 = issuable, 1 = not issuable, 2 = usage error",
    ].join("\n"),
  );
  process.exit(code);
}

function reportDraft(label: string, draft: InvoiceDraft, render: boolean): boolean {
  const problems = validateDraft(draft);
  if (problems.length === 0) {
    out(`  OK    ${label}`);
    if (render) {
      const doc = createInvoiceDocument(draft);
      for (const line of renderHeaderText(doc).split("\n")) out(`        │ ${line}`);
    }
    return true;
  }
  out(`  FAIL  ${label}`);
  for (const p of problems) {
    out(`          ${p.code}${p.path ? ` (${p.path})` : ""}: ${p.message}`);
  }
  return false;
}

// ── self-test ───────────────────────────────────────────────────────────

if (argv.includes("--self-test")) {
  let passed = 0;
  let failed = 0;

  for (const f of DOCUMENT_FIXTURES) {
    const problems = validateDraft(f.draft);
    const codes = problems.map((p) => p.code);
    if (f.expect.issuable) {
      if (problems.length === 0) passed++;
      else {
        failed++;
        out(`  FAIL  ${f.name}: expected issuable, got [${codes.join(", ")}]`);
      }
    } else {
      const missing = f.expect.codes.filter((c) => !codes.includes(c));
      if (problems.length > 0 && missing.length === 0) passed++;
      else {
        failed++;
        out(
          `  FAIL  ${f.name}: expected [${f.expect.codes.join(", ")}], got [${codes.join(", ")}]`,
        );
      }
    }
  }

  // The floor from the prompt's gate table. Deleting fixtures to make a run
  // green must fail here rather than pass quietly.
  const FLOOR = 40;
  if (FIXTURE_COUNT < FLOOR) {
    failed++;
    out(`  FAIL  fixture corpus is ${FIXTURE_COUNT}, below the floor of ${FLOOR}`);
  }

  out("");
  out(`  document fixtures: ${passed} passed, ${failed} failed`);
  out(`  total fixture corpus (documents + delivery + settlement + numbering): ${FIXTURE_COUNT}`);
  process.exit(failed === 0 ? 0 : 1);
}

// ── file mode ───────────────────────────────────────────────────────────

const render = argv.includes("--render");
const files: string[] = [];

const dirIdx = argv.indexOf("--dir");
if (dirIdx !== -1) {
  const dir = argv[dirIdx + 1];
  if (!dir) usage(2);
  try {
    for (const name of readdirSync(dir)) {
      if (name.endsWith(".json") && statSync(join(dir, name)).isFile()) files.push(join(dir, name));
    }
  } catch (e) {
    out(`cannot read directory ${dir}: ${(e as Error).message}`);
    process.exit(2);
  }
}
for (const a of argv) {
  if (a.startsWith("--")) continue;
  if (dirIdx !== -1 && a === argv[dirIdx + 1]) continue;
  files.push(a);
}

if (files.length === 0) usage(2);

let allOk = true;
for (const file of files) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    out(`  FAIL  ${file}: not valid JSON — ${(e as Error).message}`);
    allOk = false;
    continue;
  }
  const drafts: InvoiceDraft[] = Array.isArray(parsed)
    ? (parsed as InvoiceDraft[])
    : [parsed as InvoiceDraft];
  drafts.forEach((d, i) => {
    const label = drafts.length > 1 ? `${file}[${i}]` : file;
    if (!reportDraft(label, d, render)) allOk = false;
  });
}

process.exit(allOk ? 0 : 1);
