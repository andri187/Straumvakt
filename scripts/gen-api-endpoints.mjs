#!/usr/bin/env node
//
// Generate docs/reference/api-endpoints.md — every HTTP endpoint the API
// Worker exposes, and whether anything in this repo calls it.
//
// WHY
// ---
// Route paths are a public contract: apps/mobile and the console both consume
// them. The guard prescribed for that was "grep app.route( before and after,
// diff the result" — but that covers the 44 MOUNTS, not the 177 endpoints
// underneath, so a changed sub-path passes it. This enumerates the real
// surface and makes it a committed file, so any change to it is a diff in a
// pull request rather than something discovered when someone opens the app.
//
// Hono composes the surface in two halves: index.ts mounts a sub-app at a
// prefix, the sub-app declares paths relative to it. Both are walked.
//
// CONSUMERS is best-effort and deliberately generous — a hit anywhere counts.
// Endpoints called by systems outside this repo (Zaptec's webhooks, browsers
// hitting the public pages) can never be seen by a grep, so "unreferenced"
// means "nothing in this repo calls it", NOT "dead". The header says so.
//
//   node scripts/gen-api-endpoints.mjs           write
//   node scripts/gen-api-endpoints.mjs --check   verify, exit 1 if stale
//
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const API = path.join(ROOT, "apps/api/src");
const OUT = path.join(ROOT, "docs/reference/api-endpoints.md");
const check = process.argv.includes("--check");

// ── the surface ────────────────────────────────────────────────────────────
const index = fs.readFileSync(path.join(API, "index.ts"), "utf8");

const importOf = new Map();
for (const m of index.matchAll(/import\s*\{([^}]+)\}\s*from\s*"(\.[^"]+)"/g)) {
  for (const raw of m[1].split(",")) {
    const name = raw.trim().replace(/^type\s+/, "").split(/\s+as\s+/).pop().trim();
    if (name) importOf.set(name, m[2]);
  }
}

const METHODS = ["get", "post", "put", "patch", "delete", "all", "options", "head"];
const endpoints = new Map(); // "METHOD path" -> { method, path, mount, file }

for (const m of index.matchAll(/app\.route\(\s*"([^"]+)"\s*,\s*(\w+)\s*\)/g)) {
  const [, prefix, ident] = m;
  const rel = importOf.get(ident);
  if (!rel) continue;
  const fp = path.join(API, rel.replace(/^\.\//, "")) + ".ts";
  if (!fs.existsSync(fp)) continue;
  const src = fs.readFileSync(fp, "utf8").replace(/\s+/g, " ");
  const re = new RegExp(`\\b${ident}\\s*\\.\\s*(${METHODS.join("|")})\\s*\\(\\s*"([^"]*)"`, "g");
  for (const r of src.matchAll(re)) {
    const sub = r[2];
    if (sub === "*") continue; // middleware guard, not an endpoint
    const full = (prefix + (sub === "/" ? "" : sub)) || "/";
    const key = `${r[1].toUpperCase()} ${full}`;
    if (!endpoints.has(key)) {
      endpoints.set(key, {
        method: r[1].toUpperCase(),
        path: full,
        mount: prefix,
        file: rel.replace(/^\.\//, ""),
      });
    }
  }
}

// ── who calls them ─────────────────────────────────────────────────────────
const CONSUMERS = [
  ["console", "src", [".ts", ".tsx"]],
  ["mobile", "apps/mobile/lib", [".dart"]],
  ["gateway", "gateway/src", [".ts"]],
  ["zaptec-consumer", "apps/zaptec-consumer", [".ts"]],
];

function slurp(dir, exts) {
  const abs = path.join(ROOT, dir);
  const out = [];
  const walk = (d) => {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (!["generated", "node_modules", ".next", "build", ".dart_tool"].includes(e.name)) walk(p);
      } else if (exts.some((x) => e.name.endsWith(x))) out.push(fs.readFileSync(p, "utf8"));
    }
  };
  walk(abs);
  return out.join("\n");
}
const blobs = CONSUMERS.map(([name, dir, exts]) => [name, slurp(dir, exts)]);

/** `/api/admin/orgs/:id/chargers` also matches `/api/admin/orgs/${x}/chargers`. */
function toRe(p) {
  const parts = p.split("/").filter(Boolean).map((seg) =>
    seg.startsWith(":") ? "[^\"'`\\s]+" : seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
  );
  return new RegExp("/" + parts.join("/"));
}

const rows = [...endpoints.values()]
  .map((e) => ({ ...e, callers: blobs.filter(([, b]) => toRe(e.path).test(b)).map(([n]) => n) }))
  .sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));

// ── render ─────────────────────────────────────────────────────────────────
const surfaces = [...new Set(rows.map((r) => r.path.split("/")[2]))].sort();
const L = [];
L.push("# API endpoints — generated");
L.push("");
L.push("**Do not edit.** Written by `scripts/gen-api-endpoints.mjs` from");
L.push("`apps/api/src/index.ts` and the sub-apps it mounts. Regenerate with");
L.push("`npm run api:endpoints`; `npm run check` fails if this file is stale.");
L.push("");
L.push("Route paths are a public contract — the Flutter app and the console both");
L.push("consume them. This file exists so a change to that contract shows up as a");
L.push("diff in review, rather than when someone opens the app.");
L.push("");
L.push("## Reading the Called-by column");
L.push("");
L.push("It lists repos in THIS tree that reference the path. **Empty does not mean");
L.push("dead.** Zaptec calls the webhook endpoints from their own servers, and the");
L.push("public auth endpoints are hit by browsers — no grep can see either. Treat");
L.push("an empty cell as \"worth asking about\", not as permission to delete.");
L.push("");
L.push(`**${rows.length} endpoints across ${new Set(rows.map((r) => r.mount)).size} mounts.**`);
L.push("");
const byMethod = {};
for (const r of rows) byMethod[r.method] = (byMethod[r.method] ?? 0) + 1;
L.push(Object.entries(byMethod).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(" · "));
L.push("");
for (const s of surfaces) {
  const group = rows.filter((r) => r.path.split("/")[2] === s);
  const un = group.filter((r) => r.callers.length === 0).length;
  L.push(`## /api/${s} — ${group.length} endpoints${un ? `, ${un} with no in-repo caller` : ""}`);
  L.push("");
  L.push("| Method | Path | Called by | Source |");
  L.push("|---|---|---|---|");
  for (const r of group) {
    L.push(`| ${r.method} | \`${r.path}\` | ${r.callers.join(", ") || "—"} | \`${r.file}\` |`);
  }
  L.push("");
}

const content = L.join("\n") + "\n";
const norm = (s) => s.replace(/\r\n/g, "\n");
const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8") : null;

if (check) {
  if (current === null || norm(current) !== norm(content)) {
    console.error(
      `docs/reference/api-endpoints.md is ${current === null ? "missing" : "stale"} — the API surface changed.\n` +
        "Run `npm run api:endpoints` and commit the result. If the change was not intended, that is the bug.",
    );
    process.exit(1);
  }
  console.log(`docs/reference/api-endpoints.md is up to date (${rows.length} endpoints).`);
} else {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, content, "utf8");
  console.log(`wrote docs/reference/api-endpoints.md — ${rows.length} endpoints, ${rows.filter((r) => !r.callers.length).length} with no in-repo caller.`);
}
