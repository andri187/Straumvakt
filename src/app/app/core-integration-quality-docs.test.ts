import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const notes = path.resolve(process.cwd(), "docs/notes");
const audit = fs.readFileSync(path.join(notes, "2026-08-10-marathon-core-ui-audit.md"), "utf8");
const handoff = fs.readFileSync(path.join(notes, "2026-08-10-marathon-core-contract-handoff.md"), "utf8");
const packages = fs.readFileSync(path.join(notes, "2026-08-10-marathon-core-work-packages.md"), "utf8");
const review = fs.readFileSync(path.join(notes, "2026-08-10-marathon-morning-review.html"), "utf8");
const evidence = fs.readFileSync(path.join(notes, "2026-08-10-marathon-qa-evidence.md"), "utf8");

describe("marathon two-pass route audit", () => {
  it("contains one hundred and twenty rows", () => expect([...audit.matchAll(/^\| \d{3} \|/gm)]).toHaveLength(120));
  it("contains forty UI and copy changes", () => expect([...audit.matchAll(/\| UI\/copy change \|/g)]).toHaveLength(40));
  it("contains twenty gated treatments", () => expect([...audit.matchAll(/\| Disabled\/gated \|/g)]).toHaveLength(20));
  it("contains twenty backend contracts", () => expect([...audit.matchAll(/\| Backend contract \|/g)]).toHaveLength(20));
  it("contains twenty verification rows", () => expect([...audit.matchAll(/\| Verification \|/g)]).toHaveLength(20));
  it("contains twenty false-claim rows", () => expect([...audit.matchAll(/\| False-claim removal \|/g)]).toHaveLength(20));
  it("contains twenty exact removal entries", () => expect([...audit.matchAll(/^\| FC-\d{2} \|/gm)]).toHaveLength(20));
  it("covers both passes", () => {
    expect(audit).toContain("| Pass 1 |");
    expect(audit).toContain("| Pass 2 |");
  });
});

describe("marathon contracts and decisions", () => {
  for (const title of ["UI-backend statement", "Access and driver management", "OCPP cost-gate display", "Export and delivery", "Active-driver billing"]) {
    it(`contains ${title}`, () => expect(handoff).toContain(title));
  }
  it("contains one hundred implementation notes", () => {
    const section = handoff.split("## One hundred implementation notes")[1].split("## Exact disabled and gated copy")[0];
    expect([...section.matchAll(/^\d+\. /gm)]).toHaveLength(100);
  });
  it("contains ten exact gate-copy entries", () => expect([...handoff.matchAll(/^\| GATE-\d{2} \|/gm)]).toHaveLength(10));
  it("contains twenty-four decision cards", () => expect([...handoff.matchAll(/^### Decision \d{2} -/gm)]).toHaveLength(24));
  it("contains twenty-four bilingual copy candidates", () => expect([...handoff.matchAll(/^\| COPY-\d{2} \|/gm)]).toHaveLength(24));
  it("keeps bilingual copy behind native review", () => expect(handoff).toContain("require native review"));
});

describe("marathon execution and review packet", () => {
  it("contains one hundred and twenty issue packages", () => expect([...packages.matchAll(/^\| [A-Z0-9]+-\d{2} \|/gm)]).toHaveLength(120));
  it("records two hundred and eighty cumulative packages", () => expect(packages).toContain("280 packages"));
  it("contains a dependency graph", () => expect(packages).toContain("flowchart LR"));
  it("is a printable HTML review guide", () => {
    expect(review).toContain("@media print");
    expect(review).toContain("Twenty-five minute route");
    expect(review).toContain("Go/no-go questions");
  });
  it("covers the latest operational findings", () => {
    expect(review).toContain("/app/admin/integration-heartbeat");
    expect(review).toContain("/app/admin/integration-queue-deployment");
    expect(review).toContain("/app/admin/integration-offline-sweep");
    expect(review).toContain("/app/driver/integration-manual-review");
  });
  it("keeps dangerous commands behind a hard stop", () => expect(review).toContain("do not enable driver mutation"));
  it("records forty visual groups and honest accessibility limits", () => {
    expect(evidence).toContain("Formal visual groups | 40");
    expect(evidence).toContain("Native 200% browser zoom and device text scaling were not automated");
    expect(evidence).toContain("22 of 22 returned HTTP 200");
  });
});
