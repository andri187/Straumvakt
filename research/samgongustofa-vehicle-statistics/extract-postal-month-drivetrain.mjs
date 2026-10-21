#!/usr/bin/env node
// Phase 4 — postal × month × drivetrain, from new registrations.
//
// Small deliberate window by default. This proves correctness first; it is not a
// full harvest, and it says so in its own output.
//
//   node extract-postal-month-drivetrain.mjs [--top 2000]

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { groupedCount, toCsv, SOURCE_NAME, SOURCE_URL } from './powerbi-query.mjs';
import { normalizeFuel } from './normalize-fuel.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'out');
mkdirSync(OUT, { recursive: true });

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const TOP = Number(arg('--top', 2000));

/**
 * `Nýskránd.` is the registration date. The helper columns `Ár - ísl.` and
 * `Mánuður - ísl.` exist in the model but cannot be referenced in a query, so
 * year and month are derived here instead. Power BI may hand the date back as an
 * ISO string or as a epoch-milliseconds number depending on the column's type,
 * so both are handled rather than assumed.
 */
function deriveYearMonth(value) {
  if (value === null || value === undefined) return { year: null, month: null, year_month: null };
  let d = null;
  if (typeof value === 'number') d = new Date(value);
  else {
    const s = String(value).trim();
    const m = s.match(/^(\d{4})[-/](\d{1,2})/);
    if (m) return { year: +m[1], month: +m[2], year_month: `${m[1]}-${String(+m[2]).padStart(2, '0')}` };
    const parsed = new Date(s);
    if (!Number.isNaN(parsed.getTime())) d = parsed;
  }
  if (!d || Number.isNaN(d.getTime())) return { year: null, month: null, year_month: null };
  const y = d.getUTCFullYear(), mo = d.getUTCMonth() + 1;
  return { year: y, month: mo, year_month: `${y}-${String(mo).padStart(2, '0')}` };
}

const pulledAt = new Date().toISOString();
const GROUP = ['P_ZIPCODE', 'Nýskránd.', 'Orkugjafi'];

console.log('Samgöngustofa — postal × month × drivetrain');
console.log(`  grouping: ${GROUP.join(' + ')} + Count(Fastanr)`);
console.log(`  window:   Top ${TOP}  (deliberate sample, not a full harvest)`);

let rows, names;
try {
  ({ rows, names } = await groupedCount({ groupBy: GROUP, countColumn: 'Fastanr', top: TOP }));
} catch (e) {
  console.error(`\nQUERY FAILED — reported verbatim, not swallowed:\n${e.message}`);
  writeFileSync(join(OUT, 'vehicle_postal_month_drivetrain_sample.blocked.txt'),
    `pulled_at_utc=${pulledAt}\ngrouping=${GROUP.join('+')}\nerror:\n${e.message}\n`);
  process.exit(1);
}

console.log(`  raw grouped rows returned: ${rows.length}`);
console.log(`  descriptor columns: ${(names ?? []).join(' | ')}`);

// Fold to postal × year_month × fuel. Several registration dates inside one
// month collapse into one row, so the output is a monthly aggregate.
const byKey = new Map();
let undated = 0;
for (const r of rows) {
  const vals = Object.values(r);
  const postal = r['g.P_ZIPCODE'] ?? vals[0];
  const rawDate = r['g.Nýskránd.'] ?? vals[1];
  const fuelRaw = r['g.Orkugjafi'] ?? vals[2];
  const count = Number(r['m.count.Fastanr'] ?? vals[3] ?? 0);
  const { year, month, year_month } = deriveYearMonth(rawDate);
  if (!year_month) undated++;
  const group = normalizeFuel(fuelRaw);
  const k = `${year_month}|${postal}|${fuelRaw}`;
  const prev = byKey.get(k);
  if (prev) { prev.count += count; continue; }
  byKey.set(k, {
    source_name: SOURCE_NAME,
    source_url: SOURCE_URL,
    pulled_at_utc: pulledAt,
    extraction_method: 'powerbi-public-querydata',
    metric_type: 'new_registration',
    year_month, year, month,
    postal_code: postal,
    fuel_label_raw: fuelRaw,
    drivetrain_group: group,
    count,
  });
}

const out = [...byKey.values()].sort((a, b) =>
  String(a.year_month).localeCompare(String(b.year_month)) ||
  String(a.postal_code).localeCompare(String(b.postal_code)) ||
  String(a.drivetrain_group).localeCompare(String(b.drivetrain_group)));

const COLUMNS = ['source_name', 'source_url', 'pulled_at_utc', 'extraction_method', 'metric_type',
  'year_month', 'year', 'month', 'postal_code', 'fuel_label_raw', 'drivetrain_group', 'count'];
const file = join(OUT, 'vehicle_postal_month_drivetrain_sample.csv');
writeFileSync(file, toCsv(out, COLUMNS));

const byGroup = {};
for (const r of out) byGroup[r.drivetrain_group] = (byGroup[r.drivetrain_group] ?? 0) + r.count;
const unmapped = [...new Set(out.filter((r) => r.drivetrain_group === 'UNKNOWN').map((r) => r.fuel_label_raw))];

console.log(`\n  aggregated rows: ${out.length}`);
console.log(`  vehicles counted: ${out.reduce((s, r) => s + r.count, 0)}`);
console.log(`  distinct postal codes: ${new Set(out.map((r) => r.postal_code)).size}`);
console.log(`  distinct months: ${new Set(out.map((r) => r.year_month)).size}`);
if (undated) console.log(`  rows with an underivable date: ${undated}`);
console.log(`  by drivetrain: ${Object.entries(byGroup).map(([k, v]) => `${k}=${v}`).join('  ')}`);
if (unmapped.length) console.log(`  UNMAPPED fuel labels (add to fuel-normalization.json): ${unmapped.join(' | ')}`);
console.log(`  written: ${file}`);
