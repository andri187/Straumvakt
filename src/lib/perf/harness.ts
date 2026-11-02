// Test-only measurement harness for the installations/chargers navigation work. Never imported by application code.
//
// What it is: the project's real migrations on an in-memory PGlite, a fixture seeded through the real saveInstallation
// path (so revisions and history are real), and a counter that tags every SQL statement Drizzle emits. Handlers under test
// run unchanged; only the database driver differs from production (PGlite instead of the Neon WebSocket pool).
//
// What it is NOT: a latency model. PGlite is in-process, so wall time here is handler CPU, not network + Neon time. Counts
// (queries by class, connections, requests, cache hits) are the portable evidence. Nothing here is production OPEX.

import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { citext } from "@electric-sql/pglite/contrib/citext";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { drizzle } from "drizzle-orm/pglite";
import { sql } from "drizzle-orm";
import type { Db } from "@/lib/installations/db";
import { createCpoOrganisation, createSite, drizzleStore } from "@/lib/installations/drizzle-store";
import { saveInstallation } from "@/lib/installations/service";
import { sharedLoginActor } from "@/lib/installations/actor";
import { SHELL_COOKIE_NAME, createShellSession, type ShellConfig } from "@/lib/cpo-shell-session";

export type QueryClass = "access" | "version" | "structural" | "history" | "operational" | "discovery" | "other";

/** Classifies by what the statement reads, so a baseline and a changed implementation are counted by the same rule. */
export function classify(text: string): QueryClass {
  const q = text.toLowerCase();
  if (/^\s*(begin|commit|rollback|savepoint|release|set )/.test(q)) return "other";
  if (q.includes("device_operational_state")) return "operational";
  if (q.includes("installation_changes")) return "history";
  if (q.includes("pending_discoveries") || q.includes("protocol_receipts")) return "discovery";
  if (/^select "id" from "properties"\."installations"/.test(q) && !q.includes("join")) return "access";
  if (q.includes('"status_version"') && q.includes('"revision"') && !q.includes('"display_name"') && !q.includes("join")) return "version";
  if (/"assets"\."(circuits|placements|devices|device_identities)"|"properties"\.|"tenancy"\.|"sites"|"organizations"/.test(q)) return "structural";
  return "other";
}

export class QueryCounter {
  enabled = false;
  readonly byClass: Record<QueryClass, number> = { access: 0, version: 0, structural: 0, history: 0, operational: 0, discovery: 0, other: 0 };
  readonly log: { class: QueryClass; sql: string }[] = [];
  connections = 0;
  record(text: string) {
    if (!this.enabled) return;
    const c = classify(text);
    this.byClass[c] += 1;
    this.log.push({ class: c, sql: text });
  }
  reset() {
    for (const k of Object.keys(this.byClass) as QueryClass[]) this.byClass[k] = 0;
    this.log.length = 0;
    this.connections = 0;
  }
  get total() {
    return Object.values(this.byClass).reduce((a, b) => a + b, 0) - this.byClass.other;
  }
  get structuralTotal() {
    return this.byClass.structural + this.byClass.history;
  }
  snapshot() {
    return { ...this.byClass, dataQueries: this.total, structuralQueries: this.structuralTotal, connections: this.connections };
  }
}

export const SHELL_CONFIG: ShellConfig = { username: "ShellTester", password: "disposable-test-password", secret: "test-only-signing-secret-0123456789abcdef" };
export const SHELL_ENV = { CPO_SHELL_USERNAME: SHELL_CONFIG.username, CPO_SHELL_PASSWORD: SHELL_CONFIG.password, CPO_SHELL_SESSION_SECRET: SHELL_CONFIG.secret };
export const ORIGIN = "https://shell.example.test";
export const sessionCookie = async () => `${SHELL_COOKIE_NAME}=${await createShellSession(SHELL_CONFIG)}`;

export type FixtureSize = { installations: number; circuitsPer: number; chargersPer: number };
export const DEFAULT_SIZE: FixtureSize = { installations: 20, circuitsPer: 3, chargersPer: 4 };

export type Fixture = {
  pg: PGlite;
  db: Db;
  counter: QueryCounter;
  orgId: string;
  siteIds: string[];
  installationIds: string[];
  size: FixtureSize;
  close(): Promise<void>;
};

const migrationText = (file: string) => readFileSync(`apps/api/drizzle/${file}`, "utf8").replaceAll("--> statement-breakpoint", "");

