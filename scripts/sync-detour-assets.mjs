/**
 * Refreshes the external-asset copies that the UI detour pages serve
 * via Next.js `public/`. These directories are gitignored — re-run
 * this script after the Flutter mock or reference docs change.
 *
 *   npm run sync:detour-assets
 *
 * Sources are absolute Windows paths because the assets live outside
 * the Straumvakt repo. Adjust here if your tree differs.
 */
import {
  cpSync,
  rmSync,
  existsSync,
  mkdirSync,
  statSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";

const here = resolve(import.meta.dirname);
const repoRoot = resolve(here, "..");

const tasks = [
  {
    name: "mobile-app mock (Flutter web build)",
    from: "E:\\Claude\\CPMS\\mobile-app\\mock1\\build\\web",
    to: resolve(repoRoot, "public", "mobile-app-mock"),
  },
  {
    name: "reference docs (Iceland energy parties)",
    from: resolve(repoRoot, "docs", "reference"),
    to: resolve(repoRoot, "public", "reference"),
  },
  {
    name: "zaptec API specs (openapi + constants only — NO .env)",
    from: "E:\\Claude\\zaptec-test",
    to: resolve(repoRoot, "public", "zaptec"),
    fileFilter: (src) => {
      const base = src.toLowerCase().split(/[\\/]/).pop() ?? "";
      return base === "openapi.json" || base === "zaptec-constants.json";
    },
  },
];

for (const t of tasks) {
  if (!existsSync(t.from)) {
    console.error(`[sync] SKIP ${t.name}: source not found at ${t.from}`);
    continue;
  }
  if (existsSync(t.to)) {
    rmSync(t.to, { recursive: true, force: true });
  }
  mkdirSync(t.to, { recursive: true });
  if (t.fileFilter) {
    cpSync(t.from, t.to, {
      recursive: true,
      filter: (src) => {
        // Always allow directory descent; filter at file level.
        try {
          if (statSync(src).isDirectory()) return true;
        } catch {
          return false;
        }
        return t.fileFilter(src);
      },
    });
  } else {
    cpSync(t.from, t.to, { recursive: true });
  }
  console.log(`[sync] ${t.name}: ${t.from} → ${t.to}`);
}

// Post-process: rewrite Flutter <base href="/"> to "/mobile-app-mock/"
// so asset paths resolve correctly when the build is served from a
// subpath via Next's public/ directory.
const flutterIndex = resolve(repoRoot, "public", "mobile-app-mock", "index.html");
if (existsSync(flutterIndex)) {
  const before = readFileSync(flutterIndex, "utf8");
  const after = before.replace(
    /<base href="\/">/,
    '<base href="/mobile-app-mock/">',
  );
  if (before !== after) {
    writeFileSync(flutterIndex, after);
    console.log("[sync] flutter base-href rewritten → /mobile-app-mock/");
  }
}

console.log("[sync] done.");
