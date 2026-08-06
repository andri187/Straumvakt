#!/usr/bin/env node
//
// Scaffold a Drizzle schema module from a Prisma domain file.
//
// WHY A SCAFFOLDER AND NOT INTROSPECTION
// --------------------------------------
// drizzle-kit introspection does not support Postgres schema names, and this
// database has twenty of them. So tables have to be declared by hand — which
// for identity alone is 15 tables and ~150 columns, every one of which is a
// chance to mistype a column name into a runtime error that no typechecker
// will catch.
//
// This writes the first draft from the Prisma schema, which already carries
// every @map, @db.* and @@schema. The output is then OWNED BY HAND: read it,
// fix what is wrong, keep it. It is not a build step and nothing re-runs it
// on check. Regenerating over a hand-edited file will discard those edits.
//
// The generated draft is a claim about the database, not proof. That is what
// the parity harness is for — see apps/api/test/parity/.
//
// USAGE
//   node scripts/drizzle-scaffold-from-prisma.mjs identity > draft.ts
//
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const domain = process.argv[2];
if (!domain) {
  console.error("usage: node scripts/drizzle-scaffold-from-prisma.mjs <domain>");
  console.error("       domains: identity assets charging commercial vendor protocol platform");
  process.exit(1);
}

const SRC = path.join(ROOT, "prisma", "schema", `${domain}.prisma`);
if (!fs.existsSync(SRC)) {
  console.error(`no such domain file: prisma/schema/${domain}.prisma`);
  process.exit(1);
}

const lines = fs.readFileSync(SRC, "utf8").split(/\r?\n/);

// ── parse ──────────────────────────────────────────────────────────────────

/** @typedef {{kind:'model'|'enum', name:string, pgSchema:string|null, tableName:string|null,
 *             fields:Array<any>, values:string[], ids:string[][], uniques:string[][],
 *             indexes:string[][]}} Block */

/** @type {Block[]} */
const blocks = [];
let cur = null;