export async function makeFixture(size: FixtureSize = DEFAULT_SIZE): Promise<Fixture> {
  const pg = new PGlite({ extensions: { citext, btree_gist } });
  await pg.exec("create extension if not exists citext; create extension if not exists btree_gist;");
  for (const f of readdirSync("apps/api/drizzle").filter((n) => /^\d{4}_.*\.sql$/.test(n)).sort()) await pg.exec(migrationText(f));
  const counter = new QueryCounter();
  const db = drizzle(pg, { logger: { logQuery: (q: string) => counter.record(q) } }) as unknown as Db;

  const org = await createCpoOrganisation(db, { displayName: "Perf CPO" });
  const siteCount = Math.max(1, Math.ceil(size.installations / 5));
  const siteIds: string[] = [];
  for (let s = 0; s < siteCount; s++) siteIds.push((await createSite(db, { orgId: org.id, displayName: `Site ${s + 1}`, address: null }))!.id);

  const store = drizzleStore(db);
  const actor = sharedLoginActor(SHELL_CONFIG.username);
  const installationIds: string[] = [];
  for (let i = 0; i < size.installations; i++) {
    const circuits = Array.from({ length: size.circuitsPer }, (_, c) => ({ id: `new-c${c}`, parentId: c === 0 ? null : "new-c0", displayName: `Circuit ${c + 1}`, ratingAmps: 32, phaseCount: 3 as const }));
    const chargers = Array.from({ length: size.chargersPer }, (_, k) => ({
      id: `new-k${k}`, circuitId: `new-c${k % size.circuitsPer}`, label: `Charger ${k + 1}`, chargePointId: `PERF-${i}-${k}`, vendor: "Zaptec", model: "Go", serialNumber: `SN-${i}-${k}`,
    }));
    const saved = await saveInstallation(store, {
      orgId: org.id, siteId: siteIds[i % siteCount]!, idempotencyKey: crypto.randomUUID(),
      installation: { displayName: `Installation ${String(i).padStart(2, "0")}`, mainDeviceType: null, mainRatingAmps: 63, mainPhaseCount: 3, mainGridType: "TN" },
      electrician: { name: null, email: null, phone: null }, password: { action: "keep" }, circuits, chargers,
    } as never, actor);
    installationIds.push(saved.snapshot.installation.id);
  }
  // Operational state for every placed device, written the way the engine does: a row plus a bumped status_version.
  await pg.exec(`
    insert into assets.device_operational_state (device_id, org_id, installation_id, placement_id, connectors, last_received_at, seq)
    select p.device_id, i.org_id, p.installation_id, p.id, '{"1":{"status":"Available","errorCode":"NoError","reportedAt":null}}'::jsonb, now(),
           row_number() over (partition by p.installation_id order by p.created_at)
    from assets.placements p join properties.installations i on i.id = p.installation_id where upper_inf(p.period);
    update properties.installations i set status_version = coalesce((select max(seq) from assets.device_operational_state s where s.installation_id = i.id), 0);
  `);
  return { pg, db, counter, orgId: org.id, siteIds, installationIds, size, close: () => pg.close() };
}

/** Marks one device's status as changed exactly as the engine would (row + status_version bump). */
export async function changeStatus(fx: Fixture, installationId: string, status = "Charging") {
  await fx.pg.exec(`
    with bumped as (update properties.installations set status_version = status_version + 1 where id = '${installationId}' returning status_version)
    update assets.device_operational_state s set connectors = jsonb_build_object('1', jsonb_build_object('status','${status}','errorCode','NoError','reportedAt',null)),
      seq = (select status_version from bumped), last_received_at = now()
    where s.device_id = (select device_id from assets.device_operational_state where installation_id = '${installationId}' order by seq limit 1);
  `);
}

export const countSql = (fx: Fixture, text: string) => fx.pg.query(text).then((r) => r.rows);
export { sql };

export type Measurement = ReturnType<QueryCounter["snapshot"]> & { name: string; requests: number; handlerMs: number; note?: string };

/** Runs one scenario with the counter armed and reports counts. `requests` is what the scenario says it sent. */
export async function measure(fx: Fixture, name: string, requests: number, fn: () => Promise<unknown>, note?: string): Promise<Measurement> {
  fx.counter.reset();
  fx.counter.enabled = true;
  const t0 = performance.now();
  try {
    await fn();
  } finally {
    fx.counter.enabled = false;
  }
  return { name, requests, handlerMs: Math.round((performance.now() - t0) * 10) / 10, ...fx.counter.snapshot(), ...(note ? { note } : {}) };
}
