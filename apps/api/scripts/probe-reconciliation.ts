#!/usr/bin/env tsx
/**
 * probe-reconciliation.ts — OCPP↔CDR reconciliation diff probe.
 *
 * Reads ONLY. Writes nothing. Safe to run against any branch.
 *
 * Sprint 9 — ENRICH-2 deliverable 1. Lists charging.sessions rows where
 * OCPP-side and CDR-side enrichment columns disagree beyond tolerance,
 * or where one side never arrived.
 *
 * Depends on ENRICH-1's schema additions:
 *   charging.sessions:
 *     ocpp_energy_kwh   (Decimal)
 *     cdr_energy_kwh    (Decimal)
 *     amqp_energy_kwh   (Decimal)
 *     ocpp_stopped_at   (Timestamptz)
 *     cdr_stopped_at    (Timestamptz)
 *     ocmf_blob_ref     (Text)
 *
 * Until ENRICH-1 lands these columns are absent; this probe degrades
 * gracefully — each category is wrapped in a try/catch and prints a
 * "(schema not yet present)" line instead of crashing the run.
 *
 * Categories (per ENRICH-2 spec):
 *   MATCH            — OCPP + CDR both present and agree within tolerance
 *   OCPP_ONLY        — CDR enrichment never arrived (vendor outage / free vend)
 *   CDR_ONLY         — CDR arrived but OCPP didn't (rare; investigate)
 *   MISMATCH_ENERGY  — both present but |ocpp - cdr| > energy tolerance
 *   MISMATCH_TIME    — both present but |ocpp_stop - cdr_stop| > time tolerance
 *   OCMF_MISSING     — session has CDR but no ocmf_blob_ref (vendor didn't sign)
 *
 * Usage:
 *   npx tsx scripts/probe-reconciliation.ts
 *   npx tsx scripts/probe-reconciliation.ts --days=N
 *   npx tsx scripts/probe-reconciliation.ts --energy-tolerance-kwh=0.05
 *   npx tsx scripts/probe-reconciliation.ts --time-tolerance-sec=30
 */
import { Client } from "pg";
import { config as dotenv } from "dotenv";
import { resolve } from "node:path";

dotenv({ path: resolve(process.cwd(), "../../.env.local") });

const SEP = "═══════════════════════════════════════════════════════════════════════";
const SUB = "───────────────────────────────────────────────────────────────────────";

// ─── CLI arg parser ──────────────────────────────────────────────────────────
function parseArg(name: string, fallback: number): number {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  if (!hit) return fallback;
  const v = Number(hit.slice(prefix.length));
  if (!Number.isFinite(v) || v < 0) {
    console.error(`invalid --${name} value: ${hit.slice(prefix.length)}`);
    process.exit(2);
  }
  return v;
}

const DAYS = parseArg("days", 30);
const ENERGY_TOL_KWH = parseArg("energy-tolerance-kwh", 0.05);
const TIME_TOL_SEC = parseArg("time-tolerance-sec", 30);
const SAMPLE_LIMIT = 5;

// ─── Helpers ─────────────────────────────────────────────────────────────────
interface SampleRow {
  sessionId: string;
  chargerId: string | null;
  startedAt: Date | null;
  ocppEnergyKwh: string | null;
  cdrEnergyKwh: string | null;
  ocppStoppedAt: Date | null;
  cdrStoppedAt: Date | null;
  ocmfBlobRef: string | null;
}

async function safeQuery<T = any>(c: Client, sql: string, params: any[] = []): Promise<{ rows: T[]; ok: boolean; error?: string }> {
  try {
    const r = await c.query(sql, params);
    return { rows: r.rows as T[], ok: true };
  } catch (e: any) {
    return { rows: [], ok: false, error: e.message.split("\n")[0] };
  }
}

function fmtDate(d: Date | null): string {
  if (!d) return "—";
  return new Date(d).toISOString().replace("T", " ").slice(0, 19);
}

function fmtKwh(v: string | null): string {
  if (v === null || v === undefined) return "—";
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(3) : String(v);
}

function printSampleHeader() {
  console.log(
    `     ${"session_id".padEnd(38)} ${"started_at".padEnd(20)} ${"ocpp_kwh".padStart(10)} ${"cdr_kwh".padStart(10)} ${"ocpp_stop".padEnd(20)} ${"cdr_stop".padEnd(20)}`,
  );
}

