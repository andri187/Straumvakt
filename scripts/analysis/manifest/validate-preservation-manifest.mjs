#!/usr/bin/env node
// Offline preservation-manifest validator.
//
// The cleanup plan's whole safety argument is an ORDERING: prove reproduction,
// copy and hash, verify the archive by extracting it, unlink junctions, and only
// then propose deletion in a separate session. A document can assert that
// ordering. It cannot enforce it. These rules can.
//
// SAFETY, deliberate and inspectable:
//   * imports only node:fs and node:path/url — no fetch, no http/https,
//     no child_process, no dynamic import. It cannot reach a network.
//   * it reads the manifest and NOTHING ELSE. It does not stat the paths it
//     describes, because a validator that touches the tree it is protecting is
//     one bug away from being the thing that damages it.
//   * writes only to stdout/stderr. It deletes nothing and contains no delete verb.
//
// A preservation manifest is EVIDENCE and a PRECONDITION, not an instruction.
//
// Usage:
//   node validate-preservation-manifest.mjs <file.json>...
//   node validate-preservation-manifest.mjs --strict <file.json>
//   node validate-preservation-manifest.mjs --json <file.json>
//   node validate-preservation-manifest.mjs --self-test

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCHEMA = JSON.parse(readFileSync(join(HERE, 'preservation-manifest.schema.json'), 'utf8'));
const EXPECTED = JSON.parse(readFileSync(join(HERE, 'preservation-expectations.json'), 'utf8'));

function validate(node, schema, path, errs, root) {
  if (schema.$ref) return validate(node, root.$defs[schema.$ref.replace('#/$defs/', '')], path, errs, root);
  if (schema.const !== undefined && node !== schema.const) {
    errs.push(`${path}: expected ${JSON.stringify(schema.const)}`); return;
  }
  if (schema.enum && !schema.enum.includes(node)) {
    errs.push(`${path}: ${JSON.stringify(node)} not in [${schema.enum.join(', ')}]`); return;
  }
  const types = schema.type ? (Array.isArray(schema.type) ? schema.type : [schema.type]) : null;
  if (types) {
    const actual = node === null ? 'null' : Array.isArray(node) ? 'array' : typeof node;
    if (!types.some((t) => (t === 'integer' ? Number.isInteger(node) : t === actual))) {
      errs.push(`${path}: expected ${types.join('|')}, got ${actual}`); return;
    }
  }
  if (node === null) return;
  if (typeof node === 'string') {
    if (schema.minLength != null && node.length < schema.minLength) errs.push(`${path}: too short`);
    if (schema.pattern && !new RegExp(schema.pattern).test(node)) errs.push(`${path}: ${JSON.stringify(node)} fails /${schema.pattern}/`);
  }
  if (typeof node === 'number' && schema.minimum != null && node < schema.minimum) errs.push(`${path}: below minimum`);
  if (Array.isArray(node)) {
    if (schema.minItems != null && node.length < schema.minItems) errs.push(`${path}: needs >= ${schema.minItems}`);
    if (schema.items) node.forEach((v, i) => validate(v, schema.items, `${path}[${i}]`, errs, root));
    return;
  }
  if (node && typeof node === 'object') {
    for (const r of schema.required ?? []) if (!(r in node)) errs.push(`${path}: missing required "${r}"`);
    if (schema.additionalProperties === false && schema.properties) {
      for (const k of Object.keys(node)) if (!(k in schema.properties)) errs.push(`${path}: unexpected property "${k}"`);
    }
    for (const [k, sub] of Object.entries(schema.properties ?? {})) if (k in node) validate(node[k], sub, `${path}.${k}`, errs, root);
  }
}

// A recursive-delete verb anywhere near a junction is the single most dangerous
// instruction this project can write down, because it follows the link and
// removes the target. Detected as data, not left to review.
const FOLLOWING_DELETE = /Remove-Item[^\n]*-Recurse|rm\s+-rf|rmdir\s+\/s|del\s+\/s/i;
const NON_FOLLOWING = /cmd\s*\/c\s*rmdir|fsutil\s+reparsepoint\s+delete|Directory\.Delete\([^,)]*\)/i;

