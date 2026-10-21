// Focused coverage for the vacuous-pass guard in check-schema-consistency.mjs.
//
// The check compares two regex-parsed schema sets. Before the guard, a parse
// that produced nothing on BOTH sides compared zero tables against zero tables,
// found no differences, and exited 0 announcing "0 tables, 0 columns" — a green
// that proved nothing, which is the precise failure the check exists to replace.
//
// These tests run the real script against isolated temporary fixture trees. The
// script derives its ROOT from its own location, so copying it into
// <tmpdir>/scripts/ makes <tmpdir> the repository it inspects. Nothing here
// touches the real schemas and nothing opens a database connection.

import { afterAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("./check-schema-consistency.mjs", import.meta.url));
const made = [];

/** Build a throwaway repo containing the script plus the two schema dirs. */
function fixture({ prisma, drizzle }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "schema-consistency-"));
  made.push(root);
  fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
  fs.mkdirSync(path.join(root, "prisma", "schema"), { recursive: true });
  fs.mkdirSync(path.join(root, "packages", "shared", "src", "db"), { recursive: true });
  fs.copyFileSync(SCRIPT, path.join(root, "scripts", path.basename(SCRIPT)));
  if (prisma) fs.writeFileSync(path.join(root, "prisma", "schema", "a.prisma"), prisma);
  if (drizzle) fs.writeFileSync(path.join(root, "packages", "shared", "src", "db", "a.ts"), drizzle);
  return root;
}

function run(root) {
  try {
    const stdout = execFileSync(
      process.execPath,
      [path.join(root, "scripts", path.basename(SCRIPT))],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    return { code: 0, out: stdout };
  } catch (err) {
    return { code: err.status ?? 1, out: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

// One table, declared identically on both sides, so the comparison agrees.
const PRISMA_ONE = `model Widget {
  id      String @id
  orgId   String @map("org_id")

  @@map("widgets")
  @@schema("assets")
}
`;

const DRIZZLE_ONE = `import { pgSchema, text } from "drizzle-orm/pg-core";

export const assets = pgSchema("assets");

export const widgets = assets.table(
  "widgets",
  {
    id: text("id"),
    orgId: text("org_id"),
  }
);
`;

afterAll(() => {
  for (const d of made) fs.rmSync(d, { recursive: true, force: true });
});

describe("check-schema-consistency — vacuous-pass guard", () => {
  it("fails when BOTH sides parse to zero tables instead of agreeing vacuously", () => {
    const { code, out } = run(fixture({}));
    expect(code).toBe(1);
    expect(out).toContain("refusing to pass vacuously");
    // The old behaviour, which must not come back.
    expect(out).not.toContain("Drizzle and Prisma agree");
  });

  it("fails when only the Drizzle side parses to zero tables", () => {
    const { code, out } = run(fixture({ prisma: PRISMA_ONE }));
    expect(code).toBe(1);
    expect(out).toContain("refusing to pass vacuously");
  });

  it("fails when only the Prisma side parses to zero tables", () => {
    const { code, out } = run(fixture({ drizzle: DRIZZLE_ONE }));
    expect(code).toBe(1);
    expect(out).toContain("refusing to pass vacuously");
  });

  it("still passes for a legitimate non-empty schema that agrees", () => {
    const { code, out } = run(fixture({ prisma: PRISMA_ONE, drizzle: DRIZZLE_ONE }));
    expect(code).toBe(0);
    expect(out).toContain("Drizzle and Prisma agree (1 tables");
  });

  it("still reports a real divergence rather than the guard message", () => {
    const drizzleExtra = DRIZZLE_ONE.replace(
      `    orgId: text("org_id"),`,
      `    orgId: text("org_id"),\n    extra: text("extra_col"),`,
    );
    const { code, out } = run(fixture({ prisma: PRISMA_ONE, drizzle: drizzleExtra }));
    expect(code).toBe(1);
    expect(out).toContain("columns only in Drizzle: extra_col");
    expect(out).not.toContain("refusing to pass vacuously");
  });
});
