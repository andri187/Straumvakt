/**
 * OCPP vocabulary boundary test — enforces V3 architecture §5
 * principle 4: "The translator is the only place OCPP vocabulary
 * lives." If this test breaks, something outside `src/lib/ocpp/`
 * referenced a raw OCPP 1.6J action name.
 *
 * Deliberately simple — a file-tree walk + regex. No reliance on a
 * second tool.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(process.cwd(), "src");
const OCPP_ALLOWED_PREFIXES = ["lib/ocpp/", "app/api/ocpp/"];

// OCPP action names that must only appear inside the OCPP subtree.
const FORBIDDEN_TOKENS = [
  "BootNotification",
  "Heartbeat",
  "StatusNotification",
  "Authorize",
  "StartTransaction",
  "MeterValues",
  "StopTransaction",
];

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const s = statSync(full);
    if (s.isDirectory()) {
      yield* walk(full);
    } else if (s.isFile() && (name.endsWith(".ts") || name.endsWith(".tsx"))) {
      yield full;
    }
  }
}

function isInOcppSubtree(relPath: string): boolean {
  const norm = relPath.split("\\").join("/");
  return OCPP_ALLOWED_PREFIXES.some((p) => norm.startsWith(p));
}

describe("boundary — no OCPP vocabulary leaks outside src/lib/ocpp", () => {
  it.each(FORBIDDEN_TOKENS)("token %s appears nowhere except src/lib/ocpp", (token) => {
    const offenders: string[] = [];
    for (const file of walk(ROOT)) {
      const rel = relative(ROOT, file);
      if (isInOcppSubtree(rel)) continue;
      const src = readFileSync(file, "utf8");
      if (src.includes(token)) offenders.push(rel);
    }
    expect(offenders, `Found '${token}' in:\n${offenders.join("\n")}`).toEqual([]);
  });
});