function policy(m, errs, warns) {
  const records = m.records ?? [];
  const ids = records.map((r) => r.id);
  const byPath = new Map(records.map((r) => [r.path.replace(/\\/g, '/').toLowerCase(), r]));
  const root = (m.root ?? '').replace(/\\/g, '/').toLowerCase();

  // P1. Nothing may claim a recovery path it does not have.
  for (const r of records) {
    if (r.recoveryPath === 'archive' && r.archiveVerified !== true && r.deletable === true) {
      errs.push(`P1: ${r.id} is marked deletable and relies on the archive, but archiveVerified is not true`);
    }
  }
  // P2. An archive verified by reading its own listing is not verified.
  if (m.archive?.verified === true && m.archive.verificationMethod !== 'extract-and-compare') {
    errs.push(`P2: archive claims verified via "${m.archive.verificationMethod}" — only extract-and-compare is verification; a listing is a hypothesis`);
  }
  // P3. The archive must not live inside the tree it protects.
  const dest = (m.archive?.destination ?? '').replace(/\\/g, '/').toLowerCase();
  if (root && dest.startsWith(root)) {
    errs.push(`P3: archive destination "${m.archive.destination}" is inside the root being cleaned — it would be destroyed by the operation it exists to survive`);
  }
  // P4. Deletion requires a verified archive AND a stated prerequisite.
  for (const r of records.filter((x) => x.deletable === true)) {
    if (!r.safeDeletePrerequisite) errs.push(`P4: ${r.id} is deletable with no safeDeletePrerequisite recorded`);
    if (m.archive?.verified !== true) errs.push(`P4: ${r.id} is deletable but the archive itself is not verified`);
  }
  // P5. Named irreplaceable targets must be present, and their counts must match.
  for (const [needle, exp] of Object.entries(EXPECTED.requiredRecords)) {
    const hit = [...byPath.entries()].find(([p]) => p.includes(needle.toLowerCase()));
    if (!hit) { errs.push(`P5: no record covers "${needle}" — ${exp.why}`); continue; }
    const r = hit[1];
    if (r.status === 'missing') errs.push(`P5: ${r.id} (${needle}) is MISSING — stop all cleanup`);
    if (exp.fileCount != null && r.verifiedFileCount != null && r.verifiedFileCount !== exp.fileCount) {
      errs.push(`P5: ${r.id} (${needle}) verified ${r.verifiedFileCount} files, expected ${exp.fileCount}`);
    }
    if (exp.fileCount != null && r.status === 'verified' && r.verifiedFileCount == null) {
      errs.push(`P5: ${r.id} (${needle}) claims verified with no verifiedFileCount`);
    }
  }
  // P6. A repository with zero commits is not a backup, and must not be recorded
  //     as if it were. This exists because the presence of a .git directory has
  //     already caused exactly that mistake here.
  for (const r of records) {
    const v = r.vcs;
    if (!v) continue;
    if (v.hasGitDir === true && v.commitCount === 0) {
      if (r.recoveryPath !== 'none') {
        errs.push(`P6: ${r.id} has a .git directory with 0 commits but claims recoveryPath "${r.recoveryPath}" — an empty repository is not a backup`);
      }
      if (v.trackedFileCount > 0) {
        errs.push(`P6: ${r.id} reports 0 commits but ${v.trackedFileCount} tracked files — impossible; recheck`);
      }
    }
    if (r.recoveryPath === 'git-remote' && v.commitCount === 0) {
      errs.push(`P6: ${r.id} claims git-remote recovery with 0 commits`);
    }
  }
  // P7. "verified" without a timestamp is an assertion, not a verification.
  for (const r of records) {
    if (r.status === 'verified' && !r.verifiedAt) errs.push(`P7: ${r.id} is verified with no verifiedAt`);
  }
  if (m.archive?.verified === true && !m.archive.verifiedAt) errs.push('P7: archive is verified with no verifiedAt');
  // P8. Integrity must use an algorithm that still means something.
  if (['md5', 'sha1'].includes(m.archive?.checksumAlgorithm)) {
    errs.push(`P8: checksumAlgorithm "${m.archive.checksumAlgorithm}" is not collision-resistant; use sha256 or sha512`);
  }
  // P9. Personal data does not leave the platform on a shrug.
  for (const r of records) {
    if (r.containsPersonalData === true && r.dataProtectionApproved !== true) {
      errs.push(`P9: ${r.id} contains personal data and is scheduled for archive without dataProtectionApproved`);
    }
  }
  // P10. Junctions: the unlink command must not be one that follows the link.
  for (const j of m.junctions ?? []) {
    if (FOLLOWING_DELETE.test(j.unlinkCommand)) {
      errs.push(`P10: junction "${j.junction}" specifies a RECURSIVE delete — it can traverse the junction and destroy the target "${j.target}"`);
    } else if (!NON_FOLLOWING.test(j.unlinkCommand)) {
      warns.push(`P10 WARN: junction "${j.junction}" unlink command is not a recognised non-following form`);
    }
    if (j.targetFileCountBefore != null && j.targetFileCountAfter != null &&
        j.targetFileCountBefore !== j.targetFileCountAfter) {
      errs.push(`P10: junction "${j.junction}" target lost ${j.targetFileCountBefore - j.targetFileCountAfter} files during unlink — the delete followed the link`);
    }
  }
  // P11. A worktree is retirable only when it holds nothing that exists nowhere
  //      else. Dirty files are someone else's in-progress work.
  for (const w of m.worktrees ?? []) {
    if (w.retirable !== true) continue;
    if (w.uniqueCommits > 0) errs.push(`P11: worktree ${w.path} is marked retirable with ${w.uniqueCommits} unique commits`);
    if (w.dirtyFiles > 0) errs.push(`P11: worktree ${w.path} is marked retirable with ${w.dirtyFiles} dirty files — that is another agent's uncommitted work`);
    if (w.branchPreserved !== true) errs.push(`P11: worktree ${w.path} is retirable without branchPreserved — retiring a working copy must never delete the branch`);
  }
  // P12. Measurement must be the corrected kind, and "regenerable" must be proven.
  const meas = m.measurement;
  if (meas) {
    if (meas.reparsePointsExcluded !== true) {
      errs.push('P12: measurement.reparsePointsExcluded is not true — following junctions double-counts and has already produced impossible figures on this estate');
    }
    if (meas.totalGB != null && meas.regenerableGB != null && meas.regenerableGB > meas.totalGB) {
      errs.push(`P12: regenerableGB ${meas.regenerableGB} exceeds totalGB ${meas.totalGB} — this is the exact signature of a junction-following measurement`);
    }
    if (meas.contentGB != null && meas.contentGB < 0) errs.push('P12: contentGB is negative');
    if (meas.regenerationProven !== true && records.some((r) => r.kind === 'build-output' && r.deletable === true)) {
      warns.push('P12 WARN: build output is marked deletable but regenerationProven is not true — "regenerable" is an assumption about registries until demonstrated');
    }
  }
  // P13. Third-party material is a redistribution decision, not a default.
  for (const r of records) {
    if (r.thirdPartyLicensed === true && r.recoveryPath === 'git-remote') {
      warns.push(`P13 WARN: ${r.id} is third-party licensed and recorded as recoverable from a git remote — committing it is a redistribution decision`);
    }
  }
  // P14. Duplicate ids make a manifest unciteable.
  const dupes = ids.filter((x, i) => ids.indexOf(x) !== i);
  if (dupes.length) errs.push(`P14: duplicate record ids: ${[...new Set(dupes)].join(', ')}`);
  // P15. An archive that shares a failure domain with the original is half a backup.
  if (m.archive?.verified === true && m.archive.independentFailureDomain !== true) {
    warns.push('P15 WARN: archive.independentFailureDomain is not true — this protects against an accidental delete, not against loss of the disk');
  }
}

