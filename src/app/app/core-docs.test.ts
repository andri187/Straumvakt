import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const notes = path.resolve(process.cwd(), "docs/notes");
const audit = fs.readFileSync(path.join(notes, "2026-08-10-core-ui-drift-audit.md"), "utf8");
const handoff = fs.readFileSync(path.join(notes, "2026-08-10-core-ui-implementation-handoff.md"), "utf8");
const packages = fs.readFileSync(path.join(notes, "2026-08-10-core-ui-work-packages.md"), "utf8");
const morning = fs.readFileSync(path.join(notes, "2026-08-10-core-ui-morning-review-guide.md"), "utf8");
const copyAndAccessibility = fs.readFileSync(path.join(notes, "2026-08-10-core-ui-copy-and-accessibility.md"), "utf8");

describe("Core UI durable handoff", () => {
  it("contains exactly eighty numbered audit rows", () => {
    expect([...audit.matchAll(/^\| \d{2} \|/gm)]).toHaveLength(80);
  });
  it("contains thirty change findings", () => {
    expect([...audit.matchAll(/\| Change \|/g)]).toHaveLength(30);
  });
  it("contains twenty Premium boundary findings", () => {
    expect([...audit.matchAll(/\| Premium boundary \|/g)]).toHaveLength(20);
  });
  it("contains twenty backend-gate findings", () => {
    expect([...audit.matchAll(/\| Backend gate \|/g)]).toHaveLength(20);
  });
  it("contains ten keep-and-verify findings", () => {
    expect([...audit.matchAll(/\| Keep\/verify \|/g)]).toHaveLength(10);
  });
  it("contains sixty numbered implementation notes", () => {
    const implementationNotes = handoff.split("## Sixty implementation notes")[1].split("## Rate-control UI contract")[0];
    expect([...implementationNotes.matchAll(/^\d+\. /gm)]).toHaveLength(60);
  });
  it("contains the rate-control contract", () => {
    expect(handoff).toContain("## Rate-control UI contract");
    expect(handoff).toContain("networkRateIskPerKwh");
    expect(handoff).toContain("gracePeriodMinutes");
  });
  it("contains the billing statement contract", () => {
    expect(handoff).toContain("## Billing statement contract");
    expect(handoff).toContain("source CDR ids");
    expect(handoff).toContain("totals that reconcile exactly");
  });
  it("contains fifteen mobile Driver requirements", () => {
    const mobile = handoff.split("## Mobile Driver statement requirements")[1].split("## Premium boundaries")[0];
    expect([...mobile.matchAll(/^\d+\. /gm)]).toHaveLength(15);
  });
  it("contains ten exact disabled-copy entries", () => {
    const copy = handoff.split("## Exact disabled and gated copy")[1];
    expect([...copy.matchAll(/^- /gm)]).toHaveLength(10);
  });
  it("contains one hundred issue-ready packages", () => {
    expect([...packages.matchAll(/^\| [A-Z0-9]+-\d{2} \|/gm)]).toHaveLength(100);
  });
  it("marks behavioural packages with approval dependencies", () => {
    expect(packages).toContain("Product approval");
    expect(packages).toContain("Security approval");
    expect(packages).toContain("Legal/commercial");
  });
  it("provides a bounded morning route", () => {
    expect(morning).toContain("## Fifteen-minute route");
    expect(morning).toContain("http://localhost:3012/login-demo");
    expect(morning).toContain("## Hard stops");
  });
  it("never claims this visual lane is live billing", () => {
    const all = `${audit}\n${handoff}\n${packages}\n${morning}\n${copyAndAccessibility}`;
    expect(all).not.toMatch(/bank connected|payment complete|invoice issued successfully/i);
  });
  it("keeps Icelandic copy candidates behind native review", () => {
    expect(copyAndAccessibility).toContain("Candidate - native review required");
    expect([...copyAndAccessibility.matchAll(/^\| COPY-\d{2} \|/gm)]).toHaveLength(20);
  });
  it("records the 200 percent text review without claiming automation", () => {
    expect(copyAndAccessibility).toContain("## 200% text and zoom review");
    expect(copyAndAccessibility).toContain("not a substitute for device verification");
  });
});