for (const line of lines) {
  const open = line.match(/^(model|enum)\s+(\w+)\s*\{/);
  if (open) {
    cur = {
      kind: open[1],
      name: open[2],
      pgSchema: null,
      tableName: null,
      fields: [],
      values: [],
      ids: [],
      uniques: [],
      indexes: [],
    };
    continue;
  }
  if (!cur) continue;
  if (line === "}") {
    blocks.push(cur);
    cur = null;
    continue;
  }

  const trimmed = line.trim();
  if (trimmed.startsWith("//") || trimmed === "") continue;

  // block attributes
  const bm = trimmed.match(/^@@(\w+)\((.*)\)\s*$/) || trimmed.match(/^@@(\w+)\s*$/);
  if (bm) {
    const [, attr, argsRaw = ""] = bm;
    if (attr === "schema") cur.pgSchema = argsRaw.replace(/["\s]/g, "");
    else if (attr === "map") cur.tableName = argsRaw.replace(/["\s]/g, "");
    else if (attr === "id") cur.ids.push(parseFieldList(argsRaw));
    else if (attr === "unique") cur.uniques.push(parseFieldList(argsRaw));
    else if (attr === "index") cur.indexes.push(parseFieldList(argsRaw));
    continue;
  }

  if (cur.kind === "enum") {
    const v = trimmed.match(/^(\w+)/);
    if (v) cur.values.push(v[1]);
    continue;
  }

  const fm = trimmed.match(/^(\w+)\s+([\w.]+)(\[\])?(\?)?(.*)$/);
  if (!fm) continue;
  const [, fname, ftype, isList, isOpt, rest] = fm;
  cur.fields.push({
    name: fname,
    type: ftype,
    list: Boolean(isList),
    optional: Boolean(isOpt),
    attrs: rest || "",
    column: (rest.match(/@map\("([^"]+)"\)/) || [])[1] ?? fname,
    isId: /@id\b/.test(rest),
    isUnique: /@unique\b/.test(rest),
    isRelation: /@relation\(/.test(rest),
    default: (rest.match(/@default\(([^)]*(?:\([^)]*\))?[^)]*)\)/) || [])[1],
    dbType: (rest.match(/@db\.(\w+)(\([^)]*\))?/) || []).slice(1).filter(Boolean).join(""),
    updatedAt: /@updatedAt\b/.test(rest),
  });
}

function parseFieldList(raw) {
  const inner = raw.match(/\[([^\]]*)\]/);
  const body = inner ? inner[1] : raw;
  return body
    .split(",")
    .map((s) => s.trim().replace(/\(.*$/, ""))
    .filter(Boolean);
}

const models = blocks.filter((b) => b.kind === "model");
const enums = blocks.filter((b) => b.kind === "enum");
const modelNames = new Set(models.map((m) => m.name));
const enumByName = new Map(enums.map((e) => [e.name, e]));

// ── emit ───────────────────────────────────────────────────────────────────

const schemasUsed = [...new Set(blocks.map((b) => b.pgSchema).filter(Boolean))].sort();
const varFor = (pgSchema) => `${pgSchema}Schema`;
const camel = (s) => s.replace(/^(\w)/, (m) => m.toLowerCase());

const imports = new Set(["pgSchema"]);
const out = [];

function drizzleColumn(f) {
  const col = JSON.stringify(f.column);
  const db = f.dbType;

  let base;
  if (enumByName.has(f.type)) {
    // A Prisma enum field is a Postgres enum type in the same schema.
    base = `${camel(f.type)}Enum(${col})`;
  } else
  switch (f.type) {
    case "String":
      if (db.startsWith("Uuid")) { imports.add("uuid"); base = `uuid(${col})`; }
      else if (db.startsWith("Citext")) { base = `citext(${col})`; }
      else if (db.startsWith("VarChar")) {
        imports.add("varchar");
        const n = (db.match(/\((\d+)\)/) || [])[1];
        base = n ? `varchar(${col}, { length: ${n} })` : `varchar(${col})`;
      } else { imports.add("text"); base = `text(${col})`; }
      break;
    case "DateTime":
      if (db.startsWith("Date")) { imports.add("date"); base = `date(${col}, { mode: "date" })`; }
      else {
        imports.add("timestamp");
        const p = (db.match(/\((\d+)\)/) || [])[1] ?? "6";
        base = `timestamp(${col}, { withTimezone: true, precision: ${p}, mode: "date" })`;
      }
      break;
    case "Boolean": imports.add("boolean"); base = `boolean(${col})`; break;
    case "Int": imports.add("integer"); base = `integer(${col})`; break;
    case "BigInt": imports.add("bigint"); base = `bigint(${col}, { mode: "bigint" })`; break;
    case "Float": imports.add("doublePrecision"); base = `doublePrecision(${col})`; break;
    case "Decimal": {
      imports.add("numeric");
      const m = db.match(/\((\d+),\s*(\d+)\)/);
      base = m ? `numeric(${col}, { precision: ${m[1]}, scale: ${m[2]} })` : `numeric(${col})`;
      break;
    }
    case "Json": imports.add("jsonb"); base = `jsonb(${col})`; break;
    case "Bytes": imports.add("customType"); base = `bytea(${col})`; break;
    default:
      return null; // relation or unknown — skipped by the caller
  }

  if (f.list) base += ".array()";
  if (f.isId) base += ".primaryKey()";
  if (!f.optional && !f.isId) base += ".notNull()";

  // Defaults. Deliberately NOT emitted for @default(now())/@default(uuid()):
  // the column already carries a database default, and having Drizzle also
  // send one means two sources for the same value.
  if (f.default !== undefined && !f.isId) {
    const d = f.default.trim();
    if (d === "now()" || d === "uuid()" || d === "dbgenerated" || d.startsWith("dbgenerated")) {
      // database-side; leave it there
    } else if (d === "[]") {
      base += `.default([])`;
    } else if (/^"(.*)"$/.test(d)) {
      const inner = d.slice(1, -1);
      base += f.type === "Json" ? `.default(${inner || "{}"})` : `.default(${JSON.stringify(inner)})`;
    } else if (/^\d+$/.test(d)) {
      base += `.default(${d})`;
    } else if (d === "true" || d === "false") {
      base += `.default(${d})`;
    } else if (enumByName.has(f.type)) {
      base += `.default(${JSON.stringify(d)})`;
    }
  }

  return base;
}

for (const e of enums) {
  const vals = e.values.map((v) => JSON.stringify(v)).join(", ");
  out.push(
    `export const ${camel(e.name)}Enum = ${varFor(e.pgSchema)}.enum(${JSON.stringify(e.name)}, [${vals}]);`,
  );
}
out.push("");

for (const m of models) {
  // A relation field is not a column. Prisma names them by the target model,
  // which may live in another domain file — so "not a scalar and not an enum"
  // is the test, not "is a model I can see from here".
  const cols = [];
  for (const f of m.fields) {
    if (f.isRelation) continue;
    const c = drizzleColumn(f);
    if (c === null) {
      if (/^[A-Z]/.test(f.type)) continue; // back-relation to another domain
      cols.push(`  // UNMAPPED: ${f.name} ${f.type}${f.list ? "[]" : ""}${f.optional ? "?" : ""} — resolve by hand`);
      continue;
    }
    cols.push(`  ${f.name}: ${c},`);
  }

  const extras = [];
  for (const idCols of m.ids) {
    imports.add("primaryKey");
    extras.push(`    primaryKey({ columns: [${idCols.map((c) => `t.${c}`).join(", ")}] }),`);
  }
  for (const u of m.uniques) {
    imports.add("uniqueIndex");
    extras.push(`    uniqueIndex().on(${u.map((c) => `t.${c}`).join(", ")}),`);
  }
  for (const i of m.indexes) {
    imports.add("index");
    extras.push(`    index().on(${i.map((c) => `t.${c}`).join(", ")}),`);
  }

  const tableName = m.tableName ?? m.name;
  // Export name follows the TABLE, not the Prisma model: `users`, not `user`.
  // Drizzle queries read `from(users)`, and the table name is the thing that
  // has to be right anyway.
  const exportName = tableName.replace(/_(\w)/g, (_, c) => c.toUpperCase());
  out.push(`/** Prisma model \`${m.name}\` — ${m.pgSchema}.${tableName} */`);
  out.push(`export const ${exportName} = ${varFor(m.pgSchema)}.table(`);
  out.push(`  ${JSON.stringify(tableName)},`);
  out.push(`  {`);
  out.push(...cols.map((c) => `  ${c}`));
  out.push(`  },`);
  if (extras.length) {
    out.push(`  (t) => [`);
    out.push(...extras);
    out.push(`  ],`);
  }
  out.push(`);`);
  out.push("");
}

const usesCitext = out.some((l) => l.includes("citext("));
if (usesCitext) imports.add("customType");

const header = [
  `// DRAFT — scaffolded from prisma/schema/${domain}.prisma by`,
  `// scripts/drizzle-scaffold-from-prisma.mjs. Review every line, then own it.`,
  ``,
  `import { ${[...imports].sort().join(", ")} } from "drizzle-orm/pg-core";`,
  ``,
  ...(usesCitext
    ? [
        `// citext has no first-class Drizzle type. It behaves as text in TypeScript;`,
        `// the case-insensitive comparison is the database's job either way.`,
        `const citext = customType<{ data: string }>({ dataType: () => "citext" });`,
        ``,
      ]
    : []),
  ...schemasUsed.map((s) => `export const ${varFor(s)} = pgSchema(${JSON.stringify(s)});`),
  ``,
];

process.stdout.write(header.concat(out).join("\n") + "\n");
