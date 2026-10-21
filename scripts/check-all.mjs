#!/usr/bin/env node
//
// Run every check, report every result.
//
// `npm run check` used to be `a && b && c && ...`, which stops at the first
// failure. That is how check:schema-parity stayed invisible while it was RED:
// typecheck died ahead of it in the chain, so nobody saw the parity error
// underneath, and the two Prisma schemas drifted twice.
//
// A gate you cannot see fail is not a gate. This runs all of them and prints
// a summary, exiting non-zero if any failed.
import { spawnSync } from "node:child_process";

const CHECKS = [
  ["typecheck", "npm run typecheck"],
  // `npm run typecheck --workspaces --if-present` treats a missing typecheck
  // script as success, so a package with TypeScript and no script is compiled
  // by nothing while the pipeline prints PASS. That is how shared/commercial/
  // contracts went unchecked. This asserts the invariant, not the instance.
  ["workspace-typecheck", "npm run check:workspace-typecheck"],
  ["schemas", "npm run check:schemas"],
  ["api-schema", "npm run check:api-schema"],
  // Replaced check:schema-parity on 2026-08-07 (ADR 0051). That one ran
  // `prisma migrate diff` between prisma/schema and apps/api/prisma/schema —
  // two copies of the same files, one generated from the other, so it could
  // only ever catch a stale copy that check:api-schema already catches.
  // Drizzle is authoritative now, and this catches the divergence that can
  // actually happen: Drizzle and Prisma describing different databases while
  // ~500 un-ported calls still use the Prisma client. It goes away with them.
  ["schema-consistency", "npm run check:schema-consistency"],
  ["deps", "npm run check:deps"],
  ["deps-graph", "npm run check:deps-graph"],
  ["api-endpoints", "npm run check:api-endpoints"],
  ["unused-exports", "npm run check:unused-exports"],
  // Pricing single source of truth. Four call sites price a session today
  // and they can disagree about what a driver owes; this fails when a
  // fifth appears, so the next one is a decision rather than an accident.
  ["pricing-ssot", "npm run check:pricing-ssot"],
  // Tenant-scoping guard. requirePermission without orgIdParam resolves orgId
  // to null, which SKIPS the membership lookup — so the gate is both
  // unreachable for org members and tenant-wide for platform grants. 75 such
  // gates exist today and are allowlisted with reasons; this fails on the 76th,
  // and equally when one is fixed and left in the list. Offline, no DB.
  ["orgid-param", "npm run check:orgid-param"],
  // S2 ordering guard. The invite-consume Critical is an ORDERING bug,
  // and a status-code test cannot see it — the route returns the same 409
  // whether or not it burned the invite on the way out. Offline, no DB.
  ["invite-guard", "npm run check:invite-guard"],
  // Tier 0 of docs/operator/CI_MIGRATION_CHECK_CREDENTIAL.md. The regression
  // that hid two unapplied migrations was pure config — prisma.config.ts had
  // no migrations.path, so `migrate status` reported "up to date" having seen
  // nothing. That is detectable with no database and no credential, so unlike
  // check:migrations it can run on every branch and PR.
  ["migrations-visible", "npm run check:migrations-visible"],
  // Invoice issuability. Offline and credential-free like migrations-visible,
  // so it runs on every branch. It exists because the first invoice will be
  // produced by a generator that does not exist yet: the rules it must satisfy
  // are gated now, not after something has already been sent to a host.
  // See docs/notes/2026-08-18-invoice-delivery-decision.md.
  ["invoice", "npm run check:invoice"],
  // Every service / queue / R2 / Hyperdrive binding must name a resource that
  // exists on the account. Added 2026-08-18 after `gateway/wrangler.jsonc`
  // was found binding MAIN_APP to `hlada-api` — a Worker that has never
  // existed — with nothing to catch it, because nothing compared config
  // against reality. Runs offline against a recorded account snapshot, so it
  // needs no credential and works on every branch.
  ["bindings", "npm run check:bindings"],
  // Can an org still be walked from nothing to invoiceable? Offline, through
  // ports, ending by constructing a real invoice document rather than by
  // declaring the checklist passed. Added 2026-08-19 — the invoice pipeline
  // refuses an unready org correctly, and this asks the same question at
  // onboarding, where fixing it is free.
  ["onboarding", "npm run check:onboarding"],
];

const results = [];
for (const [name, cmd] of CHECKS) {
  process.stdout.write(`\n─── ${name} ${"─".repeat(Math.max(0, 60 - name.length))}\n`);
  const r = spawnSync(cmd, { shell: true, stdio: "inherit" });
  results.push([name, r.status === 0]);
}

const failed = results.filter(([, ok]) => !ok);
process.stdout.write(`\n${"═".repeat(66)}\n`);
for (const [name, ok] of results) process.stdout.write(`  ${ok ? "PASS" : "FAIL"}  ${name}\n`);
process.stdout.write(`${"═".repeat(66)}\n`);

if (failed.length) {
  process.stdout.write(`\n${failed.length} of ${results.length} checks failed: ${failed.map(([n]) => n).join(", ")}\n`);
  process.exit(1);
}
process.stdout.write(`\nall ${results.length} checks passed\n`);
