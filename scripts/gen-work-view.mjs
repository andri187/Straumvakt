#!/usr/bin/env node
//
// Generate the admin work view from the canon.
//
// SINGLE SOURCE. The page is DERIVED from WORKSPACE.md + TASKS.md, never
// hand-kept. A hand-maintained status page is a second source of truth that
// drifts silently and then lies confidently — which is the failure this whole
// market-focus pivot exists to stop.
//
// Regenerate with `npm run work-view`. `--check` fails if the committed page
// is stale, so a canon edit that forgets the page is caught in CI rather than
// by a reader.
//
// The output is a Next.js page under an ADMIN-GATED route. It is NOT public
// and it is NOT deployed by this script.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "src/app/(app)/admin/work/page.tsx");
const check = process.argv.includes("--check");

const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

// ── health numbers, parsed out of WORKSPACE.md ──────────────────────────
const ws = read("WORKSPACE.md");
const grab = (re, fallback = "?") => (ws.match(re)?.[1] ?? fallback).trim();

const health = {
  prisma: grab(/Prisma:\s*\*\*(\d+)\*\*\s*calls/),
  drizzle: grab(/Drizzle\s*\*\*(\d+)\*\*/),
  ported: grab(/\*\*~?(\d+)% ported\*\*/),
  baseline: grab(/depcruise baseline:\s*\*\*(\d+)\*\*/),
  vendorLeaks: grab(/\*\*\d+\*\*\s*\((\d+) vendor/),
  adrs: grab(/ADRs:\s*\*\*(\d+)\*\*/),
  packages: grab(/`packages\/`:\s*\*\*(\d+)\*\*/),
  mirrors: grab(/Prisma mirrors still present:\s*\*\*(\d+)\*\*/),
};

// ── tasks, parsed out of TASKS.md ──────────────────────────────────────
const tasksMd = read("TASKS.md");
const groups = [];
let current = null;
for (const line of tasksMd.split(/\r?\n/)) {
  const h = line.match(/^##\s+([A-Z][A-Z\s—\-]*?)(?:\s+—.*)?$/);
  if (h && /NOW|TRACK A|TRACK B|ONBOARDING|GO-LIVE|EXPAND/.test(h[1])) {
    current = { title: h[1].trim(), items: [] };
    groups.push(current);
    continue;
  }
  const t = line.match(/^- \[([ x])\]\s+\*\*(\d+)\.\s*([^*]+?)\*\*\s*(.*)$/);
  if (t && current) {
    current.items.push({
      done: t[1] === "x",
      n: t[2],
      title: t[3].replace(/\.$/, "").trim(),
      gate: (line.match(/\[GATE: ([^\]]+)\]/) ?? [])[1] ?? null,
    });
  }
}

const done = groups.flatMap((g) => g.items).filter((i) => i.done).length;
const total = groups.flatMap((g) => g.items).length;

const esc = (s) => s.replace(/[&<>{}]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "{": "&#123;", "}": "&#125;" })[c]);

const page = `// GENERATED — do not edit.
// Source: WORKSPACE.md + TASKS.md. Regenerate: \`npm run work-view\`.
// \`npm run check:work-view\` fails if this file is stale.
//
// ADMIN-GATED. It sits under /admin, which the console's admin session
// already guards; it is not a public page.

export const dynamic = "force-dynamic";

const HEALTH = ${JSON.stringify(health, null, 2)} as const;

const GROUPS = ${JSON.stringify(groups, null, 2)} as const;

export default function WorkViewPage() {
  return (
    <main className="mx-auto max-w-4xl p-8">
      <h1 className="text-2xl font-semibold">Market phase — work status</h1>
      <p className="mt-1 text-sm opacity-70">
        Generated from WORKSPACE.md and TASKS.md. ${done} of ${total} tasks complete.
      </p>

      <section className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Prisma calls", HEALTH.prisma, "→ 0"],
          ["Drizzle calls", HEALTH.drizzle, \`\${HEALTH.ported}% ported\`],
          ["Vendor leaks", HEALTH.vendorLeaks, \`of \${HEALTH.baseline} baseline\`],
          ["Packages", HEALTH.packages, \`mirrors \${HEALTH.mirrors}\`],
        ].map(([label, value, sub]) => (
          <div key={label} className="rounded-lg border p-3">
            <div className="text-xs uppercase tracking-wide opacity-60">{label}</div>
            <div className="text-2xl font-semibold tabular-nums">{value}</div>
            <div className="text-xs opacity-60">{sub}</div>
          </div>
        ))}
      </section>

      {GROUPS.map((g) => (
        <section key={g.title} className="mt-8">
          <h2 className="text-sm font-semibold uppercase tracking-wide opacity-70">
            {g.title}
          </h2>
          <ul className="mt-2 space-y-1">
            {g.items.map((t) => (
              <li key={t.n} className="flex gap-2 text-sm">
                <span aria-hidden className="opacity-60">{t.done ? "✓" : "○"}</span>
                <span className={t.done ? "opacity-50 line-through" : ""}>
                  <span className="opacity-60">{t.n}.</span> {t.title}
                </span>
                {t.gate ? (
                  <span className="ml-auto shrink-0 rounded bg-amber-500/15 px-1.5 py-0.5 text-[11px] text-amber-600">
                    {t.gate}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ))}

      <p className="mt-10 text-xs opacity-50">
        Track A (money) and Track B (environments) run in parallel and converge
        at GO-LIVE. By-product work — Drizzle conversion, the vendor ratchet —
        happens inside tasks, not as separate items.
      </p>
    </main>
  );
}
`;

if (check) {
  const existing = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8") : "";
  if (existing.replace(/\r\n/g, "\n") !== page) {
    console.error("src/app/(app)/admin/work/page.tsx is stale.\nRun `npm run work-view` and commit the result.");
    process.exit(1);
  }
  console.log(`work view is up to date (${done}/${total} tasks, ${Object.keys(health).length} health metrics).`);
} else {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, page);
  console.log(`wrote ${path.relative(ROOT, OUT)} — ${done}/${total} tasks, health: prisma ${health.prisma}, drizzle ${health.drizzle}, leaks ${health.vendorLeaks}`);
}
