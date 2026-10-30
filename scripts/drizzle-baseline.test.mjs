// Tests for apps/api/scripts/drizzle-baseline-lib.mjs. No database: a fake
// pg-like client records every statement it is asked to run.
//
// Two hazards, both proven here:
//   1. The baseline path never records 0001 (or any later migration).
//   2. Preview / verify never write — not even the CREATE SCHEMA / CREATE TABLE
//      the old script ran before logging "would baseline".
//
// What this cannot prove: that real PostgreSQL honours BEGIN READ ONLY or that
// drizzle-kit migrate accepts the recorded hash. That needs a disposable DB.

import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  BASELINE_TAG,
  parseMode,
  readJournalEntries,
  run,
  selectBaseline,
} from "../apps/api/scripts/drizzle-baseline-lib.mjs";

const FOLDER = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "apps", "api", "drizzle");

const WRITE = /^\s*(CREATE|INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE|GRANT)\b/i;

/** Fake client. `recorded` = hashes already in drizzle.__drizzle_migrations; null = table absent. */
function fakeClient(recorded) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql: sql.trim(), params });
      if (/to_regclass/i.test(sql)) return { rows: [{ t: recorded === null ? null : "drizzle.__drizzle_migrations" }] };
      if (/FROM drizzle\.__drizzle_migrations/i.test(sql)) {
        return { rows: (recorded ?? []).map((hash, i) => ({ hash, created_at: i })) };
      }
      return { rows: [] };
    },
  };
}

const writes = (client) => client.calls.filter((c) => WRITE.test(c.sql));
const inserts = (client) => client.calls.filter((c) => /^INSERT/i.test(c.sql));

const entries = readJournalEntries(FOLDER);

describe("the real journal", () => {
  it("starts with the cold baseline and has 0001 after it", () => {
    expect(entries[0].tag).toBe(BASELINE_TAG);
    expect(entries.map((e) => e.tag)).toContain("0001_restore_temporal_and_status_constraints");
  });
});

describe("parseMode", () => {
  it("defaults to preview and accepts each single mode", () => {
    expect(parseMode([])).toBe("preview");
    expect(parseMode(["--apply"])).toBe("apply");
    expect(parseMode(["--verify"])).toBe("verify");
    expect(parseMode(["--verify-all"])).toBe("verify-all");
  });

  it("rejects incompatible and unknown flags", () => {
    expect(() => parseMode(["--apply", "--verify"])).toThrow(/incompatible/);
    expect(() => parseMode(["--verify", "--verify-all"])).toThrow(/incompatible/);
    expect(() => parseMode(["--aply"])).toThrow(/unknown argument/);
  });
});

describe("selectBaseline fails closed", () => {
  it("splits baseline from later entries", () => {
    const { baseline, later } = selectBaseline(entries);
    expect(baseline.tag).toBe(BASELINE_TAG);
    expect(later.map((e) => e.tag)).not.toContain(BASELINE_TAG);
    expect(later.length).toBe(entries.length - 1);
  });

  it("refuses an empty journal, a different first entry, or a duplicate baseline", () => {
    expect(() => selectBaseline([])).toThrow(/no entries/);
    expect(() => selectBaseline([{ tag: "0000_baseline", hash: "x" }, ...entries.slice(1)])).toThrow(/expected 0000_cold_hex/);
    expect(() => selectBaseline([...entries, entries[0]])).toThrow(/more than once/);
  });
});

describe("--apply records the baseline and nothing else", () => {
  it("inserts exactly the 0000 hash, never 0001, on an empty database", async () => {
    const client = fakeClient(null);
    const res = await run({ client, entries, mode: "apply" });
    expect(res).toEqual({ ok: true, wrote: true });

    const ins = inserts(client);
    expect(ins).toHaveLength(1);
    expect(ins[0].params[0]).toBe(entries[0].hash);
    for (const later of entries.slice(1)) {
      expect(ins.some((i) => i.params.includes(later.hash))).toBe(false);
    }
    expect(client.calls.at(-1).sql).toBe("COMMIT");
  });

  it("is a no-op, rolled back, when the baseline is already recorded", async () => {
    const client = fakeClient([entries[0].hash]);
    expect(await run({ client, entries, mode: "apply" })).toEqual({ ok: true, wrote: false });
    expect(inserts(client)).toHaveLength(0);
    expect(client.calls.at(-1).sql).toBe("ROLLBACK");
  });

  it("does not record 0001 even when only the baseline is missing from a populated table", async () => {
    const client = fakeClient(["somethingelse"]);
    await expect(run({ client, entries, mode: "apply" })).rejects.toThrow(/refusing to baseline/);
    expect(inserts(client)).toHaveLength(0);
    expect(client.calls.at(-1).sql).toBe("ROLLBACK");
  });

  it("does not record 0001 when 0001 is the only thing recorded", async () => {
    const client = fakeClient([entries[1].hash]);
    await expect(run({ client, entries, mode: "apply" })).rejects.toThrow(/refusing/);
    expect(inserts(client)).toHaveLength(0);
  });

  it("refuses to run at all when the journal does not start with the cold baseline", async () => {
    const client = fakeClient(null);
    await expect(
      run({ client, entries: [{ ...entries[0], tag: "0000_other" }, ...entries.slice(1)], mode: "apply" }),
    ).rejects.toThrow(/expected 0000_cold_hex/);
    expect(client.calls).toHaveLength(0);
  });
});

