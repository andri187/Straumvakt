// The first-invoice dry run, pinned.
//
// These run the script as a SUBPROCESS rather than importing it, because half
// of what the gates ask about is the exit code — "did an invoice come out" is
// the signal an operator and any automation downstream actually consume, and a
// unit test that imported the functions would not exercise it.
//
// Slower than an in-process test, and worth it: this is the artefact a human
// runs, so this is the artefact under test.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const SCRIPT = "scripts/dry-run-first-invoice.mts";
const tmp = mkdtempSync(join(tmpdir(), "dry-run-invoice-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

interface Run {
  code: number;
  out: string;
}

function run(...args: string[]): Run {
  try {
    const out = execFileSync("npx", ["tsx", SCRIPT, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
    });
    return { code: 0, out };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? -1, out: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

describe("the happy path produces an invoice", () => {
  const r = run();

  it("exits 0", () => {
    expect(r.code).toBe(0);
  });

  it("renders an Icelandic sales invoice with a document number", () => {
    expect(r.out).toContain("Sölureikningur nr. SV-2026-000001");
  });

  it("names the kröfuhafi and the payer", () => {
    expect(r.out).toContain("KRÖFUHAFI");
    expect(r.out).toContain("Straumvakt ehf.");
    expect(r.out).toContain("GREIÐANDI");
    expect(r.out).toContain("Hýsill A ehf.");
  });

  it("prices 30 connectors and 2 drivers, uncapped, at 7.564,00 kr gross", () => {
    // The arithmetic the decision packet predicted: 30 × 200 + 2 × 50 = 6,100
    // ex-VAT, + 24% = 7,564. If this number moves, either the locked model
    // moved or something is wrong.
    expect(r.out).toContain("6.000,00 kr.");
    expect(r.out).toContain("100,00 kr.");
    expect(r.out).toContain("6.100,00 kr.");
    expect(r.out).toContain("1.464,00 kr.");
    expect(r.out).toContain("7.564,00 kr.");
  });

  it("states the delivery record as unknown, never delivered", () => {
    // Nothing was delivered. A dry run that said otherwise would be lying
    // about the one thing a delivery log exists to be honest about.
    expect(r.out).toContain("Staða afhendingar: unknown");
    expect(r.out).not.toMatch(/Staða afhendingar: delivered/);
  });

  it("says on its face that the driver count was SUPPLIED, not derived", () => {
    // The locked definition is not computable. A dry run that quietly supplied
    // the number would demonstrate a capability that does not exist.
    expect(r.out).toContain("SUPPLIED BY THE FIXTURE, not derived");
    expect(r.out).toContain("2026-08-18-active-driver-definition.md");
  });

  it("shows the connector count WAS derived, with its evidence split", () => {
    expect(r.out).toMatch(/connector count 30 — DERIVED from 30 activity rows/);
    expect(r.out).toContain("3 session_observed");
    expect(r.out).toContain("27 status_available");
  });

  it("declares the principal posture and the market line", () => {
    expect(r.out).toContain("posture principal");
    expect(r.out).toContain("platform_to_host");
  });
});

describe("determinism", () => {
  it("two runs are byte-for-byte identical", () => {
    // No wall-clock field exists in this document: issueDate, dueDate and the
    // period are fixture constants, and the script reads no clock. In a REAL
    // run, issueDate and dueDate are the two time-dependent fields — they come
    // from the run date and the payment terms, and nothing else would move.
    const a = run();
    const b = run();
    expect(a.code).toBe(0);
    expect(a.out).toBe(b.out);
  });

  it("reads no clock at all", () => {
    const src = readFileSync(SCRIPT, "utf8");
    // Comments mention Date; the code must not call it.
    const code = src
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("//") && !l.trimStart().startsWith("*"))
      .join("\n");
    expect(code).not.toMatch(/Date\.now\(\)/);
    expect(code).not.toMatch(/new Date\(\s*\)/);
  });
});

describe("the document passes B's validator", () => {
  it("check:invoice accepts the emitted draft", () => {
    const target = join(tmp, "invoice.json");
    expect(run("--json", target).code).toBe(0);
    const draft = JSON.parse(readFileSync(target, "utf8")) as { lines: unknown[] };
    expect(draft.lines.length).toBeGreaterThan(0);

    const v = (() => {
      try {
        return {
          code: 0,
          out: execFileSync("npx", ["tsx", "scripts/validate-invoice.mts", target], {
            encoding: "utf8",
            shell: process.platform === "win32",
          }),
        };
      } catch (e) {
        const err = e as { status?: number; stdout?: string };
        return { code: err.status ?? -1, out: err.stdout ?? "" };
      }
    })();
    expect(v.code).toBe(0);
    expect(v.out).toContain("OK");
  });
});

describe("broken fixtures each exit non-zero with a readable reason", () => {
  it("a period with no activity rows HOLDS", () => {
    const r = run("--case", "holds-without-connector-rows");
    expect(r.code).toBe(1);
    expect(r.out).toContain("period HELD");
    expect(r.out).toContain("connector_count_unavailable");
    expect(r.out).toContain("no invoice was produced");
  });

  it("the real driver definition HOLDS — what a live run does today", () => {
    const r = run("--case", "holds-on-real-driver-definition");
    expect(r.code).toBe(1);
    expect(r.out).toContain("driver_count_unavailable");
  });

  it("a host with no registered identity is REFUSED", () => {
    const r = run("--case", "refuses-host-without-kennitala");
    expect(r.code).toBe(1);
    expect(r.out).toContain("recipient_registered_id_missing");
  });

  it("a mixed-posture document is REFUSED at construction", () => {
    // Principal-only, proven: an agent-posture line cannot join this document.
    // Rejected when it is BUILT, not when it is rendered — a malformed document
    // that exists is one some unaudited code path will eventually render.
    const r = run("--case", "refuses-mixed-posture");
    expect(r.code).toBe(1);
    expect(r.out).toContain("mixed_posture");
  });
});

describe("numbering is gap-free and crash-safe", () => {
  const r = run("--case", "numbering-gap-free-and-crash-safe");

  it("exits 0 and reports no gaps", () => {
    expect(r.code).toBe(0);
    expect(r.out).toContain("gaps         none");
  });

  it("a crash between allocate and issue does not consume a number", () => {
    // Icelandic law requires "samfelld töluröð" — an unbroken sequence. A
    // number spent on a document that never existed is a hole that cannot be
    // filled later, because the documents around it are already in someone
    // else's books.
    expect(r.out).toContain("after crash  SV-2026-000001");
    expect(r.out).toContain("sequence not advanced");
  });

  it("re-issuing a committed key reuses the number rather than taking a new one", () => {
    expect(r.out).toContain("reused=true");
  });

  it("a second document takes the next number", () => {
    expect(r.out).toContain("next doc     SV-2026-000002");
  });
});

describe("the API surface, driven end to end", () => {
  it("open -> activity -> price -> issue -> close, all 200, one document", () => {
    // A2c proved the LIBRARY path. This drives the HANDLERS an operator will
    // actually call — the same router index.ts mounts, with a fixture port and
    // no database. A library that works behind a route that does not is not a
    // working invoice, and the route is where the idempotency and lifecycle
    // guards actually live.
    const r = run("--case", "api-lifecycle");
    expect(r.code).toBe(0);
    expect(r.out).toContain("open      200");
    expect(r.out).toContain("issue     200");
    expect(r.out).toContain("close     200");
    expect(r.out).toContain("document  SV-2026-000001");
    expect(r.out).toContain("no repeats");
  });

  it("refuses out of order, replays a retry, and demands an idempotency key", () => {
    // This case produces no invoice, so it exits 1 — the operator-mode
    // contract. Whether it BEHAVED is what --all checks.
    const r = run("--case", "api-lifecycle-refusals");
    expect(r.out).toContain("price before open        409");
    expect(r.out).toContain("open replayed, same key  no new effect");
    expect(r.out).toContain("activity with no key     400");
  });
});

describe("regression mode", () => {
  it("--all exits 0 when every case behaves, refusals included", () => {
    const r = run("--all");
    expect(r.code).toBe(0);
    expect(r.out).toContain("8/8 cases behaved as specified");
  });
});
