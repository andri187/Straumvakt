#!/usr/bin/env node
// Power BI public-report query helper for the Samgöngustofa Bifreiðatölur report.
//
// LOCAL RESEARCH ONLY. This reads a public, unauthenticated Power BI report the
// same way the published page does. It sends no credentials, writes nothing
// remote, and must never be pointed at anything requiring a key.
//
// Two things here are not obvious and cost time if rediscovered:
//
//  1. The result format is DSR ("data shape result"), which is COMPRESSED. Rows
//     repeat the previous row's leading values rather than restating them, and a
//     bitmask says which columns were repeated. Decoding naively gives you rows
//     with holes that look like nulls in the data. They are not nulls; they are
//     "same as above".
//
//  2. Columns whose names contain Icelandic characters or a trailing dot — the
//     report has both, e.g. `Nýskránd.` — must be referenced through a Property
//     on a SourceRef, never inlined into a measure expression. The report's own
//     `Ár - ísl.` / `Mánuður - ísl.` helper columns fail even that way, which is
//     why year and month are derived from `Nýskránd.` downstream instead.

export const HOST = 'https://wabi-europe-north-b-api.analysis.windows.net';
export const RESOURCE_KEY = 'fbe0697d-bd90-4f90-a80f-16d048b0d696';
export const MODEL_ID = 2897309;
export const DATASET_ID = 'b7ba0181-de36-42b8-83de-62658478c922';
export const ENTITY = 'Query1';
export const SOURCE_URL = 'https://bifreidatolur.samgongustofa.is/#nyskraningar';
export const SOURCE_NAME = 'Samgöngustofa — Bifreiðatölur (nýskráningar)';

const SRC = 'q';

/** Reference a column by name. Kept in one place so quoting stays consistent. */
export const col = (name) => ({ Column: { Expression: { SourceRef: { Source: SRC } }, Property: name } });

/** COUNT over a column. `Fastanr` is the vehicle key, so this counts vehicles. */
export const countOf = (name) => ({
  Aggregation: { Expression: { Column: { Expression: { SourceRef: { Source: SRC } }, Property: name } }, Function: 2 },
});

/**
 * Build the semantic query envelope.
 *
 * `Top` is applied deliberately: the endpoint is public and shared, and the
 * brief asks for small, considered requests rather than a full harvest.
 */
export function buildQuery({ groupBy = [], measures = [], top = 500, where = null }) {
  const selects = [
    ...groupBy.map((name) => ({ ...col(name), Name: `g.${name}` })),
    ...measures.map((name) => ({ ...countOf(name), Name: `m.count.${name}` })),
  ];
  const from = [{ Name: SRC, Entity: ENTITY, Type: 0 }];
  // Top and DataReduction are mutually exclusive. Sending both returns
  // `QueryTopWithDataReduction` and zero rows:
  //   "Data reduction is forbidden if the top clause is used."
  // The row limit is therefore expressed ONLY as a binding window, which is also
  // the mechanism the report's own visuals use for paging.
  const q = { Version: 2, From: from, Select: selects };
  if (where) q.Where = where;

  return {
    version: '1.0.0',
    queries: [{
      Query: { Commands: [{ SemanticQueryDataShapeCommand: { Query: q, Binding: {
        Primary: { Groupings: [{ Projections: selects.map((_, i) => i) }] },
        DataReduction: { DataVolume: 3, Primary: { Window: { Count: top } } },
        Version: 1,
      } } }] },
      CacheKey: '',
      QueryId: '',
      ApplicationContext: { DatasetId: DATASET_ID, Sources: [{ ReportId: RESOURCE_KEY, VisualId: 'local-research' }] },
    }],
    cancelQueries: [],
    modelId: MODEL_ID,
  };
}

/** An equality filter on a text column, for narrowing a sample. */
export const whereEquals = (name, value) => [{
  Condition: { Comparison: { ComparisonKind: 0, Left: col(name), Right: { Literal: { Value: `'${String(value).replace(/'/g, "''")}'` } } } },
}];

