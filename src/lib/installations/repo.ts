// Wires the handlers' Repo to Drizzle. One client per call, always closed.

import { DatabaseUnavailableError, type ApiDeps, type Repo } from "./api";
import { readDatabaseUrl, openDb, type Db, type ShellDbEnv } from "./db";
import {
  createCpoOrganisation,
  createSite,
  drizzleStore,
  listInstallations,
  loadDirectory,
  loadHistory,
  loadRoutingId,
  loadSnapshot,
} from "./drizzle-store";
import { saveInstallation } from "./service";
import { notifyCommitted, type HubClient } from "@/lib/sync/hub";

export function repoFor(db: Db, hub: HubClient | null = null): Repo {
  const store = drizzleStore(db);
  return {
    async save(input, actor) {
      const result = await saveInstallation(store, input, actor);
      // After the commit, never inside it. A replay or an unchanged save wrote nothing, so nothing to announce.
      // A failed notification is recovered by the hub's age bound; it never fails the save.
      if (!result.replayed && !result.unchanged) await notifyCommitted(hub, result.snapshot.installation.id, { rev: result.snapshot.installation.revision });
      return result;
    },
    async get(id) {
      const snapshot = await loadSnapshot(db, id);
      if (!snapshot) return null;
      const [routingId, history] = await Promise.all([loadRoutingId(db, snapshot.installation.orgId), loadHistory(db, id)]);
      return { snapshot, routingId, history };
    },
    list: (limit, offset) => listInstallations(db, { limit, offset }),
    directory: () => loadDirectory(db),
    createOrganisation: (displayName) => createCpoOrganisation(db, { displayName }),
    createSite: (input) => createSite(db, input),
  };
}

export function liveDeps(env: ShellDbEnv = process.env, hub: HubClient | null = null): ApiDeps {
  return {
    env,
    async withRepo(fn) {
      const url = readDatabaseUrl(env);
      if (!url) throw new DatabaseUnavailableError();
      const { db, close } = openDb(url);
      try {
        return await fn(repoFor(db, hub));
      } finally {
        await close();
      }
    },
  };
}