function printSampleRow(r: SampleRow) {
  console.log(
    `     ${(r.sessionId ?? "—").padEnd(38)} ${fmtDate(r.startedAt).padEnd(20)} ${fmtKwh(r.ocppEnergyKwh).padStart(10)} ${fmtKwh(r.cdrEnergyKwh).padStart(10)} ${fmtDate(r.ocppStoppedAt).padEnd(20)} ${fmtDate(r.cdrStoppedAt).padEnd(20)}`,
  );
}

// ─── Main ────────────────────────────────────────────────────────────────────
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  console.log(`\n${SEP}`);
  console.log("  OCPP ↔ CDR RECONCILIATION PROBE — ENRICH-2 / Sprint 9");
  console.log(`${SEP}`);
  console.log(`  window:                 last ${DAYS} day(s)`);
  console.log(`  energy tolerance:       ${ENERGY_TOL_KWH} kWh`);
  console.log(`  stop-time tolerance:    ${TIME_TOL_SEC} s`);
  console.log(`  sample rows per cat:    ${SAMPLE_LIMIT}`);
  console.log("");

  // ─── 0. Schema readiness check ─────────────────────────────────────────────
  console.log("┌─ 0. Schema readiness (ENRICH-1 columns present?)");
  console.log(SUB);
  const schemaCheck = await safeQuery<{ column_name: string }>(c, `
    select column_name
      from information_schema.columns
     where table_schema = 'charging'
       and table_name   = 'sessions'
       and column_name in (
         'ocpp_energy_kwh', 'cdr_energy_kwh', 'amqp_energy_kwh',
         'ocpp_stopped_at', 'cdr_stopped_at', 'ocmf_blob_ref'
       )
     order by column_name
  `);
  const expected = [
    "amqp_energy_kwh", "cdr_energy_kwh", "cdr_stopped_at",
    "ocmf_blob_ref", "ocpp_energy_kwh", "ocpp_stopped_at",
  ];
  const present = new Set(schemaCheck.rows.map((r) => r.column_name));
  for (const col of expected) {
    if (present.has(col)) {
      console.log(`     PRESENT  charging.sessions.${col}`);
    } else {
      console.log(`     MISSING  charging.sessions.${col}  (ENRICH-1 not merged yet)`);
    }
  }
  const allPresent = expected.every((c2) => present.has(c2));
  if (!allPresent) {
    console.log("");
    console.log("  Some ENRICH-1 columns are missing. The categories below will report");
    console.log("  '(schema not yet present)' for queries that depend on those columns.");
    console.log("  The probe is still safe to run — pure SELECT statements.");
  }

  // ─── Aggregate counters ────────────────────────────────────────────────────
  const counts: Record<string, number | null> = {
    MATCH: null,
    OCPP_ONLY: null,
    CDR_ONLY: null,
    MISMATCH_ENERGY: null,
    MISMATCH_TIME: null,
    OCMF_MISSING: null,
  };

  // ─── 1. MATCH ──────────────────────────────────────────────────────────────
  console.log(`\n┌─ 1. MATCH — OCPP + CDR present and within tolerance`);
  console.log(SUB);
  {
    const r = await safeQuery<{ n: number }>(c, `
      select count(*)::int as n
        from charging.sessions s
       where s.started_at > now() - ($1 || ' days')::interval
         and s.ocpp_energy_kwh is not null
         and s.cdr_energy_kwh  is not null
         and abs(s.ocpp_energy_kwh - s.cdr_energy_kwh) <= $2::numeric
         and (
              s.ocpp_stopped_at is null
           or s.cdr_stopped_at  is null
           or abs(extract(epoch from (s.ocpp_stopped_at - s.cdr_stopped_at))) <= $3::numeric
         )
    `, [DAYS, ENERGY_TOL_KWH, TIME_TOL_SEC]);
    if (!r.ok) {
      console.log(`     (schema not yet present: ${r.error})`);
    } else {
      counts.MATCH = r.rows[0]?.n ?? 0;
      console.log(`     count: ${counts.MATCH}`);
    }
  }

  // ─── 2. OCPP_ONLY ──────────────────────────────────────────────────────────
  console.log(`\n┌─ 2. OCPP_ONLY — CDR enrichment never arrived`);
  console.log(SUB);
  {
    const countR = await safeQuery<{ n: number }>(c, `
      select count(*)::int as n
        from charging.sessions s
       where s.started_at > now() - ($1 || ' days')::interval
         and s.ocpp_energy_kwh is not null
         and s.cdr_energy_kwh  is null
    `, [DAYS]);
    if (!countR.ok) {
      console.log(`     (schema not yet present: ${countR.error})`);
    } else {
      counts.OCPP_ONLY = countR.rows[0]?.n ?? 0;
      console.log(`     count: ${counts.OCPP_ONLY}`);
      const samples = await safeQuery<SampleRow>(c, `
        select s.id              as "sessionId",
               s.charging_station_id::text as "chargerId",
               s.started_at      as "startedAt",
               s.ocpp_energy_kwh::text as "ocppEnergyKwh",
               s.cdr_energy_kwh::text  as "cdrEnergyKwh",
               s.ocpp_stopped_at as "ocppStoppedAt",
               s.cdr_stopped_at  as "cdrStoppedAt",
               s.ocmf_blob_ref   as "ocmfBlobRef"
          from charging.sessions s
         where s.started_at > now() - ($1 || ' days')::interval
           and s.ocpp_energy_kwh is not null
           and s.cdr_energy_kwh  is null
         order by s.started_at desc
         limit $2
      `, [DAYS, SAMPLE_LIMIT]);
      if (samples.ok && samples.rows.length > 0) {
        console.log("     sample (most recent):");
        printSampleHeader();
        for (const row of samples.rows) printSampleRow(row);
      }
    }
  }

  // ─── 3. CDR_ONLY ───────────────────────────────────────────────────────────
  console.log(`\n┌─ 3. CDR_ONLY — CDR arrived but OCPP didn't (rare; investigate)`);
  console.log(SUB);
  {
    const countR = await safeQuery<{ n: number }>(c, `
      select count(*)::int as n
        from charging.sessions s
       where s.started_at > now() - ($1 || ' days')::interval
         and s.cdr_energy_kwh  is not null
         and s.ocpp_energy_kwh is null
    `, [DAYS]);
    if (!countR.ok) {
      console.log(`     (schema not yet present: ${countR.error})`);
    } else {
      counts.CDR_ONLY = countR.rows[0]?.n ?? 0;
      console.log(`     count: ${counts.CDR_ONLY}`);
      const samples = await safeQuery<SampleRow>(c, `
        select s.id              as "sessionId",
               s.charging_station_id::text as "chargerId",
               s.started_at      as "startedAt",
               s.ocpp_energy_kwh::text as "ocppEnergyKwh",
               s.cdr_energy_kwh::text  as "cdrEnergyKwh",
               s.ocpp_stopped_at as "ocppStoppedAt",
               s.cdr_stopped_at  as "cdrStoppedAt",
               s.ocmf_blob_ref   as "ocmfBlobRef"
          from charging.sessions s
         where s.started_at > now() - ($1 || ' days')::interval
           and s.cdr_energy_kwh  is not null
           and s.ocpp_energy_kwh is null
         order by s.started_at desc
         limit $2
      `, [DAYS, SAMPLE_LIMIT]);
      if (samples.ok && samples.rows.length > 0) {
        console.log("     sample (most recent):");
        printSampleHeader();
        for (const row of samples.rows) printSampleRow(row);
      }
    }
  }

  // ─── 4. MISMATCH_ENERGY ────────────────────────────────────────────────────
  console.log(`\n┌─ 4. MISMATCH_ENERGY — |ocpp - cdr| > ${ENERGY_TOL_KWH} kWh`);
  console.log(SUB);
  {
    const countR = await safeQuery<{ n: number }>(c, `
      select count(*)::int as n
        from charging.sessions s
       where s.started_at > now() - ($1 || ' days')::interval
         and s.ocpp_energy_kwh is not null
         and s.cdr_energy_kwh  is not null
         and abs(s.ocpp_energy_kwh - s.cdr_energy_kwh) > $2::numeric
    `, [DAYS, ENERGY_TOL_KWH]);
    if (!countR.ok) {
      console.log(`     (schema not yet present: ${countR.error})`);
    } else {
      counts.MISMATCH_ENERGY = countR.rows[0]?.n ?? 0;
      console.log(`     count: ${counts.MISMATCH_ENERGY}`);
      const samples = await safeQuery<SampleRow & { delta: string }>(c, `
        select s.id              as "sessionId",
               s.charging_station_id::text as "chargerId",
               s.started_at      as "startedAt",
               s.ocpp_energy_kwh::text as "ocppEnergyKwh",
               s.cdr_energy_kwh::text  as "cdrEnergyKwh",
               s.ocpp_stopped_at as "ocppStoppedAt",
               s.cdr_stopped_at  as "cdrStoppedAt",
               s.ocmf_blob_ref   as "ocmfBlobRef",
               abs(s.ocpp_energy_kwh - s.cdr_energy_kwh)::text as "delta"
          from charging.sessions s
         where s.started_at > now() - ($1 || ' days')::interval
           and s.ocpp_energy_kwh is not null
           and s.cdr_energy_kwh  is not null
           and abs(s.ocpp_energy_kwh - s.cdr_energy_kwh) > $2::numeric
         order by abs(s.ocpp_energy_kwh - s.cdr_energy_kwh) desc
         limit $3
      `, [DAYS, ENERGY_TOL_KWH, SAMPLE_LIMIT]);
      if (samples.ok && samples.rows.length > 0) {
        console.log("     sample (largest delta first):");
        printSampleHeader();
        for (const row of samples.rows) {
          printSampleRow(row);
          console.log(`        delta=${fmtKwh(row.delta)} kWh`);
        }
      }
    }
  }

  // ─── 5. MISMATCH_TIME ──────────────────────────────────────────────────────
  console.log(`\n┌─ 5. MISMATCH_TIME — |ocpp_stop - cdr_stop| > ${TIME_TOL_SEC} s`);
  console.log(SUB);
  {
    const countR = await safeQuery<{ n: number }>(c, `
      select count(*)::int as n
        from charging.sessions s
       where s.started_at > now() - ($1 || ' days')::interval
         and s.ocpp_stopped_at is not null
         and s.cdr_stopped_at  is not null
         and abs(extract(epoch from (s.ocpp_stopped_at - s.cdr_stopped_at))) > $2::numeric
    `, [DAYS, TIME_TOL_SEC]);
    if (!countR.ok) {
      console.log(`     (schema not yet present: ${countR.error})`);
    } else {
      counts.MISMATCH_TIME = countR.rows[0]?.n ?? 0;
      console.log(`     count: ${counts.MISMATCH_TIME}`);
      const samples = await safeQuery<SampleRow & { delta_sec: string }>(c, `
        select s.id              as "sessionId",
               s.charging_station_id::text as "chargerId",
               s.started_at      as "startedAt",
               s.ocpp_energy_kwh::text as "ocppEnergyKwh",
               s.cdr_energy_kwh::text  as "cdrEnergyKwh",
               s.ocpp_stopped_at as "ocppStoppedAt",
               s.cdr_stopped_at  as "cdrStoppedAt",
               s.ocmf_blob_ref   as "ocmfBlobRef",
               abs(extract(epoch from (s.ocpp_stopped_at - s.cdr_stopped_at)))::text as "delta_sec"
          from charging.sessions s
         where s.started_at > now() - ($1 || ' days')::interval
           and s.ocpp_stopped_at is not null
           and s.cdr_stopped_at  is not null
           and abs(extract(epoch from (s.ocpp_stopped_at - s.cdr_stopped_at))) > $2::numeric
         order by abs(extract(epoch from (s.ocpp_stopped_at - s.cdr_stopped_at))) desc
         limit $3
      `, [DAYS, TIME_TOL_SEC, SAMPLE_LIMIT]);
      if (samples.ok && samples.rows.length > 0) {
        console.log("     sample (largest drift first):");
        printSampleHeader();
        for (const row of samples.rows) {
          printSampleRow(row);
          const sec = Number(row.delta_sec);
          console.log(`        drift=${Number.isFinite(sec) ? sec.toFixed(0) : row.delta_sec} s`);
        }
      }
    }
  }

  // ─── 6. OCMF_MISSING ──────────────────────────────────────────────────────
  console.log(`\n┌─ 6. OCMF_MISSING — has CDR but no ocmf_blob_ref (vendor didn't sign)`);
  console.log(SUB);
  {
    const countR = await safeQuery<{ n: number }>(c, `
      select count(*)::int as n
        from charging.sessions s
       where s.started_at > now() - ($1 || ' days')::interval
         and s.cdr_energy_kwh is not null
         and s.ocmf_blob_ref  is null
    `, [DAYS]);
    if (!countR.ok) {
      console.log(`     (schema not yet present: ${countR.error})`);
    } else {
      counts.OCMF_MISSING = countR.rows[0]?.n ?? 0;
      console.log(`     count: ${counts.OCMF_MISSING}`);
      const samples = await safeQuery<SampleRow>(c, `
        select s.id              as "sessionId",
               s.charging_station_id::text as "chargerId",
               s.started_at      as "startedAt",
               s.ocpp_energy_kwh::text as "ocppEnergyKwh",
               s.cdr_energy_kwh::text  as "cdrEnergyKwh",
               s.ocpp_stopped_at as "ocppStoppedAt",
               s.cdr_stopped_at  as "cdrStoppedAt",
               s.ocmf_blob_ref   as "ocmfBlobRef"
          from charging.sessions s
         where s.started_at > now() - ($1 || ' days')::interval
           and s.cdr_energy_kwh is not null
           and s.ocmf_blob_ref  is null
         order by s.started_at desc
         limit $2
      `, [DAYS, SAMPLE_LIMIT]);
      if (samples.ok && samples.rows.length > 0) {
        console.log("     sample (most recent):");
        printSampleHeader();
        for (const row of samples.rows) printSampleRow(row);
      }
    }
  }

  // ─── 7. session_ledger enrichment status snapshot (best-effort) ───────────
  console.log(`\n┌─ 7. reports.session_ledger — verified_source + enrichment_status snapshot`);
  console.log(SUB);
  {
    const r = await safeQuery<{ verified_source: string | null; enrichment_status: string | null; n: number }>(c, `
      select verified_source,
             enrichment_status,
             count(*)::int as n
        from reports.session_ledger
       where started_at > now() - ($1 || ' days')::interval
       group by verified_source, enrichment_status
       order by n desc
    `, [DAYS]);
    if (!r.ok) {
      console.log(`     (ENRICH-1 ledger columns not yet present: ${r.error})`);
    } else if (r.rows.length === 0) {
      console.log("     (no ledger rows in window)");
    } else {
      console.log(`     ${"verified_source".padEnd(14)} ${"enrichment_status".padEnd(20)} count`);
      for (const row of r.rows) {
        console.log(
          `     ${(row.verified_source ?? "—").padEnd(14)} ${(row.enrichment_status ?? "—").padEnd(20)} ${row.n.toString().padStart(6)}`,
        );
      }
    }
  }

  // ─── HEADLINE ──────────────────────────────────────────────────────────────
  console.log(`\n${SUB}`);
  console.log("  HEADLINE READOUT");
  console.log(`${SUB}\n`);
  const fmtCount = (n: number | null) => n === null ? "n/a (schema)" : n.toString();
  console.log(`  window:                ${DAYS} day(s)`);
  console.log(`  energy tolerance:      ${ENERGY_TOL_KWH} kWh`);
  console.log(`  stop-time tolerance:   ${TIME_TOL_SEC} s`);
  console.log("");
  console.log(`  MATCH                  ${fmtCount(counts.MATCH).padStart(10)}`);
  console.log(`  OCPP_ONLY              ${fmtCount(counts.OCPP_ONLY).padStart(10)}`);
  console.log(`  CDR_ONLY               ${fmtCount(counts.CDR_ONLY).padStart(10)}`);
  console.log(`  MISMATCH_ENERGY        ${fmtCount(counts.MISMATCH_ENERGY).padStart(10)}`);
  console.log(`  MISMATCH_TIME          ${fmtCount(counts.MISMATCH_TIME).padStart(10)}`);
  console.log(`  OCMF_MISSING           ${fmtCount(counts.OCMF_MISSING).padStart(10)}`);
  console.log("");

  const investigate =
    (counts.CDR_ONLY ?? 0) +
    (counts.MISMATCH_ENERGY ?? 0) +
    (counts.MISMATCH_TIME ?? 0);
  if (investigate > 0) {
    console.log(`  → ${investigate} session(s) need investigation (CDR_ONLY + mismatches).`);
  } else if (allPresent) {
    console.log("  → no anomalies detected in window.");
  } else {
    console.log("  → ENRICH-1 columns missing; rerun once ENRICH-1 has merged.");
  }

  console.log(`\n${SEP}\n`);

  await c.end();
})().catch((e) => {
  console.error("PROBE FAILED:", e);
  process.exit(1);
});
