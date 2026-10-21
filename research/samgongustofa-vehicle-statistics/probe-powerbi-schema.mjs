#!/usr/bin/env node
// Phase 1 — reconfirm public Power BI access and inventory the fields.
//
// Read-only against a public endpoint. No credentials, no writes to any remote.
//
//   node probe-powerbi-schema.mjs

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HOST, RESOURCE_KEY, SOURCE_URL, MODEL_ID, DATASET_ID, ENTITY } from './powerbi-query.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'out');
mkdirSync(OUT, { recursive: true });

const REQUIRED = ['Fastanr', 'P_ZIPCODE', 'Orkugjafi', 'Tegund', 'Undirtegund', 'Ökutækisflokkur', 'Nýskránd.'];
const ALSO_INTERESTING = ['Fyrsti skránd.', 'Ár - ísl.', 'Mánuður - ísl.'];

async function getSchema() {
  const url = `${HOST}/public/reports/${RESOURCE_KEY}/conceptualschema`;
  const res = await fetch(url, {
    method: 'GET',
    headers: { 'X-PowerBI-ResourceKey': RESOURCE_KEY, Accept: 'application/json, text/plain, */*' },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`conceptualschema ${res.status} ${res.statusText}\n  ${url}\n  ${text.slice(0, 600)}`);
  try { return { json: JSON.parse(text), url }; }
  catch { throw new Error(`conceptualschema returned non-JSON:\n  ${text.slice(0, 400)}`); }
}

/** The schema nests entities under schemas[].entities[]; shapes vary by report. */
function inventory(schema) {
  const entities = [];
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(walk);
    if (Array.isArray(node.Entities)) {
      for (const e of node.Entities) {
        entities.push({
          name: e.Name ?? e.name ?? '?',
          properties: (e.Properties ?? e.properties ?? []).map((p) => ({
            name: p.Name ?? p.name ?? '?',
            dataType: p.DataType ?? p.dataType ?? null,
            kind: p.Kind ?? (p.Measure ? 'measure' : 'column'),
          })),
        });
      }
    }
    for (const v of Object.values(node)) walk(v);
  };
  walk(schema);
  return entities;
}

const started = new Date().toISOString();
let schema, url;
try { ({ json: schema, url } = await getSchema()); }
catch (e) { console.error('FAIL  conceptual schema unreachable\n' + e.message); process.exit(1); }

const entities = inventory(schema);
const target = entities.find((e) => e.name === ENTITY) ?? entities[0] ?? { name: null, properties: [] };
const fieldNames = target.properties.map((p) => p.name);

const present = REQUIRED.filter((f) => fieldNames.includes(f));
const missing = REQUIRED.filter((f) => !fieldNames.includes(f));
const extras = ALSO_INTERESTING.filter((f) => fieldNames.includes(f));

const doc = {
  probedAtUtc: started,
  sourceUrl: SOURCE_URL,
  conceptualSchemaUrl: url,
  resourceKey: RESOURCE_KEY,
  modelId: MODEL_ID,
  datasetId: DATASET_ID,
  entityQueried: ENTITY,
  entitiesFound: entities.map((e) => ({ name: e.name, fieldCount: e.properties.length })),
  targetEntity: target.name,
  fieldCount: fieldNames.length,
  fields: target.properties,
  requiredPresent: present,
  requiredMissing: missing,
  helperFieldsPresent: extras,
  note: 'Read-only probe of a public report. Helper columns "Ár - ísl." / "Mánuður - ísl." may exist yet be unusable in a direct query; year and month are derived from "Nýskránd." instead.',
};
writeFileSync(join(OUT, 'nyskraningar-fields.json'), JSON.stringify(doc, null, 2) + '\n');

console.log('Samgöngustofa Power BI schema probe');
console.log(`  entities:     ${entities.length}  (target "${target.name}", ${fieldNames.length} fields)`);
console.log(`  required:     ${present.length}/${REQUIRED.length} present`);
for (const f of REQUIRED) console.log(`    ${fieldNames.includes(f) ? 'OK  ' : 'MISS'} ${f}`);
if (extras.length) console.log(`  helper fields present but unreliable in query: ${extras.join(', ')}`);
console.log(`  written: out/nyskraningar-fields.json`);
console.log(missing.length ? `\nFAIL — missing: ${missing.join(', ')}` : '\nPASS — every required field is present');
process.exit(missing.length ? 1 : 0);