function check(file) {
  const errs = [], warns = [];
  let doc;
  try { doc = JSON.parse(readFileSync(file, 'utf8')); }
  catch (e) { return { file, errs: [`unparseable: ${e.message}`], warns }; }
  validate(doc, SCHEMA, '$', errs, SCHEMA);
  if (!errs.length) policy(doc, errs, warns);
  return { file, errs, warns };
}

function selfTest() {
  const dir = join(HERE, 'preservation-fixtures');
  const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  let pass = 0, fail = 0;
  for (const f of files) {
    const kind = f.includes('.valid.') ? 'valid' : f.includes('.warns.') ? 'warns' : 'invalid';
    const r = check(join(dir, f));
    const isValid = r.errs.length === 0;
    let ok;
    if (kind === 'valid') ok = isValid && r.warns.length === 0;
    else if (kind === 'warns') ok = isValid && r.warns.length > 0;
    else ok = !isValid;
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${basename(f)}  (${kind})`);
    if (ok) {
      pass++;
      if (kind === 'invalid') console.log(`          rejected: ${r.errs[0]}`);
      if (kind === 'warns') console.log(`          strict-only: ${r.warns[0]}`);
    } else {
      fail++;
      r.errs.forEach((e) => console.log(`          ERR  ${e}`));
      r.warns.forEach((w) => console.log(`          WARN ${w}`));
    }
  }
  console.log(`\n  ${pass} passed, ${fail} failed  (${files.length} fixtures)`);
  return fail ? 1 : 0;
}

const args = process.argv.slice(2);
if (args.includes('--self-test')) process.exit(selfTest());
const strict = args.includes('--strict');
const asJson = args.includes('--json');
const files = args.filter((a) => !a.startsWith('--'));
if (!files.length) {
  console.error('usage: node validate-preservation-manifest.mjs [--strict] [--json] <file.json>... | --self-test');
  process.exit(2);
}
let bad = 0;
const results = [];
for (const f of files) {
  const r = check(f);
  if (strict && r.warns.length) { r.errs.push(...r.warns.map((w) => w.replace(' WARN:', ' STRICT:'))); r.warns = []; }
  if (r.errs.length) bad++;
  results.push({ file: basename(f), valid: r.errs.length === 0, errors: r.errs, warnings: r.warns });
  if (!asJson) {
    console.log(r.errs.length ? `INVALID ${basename(f)}` : `VALID   ${basename(f)}`);
    r.errs.forEach((e) => console.log(`  ERROR ${e}`));
    r.warns.forEach((w) => console.log(`  ${w}`));
  }
}
if (asJson) console.log(JSON.stringify({ strict, results }, null, 2));
process.exit(bad ? 1 : 0);
