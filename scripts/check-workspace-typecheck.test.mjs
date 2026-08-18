// Focused coverage for the workspace-typecheck guard.
//
// The failure it prevents is silent by construction: `--if-present` treats a
// missing script as success, so the pipeline prints PASS while compiling
// nothing. Each case is asserted against throwaway workspace trees in the OS
// temp dir; the real repository is never touched and nothing runs tsc.

import { afterAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { findUncoveredWorkspaces, workspaceDirs } from "./check-workspace-typecheck.mjs";

const made = [];

function repo(pkgs, workspaces = ["packages/*"]) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ws-typecheck-"));
  made.push(root);
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ name: "root", workspaces }, null, 2),
  );
  for (const [rel, spec] of Object.entries(pkgs)) {
    const dir = path.join(root, rel);
    fs.mkdirSync(path.join(dir, "src"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ name: spec.name, scripts: spec.scripts ?? {} }, null, 2),
    );
    for (const [file, body] of Object.entries(spec.files ?? {})) {
      const p = path.join(dir, file);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, body);
    }
  }
  return root;
}

afterAll(() => {
  for (const d of made) fs.rmSync(d, { recursive: true, force: true });
});

describe("findUncoveredWorkspaces", () => {
  it("flags a TypeScript workspace with no typecheck script", () => {
    const root = repo({
      "packages/alpha": { name: "@x/alpha", files: { "src/index.ts": "export const a = 1;\n" } },
    });
    const found = findUncoveredWorkspaces(root);
    expect(found).toHaveLength(1);
    expect(found[0].name).toBe("@x/alpha");
    expect(found[0].dir).toBe("packages/alpha");
  });

  it("flags an empty-string typecheck script as uncovered", () => {
    const root = repo({
      "packages/alpha": {
        name: "@x/alpha",
        scripts: { typecheck: "   " },
        files: { "src/index.ts": "export const a = 1;\n" },
      },
    });
    expect(findUncoveredWorkspaces(root)).toHaveLength(1);
  });

  it("accepts a TypeScript workspace that declares one", () => {
    const root = repo({
      "packages/alpha": {
        name: "@x/alpha",
        scripts: { typecheck: "tsc --noEmit" },
        files: { "src/index.ts": "export const a = 1;\n" },
      },
    });
    expect(findUncoveredWorkspaces(root)).toEqual([]);
  });

  it("ignores a workspace with no TypeScript sources", () => {
    const root = repo({
      "packages/docsonly": { name: "@x/docs", files: { "src/readme.md": "# hi\n" } },
    });
    expect(findUncoveredWorkspaces(root)).toEqual([]);
  });

  it("does not count TypeScript inside node_modules or generated output", () => {
    const root = repo({
      "packages/alpha": {
        name: "@x/alpha",
        files: {
          "node_modules/dep/index.ts": "export const d = 1;\n",
          "src/generated/client.ts": "export const g = 1;\n",
          "dist/index.ts": "export const b = 1;\n",
          "src/readme.md": "# hi\n",
        },
      },
    });
    expect(findUncoveredWorkspaces(root)).toEqual([]);
  });

  it("detects .mts and .tsx as TypeScript", () => {
    for (const file of ["src/a.mts", "src/a.tsx"]) {
      const root = repo({
        "packages/alpha": { name: "@x/alpha", files: { [file]: "export const a = 1;\n" } },
      });
      expect(findUncoveredWorkspaces(root)).toHaveLength(1);
    }
  });

  it("reports every uncovered workspace, not just the first", () => {
    const root = repo({
      "packages/alpha": { name: "@x/alpha", files: { "src/index.ts": "export const a = 1;\n" } },
      "packages/beta": { name: "@x/beta", files: { "src/index.ts": "export const b = 1;\n" } },
      "packages/gamma": {
        name: "@x/gamma",
        scripts: { typecheck: "tsc --noEmit" },
        files: { "src/index.ts": "export const c = 1;\n" },
      },
    });
    expect(findUncoveredWorkspaces(root).map((w) => w.name).sort()).toEqual([
      "@x/alpha",
      "@x/beta",
    ]);
  });
});

describe("workspaceDirs", () => {
  it("expands glob and literal workspace patterns", () => {
    const root = repo(
      {
        "packages/alpha": { name: "@x/alpha" },
        "apps/api": { name: "@x/api" },
      },
      ["packages/*", "apps/api"],
    );
    expect(workspaceDirs(root).map((d) => path.basename(d)).sort()).toEqual(["alpha", "api"]);
  });

  it("returns nothing for a root package.json with no workspaces", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ws-typecheck-"));
    made.push(root);
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "root" }));
    expect(workspaceDirs(root)).toEqual([]);
  });
});