export async function postQuery(body, { timeoutMs = 45_000 } = {}) {
  const url = `${HOST}/public/reports/querydata?synchronous=true`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  let res, text;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json;charset=UTF-8',
        'X-PowerBI-ResourceKey': RESOURCE_KEY,
        Accept: 'application/json, text/plain, */*',
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    text = await res.text();
  } finally { clearTimeout(t); }

  if (!res.ok) {
    // Do not swallow this. The endpoint names the offending column in its error
    // body, and that name is the single most useful fact when a query fails.
    const snippet = text.slice(0, 900);
    const err = new Error(`Power BI ${res.status} ${res.statusText}\n  endpoint: ${url}\n  body: ${snippet}`);
    err.status = res.status;
    err.bodySnippet = snippet;
    throw err;
  }
  let json;
  try { json = JSON.parse(text); }
  catch { throw new Error(`Power BI returned non-JSON (${res.status})\n  body: ${text.slice(0, 400)}`); }

  // The error hides in a key whose NAME contains a dot — `"odata.error"` — not
  // in a nested `odata.error` path. Reading it as a path silently yields
  // undefined, the call looks successful, and you get zero rows with no
  // explanation. That mistake cost a full debugging cycle here; hence the
  // explicit bracket access and the loud throw.
  const shapes = json?.results?.[0]?.result?.data?.dsr?.DataShapes ?? [];
  const shapeErr = shapes.find((s) => s && s['odata.error'])?.['odata.error'];
  const dsErr = shapeErr ?? json?.error ?? json?.results?.[0]?.result?.data?.error;
  if (dsErr) {
    const code = dsErr.code ?? '?';
    const msg = dsErr.message?.value ?? dsErr.message ?? JSON.stringify(dsErr).slice(0, 400);
    throw new Error(`Power BI query error [${code}]: ${msg}`);
  }
  return json;
}

/**
 * Decode DSR into plain rows.
 *
 * `R` is a bitmask of columns REPEATED from the previous row; `Ø` is a bitmask of
 * columns that are genuinely null. Without honouring R you get sparse rows that
 * read as missing data — the classic way this format is misread.
 */
export function decodeDsr(json) {
  const dsr = json?.results?.[0]?.result?.data?.dsr;
  const ds = dsr?.DS?.[0];
  if (!ds) return { rows: [], valueDicts: null, note: 'no DS section in response' };

  const valueDicts = ds.ValueDicts ?? {};
  const dm0 = ds.PH?.[0]?.DM0 ?? [];
  const descriptor = json?.results?.[0]?.result?.data?.descriptor?.Select ?? [];
  const names = descriptor.map((d) => d.Name ?? d.Value ?? '?');

  // The per-column dictionary name is carried on the FIRST row's `S` schema as
  // `DN`, not on the descriptor. Keying off `descriptor[i].Value` ("G0", "G1")
  // silently finds nothing, and every dictionary-encoded column then comes back
  // as a bare integer index — fuel labels arrive as 0..10 and read like data.
  const schema = dm0.find((d) => Array.isArray(d.S))?.S ?? [];
  const dictNameFor = names.map((_, i) => schema[i]?.DN ?? null);

  const rows = [];
  let prev = [];
  for (const item of dm0) {
    const raw = item.C ?? [];
    const repeatMask = item.R ?? 0;
    const nullMask = item.Ø ?? 0;
    const out = [];
    let take = 0;
    for (let i = 0; i < names.length; i++) {
      if (nullMask & (1 << i)) { out[i] = null; continue; }
      // R marks columns carried over from the previous row. They are absent from
      // C entirely, so the read cursor must not advance for them.
      if (repeatMask & (1 << i)) { out[i] = prev[i] ?? null; continue; }
      out[i] = raw[take++];
    }
    prev = out.slice();
    // Resolve dictionary indices only for columns that actually have a dictionary.
    const resolved = out.map((v, i) => {
      const dn = dictNameFor[i];
      if (!dn) return v;
      const dict = valueDicts[dn];
      if (!Array.isArray(dict) || dict.length === 0) return v;
      return typeof v === 'number' && dict[v] !== undefined ? dict[v] : v;
    });
    rows.push(Object.fromEntries(names.map((n, i) => [n, resolved[i]])));
  }
  return { rows, valueDicts, names, dictNameFor };
}

/** Grouped count in one call. Returns decoded rows plus the query actually sent. */
export async function groupedCount({ groupBy, countColumn = 'Fastanr', top = 500, where = null }) {
  const body = buildQuery({ groupBy, measures: [countColumn], top, where });
  const json = await postQuery(body);
  const { rows, names } = decodeDsr(json);
  return { rows, names, request: body, raw: json };
}

export function toCsv(rows, columns) {
  const esc = (v) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.join(','), ...rows.map((r) => columns.map((c) => esc(r[c])).join(','))].join('\n') + '\n';
}
