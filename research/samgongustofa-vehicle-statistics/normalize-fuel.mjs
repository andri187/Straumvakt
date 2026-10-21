#!/usr/bin/env node
// Phase 3 — Orkugjafi → drivetrain group, with self-checks.
//
//   node normalize-fuel.mjs --self-test

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CFG = JSON.parse(readFileSync(join(HERE, 'fuel-normalization.json'), 'utf8'));

export const PLUGIN_GROUPS = new Set(CFG.plugin_groups);

/** Trim, collapse internal whitespace, lowercase. Source labels vary in spacing. */
const key = (s) => String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

export function normalizeFuel(label) {
  const k = key(label);
  if (!k) return 'UNKNOWN';
  return CFG.map[k] ?? 'UNKNOWN';
}

export const isPlugin = (group) => PLUGIN_GROUPS.has(group);

/**
 * Plug-in share.
 *
 * Denominator is plug-in + ICE only. Non-plug hybrids are excluded from both
 * sides: they are not charging demand, and putting them in the denominator
 * would quietly deflate every share this research produces.
 */
export function pluginShare(counts, { includeUnknownInDenominator = false } = {}) {
  const g = (n) => Number(counts[n] ?? 0);
  const plugin = g('BEV') + g('PHEV');
  let denom = plugin + g('ICE');
  if (includeUnknownInDenominator) denom += g('UNKNOWN');
  return {
    plugin_count: plugin,
    denominator: denom,
    plugin_share: denom > 0 ? plugin / denom : null,
    excluded: {
      HYBRID_NON_PLUGIN: g('HYBRID_NON_PLUGIN'),
      OTHER: g('OTHER'),
      UNKNOWN: includeUnknownInDenominator ? 0 : g('UNKNOWN'),
    },
  };
}

if (process.argv.includes('--self-test')) {
  let pass = 0, fail = 0;
  const t = (name, actual, expected) => {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    if (ok) pass++; else { fail++; console.log(`  FAIL ${name}\n       expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); }
  };

  t('Rafmagn → BEV', normalizeFuel('Rafmagn'), 'BEV');
  t('Bensín /Raf.tengill → PHEV', normalizeFuel('Bensín /Raf.tengill'), 'PHEV');
  t('Dísel /Raf.tengill → PHEV', normalizeFuel('Dísel /Raf.tengill'), 'PHEV');
  t('Bensín /Rafmagn → HYBRID_NON_PLUGIN', normalizeFuel('Bensín /Rafmagn'), 'HYBRID_NON_PLUGIN');
  t('Dísel /Rafmagn → HYBRID_NON_PLUGIN', normalizeFuel('Dísel /Rafmagn'), 'HYBRID_NON_PLUGIN');
  t('Bensín → ICE', normalizeFuel('Bensín'), 'ICE');
  t('Dísel → ICE', normalizeFuel('Dísel'), 'ICE');
  t('unmapped → UNKNOWN', normalizeFuel('Kjarnorka'), 'UNKNOWN');
  t('empty → UNKNOWN', normalizeFuel(''), 'UNKNOWN');
  t('null → UNKNOWN', normalizeFuel(null), 'UNKNOWN');

  // The distinction the whole map exists for.
  t('case and spacing tolerated', normalizeFuel('  BENSÍN /RAF.TENGILL '), 'PHEV');
  t('accent-stripped variant still maps', normalizeFuel('Bensin /Raf.tengill'), 'PHEV');
  t('BEV is plugin', isPlugin('BEV'), true);
  t('PHEV is plugin', isPlugin('PHEV'), true);
  t('non-plug hybrid is NOT plugin', isPlugin('HYBRID_NON_PLUGIN'), false);
  t('ICE is not plugin', isPlugin('ICE'), false);

  const counts = { BEV: 30, PHEV: 20, HYBRID_NON_PLUGIN: 40, ICE: 50, UNKNOWN: 10, OTHER: 5 };
  const s = pluginShare(counts);
  t('plugin_count = BEV + PHEV', s.plugin_count, 50);
  t('denominator excludes non-plug hybrids, OTHER and UNKNOWN', s.denominator, 100);
  t('plugin_share = 50/100', s.plugin_share, 0.5);
  t('excluded hybrids reported', s.excluded.HYBRID_NON_PLUGIN, 40);
  t('unknown excluded by default', s.excluded.UNKNOWN, 10);

  const s2 = pluginShare(counts, { includeUnknownInDenominator: true });
  t('unknown can be opted into the denominator', s2.denominator, 110);

  t('empty counts give null share, not a divide-by-zero', pluginShare({}).plugin_share, null);

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
