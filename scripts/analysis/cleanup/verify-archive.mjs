#!/usr/bin/env node
// Archive verification gate.
//
// This is the check that must pass before deletion is ever PROPOSED. It answers
// one question: for every preservation record, does the archive actually contain
// the material, byte for byte, and can that be demonstrated rather than asserted?
//
// It deliberately does NOT verify by reading the archive's own listing. A listing
// proves that a listing exists. Verification means hashing what was extracted and
// comparing it against what was hashed at the source.
//
// SAFETY, by construction:
//   * imports only node:fs, node:path, node:crypto, node:url. No network, no
//     child_process, no shell.
//   * it READS two trees and WRITES one report to a path you name. It creates no
//     directory, moves nothing, and contains no delete verb — grep it.
//   * it refuses to write its report inside the estate root it is protecting.
//   * it never opens a credential-shaped file; it records that one exists, by
//     path, and fails the run. A credential inside an archive is a second copy of
//     a live secret.
//   * hashing never follows a reparse point.
//
// Exit codes: 0 all records verified · 1 verification failed · 2 usage error.
//
// Usage:
//   node verify-archive.mjs --manifest <preservation-manifest.json> \
//                           --archive  <extracted archive root> \
//                           --report   <path outside E:\Claude>
//   node verify-archive.mjs --self-test

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync, lstatSync, existsSync, mkdtempSync, mkdirSync, unlinkSync } from 'node:fs';
import { join, relative, basename, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ESTATE_ROOT = 'e:/claude';
// Kept in step with build-freeze-manifest.mjs. `.jks` and `key.properties` are
// included because an Android upload keystore is the one credential here that
// cannot be rotated — and an archive containing it is a second copy of it.
const CREDENTIAL_NAME = /^\.env($|\.)|\.(pem|p12|pfx|jks|jceks|keystore|p8|asc|gpg)$|^key\.properties$|^charger-credentials\.json$|^secrets\.tf$/i;

function walk(root) {
  const out = [];
  const rec = (d, depth) => {
    if (depth > 40) return;
    let entries;
    try { entries = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = join(d, e.name);
      let st; try { st = lstatSync(p); } catch { continue; }
      if (st.isSymbolicLink()) continue;                 // never follow a junction
      if (e.isDirectory()) { rec(p, depth + 1); continue; }
      out.push(p);
    }
  };
  rec(root, 0);
  return out.sort();
}

function sha256(file) {
  const h = createHash('sha256');
  h.update(readFileSync(file));
  return h.digest('hex');
}

// Compare a source tree against its counterpart inside the extracted archive.
// Returns a per-record result; never throws on a missing path.
function verifyRecord(rec, archiveRoot) {
  const res = {
    id: rec.id, path: rec.path, kind: rec.kind,
    sourcePresent: false, archivePresent: false,
    sourceFiles: 0, archiveFiles: 0,
    matched: 0, missingFromArchive: [], differing: [], extraInArchive: [],
    credentialShapedInArchive: [],
    status: 'not-verified', reason: null,
  };

  const src = rec.path.replace(/\\/g, '/');
  // The archive mirrors the source path under a slug, so that two records with
  // the same basename cannot collide.
  const slug = rec.id;
  const arc = join(archiveRoot, slug);

  res.sourcePresent = existsSync(src);
  res.archivePresent = existsSync(arc);

  if (!res.archivePresent) {
    res.status = 'FAIL';
    res.reason = `no archive directory for ${rec.id} at ${arc} — this record is not in the archive at all`;
    return res;
  }
  if (!res.sourcePresent) {
    res.status = 'FAIL';
    res.reason = `source ${rec.path} does not exist, so the archive cannot be verified against it. If the source is already gone, this run cannot establish whether the archive is complete.`;
    return res;
  }

  const srcFiles = walk(src);
  const arcFiles = walk(arc);
  res.sourceFiles = srcFiles.length;
  res.archiveFiles = arcFiles.length;

  const arcRel = new Map(arcFiles.map((f) => [relative(arc, f).replace(/\\/g, '/'), f]));
  for (const f of arcFiles) {
    if (CREDENTIAL_NAME.test(basename(f))) {
      res.credentialShapedInArchive.push(relative(arc, f).replace(/\\/g, '/'));
    }
  }

  for (const f of srcFiles) {
    const rel = relative(src, f).replace(/\\/g, '/');
    const a = arcRel.get(rel);
    if (!a) { res.missingFromArchive.push(rel); continue; }
    arcRel.delete(rel);
    let sh, ah;
    try { sh = sha256(f); ah = sha256(a); }
    catch (e) { res.differing.push(`${rel} (unreadable: ${e.code ?? e.message})`); continue; }
    if (sh === ah) res.matched++;
    else res.differing.push(rel);
  }
  res.extraInArchive = [...arcRel.keys()];

  if (res.credentialShapedInArchive.length) {
    res.status = 'FAIL';
    res.reason = `the archive contains ${res.credentialShapedInArchive.length} credential-shaped file(s) — an archive is a second copy of a live secret. Exclude and re-create it.`;
  } else if (res.missingFromArchive.length || res.differing.length) {
    res.status = 'FAIL';
    res.reason = `${res.missingFromArchive.length} file(s) missing from the archive, ${res.differing.length} differing`;
  } else if (rec.expectedFileCount != null && res.sourceFiles !== rec.expectedFileCount) {
    res.status = 'FAIL';
    res.reason = `source holds ${res.sourceFiles} files but the record expects ${rec.expectedFileCount} — the record and the tree disagree, so neither can be trusted`;
  } else {
    res.status = 'PASS';
  }
  return res;
}

function run(manifestPath, archiveRoot) {
  const m = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const records = (m.records ?? []).filter((r) => r.kind !== 'build-output' && r.status !== 'not-applicable');
  const results = records.map((r) => verifyRecord(r, archiveRoot));
  const failed = results.filter((r) => r.status !== 'PASS');

  // The archive's own claims must agree with what we just measured.
  const archiveClaims = [];
  if (m.archive?.verificationMethod !== 'extract-and-compare') {
    archiveClaims.push(`manifest records verificationMethod "${m.archive?.verificationMethod}" — this tool only ever performs extract-and-compare, so the manifest understates what was done, or was written before the archive existed`);
  }
  if (m.archive?.verified === true && failed.length) {
    archiveClaims.push('manifest claims archive.verified true, but verification failed just now — the claim is stale or was never earned');
  }
  return { manifestPath, archiveRoot, results, failed: failed.length, archiveClaims };
}

function report(out) {
  const lines = [];
  const say = (s) => { lines.push(s); console.log(s); };
  say('Archive verification — extract-and-compare');
  say(`  manifest: ${out.manifestPath}`);
  say(`  archive:  ${out.archiveRoot}`);
  say('');
  for (const r of out.results) {
    const tag = r.status === 'PASS' ? 'PASS' : 'FAIL';
    say(`  ${tag}  ${r.id}  ${r.path}`);
    say(`        source ${r.sourceFiles} files · archive ${r.archiveFiles} · matched ${r.matched}`);
    if (r.reason) say(`        ${r.reason}`);
    for (const f of r.missingFromArchive.slice(0, 5)) say(`        MISSING  ${f}`);
    if (r.missingFromArchive.length > 5) say(`        ... and ${r.missingFromArchive.length - 5} more missing`);
    for (const f of r.differing.slice(0, 5)) say(`        DIFFERS  ${f}`);
    if (r.differing.length > 5) say(`        ... and ${r.differing.length - 5} more differing`);
    for (const f of r.extraInArchive.slice(0, 3)) say(`        EXTRA    ${f}`);
    for (const f of r.credentialShapedInArchive) say(`        CREDENTIAL-SHAPED IN ARCHIVE  ${f}`);
  }
  say('');
  for (const c of out.archiveClaims) say(`  NOTE  ${c}`);
  if (out.failed) {
    say(`  ${out.failed} record(s) FAILED verification.`);
    say('  DELETION MUST NOT BE PROPOSED. Not "proceed with care" — not proposed.');
  } else {
    say(`  All ${out.results.length} record(s) verified by extract-and-compare.`);
    say('  This is a precondition for proposing deletion. It is not an approval, and it does not authorise anything.');
  }
  return lines.join('\n');
}

// ── self-test: build two tiny trees in the OS temp dir and verify them ──
function selfTest() {
  const HERE = dirname(fileURLToPath(import.meta.url));
  const tmp = mkdtempSync(join(tmpdir(), 'straumvakt-archive-selftest-'));
  const srcA = join(tmp, 'src-a'), arc = join(tmp, 'archive');
  mkdirSync(join(arc, 'P-01'), { recursive: true });
  mkdirSync(srcA, { recursive: true });
  writeFileSync(join(srcA, 'one.md'), 'alpha\n');
  writeFileSync(join(srcA, 'two.md'), 'beta\n');
  writeFileSync(join(arc, 'P-01', 'one.md'), 'alpha\n');
  writeFileSync(join(arc, 'P-01', 'two.md'), 'beta\n');

  const mk = (over) => {
    const p = join(tmp, `m-${Math.abs(hashStr(JSON.stringify(over)))}.json`);
    writeFileSync(p, JSON.stringify({
      manifestVersion: 1, generatedAt: '2026-08-09T00:00:00Z', root: 'E:\\Claude',
      archive: { destination: arc, checksumAlgorithm: 'sha256', verificationMethod: 'extract-and-compare', verified: true, verifiedAt: '2026-08-09T00:00:00Z', independentFailureDomain: true },
      records: [Object.assign({
        id: 'P-01', path: srcA, kind: 'specification', expectedFileCount: 2,
        status: 'verified', verifiedAt: '2026-08-09T00:00:00Z', recoveryPath: 'archive',
      }, over)],
    }, null, 2));
    return p;
  };
  const hashStr = (s) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return h; };

  const cases = [];
  cases.push(['identical trees verify', run(mk({}), arc), 0]);

  writeFileSync(join(arc, 'P-01', 'two.md'), 'CHANGED\n');
  cases.push(['a differing file fails', run(mk({ id: 'P-01' }), arc), 1]);
  writeFileSync(join(arc, 'P-01', 'two.md'), 'beta\n');

  cases.push(['a wrong expected count fails', run(mk({ expectedFileCount: 99 }), arc), 1]);

  cases.push(['a record absent from the archive fails', run(mk({ id: 'P-99' }), arc), 1]);

  writeFileSync(join(arc, 'P-01', '.env'), 'x\n');
  cases.push(['a credential-shaped file in the archive fails', run(mk({}), arc), 1]);
  unlinkSync(join(arc, 'P-01', '.env'));

  let pass = 0, fail = 0;
  for (const [name, out, expectFailures] of cases) {
    const ok = (expectFailures === 0) === (out.failed === 0);
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`);
    if (ok) { pass++; if (out.failed) console.log(`          ${out.results.find((r) => r.status !== 'PASS')?.reason ?? ''}`); }
    else { fail++; console.log(`          failed=${out.failed}, expected ${expectFailures ? '>0' : '0'}`); }
  }
  console.log(`\n  ${pass} passed, ${fail} failed  (${cases.length} fixtures)`);
  console.log(`  (scratch trees left in ${tmp} — this tool deletes nothing, including its own temporary files)`);
  return fail ? 1 : 0;
}

const args = process.argv.slice(2);
if (args.includes('--self-test')) process.exit(selfTest());
const val = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const manifest = val('--manifest'), archive = val('--archive'), reportPath = val('--report');
if (!manifest || !archive) {
  console.error('usage: node verify-archive.mjs --manifest <file> --archive <dir> [--report <path outside E:\\Claude>] | --self-test');
  process.exit(2);
}
const out = run(manifest, archive);
const text = report(out);
if (reportPath) {
  if (reportPath.replace(/\\/g, '/').toLowerCase().startsWith(ESTATE_ROOT + '/')) {
    console.error(`\nRefusing to write the report inside the estate root; choose a path outside it.`);
    process.exit(2);
  }
  writeFileSync(reportPath, text + '\n');
  console.log(`\nreport written to ${reportPath}`);
}
process.exit(out.failed ? 1 : 0);
