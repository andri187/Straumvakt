import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const notes = path.resolve(process.cwd(), "docs/notes");
const audit = fs.readFileSync(path.join(notes, "2026-08-10-core-backend-finding-ui-audit.md"), "utf8");
const handoff = fs.readFileSync(path.join(notes, "2026-08-10-core-backend-contract-handoff.md"), "utf8");
const packages = fs.readFileSync(path.join(notes, "2026-08-10-core-backend-contract-work-packages.md"), "utf8");
const review = fs.readFileSync(path.join(notes, "2026-08-10-core-backend-contract-morning-review.md"), "utf8");
const evidence = fs.readFileSync(path.join(notes, "2026-08-10-core-backend-contract-qa-evidence.md"), "utf8");

describe("backend-finding UI audit", () => {
  it("contains one hundred audit rows", () => expect([...audit.matchAll(/^\| \d{3} \|/gm)]).toHaveLength(100));
  it("contains thirty required changes", () => expect([...audit.matchAll(/\| Change \|/g)]).toHaveLength(30));
  it("contains twenty disabled or gated states", () => expect([...audit.matchAll(/\| Disabled\/gated \|/g)]).toHaveLength(20));
  it("contains twenty backend contract notes", () => expect([...audit.matchAll(/\| Backend contract \|/g)]).toHaveLength(20));
  it("contains thirty verification guards", () => expect([...audit.matchAll(/\| Verify \|/g)]).toHaveLength(30));
});

describe("six backend contracts", () => {
  for (const title of ["Billing statement states", "Meter anomaly", "CDR authority", "Manual driver permission", "OCPP cost gate display", "Active driver billing count"]) {
    it(`includes ${title}`, () => expect(handoff).toContain(title));
  }
  it("contains eighty numbered implementation notes", () => {
    const section = handoff.split("## Eighty implementation notes")[1].split("## Product decision cards")[0];
    expect([...section.matchAll(/^\d+\. /gm)]).toHaveLength(80);
  });
  it("contains twenty product decision cards", () => expect([...handoff.matchAll(/^### Decision \d{2} -/gm)]).toHaveLength(20));
  it("contains twenty translation candidates", () => expect([...handoff.matchAll(/^\| COPY-\d{2} \|/gm)]).toHaveLength(20));
  it("marks translation candidates for native review", () => expect(handoff).toContain("Native review required"));
});

describe("future execution packet", () => {
  it("contains sixty new issue-ready packages", () => expect([...packages.matchAll(/^\| [A-Z]+-\d{2} \|/gm)]).toHaveLength(60));
  it("records a dependency graph", () => expect(packages).toContain("flowchart LR"));
  it("provides an exact morning click path", () => {
    expect(review).toContain("## Twenty-minute click path");
    expect(review).toContain("/app/driver/meter-verification-held");
    expect(review).toContain("/app/admin/ocpp-cost-gate");
  });
  it("provides keyboard and text-scaling review", () => {
    expect(review).toContain("## Keyboard and focus checklist");
    expect(review).toContain("200% browser zoom");
    expect(review).toContain("forced-colors");
  });
  it("does not claim backend or billing completion", () => {
    const all = `${audit}\n${handoff}\n${packages}\n${review}\n${evidence}`;
    expect(all).not.toMatch(/bank connected|payment complete|production ready|permission granted|frame cap enabled/i);
  });
  it("records thirty formal visual groups without overstating zoom", () => {
    expect(evidence).toContain("30 formal screenshots");
    expect(evidence).toContain("inconclusive probe");
    expect(evidence).toContain("native 200% zoom was not proven");
  });
});