describe("preview and verify never write", () => {
  it.each(["preview", "verify", "verify-all"])("%s issues no DDL or DML, on an absent table", async (mode) => {
    const client = fakeClient(null);
    await run({ client, entries, mode });
    expect(writes(client)).toEqual([]);
    expect(client.calls[0].sql).toBe("BEGIN READ ONLY");
    expect(client.calls.at(-1).sql).toBe("ROLLBACK");
  });

  it.each(["preview", "verify", "verify-all"])("%s issues no DDL or DML, on a populated table", async (mode) => {
    const client = fakeClient(entries.map((e) => e.hash));
    await run({ client, entries, mode });
    expect(writes(client)).toEqual([]);
  });

  it("preview reports 0001 as not in the ledger when absent", async () => {
    const lines = [];
    await run({ client: fakeClient(null), entries, mode: "preview", log: (m) => lines.push(m) });
    const out = lines.join("\n");
    expect(out).toMatch(/would baseline\s+0000_cold_hex/);
    expect(out).toMatch(/not in ledger\s+0001_restore_temporal_and_status_constraints/);
    expect(out).toMatch(/will not execute or record/);
    expect(out).not.toMatch(/ledger already records/);
  });

  it("preview on a populated ledger reports recorded entries as recorded, not pending", async () => {
    const lines = [];
    await run({ client: fakeClient(entries.map((e) => e.hash)), entries, mode: "preview", log: (m) => lines.push(m) });
    const out = lines.join("\n");
    expect(out).toMatch(/already baselined\s+0000_cold_hex/);
    expect(out).toMatch(/ledger already records\s+0001_restore_temporal_and_status_constraints/);
    expect(out).not.toMatch(/not in ledger/);
    expect(out).not.toMatch(/would baseline/);
  });

  it("preview with only the baseline recorded reports 0001 as not in the ledger", async () => {
    const lines = [];
    await run({ client: fakeClient([entries[0].hash]), entries, mode: "preview", log: (m) => lines.push(m) });
    const out = lines.join("\n");
    expect(out).toMatch(/already baselined\s+0000_cold_hex/);
    expect(out).toMatch(/not in ledger\s+0001_/);
  });
});

describe("verify scope is explicit", () => {
  it("--verify passes with the baseline recorded and 0001 pending, and says it is a baseline-only ledger check", async () => {
    const lines = [];
    const res = await run({ client: fakeClient([entries[0].hash]), entries, mode: "verify", log: (m) => lines.push(m) });
    expect(res.ok).toBe(true);
    const out = lines.join("\n");
    expect(out).toMatch(/ledger check passed \(baseline only\)/);
    expect(out).toMatch(/does not prove/);
    expect(out).not.toMatch(/FAILED/);
  });

  it("--verify-all fails while 0001 is pending, with a failure summary and no success wording", async () => {
    const lines = [];
    const res = await run({ client: fakeClient([entries[0].hash]), entries, mode: "verify-all", log: (m) => lines.push(m) });
    expect(res.ok).toBe(false);
    const out = lines.join("\n");
    expect(out).toMatch(/PENDING\s+0001_/);
    expect(out).toMatch(/ledger check FAILED \(whole chain\)/);
    expect(out).not.toMatch(/passed/);
    expect(out).not.toMatch(/verified:/);
  });

  it("--verify-all passes only when every entry is recorded", async () => {
    const lines = [];
    const res = await run({ client: fakeClient(entries.map((e) => e.hash)), entries, mode: "verify-all", log: (m) => lines.push(m) });
    expect(res.ok).toBe(true);
    expect(lines.join("\n")).toMatch(/ledger check passed \(whole chain\)/);
  });

  it("--verify fails on a missing baseline, with a failure summary", async () => {
    const lines = [];
    const res = await run({ client: fakeClient(null), entries, mode: "verify", log: (m) => lines.push(m) });
    expect(res.ok).toBe(false);
    expect(lines.join("\n")).toMatch(/PENDING\s+0000_cold_hex/);
    expect(lines.join("\n")).toMatch(/ledger check FAILED \(baseline only\)/);
  });

  it("--verify fails on an orphan hash, naming it, with a failure summary", async () => {
    const lines = [];
    const res = await run({
      client: fakeClient([entries[0].hash, "edited-after-apply-0123456789"]),
      entries,
      mode: "verify",
      log: (m) => lines.push(m),
    });
    expect(res.ok).toBe(false);
    const out = lines.join("\n");
    expect(out).toMatch(/ORPHAN\s+recorded hash edited-after/);
    expect(out).toMatch(/ledger check FAILED/);
  });
});
